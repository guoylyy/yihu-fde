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
  "customer.access": ["ADMIN","PLATFORM","MANAGER","SALES"],
  "project.access": ["ADMIN","PLATFORM","MANAGER","SALES","FDE_ENGINEER"],
  "engineer.access": ["ADMIN","PLATFORM","MANAGER"],
  "engineer_stats.access": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER"],
  "timesheet.access": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "knowledge.access": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "skill.access": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "customer.view": ["ADMIN","PLATFORM","MANAGER","SALES"],
  "project.view": ["ADMIN","PLATFORM","MANAGER","SALES","FDE_ENGINEER"],
  "timesheet.view": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "me.view": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "rolePermission.manage": ["ADMIN"],
  "role.manage": ["ADMIN"],
  "customer.create": ["ADMIN","MANAGER","SALES"],
  "customer.edit": ["ADMIN","MANAGER","SALES"],
  "customer.delete": ["ADMIN","MANAGER"],
  "project.create": ["ADMIN","MANAGER","SALES"],
  "project.edit": ["ADMIN","MANAGER","SALES"],
  "project.delete": ["ADMIN","MANAGER"],
  "project.changeStatus": ["ADMIN","MANAGER"],
  "project.manageMembers": ["ADMIN","MANAGER"],
  "project.viewFinance": ["ADMIN","PLATFORM","MANAGER","SALES"],
  "task.view": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "task.create": ["ADMIN","MANAGER","SALES","FDE_ENGINEER"],
  "task.edit": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "task.changeStatus": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "task.delete": ["ADMIN","MANAGER","SALES"],
  "subtask.manage": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "milestone.manage": ["ADMIN","MANAGER","SALES"],
  "issue.manage": ["ADMIN","MANAGER","SALES"],
  "risk.manage": ["ADMIN","MANAGER","SALES"],
  "engineer.view": ["ADMIN","PLATFORM","MANAGER"],
  "engineer.create": ["ADMIN","PLATFORM","MANAGER","SALES"],
  "engineer.edit": ["ADMIN","PLATFORM","MANAGER","SALES"],
  "engineer.disable": ["ADMIN","PLATFORM","MANAGER"],
  "timesheet.create": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "timesheet.edit": ["ADMIN","MANAGER","FDE_ENGINEER"],
  "timesheet.delete": ["ADMIN","MANAGER"],
  "timesheet.submit": ["ADMIN","FDE_ENGINEER"],
  "timesheet.approve": ["ADMIN","MANAGER"],
  "report.export": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "knowledge.view": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "knowledge.create": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER"],
  "knowledge.edit": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER"],
  "knowledge.delete": ["ADMIN","MANAGER"],
  "skill.manage": ["ADMIN","PLATFORM","MANAGER"],
  "skillPackage.view": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "skillPackage.manage": ["ADMIN","PLATFORM","MANAGER"],
  "asset.view": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "asset.create": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER"],
  "asset.use": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER"],
  "asset.manage": ["ADMIN","PLATFORM","MANAGER"],
  "idea.view": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "idea.create": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "idea.convert": ["ADMIN","MANAGER"],
  "idea.manage": ["ADMIN","PLATFORM","MANAGER"],
  "team.manage": ["ADMIN","PLATFORM"],
  "user.view": ["ADMIN"],
  "user.create": ["ADMIN"],
  "user.edit": ["ADMIN"],
  "user.delete": ["ADMIN"],
  "user.resetPassword": ["ADMIN"],
  "apiKey.manage": ["ADMIN","FDE_ENGINEER"],
  "apiKey.manageAll": ["ADMIN"],
  "audit.list": ["ADMIN"],
  "llmConfig.manage": ["ADMIN"],
  "projectRecord.create": ["ADMIN","PLATFORM","MANAGER","FDE_ENGINEER","SALES"],
  "projectRecord.manage": ["ADMIN","PLATFORM","MANAGER"],
  "notification.send": ["ADMIN","PLATFORM","MANAGER"]
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
