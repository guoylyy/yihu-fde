// OKR 6.0: O 的外部依赖 / 卡点 / 风险 —— 读视图(各列表统一的 blocker 摘要)。
//
// 卡点三件套存在 okr_objectives: blockers(说明) / blocker_owner_id(卡在谁) / blocker_due_date(依赖截止日), 另有 risk_level。
// 返回结构: riskLevel + blocker: { text, ownerId, ownerName, dueDate, overdue } | null(没填卡点)。
// overdue = 截止日早于今天(上海) 且 O 没完成(DONE; DROPPED 也不算)。

import prisma from '../lib/prisma.js'
import { OkrRuleError, shanghaiDateKey, dateKeyOf, blockerOverdue, maxRiskLevel } from './okrRules.js'

/** 一批 O 的卡点人 id → 名字 */
export async function blockerOwnerNames(objs, db = prisma) {
  const ids = [...new Set((objs || []).map(o => o.blockerOwnerId).filter(v => v != null).map(String))]
  if (!ids.length) return new Map()
  const rows = await db.user.findMany({ where: { id: { in: ids.map(BigInt) } }, select: { id: true, name: true, username: true } })
  return new Map(rows.map(u => [String(u.id), u.name || u.username]))
}

/** 单个 O 的卡点摘要; 没填卡点返回 null */
export function blockerView(o, names = new Map(), today = shanghaiDateKey()) {
  if (!o.blockers) return null
  const ownerId = o.blockerOwnerId != null ? String(o.blockerOwnerId) : null
  return {
    text: o.blockers,
    ownerId,
    ownerName: ownerId ? (names.get(ownerId) ?? null) : null,
    dueDate: dateKeyOf(o.blockerDueDate),
    overdue: blockerOverdue(o, today)
  }
}

/** 列表里每个 O 都带的两项 */
export function riskFields(o, names, today = shanghaiDateKey()) {
  return { riskLevel: o.riskLevel || 'LOW', blocker: blockerView(o, names, today) }
}

/** 一个人 / 一组 O 的风险汇总: 最高风险等级 + 有卡点的 O 数 + 卡点逾期的 O 数(DROPPED 不算) */
export function riskSummary(objs, today = shanghaiDateKey()) {
  const live = (objs || []).filter(o => o.status !== 'DROPPED')
  return {
    riskLevel: maxRiskLevel(live),
    blockerCount: live.filter(o => o.blockers).length,
    blockerOverdueCount: live.filter(o => blockerOverdue(o, today)).length
  }
}

/** 卡点人要是存在、没删除的用户, 否则 8120 */
export async function assertBlockerOwnersExist(ids, db = prisma) {
  const uniq = [...new Set((ids || []).filter(v => v != null).map(String))]
  if (!uniq.length) return
  const rows = await db.user.findMany({ where: { id: { in: uniq.map(BigInt) }, deletedAt: null }, select: { id: true } })
  const have = new Set(rows.map(r => String(r.id)))
  const missing = uniq.filter(id => !have.has(id))
  if (missing.length) throw new OkrRuleError(`卡点人不存在或已删除: 用户 ${missing.join(', ')}`, { code: 8120 })
}
