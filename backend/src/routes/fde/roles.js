// FDE 平台 - 角色管理 (v1.3.2 动态角色)
// 角色清单入库: 管理员可新建/停用角色、设置名称与数据范围, 新角色即刻出现在
// 用户管理下拉和权限矩阵列中, 无需发版。
// 规则: 内置(builtin)角色只允许改名/描述, 不可删除; ADMIN 不可停用;
//       有用户在用的角色不可删除(先停用); 停用角色不可再分配, 存量用户保留。
import express from 'express'
import prisma from '../../lib/prisma.js'
import {
  internalAuth, requirePermission,
  loadRoles, getRoles, DATA_SCOPES
} from '../../lib/auth.js'
import { logInternalAction } from '../../lib/audit.js'

const router = express.Router()
router.use(internalAuth)

const CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/

const SCOPE_LABELS = { ALL: '全部数据', OWN_PROJECTS: '自己负责/参与的项目', OWN_RECORDS: '仅本人相关记录' }

async function withUserCounts(roles) {
  const counts = await prisma.user.groupBy({
    by: ['role'],
    where: { deletedAt: null },
    _count: { _all: true }
  })
  const countMap = new Map(counts.map(c => [c.role, c._count._all]))
  return roles.map(r => ({ ...r, userCount: countMap.get(r.code) || 0 }))
}

/**
 * GET /api/fde/roles
 * 启用中角色清单 (任何登录用户 — 下拉/标签/矩阵列都要用)
 * ?all=1 时含停用角色并带每角色用户数 (仅 role.manage)
 */
router.get('/', async (req, res) => {
  try {
    if (req.query.all === '1') {
      return requirePermission('role.manage')(req, res, async () => {
        const list = await withUserCounts(getRoles(false))
        res.json({ code: 0, data: { list, scopes: DATA_SCOPES, scopeLabels: SCOPE_LABELS } })
      })
    }
    res.json({ code: 0, data: { list: getRoles(true), scopes: DATA_SCOPES, scopeLabels: SCOPE_LABELS } })
  } catch (e) {
    console.error('[fde/roles GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/roles  { code, name, description?, dataScope }
 */
router.post('/', requirePermission('role.manage'), async (req, res) => {
  try {
    const { code, name, description, dataScope } = req.body || {}
    if (!code || !CODE_RE.test(code)) {
      return res.status(400).json({ code: 9002, message: '角色 code 须为大写字母开头的大写字母/数字/下划线(2-32位)' })
    }
    if (!name || !String(name).trim()) return res.status(400).json({ code: 9002, message: '角色名称不能为空' })
    if (!DATA_SCOPES.includes(dataScope)) {
      return res.status(400).json({ code: 9002, message: `数据范围必须是 ${DATA_SCOPES.join(' / ')}` })
    }
    const exist = await prisma.role.findUnique({ where: { code } })
    if (exist) return res.status(400).json({ code: 9003, message: `角色 ${code} 已存在` })

    const maxSort = await prisma.role.aggregate({ _max: { sortOrder: true } })
    const role = await prisma.role.create({
      data: {
        code, name: String(name).trim(), description: description || null,
        dataScope, builtin: false, status: 1,
        sortOrder: (maxSort._max.sortOrder || 0) + 1
      }
    })
    await loadRoles()
    logInternalAction(req, 'ROLE_CREATE', {
      resourceType: 'ROLE', resourceId: role.id,
      details: { code, name, dataScope }
    })
    res.json({ code: 0, data: role })
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ code: 9003, message: '角色 code 已存在' })
    console.error('[fde/roles POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/roles/:code  { name?, description?, dataScope?, status? }
 * 内置角色: 仅 name/description; ADMIN 不可停用
 */
router.put('/:code', requirePermission('role.manage'), async (req, res) => {
  try {
    const code = req.params.code
    const existing = await prisma.role.findUnique({ where: { code } })
    if (!existing) return res.status(404).json({ code: 9004, message: '角色不存在' })

    const { name, description, dataScope, status } = req.body || {}
    const data = {}
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ code: 9002, message: '角色名称不能为空' })
      data.name = String(name).trim()
    }
    if (description !== undefined) data.description = description || null

    if (existing.builtin) {
      // 内置角色语义写在代码里(数据范围特判/权限默认值), 只放开改名和描述
      if (dataScope !== undefined && dataScope !== existing.dataScope) {
        return res.status(400).json({ code: 9002, message: '内置角色的数据范围不可修改' })
      }
      if (status !== undefined && Number(status) !== existing.status) {
        if (code === 'ADMIN') return res.status(400).json({ code: 9002, message: 'ADMIN 角色不可停用' })
        return res.status(400).json({ code: 9002, message: '内置角色不可停用' })
      }
    } else {
      if (dataScope !== undefined) {
        if (!DATA_SCOPES.includes(dataScope)) {
          return res.status(400).json({ code: 9002, message: `数据范围必须是 ${DATA_SCOPES.join(' / ')}` })
        }
        data.dataScope = dataScope
      }
      if (status !== undefined) data.status = Number(status) === 0 ? 0 : 1
    }

    const role = await prisma.role.update({ where: { code }, data })
    await loadRoles()
    logInternalAction(req, 'ROLE_UPDATE', {
      resourceType: 'ROLE', resourceId: role.id,
      details: { code, changes: data }
    })
    res.json({ code: 0, data: role })
  } catch (e) {
    console.error('[fde/roles PUT /:code]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/roles/:code  (仅自定义角色, 且无用户在用)
 */
router.delete('/:code', requirePermission('role.manage'), async (req, res) => {
  try {
    const code = req.params.code
    const existing = await prisma.role.findUnique({ where: { code } })
    if (!existing) return res.status(404).json({ code: 9004, message: '角色不存在' })
    if (existing.builtin) return res.status(400).json({ code: 9002, message: '内置角色不可删除' })

    const inUse = await prisma.user.count({ where: { role: code, deletedAt: null } })
    if (inUse > 0) {
      return res.status(400).json({ code: 9002, message: `还有 ${inUse} 个用户使用该角色, 请先调整这些用户的角色(或仅停用该角色)` })
    }
    // 清掉权限矩阵覆盖里对该角色的引用
    const overrides = await prisma.rolePermission.findMany()
    for (const row of overrides) {
      if (Array.isArray(row.roles) && row.roles.includes(code)) {
        await prisma.rolePermission.update({
          where: { id: row.id },
          data: { roles: row.roles.filter(r => r !== code) }
        })
      }
    }
    await prisma.role.delete({ where: { code } })
    await loadRoles()
    const { loadRolePermissions } = await import('../../lib/auth.js')
    await loadRolePermissions()
    logInternalAction(req, 'ROLE_DELETE', {
      resourceType: 'ROLE', resourceId: existing.id,
      details: { code, name: existing.name }
    })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    console.error('[fde/roles DELETE /:code]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
