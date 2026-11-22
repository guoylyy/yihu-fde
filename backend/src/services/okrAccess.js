// OKR 2.0: 代管(主管替员工改 OKR)与可见范围。所有判断都在服务端, 前端藏按钮只是体验。
//
// 代管范围(谁能替谁改计划 / 进展 / 自评 / 未达成):
//   ADMIN(dataScope=ALL)              → 任何人
//   MANAGER、dataScope=TEAM(组长)     → 自己所在团队(成员身份或挂名 leaderId)里的人; 不能代管 ADMIN
//   其余(工程师)                      → 只有自己
// 「主管评分」不在代管范围里, 只认 okr.score.manager(默认 ADMIN + MANAGER, 0.5.8 起放开给部门主管)。
//   评分范围: dataScope=ALL(ADMIN) → 任何人; 其余有该权限的(MANAGER) → 本人所在团队的成员,
//   不含自己(自己的 O 由服务端 8109 拒)、不含 ADMIN。TEAM_LEAD 默认没有这个权限点。
//
// 可见: 任何登录用户都能看任何人的 O / KR / 进展 / 自评; 主管评分(managerScore / managerComment /
// role=MANAGER 的评分记录)只给本人与「评分范围里覆盖此人」的人, 其他人的响应里直接不带这些字段。
import prisma from '../lib/prisma.js'
import { getDataScope, hasPermission } from '../lib/auth.js'
import { OkrRuleError } from './okrRules.js'

const DELEGATE_ROLES = new Set(['MANAGER'])

const uid = user => String(user?.id ?? user?.userId)

/** 可以代管别人吗(ALL / MANAGER / TEAM) */
function delegateKind(user) {
  const scope = getDataScope(user?.role)
  if (scope === 'ALL') return 'ALL'
  if (scope === 'TEAM' || DELEGATE_ROLES.has(user?.role)) return 'TEAM'
  return null
}

/** user 所在团队(成员或挂名负责人)的全部成员 userId(含自己), 字符串集合 */
export async function teammateIds(user) {
  const me = BigInt(uid(user))
  const teams = await prisma.team.findMany({
    where: { deletedAt: null, status: 1, OR: [{ members: { some: { userId: me } } }, { leaderId: me }] },
    select: { id: true, leaderId: true }
  })
  const ids = new Set([String(me)])
  if (!teams.length) return ids
  for (const t of teams) if (t.leaderId != null) ids.add(String(t.leaderId))
  const rows = await prisma.teamMembership.findMany({ where: { teamId: { in: teams.map(t => t.id) } }, select: { userId: true } })
  for (const r of rows) ids.add(String(r.userId))
  return ids
}

/** /team 列表的可见范围: ADMIN 全部(null = 不过滤), 其余是本人所在团队的成员 */
export async function teamListScope(user) {
  if (getDataScope(user?.role) === 'ALL') return null
  return teammateIds(user)
}

/**
 * 10.0 预警(/risk/*)的可见范围: ADMIN(dataScope=ALL) 全部(null); MANAGER / 组长(dataScope=TEAM) 本人所在团队的成员;
 * 其余(工程师)只有自己 —— 和 /team 的区别: 工程师挂了团队也只看自己
 */
export async function riskListScope(user) {
  const kind = delegateKind(user)
  if (kind === 'ALL') return null
  if (kind === 'TEAM') return teammateIds(user)
  return new Set([uid(user)])
}

/** 能否代管 targetId(不含"是不是自己"的判断) */
export async function canManageOkrOf(user, targetId, { targetRole } = {}) {
  const kind = delegateKind(user)
  if (!kind) return false
  if (kind === 'ALL') return true
  if (targetRole === 'ADMIN') return false
  return (await teammateIds(user)).has(String(targetId))
}

/**
 * 解析写操作的目标人。缺省或等于自己 → 自己; 否则要有代管权限, 无权 403。
 * @returns {Promise<{ ownerId: string, operatorId: string|null, onBehalf: boolean }>}
 */
export async function resolveOkrTarget(user, targetUserId, { viaAssistant = false } = {}) {
  const self = uid(user)
  if (targetUserId == null || targetUserId === '' || String(targetUserId) === self) {
    return { ownerId: self, operatorId: null, onBehalf: false }
  }
  if (!/^\d+$/.test(String(targetUserId))) throw new OkrRuleError('targetUserId 不合法', { code: 8100 })
  // 助手只替自己的主人办事, 不做代管
  if (viaAssistant) throw new OkrRuleError('助手不能代操作他人的 OKR', { status: 403, code: 8120 })
  const target = await prisma.user.findFirst({
    where: { id: BigInt(targetUserId), deletedAt: null },
    select: { id: true, role: true }
  })
  if (!target) throw new OkrRuleError('目标用户不存在', { status: 404, code: 8108 })
  if (!(await canManageOkrOf(user, targetUserId, { targetRole: target.role }))) {
    throw new OkrRuleError('无权操作他人的 OKR', { status: 403, code: 8114 })
  }
  return { ownerId: String(target.id), operatorId: self, onBehalf: true }
}

/**
 * 主管评分范围(能给谁打主管分, 也就是能看谁的主管分):
 *   null       → 不限(有权限且 dataScope=ALL, 即 ADMIN)
 *   Set<string> → 只能评这些人(MANAGER: 本团队成员, 去掉自己与 ADMIN); 没权限 → 空集
 */
export async function managerScoreScope(user) {
  if (!hasPermission(user, 'okr.score.manager')) return new Set()
  if (getDataScope(user?.role) === 'ALL') return null
  const ids = await teammateIds(user)
  ids.delete(uid(user))
  if (!ids.size) return ids
  const admins = await prisma.user.findMany({
    where: { id: { in: [...ids].map(BigInt) }, role: 'ADMIN' },
    select: { id: true }
  })
  for (const a of admins) ids.delete(String(a.id))
  return ids
}

/** scope(managerScoreScope 的结果)是否覆盖 ownerId */
export function scopeCovers(scope, ownerId) {
  return scope === null || (scope instanceof Set && scope.has(String(ownerId)))
}

/**
 * 能否看到某人的主管评分: 本人, 或评分范围覆盖此人的人。
 * 不传 scope 时只按角色判断(有权限且 dataScope=ALL), 团队范围要先 await managerScoreScope(user) 再传进来
 */
export function canSeeManagerScore(user, ownerId, scope) {
  if (uid(user) === String(ownerId)) return true
  if (scope !== undefined) return scopeCovers(scope, ownerId)
  return hasPermission(user, 'okr.score.manager') && getDataScope(user?.role) === 'ALL'
}

const HIDDEN_KEYS = new Set(['managerScore', 'managerComment'])

/**
 * 深拷贝并剔除主管评分: 删掉 managerScore / managerComment 键, 评分记录里去掉 role=MANAGER 的条目。
 * 不是置空 —— 字段本身不出现
 */
export function stripManagerScore(value) {
  if (Array.isArray(value)) {
    return value
      .filter(v => !(v && typeof v === 'object' && !Array.isArray(v) && v.role === 'MANAGER' && 'score' in v))
      .map(stripManagerScore)
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (HIDDEN_KEYS.has(k)) continue
      out[k] = stripManagerScore(v)
    }
    return out
  }
  return value
}

/** 按查看人对某人的数据做评分可见性处理(scope 见 canSeeManagerScore) */
export function forViewer(user, ownerId, data, scope) {
  return canSeeManagerScore(user, ownerId, scope) ? data : stripManagerScore(data)
}

/** /team 列表: 不在评分范围里的行(包括自己那一行)剔除主管分; 范围不限时原样返回 */
export function teamForViewer(data, scope) {
  if (scope === null) return data
  if (!(scope instanceof Set) || !scope.size) return stripManagerScore(data)
  const { rows, ...rest } = data
  return {
    ...stripManagerScore(rest),
    rows: (rows || []).map(r => (scope.has(String(r.user?.id)) ? r : stripManagerScore(r)))
  }
}
