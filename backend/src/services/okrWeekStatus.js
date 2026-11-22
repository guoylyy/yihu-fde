// OKR 4.0: 周评分进度 + 催交。老板: 「主管每周结束的时候需要在 OKR 打分, 如果没有提交的同事, 需要提交一下」。
//
// 每人一行: 计划交没交、O 自评完成几个 / 共几个、主管评了几个、是否免提交、本周写了几篇每日总结。
// 催交只催「计划未提交」或「自评该做了还没做完」的人; 已完成的、免提交的跳过;
// 同一人同一周 2 小时内不重复催(以通知表里的已发记录为准, 进程重启不丢)。
import prisma from '../lib/prisma.js'
import { pushNotification } from '../lib/notify.js'
import { OkrRuleError, weekKey, weekRange, submitDeadline } from './okrRules.js'
import { getCycle, cycleView, participants } from './okr.js'
import { exemptIds } from './okrExempt.js'
import { summaryCounts, weekDates } from './okrDaily.js'

export const REMIND_TYPE = 'OKR_REMIND'
export const REMIND_COOLDOWN_MS = 2 * 3600 * 1000
export const REMIND_TITLE = '请补充本周 OKR'
// 自评从周五(周一 + 4 天)起算「该做了」; 复盘状态的周无论哪天都算
const SELF_SCORE_DUE_OFFSET_MS = 4 * 24 * 3600 * 1000

const r4 = n => Math.round(n * 10000) / 10000

/** 这一周的自评是否已经到了该做的时候(没归档, 且已进复盘或已到周五) */
export function selfScoreDue(cycle, now = new Date()) {
  if (!cycle || cycle.status === 'CLOSED') return false
  if (cycle.status === 'REVIEW') return true
  return now.getTime() >= new Date(cycle.startDate).getTime() + SELF_SCORE_DUE_OFFSET_MS
}

/**
 * 周评分进度。onlyUserIds: 可见范围(Set<string>), null = 全部(ADMIN)。
 * 人: 该周应交 OKR 的人(含免提交名单, 标 exempt=true, 不进完成统计)
 */
export async function weekStatus(week, { onlyUserIds = null, now = new Date() } = {}) {
  const cycle = await getCycle(week, { now })
  const exempt = await exemptIds()
  const ids = (await participants(cycle?.id, { includeExempt: true })).filter(id => !onlyUserIds || onlyUserIds.has(id))
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids.map(BigInt) } }, select: { id: true, name: true, username: true, avatarUrl: true, role: true } })
    : []
  const byId = new Map(users.map(u => [String(u.id), { id: String(u.id), name: u.name, username: u.username, avatarUrl: u.avatarUrl, role: u.role }]))
  const idList = ids.filter(id => byId.has(id))
  const objs = cycle && idList.length
    ? await prisma.okrObjective.findMany({
      where: { cycleId: cycle.id, ownerId: { in: idList.map(BigInt) }, status: { not: 'DROPPED' } },
      select: { ownerId: true, submittedAt: true, lateSubmit: true, selfScore: true, managerScore: true }
    })
    : []
  const byOwner = new Map()
  for (const o of objs) {
    const k = String(o.ownerId)
    if (!byOwner.has(k)) byOwner.set(k, [])
    byOwner.get(k).push(o)
  }
  const { start, end } = cycle ? { start: cycle.startDate, end: cycle.endDate } : weekRange(week.year, week.weekNo)
  const { from, to } = weekDates(start)
  const daily = await summaryCounts(idList, from, to)
  const due = selfScoreDue(cycle, now)

  const rows = idList.map(id => {
    const live = byOwner.get(id) || []
    const submitted = live.filter(o => o.submittedAt)
    const planSubmitted = live.length > 0 && submitted.length === live.length
    const selfScored = { done: submitted.filter(o => o.selfScore != null).length, total: submitted.length }
    const managerScored = { done: submitted.filter(o => o.managerScore != null).length, total: submitted.length }
    const isExempt = exempt.has(id)
    const missing = []
    if (!isExempt) {
      if (!planSubmitted) missing.push('PLAN')
      else if (due && selfScored.done < selfScored.total) missing.push('SELF_SCORE')
    }
    return {
      user: byId.get(id),
      planSubmitted,
      lateSubmit: submitted.some(o => o.lateSubmit),
      objectiveCount: live.length,
      selfScored,
      managerScored,
      exempt: isExempt,
      dailySummaries: daily.get(id) || 0,
      missing,
      complete: isExempt || missing.length === 0
    }
  })
  // 未完成的在前(主管先看到), 免提交的垫底, 其余按名字
  const rank = r => (r.exempt ? 2 : r.complete ? 1 : 0)
  rows.sort((a, b) => rank(a) - rank(b) || String(a.user.name).localeCompare(String(b.user.name), 'zh'))
  const counted = rows.filter(r => !r.exempt)
  return {
    week: weekKey(week),
    cycle: cycle ? cycleView(cycle, now) : { year: week.year, weekNo: week.weekNo, key: weekKey(week), startDate: start, endDate: end, submitDeadline: submitDeadline(start), status: null },
    selfScoreDue: due,
    summary: {
      expected: counted.length,
      planSubmitted: counted.filter(r => r.planSubmitted).length,
      selfScoredAll: counted.filter(r => r.planSubmitted && r.selfScored.done === r.selfScored.total).length,
      managerScoredAll: counted.filter(r => r.planSubmitted && r.managerScored.done === r.managerScored.total).length,
      incomplete: counted.filter(r => !r.complete).length,
      exempt: rows.length - counted.length,
      avgDailySummaries: counted.length ? r4(counted.reduce((s, r) => s + r.dailySummaries, 0) / counted.length) : null
    },
    rows
  }
}

function remindBody(key, row) {
  const parts = []
  if (row.missing.includes('PLAN')) parts.push(row.objectiveCount ? '本周计划还是草稿, 没有提交' : '还没有写本周计划')
  if (row.missing.includes('SELF_SCORE')) parts.push(`还有 ${row.selfScored.total - row.selfScored.done} 个 O 没有自评(共 ${row.selfScored.total} 个)`)
  return `${key}：${parts.join('；')}。请到 OKR 页面补上。`
}

/**
 * 催交。userIds 不传 = 范围内所有未完成的人; 传了只催其中未完成的。
 * 返回 { reminded: [{ user, missing }], skipped: [{ user|id, reason }] }
 *   reason: COMPLETE 已完成 / EXEMPT 免提交 / RECENTLY_REMINDED 2 小时内催过 / OUT_OF_SCOPE 不在范围(或不用交 OKR)
 */
export async function remindWeek(week, { userIds, onlyUserIds = null, now = new Date() } = {}) {
  if (userIds != null && !Array.isArray(userIds)) throw new OkrRuleError('userIds 要是数组(不传 = 所有未完成的人)', { code: 8162 })
  const wanted = userIds == null ? null : [...new Set(userIds.map(v => String(v ?? '').trim()))]
  if (wanted && wanted.some(v => !/^\d+$/.test(v))) throw new OkrRuleError('userIds 里有不合法的 id', { code: 8162 })
  const st = await weekStatus(week, { onlyUserIds, now })
  if (st.cycle.status === 'CLOSED') throw new OkrRuleError(`${st.week} 已归档, 不能再补交, 不用催`, { status: 409, code: 8163 })

  const rowBy = new Map(st.rows.map(r => [r.user.id, r]))
  const skipped = []
  let pool = st.rows
  if (wanted) {
    for (const id of wanted) if (!rowBy.has(id)) skipped.push({ id, reason: 'OUT_OF_SCOPE' })
    pool = wanted.filter(id => rowBy.has(id)).map(id => rowBy.get(id))
  }
  const candidates = []
  for (const r of pool) {
    if (r.exempt) skipped.push({ user: r.user, reason: 'EXEMPT' })
    else if (r.complete) { if (wanted) skipped.push({ user: r.user, reason: 'COMPLETE' }) } else candidates.push(r)
  }

  const key = st.week
  const data = { week: key }
  const dataStr = JSON.stringify(data)
  const recent = candidates.length
    ? new Set((await prisma.notification.findMany({
      where: { type: REMIND_TYPE, data: dataStr, userId: { in: candidates.map(r => BigInt(r.user.id)) }, createdAt: { gte: new Date(now.getTime() - REMIND_COOLDOWN_MS) } },
      select: { userId: true }
    })).map(n => String(n.userId)))
    : new Set()

  const reminded = []
  for (const r of candidates) {
    if (recent.has(r.user.id)) { skipped.push({ user: r.user, reason: 'RECENTLY_REMINDED' }); continue }
    const out = await pushNotification({
      userId: r.user.id, type: REMIND_TYPE, channels: ['site'], data,
      title: REMIND_TITLE, body: remindBody(key, r), link: `/admin/okr?week=${key}`
    })
    if (out?.site) reminded.push({ user: r.user, missing: r.missing })
    else skipped.push({ user: r.user, reason: 'DELIVERY_OFF' })
  }
  return { week: key, reminded, skipped }
}

/** 这一周还没交计划的人(免提交除外), 给 close-by-score 的返回带上 */
export async function pendingPlanUsers(week, opts = {}) {
  const st = await weekStatus(week, opts)
  return st.rows.filter(r => !r.exempt && !r.planSubmitted).map(r => ({ id: r.user.id, name: r.user.name, username: r.user.username }))
}
