// FDE 平台 - 工程师档案 API
// 方案 B：Engineer 是 User 的"档案扩展"
// - 工程师列表 = role ∈ {FDE_ENGINEER, MANAGER} 的用户（含其档案）
//   即所有非-ADMIN 角色都可以作为现场工程师参与派工与计费
// - 工程师档案通过 userId 1:1 关联
// - 创建/删除工程师请走 /api/fde/users（用户管理）
// - 本路由只支持 GET（列表/详情）和 PATCH（编辑档案字段）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission } from '../../lib/auth.js'
import { recordActivity } from '../../lib/activity.js'
import { getTeamsByUserIds, getTeamsByUserId } from '../../lib/teams.js'
import { ENGINEER_ROLES } from '../../lib/engineerRoles.js'

// 可被派工的内部角色（ADMIN 仅做管理，不计入工程师池）
export { ENGINEER_ROLES }

const router = express.Router()
router.use(internalAuth)
// 工程师档案：仅 ADMIN / MANAGER
router.use(requirePermission('engineer.access'))

const PROFILE_FIELDS = ['level', 'skills', 'city', 'dailyRate', 'bio', 'available']

function pick(obj, fields) {
  const out = {}
  for (const k of fields) if (obj[k] !== undefined) out[k] = k === 'skills' && typeof obj[k] === 'string' ? JSON.parse(obj[k] || '[]') : obj[k]
  return out
}

/**
 * GET /api/fde/engineers
 * 列出 role ∈ ENGINEER_ROLES 的用户 + 他们的工程师档案
 * Query: page, page_size, keyword, level, available, role
 */
router.get('/', requirePermission('engineer.view'), async (req, res) => {
  try {
    const { page = 1, page_size = 20, keyword = '', level = '', available = '', role = '' } = req.query
    const skip = (Number(page) - 1) * Number(page_size)

    // 筛用户：所有可被派工的内部角色
    const userWhere = { role: { in: ENGINEER_ROLES }, deletedAt: null }
    if (role && ENGINEER_ROLES.includes(role)) {
      userWhere.role = role
    }
    if (keyword) {
      userWhere.OR = [
        { username: { contains: keyword } },
        { name: { contains: keyword } },
        { phone: { contains: keyword } }
      ]
    }

    // 筛档案
    const profileWhere = { deletedAt: null }
    if (level) profileWhere.level = level
    if (available !== '') profileWhere.available = Number(available)

    // 拉所有可派工用户的 userId（避免 join 复杂）
    const users = await prisma.user.findMany({
      where: userWhere,
      orderBy: { createdAt: 'desc' },
      select: { id: true, username: true, name: true, phone: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true }
    })
    const userIds = users.map(u => u.id)
    const profiles = await prisma.engineer.findMany({
      where: { userId: { in: userIds }, ...profileWhere },
      include: {
        _count: { select: { projectMembers: true, timesheets: true } }
      }
    })
    const profileByUserId = new Map(profiles.map(p => [p.userId.toString(), p]))
    // v1.5.6: 带出所属团队
    const teamMap = await getTeamsByUserIds(userIds)

    // 合并 + 筛选（按档案）
    let merged = users.map(u => {
      const p = profileByUserId.get(u.id.toString())
      return {
        teams: teamMap.get(u.id.toString()) || [],
        id: p?.id || null,                 // engineer.id（有档案才有）
        userId: u.id,
        username: u.username,
        name: u.name,
        phone: u.phone,
        email: u.email,
        role: u.role,                       // 用户角色（含 MANAGER 等）
        status: u.status,                   // 用户状态
        lastLoginAt: u.lastLoginAt,
        // 档案字段（可能为空）
        level: p?.level || null,
        skills: p?.skills || [],
        city: p?.city || null,
        dailyRate: p?.dailyRate || null,
        available: p?.available ?? null,
        projectMembers: p?._count.projectMembers || 0,
        timesheets: p?._count.timesheets || 0,
        hasProfile: !!p
      }
    })
    if (level) merged = merged.filter(r => r.level === level)
    if (available !== '') merged = merged.filter(r => r.available === Number(available))

    const total = merged.length
    const list = merged.slice(skip, skip + Number(page_size))

    res.json({ code: 0, message: 'ok', data: { list, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    console.error('[fde/engineers GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/engineers/:id
 * id 可以是 engineer.id 或 userId（自动识别）
 * 返回 user + 档案详情
 */
router.get('/:id', requirePermission('engineer.view'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    // 先按 engineer.id 查
    let engineer = await prisma.engineer.findUnique({
      where: { id },
      include: {
        user: true,
        certifications: { where: { deletedAt: null } },
        _count: { select: { projectMembers: true, timesheets: true } }
      }
    })
    let user = null
    if (engineer) {
      user = engineer.user
    } else {
      // 当 userId 查
      engineer = await prisma.engineer.findUnique({
        where: { userId: id },
        include: {
          user: true,
          certifications: { where: { deletedAt: null } },
          _count: { select: { projectMembers: true, timesheets: true } }
        }
      })
      user = engineer?.user || (await prisma.user.findUnique({ where: { id } }))
    }
    if (!user || !ENGINEER_ROLES.includes(user.role) || user.deletedAt) {
      return res.status(404).json({ code: 2004, message: '工程师不存在' })
    }
    res.json({
      code: 0,
      message: 'ok',
      data: {
        user: { id: user.id, username: user.username, name: user.name, phone: user.phone, email: user.email, status: user.status, role: user.role, teams: await getTeamsByUserId(user.id) },
        profile: engineer ? {
          id: engineer.id, level: engineer.level, skills: engineer.skills, city: engineer.city,
          dailyRate: engineer.dailyRate, available: engineer.available, bio: engineer.bio
        } : null,
        _count: engineer?._count || { projectMembers: 0, timesheets: 0 }
      }
    })
  } catch (e) {
    console.error('[fde/engineers GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PATCH /api/fde/engineers/:id
 * 编辑工程师档案字段（level/skills/city/dailyRate/bio/available）
 * :id = engineer.id
 */
router.patch('/:id', requirePermission('engineer.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const data = pick(req.body, PROFILE_FIELDS)
    const old = await prisma.engineer.findUnique({ where: { id } })
    if (!old) return res.status(404).json({ code: 2004, message: '工程师档案不存在' })

    const engineer = await prisma.engineer.update({
      where: { id },
      data,
      include: { user: { select: { id: true, name: true, username: true } } }
    })
    // 活动流：记录关键字段变化
    const changes = []
    if (old.level !== engineer.level) changes.push(`职级 ${old.level}→${engineer.level}`)
    if (old.title !== engineer.title) changes.push(`头衔「${old.title || '无'}」→「${engineer.title || '无'}」`)
    if (Number(old.available) !== Number(engineer.available)) {
      changes.push(Number(engineer.available) === 1 ? '已设为可派工' : '已设为不可派工')
    }
    if (changes.length) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'engineer',
        entityId: id,
        action: 'updated',
        summary: `更新工程师「${engineer.user.name}」档案：${changes.join('，')}`,
        data: { changes: changes.join(';') }
      })
    }
    res.json({ code: 0, message: 'ok', data: engineer })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '工程师档案不存在' })
    console.error('[fde/engineers PATCH /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * 辅助：确保某 user 有 engineer 档案
 * (由 users.js 在创建/改角色时调用)
 */
export async function ensureEngineerProfile(userId, tx = prisma) {
  const exist = await tx.engineer.findUnique({ where: { userId } })
  if (exist) return exist
  return tx.engineer.create({ data: { userId, available: 1 } })
}

/**
 * 辅助：清空某 user 的 engineer 档案
 * 供 users.js 在改角色离开 FDE 时调用
 * (软删除 + 级联清工时关联)
 */
export async function removeEngineerProfile(userId, tx = prisma) {
  const exist = await tx.engineer.findUnique({ where: { userId } })
  if (!exist) return null
  // 不硬删，保留历史；标记 deletedAt
  return tx.engineer.update({
    where: { id: exist.id },
    data: { deletedAt: new Date() }
  })
}

export default router
