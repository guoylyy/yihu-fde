// FDE 平台 - 子任务 / 检查清单 API（B4）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { recordActivity } from '../../lib/activity.js'

const router = express.Router()
router.use(internalAuth)
router.use(requirePermission('subtask.manage'))

/**
 * GET /api/fde/subtasks?taskId=1
 */
router.get('/', async (req, res) => {
  try {
    const { taskId } = req.query
    if (!taskId) return res.status(400).json({ code: 9002, message: 'taskId 必填' })
    const list = await prisma.subtask.findMany({
      where: { taskId: BigInt(taskId), deletedAt: null },
      orderBy: { order: 'asc' }
    })
    const total = list.length
    const done = list.filter(s => s.done === 1).length
    res.json({ code: 0, data: { list, total, done, progress: total > 0 ? Math.round(done / total * 100) : 0 } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/subtasks
 * body: { taskId, title, order? }
 */
router.post('/', async (req, res) => {
  try {
    const { taskId, title, order } = req.body
    if (!taskId || !title?.trim()) return res.status(400).json({ code: 9002, message: 'taskId / title 必填' })

    let finalOrder = order
    if (finalOrder == null) {
      const max = await prisma.subtask.aggregate({
        where: { taskId: BigInt(taskId), deletedAt: null },
        _max: { order: true }
      })
      finalOrder = (max._max.order || 0) + 1
    }

    const sub = await prisma.subtask.create({
      data: {
        taskId: BigInt(taskId),
        title: title.trim(),
        order: finalOrder
      }
    })

    const task = await prisma.task.findUnique({ where: { id: BigInt(taskId) }, select: { title: true } })
    await recordActivity({
      actorId: req.user.id,
      entity: 'task',
      entityId: BigInt(taskId),
      action: 'updated',
      summary: `添加子项 "${sub.title}" 到任务 ${task?.title || ''}`
    })

    res.json({ code: 0, data: sub })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/subtasks/:id
 * body: { title?, done?, order? }
 */
router.put('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.subtask.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) return res.status(404).json({ code: 9004, message: '子项不存在' })

    const { title, done, order } = req.body
    const data = {}
    if (title !== undefined) data.title = title.trim()
    if (order !== undefined) data.order = order
    if (done !== undefined) {
      data.done = done ? 1 : 0
      data.completedAt = done ? new Date() : null
      data.completedBy = done ? req.user.id : null
    }

    const sub = await prisma.subtask.update({ where: { id }, data })

    // 任务所有子项都完成 → 自动完成父任务
    if (done === true || done === false) {
      const allSubs = await prisma.subtask.findMany({
        where: { taskId: existing.taskId, deletedAt: null },
        select: { done: true }
      })
      const allDone = allSubs.length > 0 && allSubs.every(s => s.done === 1)
      const task = await prisma.task.findUnique({ where: { id: existing.taskId } })
      if (allDone && task.status !== 'DONE' && task.status !== 'VERIFIED') {
        await prisma.task.update({
          where: { id: existing.taskId },
          data: { status: 'DONE', completedAt: new Date() }
        })
        await recordActivity({
          actorId: req.user.id,
          entity: 'task',
          entityId: existing.taskId,
          action: 'completed',
          summary: `任务 "${task.title}" 全部子项完成，自动标记完成`
        })
      } else if (!allDone && task.status === 'DONE') {
        await prisma.task.update({
          where: { id: existing.taskId },
          data: { status: 'IN_PROGRESS', completedAt: null }
        })
      }
    }

    res.json({ code: 0, data: sub })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/subtasks/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    await prisma.subtask.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, data: { id: req.params.id } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
