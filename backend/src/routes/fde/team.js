// 0.5.0 团队视图(成员卡片 / 负载): 一个接口给两页用
//   GET /api/fde/team/overview   工程师池(FDE_ENGINEER/MANAGER)每人的档案摘要 + 手上任务负载
// 权限: 暂按 engineer.view(默认 ADMIN/MANAGER), 第 4 轮再细化到组长只看本组
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { ENGINEER_ROLES } from '../../lib/engineerRoles.js'
import { getTeamsByUserIds } from '../../lib/teams.js'
import { loadLevel, OPEN_TASK_STATUSES } from '../../lib/teamLoad.js'
import { ARCHIVED_STATUSES } from '../../services/projectArchive.js'

const router = express.Router()
router.use(internalAuth)

function dayStart(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function mondayOf(d = new Date()) {
  const x = dayStart(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

router.get('/overview', requirePermission('engineer.view'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: ENGINEER_ROLES }, deletedAt: null, status: 1 },
      orderBy: { id: 'asc' },
      select: { id: true, username: true, name: true, role: true, avatarUrl: true, lastLoginAt: true }
    })
    const userIds = users.map(u => u.id)
    const engineers = userIds.length ? await prisma.engineer.findMany({
      where: { userId: { in: userIds }, deletedAt: null },
      select: { id: true, userId: true, level: true, city: true, skills: true, available: true }
    }) : []
    const engIds = engineers.map(e => e.id)
    const today = dayStart()
    const in7 = new Date(today.getTime() + 7 * 86400000)
    const weekStart = mondayOf()
    const since7 = new Date(Date.now() - 7 * 86400000)
    const openWhere = { assigneeId: { in: engIds }, deletedAt: null, archivedAt: null, status: { in: OPEN_TASK_STATUSES } }

    const [byStatus, overdue, dueSoon, hot, doneWeek, members, convs, teamMap] = engIds.length ? await Promise.all([
      prisma.task.groupBy({ by: ['assigneeId', 'status'], where: openWhere, _count: { _all: true } }),
      prisma.task.groupBy({ by: ['assigneeId'], where: { ...openWhere, dueDate: { lt: today } }, _count: { _all: true } }),
      prisma.task.groupBy({ by: ['assigneeId'], where: { ...openWhere, dueDate: { gte: today, lt: in7 } }, _count: { _all: true } }),
      prisma.task.groupBy({ by: ['assigneeId'], where: { ...openWhere, priority: { in: ['HIGH', 'URGENT'] } }, _count: { _all: true } }),
      prisma.task.groupBy({
        by: ['assigneeId'],
        where: { assigneeId: { in: engIds }, deletedAt: null, completedAt: { gte: weekStart } },
        _count: { _all: true }, _sum: { actualHours: true }
      }),
      prisma.projectMember.findMany({
        where: { leaveDate: null, project: { deletedAt: null, status: { notIn: ARCHIVED_STATUSES } }, OR: [{ userId: { in: userIds } }, { engineerId: { in: engIds } }] },
        select: { projectId: true, userId: true, engineerId: true }
      }),
      prisma.devConversation.groupBy({ by: ['engineerId'], where: { engineerId: { in: engIds }, deletedAt: null, createdAt: { gte: since7 } }, _count: { _all: true } }),
      getTeamsByUserIds(userIds)
    ]) : [[], [], [], [], [], [], [], await getTeamsByUserIds(userIds)]

    const count = (rows, id) => rows.find(r => String(r.assigneeId) === String(id))?._count._all || 0
    const engByUser = new Map(engineers.map(e => [String(e.userId), e]))
    const list = users.map(u => {
      const e = engByUser.get(String(u.id))
      const eid = e ? String(e.id) : null
      const statusCount = (st) => eid ? byStatus.find(r => String(r.assigneeId) === eid && r.status === st)?._count._all || 0 : 0
      const open = OPEN_TASK_STATUSES.reduce((s, st) => s + statusCount(st), 0)
      const projects = new Set(members.filter(m => String(m.userId) === String(u.id) || (eid && String(m.engineerId) === eid)).map(m => String(m.projectId)))
      const done = eid ? doneWeek.find(r => String(r.assigneeId) === eid) : null
      const stats = {
        open,
        inProgress: statusCount('IN_PROGRESS') + statusCount('REWORK'),
        overdue: eid ? count(overdue, eid) : 0,
        dueSoon: eid ? count(dueSoon, eid) : 0,
        highPriority: eid ? count(hot, eid) : 0,
        doneThisWeek: done?._count._all || 0,
        actualHoursThisWeek: Number(done?._sum.actualHours || 0),
        activeProjects: projects.size,
        conversations7d: eid ? convs.find(r => String(r.engineerId) === eid)?._count._all || 0 : 0
      }
      return {
        userId: String(u.id),
        engineerId: eid,
        name: u.name || u.username,
        username: u.username,
        role: u.role,
        avatarUrl: u.avatarUrl,
        lastLoginAt: u.lastLoginAt,
        level: e?.level || null,
        city: e?.city || null,
        skills: Array.isArray(e?.skills) ? e.skills.slice(0, 8) : [],
        available: e ? e.available === 1 : null,
        teams: (teamMap.get(String(u.id)) || []).map(t => ({ id: String(t.id), name: t.name })),
        ...stats,
        load: loadLevel(stats)
      }
    })
    res.json({ code: 0, data: { list, weekStart } })
  } catch (e) {
    console.error('[fde/team/overview]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
