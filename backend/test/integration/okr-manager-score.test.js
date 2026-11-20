// 集成测试 - 0.5.8 主管评分开放给部门主管(MANAGER)
//
// MANAGER 只能给本团队成员打主管分(越界 403/8117); TEAM_LEAD 仍不放开; ADMIN 不限;
// 归档(close-by-score)仍只给 ADMIN(MANAGER 403/8118)。
//
// 用远期测试周(2051–2059 年随机一周, 与 okr / okr-proxy / okr-backfill / okr-v3 的年份错开), 绝不碰真实周。
// 人物: 团队甲 = 经理 M + 组长 L + 工程师 A; 团队乙 = 工程师 X(M 管不到); 老板 O(ADMIN)。账号与团队现建现删。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, sleep } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const WEEK = { year: rnd(2051, 2059), weekNo: rnd(2, 50) }
const WK = weekKey(WEEK)

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const where = { cycleId: c.id }
  const oids = (await prisma.okrObjective.findMany({ where, select: { id: true } })).map(o => o.id)
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

const plan = tag => [{
  title: `unit-test-mgrscore-${tag}-O1`,
  keyResults: [{ title: `${tag}-KR1 上线`, metricType: 'BINARY' }]
}]

/** who 在测试周提交一条 O, 标完 KR 并自评, 返回这条 O */
async function submitAndSelfScore(who, tag, score = 80) {
  const r = await who.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan(tag) })
  assert.equal(r.code, 0, r.message)
  const o = r.data.objectives[0]
  for (const k of o.keyResults) assert.equal((await who.post(`/api/okr/krs/${k.id}/complete`, { done: true })).code, 0)
  const s = await who.post('/api/okr/self-score', { objectiveId: o.id, score })
  assert.equal(s.code, 0, s.message)
  return o
}

describe('0.5.8 主管评分开放给部门主管 /api/okr/manager-score', () => {
  let M, L, A, X, O, m, l, a, x, boss
  let oa, ox, om
  const teams = []

  before(async () => {
    M = await createTestUser('MANAGER', { name: 'unit-test-mgrscore-经理M' })
    L = await createTestUser('TEAM_LEAD', { name: 'unit-test-mgrscore-组长L' })
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-mgrscore-工程师A' })
    X = await createTestUser('FDE_ENGINEER', { name: 'unit-test-mgrscore-外组X' })
    O = await createTestUser('ADMIN', { name: 'unit-test-mgrscore-老板O' })
    m = api(M.token); l = api(L.token); a = api(A.token); x = api(X.token); boss = api(O.token)
    const t1 = await prisma.team.create({ data: { name: uniqName('mgr甲').slice(0, 50) } })
    const t2 = await prisma.team.create({ data: { name: uniqName('mgr乙').slice(0, 50) } })
    teams.push(t1.id, t2.id)
    for (const u of [M, L, A]) await prisma.teamMembership.create({ data: { teamId: t1.id, userId: BigInt(u.id) } })
    await prisma.teamMembership.create({ data: { teamId: t2.id, userId: BigInt(X.id) } })
    const { start, end } = weekRange(WEEK.year, WEEK.weekNo)
    await prisma.okrCycle.create({ data: { year: WEEK.year, weekNo: WEEK.weekNo, startDate: start, endDate: end, status: 'REVIEW' } })
    oa = await submitAndSelfScore(a, 'A', 85)
    ox = await submitAndSelfScore(x, 'X', 70)
    om = await submitAndSelfScore(m, 'M', 90)
  })

  after(async () => {
    await dropCycle(WEEK)
    await prisma.auditLog.deleteMany({ where: { userId: { in: [M, O].filter(Boolean).map(u => BigInt(u.id)) } } }).catch(() => {})
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: teams } } })
    await prisma.team.deleteMany({ where: { id: { in: teams } } })
    for (const u of [M, L, A, X, O]) await u?.cleanup()
  })

  test('MANAGER 给本团队成员打主管分 → 200, okrScore.scorerId=经理, role=MANAGER, 审计带 scorerRole', async () => {
    const r = await m.post('/api/okr/manager-score', { objectiveId: oa.id, score: 82, comment: 'unit-test-mgrscore 经理评语' })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.code, 0)
    assert.equal(r.data.role, 'MANAGER')
    assert.equal(r.data.score, 82)
    const row = await prisma.okrScore.findUnique({ where: { id: BigInt(r.data.id) } })
    assert.equal(String(row.scorerId), M.id)
    assert.equal(row.role, 'MANAGER')
    assert.equal(String(row.objectiveId), oa.id)
    const o = await prisma.okrObjective.findUnique({ where: { id: BigInt(oa.id) } })
    assert.equal(o.managerScore, 82)
    let audit = null
    for (let i = 0; i < 20 && !audit; i++) {
      audit = await prisma.auditLog.findFirst({ where: { action: 'okr.score.manager', resourceId: BigInt(oa.id), userId: BigInt(M.id) }, orderBy: { id: 'desc' } })
      if (!audit) await sleep(50)
    }
    assert.ok(audit, '打分留审计')
    assert.equal(audit.details.scorerRole, 'MANAGER')
    assert.equal(audit.details.score, 82)
    // 能评也能看: 经理看 A 的详情带主管分; 页面入口 can.managerScore / can.scoreOwner 为 true, 不能归档
    const view = await m.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
    assert.equal(view.data.objectives[0].managerScore, 82)
    assert.equal(view.data.can.managerScore, true)
    assert.equal(view.data.can.scoreOwner, true)
    assert.equal(view.data.can.closeByScore, false)
  })

  test('MANAGER 给别的团队成员打分 → 403「只能给自己团队的成员打分」, 不落库', async () => {
    const r = await m.post('/api/okr/manager-score', { objectiveId: ox.id, score: 60 })
    assert.equal(r.status, 403)
    assert.equal(r.code, 8117)
    assert.equal(r.message, '只能给自己团队的成员打分')
    assert.equal((await prisma.okrObjective.findUnique({ where: { id: BigInt(ox.id) } })).managerScore, null)
    assert.equal(await prisma.okrScore.count({ where: { objectiveId: BigInt(ox.id), role: 'MANAGER' } }), 0)
    // 外组的人: 看不到主管分, 页面不给评分入口
    const view = await m.get(`/api/okr/cycle?week=${WK}&ownerId=${X.id}`)
    assert.equal(view.data.can.scoreOwner, false)
    assert.ok(!JSON.stringify(view.raw).includes('managerScore'))
  })

  test('MANAGER 给本团队的 ADMIN 打分 → 403(不评老板)', async () => {
    const t = await prisma.teamMembership.create({ data: { teamId: teams[0], userId: BigInt(O.id) } })
    try {
      const ob = (await boss.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan('O') })).data.objectives[0]
      const r = await m.post('/api/okr/manager-score', { objectiveId: ob.id, score: 60 })
      assert.equal(r.status, 403)
      assert.equal(r.code, 8117)
      await prisma.okrKeyResult.deleteMany({ where: { objectiveId: BigInt(ob.id) } })
      await prisma.okrObjective.delete({ where: { id: BigInt(ob.id) } })
    } finally {
      await prisma.teamMembership.delete({ where: { id: t.id } })
    }
  })

  test('TEAM_LEAD 打分 → 403(未放开)', async () => {
    const r = await l.post('/api/okr/manager-score', { objectiveId: oa.id, score: 50 })
    assert.equal(r.status, 403)
    assert.equal(r.code, 1003)
    assert.equal((await prisma.okrObjective.findUnique({ where: { id: BigInt(oa.id) } })).managerScore, 82, '没被组长改掉')
    const view = await l.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
    assert.ok(!JSON.stringify(view.raw).includes('managerScore'), '组长看不到主管分')
  })

  test('ADMIN 打分(任意人, 含外组与经理本人) → 200', async () => {
    for (const [o, score] of [[ox, 72], [om, 88]]) {
      const r = await boss.post('/api/okr/manager-score', { objectiveId: o.id, score })
      assert.equal(r.code, 0, r.message)
      const row = await prisma.okrScore.findUnique({ where: { id: BigInt(r.data.id) } })
      assert.equal(String(row.scorerId), O.id)
      assert.equal(row.role, 'MANAGER')
    }
  })

  test('员工本人不能给自己打主管分: 工程师无权限 403; 经理评自己的 O → 403/8109', async () => {
    const e = await a.post('/api/okr/manager-score', { objectiveId: oa.id, score: 100 })
    assert.equal(e.status, 403)
    const r = await m.post('/api/okr/manager-score', { objectiveId: om.id, score: 100 })
    assert.equal(r.status, 403)
    assert.equal(r.code, 8109)
    assert.equal((await prisma.okrObjective.findUnique({ where: { id: BigInt(om.id) } })).managerScore, 88)
  })

  test('/team: 经理看本团队行带主管分, 自己那一行不带; 外组不在列表里', async () => {
    const r = await m.get(`/api/okr/team?week=${WK}`)
    assert.equal(r.code, 0)
    const rowA = r.data.rows.find(v => v.user.id === A.id)
    assert.equal(rowA.managerScore, 82)
    const rowM = r.data.rows.find(v => v.user.id === M.id)
    assert.ok(rowM && !('managerScore' in rowM), '自己那一行不带主管分(在 /my 里看)')
    assert.ok(!r.data.rows.some(v => v.user.id === X.id))
  })

  test('close-by-score: MANAGER → 403「关闭本周是老板的动作」, 周期不动; ADMIN → 200 归档', async () => {
    const r = await m.post('/api/okr/cycle/close-by-score', { week: WK })
    assert.equal(r.status, 403)
    assert.equal(r.code, 8118)
    assert.equal(r.message, '关闭本周是老板的动作')
    let c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: WEEK.year, weekNo: WEEK.weekNo } } })
    assert.equal(c.status, 'REVIEW')
    assert.equal((await l.post('/api/okr/cycle/close-by-score', { week: WK })).status, 403, '组长也不能')

    const ok = await boss.post('/api/okr/cycle/close-by-score', { week: WK })
    assert.equal(ok.status, 200, ok.message)
    assert.equal(ok.data.status, 'CLOSED')
    assert.equal(ok.data.closedBy, O.id)
    c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: WEEK.year, weekNo: WEEK.weekNo } } })
    assert.equal(c.status, 'CLOSED')
  })
})
