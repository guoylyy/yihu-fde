// OKR 6.0: O 的外部依赖 / 卡点 / 风险 —— 读视图(各列表统一的 blocker 摘要)+ 每天的到期提醒。
//
// 卡点三件套存在 okr_objectives: blockers(说明) / blocker_owner_id(卡在谁) / blocker_due_date(依赖截止日), 另有 risk_level。
// 返回结构: riskLevel + blocker: { text, ownerId, ownerName, dueDate, overdue } | null(没填卡点)。
// overdue = 截止日早于今天(上海) 且 O 没完成(DONE; DROPPED 也不算)。
//
// 到期提醒(okrBlockerTick): cron 每天一次 + ADMIN 手动触发(POST /api/okr/admin/blocker-tick)。
// 扫「截止日 ≤ 今天、O 未完成、所在周没归档」的 O, 给负责人与卡点人各发一条站内通知(OKR_BLOCKER_DUE)。
// 去重: 通知 data 以 {"key":"okrBlockerDue:<objectiveId>:<yyyy-MM-dd>" 开头, 同一 O 同一天每人最多一条, 进程重启不重发。
// 免提交名单: 负责人在名单里的 O 整条不发; 卡点人在名单里也不发给他。
// 顺带: 阶段型 KR 有阶段过了截止日还没完成的, 把 ON_TRACK 推成 AT_RISK(时间流逝不经过写接口, 靠这里补上)。
import prisma from '../lib/prisma.js'
import { pushNotification } from '../lib/notify.js'
import { exemptIds } from './okrExempt.js'
import {
  OkrRuleError, shanghaiDateKey, dateKeyOf, blockerOverdue, maxRiskLevel, parseMilestones, milestoneOverdue, weekKey
} from './okrRules.js'

export const BLOCKER_DUE_TYPE = 'OKR_BLOCKER_DUE'

const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''))

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

export const blockerDueKey = (objectiveId, day) => `okrBlockerDue:${objectiveId}:${day}`

/** 通知 data: key 放第一个, 去重按前缀匹配(截止日被改过也不会同一天再发) */
const dataPrefix = key => `{"key":${JSON.stringify(key)}`

/**
 * 到期提醒 + 阶段型 KR 逾期推 AT_RISK。幂等, 可反复跑。dryRun=true 只算不发、不改。
 * 返回 { date, due, notified, skippedExempt, already, milestonesAtRisk }
 */
export async function okrBlockerTick(now = new Date(), { dryRun = false } = {}) {
  const today = shanghaiDateKey(now)
  const todayDate = new Date(`${today}T00:00:00.000Z`)
  const objs = await prisma.okrObjective.findMany({
    where: {
      blockers: { not: null },
      blockerDueDate: { lte: todayDate },
      status: { notIn: ['DONE', 'DROPPED'] },
      cycle: { status: { not: 'CLOSED' } }
    },
    select: {
      id: true, ownerId: true, title: true, status: true, blockers: true, blockerOwnerId: true, blockerDueDate: true,
      cycle: { select: { year: true, weekNo: true } }
    },
    orderBy: { id: 'asc' }
  })

  const exempt = await exemptIds()
  const userIds = [...new Set(objs.flatMap(o => [o.ownerId, o.blockerOwnerId]).filter(v => v != null).map(String))]
  const active = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds.map(BigInt) }, status: 1, deletedAt: null }, select: { id: true, name: true, username: true } })
    : []
  const users = new Map(active.map(u => [String(u.id), u.name || u.username]))

  let notified = 0
  let skippedExempt = 0
  let already = 0
  const due = []
  for (const o of objs) {
    const ownerId = String(o.ownerId)
    if (exempt.has(ownerId)) { skippedExempt++; continue }
    const key = blockerDueKey(o.id, today)
    const dueDate = dateKeyOf(o.blockerDueDate)
    const week = weekKey(o.cycle)
    const blockerId = o.blockerOwnerId != null ? String(o.blockerOwnerId) : null
    const recipients = [...new Set([ownerId, blockerId])].filter(id => id && users.has(id) && !exempt.has(id))
    const sent = new Set((await prisma.notification.findMany({
      where: { type: BLOCKER_DUE_TYPE, userId: { in: recipients.map(BigInt) }, data: { startsWith: dataPrefix(key) } },
      select: { userId: true }
    })).map(n => String(n.userId)))
    already += sent.size
    const todo = recipients.filter(id => !sent.has(id))
    due.push({ objectiveId: String(o.id), ownerId, blockerOwnerId: blockerId, dueDate, notify: todo })
    if (dryRun) continue

    const data = { key, objectiveId: String(o.id), dueDate, week }
    const late = dueDate < today ? '(已逾期)' : '(今天到期)'
    const blockerName = blockerId ? (users.get(blockerId) ?? `用户 ${blockerId}`) : '未指定'
    const ownerName = users.get(ownerId) ?? `用户 ${ownerId}`
    for (const uid of todo) {
      const isOwner = uid === ownerId
      await pushNotification({
        userId: uid, type: BLOCKER_DUE_TYPE, channels: ['site'], data,
        title: isOwner ? `OKR 卡点到期${late}:「${clip(o.title, 60)}」` : `${clip(ownerName, 20)} 的 OKR 卡在你这里${late}`,
        body: isOwner
          ? `卡点: ${clip(o.blockers, 300)}; 卡在 ${blockerName}, 依赖截止 ${dueDate}, 这个 O 还没完成`
          : `「${clip(o.title, 60)}」等你: ${clip(o.blockers, 300)}; 依赖截止 ${dueDate}`,
        link: isOwner ? `/admin/okr?week=${week}` : `/admin/okr?week=${week}&ownerId=${ownerId}`
      })
      notified++
    }
  }

  const milestonesAtRisk = await refreshMilestoneRisk(today, { dryRun })
  return { date: today, due: due.length, notified, skippedExempt, already, milestonesAtRisk, items: due }
}

/** 阶段型 KR: 有阶段过了截止日还没完成 → ON_TRACK 推成 AT_RISK(只推这一种, 不碰 DONE / MISSED / 已是 AT_RISK) */
async function refreshMilestoneRisk(today, { dryRun = false } = {}) {
  const krs = await prisma.okrKeyResult.findMany({
    where: {
      metricType: 'MILESTONE', status: 'ON_TRACK', milestones: { not: null },
      objective: { status: { not: 'DROPPED' }, cycle: { status: { not: 'CLOSED' } } }
    },
    select: { id: true, milestones: true }
  })
  const ids = krs.filter(k => milestoneOverdue(parseMilestones(k.milestones), today)).map(k => k.id)
  if (ids.length && !dryRun) {
    await prisma.okrKeyResult.updateMany({ where: { id: { in: ids }, status: 'ON_TRACK' }, data: { status: 'AT_RISK' } })
  }
  return ids.length
}
