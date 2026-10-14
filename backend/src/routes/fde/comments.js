// FDE 平台 - 评论 API（B3）
import express from 'express'
import { resolveMentions } from '../../lib/mentions.js'
import prisma from '../../lib/prisma.js'
import { internalAuth } from '../../lib/auth.js'
import { pushNotification } from '../../lib/notify.js'
import { recordActivity } from '../../lib/activity.js'

const router = express.Router()
router.use(internalAuth)

/**
 * GET /api/fde/comments?entity=task&entityId=1
 */
router.get('/', async (req, res) => {
  try {
    const { entity, entityId } = req.query
    if (!entity || !entityId) return res.status(400).json({ code: 9002, message: 'entity & entityId 必填' })
    const list = await prisma.comment.findMany({
      where: { entity, entityId: BigInt(entityId), deletedAt: null },
      orderBy: { createdAt: 'asc' }
    })
    // 批量拿作者
    const authorIds = [...new Set(list.map(c => c.authorId))]
    const authors = authorIds.length
      ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true, role: true } })
      : []
    const authorMap = new Map(authors.map(a => [String(a.id), a]))

    const data = list.map(c => ({
      ...c,
      author: authorMap.get(String(c.authorId)) || null,
      mentions: c.mentions ? (() => { try { return JSON.parse(c.mentions) } catch { return [] } })() : []
    }))
    res.json({ code: 0, data })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/comments
 * body: { entity, entityId, content, parentId? }
 * 自动解析 @username 提取 mentions
 */
router.post('/', async (req, res) => {
  try {
    const { entity, entityId, content, parentId } = req.body
    if (!entity || !entityId || !content?.trim()) {
      return res.status(400).json({ code: 9002, message: 'entity / entityId / content 必填' })
    }

    // 解析 @姓名 / @用户名(姓名可以带空格, 见 lib/mentions.js)
    const mentionedUsers = await resolveMentions(content)

    const comment = await prisma.comment.create({
      data: {
        entity,
        entityId: BigInt(entityId),
        authorId: BigInt(req.user.id || req.user.userId),
        content: content.trim(),
        parentId: parentId ? BigInt(parentId) : null,
        mentions: mentionedUsers.length ? JSON.stringify(mentionedUsers.map(u => String(u.id))) : null
      }
    })

    // 推送给被@的人
    if (mentionedUsers.length) {
      const author = await prisma.user.findUnique({ where: { id: BigInt(req.user.id || req.user.userId) }, select: { name: true } })
      for (const u of mentionedUsers) {
        if (String(u.id) === String(req.user.id || req.user.userId)) continue  // 跳过自己
        await pushNotification({
          userId: u.id,
          type: 'MENTIONED',
          title: `💬 ${author?.name || '有人'}在评论中提到了你`,
          body: content.slice(0, 100),
          // v1.4.x: 修复坏链——task 直达任务详情弹窗, project 直达项目主页
          link: entity === 'project' ? `/admin/projects/${entityId}` : entity === 'task' ? `/admin/tasks?open=${entityId}` : '/admin/notifications',
          data: { entity, entityId: String(entityId), commentId: String(comment.id) }
        })
      }
    }

    // 记录活动
    const author = await prisma.user.findUnique({ where: { id: BigInt(req.user.id || req.user.userId) }, select: { name: true } })
    await recordActivity({
      actorId: BigInt(req.user.id || req.user.userId),
      entity: 'comment',
      entityId: comment.id,
      action: 'commented',
      summary: `${author?.name || '用户'}评论了${entity}#${entityId}`,
      data: { entity, entityId: String(entityId), mentioned: mentionedUsers.length }
    })

    res.json({
      code: 0,
      data: {
        ...comment,
        author: { id: req.user.id, name: author?.name, role: req.user.role },
        mentions: mentionedUsers.map(u => String(u.id))
      }
    })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/comments/:id
 * 自己或 ADMIN 可删
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const c = await prisma.comment.findUnique({ where: { id } })
    if (!c || c.deletedAt) return res.status(404).json({ code: 9004, message: '评论不存在' })
    if (c.authorId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ code: 9003, message: '无权删除' })
    }
    await prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, data: { id: req.params.id } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
