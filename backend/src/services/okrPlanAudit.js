// 0.6.2: 计划锁 + 计划层修改记录(okr_plan_confirms / okr_plan_audit)。
//
// 锁: 某人某周一行 okr_plan_confirms。lockStatus 由两列推导:
//   都空 → DRAFT; 只有员工确认 → AWAITING_MANAGER; 两个都有 → CONFIRMED(计划层只读, 改动走变更申请)
// 锁只锁计划层(O / KR 的定义); 进展 / 完成开关 / 自评 / 主管分 / 未达成照常可写。
//
// 修改记录: savePlan(以及复制 / 批量导入 / 顺延 / 变更申请套用)落库后, 拿「改之前」和「改之后」的库里快照对齐做 diff。
// 对齐按 id → 标题 → seq 回退(变更申请的 payload 不带 id, 套用后 id 全变, 只按 id 会把改标题记成「删 O + 加 O」;
// 只按序号又会把「删 O1」记成「改 O1 标题 + 删 O3」), 细则见 matchRows。
// target_ref 里写序号(O2 / O2.KR3)+ 标题方便人看。一条改动一行, before / after 存人类可读的字符串。
// 只记计划层: O 增删 / 标题 / 说明 / 权重 / 放弃(DROPPED) / 卡点三件套 / 风险等级;
//             KR 增删 / 标题 / 度量类型 / 目标值 / 单位 / 权重 / 阶段明细(名称 + 截止日) / 卡点。
// 不记 currentValue / 状态(放弃除外) / 自评 / 主管分 / 进展 —— 这些走 okr_updates / okr_scores。
import prisma from '../lib/prisma.js'
import { OkrRuleError, parseMilestones, weekKey } from './okrRules.js'

export const LOCKED_MSG = '本周 OKR 已确认，改动请提交变更申请'
export const LOCK_STATUSES = ['DRAFT', 'AWAITING_MANAGER', 'CONFIRMED']

export function lockStatusOf(row) {
  if (!row?.ownerConfirmedAt) return 'DRAFT'
  return row.managerConfirmedAt ? 'CONFIRMED' : 'AWAITING_MANAGER'
}

/** 读这人这周的确认行(不锁) */
export function confirmRow(cycleId, ownerId, db = prisma) {
  return db.okrPlanConfirm.findUnique({ where: { cycleId_ownerId: { cycleId: BigInt(cycleId), ownerId: BigInt(ownerId) } } })
}

/** 事务里锁住这人这周的确认行(没有就建一行再锁), 返回最新行。确认 / 变更申请 / 审批都先调它 */
export async function lockConfirmRow(tx, cycleId, ownerId) {
  const key = { cycleId: BigInt(cycleId), ownerId: BigInt(ownerId) }
  await tx.okrPlanConfirm.upsert({ where: { cycleId_ownerId: key }, create: key, update: {} })
  await tx.$queryRaw`SELECT id FROM okr_plan_confirms WHERE cycle_id = ${key.cycleId} AND owner_id = ${key.ownerId} FOR UPDATE`
  return tx.okrPlanConfirm.findUnique({ where: { cycleId_ownerId: key } })
}

/**
 * 写计划前的锁校验(在写计划的事务里调用): 锁住确认行, CONFIRMED → 400 / 8201。
 * 不建行: 没有确认行 = DRAFT, 用 FOR UPDATE 读一下(有行就等确认事务提交)即可
 */
export async function assertPlanUnlocked(tx, cycleId, ownerId) {
  const rows = await tx.$queryRaw`SELECT owner_confirmed_at AS ownerConfirmedAt, manager_confirmed_at AS managerConfirmedAt FROM okr_plan_confirms WHERE cycle_id = ${BigInt(cycleId)} AND owner_id = ${BigInt(ownerId)} FOR UPDATE`
  if (lockStatusOf(rows[0]) === 'CONFIRMED') throw new OkrRuleError(LOCKED_MSG, { code: 8201 })
}

/** 不在事务里的快速判断(读接口 / 前置检查用) */
export async function isPlanLocked(cycleId, ownerId, db = prisma) {
  return lockStatusOf(await confirmRow(cycleId, ownerId, db)) === 'CONFIRMED'
}

// ---------------------------------------------------------------- 快照 + diff

/** 某人某周库里的计划(含 KR), 用作 diff 的一侧 */
export function loadPlanRows(db, cycleId, ownerId) {
  return db.okrObjective.findMany({
    where: { cycleId: BigInt(cycleId), ownerId: BigInt(ownerId) },
    include: { keyResults: true },
    orderBy: { seq: 'asc' }
  })
}

const METRIC_LABEL = { BINARY: '是否型', PERCENT: '百分比', NUMBER: '数值型', MILESTONE: '阶段型' }
const RISK_LABEL = { LOW: '低', MEDIUM: '中', HIGH: '高' }

const num = v => (v == null || v === '' ? null : Number(v))
const fmtNum = v => {
  const n = num(v)
  if (n == null || !Number.isFinite(n)) return '—'
  return String(Math.round(n * 100) / 100)
}
const fmtWeight = v => (num(v) == null ? '权重 —' : `权重 ${fmtNum(v)}%`)
const fmtTarget = (k) => {
  if (k.metricType === 'BINARY') return '目标值 完成'
  return `目标值 ${fmtNum(k.targetValue)}${k.metricType === 'PERCENT' ? '%' : (k.unit || '')}`
}
const fmtDate = d => (d ? new Date(d).toISOString().slice(0, 10) : null)
const text = v => (v == null || String(v).trim() === '' ? '（空）' : String(v))
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const oRef = (o) => clip(`O${o.seq} ${o.title}`, 120)
const krRef = (o, k) => clip(`O${o.seq}.KR${k.seq} ${k.title}`, 120)

function milestoneText(raw) {
  const list = parseMilestones(raw)
  if (!list.length) return '（无阶段）'
  return list.map((m, i) => `${i + 1}. ${m.name ?? ''}${m.dueDate ? `(${m.dueDate})` : ''}`).join('；')
}

function blockerText(o, names) {
  if (!o.blockers) return '（无卡点）'
  const who = o.blockerOwnerId != null ? (names.get(String(o.blockerOwnerId)) || `#${o.blockerOwnerId}`) : '—'
  return `${o.blockers}｜卡在 ${who}｜${fmtDate(o.blockerDueDate) || '—'} 前`
}

function krSummary(k) {
  return `KR${k.seq}「${k.title}」${METRIC_LABEL[k.metricType] || k.metricType}，${fmtTarget(k)}，${fmtWeight(k.weight)}`
}

function objectiveSummary(o) {
  const krs = [...(o.keyResults || [])].sort((a, b) => a.seq - b.seq)
  const head = `O${o.seq}「${o.title}」${fmtWeight(o.weight)}`
  return krs.length ? `${head}；${krs.map(krSummary).join('；')}` : head
}

/**
 * 把 before / after 两组(O, 或同一个 O 下的 KR)配成对:
 *   1. id 相同 → 同一条(直接保存计划时前端带 id, 落库后 id 不变)
 *   只有 rebuilt=true(这一组整份重建过: 变更申请的 payload 不带 id, 套用后 id 全变)才往下回退;
 *   带 id 保存时配不上 id 的就是真增删, 再按标题 / seq 配会把「删 O2 + 加新 O」错记成「改 O2 标题」。
 *   2. 标题完全相同 → 同一条(只是顺位移动的条目靠标题认回来)
 *   3. seq 相同 → 同一条, 只在剩下的条目没有净减少(新侧条数 ≥ 旧侧)时启用:
 *      删掉 O2 后原 O3 顺位成 O2, 按 seq 配会把「删 O2」错记成「改 O2 + 删 O3」; 有净删除时宁可老实报增删
 *   4. 仍配不上 → 旧侧算删除, 新侧算新增
 * 返回 { removed: [old], rows: [[old | null, new]] }: removed 按旧 seq 升序; rows 按新 seq 升序, old 为 null 即新增
 */
export function matchRows(before = [], after = [], { rebuilt = false } = {}) {
  const bySeq = (a, b) => a.seq - b.seq
  const olds = [...before].sort(bySeq)
  const news = [...after].sort(bySeq)
  const pairOf = new Map()   // new 行 → old 行
  const usedOld = new Set()
  const link = (o, n) => { pairOf.set(n, o); usedOld.add(o) }
  const restOld = () => olds.filter(o => !usedOld.has(o))
  const restNew = () => news.filter(n => !pairOf.has(n))

  const oldById = new Map(olds.filter(o => o.id != null).map(o => [String(o.id), o]))
  for (const n of news) {
    const o = n.id != null ? oldById.get(String(n.id)) : null
    if (o && !usedOld.has(o)) link(o, n)
  }
  if (!rebuilt) return { removed: restOld(), rows: news.map(n => [pairOf.get(n) ?? null, n]) }
  for (const n of restNew()) {
    const o = restOld().find(x => x.title === n.title)
    if (o) link(o, n)
  }
  const ro = restOld(); const rn = restNew()
  if (ro.length && rn.length && rn.length >= ro.length) {
    for (const n of rn) {
      const same = ro.filter(o => o.seq === n.seq && !usedOld.has(o))
      if (same.length === 1) link(same[0], n)
    }
  }
  return { removed: restOld(), rows: news.map(n => [pairOf.get(n) ?? null, n]) }
}

/**
 * 两份库里快照的计划层差异。返回审计行(不含 cycle / owner / actor / source / reason, 由调用方补)。
 * O / KR 的前后对齐见 matchRows; target_ref 用变更后的序号与标题(删除的条目没有「之后」, 用它原来的)。
 * names: Map<userId, 名字>, 给卡点人显示用
 */
export function diffPlans(before, after, names = new Map()) {
  const rows = []
  const push = (action, targetType, targetRef, field, b, a) => rows.push({ action, targetType, targetRef, field, beforeText: b, afterText: a })
  // 前后一个 O 的 id 都对不上(且两边都有 O) = 整份重建(变更申请套用), O 按标题 / seq 回退;
  // O 是回退配上的, 它下面的 KR 也一定是重建的, 同样回退; O 按 id 配上的, KR 只按 id
  const afterIds = new Set(after.filter(o => o.id != null).map(o => String(o.id)))
  const rebuilt = before.length > 0 && after.length > 0 && !before.some(o => o.id != null && afterIds.has(String(o.id)))
  const om = matchRows(before, after, { rebuilt })

  for (const o of om.removed) push('OBJECTIVE_DEL', 'OBJECTIVE', oRef(o), null, objectiveSummary(o), null)
  for (const [old, o] of om.rows) {
    const ref = oRef(o)
    if (!old) { push('OBJECTIVE_ADD', 'OBJECTIVE', ref, null, null, objectiveSummary(o)); continue }
    if (old.title !== o.title) push('OBJECTIVE_EDIT', 'OBJECTIVE', ref, 'title', old.title, o.title)
    if ((old.description || '') !== (o.description || '')) push('OBJECTIVE_EDIT', 'OBJECTIVE', ref, 'description', text(old.description), text(o.description))
    if (num(old.weight) !== num(o.weight)) push('WEIGHT_EDIT', 'OBJECTIVE', ref, 'weight', fmtWeight(old.weight), fmtWeight(o.weight))
    if ((old.status === 'DROPPED') !== (o.status === 'DROPPED')) {
      push('OBJECTIVE_EDIT', 'OBJECTIVE', ref, 'status', old.status === 'DROPPED' ? '已放弃' : '进行中', o.status === 'DROPPED' ? '已放弃' : '进行中')
    }
    const ob = blockerText(old, names); const nb = blockerText(o, names)
    if (ob !== nb) push('BLOCKER_EDIT', 'OBJECTIVE', ref, 'blockers', ob, nb)
    if ((old.riskLevel || 'LOW') !== (o.riskLevel || 'LOW')) {
      push('OBJECTIVE_EDIT', 'OBJECTIVE', ref, 'riskLevel', `风险 ${RISK_LABEL[old.riskLevel || 'LOW']}`, `风险 ${RISK_LABEL[o.riskLevel || 'LOW']}`)
    }

    const km = matchRows(old.keyResults || [], o.keyResults || [], { rebuilt: old.id == null || String(old.id) !== String(o.id) })
    for (const k of km.removed) push('KR_DEL', 'KR', krRef(o, k), null, krSummary(k), null)
    for (const [ok, k] of km.rows) {
      const kref = krRef(o, k)
      if (!ok) { push('KR_ADD', 'KR', kref, null, null, krSummary(k)); continue }
      if (ok.title !== k.title) push('KR_EDIT', 'KR', kref, 'title', ok.title, k.title)
      if (ok.metricType !== k.metricType) push('KR_EDIT', 'KR', kref, 'metricType', `类型 ${METRIC_LABEL[ok.metricType] || ok.metricType}`, `类型 ${METRIC_LABEL[k.metricType] || k.metricType}`)
      // 是否型的目标值恒为「完成」, 不比; 目标值和单位一起改只记一条(目标值那条里带着单位)
      const targetChanged = num(ok.targetValue) !== num(k.targetValue) && !(ok.metricType === 'BINARY' && k.metricType === 'BINARY')
      const unitChanged = (ok.unit || '') !== (k.unit || '') && !['BINARY', 'PERCENT'].includes(k.metricType)
      if (targetChanged) push('TARGET_EDIT', 'KR', kref, 'targetValue', fmtTarget(ok), fmtTarget(k))
      else if (unitChanged) push('KR_EDIT', 'KR', kref, 'unit', `单位 ${text(ok.unit)}`, `单位 ${text(k.unit)}`)
      if (num(ok.weight) !== num(k.weight)) push('WEIGHT_EDIT', 'KR', kref, 'weight', fmtWeight(ok.weight), fmtWeight(k.weight))
      if (ok.metricType === 'MILESTONE' || k.metricType === 'MILESTONE') {
        const om2 = milestoneText(ok.metricType === 'MILESTONE' ? ok.milestones : null)
        const nm = milestoneText(k.metricType === 'MILESTONE' ? k.milestones : null)
        if (om2 !== nm) push('MILESTONE_EDIT', 'KR', kref, 'milestones', om2, nm)
      }
      if ((ok.blockers || '') !== (k.blockers || '')) push('BLOCKER_EDIT', 'KR', kref, 'blockers', text(ok.blockers), text(k.blockers))
    }
  }
  return rows
}

/** 快照里出现的卡点人名字 */
async function blockerNames(db, ...plans) {
  const ids = [...new Set(plans.flat().map(o => o.blockerOwnerId).filter(v => v != null).map(String))]
  if (!ids.length) return new Map()
  const us = await db.user.findMany({ where: { id: { in: ids.map(BigInt) } }, select: { id: true, name: true, username: true } })
  return new Map(us.map(u => [String(u.id), u.name || u.username]))
}

/**
 * 在写计划的事务里: before 是改之前的快照, 这里读改之后的快照, diff 后逐条写 okr_plan_audit。
 * 返回 diff 行; write=false(预演)只算不写
 */
export async function auditPlanChange(tx, { cycleId, ownerId, actorId, before, source = 'DIRECT', reason = null, write = true, now = new Date() }) {
  const after = await loadPlanRows(tx, cycleId, ownerId)
  const diffs = diffPlans(before, after, await blockerNames(tx, before, after))
  if (!diffs.length || !write) return diffs
  await tx.okrPlanAudit.createMany({
    data: diffs.map(d => ({
      ...d, cycleId: BigInt(cycleId), ownerId: BigInt(ownerId), actorId: BigInt(actorId),
      reason: reason ? String(reason).slice(0, 2000) : null, source, createdAt: now
    }))
  })
  return diffs
}

/** 写一条非 diff 的审计(确认 / 申请 / 批准 / 拒绝) */
export function writeAudit(db, { cycleId, ownerId, actorId, action, targetType = 'PLAN', targetRef = null, field = null, beforeText = null, afterText = null, reason = null, source = 'CONFIRM', now = new Date() }) {
  return db.okrPlanAudit.create({
    data: {
      cycleId: BigInt(cycleId), ownerId: BigInt(ownerId), actorId: BigInt(actorId), action, targetType, targetRef, field,
      beforeText, afterText, reason: reason ? String(reason).slice(0, 2000) : null, source, createdAt: now
    }
  })
}

// ---------------------------------------------------------------- 查看

export const ACTION_LABELS = {
  PLAN_SAVE: '保存计划', OWNER_CONFIRM: '员工确认', MANAGER_CONFIRM: '主管确认',
  CHANGE_REQUEST: '提交变更申请', CHANGE_APPROVE: '批准变更', CHANGE_REJECT: '驳回变更', CHANGE_CANCEL: '撤回变更申请',
  OBJECTIVE_ADD: '新增 O', OBJECTIVE_DEL: '删除 O', OBJECTIVE_EDIT: '修改 O',
  KR_ADD: '新增 KR', KR_DEL: '删除 KR', KR_EDIT: '修改 KR', TARGET_EDIT: '修改目标值', WEIGHT_EDIT: '修改权重',
  MILESTONE_EDIT: '修改阶段明细', BLOCKER_EDIT: '修改卡点'
}

/** 按时间倒序列这人这周的修改记录。cycle 为 null(这周没有周期)→ 空 */
export async function listAudit(cycle, ownerId, { limit } = {}) {
  const n = Math.max(1, Math.min(500, Number(limit) || 200))
  if (!cycle) return { week: null, items: [] }
  const rows = await prisma.okrPlanAudit.findMany({
    where: { cycleId: cycle.id, ownerId: BigInt(ownerId) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: n
  })
  const ids = [...new Set(rows.map(r => String(r.actorId)))]
  const us = ids.length ? await prisma.user.findMany({ where: { id: { in: ids.map(BigInt) } }, select: { id: true, name: true, username: true } }) : []
  const names = new Map(us.map(u => [String(u.id), u.name || u.username]))
  return {
    week: weekKey(cycle),
    items: rows.map(r => ({
      id: String(r.id), action: r.action, actionLabel: ACTION_LABELS[r.action] || r.action,
      actorId: String(r.actorId), actorName: names.get(String(r.actorId)) || null,
      targetType: r.targetType, targetRef: r.targetRef, field: r.field,
      before: r.beforeText, after: r.afterText, reason: r.reason, source: r.source, createdAt: r.createdAt
    }))
  }
}
