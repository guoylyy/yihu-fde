// FDE 平台 - 团队 (v1.5.6)
// 团队 = 以虎 One 的部门: 由通讯录同步(services/directorySync.js)按平台部门生成, 名称和成员以平台为准。
// 本系统只能补充团队负责人、说明、排序和群机器人 Webhook(即时消息按团队路由时用);
// 接入平台前手建、没有对应部门的团队可以删除。
// 权限: 列表/详情任何登录用户可读(个人中心查看/人员卡片展示要用); 修改需 team.manage。
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

/** 可改的只有平台没有的信息; 名称、成员、启停由通讯录同步决定 */
async function validatePayload(body) {
  const { description, leaderId, chatWebhookUrl, sortOrder } = body || {}
  const data = {}
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
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0
  return { data }
}

/**
 * PUT /api/fde/teams/:id  { description?, leaderId?, chatWebhookUrl?, sortOrder? }
 */
router.put('/:id', requirePermission('team.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.team.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '团队不存在' })
    const { data, error } = await validatePayload(req.body)
    if (error) return res.status(400).json({ code: 9002, message: error })
    const team = await prisma.team.update({ where: { id }, data })
    logInternalAction(req, 'TEAM_UPDATE', {
      resourceType: 'TEAM', resourceId: id,
      details: { name: team.name, changes: Object.keys(data) }
    })
    res.json({ code: 0, data: team })
  } catch (e) {
    console.error('[fde/teams PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/teams/:id  只能删手建的团队(没有对应平台部门); 平台部门生成的团队由同步管理
 */
router.delete('/:id', requirePermission('team.manage'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.team.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '团队不存在' })
    if (existing.platformDeptId != null) return res.status(400).json({ code: 9002, message: '这个团队对应以虎 One 的部门，由通讯录同步管理，不能删除' })
    await prisma.$transaction([
      prisma.teamMembership.deleteMany({ where: { teamId: id } }),
      prisma.team.update({ where: { id }, data: { deletedAt: new Date(), status: 0 } })
    ])
    logInternalAction(req, 'TEAM_DELETE', { resourceType: 'TEAM', resourceId: id, details: { name: existing.name } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    console.error('[fde/teams DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
