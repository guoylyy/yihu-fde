// OKR 2.0: 代管(主管替员工改 OKR)与可见范围。所有判断都在服务端, 前端藏按钮只是体验。
//
// 代管范围(谁能替谁改计划 / 进展 / 自评 / 未达成):
//   ADMIN(dataScope=ALL)              → 任何人
//   MANAGER、dataScope=TEAM(组长)     → 自己所在团队(成员身份或挂名 leaderId)里的人; 不能代管 ADMIN
//   其余(工程师)                      → 只有自己
// 「主管评分」不在代管范围里, 仍只认 okr.score.manager(默认只有 ADMIN)。
//
// 可见: 任何登录用户都能看任何人的 O / KR / 进展 / 自评; 主管评分(managerScore / managerComment /
// role=MANAGER 的评分记录)只给本人与有 okr.score.manager 的人, 其他人的响应里直接不带这些字段。
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

/** 能否看到某人的主管评分: 本人, 或有主管评分权限的人(默认只有 ADMIN) */
export function canSeeManagerScore(user, ownerId) {
  return uid(user) === String(ownerId) || hasPermission(user, 'okr.score.manager')
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

/** 按查看人对某人的数据做评分可见性处理 */
export function forViewer(user, ownerId, data) {
  return canSeeManagerScore(user, ownerId) ? data : stripManagerScore(data)
}
