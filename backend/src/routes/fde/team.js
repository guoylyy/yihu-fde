// 0.5.0 团队视图
// 挂在 /api/fde/team(老接口) 和 /api/team(R4 团队四屏) 两处, 同一个 router:
//   GET /overview                 工程师池每人的档案摘要 + 手上任务负载(R3, 权限 engineer.view)
//   GET /members                  成员卡片            (team.view; 组长本组 / 老板全部)
//   GET /load?week=YYYY-MM-DD     负载               (team.view)
//   GET /promise?week=YYYY-MM-DD  承诺 vs 实际        (team.view.all; 只给提示标记, 不打分不排名)
//   GET /skills                   技能矩阵            (0.6.4: 登录即可; 有 team.view 按团队范围, 其余人只看自己)
//   POST /skills/confirm          确认一条技能(没有就建技能)  (0.6.4: 仅 ADMIN, 写审计)
//   POST /skills/:engineerId      设某人某技能等级           (0.6.4: 仅 ADMIN, 写审计)
// 数据范围统一走 lib/teamScope.js resolveTeamScope。
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission, requireRole, hasPermission } from '../../lib/auth.js'
import { ENGINEER_ROLES } from '../../lib/engineerRoles.js'
import { getTeamsByUserIds } from '../../lib/teams.js'
import { loadLevel, OPEN_TASK_STATUSES, LOAD_THRESHOLD, loadPct, loadBand, promiseFlags, skillsMentioned } from '../../lib/teamLoad.js'
import { logInternalAction } from '../../lib/audit.js'
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
async function scopedPeople(req, scope = null) {
  scope = scope || await resolveTeamScope(req.user)
  const users = await prisma.user.findMany({
    where: { ...userWhereOf(scope), role: { in: ENGINEER_ROLES }, deletedAt: null, status: 1, engineer: { is: { deletedAt: null } } },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, username: true, role: true, engineer: { select: { id: true, level: true } } }
  })
  // 关系 select 是 Prisma 的第二条查询: 两条查询之间档案被删(并发删人)时 engineer 会是 null, 跳过
  const people = users.filter(u => u.engineer).map(u => ({
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

/**
 * GET /api/team/promise?week=YYYY-MM-DD   (team.view.all, 只给老板)
 * [{ engineerId, name, objectives:[{title,weight}], completedTasks, conversationCount, projectCount, flag, flags }]
 * 只给事实和提示标记(规则见 lib/teamLoad.js promiseFlags), 刻意不出任何分数/排名字段。
 * projectCount = 本周涉及的项目数: 本周完成的任务 + 手上未完成的任务 + 本周会话 所挂项目去重
 */
router.get('/promise', requirePermission('team.view.all'), async (req, res) => {
  try {
    const week = parseWeek(req.query.week)
    if (!week) return res.status(400).json({ code: 9002, message: 'week 格式应为 YYYY-MM-DD' })
    const { scope, people } = await scopedPeople(req)
    const engIds = people.map(p => p.engineerId)
    const inWeek = { gte: week.start, lte: week.end }
    const [objectives, active, completed, taskProjects, convs] = await Promise.all([
      committedObjectives(week, people.map(p => p.userId)),
      activeTaskCounts(engIds),
      engIds.length ? prisma.task.groupBy({
        by: ['assigneeId'], where: { assigneeId: { in: engIds }, deletedAt: null, completedAt: inWeek }, _count: { _all: true }
      }).then(rows => byKey(rows, 'assigneeId')) : new Map(),
      engIds.length ? prisma.task.findMany({
        where: {
          assigneeId: { in: engIds }, deletedAt: null,
          OR: [{ completedAt: inWeek }, { archivedAt: null, status: { in: OPEN_TASK_STATUSES } }]
        },
        distinct: ['assigneeId', 'projectId'],
        select: { assigneeId: true, projectId: true }
      }) : [],
      engIds.length ? prisma.devConversation.findMany({
        where: { engineerId: { in: engIds }, deletedAt: null, createdAt: inWeek },
        select: { engineerId: true, projectId: true }
      }) : []
    ])
    const data = people.map(p => {
      const eid = String(p.engineerId)
      const objs = objectives.get(String(p.userId)) || []
      const completedTasks = countOf(completed, eid)
      const activeTaskCount = countOf(active, eid)
      const mine = convs.filter(c => String(c.engineerId) === eid)
      const projects = new Set([
        ...taskProjects.filter(t => String(t.assigneeId) === eid).map(t => String(t.projectId)),
        ...mine.filter(c => c.projectId != null).map(c => String(c.projectId))
      ])
      const flags = promiseFlags({ objectiveCount: objs.length, completedTasks, activeTaskCount, conversationCount: mine.length })
      return {
        engineerId: eid,
        name: p.name,
        objectives: objs,
        completedTasks,
        conversationCount: mine.length,
        projectCount: projects.size,
        flag: flags[0] || null,
        flags
      }
    })
    res.json({ code: 0, data, meta: { scope: scope.kind, week: weekMeta(week) } })
  } catch (e) { fail(res, e, 'promise') }
})

const DERIVED_WINDOW_DAYS = 90

/**
 * 技能矩阵的读范围(0.6.4「人人能看自己」):
 *   ADMIN / 有 team.view 的角色(组长) → resolveTeamScope, 与原来一致
 *   其余人                             → 强制只有自己, 不看角色的 dataScope
 *                                      (防止某个 dataScope=ALL/TEAM 却没有 team.view 的自定义角色借这个口子读全团队)
 */
async function skillsReadScope(user) {
  if (user.role === 'ADMIN' || hasPermission(user, 'team.view')) return resolveTeamScope(user)
  const uid = BigInt(user.id ?? user.userId)
  const engs = await prisma.engineer.findMany({ where: { userId: uid, deletedAt: null }, select: { id: true } })
  return { kind: 'SELF', teamIds: [], userIds: [uid], engineerIds: engs.map(e => e.id) }
}

/**
 * GET /api/team/skills
 * { skills:[{id,name}], members:[{engineerId,name}], cells:[{engineerId,skillId,level,source,candidate?,hits?}], singlePoints:[skillId] }
 *   MANUAL  = engineer_skills 有记录(人工确认过), level 1-5
 *   DERIVED = 近 90 天开发会话的 tags/标题里出现过该技能名(只认技能主数据里有的名字), 只是候选:
 *             level=null、candidate=true, 不参与 singlePoints; 同一人同一技能已有 MANUAL 就不再出候选
 *   singlePoints = 只有 1 人 MANUAL 且 level>0 的技能
 */
router.get('/skills', async (req, res) => {
  try {
    const { scope, people } = await scopedPeople(req, await skillsReadScope(req.user))
    const engIds = people.map(p => p.engineerId)
    const since = new Date(Date.now() - DERIVED_WINDOW_DAYS * 86400000)
    const [manual, allSkills, convs] = await Promise.all([
      engIds.length ? prisma.engineerSkill.findMany({
        where: { engineerId: { in: engIds }, skill: { deletedAt: null } },
        select: { engineerId: true, skillId: true, level: true }
      }) : [],
      prisma.skill.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
      engIds.length ? prisma.devConversation.findMany({
        where: { engineerId: { in: engIds }, deletedAt: null, createdAt: { gte: since } },
        select: { engineerId: true, title: true, tags: true }
      }) : []
    ])

    const cells = manual.map(m => ({ engineerId: String(m.engineerId), skillId: String(m.skillId), level: m.level, source: 'MANUAL' }))
    const manualKeys = new Set(cells.map(c => `${c.engineerId}:${c.skillId}`))
    const derived = new Map() // "eid:sid" → hits
    for (const c of convs) {
      for (const sid of skillsMentioned(c, allSkills)) {
        const k = `${c.engineerId}:${sid}`
        if (!manualKeys.has(k)) derived.set(k, (derived.get(k) || 0) + 1)
      }
    }
    for (const [k, hits] of derived) {
      const [engineerId, skillId] = k.split(':')
      cells.push({ engineerId, skillId, level: null, source: 'DERIVED', candidate: true, hits })
    }

    const holders = new Map()
    for (const c of cells) {
      if (c.source !== 'MANUAL' || !(c.level > 0)) continue
      holders.set(c.skillId, (holders.get(c.skillId) || 0) + 1)
    }
    const used = new Set(cells.map(c => c.skillId))
    const skills = allSkills.filter(s => used.has(String(s.id)))
      .map(s => ({ id: String(s.id), name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json({
      code: 0,
      data: {
        skills,
        members: people.map(p => ({ engineerId: String(p.engineerId), name: p.name })),
        cells,
        // 单点风险是跨人推导的; 只看自己时不给(只有一个人, 算出来也没意义, 还会暗示别人的情况)
        singlePoints: scope.kind === 'SELF' ? [] : [...holders].filter(([, n]) => n === 1).map(([sid]) => sid)
      },
      meta: { scope: scope.kind, derivedWindowDays: DERIVED_WINDOW_DAYS }
    })
  } catch (e) { fail(res, e, 'skills') }
})

// ---------------------------------------------------------------- 技能写接口

class TeamInputError extends Error {
  constructor(message, status = 400, code = 9002) { super(message); this.status = status; this.code = code }
}

function parseLevel(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new TeamInputError('level 必须是 1-5 的整数')
  return n
}

function parseId(v, label) {
  if (v == null || !/^\d+$/.test(String(v))) throw new TeamInputError(`${label} 不合法`)
  return BigInt(v)
}

/** 目标工程师必须存在且在调用人的团队范围内(0.6.4 起写接口只给 ADMIN, 范围恒为 ALL; 保留以防日后放开) */
async function assertEngineerInScope(req, engineerId) {
  const eng = await prisma.engineer.findFirst({ where: { id: engineerId, deletedAt: null }, select: { id: true } })
  if (!eng) throw new TeamInputError('工程师不存在', 404, 1004)
  const scope = await resolveTeamScope(req.user)
  if (scope.kind !== 'ALL' && !scope.engineerIds.some(id => id === engineerId)) {
    throw new TeamInputError('该工程师不在你的团队范围内', 403, 1003)
  }
}

/** upsert 一条人工技能 + 同步 engineers.skills 冗余 JSON + 写审计 */
async function setManualSkill(req, engineerId, skill, level, action) {
  const before = await prisma.engineerSkill.findUnique({
    where: { engineerId_skillId: { engineerId, skillId: skill.id } }, select: { level: true }
  })
  const row = await prisma.engineerSkill.upsert({
    where: { engineerId_skillId: { engineerId, skillId: skill.id } },
    update: { level },
    create: { engineerId, skillId: skill.id, level }
  })
  const names = await prisma.engineerSkill.findMany({
    where: { engineerId, skill: { deletedAt: null } }, select: { skill: { select: { name: true } } }, orderBy: { id: 'asc' }
  })
  await prisma.engineer.update({ where: { id: engineerId }, data: { skills: names.map(n => n.skill.name) } })
  await logInternalAction(req, action, {
    resourceType: 'engineer_skill', resourceId: row.id,
    details: { engineerId: String(engineerId), skillId: String(skill.id), skillName: skill.name, level, before: before?.level ?? null, source: 'MANUAL' }
  })
  return { id: String(row.id), engineerId: String(engineerId), skillId: String(skill.id), skillName: skill.name, level, source: 'MANUAL' }
}

function sendInputError(res, e, tag) {
  if (e instanceof TeamInputError) return res.status(e.status).json({ code: e.code, message: e.message })
  fail(res, e, tag)
}

/**
 * POST /api/team/skills/confirm  { engineerId, skillName, level }
 * 确认一条技能(多半是 DERIVED 候选): 技能主数据没有就新建, 再 upsert 成 MANUAL
 * (要在 /skills/:engineerId 之前注册, 否则 "confirm" 会被当成 engineerId)
 */
router.post('/skills/confirm', requireRole('ADMIN'), async (req, res) => {
  try {
    const engineerId = parseId(req.body?.engineerId, 'engineerId')
    const level = parseLevel(req.body?.level)
    const name = String(req.body?.skillName ?? '').trim()
    if (!name || name.length > 50) throw new TeamInputError('skillName 必填, 不超过 50 字')
    await assertEngineerInScope(req, engineerId)

    let skill = await prisma.skill.findUnique({ where: { name }, select: { id: true, name: true, deletedAt: true } })
    let created = false
    if (!skill) {
      try {
        skill = await prisma.skill.create({ data: { name }, select: { id: true, name: true, deletedAt: true } })
        created = true
      } catch (e) {
        if (e.code !== 'P2002') throw e // 并发同名: 读回已建好的那条
        skill = await prisma.skill.findUnique({ where: { name }, select: { id: true, name: true, deletedAt: true } })
      }
    } else if (skill.deletedAt) {
      // 名字唯一: 被删过的同名技能直接恢复, 不另建
      skill = await prisma.skill.update({ where: { id: skill.id }, data: { deletedAt: null }, select: { id: true, name: true, deletedAt: true } })
    }
    const data = await setManualSkill(req, engineerId, skill, level, 'team.skill.confirm')
    res.json({ code: 0, data: { ...data, skillCreated: created } })
  } catch (e) { sendInputError(res, e, 'skills/confirm') }
})

/** POST /api/team/skills/:engineerId  { skillId, level }  设某人某技能等级(source=MANUAL) */
router.post('/skills/:engineerId', requireRole('ADMIN'), async (req, res) => {
  try {
    const engineerId = parseId(req.params.engineerId, 'engineerId')
    const skillId = parseId(req.body?.skillId, 'skillId')
    const level = parseLevel(req.body?.level)
    await assertEngineerInScope(req, engineerId)
    const skill = await prisma.skill.findFirst({ where: { id: skillId, deletedAt: null }, select: { id: true, name: true } })
    if (!skill) throw new TeamInputError('技能不存在', 404, 1004)
    const data = await setManualSkill(req, engineerId, skill, level, 'team.skill.set')
    res.json({ code: 0, data })
  } catch (e) { sendInputError(res, e, 'skills/set') }
})

export default router
