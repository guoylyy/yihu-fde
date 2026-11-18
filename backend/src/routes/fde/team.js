// 0.5.0 团队视图
// 挂在 /api/fde/team(老接口) 和 /api/team(R4 团队四屏) 两处, 同一个 router:
//   GET /overview                 工程师池每人的档案摘要 + 手上任务负载(R3, 权限 engineer.view)
//   GET /members                  成员卡片            (team.view; 组长本组 / 老板全部)
//   GET /load?week=YYYY-MM-DD     负载               (team.view)
//   GET /promise?week=YYYY-MM-DD  承诺 vs 实际        (team.view.all; 只给提示标记, 不打分不排名)
//   GET /skills                   技能矩阵            (team.view)
//   POST /skills/confirm          确认一条技能(没有就建技能)  (team.view, 写审计)
//   POST /skills/:engineerId      设某人某技能等级           (team.view, 写审计)
// 数据范围统一走 lib/teamScope.js resolveTeamScope。
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { ENGINEER_ROLES } from '../../lib/engineerRoles.js'
import { getTeamsByUserIds } from '../../lib/teams.js'
import { loadLevel, OPEN_TASK_STATUSES, LOAD_THRESHOLD, loadPct, loadBand } from '../../lib/teamLoad.js'
import { resolveTeamScope, userWhereOf } from '../../lib/teamScope.js'
import { isoWeekOf, weekRange } from '../../services/okrRules.js'
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

// ================================================================ R4 团队四屏

const fail = (res, e, tag) => {
  console.error(`[team/${tag}]`, e)
  res.status(500).json({ code: 9001, message: e.message })
}

/** ?week=YYYY-MM-DD(该周任意一天, 上海日期) → ISO 周 + 起止; 缺省本周; 格式不对返回 null */
function parseWeek(q) {
  let at = new Date()
  if (q != null && q !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(q))) return null
    at = new Date(`${q}T12:00:00+08:00`)
    if (Number.isNaN(at.getTime())) return null
  }
  const { year, weekNo } = isoWeekOf(at)
  const { start, end } = weekRange(year, weekNo)
  return { year, weekNo, start, end }
}
const weekMeta = w => ({ year: w.year, weekNo: w.weekNo, start: w.start, end: w.end })

/**
 * 范围内的人: 工程师池角色 + 有工程师档案(团队视图以 engineerId 为键)
 * @returns {Promise<{scope, people: Array<{userId, engineerId, name, role, level}>}>}
 */
async function scopedPeople(req) {
  const scope = await resolveTeamScope(req.user)
  const users = await prisma.user.findMany({
    where: { ...userWhereOf(scope), role: { in: ENGINEER_ROLES }, deletedAt: null, status: 1, engineer: { is: { deletedAt: null } } },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, username: true, role: true, engineer: { select: { id: true, level: true } } }
  })
  const people = users.map(u => ({
    userId: u.id, engineerId: u.engineer.id, name: u.name || u.username, role: u.role, level: u.engineer.level || null
  }))
  return { scope, people }
}

const byKey = (rows, key) => new Map(rows.map(r => [String(r[key]), r]))
const countOf = (map, id) => map.get(String(id))?._count._all || 0

/** 每人手上未完成任务数(与 R3 负载同一口径: 未删除/未归档, 状态 TODO/QUEUED/IN_PROGRESS/REWORK) */
async function activeTaskCounts(engIds) {
  if (!engIds.length) return new Map()
  const rows = await prisma.task.groupBy({
    by: ['assigneeId'],
    where: { assigneeId: { in: engIds }, deletedAt: null, archivedAt: null, status: { in: OPEN_TASK_STATUSES } },
    _count: { _all: true }
  })
  return byKey(rows, 'assigneeId')
}

/** 某周已提交(= 承诺了)且没放弃的 OKR 目标, 按 ownerId(userId) 分组 */
async function committedObjectives(week, userIds) {
  const map = new Map()
  if (!userIds.length) return map
  const rows = await prisma.okrObjective.findMany({
    where: {
      ownerId: { in: userIds }, submittedAt: { not: null }, status: { not: 'DROPPED' },
      cycle: { year: week.year, weekNo: week.weekNo }
    },
    orderBy: [{ ownerId: 'asc' }, { seq: 'asc' }],
    select: { ownerId: true, title: true, weight: true }
  })
  for (const r of rows) {
    const k = String(r.ownerId)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push({ title: r.title, weight: r.weight })
  }
  return map
}

/** 某段时间内每人的开发会话条数 */
async function conversationCounts(engIds, start, end) {
  if (!engIds.length) return new Map()
  const rows = await prisma.devConversation.groupBy({
    by: ['engineerId'],
    where: { engineerId: { in: engIds }, deletedAt: null, createdAt: { gte: start, lte: end } },
    _count: { _all: true }
  })
  return byKey(rows, 'engineerId')
}

/**
 * GET /api/team/members
 * [{ engineerId, name, role, level, skills:[{name,level,source}], committedObjectives:[{title,weight}],
 *    activeTaskCount, lastConversationAt, loadPct }]
 * committedObjectives 取本周; skills 只列人工确认过的(MANUAL), 推断的候选看 /skills
 */
router.get('/members', requirePermission('team.view'), async (req, res) => {
  try {
    const week = parseWeek()
    const { scope, people } = await scopedPeople(req)
    const engIds = people.map(p => p.engineerId)
    const userIds = people.map(p => p.userId)
    const [skills, objectives, active, lastConv] = await Promise.all([
      engIds.length ? prisma.engineerSkill.findMany({
        where: { engineerId: { in: engIds }, skill: { deletedAt: null } },
        orderBy: [{ level: 'desc' }, { skillId: 'asc' }],
        select: { engineerId: true, level: true, skill: { select: { name: true } } }
      }) : [],
      committedObjectives(week, userIds),
      activeTaskCounts(engIds),
      engIds.length ? prisma.devConversation.groupBy({
        by: ['engineerId'], where: { engineerId: { in: engIds }, deletedAt: null }, _max: { createdAt: true }
      }) : []
    ])
    const lastMap = byKey(lastConv, 'engineerId')
    const data = people.map(p => {
      const activeTaskCount = countOf(active, p.engineerId)
      return {
        engineerId: String(p.engineerId),
        name: p.name,
        role: p.role,
        level: p.level,
        skills: skills.filter(s => s.engineerId === p.engineerId).map(s => ({ name: s.skill.name, level: s.level, source: 'MANUAL' })),
        committedObjectives: objectives.get(String(p.userId)) || [],
        activeTaskCount,
        lastConversationAt: lastMap.get(String(p.engineerId))?._max.createdAt || null,
        loadPct: loadPct(activeTaskCount)
      }
    })
    res.json({ code: 0, data, meta: { scope: scope.kind, week: weekMeta(week), threshold: LOAD_THRESHOLD } })
  } catch (e) { fail(res, e, 'members') }
})

/**
 * GET /api/team/load?week=YYYY-MM-DD
 * [{ engineerId, name, activeTaskCount, plannedHours, committedWeight, conversationCount, loadPct, level }]
 * plannedHours: 任务表没有预估工时字段(只有人填的 actualHours), 一律 null —— 不拿别的数凑
 * loadPct = activeTaskCount / meta.threshold × 100; ≥100 WARN, ≥150 OVER
 */
router.get('/load', requirePermission('team.view'), async (req, res) => {
  try {
    const week = parseWeek(req.query.week)
    if (!week) return res.status(400).json({ code: 9002, message: 'week 格式应为 YYYY-MM-DD' })
    const { scope, people } = await scopedPeople(req)
    const engIds = people.map(p => p.engineerId)
    const [active, objectives, convs] = await Promise.all([
      activeTaskCounts(engIds),
      committedObjectives(week, people.map(p => p.userId)),
      conversationCounts(engIds, week.start, week.end)
    ])
    const data = people.map(p => {
      const activeTaskCount = countOf(active, p.engineerId)
      const pct = loadPct(activeTaskCount)
      return {
        engineerId: String(p.engineerId),
        name: p.name,
        activeTaskCount,
        plannedHours: null,
        committedWeight: (objectives.get(String(p.userId)) || []).reduce((s, o) => s + (o.weight || 0), 0),
        conversationCount: countOf(convs, p.engineerId),
        loadPct: pct,
        level: loadBand(pct)
      }
    })
    res.json({ code: 0, data, meta: { scope: scope.kind, week: weekMeta(week), threshold: LOAD_THRESHOLD, warnPct: 100, overPct: 150 } })
  } catch (e) { fail(res, e, 'load') }
})

export default router
