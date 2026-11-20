// 周 OKR 的数据操作。路由、MCP(经路由)、定时任务都走这里。
// 与项目管理完全独立: 不读写 Project / Task / Timesheet。
import prisma from '../lib/prisma.js'
import { pushNotification } from '../lib/notify.js'
import {
  OkrRuleError, isoWeekOf, weekRange, weekKey, shiftWeek, compareWeek, nextStatus, timeStatus,
  isReopened, isEditable, isScorable, isLate, submitDeadline, normalizePlan, checkKrStatus,
  krProgress, objectiveProgress, personProgress, weightedScore, derivedObjectiveStatus,
  validScore, personalStatus, equalWeights, LOW_COMPLETION, UPDATE_KINDS
} from './okrRules.js'

export { OkrRuleError }

const r4 = n => (n == null ? null : Math.round(n * 10000) / 10000)
const forbidden = (msg, code = 8105) => new OkrRuleError(msg, { status: 403, code })
const conflict = (msg, code = 8107) => new OkrRuleError(msg, { status: 409, code })
const notFound = (msg = '不存在', code = 8108) => new OkrRuleError(msg, { status: 404, code })

const READ_ONLY_MSG = '本周 OKR 已进入复盘或已归档, 计划和进展只读; 需要修改请主管重开本周'

/** 上海日期(用于 OkrUpdate.date, @db.Date) */
function shanghaiDate(now = new Date()) {
  const wall = new Date(now.getTime() + 8 * 3600 * 1000)
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()))
}

// ---------------------------------------------------------------- 周期

/** 把周期按时间往前推一步(只进不退), 持久化后返回最新行 */
async function syncStatus(cycle, now = new Date(), db = prisma) {
  const want = nextStatus(cycle, now)
  if (!want) return cycle
  return db.okrCycle.update({
    where: { id: cycle.id },
    data: { status: want, ...(want === 'CLOSED' ? { closedAt: now, closedBy: null } : {}) }
  })
}

/**
 * 取某一周的周期。create=true 时不存在就建(只允许当前周与下一周, 防止随手造出几十年后的周期)。
 * 返回 null 表示不存在且未建
 */
export async function getCycle(week, { create = false, anyWeek = false, now = new Date(), db = prisma } = {}) {
  let cycle = await db.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!cycle) {
    if (!create) return null
    const cur = isoWeekOf(now)
    const d = compareWeek(week, cur)
    // anyWeek: 内部用(顺延到某个已有周期的下一周), 不受「本周/下周」限制
    if (!anyWeek && (d < 0 || d > 1)) throw notFound(`${weekKey(week)} 没有 OKR 周期; 只能为本周或下周新建计划`)
    const { start, end } = weekRange(week.year, week.weekNo)
    try {
      cycle = await db.okrCycle.create({
        data: { year: week.year, weekNo: week.weekNo, startDate: start, endDate: end, status: timeStatus({ startDate: start, endDate: end }, now) }
      })
    } catch (e) {
      // 并发首建撞唯一键: 读回已存在的那条, 保证同一周永远只有一个周期
      if (e.code !== 'P2002') throw e
      cycle = await db.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
    }
  }
  return syncStatus(cycle, now, db)
}

export function cycleView(cycle, now = new Date()) {
  return {
    id: String(cycle.id),
    year: cycle.year,
    weekNo: cycle.weekNo,
    key: weekKey(cycle),
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    submitDeadline: submitDeadline(cycle.startDate),
    status: cycle.status,
    reopened: isReopened(cycle),
    reopenedAt: cycle.reopenedAt,
    closedAt: cycle.closedAt,
    editable: isEditable(cycle.status),
    scorable: isScorable(cycle.status),
    deadlinePassed: now.getTime() >= submitDeadline(cycle.startDate).getTime()
  }
}

// ---------------------------------------------------------------- 读

const USER_SELECT = { id: true, name: true, username: true, avatarUrl: true, role: true }

async function loadUsers(ids) {
  const uniq = [...new Set(ids.filter(v => v != null).map(String))].map(BigInt)
  if (!uniq.length) return new Map()
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: USER_SELECT })
  return new Map(rows.map(u => [String(u.id), { id: String(u.id), name: u.name, username: u.username, avatarUrl: u.avatarUrl, role: u.role }]))
}

function krView(k) {
  return {
    id: String(k.id), seq: k.seq, title: k.title, metricType: k.metricType, unit: k.unit,
    targetValue: k.targetValue, currentValue: k.currentValue, weight: k.weight, status: k.status,
    progress: r4(krProgress(k)), updatedAt: k.updatedAt
  }
}

function updateView(u, users) {
  return {
    id: String(u.id), krId: u.krId != null ? String(u.krId) : null, date: u.date, kind: u.kind,
    content: u.content, valueBefore: u.valueBefore, valueAfter: u.valueAfter,
    statusBefore: u.statusBefore, statusAfter: u.statusAfter,
    source: u.source, sourceQuote: u.sourceQuote,
    createdBy: users.get(String(u.createdBy)) || { id: String(u.createdBy) }, createdAt: u.createdAt,
    // 主管代填: 前端显示「由 XX 代填」
    onBehalfOf: u.operatorId != null ? (users.get(String(u.operatorId)) || { id: String(u.operatorId) }) : null
  }
}

function objectiveView(o, users, { detail = true } = {}) {
  const krs = [...(o.keyResults || [])].sort((a, b) => a.seq - b.seq)
  const v = {
    id: String(o.id), seq: o.seq, title: o.title, description: o.description, weight: o.weight,
    status: o.status, selfScore: o.selfScore, managerScore: o.managerScore, managerComment: o.managerComment,
    submittedAt: o.submittedAt, lateSubmit: o.lateSubmit,
    submittedByOperator: !!o.submittedByOperator,
    onBehalfOf: o.operatorId != null ? (users.get(String(o.operatorId)) || { id: String(o.operatorId) }) : null,
    progress: r4(objectiveProgress({ keyResults: krs })),
    keyResults: krs.map(krView)
  }
  if (detail) {
    v.updates = (o.updates || []).map(u => updateView(u, users))
    v.scores = (o.scores || []).map(s => ({
      id: String(s.id), role: s.role, score: s.score, comment: s.comment, source: s.source, at: s.at,
      scorer: users.get(String(s.scorerId)) || { id: String(s.scorerId) },
      onBehalfOf: s.operatorId != null ? (users.get(String(s.operatorId)) || { id: String(s.operatorId) }) : null
    }))
    v.misses = (o.misses || []).map(m => ({
      id: String(m.id), reason: m.reason, createdAt: m.createdAt,
      carriedToCycleId: m.carriedToCycleId != null ? String(m.carriedToCycleId) : null,
      carriedToObjectiveId: m.carriedToObjId != null ? String(m.carriedToObjId) : null
    }))
  }
  return v
}

/** 某人某周的 OKR(含 KR、进展、评分历史) */
export async function personWeek(cycle, ownerId, { detail = true, updatesPerObjective = 30 } = {}) {
  const objectives = await prisma.okrObjective.findMany({
    where: { cycleId: cycle.id, ownerId: BigInt(ownerId) },
    orderBy: { seq: 'asc' },
    include: {
      keyResults: true,
      ...(detail ? {
        updates: { orderBy: { createdAt: 'desc' }, take: updatesPerObjective },
        scores: { orderBy: { at: 'desc' } },
        misses: { orderBy: { createdAt: 'desc' } }
      } : {})
    }
  })
  const userIds = [ownerId]
  for (const o of objectives) {
    userIds.push(o.operatorId)
    if (!detail) continue
    for (const u of o.updates) userIds.push(u.createdBy, u.operatorId)
    for (const s of o.scores) userIds.push(s.scorerId, s.operatorId)
  }
  const users = await loadUsers(userIds)
  const views = objectives.map(o => objectiveView(o, users, { detail }))
  return {
    cycle: cycleView(cycle),
    owner: users.get(String(ownerId)) || { id: String(ownerId) },
    personalStatus: personalStatus(cycle.status, objectives),
    completion: r4(personProgress(objectives)),
    selfScore: weightedScore(objectives, 'selfScore'),
    managerScore: weightedScore(objectives, 'managerScore'),
    objectives: views
  }
}

// ---------------------------------------------------------------- 计划

/**
 * 保存计划(草稿)或提交。整份覆盖: 传进来的就是这周的全部 O/KR。
 * - 带 id 的更新, 不带的新建, 没传的删除(已有进展/评分的不许删, 提示改成 DROPPED)
 * - 已提交过的人再保存也按提交标准校验, 免得提交后把权重改坏
 * - 提交: 未提交的 O 打上 submittedAt; 过了周一 24:00 记 lateSubmit, 不拦
 * - 同一周反复提交不会产生第二个周期(周期按 year+weekNo 唯一)
 */
export async function savePlan({ ownerId, operatorId = null, week, objectives, submit = false, now = new Date() }) {
  const cycle = await getCycle(week, { create: true, now })
  if (!isEditable(cycle.status)) throw forbidden(READ_ONLY_MSG)
  const owner = BigInt(ownerId)
  // 代管留痕: 他人代为保存/提交记操作人; 本人自己保存时清空
  const operator = operatorId != null && String(operatorId) !== String(ownerId) ? BigInt(operatorId) : null

  return prisma.$transaction(async (tx) => {
    const existing = await tx.okrObjective.findMany({
      where: { cycleId: cycle.id, ownerId: owner },
      include: { keyResults: true, _count: { select: { updates: true, scores: true, misses: true } } }
    })
    const alreadySubmitted = existing.some(o => o.submittedAt)
    const plan = normalizePlan(objectives, { strict: submit || alreadySubmitted })

    const byId = new Map(existing.map(o => [String(o.id), o]))
    const keepIds = new Set(plan.filter(o => o.id).map(o => o.id))
    for (const o of plan) {
      if (o.id && !byId.has(o.id)) throw new OkrRuleError(`O ${o.id} 不是${operator ? '此人' : '你'}这周的`, { code: 8101 })
    }

    // 删除: 没出现在新计划里的 O
    for (const old of existing) {
      if (keepIds.has(String(old.id))) continue
      const c = old._count
      if (c.updates || c.scores || c.misses) {
        throw conflict(`「${old.title}」已有进展或评分记录, 不能删除; 不做了可以把它的状态改成 DROPPED`)
      }
      await tx.okrKeyResult.deleteMany({ where: { objectiveId: old.id } })
      await tx.okrObjective.delete({ where: { id: old.id } })
    }

    // 迟交按被操作人这一周的截止判定(周期即被操作人的周期), 与谁点的提交无关
    const late = isLate(cycle.startDate, now)
    for (const o of plan) {
      const live = o.status !== 'DROPPED'
      const submitFields = submit && live ? { submittedAt: now, lateSubmit: late, submittedByOperator: operator != null } : {}
      let objId
      if (o.id) {
        const old = byId.get(o.id)
        objId = old.id
        await tx.okrObjective.update({
          where: { id: objId },
          data: {
            seq: o.seq, title: o.title, description: o.description, weight: o.weight, status: o.status,
            operatorId: operator,
            // 已提交的保留第一次的提交时间与迟交标记
            ...(old.submittedAt ? {} : submitFields)
          }
        })
        const oldKrs = new Map(old.keyResults.map(k => [String(k.id), k]))
        const keepKr = new Set(o.keyResults.filter(k => k.id).map(k => k.id))
        for (const k of o.keyResults) {
          if (k.id && !oldKrs.has(k.id)) throw new OkrRuleError(`KR ${k.id} 不属于「${o.title}」`, { code: 8102 })
        }
        for (const ok of old.keyResults) {
          if (keepKr.has(String(ok.id))) continue
          const n = await tx.okrUpdate.count({ where: { krId: ok.id } })
          if (n) throw conflict(`KR「${ok.title}」已有进展记录, 不能删除`)
          await tx.okrKeyResult.delete({ where: { id: ok.id } })
        }
        for (const k of o.keyResults) {
          if (k.id) {
            const ok = oldKrs.get(k.id)
            // 当前值/状态的变化走「追加进展」留痕, 计划里只改定义; 类型变了状态不相容就清掉
            let status = ok.status
            try { checkKrStatus(k.metricType, status) } catch { status = k.metricType === 'BINARY' ? null : 'ON_TRACK' }
            if (status == null && k.metricType !== 'BINARY') status = 'ON_TRACK'
            await tx.okrKeyResult.update({
              where: { id: ok.id },
              data: { seq: k.seq, title: k.title, metricType: k.metricType, unit: k.unit, targetValue: k.targetValue, weight: k.weight, status }
            })
          } else {
            await tx.okrKeyResult.create({ data: krData(objId, k) })
          }
        }
      } else {
        const created = await tx.okrObjective.create({
          data: {
            cycleId: cycle.id, ownerId: owner, seq: o.seq, title: o.title, description: o.description,
            weight: o.weight, status: o.status, operatorId: operator, ...submitFields
          }
        })
        objId = created.id
        for (const k of o.keyResults) await tx.okrKeyResult.create({ data: krData(objId, k) })
      }
      const fresh = await tx.okrObjective.findUnique({ where: { id: objId }, include: { keyResults: true } })
      const st = derivedObjectiveStatus(fresh)
      if (st !== fresh.status) await tx.okrObjective.update({ where: { id: objId }, data: { status: st } })
    }
    return { cycle, late: submit ? late : undefined }
  })
}

function krData(objectiveId, k) {
  return {
    objectiveId, seq: k.seq, title: k.title, metricType: k.metricType, unit: k.unit,
    targetValue: k.targetValue, currentValue: k.currentValue ?? 0, weight: k.weight, status: k.status
  }
}

// ---------------------------------------------------------------- 进展

async function loadObjective(objectiveId, db = prisma) {
  if (!/^\d+$/.test(String(objectiveId))) throw notFound('O 不存在')
  const o = await db.okrObjective.findUnique({ where: { id: BigInt(objectiveId) }, include: { cycle: true, keyResults: true } })
  if (!o) throw notFound('O 不存在')
  o.cycle = await syncStatus(o.cycle)
  return o
}

function assertOwner(o, userId, what = '只能改自己的 OKR') {
  if (String(o.ownerId) !== String(userId)) throw forbidden(what, 8109)
}

function assertWritable(o) {
  if (!isEditable(o.cycle.status)) throw forbidden(READ_ONLY_MSG)
  if (!o.submittedAt) throw conflict('这周的 OKR 还没提交, 先让本人在页面上提交计划', 8110)
  if (o.status === 'DROPPED') throw conflict(`「${o.title}」已放弃(DROPPED), 不再记进展`)
}

/** BINARY 的值只有 0/1, 并和状态联动 */
function binaryValue(v) {
  const n = Number(v)
  if (n !== 0 && n !== 1) throw new OkrRuleError('是/否型 KR 的值只能是 1(完成) 或 0(未完成)', { code: 8104 })
  return n
}

/**
 * 推进一条 KR 并写一条 OkrUpdate(过程数据只增不改)。
 * value / status 都可选, 至少给一个或给 content
 */
async function applyKrChange(tx, { o, kr, value, status, content, kind, source, sourceQuote, agentProfileId, userId, operatorId = null, now }) {
  const before = { value: kr.currentValue, status: kr.status }
  let newValue = kr.currentValue
  let newStatus = kr.status
  if (value !== undefined && value !== null && value !== '') {
    newValue = kr.metricType === 'BINARY' ? binaryValue(value) : Number(value)
    if (!Number.isFinite(newValue)) throw new OkrRuleError('数值不是数字', { code: 8104 })
    if (kr.metricType === 'BINARY' && (status === undefined || status === null || status === '')) {
      newStatus = newValue === 1 ? 'DONE' : (kr.status === 'MISSED' ? 'MISSED' : null)
    }
  }
  if (status !== undefined && status !== null && status !== '') {
    newStatus = checkKrStatus(kr.metricType, status)
    if (kr.metricType === 'BINARY') newValue = newStatus === 'DONE' ? 1 : 0
  }
  await tx.okrKeyResult.update({ where: { id: kr.id }, data: { currentValue: newValue, status: newStatus } })
  const text = String(content || '').trim() || autoContent(kr, before, { value: newValue, status: newStatus })
  const upd = await tx.okrUpdate.create({
    data: {
      cycleId: o.cycleId, objectiveId: o.id, krId: kr.id, date: shanghaiDate(now), kind,
      content: text.slice(0, 5000),
      valueBefore: before.value, valueAfter: newValue,
      statusBefore: before.status, statusAfter: newStatus,
      source, sourceQuote: sourceQuote ? String(sourceQuote).slice(0, 1000) : null,
      agentProfileId: agentProfileId ? BigInt(agentProfileId) : null,
      createdBy: BigInt(userId), operatorId: operatorId != null ? BigInt(operatorId) : null
    }
  })
  const fresh = await tx.okrObjective.findUnique({ where: { id: o.id }, include: { keyResults: true } })
  const st = derivedObjectiveStatus(fresh)
  if (st !== fresh.status) await tx.okrObjective.update({ where: { id: o.id }, data: { status: st } })
  return upd
}

function autoContent(kr, before, after) {
  const unit = kr.unit || ''
  const parts = []
  if (before.value !== after.value) parts.push(`当前值 ${before.value}${unit} → ${after.value}${unit}`)
  if (before.status !== after.status) parts.push(`状态 ${before.status || '未定'} → ${after.status || '未定'}`)
  return `「${kr.title}」${parts.join(', ') || '无变化'}`
}

/** 追加进展: 文字必填, 可挂到某条 KR 并同时推进它的数值 */
/**
 * userId = 实际操作人; ownerId = 被操作人(缺省 = userId)。ownerId ≠ userId 即主管代填,
 * 代管权限由路由层 resolveOkrTarget 校验, 这里只校验 O 确实属于被操作人
 */
const proxyOf = (ownerId, userId) => (ownerId != null && String(ownerId) !== String(userId) ? userId : null)

export async function appendUpdate({ objectiveId, userId, ownerId, content, krId, valueAfter, status, kind = 'MIDWEEK', source = 'MANUAL', sourceQuote, agentProfileId, now = new Date() }) {
  const o = await loadObjective(objectiveId)
  const operatorId = proxyOf(ownerId, userId)
  assertOwner(o, ownerId ?? userId, operatorId ? '这个 O 不属于目标员工' : '只能给自己的 OKR 追加进展')
  assertWritable(o)
  const text = String(content ?? '').trim()
  if (!text) throw new OkrRuleError('进展内容不能为空', { code: 8111 })
  if (!UPDATE_KINDS.includes(kind)) throw new OkrRuleError(`kind 只能是 ${UPDATE_KINDS.join('/')}`, { code: 8111 })
  const hasValue = valueAfter !== undefined && valueAfter !== null && valueAfter !== ''
  const hasStatus = status !== undefined && status !== null && status !== ''
  let kr = null
  if (krId != null && krId !== '') {
    kr = o.keyResults.find(k => String(k.id) === String(krId))
    if (!kr) throw new OkrRuleError('这条 KR 不属于这个 O', { code: 8102 })
  } else if (hasValue || hasStatus) {
    throw new OkrRuleError('要改数值或状态请指明是哪条 KR(krId)', { code: 8111 })
  }
  return prisma.$transaction(async (tx) => {
    if (kr && (hasValue || hasStatus)) {
      return applyKrChange(tx, { o, kr, value: valueAfter, status, content: text, kind, source, sourceQuote, agentProfileId, userId, operatorId, now })
    }
    return tx.okrUpdate.create({
      data: {
        cycleId: o.cycleId, objectiveId: o.id, krId: kr ? kr.id : null, date: shanghaiDate(now), kind,
        content: text.slice(0, 5000),
        valueBefore: kr ? kr.currentValue : null, valueAfter: kr ? kr.currentValue : null,
        source, sourceQuote: sourceQuote ? String(sourceQuote).slice(0, 1000) : null,
        agentProfileId: agentProfileId ? BigInt(agentProfileId) : null,
        createdBy: BigInt(userId), operatorId: operatorId != null ? BigInt(operatorId) : null
      }
    })
  })
}

/** 直接改 KR 当前值/状态(周中), 同样留一条 OkrUpdate */
export async function patchKr({ krId, userId, ownerId, currentValue, status, note, source = 'MANUAL', sourceQuote, agentProfileId, now = new Date() }) {
  if (!/^\d+$/.test(String(krId))) throw notFound('KR 不存在')
  const kr = await prisma.okrKeyResult.findUnique({ where: { id: BigInt(krId) } })
  if (!kr) throw notFound('KR 不存在')
  const o = await loadObjective(kr.objectiveId)
  const operatorId = proxyOf(ownerId, userId)
  assertOwner(o, ownerId ?? userId, operatorId ? '这条 KR 不属于目标员工' : '只能改自己的 KR')
  assertWritable(o)
  const hasValue = currentValue !== undefined && currentValue !== null && currentValue !== ''
  const hasStatus = status !== undefined && status !== null && status !== ''
  if (!hasValue && !hasStatus) throw new OkrRuleError('currentValue 和 status 至少给一个', { code: 8111 })
  return prisma.$transaction(tx => applyKrChange(tx, {
    o, kr, value: currentValue, status, content: note, kind: 'MIDWEEK', source, sourceQuote, agentProfileId, userId, operatorId, now
  }))
}

// ---------------------------------------------------------------- 评分

export async function scoreObjective({ objectiveId, userId, ownerId, role, score, comment, source = 'MANUAL' }) {
  const o = await loadObjective(objectiveId)
  const value = validScore(score)
  if (!isScorable(o.cycle.status)) {
    throw forbidden(o.cycle.status === 'CLOSED' ? '本周已归档, 评分需要主管先重开本周' : '计划阶段还不能评分, 进入周中后再评')
  }
  if (!o.submittedAt) throw conflict('这周的 OKR 还没提交, 先让本人在页面上提交计划', 8110)
  let operatorId = null
  if (role === 'SELF') {
    // 主管代改自评: 自评仍记在本人名下(scorerId = 本人), 操作人另记 operatorId
    operatorId = proxyOf(ownerId, userId)
    assertOwner(o, ownerId ?? userId, operatorId ? '这个 O 不属于目标员工' : '自评只能评自己的 O')
  } else if (String(o.ownerId) === String(userId)) {
    throw forbidden('不能给自己打主管分', 8109)
  }
  const text = comment ? String(comment).trim().slice(0, 500) : null
  return prisma.$transaction(async (tx) => {
    const s = await tx.okrScore.create({
      data: {
        cycleId: o.cycleId, objectiveId: o.id, scorerId: operatorId ? o.ownerId : BigInt(userId), role, score: value, comment: text, source,
        operatorId: operatorId != null ? BigInt(operatorId) : null
      }
    })
    await tx.okrObjective.update({
      where: { id: o.id },
      data: role === 'SELF' ? { selfScore: value } : { managerScore: value, managerComment: text }
    })
    return s
  })
}

// ---------------------------------------------------------------- 未达成

export async function markMiss({ objectiveId, userId, ownerId, reason, carryToNextWeek = false, now = new Date() }) {
  const o = await loadObjective(objectiveId)
  const operatorId = proxyOf(ownerId, userId)
  assertOwner(o, ownerId ?? userId, operatorId ? '这个 O 不属于目标员工' : '只能填自己的未达成原因')
  if (!isScorable(o.cycle.status)) throw forbidden(o.cycle.status === 'CLOSED' ? READ_ONLY_MSG : '计划阶段还不能标记未达成')
  if (!o.submittedAt) throw conflict('这周的 OKR 还没提交, 先让本人在页面上提交计划', 8110)
  if (['DONE', 'DROPPED'].includes(o.status)) throw conflict(`「${o.title}」状态是 ${o.status}, 不需要填未达成原因`)
  const text = String(reason ?? '').trim()
  if (!text) throw new OkrRuleError('请写未达成的原因', { code: 8112 })

  let nextCycle = null
  if (carryToNextWeek) {
    nextCycle = await getCycle(shiftWeek(o.cycle, 1), { create: true, anyWeek: true, now })
    if (!isEditable(nextCycle.status)) throw conflict('下周已经进入复盘或归档, 不能顺延过去')
  }

  return prisma.$transaction(async (tx) => {
    let carried = null
    if (nextCycle) {
      const theirs = await tx.okrObjective.findMany({ where: { cycleId: nextCycle.id, ownerId: o.ownerId, status: { not: 'DROPPED' } } })
      carried = await tx.okrObjective.create({
        data: {
          cycleId: nextCycle.id, ownerId: o.ownerId, seq: theirs.length + 1, title: o.title,
          description: [`顺延自 ${weekKey(o.cycle)}`, o.description].filter(Boolean).join('\n'),
          weight: 0, status: 'ON_TRACK'
        }
      })
      const krWeights = equalWeights(o.keyResults.length)
      const krs = [...o.keyResults].sort((a, b) => a.seq - b.seq)
      for (const [i, k] of krs.entries()) {
        await tx.okrKeyResult.create({
          data: {
            objectiveId: carried.id, seq: i + 1, title: k.title, metricType: k.metricType, unit: k.unit,
            targetValue: k.targetValue, currentValue: k.metricType === 'BINARY' ? 0 : k.currentValue,
            weight: k.weight ?? krWeights[i], status: k.metricType === 'BINARY' ? null : 'ON_TRACK'
          }
        })
      }
      // 下周还没提交: 草稿重新均分权重; 已提交: 顺延的这条权重 0、未提交, 需本人调权重后再提交
      if (!theirs.some(t => t.submittedAt)) {
        const all = [...theirs, carried]
        const ws = equalWeights(all.length)
        for (const [i, t] of all.entries()) await tx.okrObjective.update({ where: { id: t.id }, data: { weight: ws[i] } })
      }
    }
    const miss = await tx.okrMiss.create({
      data: {
        objectiveId: o.id, reason: text.slice(0, 1000), createdBy: BigInt(userId),
        carriedToCycleId: nextCycle ? nextCycle.id : null, carriedToObjId: carried ? carried.id : null
      }
    })
    await tx.okrObjective.update({ where: { id: o.id }, data: { status: 'MISSED' } })
    await tx.okrUpdate.create({
      data: {
        cycleId: o.cycleId, objectiveId: o.id, date: shanghaiDate(now), kind: 'FINAL',
        content: `未达成: ${text.slice(0, 900)}${nextCycle ? ` (已顺延到 ${weekKey(nextCycle)})` : ''}`,
        statusBefore: o.status, statusAfter: 'MISSED', source: 'MANUAL', createdBy: BigInt(userId),
        operatorId: operatorId != null ? BigInt(operatorId) : null
      }
    })
    return { miss, carried, nextCycle }
  })
}

// ---------------------------------------------------------------- 团队

/** 应该交 OKR 的人: 在职的 FDE 工程师; 主管/老板自己也交了的话一并列出 */
async function participants(cycleId) {
  const engineers = await prisma.user.findMany({
    where: { role: { in: ['FDE_ENGINEER', 'TEAM_LEAD'] }, status: 1, deletedAt: null },
    select: { id: true }
  })
  const owners = cycleId
    ? await prisma.okrObjective.findMany({ where: { cycleId }, select: { ownerId: true }, distinct: ['ownerId'] })
    : []
  return [...new Set([...engineers.map(e => String(e.id)), ...owners.map(o => String(o.ownerId))])]
}

function personSummary(cycle, objs) {
  const live = objs.filter(o => o.status !== 'DROPPED')
  const submitted = live.length > 0 && live.every(o => o.submittedAt)
  const krs = live.flatMap(o => o.keyResults)
  return {
    submitted,
    submission: submitted ? (live.some(o => o.lateSubmit) ? 'LATE' : 'ON_TIME') : 'NONE',
    objectiveCount: live.length,
    krTotal: krs.length,
    krDone: krs.filter(k => k.status === 'DONE').length,
    completion: submitted ? r4(personProgress(live)) : null,
    selfScore: weightedScore(live, 'selfScore'),
    managerScore: weightedScore(live, 'managerScore'),
    personalStatus: personalStatus(cycle.status, objs)
  }
}

export async function teamView(week, { now = new Date() } = {}) {
  const cur = isoWeekOf(now)
  const cycle = await getCycle(week, { create: compareWeek(week, cur) >= 0 && compareWeek(week, cur) <= 1, now })
  const ids = await participants(cycle?.id)
  const users = await loadUsers(ids)
  const objs = cycle
    ? await prisma.okrObjective.findMany({ where: { cycleId: cycle.id }, include: { keyResults: true } })
    : []
  const byOwner = new Map()
  for (const o of objs) {
    const k = String(o.ownerId)
    if (!byOwner.has(k)) byOwner.set(k, [])
    byOwner.get(k).push(o)
  }
  const rows = ids.filter(id => users.has(id)).map(id => ({
    user: users.get(id),
    ...(cycle ? personSummary(cycle, byOwner.get(id) || []) : { submitted: false, submission: 'NONE', objectiveCount: 0, krTotal: 0, krDone: 0, completion: null, selfScore: null, managerScore: null, personalStatus: 'NOT_SUBMITTED' })
  }))
  // 稳定排序: 未交的在前(主管先看到), 其余按名字
  const order = { NONE: 0, LATE: 1, ON_TIME: 2 }
  rows.sort((a, b) => order[a.submission] - order[b.submission] || String(a.user.name).localeCompare(String(b.user.name), 'zh'))

  const submittedRows = rows.filter(r => r.submitted)
  const avg = submittedRows.length
    ? r4(submittedRows.reduce((s, r) => s + (r.completion || 0), 0) / submittedRows.length)
    : null

  return {
    cycle: cycle ? cycleView(cycle, now) : { ...weekStub(week), status: null },
    summary: { expected: rows.length, submitted: submittedRows.length, late: rows.filter(r => r.submission === 'LATE').length, avgCompletion: avg },
    rows,
    lowStreak: await lowStreak(week, ids, users, now)
  }
}

function weekStub(week) {
  const { start, end } = weekRange(week.year, week.weekNo)
  return { year: week.year, weekNo: week.weekNo, key: weekKey(week), startDate: start, endDate: end, submitDeadline: submitDeadline(start) }
}

/**
 * 连续两周完成率 < 60% 的人(不排名): 取截至该周、已进入复盘或归档的最近两周,
 * 两周都交了计划且完成率都低于阈值才算。进行中的周不参与, 免得周二就把所有人都标出来
 */
async function lowStreak(week, ids, users, now) {
  const recent = await prisma.okrCycle.findMany({
    where: {
      status: { in: ['REVIEW', 'CLOSED'] },
      OR: [{ year: { lt: week.year } }, { year: week.year, weekNo: { lte: week.weekNo } }]
    },
    orderBy: [{ year: 'desc' }, { weekNo: 'desc' }],
    take: 2
  })
  if (recent.length < 2) return { weeks: recent.map(weekKey), people: [] }
  const objs = await prisma.okrObjective.findMany({
    where: { cycleId: { in: recent.map(c => c.id) } },
    include: { keyResults: true }
  })
  const people = []
  for (const id of ids) {
    const per = recent.map(c => {
      const mine = objs.filter(o => String(o.ownerId) === id && o.cycleId === c.id)
      return personSummary(c, mine)
    })
    if (per.every(p => p.submitted && p.completion != null && p.completion < LOW_COMPLETION) && users.has(id)) {
      people.push({ user: users.get(id), completions: per.map(p => p.completion) })
    }
  }
  return { weeks: recent.map(weekKey), people }
}

// ---------------------------------------------------------------- 历史

export async function history(ownerId, weeks = 12, { now = new Date() } = {}) {
  const n = Math.max(1, Math.min(52, Number(weeks) || 12))
  const cur = isoWeekOf(now)
  const keys = []
  for (let i = n - 1; i >= 0; i--) keys.push(shiftWeek(cur, -i))
  const cycles = await prisma.okrCycle.findMany({
    where: { OR: keys.map(k => ({ year: k.year, weekNo: k.weekNo })) }
  })
  const byKey = new Map(cycles.map(c => [weekKey(c), c]))
  const objs = cycles.length
    ? await prisma.okrObjective.findMany({ where: { cycleId: { in: cycles.map(c => c.id) }, ownerId: BigInt(ownerId) }, include: { keyResults: true } })
    : []
  const users = await loadUsers([ownerId])
  return {
    owner: users.get(String(ownerId)) || { id: String(ownerId) },
    weeks: keys.map(k => {
      const c = byKey.get(weekKey(k))
      if (!c) return { key: weekKey(k), year: k.year, weekNo: k.weekNo, status: null, submitted: false, completion: null, selfScore: null, managerScore: null, late: false }
      const s = personSummary(c, objs.filter(o => o.cycleId === c.id))
      return {
        key: weekKey(k), year: k.year, weekNo: k.weekNo, status: c.status,
        submitted: s.submitted, late: s.submission === 'LATE',
        completion: s.completion, selfScore: s.selfScore, managerScore: s.managerScore,
        objectiveCount: s.objectiveCount
      }
    })
  }
}

// ---------------------------------------------------------------- 归档 / 重开

/** 归档某一周。还没进入周五复盘的周不能提前归档 —— 重开过的周不受此限 */
export async function closeCycle(week, { by = null, now = new Date() } = {}) {
  const cycle = await getCycle(week, { now })
  if (!cycle) throw notFound(`${weekKey(week)} 没有 OKR 周期`)
  if (cycle.status === 'CLOSED') return { cycle, changed: false }
  const reopened = isReopened(cycle)
  if (!reopened && cycle.status !== 'REVIEW' && !['REVIEW', 'CLOSED'].includes(timeStatus(cycle, now))) {
    throw conflict(`${weekKey(week)} 还没到周五复盘, 不能提前归档`)
  }
  const updated = await prisma.okrCycle.update({
    where: { id: cycle.id },
    data: { status: 'CLOSED', closedAt: now, closedBy: by != null ? BigInt(by) : null }
  })
  return { cycle: updated, changed: true }
}

export async function reopenCycle(week, { by, now = new Date() }) {
  const cycle = await getCycle(week, { now })
  if (!cycle) throw notFound(`${weekKey(week)} 没有 OKR 周期`)
  if (!['REVIEW', 'CLOSED'].includes(cycle.status)) throw conflict('本周还在进行中, 不需要重开')
  const before = cycle.status
  const updated = await prisma.okrCycle.update({
    where: { id: cycle.id },
    data: { status: 'IN_PROGRESS', reopenedAt: now, reopenedBy: BigInt(by) }
  })
  return { cycle: updated, before }
}

/**
 * 定时任务: 保证本周周期存在(下周一自动生成新周期), 并把已过完、没被重开的周期归档。
 * 幂等, 可反复跑
 */
// 只扫最近 12 周过完的周期; 更早的(比如定时任务停过很久)在被读到时由 getCycle 顺手归档, 不会漏
const TICK_LOOKBACK_MS = 12 * 7 * 24 * 3600 * 1000

export async function okrTick(now = new Date()) {
  const current = await getCycle(isoWeekOf(now), { create: true, now })
  const stale = await prisma.okrCycle.findMany({
    where: { status: { not: 'CLOSED' }, endDate: { lt: now, gte: new Date(now.getTime() - TICK_LOOKBACK_MS) } }
  })
  let closed = 0
  for (const c of stale) {
    if (isReopened(c)) continue
    await prisma.okrCycle.update({ where: { id: c.id }, data: { status: 'CLOSED', closedAt: now, closedBy: null } })
    closed++
  }
  return { current: weekKey(current), currentStatus: current.status, closed }
}

// ---------------------------------------------------------------- 周一提醒

export const REMIND_HOUR = 10   // 周一 10:00(上海)之后第一次 tick 发
export const REMIND_TYPE = 'OKR_NOT_SUBMITTED'
export const REMIND_SUMMARY_TYPE = 'OKR_NOT_SUBMITTED_SUMMARY'

/**
 * 周一未提交提醒: 给本周还没交计划的在职 FDE 工程师各发一条站内通知, 给老板(ADMIN)发一条汇总。
 * 挂在 cron 的每小时 OKR tick 上: 只在上海时间周一 10:00 之后、本周周期为 PLANNING 时动作。
 * 幂等: 以通知表里同一周(data.week)的已发记录为准, 一周每人最多一条, 进程重启不重发。
 * dryRun=true 只算名单不发
 */
export async function okrMondayReminder(now = new Date(), { dryRun = false } = {}) {
  const wall = new Date(now.getTime() + 8 * 3600 * 1000)
  const week = isoWeekOf(now)
  const key = weekKey(week)
  if (wall.getUTCDay() !== 1 || wall.getUTCHours() < REMIND_HOUR) return { week: key, skipped: 'not-monday-10' }
  const cycle = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!cycle || cycle.status !== 'PLANNING') return { week: key, skipped: 'no-planning-cycle' }

  const engineers = await prisma.user.findMany({
    where: { role: { in: ['FDE_ENGINEER', 'TEAM_LEAD'] }, status: 1, deletedAt: null },
    select: { id: true, name: true, username: true },
    orderBy: { id: 'asc' }
  })
  const objs = await prisma.okrObjective.findMany({
    where: { cycleId: cycle.id, ownerId: { in: engineers.map(u => u.id) } },
    select: { ownerId: true, status: true, submittedAt: true }
  })
  const missing = engineers.filter(u => {
    const live = objs.filter(o => o.ownerId === u.id && o.status !== 'DROPPED')
    return !(live.length > 0 && live.every(o => o.submittedAt))
  })

  const data = { week: key }
  const dataStr = JSON.stringify(data)
  const already = new Set((await prisma.notification.findMany({
    where: { type: REMIND_TYPE, data: dataStr, userId: { in: missing.map(u => u.id) } },
    select: { userId: true }
  })).map(n => String(n.userId)))
  const toRemind = missing.filter(u => !already.has(String(u.id)))

  const admins = missing.length
    ? await prisma.user.findMany({ where: { role: 'ADMIN', status: 1, deletedAt: null }, select: { id: true } })
    : []
  const summarized = new Set((await prisma.notification.findMany({
    where: { type: REMIND_SUMMARY_TYPE, data: dataStr, userId: { in: admins.map(a => a.id) } },
    select: { userId: true }
  })).map(n => String(n.userId)))
  const bosses = admins.filter(a => !summarized.has(String(a.id)))

  const names = missing.map(u => u.name || u.username)
  const summaryBody = `本周 ${missing.length} 人未交：${names.join(' / ')}`
  if (!dryRun) {
    for (const u of toRemind) {
      await pushNotification({
        userId: u.id, type: REMIND_TYPE, channels: ['site'], data,
        title: '本周 OKR 还没提交',
        body: `${key} 的计划今天(周一)24:00 前提交, 过了截止仍可交, 但会记为迟交`,
        link: `/admin/okr?week=${key}`
      })
    }
    for (const a of bosses) {
      await pushNotification({
        userId: a.id, type: REMIND_SUMMARY_TYPE, channels: ['site'], data,
        title: `${key} OKR 未提交汇总`,
        body: summaryBody,
        link: `/admin/okr/team?week=${key}`
      })
    }
  }
  return { week: key, missing: names, reminded: toRemind.length, summarized: bosses.length }
}
