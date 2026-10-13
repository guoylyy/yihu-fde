// FDE 平台 - 用户管理（仅 ADMIN）
import express from 'express'
import bcrypt from 'bcrypt'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission, isValidRole, getValidRoleCodes, getRoleName } from '../../lib/auth.js'
import { ensureEngineerProfile, removeEngineerProfile, ENGINEER_ROLES } from './engineers.js'
import { recordActivity } from '../../lib/activity.js'
import { pushNotification } from '../../lib/notify.js'
import { getTeamsByUserIds, getTeamsByUserId } from '../../lib/teams.js'

// v1.5.6: 人员列表统一带出所属团队
async function attachTeams(users) {
  const teamMap = await getTeamsByUserIds(users.map(u => u.id))
  return users.map(u => ({ ...u, teams: teamMap.get(String(u.id)) || [] }))
}

// v1.5.6: 团队归属由管理员在用户管理设置(本人只读)。全量替换该用户的团队
// 返回 { error } 表示校验失败; teamIds 未传时不动团队
async function setUserTeams(userId, teamIds) {
  const ids = [...new Set((teamIds || []).map(String))].map(BigInt)
  if (ids.length) {
    const validCount = await prisma.team.count({ where: { id: { in: ids }, deletedAt: null, status: 1 } })
    if (validCount !== ids.length) return { error: '所选团队中存在无效或已停用的团队' }
  }
  await prisma.$transaction([
    prisma.teamMembership.deleteMany({ where: { userId, teamId: { notIn: ids } } }),
    ...ids.map(teamId => prisma.teamMembership.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId },
      update: {}
    }))
  ])
  return {}
}

const router = express.Router()
router.use(internalAuth)
// 可指派用户接口 (assignable) 对所有有 lead.assign 权限的角色开放
// 自己改密码 (/me/change-password) 任何已登录用户可用
// 其他用户管理接口仅 ADMIN
router.use((req, res, next) => {
  if (req.path === '/assignable') return next()
  if (req.path === '/mentionable') return next()
  if (req.path === '/me/change-password') return next()
  return requireRole('ADMIN')(req, res, next)
})

/**
 * GET /api/fde/users/mentionable  (1.2.7)
 * 评论 @ 提及候选: 全部在职内部用户的 名字/用户名 (登录即可, 只暴露最小字段)
 */
router.get('/mentionable', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, status: 1 },
      select: { id: true, name: true, username: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }]
    })
    res.json({ code: 0, data: { list: await attachTeams(users) } })
  } catch (e) {
    console.error('[fde/users /mentionable]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// v1.3.2: 角色名/白名单改读角色缓存 (roles 表), 加角色不再改这里

const USER_FIELDS = ['username', 'name', 'phone', 'email', 'role', 'status']

function pick(obj, fields) {
  const out = {}
  for (const k of fields) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}


/**
 * GET /api/fde/users
 * 列出内部用户（分页 + 筛选）
 */
router.get('/', requirePermission('user.view'), async (req, res) => {
  try {
    const { page = 1, page_size = 20, keyword = '', role = '', status = '' } = req.query
    const skip = (Number(page) - 1) * Number(page_size)
    const where = { deletedAt: null }
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { name: { contains: keyword } },
        { phone: { contains: keyword } }
      ]
    }
    if (role) where.role = role
    if (status !== '') where.status = Number(status)

    const [list, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: Number(page_size),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, username: true, name: true, phone: true, email: true,
          role: true, status: true, lastLoginAt: true,
          createdAt: true, updatedAt: true,
          engineer: { select: { id: true, level: true, city: true, available: true } }
        }
      }),
      prisma.user.count({ where })
    ])

    res.json({ code: 0, message: 'ok', data: { list: await attachTeams(list), total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    console.error('[fde/users GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/users/:id
 */
router.get('/:id', requirePermission('user.view'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(req.params.id) },
      select: {
        id: true, username: true, name: true, phone: true, email: true,
        role: true, status: true, lastLoginAt: true,
        createdAt: true, updatedAt: true,
        engineer: { select: { id: true, level: true, city: true, available: true, skills: true } }
      }
    })
    if (!user) return res.status(404).json({ code: 2004, message: '用户不存在' })
    user.teams = await getTeamsByUserId(user.id)
    res.json({ code: 0, message: 'ok', data: user })
  } catch (e) {
    console.error('[fde/users GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/users/me/change-password
 * 用户自己改密码 (任何已登录用户可用)
 * Body: { oldPassword, newPassword }
 * 修改成功后清 mustChangePassword 标志
 */
router.put('/me/change-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {}
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ code: 1001, message: '旧密码和新密码不能为空' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ code: 1005, message: '新密码至少 6 位' })
    }
    if (newPassword === '123456') {
      return res.status(400).json({ code: 1005, message: '不能使用默认密码 123456' })
    }
    const user = await prisma.user.findUnique({ where: { id: BigInt(req.user.userId) } })
    if (!user) return res.status(404).json({ code: 2004, message: '用户不存在' })
    const valid = await bcrypt.compare(oldPassword, user.passwordHash)
    if (!valid) return res.status(400).json({ code: 2003, message: '旧密码错误' })
    const newHash = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false }
    })
    // 活动流
    await recordActivity({
      actorId: user.id,
      entity: 'user',
      entityId: user.id,
      action: 'updated',
      summary: '修改了自己的密码',
      data: { action: 'change_password' }
    })
    res.json({ code: 0, message: 'ok', _hint: '密码修改成功' })
  } catch (e) {
    console.error('[fde/users PUT /me/change-password]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/users
 * 创建内部用户
 * 默认密码 123456（前端提示管理员可以重置）
 */
router.post('/', requirePermission('user.create'), async (req, res) => {
  try {
    const data = pick(req.body, USER_FIELDS)
    if (!data.username) return res.status(400).json({ code: 1001, message: '用户名不能为空' })
    if (!data.name) return res.status(400).json({ code: 1002, message: '姓名不能为空' })
    if (!data.role || !isValidRole(data.role)) {
      return res.status(400).json({ code: 1003, message: `角色必须是 ${getValidRoleCodes().join(' / ')}` })
    }
    if (data.status == null) data.status = 1

    // 检查用户名唯一
    const exist = await prisma.user.findFirst({
      where: { username: data.username, deletedAt: null }
    })
    if (exist) return res.status(400).json({ code: 1004, message: '用户名已存在' })

    // 默认密码 123456
    const passwordHash = await bcrypt.hash('123456', 10)

    const user = await prisma.user.create({
      data: { ...data, passwordHash, mustChangePassword: true },
      select: {
        id: true, username: true, name: true, phone: true, email: true,
        role: true, status: true, createdAt: true
      }
    })
    // v1.5.6: 建号时可直接指定所属团队
    if (req.body.teamIds !== undefined) {
      const { error } = await setUserTeams(user.id, req.body.teamIds)
      if (error) console.warn('[fde/users POST /] setUserTeams:', error)
    }
    // 方案 B: 创建可派工角色时自动建工程师档案（FDE_ENGINEER / MANAGER / PLATFORM / SALES）
    if (ENGINEER_ROLES.includes(user.role)) {
      await ensureEngineerProfile(user.id)
    }
    // v2.12: 默认必修路径随以太学院删除
    // 活动流 + 通知
    await recordActivity({
      actorId: req.user.id,
      entity: 'user',
      entityId: user.id,
      action: 'created',
      summary: `邀请新成员「${user.name}」加入（${user.role}）`,
      data: { role: user.role, username: user.username }
    })
    await pushNotification({
      userId: user.id,
      type: 'USER_INVITED',
      title: '🎉 欢迎加入',
      body: `你已被添加为 ${getRoleName(user.role)}，默认密码 123456，请尽快修改`,
      link: '/admin',
      data: { username: user.username, name: user.name, role: getRoleName(user.role), defaultPassword: '123456' }
    })
    res.json({ code: 0, message: 'ok', data: user, _hint: '默认密码：123456（请提醒用户首次登录后修改）' })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 1004, message: '用户名已存在' })
    console.error('[fde/users POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/users/:id
 * 更新用户基本信息（不包含密码）
 */
router.put('/:id', requirePermission('user.edit'), async (req, res) => {
  try {
    const data = pick(req.body, USER_FIELDS)
    delete data.username  // 用户名不可改
    if (data.role && !isValidRole(data.role)) {
      return res.status(400).json({ code: 1003, message: `角色必须是 ${getValidRoleCodes().join(' / ')}` })
    }
    if (data.status != null) data.status = Number(data.status)

    // 不允许把最后一个 ADMIN 降级或停用
    if (data.role && data.role !== 'ADMIN' || data.status === 0) {
      const me = await prisma.user.findUnique({ where: { id: BigInt(req.params.id) } })
      if (me && me.role === 'ADMIN') {
        const adminCount = await prisma.user.count({
          where: { role: 'ADMIN', status: 1, deletedAt: null }
        })
        if (adminCount <= 1) {
          return res.status(400).json({ code: 1005, message: '系统至少保留 1 个启用的 ADMIN' })
        }
      }
    }

    const oldUser = await prisma.user.findUnique({ where: { id: BigInt(req.params.id) } })
    if (!oldUser) return res.status(404).json({ code: 2004, message: '用户不存在' })

    // v1.5.6: 管理员设置所属团队(teamIds 传了才动, 全量替换)
    if (req.body.teamIds !== undefined) {
      const { error } = await setUserTeams(oldUser.id, req.body.teamIds)
      if (error) return res.status(400).json({ code: 9002, message: error })
    }

    const user = await prisma.user.update({
      where: { id: BigInt(req.params.id) },
      data,
      select: {
        id: true, username: true, name: true, phone: true, email: true,
        role: true, status: true, updatedAt: true
      }
    })

    // 方案 B: 角色变动 → 同步 engineer 档案
    const oldRole = oldUser.role
    const newRole = user.role
    const wasEngineer = ENGINEER_ROLES.includes(oldRole)
    const isEngineer = ENGINEER_ROLES.includes(newRole)
    let extraHint = null
    let extraWarn = null
    if (oldRole !== newRole) {
      if (!wasEngineer && isEngineer) {
        // 转为可派工角色：自动建档案
        await ensureEngineerProfile(user.id)
        extraHint = '已自动创建工程师档案'
      } else if (wasEngineer && !isEngineer) {
        // 离开可派工角色：根据 query 参数 ?removeProfile=true 决定是否清除档案
        if (req.query.removeProfile === 'true') {
          await removeEngineerProfile(user.id)
          extraHint = '已同时清理工程师档案'
        } else {
          // 默认保留档案，告知调用方
          extraWarn = '工程师档案已保留，如需清理请带 ?removeProfile=true'
        }
      }
    }

    // 活动流 + 通知：记录关键字段变化
    const changes = []
    if (oldUser.name !== user.name) changes.push(`姓名「${oldUser.name}」→「${user.name}」`)
    if (oldUser.role !== user.role) changes.push(`角色 ${oldUser.role}→${user.role}`)
    if (Number(oldUser.status) !== Number(user.status)) changes.push(`状态 ${oldUser.status}→${user.status}`)
    if (changes.length) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'user',
        entityId: user.id,
        action: 'updated',
        summary: `更新了「${user.name}」的资料：${changes.join('，')}`,
        data: { changes: changes.join(';'), oldRole, newRole }
      })
    }
    // 角色变化通知本人
    if (oldRole !== newRole) {
      await pushNotification({
        userId: user.id,
        type: 'ROLE_CHANGED',
        title: '🪪 你的角色已变更',
        body: `从 ${getRoleName(oldRole)} 变更为 ${getRoleName(newRole)}`,
        link: '/admin'
      })
    }
    // 账号被停用通知
    if (Number(oldUser.status) === 1 && Number(user.status) === 0) {
      await pushNotification({
        userId: user.id,
        type: 'ACCOUNT_DISABLED',
        title: '⛔ 你的账号已被停用',
        body: '请联系管理员恢复',
        link: null
      })
    }

    const resp = { code: 0, message: 'ok', data: user }
    if (extraHint) resp._hint = extraHint
    if (extraWarn) resp._warn = extraWarn
    res.json(resp)
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '用户不存在' })
    console.error('[fde/users PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/users/:id/reset-password
 * 重置密码为 123456
 */
router.post('/:id/reset-password', requirePermission('user.resetPassword'), async (req, res) => {
  try {
    const passwordHash = await bcrypt.hash('123456', 10)
    const user = await prisma.user.update({
      where: { id: BigInt(req.params.id) },
      data: { passwordHash, mustChangePassword: true },
      select: { id: true, username: true, name: true }
    })
    // 活动流 + 通知被重置人
    await recordActivity({
      actorId: req.user.id,
      entity: 'user',
      entityId: user.id,
      action: 'updated',
      summary: `重置了「${user.name}」的密码`,
      data: { action: 'reset_password' }
    })
    await pushNotification({
      userId: user.id,
      type: 'PASSWORD_RESET',
      title: '🔑 密码已重置',
      body: '你的密码已被重置为默认密码 123456，请尽快修改',
      link: '/admin'
    })
    res.json({ code: 0, message: 'ok', data: user, _hint: '密码已重置为 123456' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '用户不存在' })
    console.error('[fde/users POST /:id/reset-password]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/users/:id
 * 软删除（设 deletedAt）
 * 不允许删除自己 / 不允许删除最后一个 ADMIN
 */
router.delete('/:id', requirePermission('user.delete'), async (req, res) => {
  try {
    const targetId = BigInt(req.params.id)
    if (targetId === BigInt(req.user.userId)) {
      return res.status(400).json({ code: 1006, message: '不能删除自己' })
    }
    const target = await prisma.user.findUnique({ where: { id: targetId } })
    if (!target) return res.status(404).json({ code: 2004, message: '用户不存在' })
    if (target.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN', status: 1, deletedAt: null }
      })
      if (adminCount <= 1) {
        return res.status(400).json({ code: 1005, message: '系统至少保留 1 个启用的 ADMIN' })
      }
    }
    await prisma.user.update({
      where: { id: targetId },
      data: { deletedAt: new Date(), status: 0 }
    })
    // 方案 B: 如果是可派工角色，用户软删时同步软删工程师档案（保留数据完整性）
    if (ENGINEER_ROLES.includes(target.role)) {
      await removeEngineerProfile(targetId)
    }
    // 活动流
    await recordActivity({
      actorId: req.user.id,
      entity: 'user',
      entityId: targetId,
      action: 'updated',
      summary: `删除了成员「${target.name}」`,
      data: { action: 'delete', role: target.role }
    })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '用户不存在' })
    console.error('[fde/users DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
