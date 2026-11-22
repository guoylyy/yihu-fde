// 集成测试 - 0.6.3: 一个人不交自评, 不该卡住全公司的「完成本周」
//
// 1) 主管可以不等自评直接打分(不再 8115); 没提交的草稿仍 8110
// 2) close-by-score: 已交自评却没主管分 → 仍 8116(missing 只列这些); 没交自评的人不拦, 进 pendingSelfScore 点名
// 3) ADMIN 显式开关 allowUnscoredSelfScored=true: 已交自评没主管分的也放行, 进 unscored + 审计 OKR_CLOSE_WITH_UNSCORED; 默认不传仍拦
//
// 测试年份(与其他 OKR 用例错开): 2171–2179 年里连续 4 周(以后的周, 周期由 prisma 现建为 REVIEW), 绝不碰真实周。
// 人物: 工程师 A(交自评) / 工程师 B(不交自评) / 老板 O(ADMIN)。账号现建现删, 周期与审计按测试周期硬删。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2171, 2179)
const BASE = rnd(2, 40)
const wk = i => ({ year: YEAR, weekNo: BASE + i })
const MIXED = wk(0)   // A 自评未打分 + B 没自评 → 8116 只列 A; 给 A 打分后归档, B 进 pendingSelfScore
const DIRECT = wk(1)  // 主管直接给没自评的 B 打分
const DRAFT = wk(2)   // B 只保存草稿 → 主管打分 8110
const FORCE = wk(3)   // 开关: 默认拦, true 放行
const WEEKS = [MIXED, DIRECT, DRAFT, FORCE]
const K = w => weekKey(w)

const cycleOf = week => prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })

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
  await prisma.auditLog.deleteMany({ where: { resourceType: 'okr_cycle', resourceId: c.id } }).catch(() => {})
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

const plan = tag => [{ title: `unit-test-close063-${tag}-O1`, keyResults: [{ title: `${tag}-KR1 上线`, metricType: 'BINARY' }] }]

describe('0.6.3 close-by-score 不被没交自评的人卡住', () => {
  let A, B, O, a, b, boss
  const objs = {}

  async function submit(who, week, tag) {
    const r = await who.post(`/api/okr/plan/submit?week=${K(week)}`, { objectives: plan(tag) })
    assert.equal(r.code, 0, r.message)
    return r.data.objectives[0]
  }
  async function selfScore(who, o, score) {
    for (const k of o.keyResults) assert.equal((await who.post(`/api/okr/krs/${k.id}/complete`, { done: true })).code, 0)
    const s = await who.post('/api/okr/self-score', { objectiveId: o.id, score })
    assert.equal(s.code, 0, s.message)
  }
  const close = (week, extra = {}) => boss.post('/api/okr/cycle/close-by-score', { week: K(week), ...extra })
  const managerScore = (o, score) => boss.post('/api/okr/manager-score', { objectiveId: o.id, score, comment: 'unit-test-close063' })

  before(async () => {
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-close063-A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-close063-B' })
    O = await createTestUser('ADMIN', { name: 'unit-test-close063-老板O' })
    a = api(A.token); b = api(B.token); boss = api(O.token)
    for (const w of WEEKS) {
      await dropCycle(w)
      const { start, end } = weekRange(w.year, w.weekNo)
      await prisma.okrCycle.create({ data: { year: w.year, weekNo: w.weekNo, startDate: start, endDate: end, status: 'REVIEW' } })
    }
    for (const w of [MIXED, FORCE]) {
      objs[`A${K(w)}`] = await submit(a, w, 'A')
      await selfScore(a, objs[`A${K(w)}`], 80)
      objs[`B${K(w)}`] = await submit(b, w, 'B')
    }
    objs.Bdirect = await submit(b, DIRECT, 'B')
  })

  after(async () => {
    for (const w of WEEKS) await dropCycle(w)
    for (const u of [A, B, O]) await u?.cleanup()
  })

  test('1. A 交了自评没主管分、B 没交自评 → 仍 8116, missing 只有 A, 不含 B; B 进 pendingSelfScore', async () => {
    const r = await close(MIXED)
    console.log(`ℹ case1 POST /api/okr/cycle/close-by-score {"week":"${K(MIXED)}"} → ${r.status} ${JSON.stringify(r.raw)}`)
    assert.equal(r.status, 400)
    assert.equal(r.code, 8116)
    assert.match(r.message, /还有 1 个 O 没有主管评分/)
    const missing = r.raw.data.missing
    assert.deepEqual(missing.map(m => m.objectiveId), [objs[`A${K(MIXED)}`].id])
    assert.equal(missing[0].ownerId, A.id)
    assert.ok(!missing.some(m => m.ownerId === B.id), '没交自评的 B 不算缺项')
    assert.ok(!r.message.includes('unit-test-close063-B'))
    assert.deepEqual(r.raw.data.pendingSelfScore, [{ userId: B.id, name: 'unit-test-close063-B', objectiveCount: 1 }])
    assert.equal((await cycleOf(MIXED)).status, 'REVIEW', '周期不动')
  })

  test('2. 给 A 打完分 → 归档成功, changed=true, pendingSelfScore 里是 B(没被算成 0 分)', async () => {
    assert.equal((await managerScore(objs[`A${K(MIXED)}`], 75)).code, 0)
    const r = await close(MIXED)
    console.log(`ℹ case2 POST /api/okr/cycle/close-by-score {"week":"${K(MIXED)}"} → ${r.status} ${JSON.stringify(r.raw)}`)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'CLOSED')
    assert.equal(r.data.changed, true)
    assert.equal(r.data.scored, 1, '只有 A 有主管分')
    assert.deepEqual(r.data.pendingSelfScore, [{ userId: B.id, name: 'unit-test-close063-B', objectiveCount: 1 }])
    assert.equal(r.data.pendingSelfScoreTotal, 1)
    assert.deepEqual(r.data.unscored, [])
    const ob = await prisma.okrObjective.findUnique({ where: { id: BigInt(objs[`B${K(MIXED)}`].id) } })
    assert.equal(ob.selfScore, null, 'B 的自评保持空, 不补 0')
    assert.equal(ob.managerScore, null, 'B 的主管分保持空, 不补 0')
    const c = await cycleOf(MIXED)
    const audit = await prisma.auditLog.findFirst({ where: { action: 'okr.cycle.close-by-score', resourceId: c.id } })
    assert.equal(audit?.details?.pendingSelfScoreTotal, 1)
    assert.equal(await prisma.auditLog.count({ where: { action: 'OKR_CLOSE_WITH_UNSCORED', resourceId: c.id } }), 0)
  })

  test('3. 主管直接给没交自评的 B 打分 → 200(不再 8115), managerScore 有值, 自评仍空', async () => {
    const r = await managerScore(objs.Bdirect, 66)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.code, 0)
    assert.equal(r.data.score, 66)
    const o = await prisma.okrObjective.findUnique({ where: { id: BigInt(objs.Bdirect.id) } })
    assert.equal(o.managerScore, 66)
    assert.equal(o.selfScore, null)
    // B 之后再自评: 两个字段独立, 不覆盖主管分
    await selfScore(b, objs.Bdirect, 90)
    const o2 = await prisma.okrObjective.findUnique({ where: { id: BigInt(objs.Bdirect.id) } })
    assert.equal(o2.selfScore, 90)
    assert.equal(o2.managerScore, 66)
  })

  test('4. B 只保存草稿没提交 → 主管打分仍 8110', async () => {
    const s = await b.post(`/api/okr/plan?week=${K(DRAFT)}`, { objectives: plan('B-draft') })
    assert.equal(s.code, 0, s.message)
    const draft = s.data.objectives[0]
    const row = await prisma.okrObjective.findUnique({ where: { id: BigInt(draft.id) } })
    assert.equal(row.submittedAt, null, '前提: 草稿未提交')
    const r = await managerScore(draft, 70)
    assert.equal(r.status, 409)
    assert.equal(r.code, 8110)
    assert.equal((await prisma.okrObjective.findUnique({ where: { id: BigInt(draft.id) } })).managerScore, null)
  })

  test('6. allowUnscoredSelfScored 不传 / false → 仍拦 8116, 与原来一致', async () => {
    for (const extra of [{}, { allowUnscoredSelfScored: false }, { allowUnscoredSelfScored: 1 }]) {
      const r = await close(FORCE, extra)
      assert.equal(r.status, 400, JSON.stringify(extra))
      assert.equal(r.code, 8116)
      assert.deepEqual(r.raw.data.missing.map(m => m.objectiveId), [objs[`A${K(FORCE)}`].id])
    }
    assert.equal((await cycleOf(FORCE)).status, 'REVIEW')
  })

  test('5. allowUnscoredSelfScored=true 且 A 未打分 → 归档成功, unscored 含 A, 审计 OKR_CLOSE_WITH_UNSCORED', async () => {
    const r = await close(FORCE, { allowUnscoredSelfScored: true })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'CLOSED')
    assert.equal(r.data.changed, true)
    assert.equal(r.data.scored, 0)
    assert.deepEqual(r.data.unscored.map(u => u.objectiveId), [objs[`A${K(FORCE)}`].id])
    assert.equal(r.data.unscored[0].ownerId, A.id)
    assert.deepEqual(r.data.pendingSelfScore.map(p => p.userId), [B.id], '没交自评的 B 照样点名')
    const c = await cycleOf(FORCE)
    const audit = await prisma.auditLog.findFirst({ where: { action: 'OKR_CLOSE_WITH_UNSCORED', resourceId: c.id } })
    assert.ok(audit, '放行留审计')
    assert.deepEqual(audit.details.unscored.map(u => u.objectiveId), [objs[`A${K(FORCE)}`].id])
    assert.equal(audit.details.week, K(FORCE))
  })
})
