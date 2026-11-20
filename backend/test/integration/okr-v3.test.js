// 集成测试 - OKR 第三轮(后端): KR 完成开关 / 自评不限时 / 主管评分后归档 / OKR 免提交白名单
//
// 用远期测试周(2071–2079 年随机几周, 与 okr / okr-proxy 的年份错开, 并行跑互不清理对方的周期)。
// 周期状态(复盘 / 周日之后)直接改库模拟时间。账号现建现删。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api } from './helpers.js'
import { weekRange, weekKey, shiftWeek } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2071, 2079)
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
})
