// OKR 2.0: 个人 OKR 汇总与按周 / 按年统计。
// 只读现有 okr_* 表, 不建统计表、不跑定时任务; 只做个人维度, 不排名。
// 主管评分是否返回由路由按查看人处理(okrAccess.forViewer), 这里一律算出来。
// OKR 免提交白名单里的人不进统计: 三个接口照常 200(带 exempt: true), 但按「一周都没参与」返回 —— 不计迟交、不计承诺。
import prisma from '../lib/prisma.js'
import { OkrRuleError, isoWeekOf, shiftWeek, weekKey, krProgress, objectiveProgress, shanghaiDateKey } from './okrRules.js'
import { blockerOwnerNames, riskFields, riskSummary } from './okrBlockers.js'
import { personSummary, cycleView } from './okr.js'
import { isExempt } from './okrExempt.js'
import { projectsByObjective } from './okrObjectiveProjects.js'

const r2 = n => (n == null ? null : Math.round(n * 100) / 100)
const r4 = n => (n == null ? null : Math.round(n * 10000) / 10000)
const mean = xs => (xs.length ? r2(xs.reduce((s, x) => s + x, 0) / xs.length) : null)
const notFound = msg => new OkrRuleError(msg, { status: 404, code: 8108 })

async function loadPerson(userId) {
  if (!/^\d+$/.test(String(userId ?? ''))) throw new OkrRuleError('userId 不合法', { code: 8100 })
  const u = await prisma.user.findFirst({
    where: { id: BigInt(userId), deletedAt: null },
    select: {
      id: true, name: true, username: true, avatarUrl: true, role: true,
      teamMemberships: { select: { team: { select: { id: true, name: true, deletedAt: true } } } }
    }
  })
  if (!u) throw notFound('用户不存在')
  return {
    id: String(u.id), name: u.name, username: u.username, avatarUrl: u.avatarUrl, role: u.role,
    teams: (u.teamMemberships || []).map(m => m.team).filter(t => t && !t.deletedAt).map(t => ({ id: String(t.id), name: t.name }))
  }
}

/** 某人在一批周期里的 O(含 KR 与进展条数), 按 cycleId 分组 */
async function objectivesByCycle(ownerId, cycleIds) {
  if (!cycleIds.length) return new Map()
  const objs = await prisma.okrObjective.findMany({
    where: { ownerId: BigInt(ownerId), cycleId: { in: cycleIds } },
    orderBy: { seq: 'asc' },
    include: { keyResults: true, _count: { select: { updates: true } } }
  })
  const m = new Map()
  for (const o of objs) {
    const k = String(o.cycleId)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(o)
  }
  return m
}

/** 一周的个人汇总(按周 / 按年 / 概览共用一个口径) */
function weekRow(cycle, objs) {
  const s = personSummary(cycle, objs)
  const live = objs.filter(o => o.status !== 'DROPPED')
  return {
    key: weekKey(cycle), year: cycle.year, weekNo: cycle.weekNo, status: cycle.status,
    submitted: s.submitted, submission: s.submission, late: s.submission === 'LATE',
    objectiveCount: s.objectiveCount, krTotal: s.krTotal, krDone: s.krDone,
    // 承诺 = 已提交那周的 KR 数; 没交的周不算承诺
    committed: s.submitted ? s.krTotal : 0,
    done: s.submitted ? s.krDone : 0,
    completion: s.completion,
    selfScore: s.selfScore,
    managerScore: s.managerScore,
    updateCount: live.reduce((n, o) => n + (o._count?.updates || 0), 0)
  }
}

function emptyWeek(week) {
  return {
    key: weekKey(week), year: week.year, weekNo: week.weekNo, status: null,
    submitted: false, submission: 'NONE', late: false, objectiveCount: 0, krTotal: 0, krDone: 0,
    committed: 0, done: 0, completion: null, selfScore: null, managerScore: null, updateCount: 0
  }
}

function yearSummary(rows) {
  const part = rows.filter(r => r.submitted)
  const committed = part.reduce((n, r) => n + r.committed, 0)
  const done = part.reduce((n, r) => n + r.done, 0)
  return {
    weeksParticipated: part.length,
    lateWeeks: part.filter(r => r.late).length,
    avgSelfScore: mean(part.map(r => r.selfScore).filter(v => v != null)),
    avgManagerScore: mean(part.map(r => r.managerScore).filter(v => v != null)),
    committed, done,
    completionRate: committed ? r4(done / committed) : null
  }
}

/**
 * 个人 OKR 汇总: 基本信息 + 当前周五项 + 最近 8 周趋势 + 按年聚合
 */
export async function personOverview(userId, { now = new Date(), trendWeeks = 8 } = {}) {
  const user = await loadPerson(userId)
  const exempt = await isExempt(userId)
  const cur = isoWeekOf(now)
  const keys = []
  for (let i = trendWeeks - 1; i >= 0; i--) keys.push(shiftWeek(cur, -i))
  if (exempt) {
    const e = emptyWeek(cur)
    return {
      user, exempt,
      current: { week: e.key, status: null, submitted: false, late: false, objectiveCount: 0, krCount: 0, avgSelfScore: null, managerScore: null, lateCount: 0, updateCount: 0, riskLevel: null, blockerCount: 0, blockerOverdueCount: 0, objectives: [] },
      trend: keys.map(k => ({ key: weekKey(k), year: k.year, weekNo: k.weekNo, submitted: false, selfScore: null, managerScore: null, completion: null })),
      years: []
    }
  }

  // 此人参与过的所有周期(有 O 的周), 用来做按年聚合; 量是"人 × 周", 一年最多 53 行
  const owned = await prisma.okrObjective.findMany({ where: { ownerId: BigInt(userId) }, select: { cycleId: true }, distinct: ['cycleId'] })
  const trendCycles = await prisma.okrCycle.findMany({ where: { OR: keys.map(k => ({ year: k.year, weekNo: k.weekNo })) } })
  const cycleIds = [...new Set([...owned.map(o => String(o.cycleId)), ...trendCycles.map(c => String(c.id))])].map(BigInt)
  const cycles = cycleIds.length ? await prisma.okrCycle.findMany({ where: { id: { in: cycleIds } } }) : []
  const byCycle = await objectivesByCycle(userId, cycles.map(c => c.id))
  const byKey = new Map(cycles.map(c => [weekKey(c), c]))
  const rowOf = week => {
    const c = byKey.get(weekKey(week))
    return c ? weekRow(c, byCycle.get(String(c.id)) || []) : emptyWeek(week)
  }

  const now0 = rowOf(cur)
  // 6.0: 当前周每个 O 的风险等级 + 卡点摘要(前端画红黄绿)
  const curCycle = byKey.get(weekKey(cur))
  const curObjs = curCycle ? (byCycle.get(String(curCycle.id)) || []) : []
  const today = shanghaiDateKey(now)
  const blockerNames = await blockerOwnerNames(curObjs)
  const curYearRows = cycles.filter(c => c.year === cur.year).map(c => weekRow(c, byCycle.get(String(c.id)) || []))
  const years = new Map()
  for (const c of cycles) {
    const objs = byCycle.get(String(c.id))
    if (!objs?.length) continue
    if (!years.has(c.year)) years.set(c.year, [])
    years.get(c.year).push(weekRow(c, objs))
  }

  return {
    user,
    exempt,
    current: {
      week: now0.key,
      status: now0.status,
      submitted: now0.submitted,
      late: now0.late,
      objectiveCount: now0.objectiveCount,
      krCount: now0.krTotal,
      avgSelfScore: now0.selfScore,
      managerScore: now0.managerScore,
      // 迟交次数: 本年度累计迟交的周数(单周只有迟交 / 没迟交)
      lateCount: curYearRows.filter(r => r.late).length,
      updateCount: now0.updateCount,
      ...riskSummary(curObjs, today),
      objectives: curObjs.map(o => ({ id: String(o.id), seq: o.seq, title: o.title, status: o.status, ...riskFields(o, blockerNames, today) }))
    },
    trend: keys.map(k => {
      const r = rowOf(k)
      return { key: r.key, year: r.year, weekNo: r.weekNo, submitted: r.submitted, selfScore: r.selfScore, managerScore: r.managerScore, completion: r.completion }
    }),
    years: [...years.entries()].sort((a, b) => b[0] - a[0]).map(([year, rows]) => {
      const s = yearSummary(rows)
      return { year, weeksParticipated: s.weeksParticipated, avgSelfScore: s.avgSelfScore, avgManagerScore: s.avgManagerScore, lateWeeks: s.lateWeeks, completionRate: s.completionRate }
    })
  }
}

/** 一周: 每个 O 的 KR 进度、进展条数、是否迟交 */
export async function weekStats(userId, week) {
  const user = await loadPerson(userId)
  const exempt = await isExempt(userId)
  const cycle = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!cycle || exempt) return { user, exempt, scope: 'week', week: weekKey(week), cycle: cycle ? cycleView(cycle) : null, summary: emptyWeek(week), objectives: [] }
  const objs = (await objectivesByCycle(userId, [cycle.id])).get(String(cycle.id)) || []
  // 5.0: 每个 O 带项目名称(统计口径不变, 仍按人)
  const projects = await projectsByObjective(objs.map(o => o.id))
  return {
    user,
    exempt,
    scope: 'week',
    week: weekKey(cycle),
    cycle: cycleView(cycle),
    summary: weekRow(cycle, objs),
    objectives: objs.map(o => {
      const krs = [...o.keyResults].sort((a, b) => a.seq - b.seq)
      return {
        id: String(o.id), seq: o.seq, title: o.title, weight: o.weight, status: o.status,
        submitted: !!o.submittedAt, lateSubmit: o.lateSubmit,
        selfScore: o.selfScore, managerScore: o.managerScore,
        progress: r4(objectiveProgress({ keyResults: krs })),
        updateCount: o._count?.updates || 0,
        projects: (projects.get(String(o.id)) || []).map(p => p.name),
        keyResults: krs.map(k => ({
          id: String(k.id), seq: k.seq, title: k.title, metricType: k.metricType, unit: k.unit,
          currentValue: k.currentValue, targetValue: k.targetValue, weight: k.weight, status: k.status,
          progress: r4(krProgress(k))
        }))
      }
    })
  }
}

/** 一年: 按周聚合(周序号 / 自评均值 / 承诺数 / 完成数) + 年度汇总 */
export async function yearStats(userId, year) {
  const user = await loadPerson(userId)
  const exempt = await isExempt(userId)
  if (exempt) return { user, exempt, scope: 'year', year, weeks: [], summary: yearSummary([]) }
  const cycles = await prisma.okrCycle.findMany({ where: { year }, orderBy: { weekNo: 'asc' } })
  const byCycle = await objectivesByCycle(userId, cycles.map(c => c.id))
  const weeks = cycles
    .filter(c => byCycle.get(String(c.id))?.length)
    .map(c => weekRow(c, byCycle.get(String(c.id))))
  return {
    user,
    exempt,
    scope: 'year',
    year,
    weeks: weeks.map(r => ({
      key: r.key, weekNo: r.weekNo, status: r.status, submitted: r.submitted, late: r.late,
      selfScore: r.selfScore, managerScore: r.managerScore,
      committed: r.committed, done: r.done, completion: r.completion, updateCount: r.updateCount
    })),
    summary: yearSummary(weeks)
  }
}
