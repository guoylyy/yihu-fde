// FDE 平台 - 工时 API（内部）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { logInternalAction } from '../../lib/audit.js'  // v2.1.7(#495) 强制开关切换/豁免留痕
import { internalAuth, requireRole, requirePermission, buildScopeWhere } from '../../lib/auth.js'
import { notifyChat } from '../../lib/chatNotify.js'
import { pushNotification } from '../../lib/notify.js'
import { recordActivity } from '../../lib/activity.js'
import { checkEntry, checkDayTotal, projectOpenForHours, canManageTimesheet, approvalBlocked, notifyPending, parseWorkDate } from '../../services/timesheetRules.js'

const userName = async (id) => (await prisma.user.findUnique({ where: { id: BigInt(id) }, select: { name: true } }))?.name || ''
// 录入 / 修改时只能存草稿或提交审批; 批准 / 驳回只走审批接口
const writableStatus = (s) => (['DRAFT', 'SUBMITTED'].includes(s) ? s : undefined)
const isManagerRole = (u) => ['ADMIN', 'MANAGER'].includes(u?.role)

const router = express.Router()
router.use(internalAuth)
// 工时：所有内部角色都能看
router.use(requirePermission('timesheet.access'))

const TIMESHEET_FIELDS = ['projectId', 'engineerId', 'workDate', 'hours', 'workContent', 'location', 'status', 'milestoneId', 'taskId', 'workCategory']

// v2.1.7(#492) 报工关联任务: taskId 与 workCategory 互斥(有任务挂任务, 无任务给原因分类); 都可空=旧客户端兼容
const WORK_CATEGORIES = ['ROUTINE', 'MEETING', 'OPS_SUPPORT', 'TRAINING']
async function resolveTaskLink(data, projectId, res) {
  if (data.taskId && data.workCategory) {
    res.status(400).json({ code: 1002, message: 'taskId 与 workCategory 互斥: 关联了任务就不需要无任务原因' })
    return false
  }
  if (data.workCategory !== undefined && data.workCategory !== null && data.workCategory !== '') {
    if (!WORK_CATEGORIES.includes(data.workCategory)) {
      res.status(400).json({ code: 1002, message: `workCategory 必须为 ${WORK_CATEGORIES.join('/')}` })
      return false
    }
  } else if (data.workCategory !== undefined) {
    data.workCategory = null
  }
  if (data.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: BigInt(data.taskId), projectId, deletedAt: null }, select: { id: true }
    })
    if (!task) {
      res.status(400).json({ code: 1002, message: '指定的任务不存在或不属于该项目' })
      return false
    }
    data.taskId = task.id
  } else if (data.taskId !== undefined) {
    data.taskId = null
  }
  return true
}

function pick(obj, fields) {
  const out = {}
  for (const k of fields) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

function toDateOrNull(v) {
  if (!v) return null
  if (v instanceof Date) return v
  return new Date(v)
}

/**
 * GET /api/fde/timesheets
 * 工时列表
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, status = '', from = '', to = '' } = req.query
    // v1.6.3(第三方反馈): 驼峰传参此前被静默忽略, 调用方被迫拉全量本地过滤 → 两种命名都收
    const project_id = req.query.project_id || req.query.projectId || ''
    const engineer_id = req.query.engineer_id || req.query.engineerId || ''
    const milestone_id = req.query.milestone_id || req.query.milestoneId || ''   // v1.9.3 里程碑筛选
    const page_size = Number(req.query.page_size || req.query.pageSize || 20)
    // offset 与 page 二选一, offset 优先(程序化调用方增量拉取用)
    const skip = req.query.offset !== undefined
      ? Math.max(0, Number(req.query.offset) || 0)
      : (Number(page) - 1) * page_size
    // 阶段 4: 按角色过滤数据范围
    const scopeWhere = await buildScopeWhere(req.user, 'timesheet')
    const where = { deletedAt: null, ...scopeWhere }
    // 非法 id 明确 400, 不再 500(此前 BigInt('null') 直接炸)
    try {
      if (project_id) where.projectId = BigInt(project_id)
      if (engineer_id) where.engineerId = BigInt(engineer_id)
      // v1.9.3: milestone_id=none 筛未关联里程碑的存量工时
      if (milestone_id) where.milestoneId = milestone_id === 'none' ? null : BigInt(milestone_id)
    } catch {
      return res.status(400).json({ code: 9002, message: 'projectId/engineerId/milestoneId 需为数字 id' })
    }
    if (status) where.status = status
    if (from || to) {
      where.workDate = {}
      if (from) where.workDate.gte = toDateOrNull(from)
      if (to) where.workDate.lte = toDateOrNull(to)
    }

    const [list, total, sumResult] = await Promise.all([
      prisma.timesheet.findMany({
        where,
        skip,
        take: Number(page_size),
        orderBy: { workDate: 'desc' },
        include: {
          project: { select: { id: true, code: true, name: true } },
          engineer: { include: { user: { select: { id: true, name: true } } } },
          task: { select: { id: true, title: true } },   // v2.1.7(#492) 报工关联任务
          milestone: { select: { id: true, name: true } }   // v1.9.3
        }
      }),
      prisma.timesheet.count({ where }),
      prisma.timesheet.aggregate({ where, _sum: { hours: true } })
    ])

    res.json({
      code: 0, message: 'ok',
      data: {
        list,
        total,
        page: Number(page),
        page_size: Number(page_size),
        totalHours: Number(sumResult._sum.hours || 0)
      }
    })
  } catch (e) {
    console.error('[fde/timesheets GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})


// ============ v2.1.7(#495) 报工任务关联: 覆盖率观察 + 强制开关 ============
const REQUIRE_TASK_KEY = 'timesheet.requireTask'
async function requireTaskEnabled() {
  const row = await prisma.appSetting.findUnique({ where: { key: REQUIRE_TASK_KEY } }).catch(() => null)
  return row?.value === 'true'
}

// GET /_meta/task-link-config — 所有内部用户可读(填报页决定是否隐藏"无任务"入口)
router.get('/_meta/task-link-config', async (req, res) => {
  try {
    res.json({ code: 0, message: 'ok', data: { requireTask: await requireTaskEnabled() } })
  } catch (e) { res.status(500).json({ code: 9001, message: e.message }) }
})

// PUT /_meta/task-link-config — 仅管理员; 切换留审计(公告/提前预告走线下流程)
router.put('/_meta/task-link-config', async (req, res) => {
  try {
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ code: 9003, message: '仅管理员可切换强制开关' })
    const value = req.body?.requireTask === true || req.body?.requireTask === 'true'
    await prisma.appSetting.upsert({
      where: { key: REQUIRE_TASK_KEY },
      update: { value: String(value), updatedBy: BigInt(req.user.id) },
      create: { key: REQUIRE_TASK_KEY, value: String(value), updatedBy: BigInt(req.user.id) }
    })
    logInternalAction(req, 'TIMESHEET_REQUIRE_TASK_TOGGLE', { resourceType: 'appSetting', details: { requireTask: value } })
    res.json({ code: 0, message: 'ok', data: { requireTask: value } })
  } catch (e) { res.status(500).json({ code: 9001, message: e.message }) }
})

// GET /_meta/task-link-coverage?weeks=4&projectId= — 按周覆盖率 + 项目/人下钻(窗口内)
router.get('/_meta/task-link-coverage', async (req, res) => {
  try {
    const weeks = Math.min(Math.max(Number(req.query.weeks) || 4, 1), 12)
    const now = new Date()
    // 周一为一周起点
    const monday = new Date(now); monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const start = new Date(monday); start.setDate(start.getDate() - (weeks - 1) * 7)

    const where = { deletedAt: null, workDate: { gte: start } }
    if (req.query.projectId) where.projectId = BigInt(req.query.projectId)
    const rows = await prisma.timesheet.findMany({
      where,
      select: { taskId: true, projectId: true, engineerId: true, workDate: true }
    })
    const weekKey = d => {
      const x = new Date(d); x.setHours(0, 0, 0, 0)
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
      // 本地日期拼 key(不能用 toISOString: UTC+8 下周一 00:00 会被算成前一天)
      const p2 = n => String(n).padStart(2, '0')
      return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`
    }
    const acc = (map, key, linked) => {
      if (!map[key]) map[key] = { total: 0, linked: 0 }
      map[key].total++; if (linked) map[key].linked++
    }
    const byWeek = {}, byProject = {}, byEngineer = {}
    for (const r of rows) {
      const linked = !!r.taskId
      acc(byWeek, weekKey(r.workDate), linked)
      acc(byProject, String(r.projectId), linked)
      acc(byEngineer, String(r.engineerId), linked)
    }
    const rate = o => o.total ? Math.round(o.linked / o.total * 100) : 0
    // 项目/工程师名字回查
    const [projects, engineers] = await Promise.all([
      prisma.project.findMany({ where: { id: { in: Object.keys(byProject).map(BigInt) } }, select: { id: true, name: true } }),
      prisma.engineer.findMany({ where: { id: { in: Object.keys(byEngineer).map(BigInt) } }, select: { id: true, user: { select: { name: true } } } })
    ])
    const pmap = Object.fromEntries(projects.map(x => [String(x.id), x.name]))
    const emap = Object.fromEntries(engineers.map(x => [String(x.id), x.user?.name]))
    res.json({
      code: 0, message: 'ok',
      data: {
        weeks: Object.entries(byWeek).map(([k, v]) => ({ weekStart: k, ...v, rate: rate(v) })).sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
        byProject: Object.entries(byProject).map(([k, v]) => ({ projectId: k, name: pmap[k] || k, ...v, rate: rate(v) })).sort((a, b) => a.rate - b.rate),
        byEngineer: Object.entries(byEngineer).map(([k, v]) => ({ engineerId: k, name: emap[k] || k, ...v, rate: rate(v) })).sort((a, b) => a.rate - b.rate),
        requireTask: await requireTaskEnabled()
      }
    })
  } catch (e) {
    console.error('[fde/timesheets coverage]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/timesheets/_meta/summary?from=&to=&groupBy=PROJECT|ENGINEER|DAY&projectId=&status=
 * 工时汇总（看板 + 周报 + 团队投入统计）
 *
 * groupBy 缺省 PROJECT, 与原来的返回结构保持一致(list 里仍带 projectId/project/totalHours/recordCount),
 * 老看板不用改。ENGINEER/DAY 是补给周报与团队投入统计的新口径。
 */
const SUMMARY_GROUPS = ['PROJECT', 'ENGINEER', 'DAY', 'TASK']   // v2.1.7(#492) TASK=按关联任务聚合

router.get('/_meta/summary', async (req, res) => {
  try {
    const { from = '', to = '', projectId = '', status = 'APPROVED' } = req.query
    const groupBy = String(req.query.groupBy || 'PROJECT').toUpperCase()
    if (!SUMMARY_GROUPS.includes(groupBy)) {
      return res.status(400).json({ code: 1001, message: `groupBy 必须为 ${SUMMARY_GROUPS.join('/')}` })
    }

    const where = { deletedAt: null }
    // status=ALL 时不限状态(想看含待审批的总投入); 缺省仍只统已通过的, 与原行为一致
    if (status && status !== 'ALL') where.status = status
    if (projectId) where.projectId = BigInt(projectId)
    // v2.1.0 小组制: 组维度投入统计(工时跟项目所属小组, 与 sub-groups /stats 口径一致)
    if (from || to) {
      where.workDate = {}
      if (from) where.workDate.gte = toDateOrNull(from)
      if (to) where.workDate.lte = toDateOrNull(to)
    }

    const byField = { PROJECT: 'projectId', ENGINEER: 'engineerId', DAY: 'workDate', TASK: 'taskId' }[groupBy]
    // TASK 维度: 未关联任务的工时归入 key=null 的「未关联」桶, 覆盖率观察也用得上
    const grouped = await prisma.timesheet.groupBy({
      by: [byField],
      where,
      _sum: { hours: true },
      _count: { _all: true }
    })

    let list
    if (groupBy === 'PROJECT') {
      const projects = await prisma.project.findMany({
        where: { id: { in: grouped.map(g => g.projectId) } },
        select: { id: true, code: true, name: true, customer: { select: { id: true, shortName: true, name: true } } }
      })
      const map = Object.fromEntries(projects.map(p => [p.id.toString(), p]))
      list = grouped.map(g => ({
        key: g.projectId.toString(),
        name: map[g.projectId.toString()]?.name || null,
        projectId: g.projectId.toString(),
        project: map[g.projectId.toString()] || null,
        totalHours: Number(g._sum.hours || 0),
        recordCount: g._count._all
      })).sort((a, b) => b.totalHours - a.totalHours)
    } else if (groupBy === 'ENGINEER') {
      const engineers = await prisma.engineer.findMany({
        where: { id: { in: grouped.map(g => g.engineerId) } },
        select: { id: true, level: true, city: true, user: { select: { id: true, name: true } } }
      })
      const map = Object.fromEntries(engineers.map(e => [e.id.toString(), e]))
      list = grouped.map(g => {
        const e = map[g.engineerId.toString()]
        return {
          key: g.engineerId.toString(),
          name: e?.user?.name || null,
          engineerId: g.engineerId.toString(),
          userId: e?.user?.id ? String(e.user.id) : null,
          level: e?.level || null,
          totalHours: Number(g._sum.hours || 0),
          recordCount: g._count._all
        }
      }).sort((a, b) => b.totalHours - a.totalHours)
    } else if (groupBy === 'TASK') {
      const taskIds = grouped.map(g => g.taskId).filter(Boolean)
      const tasks = taskIds.length ? await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, title: true, status: true, projectId: true }
      }) : []
      const map = Object.fromEntries(tasks.map(t => [t.id.toString(), t]))
      list = grouped.map(g => {
        const key = g.taskId ? g.taskId.toString() : 'UNLINKED'
        const t = g.taskId ? map[g.taskId.toString()] : null
        return {
          key,
          name: t ? t.title : '（未关联任务）',
          taskId: g.taskId ? g.taskId.toString() : null,
          taskStatus: t?.status || null,
          projectId: t?.projectId ? t.projectId.toString() : null,
          totalHours: Number(g._sum.hours || 0),
          recordCount: g._count._all
        }
      }).sort((a, b) => b.totalHours - a.totalHours)
    } else {
      list = grouped.map(g => {
        const d = g.workDate instanceof Date ? g.workDate : new Date(g.workDate)
        const key = d.toISOString().slice(0, 10)
        return { key, name: key, date: key, totalHours: Number(g._sum.hours || 0), recordCount: g._count._all }
      }).sort((a, b) => a.key.localeCompare(b.key))
    }

    const totalHours = list.reduce((s, x) => s + x.totalHours, 0)
    res.json({ code: 0, message: 'ok', data: { groupBy, totalHours, list } })
  } catch (e) {
    console.error('[fde/timesheets GET /_meta/summary]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/timesheets
 * 新建工时
 * body: { projectId, engineerId, workDate, hours, workContent, location?, status? }
 */
router.post('/', requirePermission('timesheet.create'), async (req, res) => {
  try {
    const data = pick(req.body, TIMESHEET_FIELDS)
    if (!data.projectId) return res.status(400).json({ code: 1001, message: '项目不能为空' })
    if (!data.workDate) return res.status(400).json({ code: 1003, message: '日期不能为空' })
    if (!data.hours) return res.status(400).json({ code: 1004, message: '工时不能为空' })
    if (!data.workContent) return res.status(400).json({ code: 1005, message: '工作内容不能为空' })

    const bad = checkEntry({ workDate: data.workDate, hours: data.hours })
    if (bad) return res.status(400).json({ code: 1004, message: bad })
    const closed = await projectOpenForHours(data.projectId)
    if (closed) return res.status(400).json({ code: 1009, message: closed })
    // 给别人报工只有经理 / 管理员可以
    if ((data.engineerId || req.body.engineerUserId) && !isManagerRole(req.user)) {
      const mine = await prisma.engineer.findUnique({ where: { userId: BigInt(req.user.id) }, select: { id: true } })
      const target = data.engineerId ? String(data.engineerId) : null
      if (req.body.engineerUserId && String(req.body.engineerUserId) !== String(req.user.id)) return res.status(403).json({ code: 1003, message: '只能给自己报工时' })
      if (target && String(mine?.id) !== target) return res.status(403).json({ code: 1003, message: '只能给自己报工时' })
    }

    data.projectId = BigInt(data.projectId)
    // engineerUserId: 按用户给项目成员报工(成员可能没有工程师档案, 如项目经理/销售), 懒建档后转 engineer.id
    if (!data.engineerId && req.body.engineerUserId) {
      let eng = await prisma.engineer.findUnique({ where: { userId: BigInt(req.body.engineerUserId) } })
      if (!eng) eng = await prisma.engineer.create({ data: { userId: BigInt(req.body.engineerUserId) } })
      data.engineerId = eng.id
    }
    // 不传 engineerId = 记自己的工时: 任何内部角色都可以(如 MANAGER 项目经理),
    // 没有工程师档案时自动补建(MANAGER 本就属于可派工角色, 见 engineers.js ENGINEER_ROLES)
    if (!data.engineerId) {
      let me = await prisma.engineer.findUnique({ where: { userId: BigInt(req.user.id) } })
      if (!me) {
        me = await prisma.engineer.create({ data: { userId: BigInt(req.user.id) } })
      }
      data.engineerId = me.id
    } else {
      data.engineerId = BigInt(data.engineerId)
    }
    data.workDate = parseWorkDate(data.workDate)
    const over = await checkDayTotal(data.engineerId, data.workDate, data.hours)
    if (over) return res.status(400).json({ code: 1004, message: over })
    // v1.9.3: 可选关联里程碑(须属同一项目, 防跨项目挂错)
    if (data.milestoneId) {
      const ms = await prisma.milestone.findFirst({
        where: { id: BigInt(data.milestoneId), projectId: data.projectId, deletedAt: null }, select: { id: true }
      })
      if (!ms) return res.status(400).json({ code: 1002, message: '指定的里程碑不属于该项目' })
      data.milestoneId = ms.id
    } else if (data.milestoneId !== undefined) {
      data.milestoneId = null
    }
    // v2.1.7(#492): 关联任务/无任务分类校验
    if (!(await resolveTaskLink(data, data.projectId, res))) return
    // v2.1.7(#495): 强制开关开启后无任务不可提交; 管理员豁免(可代选原因, 留审计)
    if (!data.taskId && await requireTaskEnabled()) {
      if (req.user?.role !== 'ADMIN') {
        return res.status(400).json({ code: 1005, message: '已开启「报工必须关联任务」, 请选择关联任务后提交' })
      }
      logInternalAction(req, 'TIMESHEET_REQUIRE_TASK_EXEMPT', { resourceType: 'timesheet', details: { workCategory: data.workCategory || null } })
    }

    // 2026-07-11: 新建工时默认直接进入待审批(SUBMITTED), 不再落草稿; 不能直接建成已批准 / 已驳回
    data.status = writableStatus(data.status) || 'SUBMITTED'

    const timesheet = await prisma.timesheet.create({ data, include: { project: { select: { name: true } } } })
    if (timesheet.status === 'SUBMITTED') notifyPending([timesheet], req.user.id, await userName(req.user.id)).catch(() => {})
    const { project, ...plain } = timesheet
    res.json({ code: 0, message: 'ok', data: plain })
  } catch (e) {
    if (e.code === 'P2003') return res.status(400).json({ code: 1006, message: '项目/工程师不存在' })
    console.error('[fde/timesheets POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/timesheets/:id
 * 更新工时
 */
router.put('/:id', requirePermission('timesheet.edit'), async (req, res) => {
  try {
    const existing = await prisma.timesheet.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '工时不存在' })
    if (!(await canManageTimesheet(req.user, existing))) return res.status(403).json({ code: 1003, message: '只能修改自己的工时' })
    // 已批准的工时不能再改(要改先让经理驳回), 否则审批形同虚设
    if (existing.status === 'APPROVED') return res.status(400).json({ code: 1007, message: '已批准的工时不能修改，请联系经理驳回后再改' })
    const data = pick(req.body, TIMESHEET_FIELDS)
    data.status = writableStatus(data.status)
    if (data.status === undefined) delete data.status
    // 被驳回的改完自动重新提交审批
    if (existing.status === 'REJECTED') Object.assign(data, { status: data.status || 'SUBMITTED', approvedBy: null, approvedAt: null, rejectReason: null })
    if ((data.engineerId || req.body.engineerUserId) && !isManagerRole(req.user)) return res.status(403).json({ code: 1003, message: '不能把工时改到别人名下' })
    const bad = checkEntry({ workDate: data.workDate, hours: data.hours })
    if (bad) return res.status(400).json({ code: 1004, message: bad })
    if (data.projectId && String(data.projectId) !== String(existing.projectId)) {
      const closed = await projectOpenForHours(data.projectId)
      if (closed) return res.status(400).json({ code: 1009, message: closed })
    }
    if (data.projectId) data.projectId = BigInt(data.projectId)
    if (data.milestoneId !== undefined) data.milestoneId = data.milestoneId ? BigInt(data.milestoneId) : null   // v1.9.3
    // 与创建一致: engineerUserId 按用户改记录人, 懒建档
    if (!data.engineerId && req.body.engineerUserId) {
      let eng = await prisma.engineer.findUnique({ where: { userId: BigInt(req.body.engineerUserId) } })
      if (!eng) eng = await prisma.engineer.create({ data: { userId: BigInt(req.body.engineerUserId) } })
      data.engineerId = eng.id
    }
    if (data.engineerId) data.engineerId = BigInt(data.engineerId)
    if (data.workDate) data.workDate = parseWorkDate(data.workDate)
    if (data.hours !== undefined || data.workDate || data.engineerId) {
      const over = await checkDayTotal(data.engineerId || existing.engineerId, data.workDate || existing.workDate, data.hours ?? existing.hours, existing.id)
      if (over) return res.status(400).json({ code: 1004, message: over })
    }
    // v2.1.7(#492): 关联任务/分类校验 —— 未传 projectId 时按原记录的项目校验
    if (data.taskId !== undefined || data.workCategory !== undefined) {
      let pidForCheck = data.projectId
      if (!pidForCheck) {
        const cur = await prisma.timesheet.findUnique({ where: { id: BigInt(req.params.id) }, select: { projectId: true } })
        if (!cur) return res.status(404).json({ code: 2004, message: '工时不存在' })
        pidForCheck = cur.projectId
      }
      if (!(await resolveTaskLink(data, pidForCheck, res))) return
    }
    const timesheet = await prisma.timesheet.update({
      where: { id: BigInt(req.params.id) },
      data,
      include: { project: { select: { name: true } } }
    })
    if (existing.status !== 'SUBMITTED' && timesheet.status === 'SUBMITTED') notifyPending([timesheet], req.user.id, await userName(req.user.id)).catch(() => {})
    const { project, ...plain } = timesheet
    res.json({ code: 0, message: 'ok', data: plain })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '工时不存在' })
    if (e.code === 'P2003') return res.status(400).json({ code: 1006, message: '项目/工程师不存在' })
    console.error('[fde/timesheets PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/timesheets/:id
 */
router.delete('/:id', requirePermission('timesheet.delete'), async (req, res) => {
  try {
    const existing = await prisma.timesheet.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '工时不存在' })
    if (!(await canManageTimesheet(req.user, existing))) return res.status(403).json({ code: 1003, message: '只能删除自己的工时' })
    if (existing.status === 'APPROVED' && req.user.role !== 'ADMIN') return res.status(400).json({ code: 1007, message: '已批准的工时不能删除，请联系管理员' })
    await prisma.timesheet.update({
      where: { id: BigInt(req.params.id) },
      data: { deletedAt: new Date() }
    })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '工时不存在' })
    console.error('[fde/timesheets DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/timesheets/:id/approve
 * 审批工时
 * body: { approved: true/false, reason?: string }
 *
 * 审批人就是当前操作人(不收 approvedBy, 防冒名); 只能审批自己范围内项目的工时, 不能审批自己的(管理员除外)
 * 状态必须是 SUBMITTED 或 DRAFT（向后兼容）；APPROVED/REJECTED 不可重复审批
 */
router.post('/:id/approve', requirePermission('timesheet.approve'), async (req, res) => {
  try {
    const approved = req.body.approved !== false
    const id = BigInt(req.params.id)

    // 查出工时 + 项目 manager
    const ts = await prisma.timesheet.findFirst({ where: { id, deletedAt: null } })
    if (!ts) return res.status(404).json({ code: 2004, message: '工时不存在' })
    const blocked = await approvalBlocked(req.user, ts)
    if (blocked) return res.status(blocked.status).json({ code: blocked.status === 400 ? 1007 : blocked.status === 403 ? 1003 : 2004, message: blocked.message })
    const reason = approved ? null : (String(req.body.reason || '').trim().slice(0, 500) || null)

    const timesheet = await prisma.timesheet.update({
      where: { id },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        approvedBy: BigInt(req.user.id),
        approvedAt: new Date(),
        rejectReason: reason
      }
    })

    // 群通知：工时审批
    const full = await prisma.timesheet.findUnique({
      where: { id },
      include: {
        project: { select: { name: true } },
        engineer: { include: { user: { select: { id: true, name: true } } } }
      }
    })
    notifyChat({
      event: 'timesheet.approved',
      data: {
        date: new Date(full.workDate).toISOString().slice(0, 10),
        hours: Number(full.hours),
        engineer: full.engineer?.user?.name || '-',
        project: full.project?.name || '-',
        result: approved ? '✅ 已批准' : '❌ 已驳回'
      }
    }).catch(e => console.error('[chat]', e.message))

    // 站内通知：给工程师
    if (full.engineer?.user) {
      pushNotification({
        userId: full.engineer.user.id,
        actorId: req.user.id,
        // v2.5.5(#912): 批准进每日摘要(噪音档), 驳回必看即时 —— 两种类型早在通道矩阵里, 不算新增
        type: approved ? 'TIMESHEET_APPROVED' : 'TIMESHEET_REJECTED',
        title: approved ? '✅ 工时已批准' : '❌ 工时被驳回',
        body: `${full.project?.name || ''} · ${new Date(full.workDate).toISOString().slice(0,10)} · ${full.hours}h${reason ? `\n驳回原因：${reason}` : ''}`,
        link: '/admin/timesheets?status=' + (approved ? 'APPROVED' : 'REJECTED'),
        data: {
          engineerName: full.engineer.user.name,
          date: new Date(full.workDate).toISOString().slice(0, 10),
          hours: Number(full.hours),
          result: approved ? 'APPROVED' : 'REJECTED',
          project: full.project?.name,
          reason: req.body.reason || null
        }
      }).catch(e => console.error('[notify]', e.message))
    }

    // 活动
    recordActivity({
      actorId: req.user.id,
      entity: 'timesheet',
      entityId: id,
      action: approved ? 'approved' : 'rejected',
      summary: `${approved ? '✅ 批准' : '❌ 驳回'} ${full.engineer?.user?.name || ''} 的工时 · ${full.project?.name || ''} · ${Number(full.hours)}h`
    }).catch(e => console.error('[activity]', e.message))

    res.json({ code: 0, message: 'ok', data: timesheet })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '工时不存在' })
    console.error('[fde/timesheets POST /:id/approve]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/timesheets/:id/submit
 * 提交工时（草稿 → 已提交）
 * 只有 DRAFT 状态可以提交
 */
/**
 * POST /api/fde/timesheets/submit-batch   { ids?: [] , from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 * v2.6.0(#959) 个人工作台「一键提交本周草稿」——只动本人的 DRAFT, 别人的/非草稿一律跳过。
 * 不传 ids 时默认提交本周(周一起)的全部草稿。
 */
router.post('/submit-batch', requirePermission('timesheet.submit'), async (req, res) => {
  try {
    const me = await prisma.engineer.findUnique({ where: { userId: BigInt(req.user.userId) } })
    if (!me) return res.status(400).json({ code: 1008, message: '当前账号没有工程师档案，无法提交工时' })

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean).map(v => BigInt(v)) : []
    const where = { engineerId: me.id, deletedAt: null, status: 'DRAFT' }
    if (ids.length) {
      where.id = { in: ids }
    } else {
      const now = new Date()
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
      const from = req.body?.from ? new Date(req.body.from + 'T00:00:00') : weekStart
      const to = req.body?.to ? new Date(req.body.to + 'T23:59:59') : new Date(weekStart.getTime() + 7 * 86400000 - 1)
      where.workDate = { gte: from, lte: to }
    }

    const rows = await prisma.timesheet.findMany({
      where,
      include: { project: { select: { name: true } } }
    })
    if (!rows.length) return res.json({ code: 0, message: 'ok', data: { submitted: 0, hours: 0 } })

    await prisma.timesheet.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { status: 'SUBMITTED' }
    })

    const hours = Number(rows.reduce((s, r) => s + Number(r.hours || 0), 0).toFixed(1))
    const name = await userName(req.user.id)
    notifyPending(rows, req.user.id, name).catch(() => {})
    // 批量只发一条汇总, 不一条一条刷屏(v1.6.2 通知疲劳教训)
    notifyChat({
      event: 'timesheet.pending',
      data: { engineer: name, project: `${rows.length} 条工时`, date: new Date().toISOString().slice(0, 10), hours }
    }).catch(e => console.error('[chat]', e.message))
    recordActivity({
      actorId: req.user.id,
      entity: 'timesheet',
      entityId: rows[0].id,
      action: 'submitted',
      summary: `${name} 批量提交 ${rows.length} 条工时待审批 · 合计 ${hours}h`
    }).catch(e => console.error('[activity]', e.message))

    res.json({ code: 0, message: 'ok', data: { submitted: rows.length, hours, ids: rows.map(r => String(r.id)) } })
  } catch (e) {
    console.error('[fde/timesheets POST /submit-batch]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.post('/:id/submit', requirePermission('timesheet.submit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const ts = await prisma.timesheet.findUnique({ where: { id } })
    if (!ts || ts.deletedAt) return res.status(404).json({ code: 2004, message: '工时不存在' })
    if (!(await canManageTimesheet(req.user, ts))) return res.status(403).json({ code: 1003, message: '只能提交自己的工时' })
    if (ts.status !== 'DRAFT') {
      return res.status(400).json({ code: 1007, message: `当前状态为 ${ts.status}，只有草稿可以提交` })
    }
    const timesheet = await prisma.timesheet.update({
      where: { id },
      data: { status: 'SUBMITTED' }
    })

    // 群通知：工时待审批
    const full = await prisma.timesheet.findUnique({
      where: { id },
      include: {
        project: { select: { name: true } },
        engineer: { include: { user: { select: { name: true } } } }
      }
    })
    notifyChat({
      event: 'timesheet.pending',
      data: {
        engineer: full.engineer?.user?.name || '-',
        project: full.project?.name || '-',
        date: new Date(full.workDate).toISOString().slice(0, 10),
        hours: Number(full.hours)
      }
    }).catch(e => console.error('[chat]', e.message))

    notifyPending([{ ...full, projectId: ts.projectId }], req.user.id, await userName(req.user.id)).catch(() => {})

    // 活动
    recordActivity({
      actorId: req.user.id,
      entity: 'timesheet',
      entityId: id,
      action: 'submitted',
      summary: `${full.engineer?.user?.name || ''} 提交工时待审批 · ${full.project?.name || ''} · ${Number(full.hours)}h`
    }).catch(e => console.error('[activity]', e.message))

    res.json({ code: 0, message: 'ok', data: timesheet })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '工时不存在' })
    console.error('[fde/timesheets POST /:id/submit]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/timesheets/_meta/pending
 * 待审批工时详情（供 dashboard 待办铃铛点击查看）
 */
router.get('/_meta/pending', async (req, res) => {
  try {
    const { page = 1, page_size = 10 } = req.query
    const where = { deletedAt: null, status: { in: ['DRAFT', 'SUBMITTED'] } }
    const [list, total] = await Promise.all([
      prisma.timesheet.findMany({
        where,
        orderBy: { workDate: 'desc' },
        skip: (Number(page) - 1) * Number(page_size),
        take: Number(page_size),
        include: {
          project: { select: { id: true, code: true, name: true } },
          engineer: { include: { user: { select: { id: true, name: true } } } }
        }
      }),
      prisma.timesheet.count({ where })
    ])
    res.json({ code: 0, message: 'ok', data: { list, total } })
  } catch (e) {
    console.error('[fde/timesheets /_meta/pending]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
