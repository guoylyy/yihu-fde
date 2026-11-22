// 集成测试 - OKR 9.0: 决策记录(/api/okr/decisions)
//
// 测试年份(与其他 OKR 用例错开): 2131–2139 年里随机一周(以后的周, 周期由 prisma 现建为 IN_PROGRESS), 现建现删, 绝不碰真实周。
// 决策时间不能晚于明天, 所以时间线用例回填到过去的日期, 靠自建项目 P 过滤与库里其他决策隔离; 列表搜索靠每次运行唯一的 TOKEN。
// 人物: ADMIN、M(MANAGER)、工程师 A(O_A1 / O_A2)、工程师 B(O_B1)。账号、项目现建现删(客户借最老的现有客户)。
// 决策一律按 createdById 硬删清理(接口只有软删)。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'
import { DETACHED_TAG } from '../../src/services/okrDecisions.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const W = { year: rnd(2131, 2139), weekNo: rnd(2, 50) }
const WK = weekKey(W)
const TOKEN = `v9tok${process.pid}${Date.now().toString(36)}`
const DAY = 24 * 3600 * 1000

const O_A1 = 'unit-test-v9 A-O1 HVR 落地'
const O_A2 = 'unit-test-v9 A-O2 质检(会被删)'
const O_B1 = 'unit-test-v9 B-O1 文档收口'

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
  await dropPlanTrail([c.id])
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

describe('OKR 9.0 决策记录', () => {
  let ADMIN, M, A, B, P, P2
  const O = {}
  let cycleId

  const post = (u, body) => api(u.token).post('/api/okr/decisions', body)
  const list = (u, qs) => api(u.token).get(`/api/okr/decisions?${new URLSearchParams(qs)}`)
  const mk = async (u, body) => {
    const r = await post(u, { detail: '背景与结论', ...body })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.code, 0, r.message)
    return r.data
  }

  before(async () => {
    ADMIN = await createTestUser('ADMIN', { name: 'unit-test-v9-老板' })
    M = await createTestUser('MANAGER', { name: 'unit-test-v9-主管M' })
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v9-小毅' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v9-吕哲远' })
    const customer = await prisma.customer.findFirst({ where: { deletedAt: null }, orderBy: { id: 'asc' } })
    assert.ok(customer, '库里至少要有一个客户')
    const mkProject = tag => prisma.project.create({
      data: { code: `UT-V9${tag}-${process.pid}-${Date.now()}`.slice(0, 50), name: uniqName(`v9项目${tag}`), customerId: customer.id, status: 'IN_PROGRESS', createdBy: BigInt(M.id) }
    })
    P = await mkProject('a')
    P2 = await mkProject('b')
    const { start, end } = weekRange(W.year, W.weekNo)
    cycleId = (await prisma.okrCycle.create({ data: { year: W.year, weekNo: W.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS' } })).id

    const submit = async (u, objectives) => {
      const r = await api(u.token).post(`/api/okr/plan/submit?week=${WK}`, { objectives })
      assert.equal(r.code, 0, r.message)
      return r.data.objectives
    }
    const a = await submit(A, [
      { title: O_A1, weight: 60, keyResults: [{ title: 'KR HVR 上线', metricType: 'BINARY' }] },
      { title: O_A2, weight: 40, keyResults: [{ title: 'KR 质检方案', metricType: 'BINARY' }] }
    ])
    O.A1 = a.find(o => o.title === O_A1)
    O.A2 = a.find(o => o.title === O_A2)
    const b = await submit(B, [{ title: O_B1, keyResults: [{ title: 'KR B-1', metricType: 'BINARY' }] }])
    O.B1 = b[0]
  })

  after(async () => {
    const users = [ADMIN, M, A, B].filter(Boolean)
    const uids = users.map(u => BigInt(u.id))
    await prisma.okrDecision.deleteMany({ where: { createdById: { in: uids } } }).catch(() => {})
    await dropCycle(W).catch(() => {})
    for (const p of [P, P2].filter(Boolean)) await prisma.project.delete({ where: { id: p.id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
    for (const u of users) await u.cleanup()
  })

  test('1. ADMIN 建决策 → 200; 列表查得到, decidedByName 正确; 审计留痕', async () => {
    const d = await mk(ADMIN, { title: `HVR 主责人定小毅 ${TOKEN}`, detail: '老板主持: HVR 由小毅主责', rationale: '小毅最熟现场', impact: '吕哲远配合', projectId: String(P.id) })
    assert.equal(d.status, 'ACTIVE')
    assert.equal(d.decidedByName, ADMIN.name)
    assert.equal(d.createdByName, ADMIN.name)
    assert.equal(d.objectiveId, null, '不挂 O = 管理决策')
    assert.equal(d.project.id, String(P.id))
    const r = await list(A, { projectId: String(P.id) })
    assert.equal(r.code, 0, r.message)
    const hit = r.data.list.find(x => x.id === d.id)
    assert.ok(hit, '全员可读: 工程师也能在列表里查到')
    assert.equal(hit.decidedByName, ADMIN.name)
    assert.equal(hit.rationale, '小毅最熟现场')
    const one = await api(B.token).get(`/api/okr/decisions/${d.id}`)
    assert.equal(one.code, 0)
    assert.equal(one.data.title, d.title)
    const audit = await prisma.auditLog.findFirst({ where: { action: 'okr.decision.create', resourceId: BigInt(d.id) } })
    assert.ok(audit, 'okr.decision.create 已落审计')
    // 必填校验
    const miss = await post(ADMIN, { title: '没有详情' })
    assert.equal(miss.status, 400)
  })

  test('2. 工程师给自己的 O 建决策 → 200; 给别人的 O / 不挂 O → 403; MANAGER 可给任何 O', async () => {
    const mine = await mk(A, { title: `A 自己的决策 ${TOKEN}`, objectiveId: O.A1.id })
    assert.equal(mine.objectiveId, O.A1.id)
    assert.equal(mine.cycleId, String(cycleId), '周期缺省取 O 的周期')
    assert.equal(mine.week, WK)
    const other = await post(A, { title: '给别人 O', detail: 'x', objectiveId: O.B1.id })
    assert.equal(other.status, 403)
    assert.equal(other.code, 8191)
    const none = await post(A, { title: '管理决策', detail: 'x' })
    assert.equal(none.status, 403)
    const byM = await mk(M, { title: `M 给 B 的 O ${TOKEN}`, objectiveId: O.B1.id })
    assert.equal(byM.decidedByName, M.name)
    const ghost = await post(M, { title: '不存在的 O', detail: 'x', objectiveId: '999999999999' })
    assert.equal(ghost.status, 404)
  })

  test('3. supersede → 老记录 SUPERSEDED + supersededBy 指向新记录; 时间线两条都在; 工程师不能取代; 不能取代两次', async () => {
    const old = await mk(ADMIN, { title: '质检董事长自己开发', projectId: String(P2.id), objectiveId: O.A1.id })
    const byA = await api(A.token).post(`/api/okr/decisions/${old.id}/supersede`, { title: 'x', detail: 'y' })
    assert.equal(byA.status, 403)
    const r = await api(M.token).post(`/api/okr/decisions/${old.id}/supersede`, { title: '质检改由吕哲远落地', detail: '董事长出方案, 吕哲远落地', rationale: '董事长时间不够' })
    assert.equal(r.code, 0, r.message)
    const fresh = r.data.decision
    assert.equal(r.data.superseded.status, 'SUPERSEDED')
    assert.equal(r.data.superseded.supersededBy, fresh.id)
    assert.equal(fresh.status, 'ACTIVE')
    assert.equal(fresh.objectiveId, O.A1.id, '新记录继承 O')
    assert.equal(fresh.projectId, String(P2.id), '新记录继承项目')
    const oldNow = await api(B.token).get(`/api/okr/decisions/${old.id}`)
    assert.equal(oldNow.data.status, 'SUPERSEDED')
    assert.equal(oldNow.data.supersededBy, fresh.id)
    assert.equal(oldNow.data.supersededByDecision.id, fresh.id)
    const freshDetail = await api(B.token).get(`/api/okr/decisions/${fresh.id}`)
    assert.equal(freshDetail.data.supersedes.id, old.id)
    const tl = await api(B.token).get(`/api/okr/decisions/timeline?projectId=${P2.id}`)
    assert.equal(tl.code, 0, tl.message)
    assert.deepEqual(tl.data.list.map(x => x.id).sort(), [old.id, fresh.id].sort(), '时间线里新旧两条都在')
    const again = await api(ADMIN.token).post(`/api/okr/decisions/${old.id}/supersede`, { title: 'x', detail: 'y' })
    assert.equal(again.status, 409)
    const patchToSup = await api(ADMIN.token).patch(`/api/okr/decisions/${fresh.id}`, { status: 'SUPERSEDED' })
    assert.equal(patchToSup.status, 400, 'SUPERSEDED 只能经 supersede 产生')
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'okr.decision.supersede', resourceId: BigInt(old.id) } }))
  })

  test('4. PATCH status=REVERTED 不带 rationale → 400「撤销决策必须写明原因」; 带 → 200', async () => {
    const d = await mk(M, { title: `待撤销 ${TOKEN}` })
    const no = await api(M.token).patch(`/api/okr/decisions/${d.id}`, { status: 'REVERTED' })
    assert.equal(no.status, 400)
    assert.equal(no.message, '撤销决策必须写明原因')
    const blank = await api(M.token).patch(`/api/okr/decisions/${d.id}`, { status: 'REVERTED', rationale: '   ' })
    assert.equal(blank.status, 400)
    const yes = await api(M.token).patch(`/api/okr/decisions/${d.id}`, { status: 'REVERTED', rationale: '客户需求变了' })
    assert.equal(yes.code, 0, yes.message)
    assert.equal(yes.data.status, 'REVERTED')
    assert.equal(yes.data.rationale, '客户需求变了')
    // 改标题 / 详情 / 影响
    const edit = await api(M.token).patch(`/api/okr/decisions/${d.id}`, { title: `待撤销(改) ${TOKEN}`, impact: '影响 B' })
    assert.equal(edit.code, 0, edit.message)
    assert.equal(edit.data.impact, '影响 B')
    // 别人不能改
    const byB = await api(B.token).patch(`/api/okr/decisions/${d.id}`, { title: 'hack' })
    assert.equal(byB.status, 403)
    const audit = await prisma.auditLog.findMany({ where: { action: 'okr.decision.update', resourceId: BigInt(d.id) } })
    assert.equal(audit.length, 2)
  })

  test('5. 删除: 作者 7 天内 → 200(软删, 再读 404); 超 7 天且非 ADMIN → 403; ADMIN 随时可删', async () => {
    const d = await mk(A, { title: `A 刚记的 ${TOKEN}`, objectiveId: O.A1.id })
    const byB = await api(B.token).del(`/api/okr/decisions/${d.id}`)
    assert.equal(byB.status, 403, '非作者不能删')
    const del = await api(A.token).del(`/api/okr/decisions/${d.id}`)
    assert.equal(del.code, 0, del.message)
    assert.equal((await api(A.token).get(`/api/okr/decisions/${d.id}`)).status, 404)
    const row = await prisma.okrDecision.findUnique({ where: { id: BigInt(d.id) } })
    assert.ok(row && row.deletedAt, '软删: 行还在')
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'okr.decision.delete', resourceId: BigInt(d.id) } }))

    const stale = await mk(A, { title: `A 八天前记的 ${TOKEN}`, objectiveId: O.A1.id })
    await prisma.okrDecision.update({ where: { id: BigInt(stale.id) }, data: { createdAt: new Date(Date.now() - 8 * DAY) } })
    const late = await api(A.token).del(`/api/okr/decisions/${stale.id}`)
    assert.equal(late.status, 403)
    const latePatch = await api(A.token).patch(`/api/okr/decisions/${stale.id}`, { title: '改不了' })
    assert.equal(latePatch.status, 403)
    const byAdmin = await api(ADMIN.token).del(`/api/okr/decisions/${stale.id}`)
    assert.equal(byAdmin.code, 0, byAdmin.message)
  })

  test('6. O 详情 decisions 最多 3 条, 最近的在前(/my /cycle /team 一致)', async () => {
    const base = Date.now() - 10 * DAY
    const titles = []
    for (let i = 0; i < 4; i++) {
      const t = `B-O 决策 ${i} ${TOKEN}`
      titles.push(t)
      await mk(M, { title: t, objectiveId: O.B1.id, decidedAt: new Date(base + i * DAY).toISOString() })
    }
    // 第 2 步建的 "M 给 B 的 O" 决策时间是现在, 最新
    const want = [`M 给 B 的 O ${TOKEN}`, titles[3], titles[2]]
    const check = (o, where) => {
      assert.ok(o, `${where} 找到 O_B1`)
      assert.equal(o.decisions.length, 3, `${where} 最多 3 条`)
      assert.deepEqual(o.decisions.map(d => d.title), want, `${where} 最近的在前`)
      assert.deepEqual(Object.keys(o.decisions[0]).sort(), ['decidedAt', 'decidedByName', 'id', 'status', 'title'])
      assert.equal(o.decisions[0].decidedByName, M.name)
    }
    const my = await api(B.token).get(`/api/okr/my?week=${WK}`)
    check(my.data.objectives.find(o => o.id === O.B1.id), '/my')
    const cyc = await api(A.token).get(`/api/okr/cycle?week=${WK}&ownerId=${B.id}`)
    check(cyc.data.objectives.find(o => o.id === O.B1.id), '/cycle')
    const team = await api(ADMIN.token).get(`/api/okr/team?week=${WK}`)
    const row = team.data.rows.find(r => r.user.id === B.id)
    check(row?.objectives.find(o => o.id === O.B1.id), '/team')
    // 没有决策的 O 返回空数组
    const aMy = await api(A.token).get(`/api/okr/my?week=${WK}`)
    assert.deepEqual(aMy.data.objectives.find(o => o.id === O.A2.id).decisions, [])
  })

  test('7. 按 projectId 过滤、按 q 搜标题 / 正文、按 week、分页正确', async () => {
    const PQ = `${TOKEN}pg`
    const made = []
    for (let i = 0; i < 5; i++) {
      made.push(await mk(ADMIN, { title: `分页 ${PQ} ${i}`, detail: '正文', projectId: String(P2.id), decidedAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString() }))
    }
    const bodyHit = await mk(ADMIN, { title: '标题里没有搜索词', detail: `正文里有 ${PQ}x 这个词` })

    const pages = []
    for (const page of [1, 2, 3]) {
      const r = await list(B, { q: `分页 ${PQ}`, page, size: 2 })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.total, 5)
      assert.equal(r.data.page, page)
      assert.equal(r.data.size, 2)
      pages.push(r.data.list.map(x => x.id))
    }
    assert.deepEqual(pages.map(p => p.length), [2, 2, 1])
    assert.deepEqual(pages.flat(), made.map(d => d.id), '决策时间倒序, 不重不漏')

    const byBody = await list(B, { q: `${PQ}x` })
    assert.deepEqual(byBody.data.list.map(x => x.id), [bodyHit.id], 'q 也搜正文')

    const byProject = await list(B, { projectId: String(P.id) })
    assert.ok(byProject.data.list.length >= 1)
    assert.ok(byProject.data.list.every(x => x.projectId === String(P.id)), '只返回该项目的')
    assert.ok(!byProject.data.list.some(x => made.some(m => m.id === x.id)))

    const byObjective = await list(B, { objectiveId: O.B1.id, size: 100 })
    assert.ok(byObjective.data.list.every(x => x.objectiveId === O.B1.id))
    assert.equal(byObjective.data.total, 5)

    const byWeek = await list(B, { week: WK, q: TOKEN, size: 100 })
    assert.equal(byWeek.code, 0, byWeek.message)
    assert.equal(byWeek.data.week, WK)
    assert.ok(byWeek.data.list.length > 0)
    assert.ok(byWeek.data.list.every(x => x.week === WK), '按周只返回这一周周期上的')

    const badWeek = await list(B, { week: 'nope' })
    assert.equal(badWeek.status, 400)
  })

  test('8. 时间线: from / to 两端含当天(上海时区), 按 decidedAt 倒序', async () => {
    const at = s => new Date(s).toISOString()
    const pid = String(P.id)
    const before = await mk(ADMIN, { title: 'TL 前一天最后一秒', projectId: pid, decidedAt: at('2025-03-09T23:59:59+08:00') })
    const first = await mk(ADMIN, { title: 'TL from 当天零点', projectId: pid, decidedAt: at('2025-03-10T00:00:00+08:00') })
    const mid = await mk(ADMIN, { title: 'TL 中间', projectId: pid, decidedAt: '2025-03-11' })
    const last = await mk(ADMIN, { title: 'TL to 当天最后一秒', projectId: pid, decidedAt: at('2025-03-12T23:59:59+08:00') })
    const afterD = await mk(ADMIN, { title: 'TL 后一天零点', projectId: pid, decidedAt: at('2025-03-13T00:00:00+08:00') })

    const r = await api(B.token).get(`/api/okr/decisions/timeline?from=2025-03-10&to=2025-03-12&projectId=${pid}`)
    assert.equal(r.code, 0, r.message)
    assert.deepEqual(r.data.list.map(x => x.id), [last.id, mid.id, first.id], '含两端当天, 倒序')
    assert.deepEqual(r.data.days.map(d => d.date), ['2025-03-12', '2025-03-11', '2025-03-10'])
    assert.ok(!r.data.list.some(x => x.id === before.id || x.id === afterD.id))

    const one = await api(B.token).get(`/api/okr/decisions/timeline?from=2025-03-13&to=2025-03-13&projectId=${pid}`)
    assert.deepEqual(one.data.list.map(x => x.id), [afterD.id], 'from = to 当天')

    const open = await api(B.token).get(`/api/okr/decisions/timeline?to=2025-03-09&projectId=${pid}`)
    assert.deepEqual(open.data.list.map(x => x.id), [before.id], '只给 to')

    const all = await api(B.token).get(`/api/okr/decisions/timeline?projectId=${pid}`)
    const ts = all.data.list.map(x => Date.parse(x.decidedAt))
    assert.deepEqual(ts, [...ts].sort((a, b) => b - a), '整体按 decidedAt 倒序')

    const rev = await api(B.token).get('/api/okr/decisions/timeline?from=2025-03-12&to=2025-03-10')
    assert.equal(rev.status, 400)
    const badDate = await api(B.token).get('/api/okr/decisions/timeline?from=2025-3-1')
    assert.equal(badDate.status, 400)
  })

  test('9. O 被删 → 决策保留, objectiveId 置空, detail 前加「[原 O 已删除]」(不级联)', async () => {
    const d = await mk(A, { title: `挂在 A-O2 上 ${TOKEN}`, detail: '原来的正文', objectiveId: O.A2.id })
    // A 重新保存计划, 只留 O_A1(权重改 100) → O_A2 被删
    const k = O.A1.keyResults[0]
    const r = await api(A.token).post(`/api/okr/plan?week=${WK}`, {
      objectives: [{ id: O.A1.id, title: O_A1, weight: 100, keyResults: [{ id: k.id, title: k.title, metricType: k.metricType, weight: 100 }] }]
    })
    assert.equal(r.code, 0, r.message)
    assert.equal(await prisma.okrObjective.count({ where: { id: BigInt(O.A2.id) } }), 0, 'O_A2 已删')
    const after = await api(B.token).get(`/api/okr/decisions/${d.id}`)
    assert.equal(after.code, 0, '决策还在')
    assert.equal(after.data.objectiveId, null)
    assert.ok(after.data.detail.startsWith(DETACHED_TAG), after.data.detail)
    assert.ok(after.data.detail.includes(O_A2) && after.data.detail.endsWith('原来的正文'))
    assert.equal(after.data.status, 'ACTIVE')
  })
})
