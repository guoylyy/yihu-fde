// 以虎 One 首页数据卡片用的小接口: 以本人身份、按本人数据范围取数, 结果小而直接
//   数字类返回 { total }; 列表 / 趋势返回 { list }(扁平对象, 首页最多显示 8~10 行)
// 对应的 MCP 工具在 mcp/tools.js 里标了 card: true(返回 structuredContent, 平台卡片直接用)
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, buildScopeWhere, hasPermission } from '../../lib/auth.js'
import { computeHealthForProjects, HEALTH_ACTIVE_STATUSES } from '../../services/projectHealth.js'

const router = express.Router()
router.use(internalAuth)

const OPEN = ['TODO', 'QUEUED', 'IN_PROGRESS']
const DAY = 86400_000
const limitOf = (q, d = 8) => Math.min(Math.max(Number(q.limit) || d, 1), 20)
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const STATUS_TEXT = { TODO: '收件箱', QUEUED: '等候生产', IN_PROGRESS: '生产中', DONE: '生产完成', VERIFIED: '已验收' }

async function myEngineerId(req) {
  if (req.user.engineerId) return BigInt(req.user.engineerId)
  const e = await prisma.engineer.findUnique({ where: { userId: BigInt(req.user.userId) }, select: { id: true } })
  return e?.id ?? null
}

/**
 * 本周一(服务器所在日历日), 表示成 UTC 0 点 —— 工时日期 / 截止日这类只有日期的字段都存成那天的 UTC 0 点,
 * 用同一口径比较才不会在西半球的服务器上差一天
 */
function weekStart(d = new Date()) {
  const m = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7))
  return m
}
/** 只有日期的字段所在那周的周一(UTC 0 点) */
function weekStartOfDay(d) {
  const m = new Date(d)
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7))
  return m
}
const todayAsDay = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) }

const wrap = (fn) => async (req, res) => {
  try {
    res.json({ code: 0, data: await fn(req) })
  } catch (e) {
    console.error('[cards]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
}

// 我手上还没做完的任务数
router.get('/my-open-task-count', wrap(async (req) => {
  const eid = await myEngineerId(req)
  if (!eid) return { total: 0 }
  return { total: await prisma.task.count({ where: { assigneeId: eid, status: { in: OPEN }, deletedAt: null, archivedAt: null } }) }
}))

// 我的待办任务: 生产中的在前, 再按截止日
router.get('/my-tasks', wrap(async (req) => {
  const eid = await myEngineerId(req)
  if (!eid) return { list: [] }
  const rows = await prisma.task.findMany({
    where: { assigneeId: eid, status: { in: OPEN }, deletedAt: null, archivedAt: null },
    select: { id: true, title: true, status: true, dueDate: true, plannedEndAt: true, project: { select: { name: true } } },
    take: 50
  })
  const due = (t) => t.dueDate || t.plannedEndAt
  rows.sort((a, b) => (a.status === 'IN_PROGRESS' ? 0 : 1) - (b.status === 'IN_PROGRESS' ? 0 : 1) ||
    (due(a)?.getTime() ?? Infinity) - (due(b)?.getTime() ?? Infinity))
  return { list: rows.slice(0, limitOf(req.query)).map(t => ({ title: t.title, project: t.project?.name, status: STATUS_TEXT[t.status] || t.status, due: ymd(due(t)) })) }
}))

// 我本周报了多少工时(不含已驳回)
router.get('/my-week-hours', wrap(async (req) => {
  const eid = await myEngineerId(req)
  if (!eid) return { total: 0 }
  const r = await prisma.timesheet.aggregate({
    where: { engineerId: eid, deletedAt: null, status: { not: 'REJECTED' }, workDate: { gte: weekStart() } },
    _sum: { hours: true }
  })
  return { total: Number(r._sum.hours || 0) }
}))

// 我最近几周每周工时(折线: x = week, y = hours)
router.get('/my-hours-trend', wrap(async (req) => {
  const eid = await myEngineerId(req)
  const weeks = Math.min(Math.max(Number(req.query.weeks) || 8, 2), 26)
  const start = new Date(weekStart().getTime() - (weeks - 1) * 7 * DAY)
  const buckets = Array.from({ length: weeks }, (_, i) => ({ week: ymd(new Date(start.getTime() + i * 7 * DAY + 12 * 3600_000)), hours: 0 }))
  if (!eid) return { list: buckets }
  const rows = await prisma.timesheet.findMany({
    where: { engineerId: eid, deletedAt: null, status: { not: 'REJECTED' }, workDate: { gte: start } },
    select: { workDate: true, hours: true }
  })
  for (const r of rows) {
    const i = Math.round((weekStartOfDay(r.workDate).getTime() - start.getTime()) / (7 * DAY))
    if (buckets[i]) buckets[i].hours += Number(r.hours)
  }
  return { list: buckets.map(b => ({ ...b, hours: Math.round(b.hours * 10) / 10 })) }
}))

// 等我审批的工时(经理 / 管理员; 范围 = 我能看到的项目)
router.get('/pending-approvals', wrap(async (req) => {
  if (!hasPermission(req.user, 'timesheet.approve')) return { total: 0, list: [] }
  const scope = await buildScopeWhere(req.user, 'project')
  const where = { deletedAt: null, status: 'SUBMITTED', ...(Object.keys(scope).length ? { project: { deletedAt: null, ...scope } } : {}) }
  const [total, rows] = await Promise.all([
    prisma.timesheet.count({ where }),
    prisma.timesheet.findMany({
      where, orderBy: { workDate: 'asc' }, take: limitOf(req.query),
      select: { workDate: true, hours: true, project: { select: { name: true } }, engineer: { select: { user: { select: { name: true } } } } }
    })
  ])
  return { total, list: rows.map(t => ({ name: `${t.engineer?.user?.name || ''} · ${ymd(t.workDate)} · ${Number(t.hours)}h`, engineer: t.engineer?.user?.name, date: ymd(t.workDate), hours: Number(t.hours), project: t.project?.name })) }
}))

// 进行中项目的健康度(红的在前)
router.get('/project-health', wrap(async (req) => {
  const scope = await buildScopeWhere(req.user, 'project')
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, status: { in: HEALTH_ACTIVE_STATUSES }, ...scope },
    select: { id: true, name: true, progress: true }, take: 100
  })
  const health = await computeHealthForProjects(projects.map(p => p.id))
  const rank = { RED: 0, YELLOW: 1, GREEN: 2 }
  const text = { RED: '风险', YELLOW: '关注', GREEN: '正常' }
  return {
    list: projects
      .map(p => ({ project: p.name, light: health.get(String(p.id))?.light || 'GREEN', progress: p.progress }))
      .sort((a, b) => rank[a.light] - rank[b.light] || a.progress - b.progress)
      .slice(0, limitOf(req.query))
      .map(p => ({ name: `${p.project}（${text[p.light]}，${p.progress}%）`, project: p.project, health: text[p.light], progress: p.progress }))
  }
}))

// 逾期没完成的任务(范围 = 我能看到的项目; 逾期最久的在前)
router.get('/overdue-tasks', wrap(async (req) => {
  const scope = await buildScopeWhere(req.user, 'project')
  const today = todayAsDay()
  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null, archivedAt: null, status: { in: OPEN }, dueDate: { lt: today },
      ...(Object.keys(scope).length ? { project: { deletedAt: null, ...scope } } : {})
    },
    orderBy: { dueDate: 'asc' }, take: limitOf(req.query),
    select: { title: true, dueDate: true, project: { select: { name: true } } }
  })
  return { list: rows.map(t => ({ title: t.title, project: t.project?.name, due: ymd(t.dueDate), overdueDays: Math.floor((today - t.dueDate) / DAY) })) }
}))

export default router
