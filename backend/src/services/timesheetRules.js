// 工时规则: 录入校验、谁能改 / 删 / 审批、审批人是谁、待审批通知
// 路由(routes/fde/timesheets.js)和 MCP 都走这里, 口径一致
import prisma from '../lib/prisma.js'
import { pushNotification } from '../lib/notify.js'
import { isArchivedStatus } from './projectArchive.js'
import { isProjectInScope } from '../routes/fde/projects.js'

export const MAX_DAY_HOURS = 24
const DAY = 86400000

/** 'YYYY-MM-DD' 或 Date → 当天 0 点(UTC); 非法返回 null */
export function parseWorkDate(v) {
  if (!v) return null
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 单条工时的字段校验(纯函数); 返回错误文案或 null
 * 日期不能晚于明天(按 UTC 日期留一天, 兼容东西时区), 时长 (0, 24]
 */
export function checkEntry({ workDate, hours }, now = new Date()) {
  if (hours !== undefined) {
    const h = Number(hours)
    if (!Number.isFinite(h) || h <= 0) return '工时须大于 0'
    if (h > MAX_DAY_HOURS) return `一条工时不能超过 ${MAX_DAY_HOURS} 小时`
  }
  if (workDate !== undefined) {
    const d = parseWorkDate(workDate)
    if (!d) return '日期格式不对，应为 YYYY-MM-DD'
    const latest = parseWorkDate(new Date(now.getTime() + DAY))
    if (d > latest) return '不能给未来的日期报工时'
  }
  return null
}

/** 同一个人同一天(除去已驳回 / 删除的, 和正在改的这条)合计不超过 24 小时 */
export async function checkDayTotal(engineerId, workDate, hours, excludeId = null) {
  const agg = await prisma.timesheet.aggregate({
    where: {
      engineerId: BigInt(engineerId), workDate, deletedAt: null, status: { not: 'REJECTED' },
      ...(excludeId ? { id: { not: BigInt(excludeId) } } : {})
    },
    _sum: { hours: true }
  })
  const total = Number(agg._sum.hours || 0) + Number(hours)
  return total > MAX_DAY_HOURS ? `这一天已报 ${Number(agg._sum.hours || 0)} 小时，再加 ${Number(hours)} 小时会超过 ${MAX_DAY_HOURS} 小时` : null
}

/** 已关闭 / 归档的项目不能再报工时 */
export async function projectOpenForHours(projectId) {
  const p = await prisma.project.findUnique({ where: { id: BigInt(projectId) }, select: { status: true, deletedAt: true } })
  if (!p || p.deletedAt) return '项目不存在'
  if (isArchivedStatus(p.status)) return '项目已关闭，不能再报工时'
  return null
}

const isManagerRole = (user) => ['ADMIN', 'MANAGER'].includes(user?.role)

/** 这条工时是不是我的 */
export async function isOwnTimesheet(user, ts) {
  const me = await prisma.engineer.findUnique({ where: { userId: BigInt(user.userId ?? user.id) }, select: { id: true } })
  return !!me && String(me.id) === String(ts.engineerId)
}

/** 能不能改 / 删这条: 本人, 或项目在自己范围内的经理 / 管理员 */
export async function canManageTimesheet(user, ts) {
  if (await isOwnTimesheet(user, ts)) return true
  return isManagerRole(user) && await isProjectInScope(user, ts.projectId)
}

/**
 * 能不能审批这条: 项目在自己范围内, 且不是自己的工时(管理员除外, 留审计)
 * 返回错误文案或 null
 */
export async function approvalBlocked(user, ts) {
  if (!(await isProjectInScope(user, ts.projectId))) return { status: 404, message: '工时不存在' }
  if (user.role !== 'ADMIN' && await isOwnTimesheet(user, ts)) return { status: 403, message: '不能审批自己的工时，请让其他经理或管理员审批' }
  if (!['SUBMITTED', 'DRAFT'].includes(ts.status)) return { status: 400, message: `这条工时已${ts.status === 'APPROVED' ? '批准' : '驳回'}，不能重复审批` }
  return null
}

/**
 * 项目的审批人(本系统用户 id): 项目负责人 → 项目里的 PM 成员 → 创建人(经理 / 管理员) → 全部管理员
 * 排除提交人自己
 */
export async function approversFor(projectId, excludeUserId) {
  const p = await prisma.project.findUnique({
    where: { id: BigInt(projectId) },
    select: {
      managerId: true, createdBy: true,
      members: { where: { roleInProject: 'PM' }, select: { userId: true, engineer: { select: { userId: true } } } }
    }
  })
  if (!p) return []
  const skip = excludeUserId != null ? String(excludeUserId) : null
  const pick = (ids) => [...new Set(ids.filter(Boolean).map(String))].filter(id => id !== skip)
  let ids = pick([p.managerId, ...p.members.map(m => m.userId ?? m.engineer?.userId)])
  if (!ids.length && p.createdBy) {
    const creator = await prisma.user.findUnique({ where: { id: p.createdBy }, select: { role: true, status: true } })
    if (creator?.status === 1 && isManagerRole(creator)) ids = pick([p.createdBy])
  }
  if (!ids.length) {
    ids = pick((await prisma.user.findMany({ where: { role: 'ADMIN', status: 1, deletedAt: null }, select: { id: true } })).map(u => u.id))
  }
  return ids
}

/** 工时进了待审批: 按项目汇总通知审批人(必看) */
export async function notifyPending(rows, submitterUserId, submitterName = '') {
  const byProject = new Map()
  for (const r of rows) {
    const k = String(r.projectId)
    if (!byProject.has(k)) byProject.set(k, { name: r.project?.name || '', count: 0, hours: 0 })
    const g = byProject.get(k)
    g.count++
    g.hours += Number(r.hours || 0)
  }
  for (const [projectId, g] of byProject) {
    for (const userId of await approversFor(projectId, submitterUserId)) {
      await pushNotification({
        userId, actorId: submitterUserId, type: 'TIMESHEET_PENDING',
        title: '⏳ 有工时待你审批',
        body: `${submitterName} · ${g.name} · ${g.count} 条共 ${Number(g.hours.toFixed(1))}h`,
        link: '/admin/timesheets?status=SUBMITTED'
      }).catch(e => console.error('[timesheet pending notify]', e.message))
    }
  }
}
