// 集成测试 - 周 OKR 补录: 任意周(本年第 1 周 ~ 下周)都能新建 / 补录自己的 OKR
//
// 补录窗口挂在「真实的当前周」上, 所以接口层的用例只能用本年真实的过去周: 运行时挑本年里还没有周期的
// 最近 3 个过去周(一般就是上上上周 ~ 上周), 用现建现删的测试账号写; 收尾只删测试账号自己的 O,
// 周期只在是本测试新建、且里面没有别人的 O 时才删 —— 不碰共享库里别人的数据。
// 可注入时间的规则(跨年、并发首建)在服务层用远期年份(2071–2079)做。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey, shiftWeek, isoWeekOf } from '../../src/services/okrRules.js'
import { getCycle, savePlan, personWeek } from '../../src/services/okr.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))

const plan = (n = 1) => Array.from({ length: n }, (_, i) => ({
  title: `unit-test-补录-O${i + 1}`,
  keyResults: [
    { title: `O${i + 1}-KR1 交付件数`, metricType: 'NUMBER', targetValue: 4, unit: '个' },
    { title: `O${i + 1}-KR2 上线`, metricType: 'BINARY' }
  ]
}))

const createdCycles = new Set()
const testOwners = []

/** 只删测试账号的 O(及其 KR/进展/评分/未达成); 周期是本测试建的且已空才删 */
async function cleanup() {
  const owners = testOwners.map(id => BigInt(id))
  const objs = await prisma.okrObjective.findMany({ where: { ownerId: { in: owners } }, select: { id: true } })
  const oids = objs.map(o => o.id)
  if (oids.length) {
    await prisma.okrUpdate.deleteMany({ where: { objectiveId: { in: oids } } })
    await prisma.okrScore.deleteMany({ where: { objectiveId: { in: oids } } })
    await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
    await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
    await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  }
  for (const id of createdCycles) {
    const left = await prisma.okrObjective.count({ where: { cycleId: id } })
    if (!left) { await dropPlanTrail([id]); await prisma.okrCycle.deleteMany({ where: { id } }) }
  }
}

async function cycleOf(week) {
  return prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
}

/** 本年里最近的 n 个还没有周期的过去周(从上周往回找) */
async function freePastWeeks(n) {
  const cur = isoWeekOf()
  const out = []
  for (let w = shiftWeek(cur, -1); w.year === cur.year && out.length < n; w = shiftWeek(w, -1)) {
    if (!(await cycleOf(w))) out.push(w)
  }
  return out
}

describe('周 OKR 补录(接口, 本年真实的过去周)', () => {
  let A, B, O, a, b, boss
  let weeks = []
  let skipReason = ''

  before(async () => {
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-补录A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-补录B' })
    O = await createTestUser('ADMIN', { name: 'unit-test-补录老板' })
    testOwners.push(A.id, B.id, O.id)
    a = api(A.token); b = api(B.token); boss = api(O.token)
    // 4 个: 3 个给「过去 3 周补录」, 1 个给并发首建
    weeks = await freePastWeeks(4)
    if (weeks.length < 4) skipReason = `本年可用的空过去周不足 4 个(当前 ${weekKey(isoWeekOf())}), 跳过接口层补录用例`
  })

  after(async () => {
    await cleanup()
    for (const u of [A, B, O]) await u?.cleanup()
  })

  test('读过去的空周不偷偷建周期; 返回可补录 + 窗口', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = weeks[0]
    const r = await a.get(`/api/okr/cycle?week=${weekKey(w)}`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.cycle, null)
    assert.equal(r.data.backfill, true)
    assert.equal(r.data.can.create, true)
    assert.equal(r.data.can.proxy, false)
    assert.equal(r.data.owner.name, 'unit-test-补录A')
    const cur = isoWeekOf()
    assert.deepEqual(r.data.window, { from: weekKey({ year: cur.year, weekNo: 1 }), to: weekKey(shiftWeek(cur, 1)) })
    assert.equal(await cycleOf(w), null, '读接口不应建周期')
  })

  test('看别人的空周: 普通同事不能建; ADMIN 有代管权 → can.create + proxy', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = weekKey(weeks[0])
    const peer = await b.get(`/api/okr/cycle?week=${w}&userId=${A.id}`)
    assert.equal(peer.data.can.create, false)
    assert.equal(peer.data.can.proxy, false)
    assert.equal(peer.data.owner.name, 'unit-test-补录A')
    const adm = await boss.get(`/api/okr/cycle?week=${w}&userId=${A.id}`)
    assert.equal(adm.data.can.create, true)
    assert.equal(adm.data.can.proxy, true)
  })

  test('为过去 3 周建计划 → 全部成功, submission=LATE, backfilled=true', async (t) => {
    if (skipReason) return t.skip(skipReason)
    for (const w of weeks.slice(0, 3)) {
      const draft = await a.post(`/api/okr/plan?week=${weekKey(w)}`, { objectives: plan(1) })
      assert.equal(draft.code, 0, `${weekKey(w)} 草稿: ${draft.message}`)
      const c = await cycleOf(w)
      assert.ok(c, '写接口建了周期')
      createdCycles.add(c.id)
      assert.equal(c.status, 'IN_PROGRESS', '补录周期不会一建出来就被时间推成 CLOSED')
      assert.equal(draft.data.cycle.editable, true)
      assert.equal(draft.data.cycle.reopened, false, '系统为补录开放, 不显示「已重开」')
      assert.equal(draft.data.submission, 'NONE')

      const r = await a.post(`/api/okr/plan/submit?week=${weekKey(w)}`, { objectives: draft.data.objectives.map(o => ({ ...o, keyResults: o.keyResults })) })
      assert.equal(r.code, 0, `${weekKey(w)} 提交: ${r.message}`)
      assert.equal(r.data.submission, 'LATE')
      assert.equal(r.data.backfilled, true)
      assert.equal(r.data.cycle.backfilled, true)
      assert.equal(r.data.lateSubmit, true)
      assert.equal(r.data.objectives[0].lateSubmit, true)
    }
    // 读回来仍是可编辑的补录周(时间推进不会把它归档)
    const back = await a.get(`/api/okr/cycle?week=${weekKey(weeks[0])}`)
    assert.equal(back.data.cycle.status, 'IN_PROGRESS')
    assert.equal(back.data.cycle.backfilled, true)
    // 补录后可以记 KR 进展
    const kr = back.data.objectives[0].keyResults[0]
    const p = await a.patch(`/api/okr/krs/${kr.id}`, { currentValue: 2, note: 'unit-test 补录进展' })
    assert.equal(p.code, 0, p.message)
  })

  test('补录的周算进统计: stats?scope=year 与 person overview 参与周数 = 3', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const year = isoWeekOf().year
    const st = await a.get(`/api/okr/stats?scope=year&year=${year}`)
    assert.equal(st.code, 0, st.message)
    assert.equal(st.data.summary.weeksParticipated, 3)
    assert.equal(st.data.summary.lateWeeks, 3)
    assert.deepEqual(st.data.weeks.map(w => w.key).sort(), weeks.slice(0, 3).map(weekKey).sort())
    const ov = await boss.get(`/api/okr/person/${A.id}/overview`)
    assert.equal(ov.code, 0, ov.message)
    const y = ov.data.years.find(r => r.year === year)
    assert.ok(y, '概览里有本年')
    assert.equal(y.weeksParticipated, 3)
    assert.equal(ov.data.current.lateCount, 3)
    // 同事 B 没补录: 本年参与 0
    const sb = await b.get(`/api/okr/stats?scope=year&year=${year}`)
    assert.equal(sb.data.summary.weeksParticipated, 0)
  })

  test('补录周被主管归档后只读, 写接口返回原来的错误', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = weekKey(weeks[1])
    const c = await boss.post('/api/okr/cycle/close', { week: w })
    assert.equal(c.code, 0, c.message)
    assert.equal(c.data.status, 'CLOSED')
    for (const [who, path] of [[a, '/api/okr/plan'], [a, '/api/okr/plan/submit'], [b, '/api/okr/plan/submit']]) {
      const r = await who.post(`${path}?week=${w}`, { objectives: plan(1) })
      assert.equal(r.status, 403)
      assert.match(r.message, /已进入复盘或已归档/)
    }
    // 代管也一样
    const px = await boss.post(`/api/okr/plan/submit?week=${w}`, { objectives: plan(1), targetUserId: B.id })
    assert.equal(px.status, 403)
  })

  test('同一周并发首建两次 → 只有一个周期, 两次都成功', async (t) => {
    if (skipReason) return t.skip(skipReason)
    const w = weeks[3]
    const [r1, r2] = await Promise.all([
      a.post(`/api/okr/plan/submit?week=${weekKey(w)}`, { objectives: plan(1) }),
      b.post(`/api/okr/plan/submit?week=${weekKey(w)}`, { objectives: plan(1) })
    ])
    const c = await cycleOf(w)
    if (c) createdCycles.add(c.id)
    assert.equal(r1.code, 0, r1.message)
    assert.equal(r2.code, 0, r2.message)
    assert.equal(r1.data.cycle.id, r2.data.cycle.id)
    assert.equal(await prisma.okrCycle.count({ where: { year: w.year, weekNo: w.weekNo } }), 1)
  })

  test('未来第 3 周建计划 → 仍拒绝, 文案指明只到下周; 不留下周期', async () => {
    const w = shiftWeek(isoWeekOf(), 3)
    const existed = await cycleOf(w)
    const r = await a.post(`/api/okr/plan?week=${weekKey(w)}`, { objectives: plan(1) })
    if (existed) {
      // 共享库里有人(比如演示)提前建过这一周: 窗口检查只管新建, 这里没有可验证的
      return
    }
    assert.equal(r.status, 404)
    assert.match(r.message, /下周/)
    assert.match(r.message, /只能为 \d{4}-W01\(本年第一周\) ~ \d{4}-W\d{2}\(下周\) 之间的周新建或补录计划/)
    assert.equal(await cycleOf(w), null)
  })

  test('去年的周不能新建', async () => {
    const cur = isoWeekOf()
    const w = { year: cur.year - 1, weekNo: 10 }
    if (await cycleOf(w)) return
    const r = await a.post(`/api/okr/plan?week=${weekKey(w)}`, { objectives: plan(1) })
    assert.equal(r.status, 404)
    assert.match(r.message, /本年第一周/)
  })
})

describe('周 OKR 补录(服务层, 注入时间)', () => {
  const Y = rnd(2071, 2079)
  const NOW = new Date(weekRange(Y, 47).start.getTime() + 3 * 86400000 + 2 * 3600000) // Y-W47 周四 02:00(上海)
  let U, V
  const mine = []

  before(async () => {
    U = await createTestUser('FDE_ENGINEER', { name: 'unit-test-补录U' })
    V = await createTestUser('FDE_ENGINEER', { name: 'unit-test-补录V' })
    testOwners.push(U.id, V.id)
  })

  after(async () => {
    await cleanup()
    for (const id of mine) { await dropPlanTrail([id]); await prisma.okrCycle.deleteMany({ where: { id } }) }
    for (const u of [U, V]) await u?.cleanup()
  })

  const track = c => { mine.push(c.id); createdCycles.add(c.id); return c }

  test('W44/W45/W46 补录: LATE + backfilled; 周期是开放的 IN_PROGRESS', async () => {
    for (const n of [44, 45, 46]) {
      const week = { year: Y, weekNo: n }
      const { cycle, late } = await savePlan({ ownerId: U.id, week, objectives: plan(1), submit: true, now: NOW })
      track(cycle)
      assert.equal(late, true)
      assert.equal(cycle.status, 'IN_PROGRESS')
      const pw = await personWeek(cycle, U.id, { now: NOW })
      assert.equal(pw.submission, 'LATE')
      assert.equal(pw.backfilled, true)
      // 再按「当时之后」读(时间推进): 仍不被自动归档
      const again = await getCycle(week, { now: new Date(NOW.getTime() + 7 * 86400000) })
      assert.equal(again.status, 'IN_PROGRESS')
    }
    // 本周写的不是补录
    const cur = await savePlan({ ownerId: U.id, week: { year: Y, weekNo: 47 }, objectives: plan(1), now: NOW })
    track(cur.cycle)
    assert.equal((await personWeek(cur.cycle, U.id, { now: NOW })).backfilled, false)
  })

  test('下周可建; 第 3 周、去年都拒绝, 报错写明窗口', async () => {
    const next = await savePlan({ ownerId: U.id, week: { year: Y, weekNo: 48 }, objectives: plan(1), now: NOW })
    track(next.cycle)
    await assert.rejects(savePlan({ ownerId: U.id, week: { year: Y, weekNo: 50 }, objectives: plan(1), now: NOW }),
      e => e.status === 404 && e.message.includes(`${Y}-W01(本年第一周) ~ ${Y}-W48(下周)`))
    await assert.rejects(savePlan({ ownerId: U.id, week: { year: Y - 1, weekNo: 30 }, objectives: plan(1), now: NOW }), e => e.status === 404)
    assert.equal(await cycleOf({ year: Y, weekNo: 50 }), null)
  })

  test('并发首建(服务层): 10 个并发 getCycle → 同一个周期', async () => {
    const week = { year: Y, weekNo: 20 }
    const cs = await Promise.all(Array.from({ length: 10 }, () => getCycle(week, { create: true, now: NOW })))
    track(cs[0])
    assert.equal(new Set(cs.map(c => String(c.id))).size, 1)
    assert.equal(await prisma.okrCycle.count({ where: { year: Y, weekNo: 20 } }), 1)
  })

  test('周五复盘里: 一条没交的人可补交(记迟交), 交过之后计划只读; 交过的人不放开', async () => {
    const week = { year: Y, weekNo: 30 }
    const { start, end } = weekRange(Y, 30)
    track(await prisma.okrCycle.create({ data: { year: Y, weekNo: 30, startDate: start, endDate: end, status: 'REVIEW' } }))
    const SAT = new Date(start.getTime() + 5 * 86400000 + 3600000) // 那周周六: 时间上就是复盘期, 不会被推成 CLOSED
    const r = await savePlan({ ownerId: V.id, week, objectives: plan(1), submit: true, now: SAT })
    assert.equal(r.late, true)
    await assert.rejects(savePlan({ ownerId: V.id, week, objectives: plan(2), now: SAT }), e => e.status === 403 && /已进入复盘或已归档/.test(e.message))
    // 已归档: 没交过的人也不行
    await prisma.okrCycle.update({ where: { year_weekNo: { year: Y, weekNo: 30 } }, data: { status: 'CLOSED', closedAt: SAT } })
    await assert.rejects(savePlan({ ownerId: U.id, week, objectives: plan(1), now: SAT }), e => e.status === 403 && /已进入复盘或已归档/.test(e.message))
  })
})
