// 角色权限配置 (2026-07-20): 后台可视化配置每个权限点允许的角色
// 生效规则: role_permissions 表覆盖 ?? lib/auth.js PERMISSIONS 默认值
import express from 'express'
import prisma from '../../lib/prisma.js'
import {
  internalAuth,
  requirePermission,
  PERMISSIONS,
  LOCKED_PERMISSIONS,
  getEffectiveRoles,
  isOverridden,
  loadRolePermissions,
  getRoles,
  isValidRole
} from '../../lib/auth.js'
import { logInternalAction } from '../../lib/audit.js'
import { filterEnabledPermissions, editionName, enabledModuleList } from '../../config/edition.js'

const router = express.Router()
router.use(internalAuth)

const sameRoles = (a, b) => {
  const sa = [...a].sort().join(','), sb = [...b].sort().join(',')
  return sa === sb
}

// 当前用户生效的权限点列表 (所有登录用户可用, 前端菜单/按钮控制)
router.get('/mine', (req, res) => {
  const mine = Object.keys(PERMISSIONS).filter(p => getEffectiveRoles(p).includes(req.user.role))
  // v2.7.0 版本开关: 未启用模块的权限直接不下发 —— 前端菜单读的就是这份清单, 模块一关菜单自动收敛
  const permissions = filterEnabledPermissions(mine)
  res.json({
    code: 0,
    data: { role: req.user.role, permissions, edition: editionName(), enabledModules: enabledModuleList() }
  })
})

// 完整矩阵 (仅 ADMIN): 默认值 + 生效值 + 是否被覆盖
router.get('/', requirePermission('rolePermission.manage'), (req, res) => {
  const permissions = Object.keys(PERMISSIONS).map(key => ({
    key,
    defaultRoles: PERMISSIONS[key],
    roles: getEffectiveRoles(key),
    overridden: isOverridden(key),
    locked: LOCKED_PERMISSIONS.includes(key)
  }))
  // v1.3.2 动态角色: roles 返回启用中角色的 code+name, 矩阵列由前端按此渲染
  res.json({ code: 0, data: { roles: getRoles(true).map(r => ({ code: r.code, name: r.name })), permissions } })
})

// 保存修改 (仅 ADMIN): body = { changes: [{ permission, roles }] }
// roles 与默认值一致 -> 删除覆盖行(回归默认); 否则 upsert 覆盖行
router.put('/', requirePermission('rolePermission.manage'), async (req, res) => {
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : []
  if (!changes.length) {
    return res.status(400).json({ code: 9002, message: 'changes 不能为空' })
  }
  for (const c of changes) {
    if (!PERMISSIONS[c.permission]) {
      return res.status(400).json({ code: 9002, message: `未知权限点: ${c.permission}` })
    }
    if (LOCKED_PERMISSIONS.includes(c.permission)) {
      return res.status(400).json({ code: 9002, message: `权限点 ${c.permission} 不允许修改` })
    }
    if (!Array.isArray(c.roles) || c.roles.some(r => !isValidRole(r))) {
      return res.status(400).json({ code: 9002, message: `权限点 ${c.permission} 的角色列表不合法` })
    }
  }

  const uid = BigInt(req.user.id)
  for (const c of changes) {
    const roles = [...new Set(c.roles)]
    if (sameRoles(roles, PERMISSIONS[c.permission])) {
      await prisma.rolePermission.deleteMany({ where: { permission: c.permission } })
    } else {
      await prisma.rolePermission.upsert({
        where: { permission: c.permission },
        create: { permission: c.permission, roles, updatedBy: uid },
        update: { roles, updatedBy: uid }
      })
    }
  }
  await loadRolePermissions()
  logInternalAction(req, 'ROLE_PERMISSION_UPDATE', {
    resourceType: 'ROLE_PERMISSION',
    details: JSON.stringify(changes.map(c => ({ permission: c.permission, roles: c.roles })))
  })
  res.json({ code: 0, data: { updated: changes.length } })
})

// 恢复默认 (仅 ADMIN): body = { permission } 单个; 不传 = 全部恢复默认
router.post('/reset', requirePermission('rolePermission.manage'), async (req, res) => {
  const { permission } = req.body || {}
  if (permission) {
    if (!PERMISSIONS[permission]) {
      return res.status(400).json({ code: 9002, message: `未知权限点: ${permission}` })
    }
    await prisma.rolePermission.deleteMany({ where: { permission } })
  } else {
    await prisma.rolePermission.deleteMany({})
  }
  await loadRolePermissions()
  logInternalAction(req, 'ROLE_PERMISSION_RESET', {
    resourceType: 'ROLE_PERMISSION',
    details: JSON.stringify({ permission: permission || 'ALL' })
  })
  res.json({ code: 0, data: { ok: true } })
})

export default router
