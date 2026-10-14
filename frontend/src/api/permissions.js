/**
 * 细粒度操作权限 helper（前端版）
 * 与后端 src/lib/auth.js PERMISSIONS 保持一致
 * key = 权限字符串；value = 拥有此权限的角色数组
 *
 * 用法：
 *   import { can, PERMISSIONS } from '@/api/permissions.js'
 *   <el-button v-if="can('timesheet.approve')">批准</el-button>
 */
export const PERMISSIONS = {
  "customer.access": ["ADMIN","MANAGER"],
  "project.access": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "engineer.access": ["ADMIN","MANAGER"],
  "engineer_stats.access": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "timesheet.access": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "knowledge.access": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "skill.access": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "customer.view": ["ADMIN","MANAGER"],
  "project.view": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "timesheet.view": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "me.view": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "rolePermission.manage": ["ADMIN"],
  "role.manage": ["ADMIN"],
  "customer.create": ["ADMIN","MANAGER"],
  "customer.edit": ["ADMIN","MANAGER"],
  "customer.delete": ["ADMIN","MANAGER"],
  "project.create": ["ADMIN","MANAGER"],
  "project.edit": ["ADMIN","MANAGER"],
  "project.delete": ["ADMIN","MANAGER"],
  "project.changeStatus": ["ADMIN","MANAGER"],
  "project.manageMembers": ["ADMIN","MANAGER"],
  "project.viewFinance": ["ADMIN","MANAGER"],
  "task.view": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "task.create": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "task.edit": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "task.changeStatus": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "task.delete": ["ADMIN","MANAGER"],
  "subtask.manage": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "milestone.manage": ["ADMIN","MANAGER"],
  "issue.manage": ["ADMIN","MANAGER"],
  "risk.manage": ["ADMIN","MANAGER"],
  "engineer.view": ["ADMIN","MANAGER"],
  "engineer.create": ["ADMIN","MANAGER"],
  "engineer.edit": ["ADMIN","MANAGER"],
  "engineer.disable": ["ADMIN","MANAGER"],
  "timesheet.create": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "timesheet.edit": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "timesheet.delete": ["ADMIN","MANAGER"],
  "timesheet.submit": ["ADMIN","FDE_ENGINEER"],
  "timesheet.approve": ["ADMIN","MANAGER"],
  "report.export": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "knowledge.view": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "knowledge.create": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "knowledge.edit": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "knowledge.delete": ["ADMIN","MANAGER"],
  "skill.manage": ["ADMIN","MANAGER"],
  "asset.view": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "asset.create": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "asset.use": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "asset.manage": ["ADMIN","MANAGER"],
  "idea.view": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "idea.create": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "idea.convert": ["ADMIN","MANAGER"],
  "idea.manage": ["ADMIN","MANAGER"],
  "team.manage": ["ADMIN"],
  "user.view": ["ADMIN"],
  "user.create": ["ADMIN"],
  "user.edit": ["ADMIN"],
  "user.delete": ["ADMIN"],
  "apiKey.manage": ["ADMIN","FDE_ENGINEER"],
  "apiKey.manageAll": ["ADMIN"],
  "audit.list": ["ADMIN"],
  "llmConfig.manage": ["ADMIN"],
  "system.manage": ["ADMIN"],
  "projectRecord.create": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "projectRecord.manage": ["ADMIN","MANAGER"],
  "notification.send": ["ADMIN","MANAGER"]
}
function getUser() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem('fde_internal_user') || 'null') } catch { return null }
}

// ===== 服务端生效权限 (2026-07-20 角色权限配置) =====
// 管理员可在后台改权限矩阵, 因此登录后从 /api/fde/role-permissions/mine 拉取
// 当前角色的生效权限点列表存 localStorage。can() 优先用服务端结果,
// 未拉到(接口失败/未登录)时回退上面的静态矩阵。
const MY_PERMS_KEY = 'fde_my_permissions'

function getServerPerms() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(MY_PERMS_KEY) || 'null') } catch { return null }
}

/** 登录后 / 进入后台时调用, 刷新当前用户生效权限缓存 */
export async function refreshMyPermissions() {
  const token = localStorage.getItem('fde_internal_token')
  if (!token) return null
  try {
    const res = await fetch('/api/fde/role-permissions/mine', {
      headers: { Authorization: 'Bearer ' + token }
    })
    const data = await res.json()
    if (data.code !== 0) return null
    localStorage.setItem(MY_PERMS_KEY, JSON.stringify(data.data))
    return data.data
  } catch { return null }
}

/** 退出登录时清掉缓存 */
export function clearMyPermissions() {
  try { localStorage.removeItem(MY_PERMS_KEY) } catch { /* ignore */ }
}

export function can(perm) {
  const u = getUser()
  if (!u) return false
  // 服务端生效权限在场且角色匹配 → 以服务端为准 (后端目录已覆盖前端全部 key)
  const sp = getServerPerms()
  if (sp && sp.role === u.role && Array.isArray(sp.permissions)) {
    return sp.permissions.includes(perm)
  }
  const allowed = PERMISSIONS[perm]
  if (!allowed) return false
  return allowed.includes(u.role)
}

export function cannot(perm) { return !can(perm) }
