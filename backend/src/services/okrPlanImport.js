// OKR 7.0: 编周计划提效 —— 从某周复制 O/KR、粘贴 Markdown 批量建 O/KR。
//
// 都是「人点了才做」的一次性写入(不做定时自动复制), 只往目标周追加草稿(不提交、不动已有 O):
//  - 目标周这人已提交过计划 → 400(8171), 要先撤回或由主管改; 周已复盘 / 归档 → 403(同 savePlan 口径)
//  - 目标周已有同名 O(同 owner + 同标题) → 跳过, 列进 skipped
//  - O 总数不超过计划硬上限(MAX_OBJECTIVES), 放不下的跳过(复制)或截断(批量导入)
//  - 写完后这人这周未放弃的 O 权重合计不是 100 → 按原比例缩放到 100(只动草稿; 提交时的硬校验不变)
// 同一周的复制 / 导入在事务里先锁周期行, 两个请求并发时后到的看得到先到的结果, 不会建出两份同名 O。
import prisma from '../lib/prisma.js'
import { getCycle, canWritePlan, READ_ONLY_MSG } from './okr.js'
import { copyObjectiveProjects } from './okrObjectiveProjects.js'
import { OkrRuleError, MAX_OBJECTIVES, weekKey, equalWeights, weightsSumOk, parseMilestones, shanghaiDateKey, dateKeyOf, blockerOverdue } from './okrRules.js'
import { assertPlanUnlocked, isPlanLocked, loadPlanRows, auditPlanChange, LOCKED_MSG } from './okrPlanAudit.js'
import { parsePlanMarkdown, normalizeBulkPlan, BULK_MAX_OBJECTIVES, BULK_MAX_KRS, BULK_MAX_TEXT } from './okrDraft.js'

export const SUBMITTED_MSG = '目标周已提交计划，先撤回或由主管修改'
const forbidden = msg => new OkrRuleError(msg, { status: 403, code: 8105 })
const titleKey = t => String(t ?? '').trim()

/** 锁住周期行(同一周的复制 / 导入排队) */
async function lockCycle(tx, cycleId) {
  await tx.$queryRaw`SELECT id FROM okr_cycles WHERE id = ${cycleId} FOR UPDATE`
}

/** 目标周的现状: 这人的 O、是否已提交 */
async function targetState(db, cycleId, ownerId) {
  const existing = await db.okrObjective.findMany({ where: { cycleId, ownerId: BigInt(ownerId) }, select: { id: true, title: true, status: true, submittedAt: true, weight: true } })
  return {
    existing,
    submitted: existing.some(o => o.submittedAt),
    titles: new Set(existing.map(o => titleKey(o.title))),
    live: existing.filter(o => o.status !== 'DROPPED').length
  }
}

async function assertTargetWritable(db, cycle, ownerId, state) {
  if (state.submitted) throw new OkrRuleError(SUBMITTED_MSG, { code: 8171 })
  // 0.6.2: 已二级确认的计划(哪怕没提交)只能走变更申请
  if (await isPlanLocked(cycle.id, ownerId, db)) throw new OkrRuleError(LOCKED_MSG, { code: 8201 })
  if (!(await canWritePlan(cycle, ownerId, db))) throw forbidden(READ_ONLY_MSG)
}

/** 未放弃的 O 权重合计不是 100 → 按原比例缩放(两位小数, 余数给最后一个); 返回是否动过 */
async function rebalanceWeights(tx, cycleId, ownerId) {
  const live = await tx.okrObjective.findMany({
    where: { cycleId, ownerId: BigInt(ownerId), status: { not: 'DROPPED' } },
    orderBy: { seq: 'asc' }, select: { id: true, weight: true }
  })
  if (!live.length || weightsSumOk(live.map(o => o.weight))) return false
  const sum = live.reduce((s, o) => s + (Number(o.weight) || 0), 0)
  let ws
  if (sum > 0) {
    ws = live.map(o => Math.floor(((Number(o.weight) || 0) / sum) * 10000) / 100)
    ws[ws.length - 1] = Math.round((100 - ws.slice(0, -1).reduce((s, w) => s + w, 0)) * 100) / 100
  } else {
    ws = equalWeights(live.length)
  }
  for (const [i, o] of live.entries()) await tx.okrObjective.update({ where: { id: o.id }, data: { weight: ws[i] } })
  return true
}

// ---------------------------------------------------------------- 从某周复制

/**
 * 把 ownerId 在 from 周的 O 复制到 to 周(草稿)。
 * 复制: O 标题 / 说明 / 权重 / 项目关联 / 卡点三件套(截止日保留原值, 已过期在返回里标 overdue);
 *       KR 标题 / 类型 / 单位 / 目标值 / 阶段明细(done 全部重置) / 权重 / 卡点说明。
 * 不复制: 当前值(0)、KR 状态(空)、O 状态(ON_TRACK)、风险等级(LOW, 每周重新评估)、自评 / 主管分 / 进展 / 未达成。
 * objectiveIds 不传 = from 周这人全部未 DROPPED 的 O; 传了就只复制这些(不属于此人此周的列进 skipped)
 */
export async function copyFromWeek({ ownerId, operatorId = null, from, to, objectiveIds, now = new Date() }) {
  if (weekKey(from) === weekKey(to)) throw new OkrRuleError('fromWeek 和 toWeek 不能是同一周', { code: 8170 })
  let pick = null
  if (objectiveIds !== undefined && objectiveIds !== null) {
    if (!Array.isArray(objectiveIds) || objectiveIds.some(id => !/^\d+$/.test(String(id)))) {
      throw new OkrRuleError('objectiveIds 要是 O 的 id 数组', { code: 8170 })
    }
    pick = [...new Set(objectiveIds.map(String))]
  }
  const owner = BigInt(ownerId)
  const operator = operatorId != null && String(operatorId) !== String(ownerId) ? BigInt(operatorId) : null
  const toCycle = await getCycle(to, { create: true, now })
  await assertTargetWritable(prisma, toCycle, ownerId, await targetState(prisma, toCycle.id, ownerId))
  const fromCycle = await getCycle(from, { now })
  const today = shanghaiDateKey(now)

  const sources = fromCycle
    ? await prisma.okrObjective.findMany({
      where: { cycleId: fromCycle.id, ownerId: owner, ...(pick ? { id: { in: pick.map(BigInt) } } : { status: { not: 'DROPPED' } }) },
      orderBy: { seq: 'asc' }, include: { keyResults: true }
    })
    : []
  const skipped = []
  if (pick) {
    const found = new Set(sources.map(o => String(o.id)))
    for (const id of pick) if (!found.has(id)) skipped.push({ objectiveId: id, title: null, reason: `不是此人 ${weekKey(from)} 的 O` })
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockCycle(tx, toCycle.id)
    await assertPlanUnlocked(tx, toCycle.id, ownerId)
    const before = await loadPlanRows(tx, toCycle.id, ownerId)
    const st = await targetState(tx, toCycle.id, ownerId)
    // 锁内再查一次: 等锁期间可能被提交了
    if (st.submitted) throw new OkrRuleError(SUBMITTED_MSG, { code: 8171 })
    let seq = st.existing.length
    let live = st.live
    const created = []
    let krCount = 0
    for (const o of sources) {
      const key = titleKey(o.title)
      if (st.titles.has(key)) { skipped.push({ objectiveId: String(o.id), title: o.title, reason: `${weekKey(to)} 已有同名 O` }); continue }
      if (live >= MAX_OBJECTIVES) { skipped.push({ objectiveId: String(o.id), title: o.title, reason: `超过每周 ${MAX_OBJECTIVES} 个 O 的上限` }); continue }
      const row = await tx.okrObjective.create({
        data: {
          cycleId: toCycle.id, ownerId: owner, seq: ++seq, title: o.title, description: o.description,
          weight: o.weight, status: 'ON_TRACK',
          blockers: o.blockers, blockerOwnerId: o.blockerOwnerId, blockerDueDate: o.blockerDueDate,
          operatorId: operator
        }
      })
      await copyObjectiveProjects(tx, o.id, row.id, operator ?? owner)
      const krs = [...o.keyResults].sort((a, b) => a.seq - b.seq)
      for (const [i, k] of krs.entries()) {
        const ms = k.metricType === 'MILESTONE' ? parseMilestones(k.milestones).map(m => ({ name: m.name, dueDate: m.dueDate ?? null, done: false })) : null
        await tx.okrKeyResult.create({
          data: {
            objectiveId: row.id, seq: i + 1, title: k.title, metricType: k.metricType, unit: k.unit,
            targetValue: k.targetValue, currentValue: 0, weight: k.weight, status: null,
            milestones: ms ? JSON.stringify(ms) : null, blockers: k.blockers
          }
        })
      }
      krCount += krs.length
      st.titles.add(key)
      live++
      const due = dateKeyOf(o.blockerDueDate)
      created.push({
        id: String(row.id), sourceId: String(o.id), title: o.title, weight: o.weight, keyResults: krs.length,
        blocker: o.blockers ? { text: o.blockers, ownerId: o.blockerOwnerId != null ? String(o.blockerOwnerId) : null, dueDate: due, overdue: blockerOverdue({ ...o, status: 'ON_TRACK' }, today) } : null
      })
    }
    const weightsRebalanced = created.length ? await rebalanceWeights(tx, toCycle.id, ownerId) : false
    await auditPlanChange(tx, { cycleId: toCycle.id, ownerId, actorId: operator ?? owner, before, reason: `从 ${weekKey(from)} 复制`, now })
    return { created, krCount, weightsRebalanced }
  }, { timeout: 20000 })

  return {
    fromWeek: weekKey(from),
    toWeek: weekKey(to),
    createdObjectives: result.created.length,
    createdKrs: result.krCount,
    objectives: result.created,
    skipped,
    // 卡点截止日早于今天的(复制过来照旧保留原日期, 提醒本人更新)
    overdueBlockers: result.created.filter(o => o.blocker?.overdue).map(o => ({ objectiveId: o.id, title: o.title, dueDate: o.blocker.dueDate })),
    weightsRebalanced: result.weightsRebalanced,
    cycleId: toCycle.id
  }
}

// ---------------------------------------------------------------- 粘贴 Markdown 批量建

function checkText(text) {
  const src = String(text ?? '')
  if (!src.trim()) throw new OkrRuleError('text 不能为空: 把本周计划的 Markdown 贴进来', { code: 8170 })
  if (src.length > BULK_MAX_TEXT) throw new OkrRuleError(`内容超过 ${BULK_MAX_TEXT} 字, 请分几次导入`, { code: 8170 })
  return src
}

/** 解析结果 + 目标周现状 → 这次实际要建的 O(去同名 → 按剩余名额截断 → 配权重) */
function plan(parsed, state) {
  const skipped = []
  const fresh = []
  const seen = new Set(state ? state.titles : [])
  for (const o of parsed.objectives) {
    const key = titleKey(o.title)
    if (seen.has(key)) { skipped.push({ title: o.title, line: o.line, reason: state?.titles.has(key) ? '本周已有同名 O' : '同一段文字里重复的 O' }); continue }
    seen.add(key)
    fresh.push(o)
  }
  const room = Math.max(0, Math.min(BULK_MAX_OBJECTIVES, MAX_OBJECTIVES - (state ? state.live : 0)))
  const { objectives, truncated } = normalizeBulkPlan(fresh, { maxObjectives: room, maxKrs: BULK_MAX_KRS })
  return { objectives, truncated, skipped }
}

const krOut = k => ({ title: k.title, metricType: k.metricType, unit: k.unit, targetValue: k.metricType === 'BINARY' ? null : k.targetValue, weight: k.weight, line: k.line })
const objOut = o => ({ title: o.title, description: o.description || null, weight: o.weight, line: o.line, keyResults: o.keyResults.map(krOut) })

/**
 * mode=preview: 只解析(读一下目标周有没有同名 O / 交没交), 不写库; 已提交的周也能预览(submitted=true 提示 apply 会被拒)。
 * mode=apply: 落库为草稿。已提交 → 400(8171); 一个 O 都建不了 → 400(8172)。
 * 返回 { mode, week, submitted, parsed:{objectives,krs}, objectives, truncated, skipped, unparsed, limits, [createdObjectives, createdKrs, weightsRebalanced] }
 */
export async function bulkImport({ ownerId, operatorId = null, week, text, mode, now = new Date() }) {
  if (!['preview', 'apply'].includes(mode)) throw new OkrRuleError('mode 只能是 preview / apply', { code: 8170 })
  const parsed = parsePlanMarkdown(checkText(text))
  const parsedCount = { objectives: parsed.objectives.length, krs: parsed.objectives.reduce((s, o) => s + o.keyResults.length, 0) }
  const limits = { maxObjectives: BULK_MAX_OBJECTIVES, maxKrsPerObjective: BULK_MAX_KRS }
  const base = { mode, week: weekKey(week), parsed: parsedCount, unparsed: parsed.unparsed, limits }

  if (mode === 'preview') {
    const cycle = await getCycle(week, { now })
    const state = cycle ? await targetState(prisma, cycle.id, ownerId) : null
    const p = plan(parsed, state)
    return { ...base, submitted: !!state?.submitted, objectives: p.objectives.map(objOut), truncated: p.truncated, skipped: p.skipped }
  }

  const owner = BigInt(ownerId)
  const operator = operatorId != null && String(operatorId) !== String(ownerId) ? BigInt(operatorId) : null
  const cycle = await getCycle(week, { create: true, now })
  await assertTargetWritable(prisma, cycle, ownerId, await targetState(prisma, cycle.id, ownerId))
  return prisma.$transaction(async (tx) => {
    await lockCycle(tx, cycle.id)
    await assertPlanUnlocked(tx, cycle.id, ownerId)
    const before = await loadPlanRows(tx, cycle.id, ownerId)
    const state = await targetState(tx, cycle.id, ownerId)
    if (state.submitted) throw new OkrRuleError(SUBMITTED_MSG, { code: 8171 })
    const p = plan(parsed, state)
    if (!p.objectives.length) {
      const why = !parsed.objectives.length ? '没识别出 O: 用「## 标题」「O1：标题」或「- 【P0】标题」写 O, 下面用「- 」列 KR'
        : (p.skipped.length && state.live < MAX_OBJECTIVES ? '识别出的 O 本周都已经有了' : `本周已有 ${state.live} 个 O, 到上限 ${MAX_OBJECTIVES} 个了`)
      throw new OkrRuleError(why, { code: 8172, data: { unparsed: parsed.unparsed, skipped: p.skipped } })
    }
    let seq = state.existing.length
    const ids = []
    for (const o of p.objectives) {
      const row = await tx.okrObjective.create({
        data: { cycleId: cycle.id, ownerId: owner, seq: ++seq, title: o.title, description: o.description || null, weight: o.weight, status: 'ON_TRACK', operatorId: operator }
      })
      ids.push(String(row.id))
      for (const [i, k] of o.keyResults.entries()) {
        await tx.okrKeyResult.create({
          data: {
            objectiveId: row.id, seq: i + 1, title: k.title, metricType: k.metricType, unit: k.unit,
            targetValue: k.metricType === 'BINARY' ? 1 : k.targetValue, currentValue: 0, weight: k.weight,
            status: k.metricType === 'BINARY' ? null : 'ON_TRACK'
          }
        })
      }
    }
    const weightsRebalanced = await rebalanceWeights(tx, cycle.id, ownerId)
    await auditPlanChange(tx, { cycleId: cycle.id, ownerId, actorId: operator ?? owner, before, reason: '粘贴 Markdown 批量导入', now })
    return {
      ...base, submitted: false,
      objectives: p.objectives.map((o, i) => ({ id: ids[i], ...objOut(o) })),
      truncated: p.truncated, skipped: p.skipped,
      createdObjectives: p.objectives.length,
      createdKrs: p.objectives.reduce((s, o) => s + o.keyResults.length, 0),
      weightsRebalanced, cycleId: cycle.id
    }
  }, { timeout: 20000 })
}
