// FDE 平台 - 个人仪表盘聚合（/me）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, hasPermission } from '../../lib/auth.js'
import { getTeamsByUserId } from '../../lib/teams.js'

const router = express.Router()
router.use(internalAuth)

// 1.2.6: 工作台聚合口径扩大到项目经理 —— 经理与工程师看同样的个人内容
const RICH_ME_ROLES = ['FDE_ENGINEER', 'MANAGER']

/**
 * 当前用户的项目成员关系（双轨: userId 新数据 / engineerId 历史数据, 去重）
 */
async function findMyMemberships(userId, engineerId) {
  const or = [{ userId }]
  if (engineerId) or.push({ engineerId })
  const members = await prisma.projectMember.findMany({
    where: { OR: or, leaveDate: null },
    include: {
      project: {
        include: { customer: { select: { id: true, name: true, shortName: true } } }
      }
    }
  })
  const seen = new Set()
  return members.filter(m => {
    const k = m.projectId.toString()
    if (seen.has(k) || m.project.deletedAt) return false
    if (['CLOSED', 'CANCELLED'].includes(m.project.status)) return false   // v2.5.5(#915) 归档项目不算在手
    seen.add(k)
    return true
  })
}

/**
 * GET /api/fde/me
 * 返回当前登录用户的个人信息 + 角色相关聚合数据
 * - FDE_ENGINEER / MANAGER: 我的项目/本月工时/待办 (1.2.6 起经理同工程师口径)
 * - 其他角色: 简单 profile
 */
router.get('/', async (req, res) => {
  try {
    const userId = BigInt(req.user.userId)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true, phone: true, email: true, role: true, status: true, lastLoginAt: true, avatarUrl: true, bio: true, platformFields: true }
    })
    if (!user) return res.status(404).json({ code: 2004, message: '用户不存在' })

    // v1.5.6: 带出所属团队(只读展示; 归属由管理员在用户管理设置, 即时消息通知按团队定位)
    user.teams = await getTeamsByUserId(userId)

    const result = { profile: user }

    if (RICH_ME_ROLES.includes(user.role)) {
      // 经理可能没有工程师档案(双轨), 档案缺失时工时/技能块为空但项目照常聚合
      const engineer = await prisma.engineer.findUnique({
        where: { userId },
        include: {
          user: false,
          engineerSkills: { include: { skill: true } }
        }
      })

      // 我的项目 (userId OR engineerId 双轨匹配)
      const myProjects = await findMyMemberships(userId, engineer?.id)

      // 本月工时 (仅有工程师档案时有数据)
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      const monthTimesheets = engineer ? await prisma.timesheet.findMany({
        where: {
          engineerId: engineer.id,
          deletedAt: null,
          workDate: { gte: asDay(monthStart), lte: asDay(monthEnd) }
        },
        orderBy: { workDate: 'desc' }
      }) : []
      const monthHours = monthTimesheets.reduce((s, t) => s + Number(t.hours), 0)
      const submittedCount = monthTimesheets.filter(t => t.status === 'SUBMITTED').length
      const approvedCount = monthTimesheets.filter(t => t.status === 'APPROVED').length
      const draftCount = monthTimesheets.filter(t => t.status === 'DRAFT').length

      // 绩效
      const allTimesheets = engineer ? await prisma.timesheet.findMany({
        where: { engineerId: engineer.id, deletedAt: null, status: 'APPROVED' }
      }) : []
      const totalApprovedHours = allTimesheets.reduce((s, t) => s + Number(t.hours), 0)
      const totalProjects = myProjects.length

      if (engineer) {
        result.engineer = {
          id: engineer.id,
          level: engineer.level,
          city: engineer.city,
          dailyRate: engineer.dailyRate,
          available: engineer.available,
          bio: engineer.bio,
          skills: engineer.engineerSkills.map(es => ({
            id: es.skillId,
            name: es.skill.name,
            category: es.skill.category,
            level: es.level
          }))
        }
      }
      result.myProjects = myProjects.map(m => ({
        memberId: m.id,
        role: m.role,
        joinDate: m.joinDate,
        project: {
          id: m.project.id,
          code: m.project.code,
          name: m.project.name,
          status: m.project.status,
          progress: m.project.progress,
          health: m.project.health,
          customer: m.project.customer
        }
      }))
      result.thisMonth = {
        totalHours: monthHours,
        timesheetCount: monthTimesheets.length,
        submittedCount,
        approvedCount,
        draftCount,
        yearMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      }
      result.performance = {
        totalApprovedHours,
        totalProjects,
        avgHoursPerProject: totalProjects ? (totalApprovedHours / totalProjects).toFixed(1) : 0
      }
      result.todoCount = draftCount
    }

    // MANAGER/ADMIN 也给个简单待办数（待审批工时数）
    if (['ADMIN', 'MANAGER'].includes(user.role)) {
      const pending = await prisma.timesheet.count({
        where: { status: 'SUBMITTED', deletedAt: null }
      })
      result.pendingTimesheets = pending
    }

    res.json({ code: 0, message: 'ok', data: result })
  } catch (e) {
    console.error('[fde/me]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/me/profile  (v1.2.8 个人中心)
 * 自助维护: 自我介绍; 头像 / 手机 / 邮箱只有以虎 One 上没有时才能自己填(有的以平台为准, 见 platformFields)
 * 姓名以平台为准, 角色由本系统管理员设
 */
router.put('/profile', async (req, res) => {
  try {
    const { phone, email, avatarUrl, bio } = req.body
    const me = await prisma.user.findUnique({ where: { id: BigInt(req.user.userId) }, select: { phone: true, email: true, avatarUrl: true, platformFields: true } })
    const locked = new Set(Array.isArray(me?.platformFields) ? me.platformFields : [])
    const data = {}
    for (const [k, v] of [['phone', phone], ['email', email], ['avatarUrl', avatarUrl]]) {
      if (v === undefined || (v || null) === (me?.[k] ?? null)) continue
      if (locked.has(k)) return res.status(400).json({ code: 1006, message: '这项资料来自以虎 One，请在以虎 One（或钉钉 / 飞书 / 企业微信）里修改' })
      data[k] = v || null
    }
    if (bio !== undefined) {
      if (bio && bio.length > 500) return res.status(400).json({ code: 9002, message: '自我介绍不超过 500 字' })
      data.bio = bio || null
    }
    const user = await prisma.user.update({
      where: { id: BigInt(req.user.userId) },
      data,
      select: { id: true, username: true, name: true, phone: true, email: true, role: true, avatarUrl: true, bio: true, platformFields: true }
    })
    res.json({ code: 0, data: user })
  } catch (e) {
    console.error('[fde/me PUT profile]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/me/weekly-leaderboard  (v1.4.x 个人主页本周排行榜)
 * 本周(周一起): 工时榜 top10 / 完成任务榜 top10 / 最活跃项目 top10
 * 所有内部角色可看(团队激励用, 不含金额敏感信息)
 */
router.get('/weekly-leaderboard', async (req, res) => {
  try {
    const now = new Date()
    const day = (now.getDay() + 6) % 7 // 周一=0
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day)

    const [hoursAgg, tasksAgg, weekCommits, weekTasksDone] = await Promise.all([
      prisma.timesheet.groupBy({
        by: ['engineerId'],
        where: { deletedAt: null, workDate: { gte: asDay(weekStart) } },
        _sum: { hours: true },
        orderBy: { _sum: { hours: 'desc' } },
        take: 10
      }),
      prisma.task.groupBy({
        by: ['assigneeId'],
        where: { deletedAt: null, completedAt: { gte: weekStart }, assigneeId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { assigneeId: 'desc' } },
        take: 10
      }),
      prisma.repoActivity.groupBy({
        by: ['projectId'],
        where: { type: 'COMMIT', happenedAt: { gte: weekStart } },
        _count: { _all: true }
      }),
      prisma.task.groupBy({
        by: ['projectId'],
        where: { deletedAt: null, completedAt: { gte: weekStart } },
        _count: { _all: true }
      })
    ])

    // 工程师 → 姓名/userId (标「我」用)
    const engIds = [...new Set([...hoursAgg.map(h => h.engineerId), ...tasksAgg.map(t => t.assigneeId)].filter(Boolean).map(String))]
    const engineers = engIds.length
      ? await prisma.engineer.findMany({
          where: { id: { in: engIds.map(BigInt) } },
          select: { id: true, user: { select: { id: true, name: true } } }
        })
      : []
    const engMap = new Map(engineers.map(e => [String(e.id), e.user]))

    // 项目活跃: 本周提交 + 本周完成任务, 综合分 = commits + tasksDone×3
    const projScore = new Map()
    for (const c of weekCommits) projScore.set(String(c.projectId), { commits: c._count._all, tasksDone: 0 })
    for (const t of weekTasksDone) {
      const k = String(t.projectId)
      const cur = projScore.get(k) || { commits: 0, tasksDone: 0 }
      cur.tasksDone = t._count._all
      projScore.set(k, cur)
    }
    const topProjIds = [...projScore.entries()]
      .map(([id, s]) => ({ id, ...s, score: s.commits + s.tasksDone * 3 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
    const projects = topProjIds.length
      ? await prisma.project.findMany({
          where: { id: { in: topProjIds.map(p => BigInt(p.id)) }, deletedAt: null },
          select: { id: true, code: true, name: true, activityScore: true }
        })
      : []
    const projMap = new Map(projects.map(p => [String(p.id), p]))

    res.json({
      code: 0,
      data: {
        weekStart: weekStart.toISOString().slice(0, 10),
        hours: hoursAgg.map(h => ({
          userId: engMap.get(String(h.engineerId))?.id || null,
          name: engMap.get(String(h.engineerId))?.name || '—',
          hours: Math.round(Number(h._sum.hours || 0) * 10) / 10
        })),
        tasks: tasksAgg.map(t => ({
          userId: engMap.get(String(t.assigneeId))?.id || null,
          name: engMap.get(String(t.assigneeId))?.name || '—',
          count: t._count._all
        })),
        projects: topProjIds
          .filter(p => projMap.has(p.id))
          .map(p => ({ ...projMap.get(p.id), commits: p.commits, tasksDone: p.tasksDone }))
      }
    })
  } catch (e) {
    console.error('[fde/me GET /weekly-leaderboard]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})


// ============================================================
// v2.6.0(#959) 个人工作台 —— FDE 工程师 / 项目经理「一页把活干完」
// 与 /me/dashboard 的区别: 那个是只读看板, 这里额外给出今日焦点/本周日程/
// 工时格子/审批摘要, 并配套 /me/todos 待办收件箱驱动就地操作。
// ============================================================

const WEEK_HOURS_TARGET = 40                       // 周工时目标(暂固定, 后续可做成配置)
const VERIFY_ROLES = ['ADMIN', 'MANAGER']   // 任务验收是经理的动作

/** 本周一 00:00 (周一为一周起点) */
function mondayOf(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  return t
}
/** 本地日期 YYYY-MM-DD (不要用 toISOString, 会被 UTC 偏成前一天) */
function ymd(d) {
  const t = new Date(d)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
/**
 * 只有日期的字段(工时日期、截止日、里程碑计划日)存的是那天的 UTC 0 点:
 * 取它的日期要按 UTC, 查询边界也要用 UTC 0 点, 否则服务器在西半球(如美国)时会差一天
 */
function dayKey(d) {
  return new Date(d).toISOString().slice(0, 10)
}
/** 本地某天 → 同一个日历日的 UTC 0 点(和只有日期的字段比较用) */
function asDay(d) {
  return new Date(`${ymd(d)}T00:00:00.000Z`)
}
function addDays(d, n) {
  const t = new Date(d)
  t.setDate(t.getDate() + n)
  return t
}

/**
 * 身份三件套: userId / 工程师档案 / 在手项目
 * 双轨坑: 经理常常没有 Engineer 档案 —— 项目按 userId 兜底照常聚合,
 * 但工时/任务这些以 engineerId 为主键的块只能为空, 前端据 hasEngineerProfile 显式提示。
 */
async function resolveMe(req) {
  const userId = BigInt(req.user.userId)
  const engineer = await prisma.engineer.findUnique({
    where: { userId },
    select: { id: true, level: true, city: true, available: true }
  })
  const memberships = await findMyMemberships(userId, engineer?.id)
  return { userId, engineer, memberships, projectIds: memberships.map(m => m.projectId) }
}

/**
 * v2.6.0(#960) 经理侧「我的组员」: 我在手项目里的成员, 本周工时 / 完成任务 / 异常标记
 * 成员双轨(userId 新数据 / engineerId 历史数据), 统计一律落到 engineer.id 上
 */
async function loadTeamPulse(req, projectIds, weekStart) {
  if (!hasPermission(req.user, 'timesheet.approve') || !projectIds.length) return null

  const members = await prisma.projectMember.findMany({
    where: { projectId: { in: projectIds }, leaveDate: null },
    select: { userId: true, engineerId: true }
  })
  const userIds = [...new Set(members.filter(m => m.userId).map(m => String(m.userId)))].map(BigInt)
  const engineers = await prisma.engineer.findMany({
    where: {
      OR: [
        { id: { in: [...new Set(members.filter(m => m.engineerId).map(m => String(m.engineerId)))].map(BigInt) } },
        ...(userIds.length ? [{ userId: { in: userIds } }] : [])
      ]
    },
    select: { id: true, user: { select: { id: true, name: true } } }
  })
  if (!engineers.length) return []
  const engIds = engineers.map(e => e.id)

  const [hoursAgg, doneAgg] = await Promise.all([
    prisma.timesheet.groupBy({
      by: ['engineerId'],
      where: { engineerId: { in: engIds }, deletedAt: null, workDate: { gte: asDay(weekStart) } },
      _sum: { hours: true }
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { assigneeId: { in: engIds }, deletedAt: null, completedAt: { gte: weekStart } },
      _count: { _all: true }
    })
  ])
  const hoursMap = new Map(hoursAgg.map(h => [String(h.engineerId), Number(h._sum.hours || 0)]))
  const doneMap = new Map(doneAgg.map(t => [String(t.assigneeId), t._count._all]))

  return engineers
    .filter(e => e.user)
    .map(e => {
      const hours = Math.round((hoursMap.get(String(e.id)) || 0) * 10) / 10
      return {
        userId: String(e.user.id),
        engineerId: String(e.id),
        name: e.user.name,
        hours,
        doneTasks: doneMap.get(String(e.id)) || 0,
        idle: hours === 0            // 本周零工时 = 需要关注
      }
    })
    .sort((a, b) => b.hours - a.hours)
}

/** 审批摘要(按权限收敛): 没权限的项返回 null, 前端据此决定块显隐 */
async function loadApprovals(req, projectIds) {
  const canTs = hasPermission(req.user, 'timesheet.approve')
  const canVerify = VERIFY_ROLES.includes(req.user.role)
  if (!canTs && !canVerify) return null

  const [timesheets, tasksToVerify] = await Promise.all([
    canTs ? prisma.timesheet.count({ where: { status: 'SUBMITTED', deletedAt: null } }) : null,
    canVerify && projectIds.length
      ? prisma.task.count({ where: { projectId: { in: projectIds }, status: 'DONE', deletedAt: null } })
      : (canVerify ? 0 : null)
  ])
  return { timesheets, tasksToVerify }
}

/**
 * GET /api/fde/me/workbench
 * 个人工作台首屏一把聚合: 今日焦点 / 本周日程 / 本周工时格子 / 我的任务 /
 * 我的项目与里程碑 / 审批摘要
 */
router.get('/workbench', async (req, res) => {
  try {
    const { userId, engineer, memberships, projectIds } = await resolveMe(req)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, name: true, role: true, avatarUrl: true }
    })
    if (!user) return res.status(404).json({ code: 2004, message: '用户不存在' })

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(today.getTime() + 86400000 - 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const weekStart = mondayOf(now)
    const weekEnd = addDays(weekStart, 6)
    const weekEndOfDay = new Date(weekEnd.getTime() + 86400000 - 1)
    // 本周可能跨月(月初), 工时一次取 min(本月初, 本周一) 起, 前端不用二次请求
    const hoursSince = weekStart < monthStart ? weekStart : monthStart
    const in30Days = addDays(today, 30)

    const [
      timesheets, myTasks, taskCounts, doneThisMonth, milestones, openIssueCount,
      unreadNotifications, approvals,
      projectOverdue, projectIssues, teamPulse
    ] = await Promise.all([
      // 工时(本周∪本月)
      engineer ? prisma.timesheet.findMany({
        where: { engineerId: engineer.id, deletedAt: null, workDate: { gte: asDay(hoursSince) } },
        select: { id: true, workDate: true, hours: true, status: true }
      }) : [],
      // 我的未完结任务(限在手项目内)
      engineer && projectIds.length ? prisma.task.findMany({
        where: {
          assigneeId: engineer.id, projectId: { in: projectIds }, deletedAt: null,
          status: { in: ['TODO', 'QUEUED', 'IN_PROGRESS', 'REWORK'] }
        },
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
        take: 50,
        include: { project: { select: { id: true, code: true, name: true } } }
      }) : [],
      engineer && projectIds.length ? prisma.task.groupBy({
        by: ['status'],
        where: { assigneeId: engineer.id, projectId: { in: projectIds }, deletedAt: null },
        _count: { _all: true }
      }) : [],
      engineer && projectIds.length ? prisma.task.count({
        where: {
          assigneeId: engineer.id, projectId: { in: projectIds }, deletedAt: null,
          status: { in: ['DONE', 'VERIFIED'] }, completedAt: { gte: monthStart }
        }
      }) : 0,
      projectIds.length ? prisma.milestone.findMany({
        where: {
          projectId: { in: projectIds }, deletedAt: null,
          status: { notIn: ['COMPLETED'] }, plannedDate: { not: null, lte: in30Days }
        },
        orderBy: { plannedDate: 'asc' },
        take: 8,
        include: { project: { select: { id: true, code: true, name: true } } }
      }) : [],
      projectIds.length ? prisma.issue.count({
        where: { projectId: { in: projectIds }, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } }
      }) : 0,
      prisma.notification.count({ where: { userId, readAt: null } }),
      loadApprovals(req, projectIds),
      // 每项目逾期任务数 / 开放问题数(项目卡上直接看得到哪个项目在冒烟)
      projectIds.length ? prisma.task.groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projectIds }, deletedAt: null,
          status: { in: ['TODO', 'QUEUED', 'IN_PROGRESS', 'REWORK'] },
          dueDate: { lt: asDay(today) }
        },
        _count: { _all: true }
      }) : [],
      projectIds.length ? prisma.issue.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        _count: { _all: true }
      }) : [],
      loadTeamPulse(req, projectIds, weekStart)
    ])

    // ---- 工时切分 ----
    const num = v => Number(v || 0)
    const sum = rows => Number(rows.reduce((s, t) => s + num(t.hours), 0).toFixed(1))
    const inWeek = timesheets.filter(t => new Date(t.workDate) >= weekStart && new Date(t.workDate) <= weekEndOfDay)
    const inMonth = timesheets.filter(t => new Date(t.workDate) >= monthStart)
    const todayKey = ymd(today)
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = ymd(addDays(weekStart, i))
      const rows = inWeek.filter(t => dayKey(t.workDate) === date)
      return {
        date,
        hours: sum(rows),
        draft: sum(rows.filter(r => r.status === 'DRAFT')),
        submitted: sum(rows.filter(r => r.status === 'SUBMITTED')),
        approved: sum(rows.filter(r => r.status === 'APPROVED')),
        isToday: date === todayKey
      }
    })

    // ---- 任务切分 ----
    const taskCount = st => taskCounts.find(c => c.status === st)?._count._all || 0
    const isOverdue = t => t.dueDate && dayKey(t.dueDate) < todayKey
    const overdue = myTasks.filter(isOverdue).length
    const dueToday = myTasks.filter(t => t.dueDate && dayKey(t.dueDate) === todayKey).length

    res.json({
      code: 0,
      message: 'ok',
      data: {
        profile: user,
        engineer,
        hasEngineerProfile: !!engineer,
        today: {
          date: todayKey,
          tasksDueToday: dueToday,
          tasksOverdue: overdue,
          hoursLogged: sum(inWeek.filter(t => dayKey(t.workDate) === todayKey)),
          unreadNotifications
        },
        hours: {
          week: sum(inWeek),
          weekTarget: WEEK_HOURS_TARGET,
          month: sum(inMonth),
          monthDraft: inMonth.filter(t => t.status === 'DRAFT').length,
          monthSubmitted: inMonth.filter(t => t.status === 'SUBMITTED').length,
          monthApproved: inMonth.filter(t => t.status === 'APPROVED').length,
          weekDraftCount: inWeek.filter(t => t.status === 'DRAFT').length,
          days
        },
        tasks: {
          todo: taskCount('TODO'),
          queued: taskCount('QUEUED'),
          inProgress: taskCount('IN_PROGRESS'),
          rework: taskCount('REWORK'),
          doneThisMonth,
          overdue,
          list: myTasks
        },
        projects: memberships.map(m => ({
          id: m.project.id,
          code: m.project.code,
          name: m.project.name,
          status: m.project.status,
          progress: m.project.progress,
          health: m.project.health,
          customer: m.project.customer,
          roleInProject: m.role,
          overdueTasks: projectOverdue.find(x => String(x.projectId) === String(m.projectId))?._count._all || 0,
          openIssues: projectIssues.find(x => String(x.projectId) === String(m.projectId))?._count._all || 0
        })),
        milestones: milestones.map(ms => ({
          id: ms.id,
          name: ms.name,
          status: ms.status,
          plannedDate: ms.plannedDate,
          overdue: ms.plannedDate ? dayKey(ms.plannedDate) < todayKey : false,
          project: ms.project
        })),
        openIssueCount,
        approvals,
        teamPulse
      }
    })
  } catch (e) {
    console.error('[fde/me/workbench]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/me/todos?scope=mine|approve|all
 * 待办收件箱: 把散落各模块「该我动手的事」抹平成一条流,
 * 每条自带主操作 action(前端据 key 决定调哪个接口), 就地办完。
 * severity: URGENT(逾期/被驳回) > HIGH > NORMAL
 */
router.get('/todos', async (req, res) => {
  try {
    const scope = ['mine', 'approve', 'all'].includes(req.query.scope) ? req.query.scope : 'all'
    const wantMine = scope !== 'approve'
    const wantApprove = scope !== 'mine'
    const { userId, engineer, projectIds } = await resolveMe(req)

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayKey = ymd(today)
    const weekStart = mondayOf(now)
    const weekEnd = new Date(addDays(weekStart, 6).getTime() + 86400000 - 1)

    const [myTasks, draftTimesheets, approvals] = await Promise.all([
      wantMine && engineer && projectIds.length ? prisma.task.findMany({
        where: {
          assigneeId: engineer.id, projectId: { in: projectIds }, deletedAt: null,
          status: { in: ['TODO', 'QUEUED', 'IN_PROGRESS', 'REWORK'] }
        },
        orderBy: [{ dueDate: 'asc' }],
        take: 60,
        include: { project: { select: { id: true, code: true, name: true } } }
      }) : [],
      wantMine && engineer ? prisma.timesheet.findMany({
        where: { engineerId: engineer.id, deletedAt: null, status: 'DRAFT', workDate: { gte: asDay(weekStart), lte: asDay(weekEnd) } },
        select: { id: true, workDate: true, hours: true }
      }) : [],
      wantApprove ? loadApprovals(req, projectIds) : null
    ])

    const items = []
    const push = it => items.push(it)

    // ---- 任务 ----
    const TASK_ACTION = {
      TODO: { key: 'task.queue', label: '排入生产', next: 'QUEUED' },
      QUEUED: { key: 'task.start', label: '开始', next: 'IN_PROGRESS' },
      IN_PROGRESS: { key: 'task.done', label: '完成', next: 'DONE' },
      REWORK: { key: 'task.start', label: '返工处理', next: 'IN_PROGRESS' }
    }
    for (const t of myTasks) {
      const overdue = t.dueDate && dayKey(t.dueDate) < todayKey
      const dueToday = t.dueDate && dayKey(t.dueDate) === todayKey
      // 收件箱里不急的任务不刷屏: 只有逾期/今日到期/高优/返工才进待办
      if (t.status === 'TODO' && !overdue && !dueToday && !['HIGH', 'URGENT'].includes(t.priority)) continue
      const act = TASK_ACTION[t.status]
      push({
        id: `task-${t.id}`,
        kind: 'TASK',
        type: `TASK_${t.status}`,
        severity: overdue || t.status === 'REWORK' ? 'URGENT' : (dueToday || ['HIGH', 'URGENT'].includes(t.priority) ? 'HIGH' : 'NORMAL'),
        title: t.title,
        sub: t.status === 'REWORK' ? '验收打回，需返工' : (overdue ? '已逾期' : dueToday ? '今天到期' : ''),
        project: t.project,
        dueDate: t.dueDate ? dayKey(t.dueDate) : null,
        refId: String(t.id),
        link: '/admin/tasks',
        action: act ? { ...act, taskId: String(t.id) } : null
      })
    }

    // ---- 草稿工时(按周聚合成一条, 别一天一条刷屏) ----
    if (draftTimesheets.length) {
      const hours = Number(draftTimesheets.reduce((s, t) => s + Number(t.hours || 0), 0).toFixed(1))
      push({
        id: 'timesheet-draft-week',
        kind: 'TIMESHEET',
        type: 'TIMESHEET_DRAFT',
        severity: 'HIGH',
        title: `本周有 ${draftTimesheets.length} 条草稿工时未提交`,
        sub: `合计 ${hours}h · ${ymd(weekStart)} 起`,
        project: null,
        dueDate: null,
        refId: draftTimesheets.map(t => String(t.id)).join(','),
        link: '/admin/timesheets?status=DRAFT',
        // 经理没有 timesheet.submit 权限(工时提交是工程师动作), 给跳转而不是就地按钮, 免得点了吃 403
        action: hasPermission(req.user, 'timesheet.submit')
          ? { key: 'timesheet.submitWeek', label: '一键提交', ids: draftTimesheets.map(t => String(t.id)) }
          : { key: 'timesheet.open', label: '去提交' }
      })
    }

    // ---- 待我审批(经理) ----
    const APPROVE_META = {
      timesheets: { title: '条工时待审批', link: '/admin/timesheets?status=SUBMITTED', label: '去审批', type: 'APPROVE_TIMESHEET' },
      tasksToVerify: { title: '个任务待验收', link: '/admin/tasks?status=DONE', label: '去验收', type: 'VERIFY_TASK' }
    }
    if (approvals) {
      for (const [key, meta] of Object.entries(APPROVE_META)) {
        const n = approvals[key]
        if (!n) continue
        push({
          id: `approve-${key}`,
          kind: 'APPROVAL',
          type: meta.type,
          severity: 'HIGH',
          title: `${n} ${meta.title}`,
          sub: '待我处理',
          project: null, dueDate: null, refId: '',
          link: meta.link,
          action: { key: 'approval.open', label: meta.label, count: n }
        })
      }
    }

    const RANK = { URGENT: 0, HIGH: 1, NORMAL: 2 }
    items.sort((a, b) => (RANK[a.severity] - RANK[b.severity]) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')))

    res.json({
      code: 0,
      message: 'ok',
      data: {
        items,
        counts: {
          total: items.length,
          mine: items.filter(i => i.kind !== 'APPROVAL').length,
          approve: items.filter(i => i.kind === 'APPROVAL').length,
          urgent: items.filter(i => i.severity === 'URGENT').length
        },
        hasEngineerProfile: !!engineer
      }
    })
  } catch (e) {
    console.error('[fde/me/todos]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
