// 0.6.2: 计划二级确认 + 变更申请。
//
//   ① 二级确认   员工「确认」→ 主管 / 管理员「确认」→ 这人这周计划锁定(CONFIRMED)
//   ② 锁定后不能直接改   本人与主管都不能直接改计划, 只能提「变更申请」, 主管批准后才生效
//   ③ 计划层改动都留痕   见 okrPlanAudit.js
//
// 规则:
//  - 员工确认: 本人, 或有代管权限的人带 targetUserId 代确认(代确认记操作人)。前置: 这周有周期、未归档、至少 1 个未放弃的 O;
//    没提交过也能确认(确认即「我认这份并交上去」): 同一事务里给还没提交的 O 补上提交(submittedAt / lateSubmit / submittedByOperator,
//    迟交口径 = isLate, 与 /plan/submit 相同; 先按提交的硬约束校验, 不过 → 8204), 返回 submitted=true;
//    已提交过的不动提交时间。重复确认不报错(changed=false, 不重复留痕 / 通知)
//  - 主管确认: ADMIN 或本团队 MANAGER(= 主管评分范围, 见 okrAccess.managerScoreScope), 不能确认自己的。
//    前置: 员工已确认(否则 8202); 员工确认是这位主管代点的 → 403 / 8206(二级确认要两个人)
//  - 确认后不能取消, 要改只能走变更申请; 归档周(CLOSED)不可确认 / 申请 / 审批
//  - 变更申请: 只能在 CONFIRMED 时提(没锁直接改就行); reason 必填; objectives 省略 = 用当前计划。
//    提交时就在事务里按 savePlan 同一套逻辑预演一遍(previewPlan, 回滚), 落库会失败的当场拦下; 同人同周只能有 1 条 PENDING(8203)
//  - 审批: 范围同主管确认; 不能批自己提的申请。通过 → payload 覆盖计划(跳过锁), applied_at, 留痕 CHANGE_APPROVE + 逐条 diff
//    (source=CHANGE_APPLY); 驳回 → 必须写 note, 计划不动; 撤回 → 只有申请人自己
//
// 错误码: 8201 已锁定不能直接改 / 8202 员工还没确认 / 8203 已有待审批的申请 / 8204 确认的前置不满足 /
//         8205 变更申请的入参或状态不对 / 8206 无权(403)
import prisma from '../lib/prisma.js'
import { pushNotification } from '../lib/notify.js'
import { OkrRuleError, weekKey, parseMilestones, isLate, normalizePlan, shanghaiDateKey } from './okrRules.js'
import { getCycle, canWritePlan, writePlan, previewPlan, READ_ONLY_MSG } from './okr.js'
import { okrLimits } from './okrLimits.js'
import { lockStatusOf, confirmRow, lockConfirmRow, writeAudit, loadPlanRows, ACTION_LABELS } from './okrPlanAudit.js'

export const CHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELED']
export const NOTIFY = {
  CONFIRM_PENDING: 'OKR_PLAN_CONFIRM_PENDING',
  CONFIRMED: 'OKR_PLAN_CONFIRMED',
  CHANGE_REQUEST: 'OKR_PLAN_CHANGE_REQUEST',
  CHANGE_DECIDED: 'OKR_PLAN_CHANGE_DECIDED'
}
const PAYLOAD_MAX_BYTES = 256 * 1024
const REASON_MAX = 2000

const bad = (msg, code) => new OkrRuleError(msg, { code })
const denied = msg => new OkrRuleError(msg, { status: 403, code: 8206 })
const notFound = msg => new OkrRuleError(msg, { status: 404, code: 8108 })
const shortWeek = c => `W${String(c.weekNo).padStart(2, '0')}`

async function userBriefs(ids) {
  const uniq = [...new Set(ids.filter(v => v != null).map(String))]
  if (!uniq.length) return new Map()
  const us = await prisma.user.findMany({ where: { id: { in: uniq.map(BigInt) } }, select: { id: true, name: true, username: true } })
  return new Map(us.map(u => [String(u.id), { id: String(u.id), name: u.name || u.username }]))
}

const brief = (users, id) => (id == null ? null : (users.get(String(id)) || { id: String(id), name: null }))

/** 周期: 不建(确认 / 申请都只对已有计划的周); 没有 → 400 */
async function existingCycle(week) {
  const cycle = await getCycle(week)
  if (!cycle) throw bad(`${weekKey(week)} 还没有 OKR 计划`, 8204)
  return cycle
}

function assertNotClosed(cycle, what, code) {
  if (cycle.status === 'CLOSED') throw bad(`${weekKey(cycle)} 已归档, 不能${what}`, code)
}

// ---------------------------------------------------------------- 状态

export async function confirmInfo(cycle, ownerId) {
  const row = cycle ? await confirmRow(cycle.id, ownerId) : null
  const pending = cycle
    ? await prisma.okrPlanChange.findFirst({ where: { cycleId: cycle.id, ownerId: BigInt(ownerId), status: 'PENDING' }, select: { id: true, requestedBy: true, createdAt: true } })
    : null
  const users = await userBriefs([row?.ownerConfirmedBy, row?.managerConfirmedBy, pending?.requestedBy])
  return {
    week: cycle ? weekKey(cycle) : null,
    ownerId: String(ownerId),
    lockStatus: lockStatusOf(row),
    ownerConfirmedAt: row?.ownerConfirmedAt ?? null,
    ownerConfirmedBy: brief(users, row?.ownerConfirmedBy),
    managerConfirmedAt: row?.managerConfirmedAt ?? null,
    managerConfirmedBy: brief(users, row?.managerConfirmedBy),
    pendingChange: pending ? { id: String(pending.id), requestedBy: brief(users, pending.requestedBy), createdAt: pending.createdAt } : null
  }
}

// ---------------------------------------------------------------- 通知

/** 这人的主管: 所在团队的 leaderId; 团队没设负责人就取团队里的 MANAGER; 一个团队都没有 → ADMIN。不含本人 */
export async function managersOf(ownerId) {
  const me = BigInt(ownerId)
  const teams = await prisma.team.findMany({
    where: { deletedAt: null, status: 1, members: { some: { userId: me } } },
    select: { id: true, leaderId: true }
  })
  const ids = new Set()
  for (const t of teams) {
    if (t.leaderId != null && t.leaderId !== me) { ids.add(String(t.leaderId)); continue }
    const ms = await prisma.teamMembership.findMany({ where: { teamId: t.id, userId: { not: me }, user: { role: 'MANAGER', status: 1, deletedAt: null } }, select: { userId: true } })
    for (const m of ms) ids.add(String(m.userId))
  }
  if (!ids.size) {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 1, deletedAt: null, id: { not: me } }, select: { id: true } })
    for (const a of admins) ids.add(String(a.id))
  }
  return [...ids]
}

async function ownerName(ownerId) {
  const u = await prisma.user.findUnique({ where: { id: BigInt(ownerId) }, select: { name: true, username: true } })
  return u?.name || u?.username || `#${ownerId}`
}

async function notifySafe(list) {
  for (const n of list) {
    try { await pushNotification({ channels: ['site'], ...n }) } catch (e) { console.error('[okr confirm notify]', e.message) }
  }
}

// ---------------------------------------------------------------- 确认

/** 员工确认。actorId = 实际点的人(代确认时 ≠ ownerId, 代管权限由路由校验) */
export async function confirmOwner({ week, ownerId, actorId, now = new Date() }) {
  const cycle = await existingCycle(week)
  assertNotClosed(cycle, '确认', 8204)
  const owner = BigInt(ownerId)
  const proxy = String(actorId) !== String(ownerId)
  const { changed, submitted, late } = await prisma.$transaction(async (tx) => {
    const row = await lockConfirmRow(tx, cycle.id, owner)
    if (row.ownerConfirmedAt) return { changed: false, submitted: false, late: false }
    const rows = await loadPlanRows(tx, cycle.id, owner)
    const live = rows.filter(o => o.status !== 'DROPPED')
    if (!live.length) throw bad('这周还没有计划(至少要有 1 个 O)才能确认', 8204)
    // 确认 = 认下并交上去: 还没提交的 O 一并提交(与 /plan/submit 同一套硬约束、同一个迟交口径; 已提交的保留第一次的提交时间)
    const pending = live.filter(o => !o.submittedAt)
    let isLateNow = false
    if (pending.length) {
      try {
        normalizePlan(planPayload(rows), { strict: true, today: shanghaiDateKey(now), limits: await okrLimits(tx) })
      } catch (e) {
        if (e instanceof OkrRuleError) throw bad(`确认会一并提交本周计划, 但计划还不能提交: ${e.message}`, 8204)
        throw e
      }
      isLateNow = isLate(cycle.startDate, now)
      await tx.okrObjective.updateMany({
        where: { id: { in: pending.map(o => o.id) } },
        data: { submittedAt: now, lateSubmit: isLateNow, submittedByOperator: proxy }
      })
    }
    await tx.okrPlanConfirm.update({ where: { id: row.id }, data: { ownerConfirmedAt: now, ownerConfirmedBy: BigInt(actorId) } })
    await writeAudit(tx, { cycleId: cycle.id, ownerId: owner, actorId, action: 'OWNER_CONFIRM', beforeText: '草稿', afterText: proxy ? '员工已确认(代确认)' : '员工已确认', now })
    return { changed: true, submitted: pending.length > 0, late: isLateNow }
  })
  if (changed) {
    const name = await ownerName(ownerId)
    const key = weekKey(cycle)
    const data = { week: key, ownerId: String(ownerId) }
    await notifySafe((await managersOf(ownerId)).map(uid => ({
      userId: uid, actorId, type: NOTIFY.CONFIRM_PENDING, data,
      title: `${name} 已确认 ${shortWeek(cycle)} OKR，待你确认`,
      body: `${key} 的计划员工已确认，主管确认后锁定`,
      link: `/admin/okr?week=${key}&userId=${ownerId}`
    })))
  }
  // submitted: 这次确认顺带完成了提交(之前没交); lateSubmit 只在顺带提交时有意义
  return { changed, submitted, ...(submitted ? { lateSubmit: late } : {}), ...(await confirmInfo(cycle, ownerId)) }
}

/** 主管确认。范围(ADMIN / 本团队 MANAGER)由路由校验; 这里校验前置与「两个人」 */
export async function confirmManager({ week, ownerId, actorId, now = new Date() }) {
  const cycle = await existingCycle(week)
  assertNotClosed(cycle, '确认', 8204)
  const owner = BigInt(ownerId)
  const changed = await prisma.$transaction(async (tx) => {
    const row = await lockConfirmRow(tx, cycle.id, owner)
    if (!row.ownerConfirmedAt) throw bad('员工还没确认', 8202)
    if (row.managerConfirmedAt) return false
    if (String(row.ownerConfirmedBy) === String(actorId)) throw denied('员工确认是你代点的，主管确认要换一位主管或管理员')
    await tx.okrPlanConfirm.update({ where: { id: row.id }, data: { managerConfirmedAt: now, managerConfirmedBy: BigInt(actorId) } })
    await writeAudit(tx, { cycleId: cycle.id, ownerId: owner, actorId, action: 'MANAGER_CONFIRM', beforeText: '待主管确认', afterText: '已确认(锁定)', now })
    return true
  })
  if (changed) {
    const key = weekKey(cycle)
    await notifySafe([{
      userId: ownerId, actorId, type: NOTIFY.CONFIRMED, data: { week: key, ownerId: String(ownerId) },
      title: `${shortWeek(cycle)} OKR 已确认，已锁定；要改请提交变更申请`,
      body: `${key} 的计划主管已确认`,
      link: `/admin/okr?week=${key}`
    }])
  }
  return { changed, ...(await confirmInfo(cycle, ownerId)) }
}

// ---------------------------------------------------------------- 变更申请

/** 当前计划 → 与 POST /plan 的 objectives 同形(带 id; projectIds 不带 = 不动关联) */
export function planPayload(rows) {
  return [...rows].sort((a, b) => a.seq - b.seq).map(o => ({
    id: String(o.id), title: o.title, description: o.description, weight: o.weight, status: o.status,
    blockers: o.blockers ?? null,
    blockerOwnerId: o.blockerOwnerId != null ? String(o.blockerOwnerId) : null,
    blockerDueDate: o.blockerDueDate ? new Date(o.blockerDueDate).toISOString().slice(0, 10) : null,
    riskLevel: o.riskLevel ?? 'LOW',
    keyResults: [...(o.keyResults || [])].sort((a, b) => a.seq - b.seq).map(k => ({
      id: String(k.id), title: k.title, metricType: k.metricType, unit: k.unit, targetValue: k.targetValue, weight: k.weight,
      blockers: k.blockers ?? null,
      ...(k.metricType === 'MILESTONE' ? { milestones: parseMilestones(k.milestones).map(m => ({ name: m.name, dueDate: m.dueDate ?? null })) } : {})
    }))
  }))
}

const diffView = d => ({
  action: d.action, actionLabel: ACTION_LABELS[d.action] || d.action, targetType: d.targetType, targetRef: d.targetRef,
  field: d.field, before: d.beforeText, after: d.afterText
})

async function changeView(c, { preview = null, previewError = null } = {}) {
  const users = await userBriefs([c.ownerId, c.requestedBy, c.decidedBy])
  const cycle = await prisma.okrCycle.findUnique({ where: { id: c.cycleId }, select: { year: true, weekNo: true } })
  return {
    id: String(c.id), week: cycle ? weekKey(cycle) : null, cycleId: String(c.cycleId),
    owner: brief(users, c.ownerId), requestedBy: brief(users, c.requestedBy),
    reason: c.reason, status: c.status, payload: c.payload,
    decidedBy: brief(users, c.decidedBy), decidedAt: c.decidedAt, decisionNote: c.decisionNote,
    appliedAt: c.appliedAt, createdAt: c.createdAt, updatedAt: c.updatedAt,
    ...(preview ? { diffCount: preview.length, diffs: preview.map(diffView) } : {}),
    // 待审批但按当前计划已经套不上(批准会失败)的, 给出原因
    ...(previewError ? { previewError } : {})
  }
}

/** 预演一条申请的改动(按当前计划算) */
async function previewOf(cycle, c) {
  const submitted = (await prisma.okrObjective.count({ where: { cycleId: cycle.id, ownerId: c.ownerId, submittedAt: { not: null } } })) > 0
  const requester = String(c.requestedBy) !== String(c.ownerId) ? c.requestedBy : null
  return previewPlan({ cycle, ownerId: c.ownerId, operatorId: requester, objectives: c.payload, submit: submitted })
}

export async function createChange({ week, ownerId, requestedBy, reason, objectives, now = new Date() }) {
  const why = String(reason ?? '').trim()
  if (!why) throw bad('请写变更原因', 8205)
  const cycle = await existingCycle(week)
  assertNotClosed(cycle, '提交变更申请', 8205)
  const owner = BigInt(ownerId)
  if (!(await canWritePlan(cycle, owner))) throw new OkrRuleError(READ_ONLY_MSG, { status: 403, code: 8105 })
  if (lockStatusOf(await confirmRow(cycle.id, owner)) !== 'CONFIRMED') throw bad('这周计划还没锁定(二级确认), 直接修改即可, 不需要变更申请', 8205)

  let payload = objectives
  if (payload === undefined || payload === null) payload = planPayload(await loadPlanRows(prisma, cycle.id, owner))
  if (!Array.isArray(payload)) throw bad('objectives 必须是数组(与保存计划同形)', 8205)
  let json
  try { json = JSON.stringify(payload) } catch { throw bad('objectives 不是合法 JSON', 8205) }
  if (Buffer.byteLength(json, 'utf8') > PAYLOAD_MAX_BYTES) throw bad('变更内容太大(上限 256KB)', 8205)
  payload = JSON.parse(json)

  const draft = { cycleId: cycle.id, ownerId: owner, requestedBy: BigInt(requestedBy), payload }
  // 先预演: 批准时会失败的(删有进展的 O、权重不对 ...)现在就拦下, 原样返回原错误码
  const preview = await previewOf(cycle, draft)

  const created = await prisma.$transaction(async (tx) => {
    const row = await lockConfirmRow(tx, cycle.id, owner)
    if (lockStatusOf(row) !== 'CONFIRMED') throw bad('这周计划还没锁定(二级确认), 直接修改即可, 不需要变更申请', 8205)
    const pending = await tx.okrPlanChange.findFirst({ where: { cycleId: cycle.id, ownerId: owner, status: 'PENDING' }, select: { id: true } })
    if (pending) throw bad(`这周已有一条待审批的变更申请(#${pending.id}), 等它处理完或先撤回`, 8203)
    const c = await tx.okrPlanChange.create({ data: { ...draft, reason: why.slice(0, REASON_MAX), status: 'PENDING' } })
    await writeAudit(tx, {
      cycleId: cycle.id, ownerId: owner, actorId: requestedBy, action: 'CHANGE_REQUEST', targetRef: `变更申请 #${c.id}`,
      afterText: `待审批，涉及 ${preview.length} 处改动`, reason: why, source: 'CHANGE_APPLY', now
    })
    return c
  })

  const name = await ownerName(ownerId)
  const key = weekKey(cycle)
  const short = why.length > 40 ? `${why.slice(0, 40)}…` : why
  await notifySafe((await managersOf(ownerId)).map(uid => ({
    userId: uid, actorId: requestedBy, type: NOTIFY.CHANGE_REQUEST, data: { week: key, ownerId: String(ownerId), changeId: String(created.id) },
    title: `${name} 申请变更 ${shortWeek(cycle)} OKR：${short}`,
    body: `${key} 已锁定的计划有一条变更申请(${preview.length} 处改动)待你审批`,
    link: `/admin/okr?week=${key}&userId=${ownerId}`
  })))
  return changeView(created, { preview })
}

async function loadChange(id) {
  if (!/^\d+$/.test(String(id ?? ''))) throw notFound('变更申请不存在')
  const c = await prisma.okrPlanChange.findUnique({ where: { id: BigInt(id) } })
  if (!c) throw notFound('变更申请不存在')
  return c
}

/** 审批范围由路由给 scope(managerScoreScope 结果); 这里校验「不能批自己的 / 不能批自己提的」 */
function assertCanDecide(c, actorId, scope) {
  const covered = scope === null || (scope instanceof Set && scope.has(String(c.ownerId)))
  if (!covered || String(c.ownerId) === String(actorId)) throw denied('只有管理员或本团队主管能审批这条变更申请')
  if (String(c.requestedBy) === String(actorId)) throw denied('不能审批自己提的变更申请，请另一位主管或管理员处理')
}

async function cycleForDecision(c) {
  const row = await prisma.okrCycle.findUnique({ where: { id: c.cycleId } })
  if (!row) throw notFound('变更申请对应的周期不存在')
  const cycle = await getCycle({ year: row.year, weekNo: row.weekNo })
  return cycle
}

export async function approveChange({ id, actorId, scope, note, now = new Date() }) {
  const c = await loadChange(id)
  assertCanDecide(c, actorId, scope)
  if (c.status !== 'PENDING') throw bad(`这条申请已经是 ${c.status}, 不能再审批`, 8205)
  const cycle = await cycleForDecision(c)
  assertNotClosed(cycle, '套用变更', 8205)
  if (!(await canWritePlan(cycle, c.ownerId))) throw new OkrRuleError(READ_ONLY_MSG, { status: 403, code: 8105 })
  const text = note == null ? null : String(note).trim().slice(0, REASON_MAX) || null

  const r = await prisma.$transaction(async (tx) => {
    await lockConfirmRow(tx, cycle.id, c.ownerId)
    const fresh = await tx.okrPlanChange.findUnique({ where: { id: c.id } })
    if (fresh.status !== 'PENDING') throw bad(`这条申请已经是 ${fresh.status}, 不能再审批`, 8205)
    const submitted = (await tx.okrObjective.count({ where: { cycleId: cycle.id, ownerId: c.ownerId, submittedAt: { not: null } } })) > 0
    const requester = String(c.requestedBy) !== String(c.ownerId) ? c.requestedBy : null
    const w = await writePlan(tx, {
      cycle, ownerId: c.ownerId, operatorId: requester, objectives: c.payload, submit: submitted,
      change: { actorId, reason: c.reason }, now
    })
    const updated = await tx.okrPlanChange.update({
      where: { id: c.id },
      data: { status: 'APPROVED', decidedBy: BigInt(actorId), decidedAt: now, decisionNote: text, appliedAt: now }
    })
    // 批准这一行晚于逐条 diff 落库(同一时刻按 id 倒序排在最上面)
    await writeAudit(tx, {
      cycleId: cycle.id, ownerId: c.ownerId, actorId, action: 'CHANGE_APPROVE', targetRef: `变更申请 #${c.id}`,
      beforeText: '待审批', afterText: `已批准并生效，改动 ${w.diffs.length} 处${text ? `；意见：${text}` : ''}`,
      reason: c.reason, source: 'CHANGE_APPLY', now
    })
    return { updated, diffs: w.diffs }
  }, { timeout: 20000 })

  await notifyDecision(cycle, c, actorId, true, text)
  return changeView(r.updated, { preview: r.diffs })
}

export async function rejectChange({ id, actorId, scope, note, now = new Date() }) {
  const c = await loadChange(id)
  assertCanDecide(c, actorId, scope)
  const text = String(note ?? '').trim()
  if (!text) throw bad('驳回要写原因(note)', 8205)
  if (c.status !== 'PENDING') throw bad(`这条申请已经是 ${c.status}, 不能再审批`, 8205)
  const cycle = await cycleForDecision(c)
  const updated = await prisma.$transaction(async (tx) => {
    await lockConfirmRow(tx, cycle.id, c.ownerId)
    const fresh = await tx.okrPlanChange.findUnique({ where: { id: c.id } })
    if (fresh.status !== 'PENDING') throw bad(`这条申请已经是 ${fresh.status}, 不能再审批`, 8205)
    const u = await tx.okrPlanChange.update({
      where: { id: c.id },
      data: { status: 'REJECTED', decidedBy: BigInt(actorId), decidedAt: now, decisionNote: text.slice(0, REASON_MAX) }
    })
    await writeAudit(tx, {
      cycleId: cycle.id, ownerId: c.ownerId, actorId, action: 'CHANGE_REJECT', targetRef: `变更申请 #${c.id}`,
      beforeText: '待审批', afterText: '已驳回，计划不变', reason: text, source: 'CHANGE_APPLY', now
    })
    return u
  })
  await notifyDecision(cycle, c, actorId, false, text)
  return changeView(updated)
}

export async function cancelChange({ id, actorId, now = new Date() }) {
  const c = await loadChange(id)
  if (String(c.requestedBy) !== String(actorId)) throw denied('只有申请人能撤回这条变更申请')
  if (c.status !== 'PENDING') throw bad(`这条申请已经是 ${c.status}, 不能撤回`, 8205)
  const updated = await prisma.$transaction(async (tx) => {
    await lockConfirmRow(tx, c.cycleId, c.ownerId)
    const fresh = await tx.okrPlanChange.findUnique({ where: { id: c.id } })
    if (fresh.status !== 'PENDING') throw bad(`这条申请已经是 ${fresh.status}, 不能撤回`, 8205)
    const u = await tx.okrPlanChange.update({ where: { id: c.id }, data: { status: 'CANCELED', decidedBy: BigInt(actorId), decidedAt: now } })
    await writeAudit(tx, {
      cycleId: c.cycleId, ownerId: c.ownerId, actorId, action: 'CHANGE_CANCEL', targetRef: `变更申请 #${c.id}`,
      beforeText: '待审批', afterText: '申请人已撤回，计划不变', source: 'CHANGE_APPLY', now
    })
    return u
  })
  return changeView(updated)
}

async function notifyDecision(cycle, c, actorId, approved, note) {
  const key = weekKey(cycle)
  await notifySafe([{
    userId: c.requestedBy, actorId, type: NOTIFY.CHANGE_DECIDED,
    data: { week: key, ownerId: String(c.ownerId), changeId: String(c.id), result: approved ? 'APPROVED' : 'REJECTED' },
    title: approved ? `${shortWeek(cycle)} OKR 变更申请已批准，已生效` : `${shortWeek(cycle)} OKR 变更申请被驳回`,
    body: note ? `意见：${note.slice(0, 200)}` : (approved ? '计划已按申请更新' : '计划保持不变'),
    link: `/admin/okr?week=${key}${String(c.requestedBy) !== String(c.ownerId) ? `&userId=${c.ownerId}` : ''}`
  }])
}

/**
 * 列表。可见: 自己是负责人或申请人的 + 审批范围(scope: null = 全部, Set = 这些人)里的人的。
 * 过滤: cycle(week)、status、ownerId(要在可见范围里, 否则 403)。待审批的带改动预演(diffs)
 */
export async function listChanges({ viewerId, scope, cycle = undefined, status, ownerId }) {
  if (status != null && status !== '' && !CHANGE_STATUSES.includes(String(status))) throw bad(`status 只能是 ${CHANGE_STATUSES.join(' / ')}`, 8205)
  if (cycle === null) return []
  const me = String(viewerId)
  const where = {}
  if (cycle) where.cycleId = cycle.id
  if (status) where.status = String(status)
  if (ownerId != null && ownerId !== '') {
    if (!/^\d+$/.test(String(ownerId))) throw bad('userId 不合法', 8205)
    const visible = String(ownerId) === me || scope === null || (scope instanceof Set && scope.has(String(ownerId)))
    if (visible) where.ownerId = BigInt(ownerId)
    else { where.ownerId = BigInt(ownerId); where.requestedBy = BigInt(me) }
  } else if (scope !== null) {
    const ids = [me, ...(scope instanceof Set ? scope : [])]
    where.OR = [{ ownerId: { in: ids.map(BigInt) } }, { requestedBy: BigInt(me) }]
  }
  const rows = await prisma.okrPlanChange.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 })
  const out = []
  for (const c of rows) {
    let preview = null
    let previewError = null
    if (c.status === 'PENDING') {
      try { preview = await previewOf(await cycleForDecision(c), c) } catch (e) { if (!(e instanceof OkrRuleError)) throw e; previewError = e.message }
    }
    out.push(await changeView(c, { preview, previewError }))
  }
  return out
}
