// 集成测试 - OKR 6.0: 阶段型 KR(MILESTONE) + O/KR 卡点与风险 + 卡点到期提醒
//
// 测试年份(与其他 OKR 用例错开): 2041–2049 年随机一周(以后的周, 周期现建为 IN_PROGRESS, 不会被时间推进), 现建现删, 绝不碰真实周。
// 阶段 / 卡点的日期按真实「今天」(上海)前后各一天算: 逾期与提醒都只看日期, 跟 O 在哪一周无关。
// 人物: 工程师 A(主角) / B(卡点人) / E(免提交名单, 只在用例 8 里加锁使用); 老板 O(ADMIN)。账号现建现删。
// 计划(A): O1 阶段型 —— KR-M(3 个阶段, 都在以后) + KR-M2(2 个阶段); 卡点在 B, 明天截止(未逾期)
//          O2 回归 —— BINARY / PERCENT / NUMBER 各一条
//          O3 卡点在 B, 昨天截止(逾期), 风险 HIGH
// 计划(B): O1 一条 BINARY, 卡点在 A, 昨天截止 —— 标完成后 O DONE, 不算逾期、不发提醒
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, acquireTestLock, dropPlanTrail, lockOkrLimits } from './helpers.js'
import { weekRange, weekKey, shanghaiDateKey } from '../../src/services/okrRules.js'
import { EXEMPT_KEY } from '../../src/services/okrExempt.js'
import { personOverview } from '../../src/services/okrStats.js'
import { BLOCKER_DUE_TYPE, blockerDueKey } from '../../src/services/okrBlockers.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const WEEK = { year: rnd(2041, 2049), weekNo: rnd(2, 50) }
const WK = weekKey(WEEK)
const { start: WEEK_START, end: WEEK_END } = weekRange(WEEK.year, WEEK.weekNo)

const DAY = 24 * 3600 * 1000
const TODAY = shanghaiDateKey()
const shiftDay = n => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const YESTERDAY = shiftDay(-1)
const TOMORROW = shiftDay(1)

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const where = { cycleId: c.id }
  const oids = (await prisma.okrObjective.findMany({ where, select: { id: true } })).map(o => o.id)
  await prisma.okrObjectiveProject.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await dropPlanTrail([c.id])
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

let exemptRowCreated = false
async function setExemptMember(userId, on) {
  const row = await prisma.appSetting.findUnique({ where: { key: EXEMPT_KEY } })
  let ids = []
  try { ids = JSON.parse(row?.value || '[]').map(String) } catch { ids = [] }
  const has = ids.includes(String(userId))
  if (on === has) return
  const next = on ? [...ids, String(userId)] : ids.filter(v => v !== String(userId))
  if (!row) {
    await prisma.appSetting.create({ data: { key: EXEMPT_KEY, value: JSON.stringify(next) } })
    exemptRowCreated = true
  } else if (!next.length && exemptRowCreated) {
    await prisma.appSetting.deleteMany({ where: { key: EXEMPT_KEY } })
  } else {
    await prisma.appSetting.update({ where: { key: EXEMPT_KEY }, data: { value: JSON.stringify(next) } })
  }
}

/** 某 O 今天的到期提醒(按去重 key 前缀) */
const dueNotes = objectiveId => prisma.notification.findMany({
  where: { type: BLOCKER_DUE_TYPE, data: { startsWith: `{"key":"${blockerDueKey(objectiveId, TODAY)}"` } },
  select: { userId: true, title: true, data: true }
})

const krOf = (objs, title) => objs.flatMap(o => o.keyResults).find(k => k.title === title)

describe('OKR 6.0 阶段型 KR / 卡点与风险 / 到期提醒', () => {
  let A, B, E, O
  let a, b, e, boss
  let aObjs, bObj
  let unlock

  const O1 = 'unit-test-v6 A-O1 华丰上线'
  const O2 = 'unit-test-v6 A-O2 回归'
  const O3 = 'unit-test-v6 A-O3 等工艺模板'

  let releaseLimits
  before(async () => {
    // 整组围着一份 3 个 O 的计划转, 依赖默认上限 3: 和 okr-limits.test.js 改上限的窗口互斥
    releaseLimits = await lockOkrLimits()
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v6-工程师A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v6-卡点人B' })
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v6-免提交E' })
    O = await createTestUser('ADMIN', { name: 'unit-test-v6-老板O' })
    a = api(A.token); b = api(B.token); e = api(E.token); boss = api(O.token)
    await prisma.okrCycle.create({ data: { year: WEEK.year, weekNo: WEEK.weekNo, startDate: WEEK_START, endDate: WEEK_END, status: 'IN_PROGRESS' } })
  })

  after(async () => {
    try {
      if (unlock) await setExemptMember(E?.id, false).catch(() => {})
      await dropCycle(WEEK)
      const uids = [A, B, E, O].filter(Boolean).map(u => BigInt(u.id))
      await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
      for (const u of [A, B, E, O]) await u?.cleanup()
    } finally {
      unlock?.()
      releaseLimits?.()
    }
  })

  // ---------------------------------------------------------------- 建档

  test('建档: 阶段型 KR 3 个阶段 → targetValue=3、currentValue=0、阶段都未完成; O 带 riskLevel 与 blocker 摘要', async () => {
    const r = await a.post(`/api/okr/plan/submit?week=${WK}`, {
      objectives: [
        {
          title: O1, blockers: '技术工艺要出模板', blockerOwnerId: B.id, blockerDueDate: TOMORROW, riskLevel: 'MEDIUM',
          keyResults: [
            { title: 'KR-M 华丰三阶段', metricType: 'MILESTONE', milestones: [
              { name: '出模板', dueDate: shiftDay(3) }, { name: '联调', dueDate: shiftDay(4) }, { name: '上线', dueDate: shiftDay(5) }
            ], blockers: '模板没出就联调不了' },
            { title: 'KR-M2 两阶段', metricType: 'MILESTONE', milestones: [{ name: '甲' }, { name: '乙' }] }
          ]
        },
        {
          title: O2,
          keyResults: [
            { title: 'KR-BIN 上线', metricType: 'BINARY' },
            { title: 'KR-PCT 覆盖率', metricType: 'PERCENT', targetValue: 100 },
            { title: 'KR-NUM 客户数', metricType: 'NUMBER', targetValue: 10, unit: '家' }
          ]
        },
        {
          title: O3, blockers: '技术工艺 11/24 前必出模板, 否则全线顺延', blockerOwnerId: B.id, blockerDueDate: YESTERDAY, riskLevel: 'HIGH',
          keyResults: [{ title: 'KR-O3 拿到模板', metricType: 'BINARY' }]
        }
      ]
    })
    assert.equal(r.code, 0, r.message)
    aObjs = r.data.objectives
    const km = krOf(aObjs, 'KR-M 华丰三阶段')
    assert.equal(km.metricType, 'MILESTONE')
    assert.equal(km.targetValue, 3)
    assert.equal(km.currentValue, 0)
    assert.equal(km.status, 'ON_TRACK')
    assert.equal(km.blockers, '模板没出就联调不了', 'KR 带卡点说明')
    assert.deepEqual(km.milestones.map(m => [m.name, m.dueDate, m.done]), [
      ['出模板', shiftDay(3), false], ['联调', shiftDay(4), false], ['上线', shiftDay(5), false]
    ])
    const o1 = aObjs.find(o => o.title === O1)
    assert.equal(o1.riskLevel, 'MEDIUM')
    assert.deepEqual(o1.blocker, { text: '技术工艺要出模板', ownerId: B.id, ownerName: B.name, dueDate: TOMORROW, overdue: false })
    assert.equal(aObjs.find(o => o.title === O2).riskLevel, 'LOW', '没传风险默认 LOW')
    assert.equal(aObjs.find(o => o.title === O2).blocker, null, '没填卡点 blocker 为 null')
    assert.equal(krOf(aObjs, 'KR-BIN 上线').milestones, null, '非阶段型 milestones 为 null')
  })

  // ---------------------------------------------------------------- 1. 勾阶段

  test('1. MILESTONE: 勾 2 个 → currentValue=2、完成度 0.67、前两个阶段 done; 勾完 → status=DONE', async () => {
    const km = krOf(aObjs, 'KR-M 华丰三阶段')
    const r = await a.patch(`/api/okr/krs/${km.id}`, { currentValue: 2 })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.valueBefore, 0)
    assert.equal(r.data.valueAfter, 2)
    assert.equal(r.data.statusAfter, 'ON_TRACK')
    let my = await a.get(`/api/okr/my?week=${WK}`)
    let k = krOf(my.data.objectives, 'KR-M 华丰三阶段')
    assert.equal(k.currentValue, 2)
    assert.equal(Math.round(k.progress * 100) / 100, 0.67)
    assert.deepEqual(k.milestones.map(m => m.done), [true, true, false], 'done 由服务器按已完成阶段数回写')

    const r2 = await a.patch(`/api/okr/krs/${km.id}`, { currentValue: 3 })
    assert.equal(r2.code, 0, r2.message)
    assert.equal(r2.data.statusAfter, 'DONE')
    my = await a.get(`/api/okr/my?week=${WK}`)
    k = krOf(my.data.objectives, 'KR-M 华丰三阶段')
    assert.equal(k.status, 'DONE')
    assert.equal(k.progress, 1)
    assert.deepEqual(k.milestones.map(m => m.done), [true, true, true])
  })

  test('1b. MILESTONE complete: done:false → 只改 MISSED 不动阶段; done:true → 全部阶段完成、DONE', async () => {
    const k2 = krOf(aObjs, 'KR-M2 两阶段')
    assert.equal((await a.patch(`/api/okr/krs/${k2.id}`, { currentValue: 1 })).code, 0)
    const miss = await a.post(`/api/okr/krs/${k2.id}/complete`, { done: false })
    assert.equal(miss.code, 0, miss.message)
    assert.equal(miss.data.kr.status, 'MISSED')
    assert.equal(miss.data.kr.currentValue, 1, '阶段不动')
    assert.deepEqual(miss.data.kr.milestones.map(m => m.done), [true, false])

    const done = await a.post(`/api/okr/krs/${k2.id}/complete`, { done: true })
    assert.equal(done.code, 0, done.message)
    assert.equal(done.data.kr.status, 'DONE')
    assert.equal(done.data.kr.currentValue, 2)
    assert.deepEqual(done.data.kr.milestones.map(m => m.done), [true, true])
    assert.equal(done.data.objective.status, 'DONE', 'O1 两条阶段型 KR 都完成 → O DONE')
  })

  // ---------------------------------------------------------------- 2. 越界

  test('2. MILESTONE 越界: 完成 4 个(>3)→ 400; 小数 → 400; 建档 targetValue=0 → 400', async () => {
    const km = krOf(aObjs, 'KR-M 华丰三阶段')
    const r = await a.patch(`/api/okr/krs/${km.id}`, { currentValue: 4 })
    assert.equal(r.status, 400)
    assert.equal(r.code, 8104)
    assert.match(r.message, /0–3 的整数/)
    const r2 = await a.patch(`/api/okr/krs/${km.id}`, { currentValue: 1.5 })
    assert.equal(r2.status, 400)
    const k = krOf((await a.get(`/api/okr/my?week=${WK}`)).data.objectives, 'KR-M 华丰三阶段')
    assert.equal(k.currentValue, 3, '越界请求不落库')

    const z = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ title: 'unit-test-v6 E-零阶段', keyResults: [{ title: 'k', metricType: 'MILESTONE', targetValue: 0 }] }] })
    assert.equal(z.status, 400)
    assert.equal(z.code, 8102)
    const over = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ title: 'unit-test-v6 E-建档越界', keyResults: [{ title: 'k', metricType: 'MILESTONE', targetValue: 3, currentValue: 4 }] }] })
    assert.equal(over.status, 400)
    assert.equal(over.code, 8104)
    const mismatch = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ title: 'unit-test-v6 E-对不上', keyResults: [{ title: 'k', metricType: 'MILESTONE', targetValue: 3, milestones: [{ name: 'x' }] }] }] })
    assert.equal(mismatch.status, 400)
    assert.equal((await prisma.okrObjective.count({ where: { ownerId: BigInt(E.id) } })), 0, '被拒的计划一条都没写')
  })

  // ---------------------------------------------------------------- 3. 阶段逾期

  test('3. 阶段逾期: 有阶段 dueDate 早于今天且未完成 → KR status=AT_RISK; 定时 tick 也会把时间流逝后逾期的 ON_TRACK 推成 AT_RISK', async () => {
    const r = await b.post(`/api/okr/plan?week=${WK}`, {
      objectives: [{ title: 'unit-test-v6 B-逾期阶段', keyResults: [{ title: 'KR-LATE', metricType: 'MILESTONE', milestones: [{ name: '早该交', dueDate: YESTERDAY }, { name: '以后', dueDate: TOMORROW }] }] }]
    })
    assert.equal(r.code, 0, r.message)
    const k = krOf(r.data.objectives, 'KR-LATE')
    assert.equal(k.status, 'AT_RISK')
    assert.equal(k.currentValue, 0)

    // 模拟「建档时还没逾期, 后来过了截止日」: 直接把状态改回 ON_TRACK, 跑一次 tick
    await prisma.okrKeyResult.update({ where: { id: BigInt(k.id) }, data: { status: 'ON_TRACK' } })
    const t = await boss.post('/api/okr/admin/blocker-tick?dryRun=1')
    assert.equal(t.code, 0, t.message)
    assert.ok(t.data.milestonesAtRisk >= 1)
    assert.equal((await prisma.okrKeyResult.findUnique({ where: { id: BigInt(k.id) } })).status, 'ON_TRACK', 'dryRun 不改')
    assert.equal((await boss.post('/api/okr/admin/blocker-tick')).code, 0)
    assert.equal((await prisma.okrKeyResult.findUnique({ where: { id: BigInt(k.id) } })).status, 'AT_RISK')
    // 清掉 B 的这份草稿, 后面 B 交自己的计划
    await b.post(`/api/okr/plan?week=${WK}`, { objectives: [] })
  })

  // ---------------------------------------------------------------- 4 / 5. 校验

  test('4. blockers 非空但缺 blockerOwnerId / blockerDueDate → 400 code 8120; 卡点人不存在 → 8120', async () => {
    const base = { title: 'unit-test-v6 E-卡点', keyResults: [{ title: 'k', metricType: 'BINARY' }] }
    for (const extra of [
      { blockers: '等甲方' },
      { blockers: '等甲方', blockerOwnerId: B.id },
      { blockers: '等甲方', blockerDueDate: TOMORROW }
    ]) {
      const r = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ ...base, ...extra }] })
      assert.equal(r.status, 400, JSON.stringify(extra))
      assert.equal(r.code, 8120)
      assert.equal(r.message, '填了卡点就要写清卡在谁、什么时候要')
    }
    const bad = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ ...base, blockers: '等甲方', blockerOwnerId: B.id, blockerDueDate: '2026-02-30' }] })
    assert.equal(bad.code, 8120)
    const ghost = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ ...base, blockers: '等甲方', blockerOwnerId: '999999999999', blockerDueDate: TOMORROW }] })
    assert.equal(ghost.status, 400)
    assert.equal(ghost.code, 8120)
    assert.equal((await prisma.okrObjective.count({ where: { ownerId: BigInt(E.id) } })), 0)
  })

  test('5. riskLevel 非白名单 → 400; /team 每行与每个 O 带 riskLevel', async () => {
    const r = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ title: 'unit-test-v6 E-风险', riskLevel: 'CRITICAL', keyResults: [{ title: 'k' }] }] })
    assert.equal(r.status, 400)
    assert.match(r.message, /LOW \/ MEDIUM \/ HIGH/)
    const low = await e.post(`/api/okr/plan?week=${WK}`, { objectives: [{ title: 'unit-test-v6 E-风险', riskLevel: 'low', keyResults: [{ title: 'k' }] }] })
    assert.equal(low.status, 400, '小写也不认')

    const team = await boss.get(`/api/okr/team?week=${WK}`)
    assert.equal(team.code, 0, team.message)
    const row = team.data.rows.find(x => x.user.id === A.id)
    assert.ok(row, '/team 里有 A')
    assert.equal(row.riskLevel, 'HIGH', '行 = 这人最高风险')
    assert.equal(row.blockerCount, 2)
    assert.equal(row.blockerOverdueCount, 1)
    const byTitle = Object.fromEntries(row.objectives.map(o => [o.title, o]))
    assert.equal(byTitle[O1].riskLevel, 'MEDIUM')
    assert.equal(byTitle[O2].riskLevel, 'LOW')
    assert.equal(byTitle[O3].riskLevel, 'HIGH')
    assert.equal(byTitle[O3].blocker.ownerName, B.name)
  })

  // ---------------------------------------------------------------- 6. 卡点逾期

  test('6. blocker 逾期: O 未 DONE + dueDate 昨天 → overdue=true(/my /team /by-project /person overview); 明天的 / 已 DONE 的 → false', async () => {
    const my = await a.get(`/api/okr/my?week=${WK}`)
    const o3 = my.data.objectives.find(o => o.title === O3)
    assert.deepEqual(o3.blocker, { text: '技术工艺 11/24 前必出模板, 否则全线顺延', ownerId: B.id, ownerName: B.name, dueDate: YESTERDAY, overdue: true })
    assert.equal(my.data.objectives.find(o => o.title === O1).blocker.overdue, false, '明天截止不算逾期')

    // B: 卡点在 A、昨天截止, 但 O 已完成 → 不算逾期
    const s = await b.post(`/api/okr/plan/submit?week=${WK}`, {
      objectives: [{ title: 'unit-test-v6 B-O1', blockers: '等 A 的接口', blockerOwnerId: A.id, blockerDueDate: YESTERDAY, keyResults: [{ title: 'KR-B', metricType: 'BINARY' }] }]
    })
    assert.equal(s.code, 0, s.message)
    bObj = s.data.objectives[0]
    assert.equal(bObj.blocker.overdue, true, '还没完成时是逾期的')
    const c = await b.post(`/api/okr/krs/${bObj.keyResults[0].id}/complete`, { done: true })
    assert.equal(c.data.objective.status, 'DONE')
    const bm = await b.get(`/api/okr/my?week=${WK}`)
    assert.equal(bm.data.objectives[0].blocker.overdue, false, 'O DONE 后不算逾期')

    const groups = await boss.get(`/api/okr/by-project?week=${WK}`)
    assert.equal(groups.code, 0, groups.message)
    const flat = groups.data.flatMap(g => g.objectives)
    const g3 = flat.find(o => o.id === o3.id)
    assert.equal(g3.riskLevel, 'HIGH')
    assert.equal(g3.blocker.overdue, true)
    const unassigned = groups.data.find(g => g.project.id === null)
    assert.equal(unassigned.riskLevel, 'HIGH', '组汇总带最高风险')
    assert.ok(unassigned.blockerOverdueCount >= 1)

    // 个人概览按「当前周」取, 这里把 now 放进测试周里直接调服务
    const ov = await personOverview(A.id, { now: new Date(WEEK_START.getTime() + 2 * 24 * 3600 * 1000) })
    assert.equal(ov.current.week, WK)
    assert.equal(ov.current.riskLevel, 'HIGH')
    assert.equal(ov.current.blockerCount, 2)
    const ov3 = ov.current.objectives.find(o => o.title === O3)
    assert.equal(ov3.blocker.ownerName, B.name)
    // 接口形状: 当前真实周没有 O, 字段照样在
    const api0 = await boss.get(`/api/okr/person/${A.id}/overview`)
    assert.equal(api0.code, 0, api0.message)
    assert.ok('riskLevel' in api0.data.current && Array.isArray(api0.data.current.objectives))
  })

  test('6b. 老调用方整份覆盖计划(不传 blockers / riskLevel / milestones)→ 卡点、风险、阶段明细都保留', async () => {
    const my = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives
    const r = await a.post(`/api/okr/plan?week=${WK}`, {
      objectives: my.map(o => ({
        id: o.id, title: o.title, weight: o.weight,
        keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, targetValue: k.targetValue, unit: k.unit, weight: k.weight }))
      }))
    })
    assert.equal(r.code, 0, r.message)
    const o3 = r.data.objectives.find(o => o.title === O3)
    assert.equal(o3.riskLevel, 'HIGH')
    assert.equal(o3.blocker.ownerId, B.id)
    const km = krOf(r.data.objectives, 'KR-M 华丰三阶段')
    assert.equal(km.milestones.length, 3)
    assert.equal(km.status, 'DONE')
    assert.equal(km.blockers, '模板没出就联调不了')
  })

  // ---------------------------------------------------------------- 7. 提醒

  test('7. 到期提醒 tick: 昨天截止的 O3 → 负责人 A + 卡点人 B 各一条; 再调一次不重复; O 已 DONE 的不发; 非 ADMIN 403', async () => {
    const o3 = aObjs.find(o => o.title === O3)
    const deny = await a.post('/api/okr/admin/blocker-tick')
    assert.equal(deny.status, 403)

    const t1 = await boss.post('/api/okr/admin/blocker-tick')
    assert.equal(t1.code, 0, t1.message)
    assert.equal(t1.data.date, TODAY)
    let notes = await dueNotes(o3.id)
    assert.deepEqual(notes.map(n => String(n.userId)).sort(), [A.id, B.id].sort(), '负责人 + 卡点人各一条')
    const d = JSON.parse(notes[0].data)
    assert.equal(d.key, `okrBlockerDue:${o3.id}:${TODAY}`)
    assert.equal(d.dueDate, YESTERDAY)

    const t2 = await boss.post('/api/okr/admin/blocker-tick')
    assert.equal(t2.code, 0)
    notes = await dueNotes(o3.id)
    assert.equal(notes.length, 2, '同一 O 同一天只发一次')
    assert.ok(!t2.data.items.find(i => i.objectiveId === o3.id).notify.length)

    assert.equal((await dueNotes(bObj.id)).length, 0, 'O 已 DONE 不发')
    assert.equal((await dueNotes(aObjs.find(o => o.title === O1).id)).length, 0, '明天截止的不发')
  })

  test('8. 免提交名单里的人的 O 到期 → 不发通知(负责人与卡点人都不发)', async () => {
    unlock = await acquireTestLock('okr-exempt')
    let eObj
    try {
      await setExemptMember(E.id, true)
      const r = await e.post(`/api/okr/plan/submit?week=${WK}`, {
        objectives: [{ title: 'unit-test-v6 E-O1', blockers: '等 B', blockerOwnerId: B.id, blockerDueDate: YESTERDAY, keyResults: [{ title: 'KR-E', metricType: 'BINARY' }] }]
      })
      assert.equal(r.code, 0, r.message)
      eObj = r.data.objectives[0]
      const t = await boss.post('/api/okr/admin/blocker-tick')
      assert.equal(t.code, 0, t.message)
      assert.ok(t.data.skippedExempt >= 1)
      assert.equal((await dueNotes(eObj.id)).length, 0)
      assert.equal(await prisma.notification.count({ where: { userId: BigInt(E.id), type: BLOCKER_DUE_TYPE } }), 0)
    } finally {
      // 先清掉 E 的卡点再解锁: 别的用例跑 tick 时 E 已不在名单里
      if (eObj) await prisma.okrObjective.update({ where: { id: BigInt(eObj.id) }, data: { blockers: null, blockerOwnerId: null, blockerDueDate: null } })
      await setExemptMember(E.id, false)
      unlock()
      unlock = null
    }
  })

  // ---------------------------------------------------------------- 9. 回归

  test('9. 回归: BINARY / PERCENT / NUMBER 行为不变', async () => {
    const bin = krOf(aObjs, 'KR-BIN 上线')
    const pct = krOf(aObjs, 'KR-PCT 覆盖率')
    const num = krOf(aObjs, 'KR-NUM 客户数')
    // BINARY: 值只能 0/1, 完成 → 值 1 + DONE
    assert.equal((await a.patch(`/api/okr/krs/${bin.id}`, { currentValue: 2 })).code, 8104)
    const cb = await a.post(`/api/okr/krs/${bin.id}/complete`, { done: true })
    assert.equal(cb.data.kr.currentValue, 1)
    assert.equal(cb.data.kr.status, 'DONE')
    assert.equal(cb.data.kr.milestones, null)
    // PERCENT: 40 → 进度 0.4, 状态不变
    const pp = await a.patch(`/api/okr/krs/${pct.id}`, { currentValue: 40 })
    assert.equal(pp.data.valueAfter, 40)
    assert.equal(pp.data.statusAfter, 'ON_TRACK')
    // NUMBER: 小数可以、超过目标值可以(进度封顶 1); done:false → MISSED 值不动
    const np = await a.patch(`/api/okr/krs/${num.id}`, { currentValue: 3.5 })
    assert.equal(np.code, 0, np.message)
    assert.equal(np.data.valueAfter, 3.5)
    const nm = await a.post(`/api/okr/krs/${num.id}/complete`, { done: false })
    assert.equal(nm.data.kr.status, 'MISSED')
    assert.equal(nm.data.kr.currentValue, 3.5)
    const over = await a.patch(`/api/okr/krs/${num.id}`, { currentValue: 12, status: 'ON_TRACK' })
    assert.equal(over.code, 0)
    const my = await a.get(`/api/okr/my?week=${WK}`)
    assert.equal(krOf(my.data.objectives, 'KR-PCT 覆盖率').progress, 0.4)
    assert.equal(krOf(my.data.objectives, 'KR-NUM 客户数').progress, 1)
    const nd = await a.post(`/api/okr/krs/${num.id}/complete`, { done: true })
    assert.equal(nd.data.kr.currentValue, 10, 'NUMBER 完成 → 值 = 目标值')
  })
})
