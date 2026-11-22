// 集成测试 - OKR 5.0: O 结构化挂项目(多项目)
//
// 测试年份(与其他 OKR 用例错开): 2031–2039 年随机一周(以后的周, 周期现建为 IN_PROGRESS, 不会被时间推进), 现建现删, 绝不碰真实周。
// 人物: 团队 T = 经理 M + 工程师 A / B / C; 外组工程师 X; 老板 O(ADMIN)。账号、团队、项目现建现删; 客户借现有最老的一个(库里没有才现建)。
// 项目: P1 / P2(正常), P3(用来测「项目被删后关联保留、查询过滤」), PD(一开始就是已删除的项目)。
// 计划: A —— O1 挂 [P1, P2](权重 60, KR 数值型 40%), O2 个人发展类不挂项目(权重 40, KR 未完成)
//       B —— O1 挂 [P2](权重 100, KR 二元型已完成); C —— 老调用方, 不传 projectIds
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, sleep } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'
import { MAX_PROJECTS_PER_OBJECTIVE, UNASSIGNED_NAME } from '../../src/services/okrObjectiveProjects.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const WEEK = { year: rnd(2031, 2039), weekNo: rnd(2, 50) }
const WK = weekKey(WEEK)
const { start: WEEK_START, end: WEEK_END } = weekRange(WEEK.year, WEEK.weekNo)

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
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

async function waitAudit(where) {
  for (let i = 0; i < 20; i++) {
    const a = await prisma.auditLog.findFirst({ where, orderBy: { id: 'desc' } })
    if (a) return a
    await sleep(50)
  }
  return null
}

const ids = list => list.map(p => p.id).sort()
const rowOf = (rows, u) => rows.find(r => r.user?.id === u.id)
const linkRows = objectiveId => prisma.okrObjectiveProject.findMany({ where: { objectiveId: BigInt(objectiveId) }, orderBy: { projectId: 'asc' } })

describe('OKR 5.0 O 挂项目(多项目)', () => {
  let M, A, B, C, X, O
  let m, a, b, c, x, boss
  let customer, P1, P2, P3, PD
  let ownCustomer = false
  const teams = []
  // A 的计划(含 id), 后续用例在此基础上整份覆盖
  let aPlan

  const krA1 = { title: 'unit-test-v5 A-KR1 联调完成率', metricType: 'PERCENT', targetValue: 100 }
  const krA2 = { title: 'unit-test-v5 A-KR2 读完一本书', metricType: 'BINARY' }

  /** 用上一次返回的 O/KR id 重组 A 的计划; projectIds 由调用方覆盖 */
  function aBody({ o1Projects, o2Projects, extra = [] } = {}) {
    const [o1, o2] = aPlan
    const ob = (o, w, pids) => ({
      id: o.id, title: o.title, weight: w,
      keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, targetValue: k.targetValue })),
      ...(pids !== undefined ? { projectIds: pids } : {})
    })
    return { objectives: [ob(o1, 60, o1Projects), ob(o2, 40, o2Projects), ...extra] }
  }

  before(async () => {
    M = await createTestUser('MANAGER', { name: 'unit-test-v5-经理M' })
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v5-工程师A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v5-工程师B' })
    C = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v5-工程师C' })
    X = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v5-外组X' })
    O = await createTestUser('ADMIN', { name: 'unit-test-v5-老板O' })
    m = api(M.token); a = api(A.token); b = api(B.token); c = api(C.token); x = api(X.token); boss = api(O.token)

    const t1 = await prisma.team.create({ data: { name: uniqName('v5甲').slice(0, 50) } })
    const t2 = await prisma.team.create({ data: { name: uniqName('v5乙').slice(0, 50) } })
    teams.push(t1.id, t2.id)
    for (const u of [M, A, B, C]) await prisma.teamMembership.create({ data: { teamId: t1.id, userId: BigInt(u.id) } })
    await prisma.teamMembership.create({ data: { teamId: t2.id, userId: BigInt(X.id) } })

    // 借最老的现有客户挂项目, 不现建: 有用例借「最新的客户」建项目, 本用例删客户会和它们撞(1005 客户不存在)
    customer = await prisma.customer.findFirst({ where: { deletedAt: null }, orderBy: { id: 'asc' } })
    if (!customer) {
      customer = await prisma.customer.create({ data: { name: uniqName('v5客户').slice(0, 200) } })
      ownCustomer = true
    }
    const code = () => `UT-V5-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`.slice(0, 50)
    const mk = async (name, extra = {}) => prisma.project.create({ data: { code: code(), name: uniqName(name), customerId: customer.id, status: 'IN_PROGRESS', createdBy: BigInt(O.id), ...extra } })
    P1 = await mk('v5项目甲')
    P2 = await mk('v5项目乙')
    P3 = await mk('v5项目丙')
    PD = await mk('v5已删项目', { deletedAt: new Date() })

    await prisma.okrCycle.create({ data: { year: WEEK.year, weekNo: WEEK.weekNo, startDate: WEEK_START, endDate: WEEK_END, status: 'IN_PROGRESS' } })
  })

  after(async () => {
    await dropCycle(WEEK)
    const uids = [M, A, B, C, X, O].filter(Boolean).map(u => BigInt(u.id))
    const pids = [P1, P2, P3, PD].filter(Boolean).map(p => p.id)
    await prisma.okrObjectiveProject.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.project.deleteMany({ where: { id: { in: pids } } })
    if (customer && ownCustomer) await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: teams } } })
    await prisma.team.deleteMany({ where: { id: { in: teams } } })
    for (const u of [M, A, B, C, X, O]) await u?.cleanup()
  })

  // ---------------------------------------------------------------- 保存: 全量替换

  test('建 O 带 projectIds:[P1,P2] → /my 返回两个项目({id,name,code}); 改成 [P1] → 只剩一个; 审计 okr.plan.save 带 projectIds', async () => {
    const r = await a.post(`/api/okr/plan?week=${WK}`, {
      objectives: [
        { title: 'unit-test-v5 A-O1 交付 HVR + 罗星', weight: 60, keyResults: [krA1], projectIds: [String(P1.id), String(P2.id)] },
        { title: 'unit-test-v5 A-O2 个人成长', weight: 40, keyResults: [krA2], projectIds: [] }
      ]
    })
    assert.equal(r.status, 200, r.message)
    aPlan = r.data.objectives
    assert.deepEqual(ids(aPlan[0].projects), ids([{ id: String(P1.id) }, { id: String(P2.id) }]), '保存的返回里就带 projects')
    assert.deepEqual(aPlan[1].projects, [], '空数组 = 个人 O')

    const my = await a.get(`/api/okr/my?week=${WK}`)
    assert.equal(my.code, 0, my.message)
    const o1 = my.data.objectives.find(o => o.id === aPlan[0].id)
    assert.equal(o1.projects.length, 2)
    const p1 = o1.projects.find(p => p.id === String(P1.id))
    assert.deepEqual(p1, { id: String(P1.id), name: P1.name, code: P1.code })
    assert.deepEqual(my.data.objectives.find(o => o.id === aPlan[1].id).projects, [])

    const audit1 = await waitAudit({ userId: BigInt(A.id), action: 'okr.plan.save' })
    assert.ok(audit1, '显式设置了项目的保存要写审计')
    const d1 = typeof audit1.details === 'string' ? JSON.parse(audit1.details) : audit1.details
    assert.deepEqual([...d1.projectIds[aPlan[0].id]].sort(), [String(P1.id), String(P2.id)].sort())
    assert.deepEqual(d1.projectIds[aPlan[1].id], [])

    const r2 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [String(P1.id)], o2Projects: [] }))
    assert.equal(r2.status, 200, r2.message)
    const my2 = await a.get(`/api/okr/cycle?week=${WK}`)
    assert.deepEqual(my2.data.objectives.find(o => o.id === aPlan[0].id).projects.map(p => p.id), [String(P1.id)], '/cycle 同样带 projects, 全量替换生效')
    const links = await linkRows(aPlan[0].id)
    assert.deepEqual(links.map(l => String(l.projectId)), [String(P1.id)], '库里只剩一行')
    assert.equal(String(links[0].createdBy), A.id)
  })

  test('projectIds 校验: 不存在 / 已删除的项目 → 400 8171; 11 个 → 400 8170; 不是数组 → 400; 失败时关联不变', async () => {
    const before = (await linkRows(aPlan[0].id)).map(l => String(l.projectId))

    const r1 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [String(P1.id), '999999999999'] }))
    assert.equal(r1.status, 400)
    assert.equal(r1.code, 8171)
    assert.deepEqual(r1.data?.missing, ['999999999999'])

    const r2 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [String(PD.id)] }))
    assert.equal(r2.status, 400, '已软删的项目不能挂')
    assert.equal(r2.code, 8171)

    const eleven = Array.from({ length: MAX_PROJECTS_PER_OBJECTIVE + 1 }, (_, i) => String(Number(P1.id) + 100000 + i))
    const r3 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: eleven }))
    assert.equal(r3.status, 400)
    assert.equal(r3.code, 8170, '先按数量拦, 不用逐个查库')

    const r4 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: String(P1.id) }))
    assert.equal(r4.status, 400)
    assert.equal(r4.code, 8170)

    const r5 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: ['abc'] }))
    assert.equal(r5.status, 400)
    assert.equal(r5.code, 8170)

    // 重复的 id 去重后算 1 个
    const r6 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [String(P1.id), String(P1.id), Number(P1.id)] }))
    assert.equal(r6.status, 200, r6.message)

    assert.deepEqual((await linkRows(aPlan[0].id)).map(l => String(l.projectId)), before, '失败的保存整个事务回滚, 关联不变')
  })

  test('不传 projectIds = 不动已有关联; 传 [] = 清空; 删掉的 O 关联一并删除', async () => {
    const r1 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [String(P1.id), String(P2.id)], o2Projects: [] }))
    assert.equal(r1.status, 200, r1.message)
    // 老前端整份保存, 不带 projectIds
    const r2 = await a.post(`/api/okr/plan?week=${WK}`, aBody({}))
    assert.equal(r2.status, 200, r2.message)
    assert.equal(r2.data.objectives.find(o => o.id === aPlan[0].id).projects.length, 2, '没传 projectIds 不会把关联冲掉')

    // 临时加一个 O3 挂 P3, 再整份保存时去掉它 → O3 和它的关联都没了
    const r3 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ extra: [{ title: 'unit-test-v5 A-O3 临时', weight: 0, keyResults: [{ title: 'tmp', metricType: 'BINARY' }], projectIds: [String(P3.id)] }] }))
    assert.equal(r3.status, 200, r3.message)
    const o3 = r3.data.objectives.find(o => o.title === 'unit-test-v5 A-O3 临时')
    assert.equal((await linkRows(o3.id)).length, 1)
    const r4 = await a.post(`/api/okr/plan?week=${WK}`, aBody({}))
    assert.equal(r4.status, 200, r4.message)
    assert.equal(await prisma.okrObjective.count({ where: { id: BigInt(o3.id) } }), 0)
    assert.equal((await linkRows(o3.id)).length, 0, '删 O 时关联一并删')

    // 清空再恢复: [] → 0 行; 最后提交时恢复 O1 = [P1, P2](后续用例的基线)
    const r5 = await a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [] }))
    assert.equal(r5.status, 200, r5.message)
    assert.equal((await linkRows(aPlan[0].id)).length, 0)

    const sub = await a.post(`/api/okr/plan/submit?week=${WK}`, aBody({ o1Projects: [String(P1.id), String(P2.id)], o2Projects: [] }))
    assert.equal(sub.status, 200, sub.message)
    assert.equal(sub.data.objectives.find(o => o.id === aPlan[0].id).projects.length, 2)
    const audit = await waitAudit({ userId: BigInt(A.id), action: 'okr.plan.submit' })
    const d = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details
    assert.equal(d.projectIds[aPlan[0].id].length, 2, '提交的审计同样带 projectIds')
  })

  test('回归: 不传 projectIds 的老调用方照常保存 / 提交, 关联为空, 不写 okr.plan.save 审计', async () => {
    const r = await c.post(`/api/okr/plan/submit?week=${WK}`, { objectives: [{ title: 'unit-test-v5 C-O1 老调用方', keyResults: [{ title: 'C-KR1', metricType: 'BINARY' }] }] })
    assert.equal(r.status, 200, r.message)
    assert.deepEqual(r.data.objectives[0].projects, [])
    assert.equal((await linkRows(r.data.objectives[0].id)).length, 0)
    const my = await c.get(`/api/okr/my?week=${WK}`)
    assert.deepEqual(my.data.objectives[0].projects, [])
    await sleep(100)
    assert.equal(await prisma.auditLog.count({ where: { userId: BigInt(C.id), action: 'okr.plan.save' } }), 0, '本人保存、没设项目: 与 4.0 一样不记 plan.save')

    // B 用老格式交, 再由经理 M 代管补上项目(代管写权限沿用)
    const rb = await b.post(`/api/okr/plan/submit?week=${WK}`, { objectives: [{ title: 'unit-test-v5 B-O1 罗星上线', keyResults: [{ title: 'B-KR1 上线', metricType: 'BINARY' }] }] })
    assert.equal(rb.status, 200, rb.message)
    const ob = rb.data.objectives[0]
    const rm = await m.post(`/api/okr/plan?week=${WK}`, {
      targetUserId: B.id,
      objectives: [{ id: ob.id, title: ob.title, weight: 100, keyResults: ob.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType })), projectIds: [String(P2.id)] }]
    })
    assert.equal(rm.status, 200, rm.message)
    assert.deepEqual(rm.data.objectives[0].projects.map(p => p.id), [String(P2.id)])
    const links = await linkRows(ob.id)
    assert.equal(String(links[0].createdBy), M.id, '代管保存时 createdBy 记操作人')
    const audit = await waitAudit({ userId: BigInt(M.id), action: 'okr.plan.save' })
    const d = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details
    assert.equal(d.onBehalf, true)
    assert.deepEqual(d.projectIds[ob.id], [String(P2.id)])

    // 外组 X 不能替 B 改
    const rx = await x.post(`/api/okr/plan?week=${WK}`, { targetUserId: B.id, objectives: [{ id: ob.id, title: ob.title, weight: 100, keyResults: ob.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType })), projectIds: [] }] })
    assert.equal(rx.status, 403)
    assert.equal((await linkRows(ob.id)).length, 1)

    // 进度: A-O1 的 KR 40%, B-O1 的 KR 完成(后面分组完成度用)
    const krA = aPlan[0].keyResults[0]
    assert.equal((await a.patch(`/api/okr/krs/${krA.id}`, { currentValue: 40 })).code, 0)
    assert.equal((await b.post(`/api/okr/krs/${ob.keyResults[0].id}/complete`, { done: true })).code, 0)
  })

  // ---------------------------------------------------------------- 查询与筛选

  test('/team?projectId=P1 只留挂 P1 的 O; 没挂的人照样列出但 objectives 为空; 汇总口径不变; 不存在的项目 → 404', async () => {
    const all = await m.get(`/api/okr/team?week=${WK}`)
    assert.equal(all.code, 0, all.message)
    const aAll = rowOf(all.data.rows, A)
    assert.equal(aAll.objectives.length, 2)
    assert.equal(aAll.objectives.find(o => o.id === aPlan[0].id).projects.length, 2, '/team 的 O 带 projects')

    const r = await m.get(`/api/okr/team?week=${WK}&projectId=${P1.id}`)
    assert.equal(r.code, 0, r.message)
    assert.deepEqual(r.data.project, { id: String(P1.id), name: P1.name, code: P1.code })
    const ra = rowOf(r.data.rows, A)
    assert.deepEqual(ra.objectives.map(o => o.id), [aPlan[0].id], 'A 只剩挂 P1 的 O1')
    const rb = rowOf(r.data.rows, B)
    assert.ok(rb, 'B 没挂 P1 也照样出现')
    assert.equal(rb.objectives.length, 0)
    assert.ok(rowOf(r.data.rows, C), 'C 同样出现')
    assert.equal(rowOf(r.data.rows, C).objectives.length, 0)
    assert.equal(r.data.rows.length, all.data.rows.length, '筛选不减人')
    assert.equal(ra.objectiveCount, aAll.objectiveCount, '每行的汇总仍按人, 不因筛选变')
    assert.equal(ra.completion, aAll.completion)
    assert.deepEqual(r.data.summary, all.data.summary)

    const r2 = await m.get(`/api/okr/team?week=${WK}&projectId=${P2.id}`)
    assert.deepEqual(rowOf(r2.data.rows, B).objectives.map(o => o.projects.map(p => p.id)), [[String(P2.id)]])

    assert.equal((await m.get(`/api/okr/team?week=${WK}&projectId=999999999999`)).status, 404)
    assert.equal((await m.get(`/api/okr/team?week=${WK}&projectId=${PD.id}`)).status, 404, '已删项目 → 404')
  })

  test('/stats 每个 O 带项目名称数组, 汇总口径不变', async () => {
    const r = await a.get(`/api/okr/stats?scope=week&week=${WK}`)
    assert.equal(r.code, 0, r.message)
    const o1 = r.data.objectives.find(o => o.id === aPlan[0].id)
    assert.deepEqual([...o1.projects].sort(), [P1.name, P2.name].sort())
    assert.deepEqual(r.data.objectives.find(o => o.id === aPlan[1].id).projects, [])
    assert.equal(r.data.summary.objectiveCount, 2)
  })

  // ---------------------------------------------------------------- 分组接口

  test('/by-project 分组正确: 多项目 O 在每组各出现一次, 空关联归「未挂项目」(垫底); completion 与逐条 O 按权重加权一致', async () => {
    const r = await x.get(`/api/okr/by-project?week=${WK}`)
    assert.equal(r.code, 0, r.message)
    assert.ok(Array.isArray(r.data))
    const g = id => r.data.find(x => x.project.id === String(id))
    const g1 = g(P1.id); const g2 = g(P2.id)
    assert.deepEqual(g1.objectives.map(o => o.id), [aPlan[0].id])
    assert.deepEqual(g1.project, { id: String(P1.id), name: P1.name, code: P1.code })
    assert.equal(g1.ownerCount, 1)
    assert.deepEqual(g2.objectives.map(o => o.id).sort(), [aPlan[0].id, rowOfB().id].sort())
    assert.equal(g2.ownerCount, 2)
    assert.equal(g(P3.id), undefined, '没有 O 的项目不出组')

    const last = r.data[r.data.length - 1]
    assert.equal(last.project.id, null)
    assert.equal(last.project.name, UNASSIGNED_NAME)
    const unassignedIds = last.objectives.map(o => o.id)
    assert.ok(unassignedIds.includes(aPlan[1].id), 'A 的个人 O 进「未挂项目」')
    assert.ok(unassignedIds.length >= 2, 'C 的老格式 O 也在里面')
    assert.equal(r.data.filter(x => x.project.id === null).length, 1)

    // 逐条 O: 负责人 / 权重 / 完成度
    const a1 = g1.objectives[0]
    assert.equal(a1.owner.id, A.id)
    assert.equal(a1.weight, 60)
    assert.equal(a1.progress, 0.4)
    const b1 = g2.objectives.find(o => o.owner.id === B.id)
    assert.equal(b1.progress, 1)
    assert.equal(b1.weight, 100)
    // completion = Σ(weight × progress) / Σweight
    const weighted = list => {
      const live = list.filter(o => o.status !== 'DROPPED')
      return Math.round(live.reduce((s, o) => s + o.weight * o.progress, 0) / live.reduce((s, o) => s + o.weight, 0) * 10000) / 10000
    }
    for (const grp of r.data) assert.equal(grp.completion, weighted(grp.objectives), `${grp.project.name} 的 completion`)
    assert.equal(g1.completion, 0.4)
    assert.equal(g2.completion, Math.round((60 * 0.4 + 100 * 1) / 160 * 10000) / 10000)

    function rowOfB() { return g2.objectives.find(o => o.owner.id === B.id) }
  })

  test('/projects/:id/objectives: 某项目本周全部 O(负责人 / 权重 / 完成度 / 自评); 工程师看不到别人的 managerScore', async () => {
    const bo = await prisma.okrObjective.findFirst({ where: { ownerId: BigInt(B.id), cycle: { year: WEEK.year, weekNo: WEEK.weekNo } } })
    await prisma.okrObjective.update({ where: { id: bo.id }, data: { selfScore: 90, managerScore: 77, managerComment: 'unit-test-v5 评语' } })

    const r = await x.get(`/api/okr/projects/${P2.id}/objectives?week=${WK}`)
    assert.equal(r.code, 0, r.message)
    assert.deepEqual(r.data.project, { id: String(P2.id), name: P2.name, code: P2.code })
    assert.equal(r.data.week, WK)
    assert.deepEqual(r.data.objectives.map(o => o.id).sort(), [aPlan[0].id, String(bo.id)].sort())
    assert.equal(r.data.ownerCount, 2)
    const ob = r.data.objectives.find(o => o.id === String(bo.id))
    assert.equal(ob.owner.id, B.id)
    assert.equal(ob.owner.name, B.name)
    assert.equal(ob.weight, 100)
    assert.equal(ob.progress, 1)
    assert.equal(ob.selfScore, 90, '自评全员可见')
    assert.ok(!('managerScore' in ob), '工程师看不到别人的主管分')
    assert.ok(!('managerComment' in ob))
    assert.ok(Array.isArray(ob.projects))

    const own = await b.get(`/api/okr/projects/${P2.id}/objectives?week=${WK}`)
    assert.equal(own.data.objectives.find(o => o.id === String(bo.id)).managerScore, 77, '本人看得到自己的主管分')
    const rb = await boss.get(`/api/okr/projects/${P2.id}/objectives?week=${WK}`)
    assert.equal(rb.data.objectives.find(o => o.id === String(bo.id)).managerScore, 77, 'ADMIN 看得到')
    const rm = await m.get(`/api/okr/projects/${P2.id}/objectives?week=${WK}`)
    assert.equal(rm.data.objectives.find(o => o.id === String(bo.id)).managerScore, 77, '本团队经理看得到')

    const bp = await x.get(`/api/okr/by-project?week=${WK}`)
    assert.ok(!('managerScore' in bp.data.find(g => g.project.id === String(P2.id)).objectives.find(o => o.id === String(bo.id))), '/by-project 同样裁剪')

    const empty = await x.get(`/api/okr/projects/${P3.id}/objectives?week=${WK}`)
    assert.equal(empty.code, 0)
    assert.deepEqual(empty.data.objectives, [])
    assert.equal(empty.data.completion, null)
    assert.equal((await x.get(`/api/okr/projects/999999999999/objectives?week=${WK}`)).status, 404)
    assert.equal((await x.get(`/api/okr/projects/${P1.id}/objectives?week=bad`)).status, 400)
  })

  test('项目被删: 关联行保留, /my /by-project 里过滤掉', async () => {
    // B 的 O 加挂 P3, 然后软删 P3
    const bo = await prisma.okrObjective.findFirst({ where: { ownerId: BigInt(B.id), cycle: { year: WEEK.year, weekNo: WEEK.weekNo } } })
    await prisma.okrObjectiveProject.create({ data: { objectiveId: bo.id, projectId: P3.id, createdBy: BigInt(B.id) } })
    await prisma.project.update({ where: { id: P3.id }, data: { deletedAt: new Date() } })
    try {
      assert.equal((await linkRows(bo.id)).length, 2, '关联行还在')
      const my = await b.get(`/api/okr/my?week=${WK}`)
      assert.deepEqual(my.data.objectives[0].projects.map(p => p.id), [String(P2.id)])
      const bp = await x.get(`/api/okr/by-project?week=${WK}`)
      assert.equal(bp.data.find(g => g.project.id === String(P3.id)), undefined)
    } finally {
      await prisma.okrObjectiveProject.deleteMany({ where: { objectiveId: bo.id, projectId: P3.id } })
      await prisma.project.update({ where: { id: P3.id }, data: { deletedAt: null } })
    }
  })

  // ---------------------------------------------------------------- 并发

  test('并发保存同一 O 两次不同 projectIds → 两次都成功, 最终只剩其中一份关联', async () => {
    for (let round = 0; round < 5; round++) {
      const [r1, r2] = await Promise.all([
        a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [String(P1.id)] })),
        a.post(`/api/okr/plan?week=${WK}`, aBody({ o1Projects: [String(P2.id), String(P3.id)] }))
      ])
      assert.equal(r1.status, 200, r1.message)
      assert.equal(r2.status, 200, r2.message)
      const got = (await linkRows(aPlan[0].id)).map(l => String(l.projectId)).sort()
      const one = [String(P1.id)]
      const two = [String(P2.id), String(P3.id)].sort()
      assert.ok(JSON.stringify(got) === JSON.stringify(one) || JSON.stringify(got) === JSON.stringify(two), `第 ${round + 1} 轮最终关联应是其中一份, 实际 ${got}`)
      const my = await a.get(`/api/okr/my?week=${WK}`)
      assert.deepEqual(ids(my.data.objectives.find(o => o.id === aPlan[0].id).projects), got)
    }
  })
})
