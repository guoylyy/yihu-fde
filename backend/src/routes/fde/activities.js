// FDE 平台 - 活动流 API（B2）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth } from '../../lib/auth.js'

const router = express.Router()
router.use(internalAuth)

const ENTITY_LABELS = {
  project: '项目',
  task: '任务',
  timesheet: '工时',
  customer: '客户',
  comment: '评论',
  engineer: '工程师'
}

// 已下线实体(合同/财务等)的历史动态行可能还在表里: 一律「非本人不可见」
const HIDDEN_ENTITIES = [
  'contract', 'salary', 'social_security', 'receipt', 'invoice', 'settlement', 'expense',
  'petty_cash_advance', 'petty_cash_expense'
]

function hiddenEntityClause(user) {
  return { OR: [{ entity: { notIn: HIDDEN_ENTITIES } }, { actorId: BigInt(user.id) }] }
}

/**
 * GET /api/fde/activities
 * Query:
 *   - entity / entityId: 限定某实体（如 entity=project&entityId=1）
 *   - scope: 'all' | 'mine' | 'project' (项目相关)
 *   - page / page_size
 */
router.get('/', async (req, res) => {
  try {
    const { entity, entityId, scope = 'all', page = 1, page_size = 30 } = req.query
    const where = {}

    if (entity && entityId) {
      where.entity = entity
      where.entityId = BigInt(entityId)
    } else if (scope === 'mine') {
      where.actorId = req.user.id
    } else if (scope === 'project') {
      // 我参与的项目 + 我负责的任务 + 我提的工时
      // 先查 me 是不是 FDE（拿到 engineerId）
      let engineerId = req.user.engineerId ? BigInt(req.user.engineerId) : null
      if (!engineerId) {
        const me = await prisma.user.findUnique({
          where: { id: BigInt(req.user.userId) },
          select: { engineer: { select: { id: true } } }
        })
        engineerId = me?.engineer?.id || null
      }
      // 我参与的项目
      const memberships = await prisma.projectMember.findMany({
        where: { engineerId: engineerId || -1, leaveDate: null },
        select: { projectId: true }
      })
      const projectIds = memberships.map(m => m.projectId)
      // 我负责的任务
      let myTaskIds = []
      if (engineerId) {
        const tasks = await prisma.task.findMany({
          where: { assigneeId: engineerId, deletedAt: null },
          select: { id: true }
        })
        myTaskIds = tasks.map(t => t.id)
      }
      // 我提的工时
      let myTimesheetIds = []
      if (engineerId) {
        const ts = await prisma.timesheet.findMany({
          where: { engineerId, deletedAt: null },
          select: { id: true }
        })
        myTimesheetIds = ts.map(t => t.id)
      }

      // OR 组合
      const orClauses = []
      // 任何我作为 actor 产生的活动
      orClauses.push({ actorId: BigInt(req.user.userId) })
      // 我参与的项目
      if (projectIds.length) {
        orClauses.push({ entity: 'project', entityId: { in: projectIds } })
      }
      // 我负责的任务
      if (myTaskIds.length) {
        orClauses.push({ entity: 'task', entityId: { in: myTaskIds } })
      }
      // 我提的工时
      if (myTimesheetIds.length) {
        orClauses.push({ entity: 'timesheet', entityId: { in: myTimesheetIds } })
      }
      // 任何跟我客户相关的活动
      const myCustomerProjects = await prisma.project.findMany({
        where: projectIds.length ? { id: { in: projectIds } } : { id: -1 },
        select: { customerId: true }
      })
      const customerIds = [...new Set(myCustomerProjects.map(p => String(p.customerId)).filter(Boolean))]
      if (customerIds.length) {
        orClauses.push({ entity: 'customer', entityId: { in: customerIds.map(c => BigInt(c)) } })
      }
      // 兜底：避免 where.OR 为空
      if (!orClauses.length) {
        orClauses.push({ id: -1n })
      }
      where.OR = orClauses
    }

    // 已下线实体过滤(scope=project 的 OR 已占用 where.OR, 这里放 AND 不冲突)
    where.AND = [...(where.AND || []), hiddenEntityClause(req.user)]

    const skip = (Number(page) - 1) * Number(page_size)
    const [list, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        skip,
        take: Number(page_size),
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, name: true, username: true, role: true } } }
      }),
      prisma.activity.count({ where })
    ])

    const data = list.map(a => ({
      ...a,
      entityLabel: ENTITY_LABELS[a.entity] || a.entity,
      data: a.data ? (() => { try { return JSON.parse(a.data) } catch { return null } })() : null
    }))

    res.json({ code: 0, data: { list: data, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/activities/recent
 * 仪表盘用：最近 20 条全局动态
 */
router.get('/recent', async (req, res) => {
  try {
    const list = await prisma.activity.findMany({
      where: hiddenEntityClause(req.user),
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, name: true, role: true } } }
    })
    const data = list.map(a => ({
      ...a,
      entityLabel: ENTITY_LABELS[a.entity] || a.entity,
      data: a.data ? (() => { try { return JSON.parse(a.data) } catch { return null } })() : null
    }))
    res.json({ code: 0, data: { list: data } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/activities/:id
 * 只能删自己产生的
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const a = await prisma.activity.findUnique({ where: { id } })
    if (!a) return res.status(404).json({ code: 9004, message: '活动不存在' })
    if (a.actorId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ code: 9003, message: '只能删除自己产生的' })
    }
    await prisma.activity.delete({ where: { id } })
    res.json({ code: 0, data: { id: req.params.id } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// v2.12.0(#1261) 项目「今日变化」: 当天该项目实体(含其任务)的活动, 倒序
router.get('/today', async (req, res) => {
  try {
    const projectId = BigInt(req.query.projectId)
    // 收集该项目下任务的 id
    const tasks = await prisma.task.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true }
    })
    const taskIds = tasks.map(t => t.id)
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)

    const where = {
      createdAt: { gte: dayStart },
      OR: [
        { entity: 'project', entityId: projectId },
        { entity: 'task', entityId: { in: taskIds } }
      ]
    }
    const rows = await prisma.activity.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
    // 汇总计数
    const summary = { total: rows.length, byAction: {} }
    for (const r of rows) summary.byAction[r.action] = (summary.byAction[r.action] || 0) + 1
    res.json({ code: 0, data: { list: rows, summary } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
