// FDE 平台 - 任务管理 API
// 项目下的子任务，分配给工程师，4 状态 + 优先级 + 截止日期
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission, buildScopeWhere, canAccessRecord, hasPermission } from '../../lib/auth.js'
import { pushNotification } from '../../lib/notify.js'
import { recordActivity } from '../../lib/activity.js'
import { suggestAssets, taskContextText } from '../../services/assets.js'
import { isModuleEnabled } from '../../config/edition.js'
import { validateNewEdge, detachTaskEdges, loadTaskNeighbors } from '../../services/roadmap.js'   // v2.8.0(#1143) 路径图
import { buildActiveWorkMap, fallbackActiveWork, redactActiveWork } from '../../services/activeWork.js'   // v2.12.0(#1254)

// 内部员工视角可看 agent 身份; 客户/外部角色只给「正在自动开发」一层
function isInternalView(user) {
  return ['ADMIN', 'MANAGER', 'FDE_ENGINEER'].includes(user.role)
}

const router = express.Router()
router.use(internalAuth)

// v1.9.7(#353) 状态流: 收件箱(TODO)→等候生产(QUEUED)→生产中(IN_PROGRESS)→生产完成(DONE)→已验收(VERIFIED)
const TASK_STATUS = ['TODO', 'QUEUED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'REWORK']   // REWORK 仅存量兼容(v2.8.5 验收下线后不再产生)
const TASK_PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
// v2.1.13(#563) 任务来源: 客户需求/评审/巡检/自主发起; 存量为空=未标注
const TASK_SOURCES = ['CUSTOMER', 'REVIEW', 'PATROL', 'SELF', 'AI']   // v2.8.0(#1145) AI=路径图 AI 生成面板落库

// v2.1.8(#510) 验收自动化: AC checklist 结构校验 —— [{acNo, text, level}], level 缺省随任务 reviewLevel
const REVIEW_LEVELS = ['L1_API', 'L2_UI', 'L3_STATIC']
function normalizeAcceptance(raw, res) {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (!Array.isArray(raw)) { res.status(400).json({ code: 9002, message: 'acceptanceCriteria 必须是数组' }); return false }
  const clean = []
  for (let i = 0; i < raw.slice(0, 50).length; i++) {
    const it = raw[i] || {}
    const text = (it.text || '').toString().trim()
    if (!text) { res.status(400).json({ code: 9002, message: `第 ${i + 1} 条验收标准缺少描述` }); return false }
    const level = it.level && REVIEW_LEVELS.includes(it.level) ? it.level : undefined
    clean.push({ acNo: it.acNo || `AC-${i + 1}`, text: text.slice(0, 500), ...(level ? { level } : {}) })
  }
  return clean
}


// v2.8.5(#1161) 验收体系下线: 自动验收(AC 回填/验收统计/回归库/问题类型统计/验收记录)接口统一 410 桩,
// 数据表 acceptance_records / acceptance_samples / regression_cases / regression_runs 保留不删。清单: docs/06-专项档案/验收体系下线清单-任务1161.md
const RETIRED_ACCEPTANCE = ['/_meta/acceptance-stats', '/_meta/acceptance-samples', '/_meta/regression-cases', '/_meta/regression-run', '/_meta/regression-runs', '/_meta/feedback-stats', '/:id/accept', '/:id/acceptance-records']
for (const path of RETIRED_ACCEPTANCE) {
  router.all(path, (req, res) => {
    res.set('Deprecation', 'true')
    res.status(410).json({ code: 410, message: '自动验收功能已于 v2.8.5 下线（任务 #1161）；任务验收请由经理直接置为已验收', retiredIn: 'v2.8.5', task: 1161 })
  })
}

// 列表
router.get('/', requirePermission('task.view'), async (req, res) => {
  try {
    const { projectId, assigneeId, status, priority, mine, page = 1, page_size = 20, keyword = '', archived = '' } = req.query
    // v1.9.3 筛选增强: 里程碑 / 逾期 / 今日到期
    const { milestone_id, overdue, due_today } = req.query
    // v1.2.9: 默认不含归档; archived=true 只看归档记录
    const where = { deletedAt: null, archivedAt: archived === 'true' ? { not: null } : null }
    // 1.2.5: 任务范围与项目一致 —— MANAGER/FDE_ENGINEER 只看自己参与项目的任务, ADMIN 全量
    const projectScope = await buildScopeWhere(req.user, 'project')
    if (Object.keys(projectScope).length) where.project = { deletedAt: null, ...projectScope }
    if (projectId) where.projectId = BigInt(projectId)
    if (assigneeId) where.assigneeId = BigInt(assigneeId)
    if (status && TASK_STATUS.includes(status)) where.status = status
    if (priority && TASK_PRIORITY.includes(priority)) where.priority = priority
    if (mine === 'true') {
      // 双轨兜底: token 里可能没有 engineerId(项目经理/未建档成员), 按 userId 现查档案;
      // 仍无档案说明不可能被指派任务, 置 -1 返回空集, 不能静默退化成"看全部"
      let myEngineerId = req.user.engineerId
      if (!myEngineerId && req.user.id) {
        const myEng = await prisma.engineer.findUnique({ where: { userId: BigInt(req.user.id) }, select: { id: true } })
        myEngineerId = myEng?.id
      }
      where.assigneeId = myEngineerId ? BigInt(myEngineerId) : BigInt(-1)
    }
    if (keyword) where.title = { contains: keyword }
    // v1.9.3: 按里程碑筛选(milestone_id=none 表示未挂里程碑的任务)
    if (milestone_id) where.milestoneId = milestone_id === 'none' ? null : BigInt(milestone_id)
    // v2.1.13(#563): 按来源过滤(source=none 表示未标注来源的存量任务)
    if (req.query.source && (TASK_SOURCES.includes(req.query.source) || req.query.source === 'none')) {
      where.source = req.query.source === 'none' ? null : req.query.source
    }
    // v1.9.3: 逾期 = 截止日已过且还没做完; 今日 = 截止日是今天(与逾期互斥, 同传时逾期优先)
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1)
    if (overdue === '1' || overdue === 'true') {
      where.dueDate = { lt: dayStart }
      where.status = { notIn: ['DONE', 'VERIFIED'] }
    } else if (due_today === '1' || due_today === 'true') {
      where.dueDate = { gte: dayStart, lt: dayEnd }
    }

    const skip = (Number(page) - 1) * Number(page_size)
    // priority 是 VARCHAR, DB 字典序 desc 会排出 URGENT>MEDIUM>LOW>HIGH(HIGH 垫底)。
    // 改为先取全量 id 内存排序(紧急→高→中→低, 同级截止日期近的在前, 无截止垫底), 再取当前页详情
    const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
    const slim = await prisma.task.findMany({ where, select: { id: true, priority: true, dueDate: true, archivedAt: true } })
    if (archived === 'true') {
      slim.sort((a, b) => (b.archivedAt?.getTime() || 0) - (a.archivedAt?.getTime() || 0))
    } else {
      slim.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 9
        const pb = PRIORITY_ORDER[b.priority] ?? 9
        if (pa !== pb) return pa - pb
        if (!a.dueDate && !b.dueDate) return Number(b.id - a.id)
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return (a.dueDate - b.dueDate) || Number(b.id - a.id)
      })
    }
    const total = slim.length
    const pageIds = slim.slice(skip, skip + Number(page_size)).map(t => t.id)
    const rows = pageIds.length
      ? await prisma.task.findMany({
          where: { id: { in: pageIds } },
          include: {
            project: { select: { id: true, code: true, name: true, status: true } },
            milestone: { select: { id: true, name: true } }
            // assignee: 通过单独的查询拿，避免大量 JOIN
          }
        })
      : []
    const rowMap = new Map(rows.map(t => [String(t.id), t]))
    const list = pageIds.map(id => rowMap.get(String(id))).filter(Boolean)

    // 批量取 assignee 用户信息
    const assigneeIds = [...new Set(list.map(t => t.assigneeId).filter(Boolean))]
    const engineers = assigneeIds.length
      ? await prisma.engineer.findMany({
          where: { id: { in: assigneeIds } },
          include: { user: { select: { id: true, name: true, username: true } } }
        })
      : []
    const engMap = new Map(engineers.map(e => [String(e.id), e]))

    // 批量取每个任务的子项进度
    const taskIds = list.map(t => t.id)
    const subtaskStats = taskIds.length ? await prisma.subtask.groupBy({
      by: ['taskId', 'done'],
      where: { taskId: { in: taskIds }, deletedAt: null },
      _count: { _all: true }
    }) : []
    // v2.1.7(#494): 批量聚合任务实耗(已审批工时和), 一条 groupBy 不搞 N+1
    const hourAgg = taskIds.length ? await prisma.timesheet.groupBy({
      by: ['taskId'],
      where: { taskId: { in: taskIds }, status: 'APPROVED', deletedAt: null },
      _sum: { hours: true }
    }) : []
    const hourMap = Object.fromEntries(hourAgg.map(h => [String(h.taskId), Number(h._sum.hours || 0)]))
    // v2.8.0(#1144) 路径图: 看板卡片阻塞角标 —— 未完成的 BLOCKS 前置(一条查询, 不搞 N+1)
    const blockingEdges = taskIds.length ? await prisma.taskDependency.findMany({
      where: { successorId: { in: taskIds }, type: 'BLOCKS', deletedAt: null, predecessor: { deletedAt: null, status: { notIn: ['DONE', 'VERIFIED'] } } },
      select: { successorId: true, predecessorId: true, predecessor: { select: { title: true } } }
    }) : []
    const blockedMap = {}
    for (const e of blockingEdges) (blockedMap[String(e.successorId)] ||= []).push({ id: String(e.predecessorId), title: e.predecessor.title })

    // v2.12.0(#1254) activeWork: 批量聚合 run+presence(一次查询, 防 N+1);
    // startedAt 用于排除开工前的残留心跳
    const activeWorkMap = await buildActiveWorkMap(taskIds, {
      taskStartedAt: new Map(list.map(t => [t.id, { startedAt: t.startedAt }]))
    })

    const statMap = {}
    for (const s of subtaskStats) {
      const k = String(s.taskId)
      if (!statMap[k]) statMap[k] = { total: 0, done: 0 }
      statMap[k].total += s._count._all
      if (s.done === 1) statMap[k].done = s._count._all
    }

    const data = list.map(t => ({
      ...t,
      assignee: t.assigneeId && engMap.get(String(t.assigneeId))
        ? { id: engMap.get(String(t.assigneeId)).id, name: engMap.get(String(t.assigneeId)).user.name, userId: engMap.get(String(t.assigneeId)).user.id }
        : null,
      subtaskStats: statMap[String(t.id)] || { total: 0, done: 0 },
      actualHours: hourMap[String(t.id)] || 0,   // v2.1.7(#494) 任务实耗(已审批)
      blockedBy: ['DONE', 'VERIFIED'].includes(t.status) ? [] : (blockedMap[String(t.id)] || []),   // v2.8.0(#1144)
      activeWork: (() => {
        const w = fallbackActiveWork(t, activeWorkMap.get(String(t.id)))
        return isInternalView(req.user) ? w : redactActiveWork(w)
      })()
    }))

    res.json({ code: 0, data: { list: data, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 详情

// v2.1.13(#563) GET /_meta/source-stats — 任务来源统计(能力评价数据底座: 商机意识/主动性)
// bySource: 各来源计数(含未标注); incrementalDemand: 「识别增量需求」= source=CUSTOMER 且创建人=负责人本人
// (工程师给自己录入客户需求 → 视为主动识别的增量商机), 附按工程师的明细
router.get('/_meta/source-stats', requirePermission('task.view'), async (req, res) => {
  try {
    const where = { deletedAt: null }
    const projectScope = await buildScopeWhere(req.user, 'project')
    if (Object.keys(projectScope).length) where.project = { deletedAt: null, ...projectScope }
    if (req.query.projectId) where.projectId = BigInt(req.query.projectId)
    if (req.query.assigneeId) where.assigneeId = BigInt(req.query.assigneeId)

    const grouped = await prisma.task.groupBy({ by: ['source'], where, _count: { _all: true } })
    const bySource = { CUSTOMER: 0, REVIEW: 0, PATROL: 0, SELF: 0, UNTAGGED: 0 }
    for (const g of grouped) bySource[g.source || 'UNTAGGED'] = g._count._all

    // 识别增量需求: CUSTOMER 来源里创建人=负责人本人的(需 engineerId→userId 映射后对比)
    const demandTasks = await prisma.task.findMany({
      where: { ...where, source: 'CUSTOMER', createdBy: { not: null }, assigneeId: { not: null } },
      select: { id: true, createdBy: true, assigneeId: true }
    })
    const engIds = [...new Set(demandTasks.map(t => t.assigneeId))]
    const engs = engIds.length ? await prisma.engineer.findMany({
      where: { id: { in: engIds } },
      select: { id: true, userId: true, user: { select: { name: true } } }
    }) : []
    const emap = new Map(engs.map(e => [String(e.id), e]))
    const byEngineer = {}
    let incrementalDemand = 0
    for (const t of demandTasks) {
      const eng = emap.get(String(t.assigneeId))
      if (!eng || String(eng.userId) !== String(t.createdBy)) continue
      incrementalDemand++
      const name = eng.user?.name || `#${t.assigneeId}`
      byEngineer[name] = (byEngineer[name] || 0) + 1
    }

    res.json({
      code: 0, message: 'ok',
      data: {
        bySource,
        total: Object.values(bySource).reduce((s, n) => s + n, 0),
        incrementalDemand,
        incrementalByEngineer: Object.entries(byEngineer)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      }
    })
  } catch (e) {
    console.error('[tasks source-stats]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.get('/:id', requirePermission('task.view'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    // 1.2.5: 详情同样套项目范围, 防止直接拼 URL 越权看别的项目任务
    const projectScope = await buildScopeWhere(req.user, 'project')
    const task = await prisma.task.findFirst({
      where: {
        id, deletedAt: null,
        ...(Object.keys(projectScope).length ? { project: { deletedAt: null, ...projectScope } } : {})
      },
      include: {
        project: { select: { id: true, code: true, name: true, status: true } },
        milestone: { select: { id: true, name: true } },
        // v1.4.x 附件 (含评论附件, 前端按 commentId 归属展示)
        attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } }
      }
    })
    if (!task) return res.status(404).json({ code: 9004, message: '任务不存在' })
    // 附件上传人姓名
    if (task.attachments?.length) {
      const uids = [...new Set(task.attachments.map(a => String(a.uploadedBy)))]
      const users = await prisma.user.findMany({ where: { id: { in: uids.map(BigInt) } }, select: { id: true, name: true } })
      const umap = new Map(users.map(u => [String(u.id), u.name]))
      task.attachments = task.attachments.map(a => ({ ...a, uploaderName: umap.get(String(a.uploadedBy)) || '' }))
    }
    let assignee = null
    if (task.assigneeId) {
      const eng = await prisma.engineer.findUnique({
        where: { id: task.assigneeId },
        include: { user: { select: { id: true, name: true, username: true } } }
      })
      if (eng) assignee = { id: eng.id, name: eng.user.name, userId: eng.user.id }
    }
    // v2.1.7(#494) 任务实耗: 已审批工时之和 + 参与人数(去重工程师), 口径与 summary TASK 一致
    // v2.7(#1140) 内联推荐可复用资产: Agent 取任务时直接看到「我们已经有什么」, 不靠它想起来去搜。
    // suggestAssets 内部吞掉所有异常返空 —— 推荐坏了不能拖垮任务详情
    const wantAssets = hasPermission(req.user, 'asset.view') && isModuleEnabled('assets')
    // v2.8.0(#1143) 路径图: 上下游依赖 + blockedBy(Agent 取任务时知道谁挡着它)
    const [agg, participants, suggestedAssets, neighbors] = await Promise.all([
      prisma.timesheet.aggregate({ where: { taskId: id, status: 'APPROVED', deletedAt: null }, _sum: { hours: true }, _count: { _all: true } }),
      prisma.timesheet.groupBy({ by: ['engineerId'], where: { taskId: id, status: 'APPROVED', deletedAt: null } }),
      wantAssets ? suggestAssets(taskContextText(task)) : [],
      loadTaskNeighbors(id)
    ])
    const actual = {
      actualHours: Number(agg._sum.hours || 0),
      approvedRecordCount: agg._count._all,
      participantCount: participants.length
    }
    // v2.12.0(#1254) activeWork 摘要(单个任务也走同一构建器)
    const activeWorkMap = await buildActiveWorkMap([id], {
      taskStartedAt: new Map([[id, { startedAt: task.startedAt }]])
    })
    let activeWork = fallbackActiveWork(task, activeWorkMap.get(String(id)))
    if (!isInternalView(req.user)) activeWork = redactActiveWork(activeWork)
    res.json({ code: 0, data: { ...task, assignee, ...actual, suggestedAssets, ...neighbors, blocked: neighbors.blockedBy.length > 0, activeWork } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 创建
router.post('/', requirePermission('task.create'), async (req, res) => {
  try {
    const { projectId, milestoneId, title, description, assigneeUserId, status = 'TODO', priority = 'MEDIUM', dueDate } = req.body
    let { assigneeId } = req.body
    if (!projectId || !title) return res.status(400).json({ code: 9002, message: '项目ID和标题必填' })
    if (status && !TASK_STATUS.includes(status)) return res.status(400).json({ code: 9002, message: '无效状态' })
    if (priority && !TASK_PRIORITY.includes(priority)) return res.status(400).json({ code: 9002, message: '无效优先级' })
    // v2.1.13(#563): 来源可选; 传了必须是四值之一
    if (req.body.source && !TASK_SOURCES.includes(req.body.source)) {
      return res.status(400).json({ code: 9002, message: `source 必须为 ${TASK_SOURCES.join('/')}` })
    }
    // v2.1.8(#510): AC/验收级别预校验
    const acClean = normalizeAcceptance(req.body.acceptanceCriteria, res)
    if (acClean === false) return
    if (req.body.reviewLevel && !REVIEW_LEVELS.includes(req.body.reviewLevel)) {
      return res.status(400).json({ code: 9002, message: `reviewLevel 必须为 ${REVIEW_LEVELS.join('/')}` })
    }

    // assigneeUserId: 按用户指派(成员可能没有工程师档案, 如项目经理/销售),
    // 自动补建档案后转成 engineer.id 存储 (assigneeId 全链路语义是 engineer.id)
    if (!assigneeId && assigneeUserId) {
      let eng = await prisma.engineer.findUnique({ where: { userId: BigInt(assigneeUserId) } })
      if (!eng) eng = await prisma.engineer.create({ data: { userId: BigInt(assigneeUserId) } })
      assigneeId = eng.id
    }

    const task = await prisma.task.create({
      data: {
        projectId: BigInt(projectId),
        milestoneId: milestoneId ? BigInt(milestoneId) : null,
        title,
        description: description || null,
        assigneeId: assigneeId ? BigInt(assigneeId) : null,
        status,
        priority,
        dueDate: dueDate ? new Date(dueDate) : null,
        // v2.1.0 小组制: 可选挂组
        // v2.1.8(#510) 验收自动化: AC checklist + 验收级别
        acceptanceCriteria: acClean ?? undefined,
        reviewLevel: REVIEW_LEVELS.includes(req.body.reviewLevel) ? req.body.reviewLevel : 'L1_API',
        // v2.1.13(#563): 来源标注 + 创建人留痕(识别增量需求口径依赖创建人=负责人判断)
        source: req.body.source || null,
        createdBy: BigInt(req.user.id)
      }
    })

    // v2.8.0(#1143) 路径图: 建任务顺手挂前置 dependsOn: [taskId]; 新节点不可能成环, 只校验同项目/存在
    const dependsOn = Array.isArray(req.body.dependsOn) ? [...new Set(req.body.dependsOn.map(String))].slice(0, 20) : []
    const dependencyErrors = []
    for (const predId of dependsOn) {
      try {
        await validateNewEdge({ predecessorId: predId, successorId: task.id, type: 'BLOCKS' })
        await prisma.taskDependency.create({ data: { predecessorId: BigInt(predId), successorId: task.id, type: 'BLOCKS', createdBy: BigInt(req.user.id) } })
      } catch (e) { dependencyErrors.push(`#${predId}: ${e.message}`) }
    }

    // v1.4.x: 创建时携带附件 [{ filename, fileUrl, fileSize }] (先上传拿 url)
    const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : []
    for (const a of attachments.slice(0, 20)) {
      if (!a?.fileUrl || !a?.filename) continue
      await prisma.taskAttachment.create({
        data: {
          taskId: task.id,
          filename: String(a.filename).slice(0, 200),
          fileUrl: String(a.fileUrl),
          fileSize: a.fileSize ? BigInt(a.fileSize) : null,
          uploadedBy: BigInt(req.user.id)
        }
      }).catch(() => {})
    }

    // 活动
    await recordActivity({
      actorId: req.user.id,
      entity: 'task',
      entityId: task.id,
      action: 'created',
      summary: `创建任务 "${title}"`,
      data: { projectId: String(projectId), priority }
    })

    // 通知被指派的人（assigneeId 是 engineer.id，要查 user.id）
    if (assigneeId) {
      const [proj, eng] = await Promise.all([
        prisma.project.findUnique({ where: { id: BigInt(projectId) }, select: { name: true } }),
        prisma.engineer.findUnique({ where: { id: BigInt(assigneeId) }, select: { user: { select: { id: true } } } })
      ])
      if (eng?.user) {
        await pushNotification({
          userId: eng.user.id,
          actorId: req.user.id,   // v2.5.5(#912) 自己建的任务派给自己不发
          type: 'TASK_ASSIGNED',
          title: '📋 新任务分配',
          body: `${proj?.name || '项目'}：${title}`,
          link: `/admin/tasks?open=${task.id}`,
          data: { taskId: String(task.id), projectId: String(projectId) }
        })
      }
    }

    res.json({ code: 0, data: { ...task, ...(dependsOn.length ? { dependsOn, dependencyErrors } : {}) } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 更新
router.put('/:id', requirePermission('task.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.task.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '任务不存在' })

    const { milestoneId, title, description, assigneeUserId, status, priority, dueDate, projectId } = req.body
    let { assigneeId } = req.body
    // 与创建一致: 按用户指派时自动补建工程师档案
    if (assigneeId === undefined && assigneeUserId) {
      let eng = await prisma.engineer.findUnique({ where: { userId: BigInt(assigneeUserId) } })
      if (!eng) eng = await prisma.engineer.create({ data: { userId: BigInt(assigneeUserId) } })
      assigneeId = eng.id
    }
    const data = {}
    // v1.9.2 跨项目移动: 校验目标项目; 未同时指定新里程碑则清空(旧里程碑属旧项目, 防悬挂)
    if (projectId !== undefined && projectId && BigInt(projectId) !== existing.projectId) {
      const target = await prisma.project.findFirst({
        where: { id: BigInt(projectId), deletedAt: null }, select: { id: true }
      })
      if (!target) return res.status(400).json({ code: 9002, message: '目标项目不存在' })
      data.projectId = target.id
      if (milestoneId === undefined) data.milestoneId = null
      else if (milestoneId) {
        const ms = await prisma.milestone.findFirst({
          where: { id: BigInt(milestoneId), projectId: target.id, deletedAt: null }, select: { id: true }
        })
        if (!ms) return res.status(400).json({ code: 9002, message: '指定的里程碑不属于目标项目' })
      }
    }
    if (milestoneId !== undefined) data.milestoneId = milestoneId ? BigInt(milestoneId) : null
    // v2.1.0 小组制: 挂组/换组/摘组(传 null 或空串清空)
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (assigneeId !== undefined) data.assigneeId = assigneeId ? BigInt(assigneeId) : null
    if (status !== undefined) {
      if (!TASK_STATUS.includes(status)) return res.status(400).json({ code: 9002, message: '无效状态' })
      data.status = status
      if (status === 'DONE' && !existing.completedAt) data.completedAt = new Date()
      if (status !== 'DONE') data.completedAt = null
      // v2.0.1(#391): 转等候生产不再强制计划起止(主人反馈这步多余), 传了就存; 流转时间留痕
      if (status === 'QUEUED' && existing.status !== 'QUEUED') {
        const ps = req.body.plannedStartAt || existing.plannedStartAt
        const pe = req.body.plannedEndAt || existing.plannedEndAt
        if (ps) data.plannedStartAt = new Date(ps)
        if (pe) data.plannedEndAt = new Date(pe)
        data.queuedAt = new Date()
      }
      if (status === 'IN_PROGRESS' && existing.status !== 'IN_PROGRESS') data.startedAt = new Date()
    }
    if (priority !== undefined) {
      if (!TASK_PRIORITY.includes(priority)) return res.status(400).json({ code: 9002, message: '无效优先级' })
      data.priority = priority
    }
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null
    // v2.1.8(#510): AC checklist / 验收级别
    if (req.body.acceptanceCriteria !== undefined) {
      const acClean = normalizeAcceptance(req.body.acceptanceCriteria, res)
      if (acClean === false) return
      data.acceptanceCriteria = acClean
    }
    if (req.body.reviewLevel !== undefined) {
      if (req.body.reviewLevel && !REVIEW_LEVELS.includes(req.body.reviewLevel)) {
        return res.status(400).json({ code: 9002, message: `reviewLevel 必须为 ${REVIEW_LEVELS.join('/')}` })
      }
      data.reviewLevel = req.body.reviewLevel || 'L1_API'
    }
    // v2.1.13(#563): 来源标注; 传空串/null 清空回未标注
    if (req.body.source !== undefined) {
      if (req.body.source && !TASK_SOURCES.includes(req.body.source)) {
        return res.status(400).json({ code: 9002, message: `source 必须为 ${TASK_SOURCES.join('/')}` })
      }
      data.source = req.body.source || null
    }

    const task = await prisma.task.update({ where: { id }, data })

    // v2.8.0(#1143) 路径图: 跨项目移动后旧项目里的依赖边全部失效(边只能在同项目内), 评论留痕
    if (data.projectId && data.projectId !== existing.projectId) {
      const n = await detachTaskEdges(id)
      if (n > 0) {
        await prisma.comment.create({ data: { entity: 'task', entityId: id, authorId: BigInt(req.user.id), content: `🔀 任务移出项目 #${existing.projectId}，原有 ${n} 条依赖关系已解除（依赖只能建在同一项目内）` } }).catch(() => {})
      }
    }

    // 活动
    if (status && status !== existing.status) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'task',
        entityId: id,
        action: status === 'DONE' ? 'completed' : status === 'VERIFIED' ? 'verified' : 'status_changed',
        summary: `任务 "${existing.title}" 状态：${existing.status} → ${status}`
      })
    }

    // 状态变化时通知相关人
    if (status && status !== existing.status && (status === 'DONE' || status === 'VERIFIED') && existing.assigneeId) {
      const [proj, eng] = await Promise.all([
        prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } }),
        prisma.engineer.findUnique({ where: { id: existing.assigneeId }, select: { user: { select: { id: true } } } })
      ])
      if (eng?.user) {
        await pushNotification({
          userId: eng.user.id,
          actorId: req.user.id,   // v2.5.5(#912) 自己置 DONE 不用提醒自己
          type: 'TASK_STATUS_CHANGED',
          title: status === 'DONE' ? '✅ 任务完成' : '✓ 任务已验收',
          body: `${proj?.name || ''}：${existing.title}`,
          link: `/admin/tasks?open=${existing.id}`,
          data: { taskId: String(id), projectId: String(existing.projectId) }
        })
      }
    }

    res.json({ code: 0, data: task })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 删除
router.delete('/:id', requirePermission('task.delete'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } })
    await detachTaskEdges(id)   // v2.8.0(#1143) 路径图: 节点没了边也得没
    res.json({ code: 0, data: { id: req.params.id, deleted: true } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/tasks/archive-verified  (v1.2.9 一键归档)
 * 把可见范围内所有「已验收」任务归档; body: { projectId? } 可限定项目
 * 权限沿用 task.delete(管理层口径), 非破坏性可恢复
 */
router.post('/archive-verified', requirePermission('task.delete'), async (req, res) => {
  try {
    const { projectId } = req.body
    const projectScope = await buildScopeWhere(req.user, 'project')
    const where = {
      status: 'VERIFIED', deletedAt: null, archivedAt: null,
      ...(projectId ? { projectId: BigInt(projectId) } : {}),
      ...(Object.keys(projectScope).length ? { project: { deletedAt: null, ...projectScope } } : {})
    }
    const r = await prisma.task.updateMany({ where, data: { archivedAt: new Date() } })
    await recordActivity({
      actorId: req.user.id, entity: 'task', entityId: BigInt(0),
      action: 'archived', summary: `一键归档 ${r.count} 个已验收任务`
    })
    res.json({ code: 0, data: { archived: r.count } })
  } catch (e) {
    console.error('[tasks archive-verified]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/tasks/batch-verify { taskIds: [..] } — 批量验收(#1275)
 * 逐条校验(存在 / 当前是 DONE / 负责人或经理管理员), 逐条留痕; 返回成功数与失败明细。
 * 权限与单个验收(POST /:id/status status=VERIFIED)完全一致。
 */
router.post('/batch-verify', requirePermission('task.changeStatus'), async (req, res) => {
  try {
    const raw = req.body?.taskIds
    if (!Array.isArray(raw) || !raw.length) return res.status(400).json({ code: 9002, message: 'taskIds 不能为空' })
    const ids = [...new Set(raw.map(v => { try { return BigInt(v) } catch { return null } }).filter(Boolean))].slice(0, 100)

    const manager = ['ADMIN', 'MANAGER'].includes(req.user.role)
    let myEngineerId = req.user.engineerId
    if (!manager && !myEngineerId && req.user.userId) {
      const me = await prisma.engineer.findUnique({ where: { userId: BigInt(req.user.userId) } })
      myEngineerId = me?.id
    }

    let verified = 0
    const failed = []
    for (const id of ids) {
      const task = await prisma.task.findFirst({ where: { id, deletedAt: null } })
      if (!task) { failed.push({ id: String(id), reason: '任务不存在' }); continue }
      if (task.status !== 'DONE') { failed.push({ id: String(id), reason: `仅生产完成(DONE)可验收, 当前 ${task.status}` }); continue }
      if (!manager && String(task.assigneeId) !== String(myEngineerId)) { failed.push({ id: String(id), reason: '无权验收(仅任务负责人或经理/管理员)' }); continue }
      await prisma.task.update({ where: { id }, data: { status: 'VERIFIED' } })
      await recordActivity({
        actorId: req.user.id, entity: 'task', entityId: id,
        action: 'verified', summary: `任务 "${task.title}" 状态：DONE → VERIFIED（批量验收）`
      })
      verified++
    }
    res.json({ code: 0, data: { verified, failed, total: ids.length } })
  } catch (e) {
    console.error('[tasks batch-verify]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/** POST /api/fde/tasks/:id/unarchive  恢复归档任务 */
router.post('/:id/unarchive', requirePermission('task.delete'), async (req, res) => {
  try {
    const task = await prisma.task.update({ where: { id: BigInt(req.params.id) }, data: { archivedAt: null } })
    res.json({ code: 0, data: task })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 状态流转快捷接口
router.post('/:id/status', requirePermission('task.changeStatus'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const { status } = req.body
    if (!TASK_STATUS.includes(status)) return res.status(400).json({ code: 9002, message: '无效状态' })
    const existing = await prisma.task.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '任务不存在' })

    // 校验：只有 assignee、或 ADMIN/MANAGER 才能改
    // 1.2.7 修复: Task.assigneeId 存的是 Engineer.id(工程师档案), 此前误与 User.id 对比,
    // 导致被指派的 FDE 点"开始/完成"永远 403。改为按 engineerId 对比(JWT 有则用, 没有则查档案)
    let can = ['ADMIN', 'MANAGER'].includes(req.user.role)
    if (!can && existing.assigneeId) {
      let myEngineerId = req.user.engineerId
      if (!myEngineerId) {
        const me = await prisma.engineer.findUnique({ where: { userId: BigInt(req.user.userId) } })
        myEngineerId = me?.id
      }
      can = myEngineerId != null && String(existing.assigneeId) === String(myEngineerId)
    }
    if (!can) return res.status(403).json({ code: 9003, message: '无权修改此任务（仅任务负责人或经理/管理员可操作）' })

    const data = {
      status,
      completedAt: status === 'DONE' ? new Date() : (status === 'TODO' || status === 'IN_PROGRESS' || status === 'QUEUED' ? null : existing.completedAt)
    }
    // v2.0.1(#391): 转等候生产不再强制计划起止(主人反馈这步多余), 传了就存; 各段流转时间留痕
    if (status === 'QUEUED' && existing.status !== 'QUEUED') {
      const ps = req.body.plannedStartAt || existing.plannedStartAt
      const pe = req.body.plannedEndAt || existing.plannedEndAt
      if (ps) data.plannedStartAt = new Date(ps)
      if (pe) data.plannedEndAt = new Date(pe)
      data.queuedAt = new Date()
    }
    if (status === 'IN_PROGRESS' && existing.status !== 'IN_PROGRESS') data.startedAt = new Date()
    const task = await prisma.task.update({ where: { id }, data })
    await recordActivity({
      actorId: req.user.id,
      entity: 'task',
      entityId: id,
      action: 'status_changed',
      summary: `任务 "${existing.title}" 状态：${existing.status} → ${status}`
    })
    res.json({ code: 0, data: task })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ===== v1.4.x 任务附件 =====

/**
 * POST /api/fde/tasks/:id/attachments  { filename, fileUrl, fileSize?, commentId? }
 * 文件先走 /api/fde/uploads 上传拿 url; commentId 传入时为评论附件
 */
router.post('/:id/attachments', requirePermission('task.edit'), async (req, res) => {
  try {
    const taskId = BigInt(req.params.id)
    const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null } })
    if (!task) return res.status(404).json({ code: 9004, message: '任务不存在' })
    const { filename, fileUrl, fileSize, commentId } = req.body || {}
    if (!filename || !fileUrl) return res.status(400).json({ code: 9002, message: '文件名和文件地址必填' })
    const att = await prisma.taskAttachment.create({
      data: {
        taskId,
        commentId: commentId ? BigInt(commentId) : null,
        filename: String(filename).slice(0, 200),
        fileUrl: String(fileUrl),
        fileSize: fileSize ? BigInt(fileSize) : null,
        uploadedBy: BigInt(req.user.id)
      }
    })
    res.json({ code: 0, data: att })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/tasks/attachments/:attId  (本人上传的 或 有 task.delete 权限)
 */
router.delete('/attachments/:attId', requirePermission('task.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.attId)
    const att = await prisma.taskAttachment.findFirst({ where: { id, deletedAt: null } })
    if (!att) return res.status(404).json({ code: 9004, message: '附件不存在' })
    const isOwner = String(att.uploadedBy) === String(req.user.id)
    if (!isOwner && !hasPermission(req.user, 'task.delete')) {
      return res.status(403).json({ code: 1003, message: '只能删除自己上传的附件' })
    }
    await prisma.taskAttachment.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// v2.12.0(#1261) 任务运行时间线: 点徽标展开。合并派工 dev_run_events 与巡检 presence 心跳,
// 按时间倒序; 巡检只产生心跳点(无 progress, 不编造进度)。
router.get('/:id/run-timeline', requirePermission('task.view'), async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: BigInt(req.params.id), deletedAt: null },
      select: { id: true, projectId: true, startedAt: true }
    })
    if (!task) return res.status(404).json({ code: 9004, message: '任务不存在' })

    // 派工: 该任务所有 dev_run 的事件
    const runs = await prisma.devRun.findMany({
      where: { taskId: task.id },
      select: { id: true, status: true, agentName: true, events: { orderBy: { id: 'desc' }, take: 200 } }
    })
    const items = []
    for (const r of runs) {
      for (const e of r.events) {
        items.push({
          source: 'DISPATCH', at: e.createdAt,
          level: e.level, phase: e.phase, progress: e.progress,
          message: e.message, agentName: r.agentName
        })
      }
    }

    // 巡检: presence 当前曾指向该任务的心跳。presence 是单行不断刷新,
    // 只能给出最新一次心跳点(其 taskId 仍指向本任务时)。
    const presences = await prisma.agentPresence.findMany({
      where: { taskId: task.id },
      select: { agentName: true, lastBeatAt: true, phase: true, activity: true }
    })
    for (const p of presences) {
      items.push({
        source: 'PATROL', at: p.lastBeatAt,
        phase: p.phase, message: p.activity, agentName: p.agentName
      })
    }

    items.sort((a, b) => new Date(b.at) - new Date(a.at))
    res.json({ code: 0, data: { list: items } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
