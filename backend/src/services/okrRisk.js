// OKR 10.0: 连续未达成预警(O 级 + 人级)与每日提醒。
//
// 不建表: 全部从 okr_cycles / okr_objectives(含 manager_score, 即 okr_scores 里最近一次主管分)/ okr_key_results /
// okr_objective_projects / okr_daily_summaries 现算。
//
// 「同一个 O」跨周怎么认: O 是按周建的(每周一行), 顺延(markMiss carryToNextWeek)与复制(copy-from-week)都沿用原标题,
// 所以按「负责人 + 标题(去首尾空白、合并空白、忽略大小写)」串成一条线。同一周同一人有两条同名 O 时取 seq 小的那条。
//
// 窗口: 最近 weeks 个已结束的周(不含当前周), 从最近一周往前数连续「未达成」的周数, 最多数到 weeks。
// 判定只调 okrRules.isObjectiveMissedInWeek / isPersonMissedInWeek, 这里不另写条件。
//
// hasOverdueBlocker: 看这条线「最新的那条 O」—— 当前周有就看当前周的, 否则看最近一个已结束周的。
//
// 提醒(okrRiskReminder): 挂在每天一次的卡点到期任务后面跑(cron.js), 不另起调度。
//   CRITICAL → 负责人 + 直属主管(负责人所在团队的负责人 leaderId; 团队没设负责人时取该团队里的 MANAGER); WARN → 只发负责人。
//   去重: 通知 data 以 {"key":"okrRiskStreak:<objectiveId>:<当前周>:<level>" 开头, 同一 O 同一周同一档每人最多一条, 重启不重发。
//   免提交名单里的人不进预警、不收提醒。
import prisma from '../lib/prisma.js'
import { pushNotification } from '../lib/notify.js'
import { exemptIds } from './okrExempt.js'
import { personSummary } from './okr.js'
import { projectsByObjective } from './okrObjectiveProjects.js'
import {
  OkrRuleError, isoWeekOf, shiftWeek, weekKey, weekRange, shanghaiDateKey, objectiveProgress, blockerOverdue,
  isObjectiveMissedInWeek, isPersonMissedInWeek, trailingStreak, streakLevel, STREAK_WARN_WEEKS, TZ_OFFSET_MS
} from './okrRules.js'

export const RISK_WEEKS_DEFAULT = 4
export const RISK_WEEKS_MIN = 2
export const RISK_WEEKS_MAX = 26
export const STREAK_REMIND_TYPE = 'OKR_OBJECTIVE_STREAK'

const r4 = n => (n == null ? null : Math.round(n * 10000) / 10000)
const pct = n => Math.round((n || 0) * 100)
const clip = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''))

/** weeks 参数: 缺省 4; 只收 2–26 的整数, 否则 400 */
export function parseRiskWeeks(raw) {
  if (raw === undefined || raw === null || raw === '') return RISK_WEEKS_DEFAULT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < RISK_WEEKS_MIN || n > RISK_WEEKS_MAX) {
    throw new OkrRuleError(`weeks 要是 ${RISK_WEEKS_MIN}–${RISK_WEEKS_MAX} 的整数`, { code: 8100 })
  }
  return n
}

/** asOf 参数(YYYY-MM-DD, 按上海这一天的中午算): 缺省现在。只读回看用, 测试也靠它避开真实周 */
export function parseAsOf(raw, now = new Date()) {
  if (raw === undefined || raw === null || raw === '') return now
  const s = String(raw).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) - TZ_OFFSET_MS) : null
  if (!d || shanghaiDateKey(d) !== s || Number(m[1]) < 2000 || Number(m[1]) > 2999) {
    throw new OkrRuleError('asOf 格式: YYYY-MM-DD', { code: 8100 })
  }
  return d
}

/** 跨周认「同一个 O」的键 */
export const chainKey = (ownerId, title) => `${ownerId}\u0000${String(title ?? '').trim().replace(/\s+/g, ' ').toLowerCase()}`

/** 最近 weeks 个已结束的周(升序)+ 当前周 */
function windowOf(weeks, now) {
  const cur = isoWeekOf(now)
  const list = []
  for (let i = weeks; i >= 1; i--) list.push(shiftWeek(cur, -i))
  return { cur, list }
}

async function cyclesOf(weeksList) {
  const rows = await prisma.okrCycle.findMany({ where: { OR: weeksList.map(w => ({ year: w.year, weekNo: w.weekNo })) } })
  return new Map(rows.map(c => [weekKey(c), c]))
}

async function loadActiveUsers(ids) {
  const uniq = [...new Set(ids.filter(v => v != null).map(String))]
  if (!uniq.length) return new Map()
  const rows = await prisma.user.findMany({
    where: { id: { in: uniq.map(BigInt) }, deletedAt: null },
    select: { id: true, name: true, username: true, avatarUrl: true, role: true, status: true }
  })
  return new Map(rows.map(u => [String(u.id), { id: String(u.id), name: u.name, username: u.username, avatarUrl: u.avatarUrl, role: u.role, active: u.status === 1 }]))
}

const nameOf = u => u?.name || u?.username || (u?.id ? `用户 ${u.id}` : '')

/** 同一周同一条线有多条时取 seq 小的 */
function pickInstance(list) {
  if (!list?.length) return null
  return [...list].sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1))[0]
}

/**
 * O 级预警。onlyUserIds: 可见范围(Set<string>), null = 全部。
 * 返回 { asOf, weeks, window:[周], items:[...], summary:{ critical, warn } }; items 按 CRITICAL 在前、连续周数多的在前
 */
export async function objectiveRisk({ weeks = RISK_WEEKS_DEFAULT, now = new Date(), onlyUserIds = null } = {}) {
  const today = shanghaiDateKey(now)
  const { cur, list } = windowOf(weeks, now)
  const cycles = await cyclesOf([...list, cur])
  const exempt = await exemptIds()
  const cycleIds = [...cycles.values()].map(c => c.id)
  const ownerFilter = onlyUserIds ? { ownerId: { in: [...onlyUserIds].map(BigInt) } } : {}
  const objs = cycleIds.length
    ? await prisma.okrObjective.findMany({ where: { cycleId: { in: cycleIds }, ...ownerFilter }, include: { keyResults: true } })
    : []

  const weekOfCycle = new Map([...cycles.values()].map(c => [String(c.id), weekKey(c)]))
  // 线 → 周 → [O]
  const chains = new Map()
  for (const o of objs) {
    const owner = String(o.ownerId)
    if (exempt.has(owner)) continue
    const k = chainKey(owner, o.title)
    if (!chains.has(k)) chains.set(k, new Map())
    const byWeek = chains.get(k)
    const wk = weekOfCycle.get(String(o.cycleId))
    if (!byWeek.has(wk)) byWeek.set(wk, [])
    byWeek.get(wk).push(o)
  }

  const hits = []
  for (const byWeek of chains.values()) {
    const inst = list.map(w => pickInstance(byWeek.get(weekKey(w))))
    const flags = list.map((w, i) => isObjectiveMissedInWeek(inst[i], w, today))
    const n = trailingStreak(flags)
    if (n < STREAK_WARN_WEEKS) continue
    const last = inst[inst.length - 1]
    const current = pickInstance(byWeek.get(weekKey(cur)))
    const hasOverdueBlocker = blockerOverdue(current || last, today)
    hits.push({
      last, current, n, hasOverdueBlocker,
      level: streakLevel(n, hasOverdueBlocker),
      weeklyRates: list.map((w, i) => ({
        week: weekKey(w),
        rate: inst[i] ? r4(objectiveProgress(inst[i])) : null,
        status: inst[i]?.status ?? null,
        missed: flags[i]
      }))
    })
  }

  const users = await loadActiveUsers(hits.map(h => h.last.ownerId))
  const projects = await projectsByObjective(hits.map(h => h.last.id))
  const items = hits.map(h => ({
    objectiveId: String(h.last.id),
    currentObjectiveId: h.current ? String(h.current.id) : null,
    week: h.weeklyRates[h.weeklyRates.length - 1].week,
    title: h.last.title,
    ownerId: String(h.last.ownerId),
    ownerName: nameOf(users.get(String(h.last.ownerId)) || { id: String(h.last.ownerId) }),
    projectNames: (projects.get(String(h.last.id)) || []).map(p => p.name),
    consecutiveMissedWeeks: h.n,
    level: h.level,
    lastWeekRate: h.weeklyRates[h.weeklyRates.length - 1].rate,
    hasOverdueBlocker: h.hasOverdueBlocker,
    weeklyRates: h.weeklyRates
  }))
  items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'CRITICAL' ? -1 : 1)
    || b.consecutiveMissedWeeks - a.consecutiveMissedWeeks
    || (a.lastWeekRate ?? 0) - (b.lastWeekRate ?? 0)
    || String(a.ownerName).localeCompare(String(b.ownerName), 'zh')
    || a.title.localeCompare(b.title, 'zh'))
  return {
    asOf: today,
    weeks,
    window: list.map(weekKey),
    items,
    summary: { critical: items.filter(i => i.level === 'CRITICAL').length, warn: items.filter(i => i.level === 'WARN').length }
  }
}

/** 一个上海日期(@db.Date 的 UTC 零点)属于哪个 ISO 周(isoWeekOf 按上海墙上时间读, UTC 零点 = 上海当天 08:00) */
const weekOfDate = d => weekKey(isoWeekOf(new Date(d)))

/**
 * 人级预警(替代原来 /team 里散落的「连续两周 < 60%」判断, 判定统一走 isPersonMissedInWeek)。
 * 人: 在职 FDE 工程师 / 组长 + 窗口里交过 O 的人, 去掉免提交名单, 再按可见范围裁剪。
 * 每人: consecutiveMissedWeeks(从最近一个已结束周往前数, 交了计划且完成率 < 60% 的连续周数)、
 *       avgCompletion(窗口里交了计划的周的平均完成率)、missingSummaryWeeks(交了计划却一篇每日总结都没写的周数)
 */
export async function peopleRisk({ weeks = RISK_WEEKS_DEFAULT, now = new Date(), onlyUserIds = null } = {}) {
  const today = shanghaiDateKey(now)
  const { list } = windowOf(weeks, now)
  const cycles = await cyclesOf(list)
  const exempt = await exemptIds()
  const cycleIds = [...cycles.values()].map(c => c.id)
  const engineers = await prisma.user.findMany({
    where: { role: { in: ['FDE_ENGINEER', 'TEAM_LEAD'] }, status: 1, deletedAt: null, ...(onlyUserIds ? { id: { in: [...onlyUserIds].map(BigInt) } } : {}) },
    select: { id: true }
  })
  const objs = cycleIds.length
    ? await prisma.okrObjective.findMany({
      where: { cycleId: { in: cycleIds }, ...(onlyUserIds ? { ownerId: { in: [...onlyUserIds].map(BigInt) } } : {}) },
      include: { keyResults: true }
    })
    : []
  const ids = [...new Set([...engineers.map(e => String(e.id)), ...objs.map(o => String(o.ownerId))])]
    .filter(id => !exempt.has(id) && (!onlyUserIds || onlyUserIds.has(id)))
  const users = await loadActiveUsers(ids)

  const from = new Date(Date.UTC(...ymd(weekRange(list[0].year, list[0].weekNo).start)))
  const to = new Date(Date.UTC(...ymd(weekRange(list[list.length - 1].year, list[list.length - 1].weekNo).end)))
  const sums = ids.length
    ? await prisma.okrDailySummary.findMany({
      where: { userId: { in: ids.map(BigInt) }, date: { gte: from, lte: to }, summaryMd: { not: null } },
      select: { userId: true, date: true, summaryMd: true }
    })
    : []
  const sumCount = new Map()
  for (const s of sums) {
    if (!String(s.summaryMd || '').trim()) continue
    const k = `${s.userId}:${weekOfDate(s.date)}`
    sumCount.set(k, (sumCount.get(k) || 0) + 1)
  }

  const byOwnerCycle = new Map()
  for (const o of objs) {
    const k = `${o.ownerId}:${o.cycleId}`
    if (!byOwnerCycle.has(k)) byOwnerCycle.set(k, [])
    byOwnerCycle.get(k).push(o)
  }

  const items = ids.filter(id => users.has(id)).map(id => {
    const weekly = list.map(w => {
      const wk = weekKey(w)
      const c = cycles.get(wk)
      const s = c ? personSummary(c, byOwnerCycle.get(`${id}:${c.id}`) || []) : { submitted: false, completion: null }
      const ended = shanghaiDateKey(weekRange(w.year, w.weekNo).end) < today
      const summaryCount = sumCount.get(`${id}:${wk}`) || 0
      return { week: wk, submitted: s.submitted, completion: s.completion, missed: isPersonMissedInWeek(s, { ended }), summaryCount }
    })
    const n = trailingStreak(weekly.map(x => x.missed))
    const done = weekly.filter(x => x.submitted && x.completion != null)
    const u = users.get(id)
    return {
      userId: id,
      name: nameOf(u),
      user: { id: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl, role: u.role },
      consecutiveMissedWeeks: n,
      level: streakLevel(n),
      avgCompletion: done.length ? r4(done.reduce((s, x) => s + x.completion, 0) / done.length) : null,
      missingSummaryWeeks: weekly.filter(x => x.submitted && x.summaryCount === 0).length,
      weekly
    }
  })
  items.sort((a, b) => b.consecutiveMissedWeeks - a.consecutiveMissedWeeks
    || (a.avgCompletion ?? 2) - (b.avgCompletion ?? 2)
    || String(a.name).localeCompare(String(b.name), 'zh'))
  return {
    asOf: today,
    weeks,
    window: list.map(weekKey),
    items,
    summary: {
      people: items.length,
      critical: items.filter(i => i.level === 'CRITICAL').length,
      warn: items.filter(i => i.level === 'WARN').length
    }
  }
}

/** 真实时刻 → 上海日期的 [y, m0, d] */
function ymd(at) {
  const w = new Date(new Date(at).getTime() + TZ_OFFSET_MS)
  return [w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()]
}

// ---------------------------------------------------------------- 每日提醒

export const streakRemindKey = (objectiveId, week, level) => `okrRiskStreak:${objectiveId}:${week}:${level}`
const dataPrefix = key => `{"key":${JSON.stringify(key)}`

/** 文案模板(三句) */
export function streakMessages({ title, n, rate, ownerName }) {
  return {
    WARN: `你的 O「${title}」已连续 ${n} 周未达成，本周目标 ${rate}%`,
    CRITICAL: `「${title}」连续 ${n} 周未达成，已标红，请与主管对齐是否缩小范围`,
    MANAGER: `${ownerName} 的 O「${title}」连续 ${n} 周未达成`
  }
}

/**
 * 直属主管: 负责人所在(启用、未删)团队的负责人 leaderId; 团队没设负责人时取该团队里 role=MANAGER 的成员。不含本人
 * @returns Map<ownerId, string[]>
 */
export async function directManagers(ownerIds) {
  const out = new Map(ownerIds.map(id => [String(id), new Set()]))
  if (!ownerIds.length) return new Map()
  const memberships = await prisma.teamMembership.findMany({
    where: { userId: { in: ownerIds.map(BigInt) }, team: { deletedAt: null, status: 1 } },
    select: { userId: true, team: { select: { id: true, leaderId: true } } }
  })
  const leaderless = [...new Set(memberships.filter(m => m.team.leaderId == null).map(m => String(m.team.id)))]
  const teamManagers = new Map()
  if (leaderless.length) {
    const rows = await prisma.teamMembership.findMany({
      where: { teamId: { in: leaderless.map(BigInt) }, user: { role: 'MANAGER', deletedAt: null, status: 1 } },
      select: { teamId: true, userId: true }
    })
    for (const r of rows) {
      const k = String(r.teamId)
      if (!teamManagers.has(k)) teamManagers.set(k, [])
      teamManagers.get(k).push(String(r.userId))
    }
  }
  for (const m of memberships) {
    const owner = String(m.userId)
    const ms = m.team.leaderId != null ? [String(m.team.leaderId)] : (teamManagers.get(String(m.team.id)) || [])
    for (const id of ms) if (id !== owner) out.get(owner).add(id)
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

/**
 * 每天一次: 按 objectiveRisk(全员、默认 4 周窗口)给 WARN 的负责人、CRITICAL 的负责人 + 直属主管发站内通知。
 * 幂等, 可反复跑; dryRun=true 只算不发。返回 { week, warn, critical, notified, already, items }
 */
export async function okrRiskReminder(now = new Date(), { dryRun = false, weeks = RISK_WEEKS_DEFAULT } = {}) {
  const risk = await objectiveRisk({ weeks, now })
  const week = weekKey(isoWeekOf(now))
  const managers = await directManagers([...new Set(risk.items.filter(i => i.level === 'CRITICAL').map(i => i.ownerId))])
  const users = await loadActiveUsers([...risk.items.map(i => i.ownerId), ...[...managers.values()].flat()])
  let notified = 0
  let already = 0
  const out = []
  for (const it of risk.items) {
    const owner = users.get(it.ownerId)
    if (!owner?.active) continue
    const recipients = [{ id: it.ownerId, role: 'OWNER' }]
    if (it.level === 'CRITICAL') {
      for (const m of managers.get(it.ownerId) || []) if (users.get(m)?.active) recipients.push({ id: m, role: 'MANAGER' })
    }
    const key = streakRemindKey(it.objectiveId, week, it.level)
    const sent = new Set((await prisma.notification.findMany({
      where: { type: STREAK_REMIND_TYPE, userId: { in: recipients.map(r => BigInt(r.id)) }, data: { startsWith: dataPrefix(key) } },
      select: { userId: true }
    })).map(n => String(n.userId)))
    already += sent.size
    const todo = recipients.filter(r => !sent.has(r.id))
    out.push({ objectiveId: it.objectiveId, ownerId: it.ownerId, level: it.level, consecutiveMissedWeeks: it.consecutiveMissedWeeks, notify: todo.map(r => r.id) })
    if (dryRun) continue
    const msg = streakMessages({ title: clip(it.title, 80), n: it.consecutiveMissedWeeks, rate: pct(it.lastWeekRate), ownerName: clip(nameOf(owner), 20) })
    const data = { key, objectiveId: it.objectiveId, week, level: it.level, consecutiveMissedWeeks: it.consecutiveMissedWeeks }
    for (const r of todo) {
      const isOwner = r.role === 'OWNER'
      await pushNotification({
        userId: r.id, type: STREAK_REMIND_TYPE, channels: ['site'], data,
        title: it.level === 'CRITICAL' ? 'OKR 连续未达成(标红)' : 'OKR 连续未达成预警',
        body: isOwner ? msg[it.level] : msg.MANAGER,
        link: isOwner ? `/admin/okr?week=${week}` : `/admin/okr?week=${week}&ownerId=${it.ownerId}`
      })
      notified++
    }
  }
  return { week, asOf: risk.asOf, warn: risk.summary.warn, critical: risk.summary.critical, notified, already, items: out }
}

