// 集成测试 - OKR 第三轮(后端): KR 完成开关 / 自评不限时 / 主管评分后归档 / OKR 免提交白名单
//
// 用远期测试周(2061–2069 年随机几周, 与 okr / okr-proxy / okr-backfill 的年份错开, 并行跑互不清理对方的周期);
// 「周日之后」用 2020–2023 年一个真正过完的周。周期状态直接改库模拟。账号现建现删。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, acquireTestLock, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'
import { okrMondayReminder } from '../../src/services/okr.js'
import { EXEMPT_KEY } from '../../src/services/okrExempt.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2061, 2069)
const PAST = { year: rnd(2020, 2023), weekNo: rnd(2, 50) }
const BASE_NO = rnd(2, 40)
const W = n => ({ year: YEAR, weekNo: BASE_NO + n })
const createdCycles = []

async function makeCycle(week, data = {}) {
  const { start, end } = weekRange(week.year, week.weekNo)
  const c = await prisma.okrCycle.upsert({
    where: { year_weekNo: { year: week.year, weekNo: week.weekNo } },
    update: data,
    create: { year: week.year, weekNo: week.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS', ...data }
  })
  createdCycles.push(c.id)
  return c
}

const setStatus = (week, status, extra = {}) =>
  prisma.okrCycle.update({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } }, data: { status, ...extra } })

async function dropCycles(ids) {
  const where = { cycleId: { in: ids } }
  const oids = (await prisma.okrObjective.findMany({ where, select: { id: true } })).map(o => o.id)
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await dropPlanTrail(ids)
  await prisma.okrCycle.deleteMany({ where: { id: { in: ids } } })
}

// 每个 O: KR1 数值型(目标 4) + KR2 是/否型
const plan = (n = 2, tag = '') => Array.from({ length: n }, (_, i) => ({
  title: `unit-test-v3${tag}-O${i + 1}`,
  keyResults: [
    { title: `O${i + 1}-KR1 交付件数`, metricType: 'NUMBER', targetValue: 4, unit: '个' },
    { title: `O${i + 1}-KR2 上线`, metricType: 'BINARY' }
  ]
}))

describe('OKR 3.0 /api/okr', () => {
  let A, B, O, a, b, boss

  before(async () => {
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v3-A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v3-B' })
    O = await createTestUser('ADMIN', { name: 'unit-test-v3-老板' })
    a = api(A.token); b = api(B.token); boss = api(O.token)
  })

  after(async () => {
    await dropCycles(createdCycles)
    for (const u of [A, B, O]) await u?.cleanup()
  })

  /** 在某周给 who 提交一份计划, 返回 O 列表 */
  async function submitted(who, week, n = 2, tag = '') {
    await makeCycle(week)
    const r = await who.post(`/api/okr/plan/submit?week=${weekKey(week)}`, { objectives: plan(n, tag) })
    assert.equal(r.code, 0, r.message)
    return r.data.objectives
  }

  describe('KR 完成开关 POST /krs/:id/complete', () => {
    const WK1 = W(0)
    let objs

    before(async () => { objs = await submitted(a, WK1, 1) })

    test('done:true → BINARY 值 1 / DONE; 数值型值拉到目标值; done:false → MISSED 且当前值不动', async () => {
      const [num, bin] = objs[0].keyResults
      const r1 = await a.post(`/api/okr/krs/${bin.id}/complete`, { done: true })
      assert.equal(r1.code, 0, r1.message)
      assert.equal(r1.data.kr.status, 'DONE')
      assert.equal(r1.data.kr.currentValue, 1)
      assert.equal(r1.data.objective.id, objs[0].id)
      assert.equal(r1.data.objective.progress, 0.5, '两条 KR 各 50 权重, 完成一条 → 0.5')

      const p = await a.patch(`/api/okr/krs/${num.id}`, { currentValue: 2 })
      assert.equal(p.code, 0, p.message)
      const r2 = await a.post(`/api/okr/krs/${num.id}/complete`, { done: false })
      assert.equal(r2.code, 0, r2.message)
      assert.equal(r2.data.kr.status, 'MISSED')
      assert.equal(r2.data.kr.currentValue, 2, '未完成不清空进度')
      assert.equal(r2.data.objective.progress, 0.75)

      const r3 = await a.post(`/api/okr/krs/${num.id}/complete`, { done: true })
      assert.equal(r3.data.kr.status, 'DONE')
      assert.equal(r3.data.kr.currentValue, 4)
      assert.equal(r3.data.objective.status, 'DONE', 'KR 全部完成 → O 自动 DONE')
      assert.equal(r3.data.completion, 1)

      assert.equal((await a.post(`/api/okr/krs/${num.id}/complete`, { done: 'yes' })).status, 400)
      assert.equal((await b.post(`/api/okr/krs/${num.id}/complete`, { done: true })).status, 403, '不能改别人的 KR')
      const u = await prisma.okrUpdate.findFirst({ where: { krId: BigInt(num.id) }, orderBy: { id: 'desc' } })
      assert.equal(u.statusAfter, 'DONE', '留进展记录')
    })

    test('已归档的周调 complete → 403, 文案只读', async () => {
      await setStatus(WK1, 'CLOSED', { closedAt: new Date() })
      const r = await a.post(`/api/okr/krs/${objs[0].keyResults[1].id}/complete`, { done: false })
      assert.equal(r.status, 403)
      assert.match(r.message, /只读/)
    })
  })

  describe('自评不限时, KR 处理完才能交', () => {
    const WK2 = W(1)
    let objs

    before(async () => {
      await makeCycle(WK2)
      // O1: 数值型 + 是/否型; O2: 百分比型 + 是/否型
      const objectives = [
        plan(1)[0],
        { title: 'unit-test-v3-O2', keyResults: [{ title: 'O2-KR1 覆盖率', metricType: 'PERCENT', targetValue: 100 }, { title: 'O2-KR2 评审', metricType: 'BINARY' }] }
      ]
      const r = await b.post(`/api/okr/plan/submit?week=${weekKey(WK2)}`, { objectives })
      assert.equal(r.code, 0, r.message)
      objs = r.data.objectives
    })

    test('还有 KR 没标完成/未完成 → 400 8112, 点名缺哪条', async () => {
      await b.post(`/api/okr/krs/${objs[0].keyResults[1].id}/complete`, { done: true }) // O1-KR2 完成
      // 只挂在 KR 上的文字进展不算「填了进度」
      await b.post(`/api/okr/objectives/${objs[1].id}/updates`, { content: '看了一下', krId: objs[1].keyResults[0].id })
      const r = await b.post('/api/okr/self-score', { objectiveId: objs[0].id, score: 80 })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8112)
      assert.equal(r.message, '还有 3 条 KR 没有标记完成或未完成：O1-KR1、O2-KR1、O2-KR2')
      assert.equal(await prisma.okrScore.count({ where: { objectiveId: BigInt(objs[0].id) } }), 0, '被拦下不留评分')
    })

    test('全部标成 DONE / MISSED(含 MISSED + 进度 50) → 200', async () => {
      await b.post(`/api/okr/krs/${objs[0].keyResults[0].id}/complete`, { done: true })
      assert.equal((await b.patch(`/api/okr/krs/${objs[1].keyResults[0].id}`, { currentValue: 50 })).code, 0)
      const miss = await b.post(`/api/okr/krs/${objs[1].keyResults[0].id}/complete`, { done: false })
      assert.equal(miss.data.kr.status, 'MISSED')
      assert.equal(miss.data.kr.currentValue, 50)
      await b.post(`/api/okr/krs/${objs[1].keyResults[1].id}/complete`, { done: false })
      for (const [o, score] of [[objs[0], 90], [objs[1], 60]]) {
        const r = await b.post('/api/okr/self-score', { objectiveId: o.id, score })
        assert.equal(r.code, 0, r.message)
      }
    })

    test('数值型记过进度(状态 ON_TRACK)也算处理完; 计划阶段(PLANNING)也能自评', async () => {
      const w = W(2)
      await makeCycle(w, { status: 'PLANNING' })
      const r0 = await a.post(`/api/okr/plan/submit?week=${weekKey(w)}`, { objectives: [{ title: 'unit-test-v3-进度', keyResults: [{ title: '件数', metricType: 'NUMBER', targetValue: 4 }] }] })
      assert.equal(r0.code, 0, r0.message)
      const o = r0.data.objectives[0]
      assert.equal((await a.post('/api/okr/self-score', { objectiveId: o.id, score: 50 })).code, 8112)
      await a.patch(`/api/okr/krs/${o.keyResults[0].id}`, { currentValue: 2 })
      const r = await a.post('/api/okr/self-score', { objectiveId: o.id, score: 50 })
      assert.equal(r.code, 0, r.message)
    })

    test('周日之后、周期仍在 REVIEW → 自评 200(不再卡时间, 也不会被时间推成 CLOSED)', async () => {
      await makeCycle(PAST, { status: 'REVIEW' })
      const sub = await a.post(`/api/okr/plan/submit?week=${weekKey(PAST)}`, { objectives: plan(1, '-past') })
      assert.equal(sub.code, 0, sub.message)
      assert.equal(sub.data.cycle.status, 'REVIEW')
      const o = sub.data.objectives[0]
      for (const k of o.keyResults) assert.equal((await a.post(`/api/okr/krs/${k.id}/complete`, { done: true })).code, 0, '复盘里也能标 KR')
      const r = await a.post('/api/okr/self-score', { objectiveId: o.id, score: 88 })
      assert.equal(r.code, 0, r.message)
      const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: PAST.year, weekNo: PAST.weekNo } } })
      assert.equal(c.status, 'REVIEW')
      const view = await a.get(`/api/okr/cycle?week=${weekKey(PAST)}`)
      assert.equal(view.data.can.selfScore, true)
      assert.equal(view.data.can.progress, true)
    })
  })

  describe('主管评分不限时, 评完一键归档', () => {
    const WK3 = W(3)
    let oa, ob

    before(async () => {
      oa = await submitted(a, WK3, 1, '-score')
      ob = await submitted(b, WK3, 1, '-score')
      await setStatus(WK3, 'PLANNING') // 计划期(周一)也能评, 不卡时间
    })

    async function selfScore(who, o, score) {
      for (const k of o.keyResults) await who.post(`/api/okr/krs/${k.id}/complete`, { done: true })
      const r = await who.post('/api/okr/self-score', { objectiveId: o.id, score })
      assert.equal(r.code, 0, r.message)
    }

    test('员工没交自评 → 主管评分 409 拒绝; 交了自评 → 200', async () => {
      const r1 = await boss.post('/api/okr/manager-score', { objectiveId: oa[0].id, score: 80 })
      assert.equal(r1.status, 409)
      assert.equal(r1.code, 8115)
      assert.match(r1.message, /还没交自评/)
      await selfScore(a, oa[0], 85)
      const r2 = await boss.post('/api/okr/manager-score', { objectiveId: oa[0].id, score: 80, comment: 'unit-test-v3' })
      assert.equal(r2.code, 0, r2.message)
    })

    test('close-by-score: 有 O 没打主管分 → 400 列出缺项, 周期不动', async () => {
      const r = await boss.post('/api/okr/cycle/close-by-score', { week: weekKey(WK3) })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8116)
      assert.match(r.message, /还有 1 个 O 没有主管评分/)
      assert.ok(r.message.includes('unit-test-v3-B O1「unit-test-v3-score-O1」'), r.message)
      assert.deepEqual(r.raw.data.missing.map(m => m.objectiveId), [ob[0].id])
      const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: WK3.year, weekNo: WK3.weekNo } } })
      assert.equal(c.status, 'PLANNING')
      // 工程师 / 助手不能调
      assert.equal((await b.post('/api/okr/cycle/close-by-score', { week: weekKey(WK3) })).status, 403)
    })

    test('全部评完 → CLOSED(记 closedAt/closedBy + 审计); 之后 PATCH /krs、complete、/self-score、主管分一律只读', async () => {
      await selfScore(b, ob[0], 70)
      assert.equal((await boss.post('/api/okr/manager-score', { objectiveId: ob[0].id, score: 75 })).code, 0)
      const r = await boss.post('/api/okr/cycle/close-by-score', { week: weekKey(WK3) })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.status, 'CLOSED')
      assert.equal(r.data.changed, true)
      assert.equal(r.data.scored, 2)
      assert.equal(r.data.closedBy, O.id)
      const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: WK3.year, weekNo: WK3.weekNo } } })
      assert.equal(c.status, 'CLOSED')
      assert.ok(c.closedAt)
      const audit = await prisma.auditLog.findFirst({ where: { action: 'okr.cycle.close-by-score', resourceId: c.id }, orderBy: { id: 'desc' } })
      assert.ok(audit, '归档留审计')

      const kr = oa[0].keyResults[0]
      const p = await a.patch(`/api/okr/krs/${kr.id}`, { currentValue: 1 })
      assert.equal(p.status, 403)
      assert.match(p.message, /只读/)
      assert.equal((await a.post(`/api/okr/krs/${kr.id}/complete`, { done: false })).status, 403)
      const s = await a.post('/api/okr/self-score', { objectiveId: oa[0].id, score: 10 })
      assert.equal(s.status, 403)
      assert.match(s.message, /只读/)
      assert.equal((await boss.post('/api/okr/manager-score', { objectiveId: oa[0].id, score: 10 })).status, 403)
      const again = await boss.post('/api/okr/cycle/close-by-score', { week: weekKey(WK3) })
      assert.equal(again.data.changed, false, '重复调用不报错')
      const view = await boss.get(`/api/okr/cycle?week=${weekKey(WK3)}&ownerId=${A.id}`)
      assert.equal(view.data.can.closeByScore, false)
      assert.equal(view.data.can.selfScore, false)
    })
  })
})

describe('OKR 免提交白名单 /api/okr/settings/exempt', () => {
  let A, X, O, a, x, boss, saved, unlock
  const WK = W(5)

  before(async () => {
    // 白名单是全局设置(共享库): 先存下原值, 只往里加本用例的人, 结束时原样还回去。
    // okr-v4 也会往里加人: 两边用同一把锁串行, 免得「原值」被对方改掉
    unlock = await acquireTestLock('okr-exempt')
    saved = await prisma.appSetting.findUnique({ where: { key: EXEMPT_KEY } })
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v3-要交的' })
    X = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v3-免提交' })
    O = await createTestUser('ADMIN', { name: 'unit-test-v3-管理员' })
    a = api(A.token); x = api(X.token); boss = api(O.token)
  })

  after(async () => {
    try {
      if (saved) await prisma.appSetting.update({ where: { key: EXEMPT_KEY }, data: { value: saved.value, updatedBy: saved.updatedBy } })
      else await prisma.appSetting.deleteMany({ where: { key: EXEMPT_KEY } })
      await dropCycles(createdCycles)
      for (const u of [A, X, O]) await u?.cleanup()
    } finally {
      unlock?.()
    }
  })

  const current = async () => (await boss.get('/api/okr/settings/exempt')).data.userIds

  test('PUT 不存在的 userId → 400; 非 ADMIN → 403; 合法 → GET 一致, 写审计', async () => {
    const before = await current()
    const bad = await boss.put('/api/okr/settings/exempt', { userIds: [...before, '999999999'] })
    assert.equal(bad.status, 400)
    assert.equal(bad.code, 8141)
    assert.match(bad.message, /999999999/)
    assert.equal((await boss.put('/api/okr/settings/exempt', { userIds: 'x' })).status, 400)
    assert.equal((await boss.put('/api/okr/settings/exempt', { userIds: Array.from({ length: 51 }, (_, i) => String(i + 1)) })).status, 400, '最多 50 人')
    assert.equal((await a.put('/api/okr/settings/exempt', { userIds: [X.id] })).status, 403)
    assert.deepEqual(await current(), before, '失败的请求不改名单')

    const want = [...before, X.id]
    const r = await boss.put('/api/okr/settings/exempt', { userIds: [...want, X.id] }) // 重复 id 去重
    assert.equal(r.code, 0, r.message)
    assert.deepEqual(r.data.userIds, want)
    const g = await a.get('/api/okr/settings/exempt')
    assert.equal(g.code, 0, '登录可读')
    assert.deepEqual(g.data.userIds, want)
    const u = g.data.users.find(v => v.id === X.id)
    assert.deepEqual(u, { id: X.id, name: 'unit-test-v3-免提交', username: X.username, role: 'FDE_ENGINEER' })
    const audit = await prisma.auditLog.findFirst({ where: { action: 'okr.settings.exempt', userId: BigInt(O.id) }, orderBy: { id: 'desc' } })
    assert.ok(audit, '写审计')
    assert.deepEqual(audit.details.added, [X.id])
    assert.deepEqual(audit.details.removed, [])
  })

  test('白名单生效: 不出现在 /team 列表与汇总; /stats(年/周)与个人概览按没参与返回(exempt=true)', async () => {
    await makeCycle(WK)
    for (const who of [a, x]) {
      const r = await who.post(`/api/okr/plan/submit?week=${weekKey(WK)}`, { objectives: plan(1, '-exempt') })
      assert.equal(r.code, 0, r.message)
    }
    const t = await boss.get(`/api/okr/team?week=${weekKey(WK)}`)
    assert.equal(t.code, 0, t.message)
    assert.ok(t.data.rows.some(r => r.user.id === A.id), '不在名单的人照常出现')
    assert.ok(!t.data.rows.some(r => r.user.id === X.id), '免提交的人不出现(即使他自己交了)')
    assert.equal(t.data.summary.expected, t.data.rows.length)

    const ys = await boss.get(`/api/okr/stats?scope=year&year=${YEAR}&userId=${X.id}`)
    assert.equal(ys.code, 0, ys.message)
    assert.equal(ys.data.exempt, true)
    assert.deepEqual(ys.data.weeks, [])
    assert.equal(ys.data.summary.weeksParticipated, 0)
    assert.equal(ys.data.summary.lateWeeks, 0)
    const ya = await boss.get(`/api/okr/stats?scope=year&year=${YEAR}&userId=${A.id}`)
    assert.equal(ya.data.exempt, false)
    assert.ok(ya.data.weeks.some(w => w.key === weekKey(WK)), '对照: 不在名单的人有这一周')
    const ws = await boss.get(`/api/okr/stats?scope=week&week=${weekKey(WK)}&userId=${X.id}`)
    assert.deepEqual(ws.data.objectives, [])
    assert.equal(ws.data.summary.late, false)
    const ov = await boss.get(`/api/okr/person/${X.id}/overview`)
    assert.equal(ov.code, 0, ov.message)
    assert.equal(ov.data.exempt, true)
    assert.equal(ov.data.current.lateCount, 0)
    assert.deepEqual(ov.data.years, [])

    // 他交的 OKR 照常记录, 自己的页面能看到, 并标 exempt
    const mine = await x.get(`/api/okr/my?week=${weekKey(WK)}`)
    assert.equal(mine.data.objectives.length, 1)
    assert.equal(mine.data.exempt, true)
  })

  test('白名单不计迟交提醒: 周一 10:00 未提交名单里没有他', async () => {
    const RW = W(6)
    await makeCycle(RW, { status: 'PLANNING' })
    const monday10 = new Date(weekRange(RW.year, RW.weekNo).start.getTime() + 10.5 * 3600 * 1000)
    const r = await okrMondayReminder(monday10, { dryRun: true })
    assert.equal(r.week, weekKey(RW))
    assert.ok(r.missing.includes('unit-test-v3-要交的'))
    assert.ok(!r.missing.includes('unit-test-v3-免提交'))
  })

  test('白名单不影响登录与查看他人: 他调 /team、看别人 OKR 仍 200', async () => {
    const t = await x.get(`/api/okr/team?week=${weekKey(WK)}`)
    assert.equal(t.status, 200)
    assert.equal(t.code, 0)
    const other = await x.get(`/api/okr/cycle?week=${weekKey(WK)}&ownerId=${A.id}`)
    assert.equal(other.status, 200)
    assert.equal(other.data.owner.id, A.id)
    assert.equal(other.data.exempt, false)
  })
})
