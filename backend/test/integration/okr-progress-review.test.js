// 集成测试 - 0.6.7: 复盘周(REVIEW)本人照样能录进展; 归档周(CLOSED)不能, 并给人话原因
//
// 老板原话: 「我的角色是 yihufde 的系统管理员，我无法录入我的 OKR 的进展？只能看进展，和完成 OKR。」
// 根因在前端(进展表单错绑到「计划可编辑」can.edit), 后端口径不变: can.progress = 本人 && 未归档 && 已提交。
// 这里只把后端口径钉死, 防止以后有人把进展也收紧到 planWritable。
//
// 测试年份(与其他 OKR 用例错开): 2211–2219 年里连续的 2 周, 周期由 prisma 现建(REVIEW / CLOSED), 绝不碰真实周。
// O / KR 也由 prisma 直接建成「已提交」, 不走 /plan/submit, 不发任何通知。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2211, 2219)
const BASE = rnd(2, 40)
const REVIEW_W = { year: YEAR, weekNo: BASE }
const CLOSED_W = { year: YEAR, weekNo: BASE + 1 }
const WEEKS = [REVIEW_W, CLOSED_W]
const K = w => weekKey(w)
const T = s => `unit-test-pr ${s}`

async function cycleOf(week) {
  return prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
}

async function dropCycle(week) {
  const c = await cycleOf(week)
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

/** 建周期 + 一条已提交的 O(带一条数值型 KR) */
async function seedWeek(week, status, ownerId) {
  await dropCycle(week)
  const { start, end } = weekRange(week.year, week.weekNo)
  const cycle = await prisma.okrCycle.create({
    data: { year: week.year, weekNo: week.weekNo, startDate: start, endDate: end, status, ...(status === 'CLOSED' ? { closedAt: new Date() } : {}) }
  })
  const o = await prisma.okrObjective.create({
    data: { cycleId: cycle.id, ownerId: BigInt(ownerId), seq: 1, title: T(`${status} 的 O`), submittedAt: start }
  })
  const kr = await prisma.okrKeyResult.create({
    data: { objectiveId: o.id, seq: 1, title: T(`${status} 的 KR`), metricType: 'NUMBER', targetValue: 10 }
  })
  return { cycle, objectiveId: String(o.id), krId: String(kr.id) }
}

describe('0.6.7 复盘周本人能录进展, 归档周不能', () => {
  let BOSS, boss
  let rv, cl

  before(async () => {
    // 老板报的就是 ADMIN 自己的页面
    BOSS = await createTestUser('ADMIN', { name: 'unit-test-pr-老板' })
    boss = api(BOSS.token)
    rv = await seedWeek(REVIEW_W, 'REVIEW', BOSS.id)
    cl = await seedWeek(CLOSED_W, 'CLOSED', BOSS.id)
  })

  after(async () => {
    for (const w of WEEKS) await dropCycle(w).catch(() => {})
    if (BOSS) {
      await prisma.auditLog.deleteMany({ where: { userId: BigInt(BOSS.id) } }).catch(() => {})
      await BOSS.cleanup()
    }
  })

  test('1. REVIEW 周 + 本人 + 已提交: can.progress=true(can.edit=false), POST 进展 200, 库里多一条 update', async () => {
    const c = await boss.get(`/api/okr/cycle?week=${K(REVIEW_W)}`)
    assert.equal(c.status, 200, c.message)
    assert.equal(c.data.cycle.status, 'REVIEW')
    // 前端以前就是拿 can.edit 去控制进展框 —— 复盘周它是 false, 进展得看 can.progress
    assert.equal(c.data.can.edit, false)
    assert.equal(c.data.can.progress, true)

    const before = await prisma.okrUpdate.count({ where: { objectiveId: BigInt(rv.objectiveId) } })
    const r = await boss.post(`/api/okr/objectives/${rv.objectiveId}/updates`, { content: T('复盘周补一条进展'), krId: rv.krId, valueAfter: 7 })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.krId, rv.krId)
    assert.equal(r.data.valueAfter, 7)

    const rows = await prisma.okrUpdate.findMany({ where: { objectiveId: BigInt(rv.objectiveId) }, orderBy: { id: 'asc' } })
    assert.equal(rows.length, before + 1)
    assert.equal(rows.at(-1).content, T('复盘周补一条进展'))
    assert.equal(String(rows.at(-1).createdBy), String(BOSS.id))
    const kr = await prisma.okrKeyResult.findUnique({ where: { id: BigInt(rv.krId) } })
    assert.equal(kr.currentValue, 7)
  })

  test('2. CLOSED 周: can.progress=false, 同一请求 4xx 带人话原因, 库里不多', async () => {
    const c = await boss.get(`/api/okr/cycle?week=${K(CLOSED_W)}`)
    assert.equal(c.status, 200, c.message)
    assert.equal(c.data.can.progress, false)

    const before = await prisma.okrUpdate.count({ where: { objectiveId: BigInt(cl.objectiveId) } })
    const r = await boss.post(`/api/okr/objectives/${cl.objectiveId}/updates`, { content: T('归档后还想写'), krId: cl.krId, valueAfter: 3 })
    assert.ok(r.status >= 400 && r.status < 500, `应为 4xx, 实际 ${r.status}`)
    assert.ok([8105, 8110, 8120].includes(Number(r.code)), `错误码 ${r.code}`)
    assert.match(String(r.message), /归档/)
    assert.equal(await prisma.okrUpdate.count({ where: { objectiveId: BigInt(cl.objectiveId) } }), before)
    const kr = await prisma.okrKeyResult.findUnique({ where: { id: BigInt(cl.krId) } })
    assert.equal(kr.currentValue, 0)
  })
})
