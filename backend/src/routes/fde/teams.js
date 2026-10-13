// FDE 平台 - 团队管理 (v1.5.6)
// 组织维度的人员分组, 一人可属多个团队。动因: 即时消息通知需要按"用户所属团队"
// 定位接收群, 用户没设团队就无法精准触达。
// 权限: 列表/详情任何登录用户可读(个人中心查看/人员卡片展示要用); 增删改/成员调整需 team.manage。
// 团队归属由管理员设置: 团队管理页全量设成员, 或用户管理编辑单人的 teamIds; 本人只读。
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { logInternalAction } from '../../lib/audit.js'

const router = express.Router()
router.use(internalAuth)

const LEADER_SELECT = { select: { id: true, name: true, username: true, avatarUrl: true } }
const MEMBER_USER_SELECT = {
  select: { id: true, name: true, username: true, role: true, avatarUrl: true, status: true }
}

function serialize(team) {
  const { members, _count, ...rest } = team
  return {
    ...rest,
    memberCount: _count?.members ?? members?.length ?? 0,
    members: members ? members.map(m => m.user) : undefined
  }
}

/**
 * GET /api/fde/teams
 * 启用中团队清单(任何登录用户 — 个人中心查看/人员卡片展示要用)
 * ?all=1 时含停用团队 (仅 team.manage)
 */
router.get('/', async (req, res) => {
  try {
    const query = where => prisma.team.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { leader: LEADER_SELECT, _count: { select: { members: true } } }
    })
    if (req.query.all === '1') {
      return requirePermission('team.manage')(req, res, async () => {
        const list = await query({ deletedAt: null })
        res.json({ code: 0, data: { list: list.map(serialize) } })
      })
    }
    const list = await query({ deletedAt: null, status: 1 })
    res.json({ code: 0, data: { list: list.map(serialize) } })
  } catch (e) {
    console.error('[fde/teams GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/teams/:id  团队详情 + 成员清单
 */
router.get('/:id', async (req, res) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: BigInt(req.params.id), deletedAt: null },
      include: {
        leader: LEADER_SELECT,
        members: { include: { user: MEMBER_USER_SELECT }, orderBy: { id: 'asc' } }
      }
    })
    if (!team) return res.status(404).json({ code: 9004, message: '团队不存在' })
    res.json({ code: 0, data: serialize(team) })
  } catch (e) {
    console.error('[fde/teams GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

async function validatePayload(body, existingId = null) {
  const { name, description, leaderId, chatWebhookUrl, status, sortOrder } = body || {}
  const data = {}
  if (name !== undefined) {
    if (!String(name).trim()) return { error: '团队名称不能为空' }
    if (String(name).trim().length > 50) return { error: '团队名称不超过 50 字' }
    const exist = await prisma.team.findFirst({
      where: { name: String(name).trim(), deletedAt: null, ...(existingId ? { id: { not: existingId } } : {}) }
    })
    if (exist) return { error: `团队「${String(name).trim()}」已存在` }
    data.name = String(name).trim()
  }
  if (description !== undefined) data.description = description || null
  if (leaderId !== undefined) {
    if (leaderId) {
      const leader = await prisma.user.findFirst({ where: { id: BigInt(leaderId), deletedAt: null } })
      if (!leader) return { error: '指定的团队负责人不存在' }
      data.leaderId = BigInt(leaderId)
    } else {
      data.leaderId = null
    }
  }
  if (chatWebhookUrl !== undefined) data.chatWebhookUrl = chatWebhookUrl || null
  if (status !== undefined) data.status = Number(status) === 0 ? 0 : 1
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0
  return { data }
}

/**
 * POST /api/fde/teams  { name, description?, leaderId?, chatWebhookUrl?, sortOrder? }
 */
router.post('/', requirePermission('team.manage'), async (req, res) => {
  try {
    if (!req.body?.name) return res.status(400).json({ code: 9002, message: '团队名称不能为空' })
    const { data, error } = await validatePayload(req.body)
    if (error) return res.status(400).json({ code: 9002, message: error })
    const team = await prisma.team.create({ data })
    logInternalAction(req, 'TEAM_CREATE', {
      resourceType: 'TEAM', resourceId: team.id,
      details: { name: team.name }
    })
    res.json({ code: 0, data: team })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 9003, message: '团队名称已存在' })
    console.error('[fde/teams POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/teams/:id  { name?, description?, leaderId?, chatWebhookUrl?, status?, sortOrder? }
 */
router.put('/:id', requirePermission('team.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.team.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '团队不存在' })
    const { data, error } = await validatePayload(req.body, id)
    if (error) return res.status(400).json({ code: 9002, message: error })
    const team = await prisma.team.update({ where: { id }, data })
    logInternalAction(req, 'TEAM_UPDATE', {
      resourceType: 'TEAM', resourceId: id,
      details: { name: team.name, changes: Object.keys(data) }
    })
    res.json({ code: 0, data: team })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 9003, message: '团队名称已存在' })
    console.error('[fde/teams PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/teams/:id/members  { userIds: [] }
 * 全量设置团队成员(管理员视角)
 */
router.put('/:id/members', requirePermission('team.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const team = await prisma.team.findFirst({ where: { id, deletedAt: null } })
    if (!team) return res.status(404).json({ code: 9004, message: '团队不存在' })

    const userIds = [...new Set((req.body?.userIds || []).map(String))].map(BigInt)
    const validCount = await prisma.user.count({ where: { id: { in: userIds }, deletedAt: null } })
    if (validCount !== userIds.length) {
      return res.status(400).json({ code: 9002, message: '成员列表里存在无效用户' })
    }

    await prisma.$transaction([
      prisma.teamMembership.deleteMany({ where: { teamId: id, userId: { notIn: userIds } } }),
      ...userIds.map(userId => prisma.teamMembership.upsert({
        where: { teamId_userId: { teamId: id, userId } },
        create: { teamId: id, userId },
        update: {}
      }))
    ])
    logInternalAction(req, 'TEAM_SET_MEMBERS', {
      resourceType: 'TEAM', resourceId: id,
      details: { name: team.name, memberCount: userIds.length }
    })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    console.error('[fde/teams PUT /:id/members]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/teams/:id  软删团队, 同时清空成员关系
 */
router.delete('/:id', requirePermission('team.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.team.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '团队不存在' })
    await prisma.$transaction([
      prisma.teamMembership.deleteMany({ where: { teamId: id } }),
      prisma.team.update({ where: { id }, data: { deletedAt: new Date(), status: 0 } })
    ])
    logInternalAction(req, 'TEAM_DELETE', {
      resourceType: 'TEAM', resourceId: id,
      details: { name: existing.name }
    })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    console.error('[fde/teams DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
