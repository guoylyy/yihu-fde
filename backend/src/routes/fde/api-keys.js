// FDE 平台 - API Key 管理（MCP / 智能体对接凭证）
// 每个用户管理自己的 Key; ADMIN 可通过 userId 参数给他人签发/查看
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, hasRole } from '../../lib/auth.js'
import { generateApiKey } from '../../lib/apiKey.js'

const router = express.Router()
router.use(internalAuth)

function serialize(k) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix + '...',
    scope: k.scope || 'PERSONAL',
    status: k.status,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
    userId: k.userId,
    user: k.user ? { id: k.user.id, username: k.user.username, name: k.user.name } : undefined
  }
}

// 列表：默认看自己的; ADMIN 可传 userId 查别人 / 不传 all=true 看全部
router.get('/', async (req, res) => {
  try {
    const isAdmin = hasRole(req.user, 'ADMIN')
    const where = {}
    if (isAdmin && req.query.all === 'true') {
      // 全部
    } else if (isAdmin && req.query.userId) {
      where.userId = BigInt(req.query.userId)
    } else {
      where.userId = BigInt(req.user.userId)
    }
    const list = await prisma.apiKey.findMany({
      where,
      include: { user: { select: { id: true, username: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    })
    res.json({ code: 0, data: { list: list.map(serialize) } })
  } catch (e) {
    console.error('[api-keys:list]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 创建：明文只返回这一次
router.post('/', async (req, res) => {
  try {
    const { name, userId, scope } = req.body || {}
    if (!name || !String(name).trim()) {
      return res.status(400).json({ code: 1001, message: 'name 必填（用途备注）' })
    }
    // 2026-07-29 AGENT 级 Key(手机号路由)下线: Agent 平台改为透传用户登录 Token, 不再需要平台共享 Key
    if (scope === 'AGENT') {
      return res.status(400).json({ code: 1001, message: 'AGENT 级 Key 已停用：Agent 平台请直接透传用户登录 Token 调用 /api/mcp（Authorization: Bearer <token>）' })
    }
    const keyScope = 'PERSONAL'
    let targetUserId = BigInt(req.user.userId)
    if (userId && String(userId) !== String(req.user.userId)) {
      if (!hasRole(req.user, 'ADMIN')) {
        return res.status(403).json({ code: 1003, message: '只有 ADMIN 能给他人签发 API Key' })
      }
      targetUserId = BigInt(userId)
      const target = await prisma.user.findUnique({ where: { id: targetUserId } })
      if (!target || target.status !== 1 || target.deletedAt) {
        return res.status(404).json({ code: 2004, message: '目标用户不存在或已禁用' })
      }
    }
    const { raw, hash, prefix } = generateApiKey()
    const record = await prisma.apiKey.create({
      data: { userId: targetUserId, name: String(name).trim(), keyHash: hash, prefix, scope: keyScope }
    })
    res.json({
      code: 0,
      message: 'API Key 创建成功，明文仅此一次返回，请妥善保存',
      data: { id: record.id, name: record.name, scope: record.scope, apiKey: raw }
    })
  } catch (e) {
    console.error('[api-keys:create]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 修改（仅名称/用途备注; Key 本体不可改）：本人或 ADMIN
router.patch('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const { name } = req.body || {}
    if (!name || !String(name).trim()) {
      return res.status(400).json({ code: 1001, message: 'name 必填（用途备注）' })
    }
    const record = await prisma.apiKey.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ code: 2004, message: 'API Key 不存在' })
    const isOwner = String(record.userId) === String(req.user.userId)
    if (!isOwner && !hasRole(req.user, 'ADMIN')) {
      return res.status(403).json({ code: 1003, message: '只能修改自己的 API Key' })
    }
    const updated = await prisma.apiKey.update({
      where: { id },
      data: { name: String(name).trim() }
    })
    res.json({ code: 0, message: '已更新', data: serialize(updated) })
  } catch (e) {
    console.error('[api-keys:update]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 删除：仅限已吊销的 Key（有效 Key 先吊销再删, 保留审计痕迹）；本人或 ADMIN
router.delete('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const record = await prisma.apiKey.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ code: 2004, message: 'API Key 不存在' })
    const isOwner = String(record.userId) === String(req.user.userId)
    if (!isOwner && !hasRole(req.user, 'ADMIN')) {
      return res.status(403).json({ code: 1003, message: '只能删除自己的 API Key' })
    }
    if (record.status === 1) {
      return res.status(400).json({ code: 1001, message: '有效的 Key 不能直接删除，请先吊销' })
    }
    await prisma.apiKey.delete({ where: { id } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    console.error('[api-keys:delete]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 吊销（软操作：status=0, 不删记录）
router.post('/:id/revoke', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const record = await prisma.apiKey.findUnique({ where: { id } })
    if (!record) return res.status(404).json({ code: 2004, message: 'API Key 不存在' })
    const isOwner = String(record.userId) === String(req.user.userId)
    if (!isOwner && !hasRole(req.user, 'ADMIN')) {
      return res.status(403).json({ code: 1003, message: '只能吊销自己的 API Key' })
    }
    if (record.status === 0) {
      return res.json({ code: 0, message: '该 Key 已是吊销状态' })
    }
    await prisma.apiKey.update({ where: { id }, data: { status: 0, revokedAt: new Date() } })
    res.json({ code: 0, message: '已吊销' })
  } catch (e) {
    console.error('[api-keys:revoke]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
