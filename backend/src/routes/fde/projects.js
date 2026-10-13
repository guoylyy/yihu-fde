// FDE 平台 - 项目管理 API(内部)
import { buildScopedWhere } from '../../lib/scopedQuery.js'
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission, buildScopeWhere, canAccessRecord, hasPermission } from '../../lib/auth.js'
import { notifyChat } from '../../lib/chatNotify.js'
import { pushNotification } from '../../lib/notify.js'
import { recordActivity } from '../../lib/activity.js'
import { resolveRepo, parseRepoUrl } from '../../lib/repo-parse.js'
import { syncAllRepositories } from '../../services/repoSync.js'
import { computeHealthForProjects, computeProjectHealth } from '../../services/projectHealth.js'
import { nextProjectCode } from '../../services/projectCode.js'
import { getTeamsByUserIds } from '../../lib/teams.js'
import { applyProjectVisibility, isArchivedStatus, buildCloseData, buildReopenData, ARCHIVED_STATUSES } from '../../services/projectArchive.js'
import { loadProjectRoadmap } from '../../services/roadmap.js'   // v2.8.0(#1143) 里程碑路径图
import { runsForProject } from '../../services/devDispatch.js'   // v2.9.0(#1162) 派工运行态
import { buildActiveWorkMap, fallbackActiveWork, redactActiveWork } from '../../services/activeWork.js'   // v2.12.0(#1254)

const router = express.Router()
router.use(internalAuth)
// 项目管理:ADMIN / PLATFORM / MANAGER / SALES / FDE_ENGINEER
// FDE_ENGINEER 通过 buildScopeWhere 只看自己参与的项目(ProjectMember)
router.use(requirePermission('project.access'))

const PROJECT_FIELDS = [
  'name', 'customerId', 'type', 'status', 'managerId',
  'startDate', 'endDate', 'budget', 'actualCost',
  'health', 'progress', 'description', 'coverImage', 'acceptanceConfig'
]

const ACCEPTANCE_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
function normalizeAcceptanceConfig(value) {
  if (value == null) return { risk_level: 'MEDIUM', involves_money: false, l2_key_paths: [] }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('acceptanceConfig 必须是对象')
  const risk_level = value.risk_level || 'MEDIUM'
  if (!ACCEPTANCE_RISK_LEVELS.includes(risk_level)) throw new Error('acceptanceConfig.risk_level 非法')
  return { risk_level, involves_money: Boolean(value.involves_money), l2_key_paths: Array.isArray(value.l2_key_paths) ? value.l2_key_paths.slice(0, 50).map(String) : [] }
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
 * 取一个在调用者数据范围内的项目; 不在范围内一律当"不存在"处理(404, 不泄露项目是否存在)
 * 给里程碑/问题/风险的列表接口用 —— 这几个是 MCP 工具的入口, 必须自己把住范围
 */
async function findScopedProject(req, projectId) {
  const scope = await buildScopeWhere(req.user, 'project')
  // v2.1.14 fix: AND 求交防 scope 的 id 条件覆盖 URL 项目 id (FDE_ENGINEER 的 project scope 含 id, spread 会覆盖 —— 串项目根因)
  return prisma.project.findFirst({ where: buildScopedWhere({ id: projectId, deletedAt: null }, scope) })
}

/**
 * 该项目是否在调用者的数据范围内。
 * 供项目详情做单条访问控制 —— 与列表/子资源共用 buildScopeWhere, 保证口径不分叉。
 */
export async function isProjectInScope(user, projectId) {
  const scope = await buildScopeWhere(user, 'project')
  if (!Object.keys(scope).length) return true   // ALL 范围, 不用再查库
  const hit = await prisma.project.findFirst({
    // v2.1.14 fix: AND 求交防 scope 的 id 条件覆盖 URL 项目 id
    where: buildScopedWhere({ id: projectId, deletedAt: null }, scope),
    select: { id: true }
  })
  return !!hit
}

/**
 * GET /api/fde/projects
 * 项目列表(搜索 + 分页 + 状态/健康度筛选)
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, page_size = 20, keyword = '', status = '', health = '', customer_id = '', manager_id = '', exclude_status = '' } = req.query
    const skip = (Number(page) - 1) * Number(page_size)
    // 阶段 4: 按角色过滤数据范围
    const scopeWhere = await buildScopeWhere(req.user, 'project')
    const where = { deletedAt: null, ...scopeWhere }
    // keyword 放 AND 里, 避免覆盖 scopeWhere 自带的 OR (MANAGER/SALES 范围过滤)
    if (keyword) where.AND = [{ OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }] }]
    // v2.5.5(#915): 归档态(CLOSED/CANCELLED)默认不进列表; archived=true 只看归档; 明确 status 筛选时原样
    // 已验收项目默认不进首页列表: 前端未选状态时传 exclude_status=ACCEPTED
    applyProjectVisibility(where, { archived: req.query.archived, status, exclude_status })
    // v1.4.x 活跃度档位筛选: HIGH ≥60 / MEDIUM 30-59 / LOW 1-29 / IDLE 0
    const activityRanges = { HIGH: { gte: 60 }, MEDIUM: { gte: 30, lte: 59 }, LOW: { gte: 1, lte: 29 }, IDLE: { equals: 0 } }
    if (req.query.activity && activityRanges[req.query.activity]) where.activityScore = activityRanges[req.query.activity]
    if (health) where.health = health
    if (customer_id) where.customerId = BigInt(customer_id)
    if (manager_id) where.managerId = BigInt(manager_id)  // 1.2.5: 按项目负责人筛选

    const [list, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take: Number(page_size),
        // v1.4.x: 默认按活跃度排序, 不活跃项目自动沉底; 同分按创建时间新前
        orderBy: [{ activityScore: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: { select: { id: true, name: true, shortName: true, industry: true } },
          manager: { select: { id: true, name: true } },
          members: {
            where: { leaveDate: null },
            include: {
              engineer: { include: { user: { select: { id: true, name: true, username: true } } } },
              user: { select: { id: true, name: true, username: true } }
            },
            orderBy: { joinDate: 'asc' }
          },
          _count: { select: { members: true, timesheets: true, milestones: true, issues: true } }
        }
      }),
      prisma.project.count({ where })
    ])

    // v1.3.0: 交付健康度自动红绿灯(按当前页项目批量计算)
    const healthMap = await computeHealthForProjects(list.map(p => p.id)).catch(() => new Map())

    // 1.2.5: 无 project.viewFinance 权限(FDE 工程师)不返任何金额字段
    const canViewFinance = hasPermission(req.user, 'project.viewFinance')
    // v2.0.8(#422): 当前用户对每个项目的置顶状态(查本人 membership 的 pinnedAt)
    // v2.1.1(#454): 非成员(管理员等)的个人置顶存 user_project_pins, 列表合并两处来源
    const myIdStr = String(req.user.id ?? '')
    const myPins = req.user.id
      ? await prisma.userProjectPin.findMany({ where: { userId: BigInt(req.user.id) }, select: { projectId: true } })
      : []
    const myPinSet = new Set(myPins.map(x => String(x.projectId)))
    const listEnriched = list.map(p => {
      const autoHealth = healthMap.get(String(p.id)) || null
      const myMember = (p.members || []).find(mm => {
        const uid = mm.userId != null ? String(mm.userId) : (mm.engineer?.user?.id != null ? String(mm.engineer.user.id) : '')
        return uid === myIdStr
      })
      return {
        ...p,
        pinned: !!(myMember?.pinnedAt) || myPinSet.has(String(p.id)),   // v2.0.8(#422)+v2.1.1(#454): 成员置顶或个人置顶
        budget: canViewFinance ? p.budget : undefined,
        actualCost: canViewFinance ? p.actualCost : undefined,
        autoHealth: autoHealth && !canViewFinance
          // 无财务权限的角色不看成本口径的信号(工时超投含金额), 灯色随之重算
          ? (() => {
              const signals = autoHealth.signals.filter(s => s.key !== 'hoursOver')
              const light = signals.some(s => s.level === 'RED') ? 'RED' : signals.some(s => s.level === 'YELLOW') ? 'YELLOW' : 'GREEN'
              return { light, signals }
            })()
          : autoHealth
      }
    })

    res.json({ code: 0, message: 'ok', data: { list: listEnriched, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    console.error('[fde/projects GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/projects/:id
 * 项目详情(含成员/里程碑/工时/交付物)
 */
router.get('/:id', async (req, res) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: BigInt(req.params.id), deletedAt: null },
      include: {
        // v2.1.6(#489): 带出联系人, 项目主页客户卡片用(PM 免跳转看对接人)
        customer: { include: { contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } } } },
        manager: { select: { id: true, name: true } },
        members: {
          orderBy: [{ leaveDate: 'asc' }, { joinDate: 'asc' }],
          include: {
            engineer: { include: { user: { select: { id: true, name: true, phone: true, email: true, role: true } } } },
            user: { select: { id: true, name: true, phone: true, email: true, role: true } }
          }
        },
        milestones: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
            owner: { select: { id: true, name: true, avatarUrl: true } }  // v1.9.3 负责人
          }
        },
        timesheets: {
          where: { deletedAt: null },
          orderBy: { workDate: 'desc' },
          take: 10,
          include: { engineer: { include: { user: { select: { id: true, name: true } } } } }
        },
        issues: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        // 项目主页聚合 —— 任务 / 风险 / 复盘
        tasks: {
          where: { deletedAt: null },
          orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
          include: { milestone: { select: { id: true, name: true } } }
        },
        risks: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
        repositories: { where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        review: true
      }
    })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })
    // v1.5.6: 项目成员带出所属团队(双轨: user 直挂 / engineer.user)
    {
      const memberUserIds = project.members.flatMap(m => [m.user?.id, m.engineer?.user?.id]).filter(Boolean)
      const teamMap = await getTeamsByUserIds(memberUserIds)
      for (const m of project.members) {
        if (m.user) m.user.teams = teamMap.get(String(m.user.id)) || []
        if (m.engineer?.user) m.engineer.user.teams = teamMap.get(String(m.engineer.user.id)) || []
      }
    }
    // 单条访问控制。
    //
    // 这里**必须**和 buildScopeWhere 走同一份判定, 否则详情页与它的子资源会分叉:
    // canAccessRecord 对 OWN_RECORDS 角色(FDE 工程师/销售)的 project 是直接 return true 的,
    // 而项目记录/里程碑/问题风险等子资源用的是 buildScopeWhere(只认成员关系) ——
    // 结果就是"页面打得开、记录是空的", 员工反馈的「同一个项目两个账号看到的内容不同」正是这个。
    // 改为用同一个 scope 再查一次: 两边由构造保证一致, 不靠两份逻辑各自对齐。
    if (!(await isProjectInScope(req.user, project.id))) {
      return res.status(403).json({ code: 1003, message: '无权访问该项目' })
    }
    // 1.2.5: 无 project.viewFinance 权限(FDE 工程师)裁掉财务相关内容
    // (预算/成本, 前端对应区块同步隐藏)
    if (!hasPermission(req.user, 'project.viewFinance')) {
      project.budget = undefined
      project.actualCost = undefined
    }
    // v1.3.0: 交付健康度自动红绿灯(详情页信号明细)
    const autoHealth = await computeProjectHealth(project.id).catch(() => null)
    if (autoHealth && !hasPermission(req.user, 'project.viewFinance')) {
      autoHealth.signals = autoHealth.signals.filter(s => s.key !== 'hoursOver')
      autoHealth.light = autoHealth.signals.some(s => s.level === 'RED') ? 'RED'
        : autoHealth.signals.some(s => s.level === 'YELLOW') ? 'YELLOW' : 'GREEN'
    }
    project.autoHealth = autoHealth
    project.acceptanceConfig = normalizeAcceptanceConfig(project.acceptanceConfig)
    // v2.12.0(#1254) 给全量任务批量注入 activeWork(2 条查询, 防 N+1)
    {
      const tIds = project.tasks.map(t => t.id)
      const awMap = await buildActiveWorkMap(tIds, {
        taskStartedAt: new Map(project.tasks.map(t => [t.id, { startedAt: t.startedAt }]))
      })
      const internal = ['ADMIN', 'PLATFORM', 'MANAGER', 'FDE_ENGINEER', 'SALES'].includes(req.user.role)
      for (const t of project.tasks) {
        const w = fallbackActiveWork(t, awMap.get(String(t.id)))
        t.activeWork = internal ? w : redactActiveWork(w)
      }
    }
    // v2.5.5(#915): 归档横幅显示关闭人姓名
    if (project.closedBy) {
      const closer = await prisma.user.findUnique({ where: { id: project.closedBy }, select: { name: true } }).catch(() => null)
      project.closedByName = closer?.name || null
    }
    res.json({ code: 0, message: 'ok', data: project })
  } catch (e) {
    console.error('[fde/projects GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/projects/_meta/stats
 */
router.get('/_meta/stats', async (req, res) => {
  try {
    // v2.5.5(#915): total/byHealth 只算在管(非归档)项目; 归档数单独给 archived, byStatus 全量(前端按需取 CLOSED/CANCELLED)
    const base = { deletedAt: null }
    const activeWhere = { ...base, status: { notIn: ARCHIVED_STATUSES } }
    const [total, archived, byStatus, byHealth] = await Promise.all([
      prisma.project.count({ where: activeWhere }),
      prisma.project.count({ where: { ...base, status: { in: ARCHIVED_STATUSES } } }),
      prisma.project.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      prisma.project.groupBy({ by: ['health'], where: { ...activeWhere, health: { not: null } }, _count: { _all: true } })
    ])
    res.json({
      code: 0, message: 'ok',
      data: {
        total,
        archived,
        byStatus: byStatus.map(b => ({ status: b.status, count: b._count._all })),
        byHealth: byHealth.map(b => ({ health: b.health, count: b._count._all }))
      }
    })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/projects
 * 新建项目(项目编号自动生成:{PROJECT_CODE_PREFIX}-{year}-{seq},不需手填)
 * body: { name, customerId, type?, status?, managerId?, startDate?, endDate?, budget?, description? }
 */
router.post('/', requirePermission('project.create'), async (req, res) => {
  try {
    const data = pick(req.body, PROJECT_FIELDS)
    if (!data.name) return res.status(400).json({ code: 1002, message: '项目名称不能为空' })
    if (!data.customerId) return res.status(400).json({ code: 1003, message: '客户不能为空' })

    // BigInt 转换
    if (data.customerId) data.customerId = BigInt(data.customerId)
    if (data.managerId) data.managerId = BigInt(data.managerId)
    if (data.startDate) data.startDate = toDateOrNull(data.startDate)
    if (data.endDate) data.endDate = toDateOrNull(data.endDate)
    if (data.acceptanceConfig !== undefined) {
      try { data.acceptanceConfig = normalizeAcceptanceConfig(data.acceptanceConfig) }
      catch (e) { return res.status(400).json({ code: 1002, message: e.message }) }
    }

    // 默认 createdBy
    data.createdBy = req.user?.id ? BigInt(req.user.id) : BigInt(1)

    // 默认进度/健康度
    if (!data.health) data.health = 'GREEN'
    if (data.progress === undefined) data.progress = 0

    // 自动生成项目编号 (nextProjectCode 是 max+1, 并发下会撞 P2002;
    // 重试 5 次 —— 2026-09-10 #855: 并行集成测试 3+ 套件同时建项目时 2 次不够)
    let project
    for (let i = 0; i < 5; i++) {
      data.code = await nextProjectCode()
      try {
        project = await prisma.project.create({ data })
        break
      } catch (e) {
        if (e.code === 'P2002' && i < 4) continue
        throw e
      }
    }

    // 群通知
    const customer = await prisma.customer.findUnique({ where: { id: project.customerId } })
    const manager = project.managerId ? await prisma.user.findUnique({ where: { id: project.managerId } }) : null
    notifyChat({
      event: 'project.created',
      data: {
        name: project.name,
        customer: customer?.name || '-',
        manager: manager?.name || '-',
        budget: project.budget ? `¥${Number(project.budget).toLocaleString('zh-CN')}` : '-'
      }
    }).catch(e => console.error('[chat]', e.message))

    res.json({ code: 0, message: 'ok', data: project })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 1004, message: '项目编号已存在' })
    if (e.code === 'P2003') return res.status(400).json({ code: 1005, message: '客户不存在' })
    console.error('[fde/projects POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/projects/:id
 * 更新项目(customerId 锁定,不允许改客户 - 历史项目不可改归属)
 */
router.put('/:id', requirePermission('project.edit'), async (req, res) => {
  try {
    const data = pick(req.body, PROJECT_FIELDS)
    // 客户、code、createdBy 不可改
    delete data.customerId
    delete data.code
    delete data.createdBy

    if (data.managerId) data.managerId = BigInt(data.managerId)
    if (data.startDate) data.startDate = toDateOrNull(data.startDate)
    if (data.endDate) data.endDate = toDateOrNull(data.endDate)

    // 阶段 4: MANAGER 只能改自己负责的项目(managerId/创建人/成员均视为负责)
    const existing = await prisma.project.findUnique({
      where: { id: BigInt(req.params.id) },
      include: { members: { select: { userId: true } } }
    })
    if (!existing) return res.status(404).json({ code: 2004, message: '项目不存在' })
    // 同上: 与 buildScopeWhere 同源判定。原来走 canAccessRecord, 销售(OWN_RECORDS)会直接放行,
    // 等于任何销售都能改别人的项目 —— 与列表里"只看自己创建/自己线索转化的"口径对不上。
    if (!(await isProjectInScope(req.user, existing.id))) {
      return res.status(403).json({ code: 1003, message: '无权修改该项目' })
    }

    // v2.5.5(#915): 经普通编辑把状态改成/改出 CLOSED 时, 同步关闭字段, 与 close/reopen 接口口径一致
    if (data.status && data.status !== existing.status) {
      if (data.status === 'CLOSED') Object.assign(data, buildCloseData({ fromStatus: existing.status, actorId: req.user.id, reason: req.body?.closeReason }))
      else if (existing.status === 'CLOSED') Object.assign(data, { statusBeforeClose: null, closedAt: null, closedBy: null, closeReason: null })
    }

    const project = await prisma.project.update({
      where: { id: BigInt(req.params.id) },
      data
    })

    // 活动
    if (data.status) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'project',
        entityId: project.id,
        action: 'status_changed',
        summary: `项目 "${project.name}" 状态：${existing.status} → ${data.status}`,
        data: { from: existing.status, to: data.status }
      })
    }

    // 群通知:状态变更
    if (data.status) {
      notifyChat({
        event: 'project.status_changed',
        data: { name: project.name, oldStatus: existing.status, newStatus: data.status }
      }).catch(e => console.error('[chat]', e.message))

      // 站内通知:给项目经理
      if (project.managerId) {
        const mgr = await prisma.user.findFirst({
          where: { engineer: { id: project.managerId } },
          select: { id: true }
        })
        if (mgr) {
          pushNotification({
            userId: mgr.id,
            type: 'PROJECT_STATUS_CHANGED',
            title: '🔄 项目状态变更',
            body: `${project.name} → ${data.status}`,
            link: `/admin/projects/${project.id}`
          }).catch(e => console.error('[notify]', e.message))
        }
      }
    }

    res.json({ code: 0, message: 'ok', data: project })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '项目不存在' })
    if (e.code === 'P2003') return res.status(400).json({ code: 1005, message: '客户不存在' })
    console.error('[fde/projects PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * v2.5.5(#915) 关闭 / 恢复项目
 * POST /api/fde/projects/:id/close   { reason? }   权限 project.edit + 项目在本人范围内(与编辑同口径)
 * POST /api/fde/projects/:id/reopen                 同上
 * 关闭 = status→CLOSED + closedAt/closedBy/closeReason/statusBeforeClose; 任务/工时/里程碑等全部保留, 不物理删除
 * 恢复 = 回到 statusBeforeClose(缺省 IN_PROGRESS), 清空关闭字段
 */
router.post('/:id/close', requirePermission('project.edit'), async (req, res) => {
  try {
    const existing = await prisma.project.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '项目不存在' })
    if (!(await isProjectInScope(req.user, existing.id))) return res.status(403).json({ code: 1003, message: '无权关闭该项目' })
    if (isArchivedStatus(existing.status)) return res.status(400).json({ code: 1002, message: `项目已处于归档态(${existing.status})` })
    const data = buildCloseData({ fromStatus: existing.status, actorId: req.user.id, reason: req.body?.reason })
    const project = await prisma.project.update({ where: { id: existing.id }, data })
    await recordActivity({
      actorId: req.user.id, entity: 'project', entityId: project.id, action: 'closed',
      summary: `关闭项目 "${project.name}"${data.closeReason ? `：${data.closeReason}` : ''}`,
      data: { from: existing.status, to: 'CLOSED', reason: data.closeReason }
    })
    if (project.managerId) {
      pushNotification({
        userId: project.managerId, actorId: req.user.id, type: 'PROJECT_STATUS_CHANGED',
        title: '📦 项目已关闭归档', body: `${project.name}${data.closeReason ? `：${data.closeReason}` : ''}`, link: `/admin/projects/${project.id}`
      }).catch(e => console.error('[notify]', e.message))
    }
    res.json({ code: 0, message: 'ok', data: project })
  } catch (e) {
    console.error('[fde/projects POST /:id/close]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.post('/:id/reopen', requirePermission('project.edit'), async (req, res) => {
  try {
    const existing = await prisma.project.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '项目不存在' })
    if (!(await isProjectInScope(req.user, existing.id))) return res.status(403).json({ code: 1003, message: '无权恢复该项目' })
    if (!isArchivedStatus(existing.status)) return res.status(400).json({ code: 1002, message: '项目不在归档态, 无需恢复' })
    const data = buildReopenData(existing)
    const project = await prisma.project.update({ where: { id: existing.id }, data })
    await recordActivity({
      actorId: req.user.id, entity: 'project', entityId: project.id, action: 'reopened',
      summary: `恢复项目 "${project.name}" 为 ${data.status}`,
      data: { from: existing.status, to: data.status }
    })
    res.json({ code: 0, message: 'ok', data: project })
  } catch (e) {
    console.error('[fde/projects POST /:id/reopen]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/projects/:id
 * 软删除项目
 */
router.delete('/:id', requirePermission('project.delete'), async (req, res) => {
  try {
    await prisma.project.update({
      where: { id: BigInt(req.params.id) },
      data: { deletedAt: new Date() }
    })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '项目不存在' })
    console.error('[fde/projects DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/projects/_meta/available-users?keyword=&role=
 * 列出可加入项目的活跃用户 (所有角色, 排除已加入当前项目的)
 * 返回: [{ id, name, role, engineerId? }]
 */
router.get('/_meta/available-users', requirePermission('project.manageMembers'), async (req, res) => {
  try {
    const { keyword = '', role = '', projectId = '' } = req.query
    const where = { status: 1, deletedAt: null }
    if (keyword) where.OR = [{ name: { contains: keyword } }, { username: { contains: keyword } }]
    if (role) where.role = role

    // 排除已加入项目且未离职的成员
    let excludeUserIds = []
    if (projectId) {
      const joined = await prisma.projectMember.findMany({
        where: { projectId: BigInt(projectId), leaveDate: null, userId: { not: null } },
        select: { userId: true }
      })
      excludeUserIds = joined.map(j => j.userId)
    }
    if (excludeUserIds.length) where.id = { notIn: excludeUserIds }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, username: true, role: true, phone: true,
        engineer: { select: { id: true, level: true, city: true } }
      },
      orderBy: { name: 'asc' },
      take: 200
    })
    res.json({
      code: 0,
      data: users.map(u => ({
        id: u.id.toString(),
        name: u.name,
        username: u.username,
        role: u.role,
        phone: u.phone,
        engineerId: u.engineer?.id?.toString() || null,
        level: u.engineer?.level || null,
        city: u.engineer?.city || null
      }))
    })
  } catch (e) {
    console.error('[fde/projects GET /_meta/available-users]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/projects/:id/pin   v2.0.8(#422)
 * 本人置顶/取消置顶该项目 (成员写本人 membership 的 pinnedAt, 个人维度互不影响)
 * v2.1.1(#454): 非成员(管理员/平台等)也可置顶 —— 有项目可见权即可, 存 user_project_pins(纯个人 UI 偏好)
 */
router.put('/:id/pin', async (req, res) => {
  try {
    const myId = BigInt(req.user.id)
    const projectId = BigInt(req.params.id)
    const member = await prisma.projectMember.findFirst({
      where: { projectId, leaveDate: null, OR: [{ userId: myId }, { engineer: { userId: myId } }] }
    })
    if (member) {
      const updated = await prisma.projectMember.update({
        where: { id: member.id },
        data: { pinnedAt: member.pinnedAt ? null : new Date() }
      })
      return res.json({ code: 0, message: 'ok', data: { pinned: !!updated.pinnedAt } })
    }
    // 非成员: 按角色数据范围校验可见性(管理员/平台全量, 其余角色看不到的项目自然 403)
    const scope = await buildScopeWhere(req.user, 'project')
    const proj = await prisma.project.findFirst({
      // v2.1.14 fix: AND 求交防 scope 的 id 条件覆盖 URL 项目 id
      where: buildScopedWhere({ id: projectId, deletedAt: null }, scope), select: { id: true }
    })
    if (!proj) return res.status(403).json({ code: 2003, message: '无权查看该项目, 不能置顶' })
    const existing = await prisma.userProjectPin.findUnique({
      where: { userId_projectId: { userId: myId, projectId } }
    })
    if (existing) {
      await prisma.userProjectPin.delete({ where: { id: existing.id } })
      return res.json({ code: 0, message: 'ok', data: { pinned: false } })
    }
    await prisma.userProjectPin.create({ data: { userId: myId, projectId } })
    res.json({ code: 0, message: 'ok', data: { pinned: true } })
  } catch (e) {
    console.error('[fde/projects PUT /:id/pin]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/projects/:id/members
 * 添加项目成员 - 2026-07-03 改造: 任何角色都能加入 (不只是工程师)
 * body: { userId, roleInProject?, joinDate? }
 * 兼容: body.engineerId 仍可接收 (查 engineer.userId 后入库)
 */
router.post('/:id/members', requirePermission('project.manageMembers'), async (req, res) => {
  try {
    let { userId, engineerId, roleInProject = 'MEMBER', joinDate } = req.body

    // 兼容老调用: engineerId → 查 engineer 拿 userId
    if (!userId && engineerId) {
      const eng = await prisma.engineer.findUnique({
        where: { id: BigInt(engineerId) },
        select: { userId: true }
      })
      if (!eng) return res.status(404).json({ code: 2004, message: '工程师不存在' })
      userId = eng.userId.toString()
    }

    if (!userId) return res.status(400).json({ code: 1001, message: 'userId 不能为空 (老调用传 engineerId)' })

    if (!['PM', 'ARCHITECT', 'DEV', 'QA', 'OBSERVER', 'FDE', 'CLIENT'].includes(roleInProject)) {
      return res.status(400).json({ code: 1007, message: '角色必须是 PM/ARCHITECT/DEV/QA/OBSERVER/FDE/CLIENT' })
    }

    // 校验 user 存在且状态正常
    const user = await prisma.user.findFirst({
      where: { id: BigInt(userId), status: 1, deletedAt: null },
      select: { id: true, name: true, role: true }
    })
    if (!user) return res.status(404).json({ code: 2004, message: '用户不存在或已禁用' })

    // 反查 engineer (如果有), 用于 buildScopeWhere (FDE 工程师项目过滤靠 engineerId)
    // 注：上面解构已有 engineerId 字段，复用它，不重新声明
    const eng = await prisma.engineer.findUnique({ where: { userId: BigInt(userId) } })
    if (eng) engineerId = eng.id
    else engineerId = null

    const member = await prisma.projectMember.create({
      data: {
        projectId: BigInt(req.params.id),
        userId: BigInt(userId),
        engineerId,
        roleInProject,
        joinDate: joinDate ? toDateOrNull(joinDate) : new Date()
      }
    })

    // 活动记录
    await recordActivity({
      actorId: req.user.id,
      entity: 'project',
      entityId: BigInt(req.params.id),
      action: 'assigned',
      summary: `${user.name} 加入项目(${roleInProject}, ${user.role})`
    })

    // 2026-07-07 P1-2: 主动给被加入人发通知（管理员加自己就不发）
    // 从项目查代码，拿项目名作为通知内容上下文
    const projectInfo = await prisma.project.findUnique({
      where: { id: BigInt(req.params.id) },
      select: { id: true, code: true, name: true, managerId: true }
    })
    const actorId = String(req.user.id)
    if (projectInfo && actorId !== String(userId)) {
      try {
        // v2.5.5(#912) 改走 pushNotification, 让分档/用户开关生效(此前直写 notifications 表绕过了偏好)
        await pushNotification({
          userId: BigInt(userId),
          actorId: req.user.id,
          type: 'PROJECT_MEMBER_ADDED',
          title: `你被加入项目「${projectInfo.name}」`,
          body: `${req.user.name || req.user.username || '管理员'} 把你加为项目成员（角色: ${roleInProject}）`,
          link: `/admin/projects/${projectInfo.id}`,
          data: {
            projectId: String(projectInfo.id),
            projectCode: projectInfo.code,
            projectName: projectInfo.name,
            roleInProject,
            addedBy: req.user.name || req.user.username
          }
        })
      } catch (notifErr) {
        console.error('[P1-2] 通知发送失败:', notifErr.message)
        // 通知失败不影响成员添加本身
      }
    }

    res.json({ code: 0, message: 'ok', data: { ...member, user } })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 1006, message: '该用户已在项目中' })
    console.error('[fde/projects POST /:id/members]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/projects/:projectId/members/:memberId
 * 修改成员角色 / 加入 / 退出日期
 * body: { roleInProject?, joinDate?, leaveDate?, reactivate? }
 *   reactivate=true 会清空 leaveDate (重新加入)
 */
router.put('/:projectId/members/:memberId', requirePermission('project.manageMembers'), async (req, res) => {
  try {
    const { roleInProject, joinDate, leaveDate, reactivate } = req.body
    const data = {}
    if (roleInProject) {
      if (!['PM', 'ARCHITECT', 'DEV', 'QA', 'OBSERVER'].includes(roleInProject)) {
        return res.status(400).json({ code: 1007, message: '角色必须是 PM/ARCHITECT/DEV/QA/OBSERVER' })
      }
      data.roleInProject = roleInProject
    }
    if (joinDate !== undefined) data.joinDate = joinDate ? toDateOrNull(joinDate) : null
    if (leaveDate !== undefined) data.leaveDate = leaveDate ? toDateOrNull(leaveDate) : null
    if (reactivate === true) {
      data.leaveDate = null
      if (!joinDate) data.joinDate = new Date()
    }

    const old = await prisma.projectMember.findUnique({ where: { id: BigInt(req.params.memberId) } })
    const member = await prisma.projectMember.update({
      where: { id: BigInt(req.params.memberId) },
      data
    })

    // 活动记录
    const eng = await prisma.engineer.findUnique({
      where: { id: old.engineerId },
      include: { user: { select: { name: true } } }
    })
    if (reactivate) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'project',
        entityId: old.projectId,
        action: 'assigned',
        summary: `${eng?.user?.name || '工程师'} 重新加入项目`
      })
    } else if (leaveDate) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'project',
        entityId: old.projectId,
        action: 'updated',
        summary: `${eng?.user?.name || '工程师'} 退出项目`
      })
    } else if (roleInProject) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'project',
        entityId: old.projectId,
        action: 'updated',
        summary: `${eng?.user?.name || '工程师'} 角色变更为 ${roleInProject}`
      })
    }

    // 2026-07-07 P1-2: reactivate / 角色变更 给当事人发通知
    if (reactivate || roleInProject || leaveDate) {
      const projectInfo = await prisma.project.findUnique({
        where: { id: old.projectId },
        select: { id: true, code: true, name: true }
      })
      if (projectInfo) {
        const actorId = String(req.user.id)
        const targetUserId = old.userId ? String(old.userId) : null
        const targetEngUserId = eng?.userId ? String(eng.userId) : null
        const notifyUserId = targetEngUserId || targetUserId
        if (notifyUserId && notifyUserId !== actorId) {
          try {
            let title, body
            if (reactivate) {
              title = `你被重新加入项目「${projectInfo.name}」`
              body = `${req.user.name || req.user.username || '管理员'} 让你重新加入项目`
            } else if (leaveDate) {
              title = `你已退出项目「${projectInfo.name}」`
              body = `${req.user.name || req.user.username || '管理员'} 将你标记为退出`
            } else {
              title = `项目「${projectInfo.name}」角色有变更`
              body = `项目角色变更为 ${roleInProject}`
            }
            await pushNotification({
              userId: BigInt(notifyUserId),
              actorId: req.user.id,
              type: reactivate ? 'PROJECT_MEMBER_ADDED' : leaveDate ? 'PROJECT_MEMBER_REMOVED' : 'PROJECT_ROLE_CHANGED',
              title,
              body,
              link: `/admin/projects/${projectInfo.id}`,
              data: {
                projectId: String(projectInfo.id),
                projectCode: projectInfo.code,
                projectName: projectInfo.name,
                changedBy: req.user.name || req.user.username
              }
            })
          } catch (e) {
            console.error('[P1-2 reactivate 通知] 发送失败:', e.message)
          }
        }
      }
    }

    res.json({ code: 0, message: 'ok', data: member })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '成员不存在' })
    console.error('[fde/projects PUT /:id/members/:mid]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/projects/:projectId/members/:memberId
 * 硬删除成员记录(仅 ADMIN 可用,日常使用 PUT 设 leaveDate)
 */
router.delete('/:projectId/members/:memberId', requirePermission('project.manageMembers'), async (req, res) => {
  try {
    const m = await prisma.projectMember.findUnique({ where: { id: BigInt(req.params.memberId) } })
    if (!m) return res.status(404).json({ code: 2004, message: '成员不存在' })
    await prisma.projectMember.delete({ where: { id: BigInt(req.params.memberId) } })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '成员不存在' })
    console.error('[fde/projects DELETE /:projectId/members/:memberId]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ============================================================
// 项目里程碑 CRUD (2026-07-03)
// 复用 project.edit 权限
// ============================================================
const MILESTONE_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED']
function toDateOrNullMilestone(v) {
  if (!v) return null
  if (v instanceof Date) return v
  return new Date(v)
}

/**
 * GET /api/fde/projects/:projectId/milestones?status=
 * 里程碑列表 —— 此前只能从项目详情里整包捞, 智能体/移动端要单独查
 */
router.get('/:projectId/milestones', async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await findScopedProject(req, projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })

    const { status = '', keyword = '' } = req.query
    if (status && !MILESTONE_STATUSES.includes(status)) {
      return res.status(400).json({ code: 1002, message: `状态必须为 ${MILESTONE_STATUSES.join('/')}` })
    }
    // v2.1.2(#465): 按标题/描述关键词过滤
    const kwWhere = keyword ? { OR: [{ name: { contains: keyword } }, { description: { contains: keyword } }] } : {}
    const list = await prisma.milestone.findMany({
      where: { projectId, deletedAt: null, ...(status ? { status } : {}), ...kwWhere },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      // v1.9.3: 负责人(名字+头像) + 任务完成进度(done/total)
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        tasks: { where: { deletedAt: null }, select: { status: true } }
      }
    })
    const enriched = list.map(({ tasks, ...m }) => ({
      ...m,
      taskTotal: tasks.length,
      taskDone: tasks.filter(t => t.status === 'DONE' || t.status === 'VERIFIED').length
    }))
    res.json({ code: 0, message: 'ok', data: { total: enriched.length, list: enriched } })
  } catch (e) {
    console.error('[fde/projects GET /:projectId/milestones]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/projects/:projectId/roadmap?milestoneId=182|none
 * v2.8.0(#1143) 里程碑路径图聚合: nodes/edges/topoOrder/ready/blocked/entries/terminals/criticalPath/mermaid
 * + milestones[].stats(各里程碑 总/完成/可开始/阻塞) —— 前端规划 Tab 与 MCP get_milestone_roadmap 共用
 * 不传 milestoneId = 整个项目一张图; 传了 = 该里程碑的任务 + 跨里程碑前置(external 节点)
 */
router.get('/:projectId/roadmap', requirePermission('task.view'), async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await findScopedProject(req, projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })
    const [data, dev] = await Promise.all([
      loadProjectRoadmap(projectId, { milestoneId: req.query.milestoneId || undefined }),
      runsForProject(projectId).catch(() => ({ runs: {}, dispatches: [], activeDispatchCount: 0 }))   // v2.9.0(#1162) 派工运行态; 坏了不拖垮路径图
    ])
    if (!data) return res.status(404).json({ code: 2004, message: '里程碑不存在' })
    res.json({ code: 0, data: { project: { id: String(project.id), code: project.code, name: project.name }, ...data, ...dev } })
  } catch (e) {
    console.error('[fde/projects GET /:projectId/roadmap]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/projects/:projectId/milestones
 * 新增里程碑
 */
router.post('/:projectId/milestones', requirePermission('milestone.manage'), async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })

    const { name, description, plannedDate, actualDate, status, ownerId, goal } = req.body || {}
    if (!name || !name.trim()) return res.status(400).json({ code: 1001, message: '里程碑名称不能为空' })
    if (status && !MILESTONE_STATUSES.includes(status)) {
      return res.status(400).json({ code: 1002, message: `状态必须为 ${MILESTONE_STATUSES.join('/')}` })
    }

    // 2026-07-03: sortOrder 默认追加到末尾 (现有 active 里程碑数量)
    const maxOrder = await prisma.milestone.aggregate({
      where: { projectId, deletedAt: null },
      _max: { sortOrder: true }
    })
    const sortOrder = (maxOrder._max.sortOrder || 0) + 1

    // 2026-07-03: 状态改 COMPLETED 自动填 actualDate 为今天
    const finalActualDate = toDateOrNullMilestone(actualDate) || (status === 'COMPLETED' ? new Date() : null)

    const m = await prisma.milestone.create({
      data: {
        projectId,
        name: name.trim(),
        description: description || null,
        goal: goal ? String(goal).slice(0, 2000) : null,   // v2.8.0(#1143) 完成定义
        plannedDate: toDateOrNullMilestone(plannedDate),
        actualDate: finalActualDate,
        status: status || 'PENDING',
        ownerId: ownerId ? BigInt(ownerId) : null,   // v1.9.3 里程碑负责人
        sortOrder
      }
    })
    recordActivity({
      actorId: BigInt(req.user.id), entity: 'milestone', entityId: m.id,
      action: 'created', summary: `新增里程碑 "${m.name}"`
    })
    res.json({ code: 0, data: m })
  } catch (e) {
    console.error('[fde/projects POST /:projectId/milestones]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/projects/:projectId/milestones/:id
 * 编辑里程碑
 */
router.put('/:projectId/milestones/:id', requirePermission('milestone.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.milestone.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '里程碑不存在' })

    const { name, description, plannedDate, actualDate, status, ownerId, goal } = req.body || {}
    const data = {}
    if (goal !== undefined) data.goal = goal ? String(goal).slice(0, 2000) : null   // v2.8.0(#1143) 完成定义
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ code: 1001, message: '里程碑名称不能为空' })
      data.name = name.trim()
    }
    if (ownerId !== undefined) data.ownerId = ownerId ? BigInt(ownerId) : null   // v1.9.3 负责人
    if (description !== undefined) data.description = description || null
    if (plannedDate !== undefined) data.plannedDate = toDateOrNullMilestone(plannedDate)
    if (actualDate !== undefined) data.actualDate = toDateOrNullMilestone(actualDate)
    if (status !== undefined) {
      if (!MILESTONE_STATUSES.includes(status)) {
        return res.status(400).json({ code: 1002, message: `状态必须为 ${MILESTONE_STATUSES.join('/')}` })
      }
      data.status = status
      // 状态从非 COMPLETED → COMPLETED 自动填实际日期为今天
      if (status === 'COMPLETED' && existing.status !== 'COMPLETED' && !actualDate) {
        data.actualDate = new Date()
      }
    }
    const updated = await prisma.milestone.update({ where: { id }, data })
    recordActivity({
      actorId: BigInt(req.user.id), entity: 'milestone', entityId: id,
      action: 'updated', summary: `编辑里程碑 "${updated.name}"`
    })
    res.json({ code: 0, data: updated })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '里程碑不存在' })
    console.error('[fde/projects PUT /:projectId/milestones/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/projects/:projectId/milestones/:id
 * 软删里程碑
 */
router.delete('/:projectId/milestones/:id', requirePermission('milestone.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.milestone.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '里程碑不存在' })

    await prisma.milestone.update({ where: { id }, data: { deletedAt: new Date() } })
    recordActivity({
      actorId: BigInt(req.user.id), entity: 'milestone', entityId: id,
      action: 'deleted', summary: `删除里程碑 "${existing.name}"`
    })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '里程碑不存在' })
    console.error('[fde/projects DELETE /:projectId/milestones/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ============================================================
// 项目问题 (Issue) CRUD (2026-07-09) —— 复用 project.edit 权限
// ============================================================
const ISSUE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']

/**
 * GET /api/fde/projects/:projectId/issues?status=&severity=&page=&page_size=
 * 问题列表 —— 补上"经理想看项目还有哪些未解决问题"的入口(此前只能靠记 issueId)
 */
router.get('/:projectId/issues', async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await findScopedProject(req, projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })

    const { status = '', severity = '', page = 1, page_size = 20 } = req.query
    if (status && !ISSUE_STATUSES.includes(status)) return res.status(400).json({ code: 1003, message: `状态必须为 ${ISSUE_STATUSES.join('/')}` })
    if (severity && !ISSUE_SEVERITIES.includes(severity)) return res.status(400).json({ code: 1002, message: `严重度必须为 ${ISSUE_SEVERITIES.join('/')}` })

    const where = { projectId, deletedAt: null, ...(status ? { status } : {}), ...(severity ? { severity } : {}) }
    const [total, list] = await Promise.all([
      prisma.issue.count({ where }),
      prisma.issue.findMany({
        where,
        skip: (Number(page) - 1) * Number(page_size),
        take: Number(page_size),
        orderBy: [{ status: 'asc' }, { id: 'desc' }]
      })
    ])
    res.json({ code: 0, message: 'ok', data: { total, list } })
  } catch (e) {
    console.error('[fde/projects GET /:projectId/issues]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.post('/:projectId/issues', requirePermission('issue.manage'), async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })

    const { title, description, severity, status } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ code: 1001, message: '问题标题不能为空' })
    if (severity && !ISSUE_SEVERITIES.includes(severity)) return res.status(400).json({ code: 1002, message: `严重度必须为 ${ISSUE_SEVERITIES.join('/')}` })
    if (status && !ISSUE_STATUSES.includes(status)) return res.status(400).json({ code: 1003, message: `状态必须为 ${ISSUE_STATUSES.join('/')}` })

    const issue = await prisma.issue.create({
      data: {
        projectId,
        title: title.trim(),
        description: description || null,
        severity: severity || 'MEDIUM',
        status: status || 'OPEN',
        reporterId: BigInt(req.user.id)
      }
    })
    recordActivity({ actorId: BigInt(req.user.id), entity: 'issue', entityId: issue.id, action: 'created', summary: `新增问题 "${issue.title}"` })
    res.json({ code: 0, data: issue })
  } catch (e) {
    console.error('[fde/projects POST /:projectId/issues]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.put('/:projectId/issues/:id', requirePermission('issue.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.issue.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '问题不存在' })

    const { title, description, severity, status } = req.body || {}
    const data = {}
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ code: 1001, message: '问题标题不能为空' })
      data.title = title.trim()
    }
    if (description !== undefined) data.description = description || null
    if (severity !== undefined) {
      if (!ISSUE_SEVERITIES.includes(severity)) return res.status(400).json({ code: 1002, message: `严重度必须为 ${ISSUE_SEVERITIES.join('/')}` })
      data.severity = severity
    }
    if (status !== undefined) {
      if (!ISSUE_STATUSES.includes(status)) return res.status(400).json({ code: 1003, message: `状态必须为 ${ISSUE_STATUSES.join('/')}` })
      data.status = status
    }
    const updated = await prisma.issue.update({ where: { id }, data })
    res.json({ code: 0, data: updated })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '问题不存在' })
    console.error('[fde/projects PUT /:projectId/issues/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.delete('/:projectId/issues/:id', requirePermission('issue.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.issue.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '问题不存在' })
    await prisma.issue.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '问题不存在' })
    console.error('[fde/projects DELETE /:projectId/issues/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ============================================================
// 项目风险 (Risk) CRUD (2026-07-09) —— 复用 project.edit 权限
// ============================================================
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH']
const RISK_STATUSES = ['IDENTIFIED', 'MONITORING', 'MITIGATED', 'CLOSED']

/**
 * GET /api/fde/projects/:projectId/risks?status=&page=&page_size=
 * 风险列表, 与问题列表同一口径
 */
router.get('/:projectId/risks', async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await findScopedProject(req, projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })

    const { status = '', page = 1, page_size = 20 } = req.query
    if (status && !RISK_STATUSES.includes(status)) return res.status(400).json({ code: 1004, message: `状态必须为 ${RISK_STATUSES.join('/')}` })

    const where = { projectId, deletedAt: null, ...(status ? { status } : {}) }
    const [total, list] = await Promise.all([
      prisma.risk.count({ where }),
      prisma.risk.findMany({
        where,
        skip: (Number(page) - 1) * Number(page_size),
        take: Number(page_size),
        orderBy: [{ status: 'asc' }, { id: 'desc' }]
      })
    ])
    res.json({ code: 0, message: 'ok', data: { total, list } })
  } catch (e) {
    console.error('[fde/projects GET /:projectId/risks]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.post('/:projectId/risks', requirePermission('risk.manage'), async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })

    const { title, description, probability, impact, status, mitigation } = req.body || {}
    if (!title || !title.trim()) return res.status(400).json({ code: 1001, message: '风险标题不能为空' })
    if (probability && !RISK_LEVELS.includes(probability)) return res.status(400).json({ code: 1002, message: `概率必须为 ${RISK_LEVELS.join('/')}` })
    if (impact && !RISK_LEVELS.includes(impact)) return res.status(400).json({ code: 1003, message: `影响必须为 ${RISK_LEVELS.join('/')}` })
    if (status && !RISK_STATUSES.includes(status)) return res.status(400).json({ code: 1004, message: `状态必须为 ${RISK_STATUSES.join('/')}` })

    const risk = await prisma.risk.create({
      data: {
        projectId,
        title: title.trim(),
        description: description || null,
        probability: probability || 'MEDIUM',
        impact: impact || 'MEDIUM',
        status: status || 'IDENTIFIED',
        mitigation: mitigation || null
      }
    })
    recordActivity({ actorId: BigInt(req.user.id), entity: 'risk', entityId: risk.id, action: 'created', summary: `新增风险 "${risk.title}"` })
    res.json({ code: 0, data: risk })
  } catch (e) {
    console.error('[fde/projects POST /:projectId/risks]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.put('/:projectId/risks/:id', requirePermission('risk.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.risk.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '风险不存在' })

    const { title, description, probability, impact, status, mitigation } = req.body || {}
    const data = {}
    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ code: 1001, message: '风险标题不能为空' })
      data.title = title.trim()
    }
    if (description !== undefined) data.description = description || null
    if (probability !== undefined) {
      if (!RISK_LEVELS.includes(probability)) return res.status(400).json({ code: 1002, message: `概率必须为 ${RISK_LEVELS.join('/')}` })
      data.probability = probability
    }
    if (impact !== undefined) {
      if (!RISK_LEVELS.includes(impact)) return res.status(400).json({ code: 1003, message: `影响必须为 ${RISK_LEVELS.join('/')}` })
      data.impact = impact
    }
    if (status !== undefined) {
      if (!RISK_STATUSES.includes(status)) return res.status(400).json({ code: 1004, message: `状态必须为 ${RISK_STATUSES.join('/')}` })
      data.status = status
    }
    if (mitigation !== undefined) data.mitigation = mitigation || null
    const updated = await prisma.risk.update({ where: { id }, data })
    res.json({ code: 0, data: updated })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '风险不存在' })
    console.error('[fde/projects PUT /:projectId/risks/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.delete('/:projectId/risks/:id', requirePermission('risk.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.risk.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '风险不存在' })
    await prisma.risk.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '风险不存在' })
    console.error('[fde/projects DELETE /:projectId/risks/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ============================================================
// 项目代码仓库 (Repository) CRUD (2026-07-09) —— 复用 project.edit 权限
// 一个项目可关联多个 GitHub/Gitee/GitLab 仓库
// ============================================================
const REPO_PROVIDERS = ['GITEE', 'GITHUB', 'GITLAB', 'OTHER']

/**
 * POST /api/fde/projects/_meta/parse-repo
 * 从 GitHub/Gitee/GitLab 地址解析仓库名 + 默认分支 + 描述 (供前端一键填充)
 * Body: { url }
 */
router.post('/_meta/parse-repo', requirePermission('project.edit'), async (req, res) => {
  try {
    const { url } = req.body || {}
    if (!url || !String(url).trim()) return res.status(400).json({ code: 1001, message: '仓库地址不能为空' })
    const r = await resolveRepo(url)
    if (!r.ok) return res.status(400).json({ code: 1002, message: r.message || '无法识别仓库地址' })
    res.json({ code: 0, data: r })
  } catch (e) {
    console.error('[fde/projects POST /_meta/parse-repo]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

function normalizeRepoUrl(url) {
  const u = String(url || '').trim()
  if (!u) return ''
  // 允许直接粘贴 git@ 或 https:// 地址; 简单校验含 gitee/github/gitlab 或以 http/git 开头
  return u
}

// v2.1.12(#555): 独立列表路由(此前仓库只随项目详情内嵌返回, MCP/轻量场景取不到)
// 字段对齐 AC: platform(=provider 小写)/branch(=defaultBranch)/lastSyncAt(=lastSyncedAt); 模型无 token 等凭据字段, 无脱敏面
router.get('/:projectId/repositories', requirePermission('project.view'), async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })
    const repos = await prisma.projectRepository.findMany({
      where: { projectId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    })
    res.json({
      code: 0, message: 'ok',
      data: {
        list: repos.map(r => ({
          id: String(r.id), name: r.name, url: r.url,
          platform: (r.provider || 'OTHER').toLowerCase(), provider: r.provider,
          branch: r.defaultBranch, defaultBranch: r.defaultBranch,
          description: r.description, sortOrder: r.sortOrder,
          lastSyncAt: r.lastSyncedAt, lastCommitSha: r.lastCommitSha, syncError: r.syncError
        })),
        total: repos.length
      }
    })
  } catch (e) {
    console.error('[fde/projects GET /:projectId/repositories]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.post('/:projectId/repositories', requirePermission('project.edit'), async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在' })

    let { name, url, provider, description, defaultBranch } = req.body || {}
    // v2.1.12(#555): 缺 name 时从 URL 解析仓库名/默认分支/平台(MCP 关联仓库只给 URL 的场景)
    if ((!name || !name.trim()) && url) {
      const r = await resolveRepo(url)
      if (r?.ok !== false) {
        name = r.name
        if (!provider && r.provider) provider = r.provider
        if (!defaultBranch && r.defaultBranch) defaultBranch = r.defaultBranch
        if (!description && r.description) description = r.description
      }
    }
    if (!name || !name.trim()) return res.status(400).json({ code: 1001, message: '仓库名称不能为空(且无法从地址解析)' })
    const finalUrl = normalizeRepoUrl(url)
    if (!finalUrl) return res.status(400).json({ code: 1002, message: '仓库地址不能为空' })
    if (provider && !REPO_PROVIDERS.includes(provider)) {
      return res.status(400).json({ code: 1003, message: `provider 必须为 ${REPO_PROVIDERS.join('/')}` })
    }

    const maxOrder = await prisma.projectRepository.aggregate({
      where: { projectId, deletedAt: null }, _max: { sortOrder: true }
    })
    const repo = await prisma.projectRepository.create({
      data: {
        projectId,
        name: name.trim(),
        url: finalUrl,
        provider: provider || parseRepoUrl(finalUrl)?.provider || 'OTHER',
        description: description || null,
        defaultBranch: defaultBranch || null,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
        createdBy: BigInt(req.user.id)
      }
    })
    recordActivity({ actorId: BigInt(req.user.id), entity: 'project_repository', entityId: repo.id, action: 'created', summary: `新增代码仓库 "${repo.name}"` })
    res.json({ code: 0, data: repo })
  } catch (e) {
    console.error('[fde/projects POST /:projectId/repositories]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.put('/:projectId/repositories/:id', requirePermission('project.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.projectRepository.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '仓库不存在' })

    const { name, url, provider, description, defaultBranch } = req.body || {}
    const data = {}
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ code: 1001, message: '仓库名称不能为空' })
      data.name = name.trim()
    }
    if (url !== undefined) {
      const finalUrl = normalizeRepoUrl(url)
      if (!finalUrl) return res.status(400).json({ code: 1002, message: '仓库地址不能为空' })
      data.url = finalUrl
    }
    if (provider !== undefined) {
      if (!REPO_PROVIDERS.includes(provider)) return res.status(400).json({ code: 1003, message: `provider 必须为 ${REPO_PROVIDERS.join('/')}` })
      data.provider = provider
    }
    if (description !== undefined) data.description = description || null
    if (defaultBranch !== undefined) data.defaultBranch = defaultBranch || null

    const updated = await prisma.projectRepository.update({ where: { id }, data })
    res.json({ code: 0, data: updated })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '仓库不存在' })
    console.error('[fde/projects PUT /:projectId/repositories/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.delete('/:projectId/repositories/:id', requirePermission('project.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.projectRepository.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 2004, message: '仓库不存在' })
    await prisma.projectRepository.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '仓库不存在' })
    console.error('[fde/projects DELETE /:projectId/repositories/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ============================================================
// 项目仓库动态 (RepoActivity) (2026-07-20)
// 展示已配置代码仓库拉取到的提交记录, 供项目主页时间线
// ============================================================

/**
 * GET /api/fde/projects/:projectId/activities
 * 项目下所有已配置仓库的提交动态, 按时间倒序
 * Query: page=1&pageSize=20&repositoryId=&type=COMMIT
 */
router.get('/:projectId/activities', async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    const page = Math.max(parseInt(req.query.page) || 1, 1)
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 20, 1), 100)
    const where = { projectId }
    if (req.query.repositoryId) where.projectRepositoryId = BigInt(req.query.repositoryId)
    if (req.query.type) where.type = String(req.query.type)

    const [total, items] = await Promise.all([
      prisma.repoActivity.count({ where }),
      prisma.repoActivity.findMany({
        where,
        orderBy: { happenedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { repository: { select: { id: true, name: true, url: true, provider: true } } }
      })
    ])
    res.json({ code: 0, data: { total, page, pageSize, items } })
  } catch (e) {
    console.error('[fde/projects GET /:projectId/activities]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/projects/:projectId/repositories/sync
 * 手动触发同步该项目所有 Gitee 仓库的提交 (不等定时任务)
 */
router.post('/:projectId/repositories/sync', requirePermission('project.edit'), async (req, res) => {
  try {
    const projectId = BigInt(req.params.projectId)
    if (!process.env.GITEE_ACCESS_TOKEN) {
      return res.status(400).json({ code: 1005, message: '未配置 GITEE_ACCESS_TOKEN, 无法同步' })
    }
    const result = await syncAllRepositories({ projectId })
    res.json({ code: 0, data: result })
  } catch (e) {
    console.error('[fde/projects POST /:projectId/repositories/sync]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * v2.0.5(#405) 项目进展驾驶舱聚合接口 —— 一次返回全部卡片数据
 * GET /:id/progress-dashboard?view=internal|customer
 * 脱敏在服务端做: view=customer 直接不返回 工时/成本/任务人名/commit明细/仓库同步状态,
 * 前端投屏模式拿不到敏感数据而非"隐藏", 杜绝 F12 可见。设计: docs/v2.0.5-进展驾驶舱设计.md
 */
router.get('/:id/progress-dashboard', async (req, res) => {
  try {
    const scope = await buildScopeWhere(req.user, 'project')
    const project = await prisma.project.findFirst({
      // v2.1.14 fix: AND 求交防 scope 的 id 条件覆盖 URL 项目 id
      where: buildScopedWhere({ id: BigInt(req.params.id), deletedAt: null }, scope),
      select: {
        id: true, name: true, code: true, status: true, health: true, progress: true,
        startDate: true, endDate: true, budget: true, actualCost: true, activityScore: true
      }
    })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const customerView = req.query.view === 'customer'
    const pid = project.id
    const now = new Date()
    const weekStart = (() => { const x = new Date(now); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x })()
    const d7 = new Date(now.getTime() - 7 * 86400e3)
    const d30 = new Date(now.getTime() - 30 * 86400e3)
    const w12 = new Date(now.getTime() - 12 * 7 * 86400e3)
    const dayKey = (v) => new Date(v).toISOString().slice(0, 10)

    const [milestones, taskGroups, weekDone, taskAssignee, sheets, commitDates, recentCommits, repos] = await Promise.all([
      prisma.milestone.findMany({
        where: { projectId: pid, deletedAt: null }, orderBy: { plannedDate: 'asc' },
        select: { id: true, name: true, status: true, plannedDate: true, actualDate: true }
      }),
      prisma.task.groupBy({ by: ['status'], where: { projectId: pid, deletedAt: null }, _count: { _all: true } }),
      prisma.task.count({ where: { projectId: pid, deletedAt: null, completedAt: { gte: weekStart } } }),
      customerView ? [] : prisma.task.groupBy({ by: ['assigneeId', 'status'], where: { projectId: pid, deletedAt: null, assigneeId: { not: null } }, _count: { _all: true } }),
      customerView ? [] : prisma.timesheet.findMany({
        where: { projectId: pid, deletedAt: null, status: 'APPROVED', workDate: { gte: w12 } },
        select: { workDate: true, hours: true, engineerId: true }
      }),
      prisma.repoActivity.findMany({ where: { projectId: pid, type: 'COMMIT', happenedAt: { gte: d30 } }, select: { happenedAt: true } }),
      customerView ? [] : prisma.repoActivity.findMany({
        where: { projectId: pid, type: 'COMMIT' }, orderBy: { happenedAt: 'desc' }, take: 5,
        select: { title: true, author: true, happenedAt: true, sha: true, url: true }
      }),
      customerView ? [] : prisma.projectRepository.findMany({
        where: { projectId: pid, deletedAt: null }, select: { id: true, name: true, lastSyncedAt: true, syncError: true }
      })
    ])

    // 任务五态与完成率
    const byStatus = Object.fromEntries(taskGroups.map(g => [g.status, g._count._all]))
    const taskTotal = Object.values(byStatus).reduce((a, b) => a + b, 0)
    const doneCount = (byStatus.DONE || 0) + (byStatus.VERIFIED || 0)

    // 内部: 按负责人分布(名字批量解析)
    let byAssignee
    if (!customerView && taskAssignee.length) {
      const ids = [...new Set(taskAssignee.map(g => String(g.assigneeId)))]
      const engineers = await prisma.engineer.findMany({
        where: { id: { in: ids.map(BigInt) } }, select: { id: true, user: { select: { name: true } } }
      })
      const nameOf = new Map(engineers.map(e => [String(e.id), e.user?.name || '?']))
      const agg = new Map()
      for (const g of taskAssignee) {
        const k = String(g.assigneeId)
        if (!agg.has(k)) agg.set(k, { name: nameOf.get(k) || '?', total: 0, done: 0 })
        const row = agg.get(k)
        row.total += g._count._all
        if (g.status === 'DONE' || g.status === 'VERIFIED') row.done += g._count._all
      }
      byAssignee = [...agg.values()].sort((a, b) => b.total - a.total)
    }

    // 内部: 工时周曲线 + 人员分布 + 预算消耗
    let hours
    if (!customerView) {
      const weekly = new Map()
      const byEng = new Map()
      let totalHours = 0
      for (const s of sheets) {
        const d = new Date(s.workDate)
        const wk = new Date(d); wk.setDate(d.getDate() - ((d.getDay() + 6) % 7))
        const key = dayKey(wk)
        const h = Number(s.hours) || 0
        weekly.set(key, (weekly.get(key) || 0) + h)
        byEng.set(String(s.engineerId), (byEng.get(String(s.engineerId)) || 0) + h)
        totalHours += h
      }
      const engIds = [...byEng.keys()]
      const engs = engIds.length ? await prisma.engineer.findMany({
        where: { id: { in: engIds.map(BigInt) } }, select: { id: true, user: { select: { name: true } } }
      }) : []
      const engName = new Map(engs.map(e => [String(e.id), e.user?.name || '?']))
      const budget = project.budget ? Number(project.budget) : null
      const actualCost = project.actualCost ? Number(project.actualCost) : null
      hours = {
        weekly: [...weekly.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([week, h]) => ({ week, hours: Math.round(h * 10) / 10 })),
        byPerson: [...byEng.entries()].map(([id, h]) => ({ name: engName.get(id) || '?', hours: Math.round(h * 10) / 10 })).sort((a, b) => b.hours - a.hours),
        totalHours: Math.round(totalHours * 10) / 10,
        budget, actualCost,
        consumptionRate: budget && actualCost ? Math.round(actualCost / budget * 1000) / 10 : null
      }
    }

    // commit 日趋势(30日桶, 7/30 计数)
    const daily = new Map()
    let last7 = 0
    for (const c of commitDates) {
      daily.set(dayKey(c.happenedAt), (daily.get(dayKey(c.happenedAt)) || 0) + 1)
      if (c.happenedAt >= d7) last7++
    }

    res.json({
      code: 0,
      data: {
        view: customerView ? 'customer' : 'internal',
        project: {
          name: project.name, code: project.code, status: project.status, health: project.health,
          progress: project.progress, startDate: project.startDate, endDate: project.endDate,
          activityScore: project.activityScore
        },
        milestones: milestones.map(m => ({
          ...m,
          overdue: m.status !== 'COMPLETED' && m.plannedDate && new Date(m.plannedDate) < now
        })),
        tasks: {
          total: taskTotal, byStatus, weekDone,
          completionRate: taskTotal ? Math.round(doneCount / taskTotal * 100) : 0,
          ...(byAssignee ? { byAssignee } : {})
        },
        ...(hours ? { hours } : {}),
        commits: {
          last7, last30: commitDates.length,
          daily: [...daily.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, count]) => ({ date, count })),
          ...(customerView ? {} : {
            recent: recentCommits.map(c => ({ title: c.title, author: c.author, happenedAt: c.happenedAt, sha: (c.sha || '').slice(0, 8), url: c.url })),
            repos
          })
        }
      }
    })
  } catch (e) {
    console.error('[fde/projects GET /:id/progress-dashboard]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
