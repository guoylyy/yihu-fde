// OKR 4.0: 每日进展总结。老板: 「每个人的 OKR 的进展展示总结, 每日有一个总结」。
//
// 每人每天一行: autoItems 从当天的 okr_updates 现算(按 O / KR 归并, 一条 KR 当天改了几次只出一行,
// 取当天第一次的「之前」与最后一次的「之后」), summary 是人补的一句(okr_daily_summaries, 每人每天一篇,
// 重复写覆盖)。免提交名单里的人不出现在列表与「没写总结」名单里。
import prisma from '../lib/prisma.js'
import { OkrRuleError, isoWeekOf, weekKey } from './okrRules.js'
import { participants } from './okr.js'
import { exemptIds } from './okrExempt.js'

export const SUMMARY_MAX = 10000

const DAY_MS = 24 * 3600 * 1000
const TZ_MS = 8 * 3600 * 1000

const bad = msg => new OkrRuleError(msg, { status: 400, code: 8160 })

/** 今天(上海) YYYY-MM-DD */
export function todayShanghai(now = new Date()) {
  return new Date(now.getTime() + TZ_MS).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → { key, date(UTC 零点, 对应 @db.Date) }; 缺省今天; 不合法 → 400 */
export function parseDate(raw, now = new Date()) {
  const s = String(raw ?? '').trim()
  const key = s === '' || s === 'today' ? todayShanghai(now) : s
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
  if (!d || d.toISOString().slice(0, 10) !== key || Number(m[1]) < 2000 || Number(m[1]) > 2999) {
    throw bad('date 格式: YYYY-MM-DD(如 2026-11-21), 缺省今天')
  }
  return { key, date: d }
}

/** 这一天(上海)属于哪个 ISO 周 */
const weekOfDate = date => isoWeekOf(new Date(date.getTime() - TZ_MS + 12 * 3600 * 1000))

const STATUS_LABEL = { ON_TRACK: '正常', AT_RISK: '有风险', DONE: '完成', MISSED: '未完成' }

function fmtValue(kr, v) {
  if (v == null) return null
  const n = Math.round(v * 100) / 100
  if (kr.metricType === 'BINARY') return n >= 1 ? '完成' : '未完成'
  if (kr.metricType === 'PERCENT') return `${n}%`
  return `${n}${kr.unit || ''}`
}

const fmtStatus = s => (s ? STATUS_LABEL[s] || s : '未定')

/** 服务端在没写说明时自动生成的进展文字(「KR 标题」当前值 a → b), 不重复进说明 */
function isAutoContent(kr, content) {
  return !!kr && content.startsWith(`「${kr.title}」`) && (content.includes('→') || content.endsWith('无变化'))
}

/** 一条 KR 当天的变化: 数值有变出数值, 否则出状态; 都没变返回 null */
function changeText(kr, first, last) {
  if (kr.metricType !== 'BINARY' && first.valueBefore != null && last.valueAfter != null && first.valueBefore !== last.valueAfter) {
    return `${fmtValue(kr, first.valueBefore)} → ${fmtValue(kr, last.valueAfter)}`
  }
  if ((first.statusBefore ?? null) !== (last.statusAfter ?? null)) {
    return `${fmtStatus(first.statusBefore)} → ${fmtStatus(last.statusAfter)}`
  }
  return null
}

/**
 * 把一个人当天的 updates(已按时间升序, 含 objective / keyResult)归并成 autoItems:
 *   O1「目标」· KR2「标题」：50% → 70%（说明）
 *   O1「目标」：说明                          (没挂 KR 的进展)
 */
export function buildAutoItems(updates) {
  const groups = new Map()
  for (const u of updates) {
    const k = `${u.objectiveId}:${u.krId ?? '-'}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(u)
  }
  const items = []
  for (const list of groups.values()) {
    const first = list[0]
    const last = list[list.length - 1]
    const o = first.objective
    const kr = first.keyResult || null
    const notes = [...new Set(list.map(u => String(u.content || '').trim()).filter(c => c && !isAutoContent(kr, c)))]
    const change = kr ? changeText(kr, first, last) : null
    const head = `O${o.seq}「${o.title}」` + (kr ? ` · KR${kr.seq}「${kr.title}」` : '')
    // 挂 KR 的: 变化（说明）; 没挂 KR 的进展本身就是说明, 不加括号
    const body = kr ? [change, notes.length ? `（${notes.join('；')}）` : ''].filter(Boolean).join('') : notes.join('；')
    items.push({
      objectiveId: String(o.id), objectiveSeq: o.seq, objectiveTitle: o.title,
      krId: kr ? String(kr.id) : null, krSeq: kr?.seq ?? null, krTitle: kr?.title ?? null,
      valueBefore: kr ? first.valueBefore : null, valueAfter: kr ? last.valueAfter : null,
      statusBefore: kr ? first.statusBefore : null, statusAfter: kr ? last.statusAfter : null,
      notes, updateCount: list.length,
      at: last.createdAt,
      text: body ? `${head}：${body}` : `${head}：有更新`
    })
  }
  items.sort((a, b) => a.objectiveSeq - b.objectiveSeq || (a.krSeq ?? 0) - (b.krSeq ?? 0))
  return items
}

async function loadUsers(ids) {
  if (!ids.length) return new Map()
  const rows = await prisma.user.findMany({
    where: { id: { in: ids.map(BigInt) } },
    select: { id: true, name: true, username: true, avatarUrl: true, role: true }
  })
  return new Map(rows.map(u => [String(u.id), { id: String(u.id), name: u.name, username: u.username, avatarUrl: u.avatarUrl, role: u.role }]))
}

/**
 * 某天的每日总结。onlyUserIds: 可见范围(Set<string>), null = 全部。
 * 人: 该周应交 OKR 的人(participants) + 当天写了总结的人, 去掉免提交名单
 */
export async function dailyView(dateKey, { onlyUserIds = null } = {}) {
  const { key, date } = parseDate(dateKey)
  const week = weekOfDate(date)
  const cycle = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  const exempt = await exemptIds()
  const summaries = await prisma.okrDailySummary.findMany({ where: { date } })
  const base = new Set([...(await participants(cycle?.id)), ...summaries.map(s => String(s.userId))])
  const ids = [...base].filter(id => !exempt.has(id) && (!onlyUserIds || onlyUserIds.has(id)))
  const users = await loadUsers(ids)
  const idList = ids.filter(id => users.has(id))

  const updates = idList.length
    ? await prisma.okrUpdate.findMany({
      where: { date, objective: { ownerId: { in: idList.map(BigInt) } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        objective: { select: { id: true, ownerId: true, seq: true, title: true } },
        keyResult: { select: { id: true, seq: true, title: true, metricType: true, unit: true } }
      }
    })
    : []
  const objs = cycle && idList.length
    ? await prisma.okrObjective.findMany({
      where: { cycleId: cycle.id, ownerId: { in: idList.map(BigInt) }, status: { not: 'DROPPED' }, submittedAt: { not: null } },
      select: { ownerId: true }
    })
    : []
  const hasOkr = new Set(objs.map(o => String(o.ownerId)))
  const byOwner = new Map()
  for (const u of updates) {
    const k = String(u.objective.ownerId)
    if (!byOwner.has(k)) byOwner.set(k, [])
    byOwner.get(k).push(u)
  }
  const sumBy = new Map(summaries.map(s => [String(s.userId), s]))
  const opUsers = await loadUsers([...new Set(summaries.filter(s => s.operatorId != null).map(s => String(s.operatorId)))])

  const rows = idList.map(id => {
    const s = sumBy.get(id)
    const written = !!(s && s.summaryMd && s.summaryMd.trim())
    return {
      user: users.get(id),
      hasOkr: hasOkr.has(id),
      autoItems: buildAutoItems(byOwner.get(id) || []),
      summary: written
        ? {
          id: String(s.id), summaryMd: s.summaryMd, updatedAt: s.updatedAt,
          onBehalfOf: s.operatorId != null ? (opUsers.get(String(s.operatorId)) || { id: String(s.operatorId) }) : null
        }
        : null,
      hasWritten: written
    }
  })
  // 写了的、有进展的排后面: 主管先看到空的
  rows.sort((a, b) => Number(a.hasWritten) - Number(b.hasWritten)
    || Number(b.hasOkr) - Number(a.hasOkr)
    || String(a.user.name).localeCompare(String(b.user.name), 'zh'))
  return {
    date: key,
    week: weekKey(week),
    cycleStatus: cycle?.status ?? null,
    summary: {
      people: rows.length,
      written: rows.filter(r => r.hasWritten).length,
      withProgress: rows.filter(r => r.autoItems.length).length,
      missing: rows.filter(r => r.hasOkr && !r.hasWritten).length
    },
    rows
  }
}

/** 当天有 OKR(这周交了计划)但没写总结的人(给主管催) */
export async function dailyMissing(dateKey, opts = {}) {
  const v = await dailyView(dateKey, opts)
  const rows = v.rows.filter(r => r.hasOkr && !r.hasWritten).map(r => ({ user: r.user, autoItemCount: r.autoItems.length }))
  return { date: v.date, week: v.week, count: rows.length, rows }
}

/**
 * 写(覆盖)某人某天的总结。ownerId = 被写的人, operatorId = 代写的主管(本人写为 null)。
 * 不能写未来的日期。返回 { row, created }
 */
export async function saveDailySummary({ ownerId, operatorId = null, by, dateKey, summaryMd, now = new Date() }) {
  const { key, date } = parseDate(dateKey, now)
  if (key > todayShanghai(now)) throw bad('不能提前写以后日期的总结')
  if (typeof summaryMd !== 'string' || !summaryMd.trim()) throw bad('summaryMd 不能为空')
  const text = summaryMd.replace(/\r\n?/g, '\n').trim()
  if (text.length > SUMMARY_MAX) throw bad(`总结最多 ${SUMMARY_MAX} 字`)
  const where = { userId_date: { userId: BigInt(ownerId), date } }
  const before = await prisma.okrDailySummary.findUnique({ where, select: { id: true } })
  const op = operatorId != null ? BigInt(operatorId) : null
  const row = await prisma.okrDailySummary.upsert({
    where,
    update: { summaryMd: text, operatorId: op },
    create: { userId: BigInt(ownerId), date, summaryMd: text, createdBy: BigInt(by), operatorId: op }
  })
  return { row, created: !before, date: key }
}

/** [from, to] 两个上海日期之间每人写了几篇(周评分进度用) */
export async function summaryCounts(userIds, fromDate, toDate) {
  if (!userIds.length) return new Map()
  const rows = await prisma.okrDailySummary.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds.map(BigInt) }, date: { gte: fromDate, lte: toDate }, summaryMd: { not: null } },
    _count: { _all: true }
  })
  return new Map(rows.map(r => [String(r.userId), r._count._all]))
}

/** 某 ISO 周的周一 / 周日(@db.Date 口径的 UTC 零点) */
export function weekDates(start) {
  const monday = new Date(new Date(start).getTime() + TZ_MS)
  const from = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()))
  return { from, to: new Date(from.getTime() + 6 * DAY_MS) }
}
