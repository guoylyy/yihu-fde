// FDE 平台 - 用户管理（仅 ADMIN）
// 人以以虎 One 为准: 账号在首次登录时自动开通, 或由管理员从平台通讯录里选人提前开通并指定角色。
// 姓名、邮箱、手机来自平台(登录和通讯录同步时更新), 这里只管本系统的角色和启停。没有本地密码。
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission, isValidRole, getValidRoleCodes, getRoleName } from '../../lib/auth.js'
import { ensureEngineerProfile, removeEngineerProfile, ENGINEER_ROLES } from './engineers.js'
import { recordActivity } from '../../lib/activity.js'
import { pushNotification } from '../../lib/notify.js'
import { getTeamsByUserIds, getTeamsByUserId } from '../../lib/teams.js'
import { listDirectory, platformEnabled } from '../../lib/yihuOne.js'

// v1.5.6: 人员列表统一带出所属团队
async function attachTeams(users) {
  const teamMap = await getTeamsByUserIds(users.map(u => u.id))
  return users.map(u => ({ ...u, teams: teamMap.get(String(u.id)) || [] }))
}

const router = express.Router()
router.use(internalAuth)
// :id 只能是数字(否则 BigInt 报 500, 如访问不存在的 /assignable)
router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : res.status(404).json({ code: 2004, message: '用户不存在' })))
// 其他用户管理接口仅 ADMIN
router.use((req, res, next) => {
  if (req.path === '/mentionable') return next()
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

// 姓名 / 邮箱 / 手机以平台为准, 本系统只改角色和启停
const USER_FIELDS = ['role', 'status']

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
          role: true, status: true, lastLoginAt: true, roleSource: true, platformDisabled: true, oidcSubject: true,
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

// ---------- 从以虎 One 通讯录开通 ----------

let directoryCache = null   // { at, list }
async function directory() {
  if (directoryCache && Date.now() - directoryCache.at < 60_000) return directoryCache.list
  const { list } = await listDirectory()
  directoryCache = { at: Date.now(), list }
  return list
}

/**
 * GET /api/fde/users/platform-directory?keyword=
 * 平台通讯录里还没在本系统开通的在职的人(选人提前开通用), 最多 50 条
 */
router.get('/platform-directory', requirePermission('user.create'), async (req, res) => {
  if (!platformEnabled()) return res.status(503).json({ code: 9003, message: '还没有接入以虎 One' })
  try {
    const kw = String(req.query.keyword || '').trim().toLowerCase()
    const linked = new Set((await prisma.user.findMany({ where: { oidcSubject: { not: null }, deletedAt: null }, select: { oidcSubject: true } })).map(u => u.oidcSubject))
    const list = (await directory())
      .filter(p => p.active && !linked.has(String(p.id)))
      .filter(p => !kw || [p.name, p.username, p.jobNumber, p.email, ...(p.depts || []).map(d => d.path)].some(v => String(v || '').toLowerCase().includes(kw)))
      .slice(0, 50)
      .map(p => ({ id: p.id, name: p.name, username: p.username, jobNumber: p.jobNumber, email: p.email, title: p.title, depts: (p.depts || []).map(d => d.path || d.name) }))
    res.json({ code: 0, data: { list } })
  } catch (e) {
    res.status(502).json({ code: 9002, message: e.message })
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
        role: true, status: true, lastLoginAt: true, roleSource: true, platformDisabled: true, oidcSubject: true,
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
 * POST /api/fde/users  { platformUserId, role }
 * 从平台通讯录选人提前开通并指定角色(角色记为管理员设置, 登录时不再按规则改; 平台管理员除外)
 */
router.post('/', requirePermission('user.create'), async (req, res) => {
  if (!platformEnabled()) return res.status(503).json({ code: 9003, message: '还没有接入以虎 One' })
  try {
    const { platformUserId, role } = req.body || {}
    if (!role || !isValidRole(role)) {
      return res.status(400).json({ code: 1003, message: `角色必须是 ${getValidRoleCodes().join(' / ')}` })
    }
    directoryCache = null
    const pu = (await directory()).find(p => String(p.id) === String(platformUserId))
    if (!pu || !pu.active) return res.status(400).json({ code: 1004, message: '平台通讯录里没有这个人，或已停用' })
    if (await prisma.user.findUnique({ where: { oidcSubject: String(pu.id) } })) {
      return res.status(400).json({ code: 1004, message: '这个人已经开通了' })
    }
    const base = String(pu.username || pu.jobNumber || `user${pu.id}`).toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 40) || `user${pu.id}`
    const username = (await prisma.user.findUnique({ where: { username: base } })) ? `${base}-${pu.id}` : base
    const user = await prisma.user.create({
      data: {
        username, name: String(pu.name || username).slice(0, 50),
        email: pu.email ? String(pu.email).slice(0, 100) : null,
        phone: pu.mobile ? String(pu.mobile).slice(0, 20) : null,
        role, roleSource: 'MANUAL', status: 1, oidcSubject: String(pu.id)
      },
      select: { id: true, username: true, name: true, phone: true, email: true, role: true, status: true, createdAt: true }
    })
    if (ENGINEER_ROLES.includes(user.role)) await ensureEngineerProfile(user.id)
    await recordActivity({
      actorId: req.user.id,
      entity: 'user',
      entityId: user.id,
      action: 'created',
      summary: `从以虎 One 通讯录开通了「${user.name}」（${getRoleName(user.role)}）`,
      data: { role: user.role, username: user.username }
    })
    await pushNotification({
      userId: user.id,
      type: 'USER_INVITED',
      title: '🎉 欢迎加入',
      body: `你已被添加为 ${getRoleName(user.role)}，用以虎 One 账号登录即可`,
      link: '/admin',
      data: { username: user.username, name: user.name, role: getRoleName(user.role) }
    })
    res.json({ code: 0, message: 'ok', data: user })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 1004, message: '这个人已经开通了' })
    console.error('[fde/users POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/users/:id
 * 改角色 / 启停。改了角色记为管理员设置(MANUAL), 登录时不再按规则改(平台管理员除外)
 */
router.put('/:id', requirePermission('user.edit'), async (req, res) => {
  try {
    const data = pick(req.body, USER_FIELDS)
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

    if (data.role && data.role !== oldUser.role) data.roleSource = 'MANUAL'
    // 管理员手动启停: 与平台停用无关了
    if (data.status !== undefined) data.platformDisabled = false

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
    if (oldUser.roleSource === 'PLATFORM_ADMIN' && newRole !== 'ADMIN') {
      extraWarn = '此人是以虎 One 管理员，下次登录会恢复为本系统管理员'
    }
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
