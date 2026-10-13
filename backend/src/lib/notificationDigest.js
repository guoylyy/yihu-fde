// v2.5.5(#912) 通知每日摘要: 把噪音档通知(notification_digest_items 里 digested_at 为空的)按人合并成一条站内通知
import prisma from './prisma.js'
import { NOTIFICATION_CATALOG, DAILY_DIGEST_TYPE } from './notificationCatalog.js'

const MAX_LINES = 8
const MAX_TITLES_PER_TYPE = 3

/** 纯函数: 一个人的待合并条目 → 摘要标题/正文 */
export function composeDigest(items) {
  const byType = new Map()
  for (const it of items) {
    const arr = byType.get(it.type) || []
    arr.push(it)
    byType.set(it.type, arr)
  }
  const groups = [...byType.entries()].sort((a, b) => b[1].length - a[1].length)
  const lines = groups.slice(0, MAX_LINES).map(([type, arr]) => {
    const label = NOTIFICATION_CATALOG[type]?.label || type
    const titles = arr.slice(0, MAX_TITLES_PER_TYPE).map(x => String(x.title || '').replace(/^\p{Extended_Pictographic}\s*/u, '').trim()).filter(Boolean)
    const more = arr.length > MAX_TITLES_PER_TYPE ? ` 等 ${arr.length} 条` : ''
    return `${label} ×${arr.length}：${titles.join('；')}${more}`
  })
  if (groups.length > MAX_LINES) lines.push(`…另有 ${groups.length - MAX_LINES} 类动态`)
  return {
    title: `🗞 昨日动态摘要（${items.length} 条）`,
    body: lines.join('\n'),
    typeCounts: Object.fromEntries(groups.map(([t, arr]) => [t, arr.length]))
  }
}

/**
 * 把 before(默认今天 0 点)之前尚未合并的条目, 按用户合并成一条 DAILY_DIGEST 站内通知。
 * 幂等: 合并过的条目标记 digested_at, 再跑不会重复; 8 点前不跑, 免得夜里推。
 */
export async function runDailyDigest({ before = null, minHour = 8, now = new Date() } = {}) {
  if (before == null) {
    if (now.getHours() < minHour) return { skipped: 'before-min-hour' }
    before = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }
  const pending = await prisma.notificationDigestItem.findMany({
    where: { digestedAt: null, createdAt: { lt: before } },
    orderBy: { createdAt: 'asc' }
  })
  if (!pending.length) return { users: 0, items: 0 }
  const byUser = new Map()
  for (const it of pending) {
    const k = String(it.userId)
    if (!byUser.has(k)) byUser.set(k, [])
    byUser.get(k).push(it)
  }
  let users = 0
  for (const [userId, items] of byUser) {
    const { title, body, typeCounts } = composeDigest(items)
    try {
      await prisma.$transaction([
        prisma.notification.create({ data: {
          userId: BigInt(userId), type: DAILY_DIGEST_TYPE, title, body, link: '/admin/notifications',
          data: JSON.stringify({ items: items.length, typeCounts, from: items[0].createdAt, to: items[items.length - 1].createdAt })
        } }),
        prisma.notificationDigestItem.updateMany({ where: { id: { in: items.map(i => i.id) } }, data: { digestedAt: now } })
      ])
      users++
    } catch (e) {
      console.error('[notificationDigest] 合并失败 user', userId, e.message)
    }
  }
  return { users, items: pending.length }
}
