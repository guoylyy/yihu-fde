// OKR 9.0: 决策记录(okr_decisions)—— 主持决策时定下的事, 可挂 O / 项目 / 周期, 按时间线回看。
//
// 权限(路由只做转发, 全在这里校验):
//   读: 全员(决策对全员透明, 这是它存在的意义)。
//   写(新建): ADMIN / MANAGER 任意; 其他人只能挂在自己负责的 O 上(objective.ownerId = 自己), 不挂 O 或挂别人的 O → 403。
//   改(PATCH)/ 删(软删): ADMIN 任何时候; 作者本人(createdById)自创建起 7 天内; 其余 403。
//   取代(supersede): 只 ADMIN / MANAGER; 只有 ACTIVE 的能被取代, 新记录继承老记录的周期 / O / 项目。
//   PATCH 改成 REVERTED 必须同时写 rationale(8193)。SUPERSEDED 只能经 supersede 产生, PATCH 不能设也不能改回。
//
// 与 O 的关系: O 被删(savePlan 删掉没出现在新计划里的 O)时决策保留 —— detachDecisions 把 objectiveId 置空、
// detail 前加「[原 O 已删除]」; 绝不级联删除。O 视图带最近 3 条(decisionBriefsByObjective)。
//
// 错误码: 8190 参数 / 8191 无权限(403) / 8192 不存在(404) / 8193 撤销没写原因 / 8194 状态不允许(409)
import prisma from '../lib/prisma.js'
import { OkrRuleError, weekKey, weekRange, isoWeekOf, isDateKey, shanghaiDateKey } from './okrRules.js'
import { loadProject } from './okrProjectDocs.js'

export const DECISION_STATUSES = ['ACTIVE', 'SUPERSEDED', 'REVERTED']
export const EDIT_WINDOW_DAYS = 7
export const DETACHED_TAG = '[原 O 已删除]'
export const BRIEFS_PER_OBJECTIVE = 3
export const TITLE_MAX = 200
export const TEXT_MAX = 20000
export const PAGE_SIZE_MAX = 100
export const TIMELINE_MAX = 500

const WRITER_ROLES = new Set(['ADMIN', 'MANAGER'])
const DAY_MS = 24 * 3600 * 1000
const TZ = '+08:00'

const bad = msg => new OkrRuleError(msg, { code: 8190 })
const forbidden = msg => new OkrRuleError(msg, { status: 403, code: 8191 })
const notFound = (msg = '决策不存在') => new OkrRuleError(msg, { status: 404, code: 8192 })
const conflict = msg => new OkrRuleError(msg, { status: 409, code: 8194 })

const isAdmin = user => user?.role === 'ADMIN'
const isWriter = user => WRITER_ROLES.has(user?.role)
const sameId = (a, b) => a != null && b != null && String(a) === String(b)

function parseId(raw, what, { required = false } = {}) {
  if (raw == null || raw === '') {
    if (required) throw bad(`缺少 ${what}`)
    return null
  }
  if (!/^\d+$/.test(String(raw))) throw bad(`${what} 不合法`)
  return BigInt(raw)
}

function text(raw, what, { required = false, max = TEXT_MAX } = {}) {
  if (raw == null) {
    if (required) throw bad(`${what}不能为空`)
    return null
  }
  if (typeof raw !== 'string') throw bad(`${what}必须是文字`)
  const s = raw.trim()
  if (!s) {
    if (required) throw bad(`${what}不能为空`)
    return null
  }
  if (s.length > max) throw bad(`${what}超过 ${max} 字`)
  return s
}

/** 决策时间: ISO 时间 或 YYYY-MM-DD(按上海当天 00:00); 不传 = 现在 */
function parseDecidedAt(raw, now) {
  if (raw == null || raw === '') return now
  const s = String(raw).trim()
  const d = isDateKey(s) ? new Date(`${s}T00:00:00${TZ}`) : new Date(s)
  if (Number.isNaN(d.getTime())) throw bad('decidedAt 格式: ISO 时间或 YYYY-MM-DD')
  if (d.getTime() > now.getTime() + DAY_MS) throw bad('决策时间不能晚于明天')
  return d
}

/** YYYY-MM-DD → 上海当天 [00:00, 次日 00:00) 的 UTC 时刻 */
function dayStart(s, what) {
  if (!isDateKey(String(s))) throw bad(`${what} 格式: YYYY-MM-DD`)
  return new Date(`${s}T00:00:00${TZ}`)
}

function withinWindow(d, now) {
  return now.getTime() - new Date(d.createdAt).getTime() <= EDIT_WINDOW_DAYS * DAY_MS
}

/** 改 / 删: ADMIN 随时; 作者本人 7 天内 */
function canModify(user, d, now) {
  if (isAdmin(user)) return true
  return sameId(d.createdById, user?.id) && withinWindow(d, now)
}

// ---------------------------------------------------------------- 视图

async function namesOf(ids) {
  const uniq = [...new Set(ids.filter(v => v != null).map(String))].map(BigInt)
  if (!uniq.length) return new Map()
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, username: true } })
  return new Map(rows.map(u => [String(u.id), u.name || u.username]))
}

/** 批量补齐名字 / O 标题 / 项目名 / 周 */
async function decorate(rows, user, now) {
  const names = await namesOf(rows.flatMap(d => [d.decidedById, d.createdById]))
  const oids = [...new Set(rows.map(d => d.objectiveId).filter(v => v != null).map(String))].map(BigInt)
  const pids = [...new Set(rows.map(d => d.projectId).filter(v => v != null).map(String))].map(BigInt)
  const cids = [...new Set(rows.map(d => d.cycleId).filter(v => v != null).map(String))].map(BigInt)
  const [objs, projects, cycles] = await Promise.all([
    oids.length ? prisma.okrObjective.findMany({ where: { id: { in: oids } }, select: { id: true, title: true, ownerId: true } }) : [],
    pids.length ? prisma.project.findMany({ where: { id: { in: pids } }, select: { id: true, name: true, code: true, deletedAt: true } }) : [],
    cids.length ? prisma.okrCycle.findMany({ where: { id: { in: cids } }, select: { id: true, year: true, weekNo: true } }) : []
  ])
  const objMap = new Map(objs.map(o => [String(o.id), o]))
  const projMap = new Map(projects.map(p => [String(p.id), p]))
  const cycleMap = new Map(cycles.map(c => [String(c.id), c]))
  const ownerNames = await namesOf(objs.map(o => o.ownerId))
  return rows.map(d => {
    const o = d.objectiveId != null ? objMap.get(String(d.objectiveId)) : null
    const p = d.projectId != null ? projMap.get(String(d.projectId)) : null
    const c = d.cycleId != null ? cycleMap.get(String(d.cycleId)) : null
    return {
      id: String(d.id),
      cycleId: d.cycleId != null ? String(d.cycleId) : null,
      week: c ? weekKey(c) : null,
      objectiveId: d.objectiveId != null ? String(d.objectiveId) : null,
      objective: o ? { id: String(o.id), title: o.title, ownerId: String(o.ownerId), ownerName: ownerNames.get(String(o.ownerId)) || null } : null,
      projectId: d.projectId != null ? String(d.projectId) : null,
      project: p ? { id: String(p.id), code: p.code, name: p.name, deleted: !!p.deletedAt } : null,
      title: d.title,
      detail: d.detail,
      rationale: d.rationale,
      impact: d.impact,
      decidedById: String(d.decidedById),
      decidedByName: names.get(String(d.decidedById)) || null,
      decidedAt: d.decidedAt,
      date: shanghaiDateKey(d.decidedAt),
      status: d.status,
      supersededBy: d.supersededBy != null ? String(d.supersededBy) : null,
      createdById: String(d.createdById),
      createdByName: names.get(String(d.createdById)) || null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      can: user ? {
        edit: canModify(user, d, now),
        delete: canModify(user, d, now),
        supersede: isWriter(user) && d.status === 'ACTIVE'
      } : undefined
    }
  })
}

async function loadLive(id) {
  const did = parseId(id, '决策 id', { required: true })
  const d = await prisma.okrDecision.findFirst({ where: { id: did, deletedAt: null } })
  if (!d) throw notFound()
  return d
}

// ---------------------------------------------------------------- 写

/** 新建时的归属: O / 项目 / 周期都校验存在; 周期缺省取 O 的周期, 再缺省取决策时间所在周(已有周期才挂, 不新建) */
async function resolveLinks(user, b, decidedAt) {
  const objectiveId = parseId(b.objectiveId, 'objectiveId')
  const projectId = parseId(b.projectId, 'projectId')
  let cycleId = parseId(b.cycleId, 'cycleId')

  let objective = null
  if (objectiveId != null) {
    objective = await prisma.okrObjective.findUnique({ where: { id: objectiveId }, select: { id: true, ownerId: true, cycleId: true } })
    if (!objective) throw new OkrRuleError('O 不存在', { status: 404, code: 8192 })
  }
  // 普通工程师只能给自己负责的 O 写
  if (!isWriter(user)) {
    if (!objective) throw forbidden('只有管理员 / 主管能记管理决策; 你只能给自己负责的 O 记决策')
    if (!sameId(objective.ownerId, user.id)) throw forbidden('只能给自己负责的 O 记决策')
  }
  if (projectId != null) await loadProject(projectId)
  if (cycleId != null) {
    const c = await prisma.okrCycle.findUnique({ where: { id: cycleId }, select: { id: true } })
    if (!c) throw new OkrRuleError('周期不存在', { status: 404, code: 8192 })
    if (objective && objective.cycleId !== cycleId) throw bad('cycleId 与 O 所在的周不一致')
  } else if (objective) {
    cycleId = objective.cycleId
  } else {
    const w = isoWeekOf(decidedAt)
    const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: w.year, weekNo: w.weekNo } }, select: { id: true } })
    cycleId = c ? c.id : null
  }
  return { objectiveId, projectId, cycleId }
}

export async function createDecision(user, b = {}, { now = new Date() } = {}) {
  const title = text(b.title, '标题', { required: true, max: TITLE_MAX })
  const detail = text(b.detail, '详情', { required: true })
  const rationale = text(b.rationale, '理由')
  const impact = text(b.impact, '影响')
  const decidedAt = parseDecidedAt(b.decidedAt, now)
  const links = await resolveLinks(user, b, decidedAt)
  const d = await prisma.okrDecision.create({
    data: {
      ...links, title, detail, rationale, impact, decidedAt,
      decidedById: BigInt(user.id), createdById: BigInt(user.id), status: 'ACTIVE'
    }
  })
  return (await decorate([d], user, now))[0]
}

const PATCHABLE = ['title', 'detail', 'rationale', 'impact', 'status']

export async function patchDecision(user, id, b = {}, { now = new Date() } = {}) {
  const d = await loadLive(id)
  if (!canModify(user, d, now)) {
    throw forbidden(sameId(d.createdById, user?.id) ? `决策创建超过 ${EDIT_WINDOW_DAYS} 天, 只有管理员能改` : '只有作者本人(7 天内)或管理员能改这条决策')
  }
  const data = {}
  if ('title' in b) data.title = text(b.title, '标题', { required: true, max: TITLE_MAX })
  if ('detail' in b) data.detail = text(b.detail, '详情', { required: true })
  if ('rationale' in b) data.rationale = text(b.rationale, '理由')
  if ('impact' in b) data.impact = text(b.impact, '影响')
  if ('status' in b && b.status !== d.status) {
    const s = String(b.status ?? '').toUpperCase()
    if (!DECISION_STATUSES.includes(s)) throw bad('status 只能是 ACTIVE / REVERTED')
    if (s === 'SUPERSEDED') throw bad('被取代请用 POST /decisions/:id/supersede 记一条新决策')
    if (d.status === 'SUPERSEDED') throw conflict('这条决策已被取代, 不能再改状态')
    if (s === 'REVERTED' && !text(b.rationale, '理由')) throw new OkrRuleError('撤销决策必须写明原因', { code: 8193 })
    data.status = s
  }
  if (!Object.keys(data).length) throw bad(`没有要改的字段(可改: ${PATCHABLE.join(' / ')})`)
  const next = await prisma.okrDecision.update({ where: { id: d.id }, data })
  return { before: d, decision: (await decorate([next], user, now))[0], changed: Object.keys(data) }
}

/** 取代: 新记一条(继承老记录的周期 / O / 项目), 老记录置 SUPERSEDED + supersededBy; 一个事务里做 */
export async function supersedeDecision(user, id, b = {}, { now = new Date() } = {}) {
  if (!isWriter(user)) throw forbidden('只有管理员 / 主管能取代决策')
  const title = text(b.title, '标题', { required: true, max: TITLE_MAX })
  const detail = text(b.detail, '详情', { required: true })
  const rationale = text(b.rationale, '理由')
  const impact = text(b.impact, '影响')
  const decidedAt = parseDecidedAt(b.decidedAt, now)
  const old = await loadLive(id)
  const created = await prisma.$transaction(async (tx) => {
    // 条件更新防并发: 两个人同时取代同一条, 只有一个成功
    const fresh = await tx.okrDecision.create({
      data: {
        cycleId: old.cycleId, objectiveId: old.objectiveId, projectId: old.projectId,
        title, detail, rationale, impact, decidedAt,
        decidedById: BigInt(user.id), createdById: BigInt(user.id), status: 'ACTIVE'
      }
    })
    const r = await tx.okrDecision.updateMany({
      where: { id: old.id, status: 'ACTIVE', deletedAt: null },
      data: { status: 'SUPERSEDED', supersededBy: fresh.id }
    })
    if (!r.count) throw conflict(old.status === 'ACTIVE' ? '这条决策刚被别人改过, 刷新后再试' : `只有生效中的决策能被取代(当前 ${old.status})`)
    return fresh
  })
  const oldNow = await prisma.okrDecision.findUnique({ where: { id: old.id } })
  const [nv, ov] = await decorate([created, oldNow], user, now)
  return { decision: nv, superseded: ov }
}

export async function deleteDecision(user, id, { now = new Date() } = {}) {
  const d = await loadLive(id)
  if (!canModify(user, d, now)) {
    throw forbidden(sameId(d.createdById, user?.id) ? `决策创建超过 ${EDIT_WINDOW_DAYS} 天, 只有管理员能删` : '只有作者本人(7 天内)或管理员能删这条决策')
  }
  await prisma.okrDecision.update({ where: { id: d.id }, data: { deletedAt: now, deletedById: BigInt(user.id) } })
  return { id: String(d.id), deleted: true, before: d }
}

// ---------------------------------------------------------------- 读

export async function getDecision(user, id, { now = new Date() } = {}) {
  const d = await loadLive(id)
  const [view] = await decorate([d], user, now)
  // 取代链: 它取代了谁(可能多条历史里只有一条直接前任) / 它被谁取代
  const prev = await prisma.okrDecision.findFirst({ where: { supersededBy: d.id, deletedAt: null }, select: { id: true, title: true, decidedAt: true } })
  const next = d.supersededBy != null
    ? await prisma.okrDecision.findFirst({ where: { id: d.supersededBy, deletedAt: null }, select: { id: true, title: true, decidedAt: true } })
    : null
  const brief = r => (r ? { id: String(r.id), title: r.title, decidedAt: r.decidedAt } : null)
  return { ...view, supersedes: brief(prev), supersededByDecision: brief(next) }
}

/** 列表: ?week=&objectiveId=&projectId=&q=&status=&page=&size=; 按决策时间倒序 */
export async function listDecisions(user, query = {}, { week = null, now = new Date() } = {}) {
  const and = [{ deletedAt: null }]
  if (week) {
    // 本周的决策: 挂在这一周周期上的, 或决策时间落在这一周的(没挂周期的管理决策)
    const { start, end } = weekRange(week.year, week.weekNo)
    const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } }, select: { id: true } })
    and.push({ OR: [...(c ? [{ cycleId: c.id }] : []), { decidedAt: { gte: start, lte: end } }] })
  }
  const oid = parseId(query.objectiveId, 'objectiveId')
  if (oid != null) and.push({ objectiveId: oid })
  const pid = parseId(query.projectId, 'projectId')
  if (pid != null) and.push({ projectId: pid })
  if (query.status) {
    const s = String(query.status).toUpperCase()
    if (!DECISION_STATUSES.includes(s)) throw bad('status 只能是 ACTIVE / SUPERSEDED / REVERTED')
    and.push({ status: s })
  }
  const q = String(query.q ?? '').trim()
  if (q) {
    if (q.length > 100) throw bad('搜索词超过 100 字')
    and.push({ OR: [{ title: { contains: q } }, { detail: { contains: q } }] })
  }
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const size = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(query.size ?? query.page_size, 10) || 20))
  const where = { AND: and }
  const [total, rows] = await Promise.all([
    prisma.okrDecision.count({ where }),
    prisma.okrDecision.findMany({ where, orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * size, take: size })
  ])
  return { list: await decorate(rows, user, now), total, page, size, week: week ? weekKey(week) : null }
}

/** 时间线: ?from=YYYY-MM-DD&to=YYYY-MM-DD&projectId=; 两端都含当天(上海时区); 按 decidedAt 倒序, 被取代 / 撤销的也在 */
export async function decisionTimeline(user, query = {}, { now = new Date() } = {}) {
  const and = [{ deletedAt: null }]
  const from = query.from ? dayStart(query.from, 'from') : null
  const toStart = query.to ? dayStart(query.to, 'to') : null
  if (from && toStart && from > toStart) throw bad('from 不能晚于 to')
  if (from) and.push({ decidedAt: { gte: from } })
  if (toStart) and.push({ decidedAt: { lt: new Date(toStart.getTime() + DAY_MS) } })
  const pid = parseId(query.projectId, 'projectId')
  if (pid != null) and.push({ projectId: pid })
  const where = { AND: and }
  const [total, rows] = await Promise.all([
    prisma.okrDecision.count({ where }),
    prisma.okrDecision.findMany({ where, orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }], take: TIMELINE_MAX })
  ])
  const list = await decorate(rows, user, now)
  // 按上海日期分组(已是倒序, 分组顺序跟着走)
  const days = []
  for (const d of list) {
    if (!days.length || days[days.length - 1].date !== d.date) days.push({ date: d.date, items: [] })
    days[days.length - 1].items.push(d)
  }
  return { from: query.from || null, to: query.to || null, total, truncated: total > list.length, list, days }
}

// ---------------------------------------------------------------- 给 O 视图 / savePlan 用

/** 每个 O 最近 3 条决策(决策时间倒序): Map<objectiveId, [{id, title, decidedAt, decidedByName, status}]> */
export async function decisionBriefsByObjective(objectiveIds, { limit = BRIEFS_PER_OBJECTIVE } = {}) {
  const ids = [...new Set(objectiveIds.filter(v => v != null).map(String))].map(BigInt)
  const out = new Map()
  if (!ids.length) return out
  const rows = await prisma.okrDecision.findMany({
    where: { objectiveId: { in: ids }, deletedAt: null },
    orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, objectiveId: true, title: true, decidedAt: true, decidedById: true, status: true }
  })
  const kept = []
  for (const r of rows) {
    const k = String(r.objectiveId)
    if (!out.has(k)) out.set(k, [])
    if (out.get(k).length >= limit) continue
    out.get(k).push(r)
    kept.push(r)
  }
  const names = await namesOf(kept.map(r => r.decidedById))
  for (const [k, list] of out) {
    out.set(k, list.map(r => ({ id: String(r.id), title: r.title, decidedAt: r.decidedAt, decidedByName: names.get(String(r.decidedById)) || null, status: r.status })))
  }
  return out
}

/** O 被删时调用(在 savePlan 的事务里): 决策保留, objectiveId 置空, detail 前加「[原 O 已删除]」与原 O 标题。不级联删除 */
export async function detachDecisions(tx, objective) {
  const prefix = `${DETACHED_TAG}「${objective.title}」\n`
  return tx.$executeRaw`UPDATE okr_decisions SET objective_id = NULL, detail = CONCAT(${prefix}, detail), updated_at = CURRENT_TIMESTAMP(3) WHERE objective_id = ${objective.id}`
}
