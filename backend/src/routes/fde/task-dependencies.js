// v2.8.0(#1143) 里程碑路径图: 任务依赖边 CRUD
// 边 = predecessor(前置) → successor(后继); type BLOCKS(硬, 须无环) / FEEDBACK(回环软边)
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission, buildScopeWhere } from '../../lib/auth.js'
import { recordActivity } from '../../lib/activity.js'
import { validateNewEdge, loadTaskNeighbors, DEP_TYPES } from '../../services/roadmap.js'

const router = express.Router()
router.use(internalAuth)

function fail(res, e) {
  if (e.code && e.code < 9100 && e.code >= 9002) {
    const status = e.code === 9004 ? 404 : e.code === 9005 ? 409 : 400
    return res.status(status).json({ code: e.code, message: e.message, ...(e.cyclePath ? { cyclePath: e.cyclePath } : {}), ...(e.dependencyId ? { dependencyId: e.dependencyId } : {}) })
  }
  return res.status(500).json({ code: 9001, message: e.message })
}

/** 任务是否在调用者项目范围内(与任务详情同口径) */
async function scopedTask(req, taskId) {
  const projectScope = await buildScopeWhere(req.user, 'project')
  return prisma.task.findFirst({
    where: { id: BigInt(taskId), deletedAt: null, ...(Object.keys(projectScope).length ? { project: { deletedAt: null, ...projectScope } } : {}) },
    select: { id: true, projectId: true, title: true }
  })
}

/**
 * GET /api/fde/task-dependencies?taskId=1
 * 单任务的上下游: { predecessors:[{dependencyId,type,note,task}], successors:[...], blockedBy:[taskId] }
 */
router.get('/', requirePermission('task.view'), async (req, res) => {
  try {
    if (!req.query.taskId) return res.status(400).json({ code: 9002, message: 'taskId 必填' })
    const t = await scopedTask(req, req.query.taskId)
    if (!t) return res.status(404).json({ code: 9004, message: '任务不存在' })
    res.json({ code: 0, data: await loadTaskNeighbors(t.id) })
  } catch (e) { fail(res, e) }
})

/**
 * POST /api/fde/task-dependencies  { predecessorId, successorId, type?, note? }
 * 成环 → 400 code 9006 + cyclePath; 重复 → 409 code 9005
 */
router.post('/', requirePermission('task.edit'), async (req, res) => {
  try {
    const { predecessorId, successorId, type = 'BLOCKS', note } = req.body || {}
    if (!predecessorId || !successorId) return res.status(400).json({ code: 9002, message: 'predecessorId / successorId 必填' })
    if (!(await scopedTask(req, successorId))) return res.status(404).json({ code: 9004, message: '任务不存在' })
    const { a, b } = await validateNewEdge({ predecessorId, successorId, type })
    const edge = await prisma.taskDependency.create({
      data: { predecessorId: a.id, successorId: b.id, type, note: note ? String(note).slice(0, 200) : null, createdBy: BigInt(req.user.id) }
    })
    recordActivity({
      actorId: req.user.id, entity: 'task', entityId: b.id, action: 'dependency_added',
      summary: `任务 "${b.title}" 新增${type === 'FEEDBACK' ? '回环' : '前置'}依赖 → "${a.title}"`,
      data: { dependencyId: String(edge.id), predecessorId: String(a.id), type }
    })
    res.json({ code: 0, data: edge })
  } catch (e) { fail(res, e) }
})

/**
 * PUT /api/fde/task-dependencies/:id  { type?, note? }
 * FEEDBACK → BLOCKS 需重新过环检测
 */
router.put('/:id', requirePermission('task.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.taskDependency.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '依赖不存在' })
    if (!(await scopedTask(req, existing.successorId))) return res.status(404).json({ code: 9004, message: '任务不存在' })
    const data = {}
    if (req.body?.type !== undefined) {
      if (!DEP_TYPES.includes(req.body.type)) return res.status(400).json({ code: 9002, message: `type 必须为 ${DEP_TYPES.join('/')}` })
      if (req.body.type === 'BLOCKS' && existing.type !== 'BLOCKS') {
        await validateNewEdge({ predecessorId: existing.predecessorId, successorId: existing.successorId, type: 'BLOCKS', ignoreEdgeId: id })
      }
      data.type = req.body.type
    }
    if (req.body?.note !== undefined) data.note = req.body.note ? String(req.body.note).slice(0, 200) : null
    const edge = await prisma.taskDependency.update({ where: { id }, data })
    res.json({ code: 0, data: edge })
  } catch (e) { fail(res, e) }
})

/**
 * DELETE /api/fde/task-dependencies/pair?predecessorId=&successorId=   (MCP 用: 不知道边 id 也能删)
 * DELETE /api/fde/task-dependencies/:id
 */
router.delete('/pair', requirePermission('task.edit'), async (req, res) => {
  try {
    const { predecessorId, successorId } = req.query
    if (!predecessorId || !successorId) return res.status(400).json({ code: 9002, message: 'predecessorId / successorId 必填' })
    if (!(await scopedTask(req, successorId))) return res.status(404).json({ code: 9004, message: '任务不存在' })
    const r = await prisma.taskDependency.updateMany({
      where: { predecessorId: BigInt(predecessorId), successorId: BigInt(successorId), deletedAt: null },
      data: { deletedAt: new Date() }
    })
    if (!r.count) return res.status(404).json({ code: 9004, message: '依赖不存在' })
    res.json({ code: 0, data: { removed: r.count } })
  } catch (e) { fail(res, e) }
})

router.delete('/:id', requirePermission('task.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.taskDependency.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '依赖不存在' })
    if (!(await scopedTask(req, existing.successorId))) return res.status(404).json({ code: 9004, message: '任务不存在' })
    await prisma.taskDependency.update({ where: { id }, data: { deletedAt: new Date() } })
    recordActivity({
      actorId: req.user.id, entity: 'task', entityId: existing.successorId, action: 'dependency_removed',
      summary: `任务 #${existing.successorId} 移除依赖 → #${existing.predecessorId}`
    })
    res.json({ code: 0, data: { id: req.params.id, deleted: true } })
  } catch (e) { fail(res, e) }
})

export default router
