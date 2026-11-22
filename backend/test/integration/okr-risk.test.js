// 集成测试 - OKR 10.0: 连续未达成预警(/api/okr/risk/objectives、/risk/people)+ 每日提醒(okrRiskReminder)
//
// 测试年份(与其他 OKR 用例错开): 2141–2149 年里随机一周当「今天」(asOf = 那周周三), 它前面 6 周 + 当周的周期由 prisma 现建,
// O / KR 也直接由 prisma 造(要控制完成率、主管分、卡点), 现建现删, 绝不碰真实周。接口一律带 asOf, 提醒直接调服务并传同一天,
// 窗口里只有本文件的数据, 不会给库里其他人发通知。
// 人物: ADMIN、M(MANAGER, 团队 T 的负责人)、团队 T 成员 W(WARN 场景)/ C(CRITICAL 与断档场景)/ K(全达标);
//       不在 T 里的 S(主管分 / MISSED / DONE 场景)、X(逾期卡点升档)。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api } from './helpers.js'
import { weekRange, weekKey, shiftWeek, shanghaiDateKey } from '../../src/services/okrRules.js'
import { okrRiskReminder, parseAsOf, streakRemindKey, STREAK_REMIND_TYPE } from '../../src/services/okrRisk.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const CUR = { year: rnd(2141, 2149), weekNo: rnd(10, 40) }
const ASOF = shanghaiDateKey(new Date(weekRange(CUR.year, CUR.weekNo).start.getTime() + 2.5 * 24 * 3600 * 1000))
const w = k => shiftWeek(CUR, -k) // w(1) = 上周, 最近一个已结束周
const DAY = 24 * 3600 * 1000
const T = s => `unit-test-v10 ${s} ${process.pid}`

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const oids = (await prisma.okrObjective.findMany({ where: { cycleId: c.id }, select: { id: true } })).map(o => o.id)
  await prisma.okrObjectiveProject.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrUpdate.deleteMany({ where: { OR: [{ cycleId: c.id }, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [{ cycleId: c.id }, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

describe('OKR 10.0 连续未达成预警', () => {
  let ADMIN, M, W, C, K, S, X, team
  const cycles = new Map()
  const O = {} // 标题 → 最近一周那条 O 的 id

  /** 造一条 O: 完成率 rate(0–100, 一条 PERCENT KR), 可指定状态 / 主管分 / 卡点 */
  async function mkO(user, k, title, rate, { status = 'ON_TRACK', managerScore = null, blocker = null } = {}) {
    const c = cycles.get(k)
    const o = await prisma.okrObjective.create({
      data: {
        cycleId: c.id, ownerId: BigInt(user.id), seq: 1, title, weight: 100, status, managerScore,
        submittedAt: new Date(c.startDate.getTime() + 3600 * 1000),
        ...(blocker ? { blockers: blocker.text, blockerOwnerId: BigInt(blocker.ownerId), blockerDueDate: new Date(`${blocker.due}T00:00:00.000Z`) } : {}),
        keyResults: { create: [{ seq: 1, title: 'KR 进度', metricType: 'PERCENT', targetValue: 100, currentValue: rate, weight: 100, status: 'ON_TRACK' }] }
      }
    })
    if (k === 1) O[title] = String(o.id)
    return o
  }

  const get = (u, path, qs = {}) => api(u.token).get(`/api/okr/risk/${path}?${new URLSearchParams({ asOf: ASOF, ...qs })}`)
  const okData = r => { assert.equal(r.status, 200, r.message); assert.equal(r.code, 0, r.message); return r.data }
  const itemOf = (data, title) => data.items.find(i => i.title === title)

  before(async () => {
    ADMIN = await createTestUser('ADMIN', { name: 'unit-test-v10-老板' })
    M = await createTestUser('MANAGER', { name: 'unit-test-v10-主管M' })
    W = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v10-小黄' })
    C = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v10-小红' })
    K = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v10-小绿' })
    S = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v10-评过分' })
    X = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v10-卡点' })
    team = await prisma.team.create({ data: { name: `unit-test-v10-${process.pid}-${Date.now()}`.slice(0, 50), status: 1, leaderId: BigInt(M.id) } })
    for (const u of [M, W, C, K]) await prisma.teamMembership.create({ data: { teamId: team.id, userId: BigInt(u.id) } })

    for (let k = 0; k <= 6; k++) {
      const wk = w(k)
      const { start, end } = weekRange(wk.year, wk.weekNo)
      cycles.set(k, await prisma.okrCycle.create({ data: { year: wk.year, weekNo: wk.weekNo, startDate: start, endDate: end, status: k === 0 ? 'IN_PROGRESS' : 'REVIEW' } }))
    }

    // W: 连续 2 周 30% / 40% → WARN
    await mkO(W, 2, T('WARN'), 30)
    await mkO(W, 1, T('WARN'), 40)
    // C: 连续 3 周 → CRITICAL; 中间 80% 断开的三条
    for (const [k, r] of [[3, 20], [2, 30], [1, 40]]) await mkO(C, k, T('CRIT'), r)
    for (const [k, r] of [[4, 30], [3, 80], [2, 30], [1, 40]]) await mkO(C, k, T('BREAK-2'), r)
    for (const [k, r] of [[3, 30], [2, 80], [1, 40]]) await mkO(C, k, T('BREAK-1'), r)
    for (const [k, r] of [[2, 30], [1, 80]]) await mkO(C, k, T('BREAK-0'), r)
    // K: 两周都达标
    await mkO(K, 2, T('OK'), 80)
    await mkO(K, 1, T('OK'), 90)
    // S: 评过分的周不算; MISSED 一律算; DONE 不算
    await mkO(S, 3, T('SCORED'), 30, { managerScore: 50 })
    await mkO(S, 2, T('SCORED'), 30)
    await mkO(S, 1, T('SCORED'), 40)
    await mkO(S, 2, T('SCORED-LAST'), 30)
    await mkO(S, 1, T('SCORED-LAST'), 30, { managerScore: 40 })
    await mkO(S, 2, T('MISSED'), 90, { status: 'MISSED', managerScore: 80 })
    await mkO(S, 1, T('MISSED'), 40)
    await mkO(S, 2, T('DONE'), 10, { status: 'DONE' })
    await mkO(S, 1, T('DONE'), 30)
    // X: 连续 2 周 + 上周的 O 卡点已逾期 → WARN 升 CRITICAL
    const wk1 = w(1)
    const due = shanghaiDateKey(weekRange(wk1.year, wk1.weekNo).start)
    await mkO(X, 2, T('BLOCKED'), 30)
    await mkO(X, 1, T('BLOCKED'), 40, { blocker: { text: '等客户给测试环境', ownerId: M.id, due } })

    // 每日总结: K 在上周写了一篇(上上周没写), W 一篇都没写
    const kMonday = weekRange(wk1.year, wk1.weekNo).start
    await prisma.okrDailySummary.create({
      data: { userId: BigInt(K.id), date: new Date(`${shanghaiDateKey(new Date(kMonday.getTime() + DAY))}T00:00:00.000Z`), summaryMd: '推进顺利', createdBy: BigInt(K.id) }
    })
  })

  after(async () => {
    const users = [ADMIN, M, W, C, K, S, X].filter(Boolean)
    const uids = users.map(u => BigInt(u.id))
    for (let k = 0; k <= 6; k++) await dropCycle(w(k)).catch(() => {})
    await prisma.okrDailySummary.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
    if (team) {
      await prisma.teamMembership.deleteMany({ where: { teamId: team.id } }).catch(() => {})
      await prisma.team.delete({ where: { id: team.id } }).catch(() => {})
    }
    for (const u of users) await u.cleanup()
  })

  test('1. 连续 2 周 30% / 40% → WARN, consecutiveMissedWeeks=2', async () => {
    const d = okData(await get(ADMIN, 'objectives'))
    const it = itemOf(d, T('WARN'))
    assert.ok(it, '应在预警列表里')
    assert.equal(it.level, 'WARN')
    assert.equal(it.consecutiveMissedWeeks, 2)
    assert.equal(it.lastWeekRate, 0.4)
    assert.equal(it.ownerId, W.id)
    assert.equal(it.ownerName, W.name)
    assert.equal(it.objectiveId, O[T('WARN')])
    assert.deepEqual(it.projectNames, [])
    assert.equal(it.hasOverdueBlocker, false)
    assert.equal(d.asOf, ASOF)
    assert.deepEqual(d.window, [4, 3, 2, 1].map(k => weekKey(w(k))))
  })

  test('2. 连续 3 周 → CRITICAL, 排在 WARN 前面', async () => {
    const d = okData(await get(ADMIN, 'objectives'))
    const it = itemOf(d, T('CRIT'))
    assert.equal(it.level, 'CRITICAL')
    assert.equal(it.consecutiveMissedWeeks, 3)
    const firstWarn = d.items.findIndex(i => i.level === 'WARN')
    const lastCrit = d.items.map(i => i.level).lastIndexOf('CRITICAL')
    assert.ok(firstWarn === -1 || lastCrit < firstWarn, 'CRITICAL 置顶')
    assert.ok(d.summary.critical >= 2 && d.summary.warn >= 3)
  })

  test('3. 中间某周 80% → 连续计数断开', async () => {
    const d = okData(await get(ADMIN, 'objectives'))
    // 30 / 80 / 30 / 40: 只数到 80% 那周之后的 2 周(不断的话是 4 周 CRITICAL)
    const b2 = itemOf(d, T('BREAK-2'))
    assert.equal(b2.consecutiveMissedWeeks, 2)
    assert.equal(b2.level, 'WARN')
    assert.deepEqual(b2.weeklyRates.map(x => x.missed), [true, false, true, true])
    // 30 / 80 / 40 → 1 周; 30 / 80 → 0 周: 都不到预警线, 不出现
    assert.equal(itemOf(d, T('BREAK-1')), undefined)
    assert.equal(itemOf(d, T('BREAK-0')), undefined)
    assert.equal(itemOf(d, T('OK')), undefined)
  })

  test('4. 已评分的周不参与计数; MISSED 一律算, DONE 不算', async () => {
    const d = okData(await get(ADMIN, 'objectives'))
    // 30(有主管分) / 30 / 40 → 2 周(不评分的话是 3 周 CRITICAL)
    const sc = itemOf(d, T('SCORED'))
    assert.equal(sc.consecutiveMissedWeeks, 2)
    assert.equal(sc.level, 'WARN')
    assert.equal(sc.weeklyRates[1].missed, false)
    assert.equal(sc.weeklyRates[1].rate, 0.3)
    // 最近一周评过分 → 0
    assert.equal(itemOf(d, T('SCORED-LAST')), undefined)
    // MISSED(即使 90% 且有主管分)+ 40% → 2 周
    const ms = itemOf(d, T('MISSED'))
    assert.equal(ms.consecutiveMissedWeeks, 2)
    assert.equal(ms.weeklyRates[2].status, 'MISSED')
    // DONE(10%) + 30% → 1 周
    assert.equal(itemOf(d, T('DONE')), undefined)
  })

  test('5. 逾期卡点 + 连续 2 周 → 从 WARN 升 CRITICAL', async () => {
    const it = itemOf(okData(await get(ADMIN, 'objectives')), T('BLOCKED'))
    assert.equal(it.consecutiveMissedWeeks, 2)
    assert.equal(it.hasOverdueBlocker, true)
    assert.equal(it.level, 'CRITICAL')
  })

  test('6. weeklyRates 长度 = weeks; 按周升序, 没有这个 O 的周 rate=null; weeks 越界 400', async () => {
    for (const weeks of [4, 6, 2]) {
      const d = okData(await get(ADMIN, 'objectives', { weeks: String(weeks) }))
      assert.equal(d.weeks, weeks)
      for (const it of d.items) assert.equal(it.weeklyRates.length, weeks)
      const crit = itemOf(d, T('CRIT'))
      assert.deepEqual(crit.weeklyRates.map(x => x.week), Array.from({ length: weeks }, (_, i) => weekKey(w(weeks - i))))
      // 窗口只有 2 周时最多数到 2
      assert.equal(crit.consecutiveMissedWeeks, Math.min(3, weeks))
      assert.equal(typeof crit.hasOverdueBlocker, 'boolean')
    }
    const d6 = okData(await get(ADMIN, 'objectives', { weeks: '6' }))
    assert.deepEqual(itemOf(d6, T('WARN')).weeklyRates.map(x => x.rate), [null, null, null, null, 0.3, 0.4])
    assert.deepEqual(itemOf(d6, T('CRIT')).weeklyRates.map(x => x.status), [null, null, null, 'ON_TRACK', 'ON_TRACK', 'ON_TRACK'])
    for (const bad of ['1', '27', 'abc']) {
      const r = await get(ADMIN, 'objectives', { weeks: bad })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8100)
    }
    assert.equal((await get(ADMIN, 'objectives', { asOf: '2141-13-01' })).status, 400)
  })

  test('7. 人级: 连续 2 周 < 60% 的人在列表里, consecutiveMissedWeeks / 平均完成率 / 未写总结周数正确', async () => {
    const d = okData(await get(ADMIN, 'people'))
    assert.deepEqual(d.window, [4, 3, 2, 1].map(k => weekKey(w(k))))
    const pw = d.items.find(i => i.userId === W.id)
    assert.ok(pw, 'W 应在人级列表里')
    assert.equal(pw.consecutiveMissedWeeks, 2)
    assert.equal(pw.level, 'WARN')
    assert.equal(pw.avgCompletion, 0.35)
    assert.equal(pw.missingSummaryWeeks, 2)
    assert.equal(pw.weekly.length, 4)
    const pk = d.items.find(i => i.userId === K.id)
    assert.equal(pk.consecutiveMissedWeeks, 0)
    assert.equal(pk.level, null)
    assert.equal(pk.avgCompletion, 0.85)
    assert.equal(pk.missingSummaryWeeks, 1)
    // 预警的人排在前面
    assert.ok(d.items.findIndex(i => i.userId === W.id) < d.items.findIndex(i => i.userId === K.id))
  })

  test('8. 提醒: CRITICAL 发负责人 + 直属主管各 1 条, WARN 只发负责人; 同周重跑不重复发', async () => {
    const now = parseAsOf(ASOF)
    const week = weekKey(CUR)
    const r1 = await okrRiskReminder(now)
    assert.equal(r1.week, week)
    assert.ok(r1.notified >= 1)
    const notes = async (u, title) => prisma.notification.findMany({
      where: { type: STREAK_REMIND_TYPE, userId: BigInt(u.id), data: { contains: `"objectiveId":"${O[title]}"` } }
    })

    // CRITICAL(C 的 CRIT): C 一条、M(团队负责人)一条
    const cOwner = await notes(C, T('CRIT'))
    const cMgr = await notes(M, T('CRIT'))
    assert.equal(cOwner.length, 1)
    assert.equal(cMgr.length, 1)
    assert.equal(cOwner[0].body, `「${T('CRIT')}」连续 3 周未达成，已标红，请与主管对齐是否缩小范围`)
    assert.equal(cMgr[0].body, `${C.name} 的 O「${T('CRIT')}」连续 3 周未达成`)
    assert.ok(cOwner[0].data.startsWith(`{"key":"${streakRemindKey(O[T('CRIT')], week, 'CRITICAL')}"`))
    // WARN(W): 只发 W
    const wOwner = await notes(W, T('WARN'))
    assert.equal(wOwner.length, 1)
    assert.equal(wOwner[0].body, `你的 O「${T('WARN')}」已连续 2 周未达成，本周目标 40%`)
    assert.equal((await notes(M, T('WARN'))).length, 0)
    // X 的卡点升档 CRITICAL: X 不在任何团队, 只有本人
    assert.equal((await notes(X, T('BLOCKED'))).length, 1)
    // 没进预警的不发
    assert.equal((await notes(C, T('BREAK-1'))).length, 0)

    const before = await prisma.notification.count({ where: { type: STREAK_REMIND_TYPE, userId: { in: [M, W, C, S, X].map(u => BigInt(u.id)) } } })
    const r2 = await okrRiskReminder(now)
    assert.equal(r2.notified, 0)
    assert.ok(r2.already >= r1.notified)
    const after = await prisma.notification.count({ where: { type: STREAK_REMIND_TYPE, userId: { in: [M, W, C, S, X].map(u => BigInt(u.id)) } } })
    assert.equal(after, before)
  })

  test('9. 权限: 工程师只拿自己的(CRITICAL 照给), MANAGER 拿本团队, ADMIN 全量', async () => {
    const mine = okData(await get(W, 'objectives'))
    assert.deepEqual([...new Set(mine.items.map(i => i.ownerId))], [W.id])
    assert.equal(mine.items.length, 1)
    const cs = okData(await get(C, 'objectives'))
    assert.deepEqual([...new Set(cs.items.map(i => i.ownerId))], [C.id])
    assert.equal(itemOf(cs, T('CRIT')).level, 'CRITICAL')
    assert.equal(cs.summary.critical, 1)

    const m = okData(await get(M, 'objectives'))
    const mOwners = new Set(m.items.map(i => i.ownerId))
    assert.ok(mOwners.has(W.id) && mOwners.has(C.id))
    assert.ok(!mOwners.has(S.id) && !mOwners.has(X.id))
    for (const id of mOwners) assert.ok([M.id, W.id, C.id, K.id].includes(id))

    const a = okData(await get(ADMIN, 'objectives'))
    const aOwners = new Set(a.items.map(i => i.ownerId))
    for (const u of [W, C, S, X]) assert.ok(aOwners.has(u.id), `ADMIN 应看到 ${u.name}`)

    // 人级同一口径
    const pMine = okData(await get(W, 'people'))
    assert.deepEqual(pMine.items.map(i => i.userId), [W.id])
    const pM = okData(await get(M, 'people'))
    const pmIds = new Set(pM.items.map(i => i.userId))
    assert.ok(pmIds.has(W.id) && pmIds.has(C.id) && pmIds.has(K.id))
    assert.ok(!pmIds.has(S.id) && !pmIds.has(X.id))
    const pA = okData(await get(ADMIN, 'people'))
    const paIds = new Set(pA.items.map(i => i.userId))
    for (const u of [W, C, K, S, X]) assert.ok(paIds.has(u.id))
  })
})
