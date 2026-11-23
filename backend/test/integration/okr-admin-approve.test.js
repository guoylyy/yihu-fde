// 集成测试 - 0.6.6: 管理员也能批准 / 驳回 OKR 变更申请(含自己计划上的、自己提的)
//
// 老板原话: 「变更申请已提交，等主管批准 —— 这里最好管理员也能批准。」
// 规则: ADMIN 审批不受「不能批自己的 / 不能批自己提的」限制(与 0.6.5 自确认同理); MANAGER 两条限制原样保留。
// 自审批(ADMIN 且 owner = actor 或 requester = actor)留痕: okr_plan_audit afterText 带「管理员自审批」(/plan/audit 视图 details.selfDecide),
// audit_logs details.selfDecide = true。
//
// 测试年份(与其他 OKR 用例错开): 2201–2209 年里连续的 2 周(以后的周, 周期由 prisma 现建 IN_PROGRESS), 绝不碰真实周。
// 人物 / 团队同 okr-admin-confirm: 甲(负责人 M; M / E / ADMIN)、乙(负责人 ADMIN; ADMIN / M),
// managersOf 永远落在这三个测试账号上, 通知不会发到库里真实的 ADMIN。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2201, 2209)
const BASE = rnd(2, 40)
const wk = i => ({ year: YEAR, weekNo: BASE + i })
const W1 = wk(0)  // ADMIN 自己: 自批 → 自驳; M 自己: 自批 403; E: ADMIN 批
const W2 = wk(1)  // ADMIN 代 E 提 → M 批; M 代 E 提 → M 自己批 403 → ADMIN 批; ADMIN 自己: M 批 403
const WEEKS = [W1, W2]
const K = w => weekKey(w)
const T = s => `unit-test-aa ${s}`

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

describe('0.6.6 管理员可以审批 OKR 变更申请(含自己提的)', () => {
  let E, M, ADMIN
  let e, m, admin
  let teamA, teamB

  const savePlan = (client, week, title, targetUserId) => client.post(`/api/okr/plan?week=${K(week)}`, {
    ...(targetUserId ? { targetUserId } : {}),
    objectives: [{ title: T(title), keyResults: [{ title: T(`${title} KR`) }] }]
  })
  const confirmOwner = (client, week, targetUserId) => client.post('/api/okr/plan/confirm-owner', { week: K(week), ...(targetUserId ? { targetUserId } : {}) })
  const confirmManager = (client, week, userId) => client.post('/api/okr/plan/confirm-manager', { week: K(week), userId })
  /** 当前计划(与 POST /plan 同形), 用来拼变更申请 */
  async function current(client, week, userId) {
    const r = await client.get(`/api/okr/cycle?week=${K(week)}&userId=${userId}`)
    assert.equal(r.status, 200, r.message)
    return r.data.objectives.map(o => ({
      id: o.id, title: o.title, weight: o.weight, description: o.description,
      keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, unit: k.unit, targetValue: k.targetValue, weight: k.weight }))
    }))
  }
  /** 存计划 → 员工确认 → 主管确认(由 confirmer 做), 得到 CONFIRMED */
  async function lockedPlan(ownerClient, owner, week, title, confirmer) {
    assert.equal((await savePlan(ownerClient, week, title)).status, 200)
    assert.equal((await confirmOwner(ownerClient, week)).status, 200)
    const r = await confirmManager(confirmer, week, owner.id)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.lockStatus, 'CONFIRMED')
  }
  /** client 给 owner 提一条改 O1 标题的变更申请 */
  async function requestRetitle(client, week, owner, newTitle, reason) {
    const objs = await current(client, week, owner.id)
    objs[0].title = T(newTitle)
    const body = { week: K(week), reason, objectives: objs, ...(String(client.id) !== String(owner.id) ? { targetUserId: owner.id } : {}) }
    const r = await client.post('/api/okr/plan/changes', body)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'PENDING')
    return r.data.id
  }
  const titleOf = async (week, ownerId) => {
    const c = await cycleOf(week)
    const o = await prisma.okrObjective.findFirst({ where: { cycleId: c.id, ownerId: BigInt(ownerId) }, orderBy: { id: 'asc' } })
    return o?.title
  }
  const planAudit = async (week, ownerId, action) => {
    const c = await cycleOf(week)
    return prisma.okrPlanAudit.findMany({ where: { cycleId: c.id, ownerId: BigInt(ownerId), action }, orderBy: { id: 'asc' } })
  }
  const sysAudit = async (action, changeId) => (await prisma.auditLog.findMany({ where: { action, resourceType: 'okr_plan_change', resourceId: BigInt(changeId) }, orderBy: { id: 'asc' } }))
    .map(r => ({ ...r, d: typeof r.details === 'string' ? JSON.parse(r.details) : r.details }))

  before(async () => {
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-aa-工程师E' })
    M = await createTestUser('MANAGER', { name: 'unit-test-aa-主管M' })
    ADMIN = await createTestUser('ADMIN', { name: 'unit-test-aa-老板' })
    e = api(E.token); m = api(M.token); admin = api(ADMIN.token)
    e.id = E.id; m.id = M.id; admin.id = ADMIN.id
    teamA = await prisma.team.create({ data: { name: uniqName('aa甲').slice(0, 50), status: 1, leaderId: BigInt(M.id) } })
    teamB = await prisma.team.create({ data: { name: uniqName('aa乙').slice(0, 50), status: 1, leaderId: BigInt(ADMIN.id) } })
    for (const u of [M, E, ADMIN]) await prisma.teamMembership.create({ data: { teamId: teamA.id, userId: BigInt(u.id) } })
    for (const u of [ADMIN, M]) await prisma.teamMembership.create({ data: { teamId: teamB.id, userId: BigInt(u.id) } })
    for (const w of WEEKS) {
      await dropCycle(w)
      const { start, end } = weekRange(w.year, w.weekNo)
      await prisma.okrCycle.create({ data: { year: w.year, weekNo: w.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS' } })
    }
    // W1: 三个人的计划都锁定(ADMIN 自确认; M / E 由 ADMIN 确认)
    await lockedPlan(admin, ADMIN, W1, '老板的 O', admin)
    await lockedPlan(m, M, W1, '主管的 O', admin)
    await lockedPlan(e, E, W1, '工程师的 O', admin)
    await lockedPlan(e, E, W2, '工程师 W2 的 O', admin)
    await lockedPlan(admin, ADMIN, W2, '老板 W2 的 O', admin)
  })

  after(async () => {
    const users = [E, M, ADMIN].filter(Boolean)
    for (const w of WEEKS) await dropCycle(w).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map(u => BigInt(u.id)) } } }).catch(() => {})
    for (const t of [teamA, teamB].filter(Boolean)) {
      await prisma.teamMembership.deleteMany({ where: { teamId: t.id } }).catch(() => {})
      await prisma.team.delete({ where: { id: t.id } }).catch(() => {})
    }
    for (const u of users) await u.cleanup()
  })

  test('1. ADMIN 对自己的计划提变更申请 → ADMIN 自己批准 → 200, 计划生效, 留痕 selfDecide', async () => {
    const id = await requestRetitle(admin, W1, ADMIN, '老板的 O(变更 1)', '客户要求提前一周交付')
    const r = await admin.post(`/api/okr/plan/changes/${id}/approve`, { note: '自己批' })
    console.log(`ℹ admin self-approve POST /api/okr/plan/changes/${id}/approve ${JSON.stringify({ note: '自己批' })} → ${r.status} ${JSON.stringify({ code: r.code, data: { id: r.data?.id, week: r.data?.week, status: r.data?.status, owner: r.data?.owner, requestedBy: r.data?.requestedBy, decidedBy: r.data?.decidedBy, decisionNote: r.data?.decisionNote, appliedAt: r.data?.appliedAt, diffCount: r.data?.diffCount, selfDecide: r.data?.selfDecide } })}`)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'APPROVED')
    assert.equal(r.data.decidedBy.id, ADMIN.id)
    assert.ok(r.data.appliedAt)
    assert.equal(r.data.selfDecide, true)
    assert.equal(await titleOf(W1, ADMIN.id), T('老板的 O(变更 1)'))
    // 仍是锁定状态, 待批申请清空
    const st = await admin.get(`/api/okr/plan/confirm-status?week=${K(W1)}&userId=${ADMIN.id}`)
    assert.equal(st.data.lockStatus, 'CONFIRMED')
    assert.equal(st.data.pendingChange, null)
    // okr_plan_audit
    const rows = await planAudit(W1, ADMIN.id, 'CHANGE_APPROVE')
    assert.equal(rows.length, 1)
    assert.equal(String(rows[0].actorId), ADMIN.id)
    assert.match(rows[0].afterText, /^已批准并生效\(管理员自审批\)，改动 1 处；意见：自己批$/)
    const view = await admin.get(`/api/okr/plan/audit?week=${K(W1)}&userId=${ADMIN.id}`)
    const item = view.data.items.find(i => i.action === 'CHANGE_APPROVE')
    console.log(`ℹ admin self-approve okr_plan_audit item ${JSON.stringify(item)}`)
    assert.deepEqual(item.details, { selfDecide: true })
    // audit_logs
    const sys = await sysAudit('okr.plan.change-approve', id)
    assert.equal(sys.length, 1)
    console.log(`ℹ admin self-approve audit_logs ${JSON.stringify({ id: String(sys[0].id), userId: String(sys[0].userId), action: sys[0].action, resourceType: sys[0].resourceType, resourceId: String(sys[0].resourceId), details: sys[0].d })}`)
    assert.equal(String(sys[0].userId), ADMIN.id)
    assert.equal(sys[0].d.selfDecide, true)
    assert.equal(sys[0].d.ownerId, ADMIN.id)
  })

  // 注: MANAGER 的审批范围本来就不含 ADMIN(managerScoreScope 把 ADMIN 剔掉), 所以「ADMIN 自己计划上的申请由主管批」从来不是一条路径;
  // 原有路径 = ADMIN 代员工提申请、员工所在团队的主管批准
  test('2. ADMIN 代员工提、本团队 MANAGER 批准 → 200(原有路径), 不标 selfDecide', async () => {
    const id = await requestRetitle(admin, W2, E, '工程师 W2 的 O(老板代改)', '老板代员工调整范围')
    const r = await m.post(`/api/okr/plan/changes/${id}/approve`, {})
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'APPROVED')
    assert.equal(r.data.requestedBy.id, ADMIN.id)
    assert.equal(r.data.decidedBy.id, M.id)
    assert.equal(r.data.selfDecide, undefined)
    assert.equal(await titleOf(W2, E.id), T('工程师 W2 的 O(老板代改)'))
    const rows = await planAudit(W2, E.id, 'CHANGE_APPROVE')
    assert.equal(rows.length, 1)
    assert.ok(!rows[0].afterText.includes('管理员自审批'), rows[0].afterText)
    assert.equal((await sysAudit('okr.plan.change-approve', id))[0].d.selfDecide, undefined)
    // MANAGER 批不了 ADMIN 自己计划上的申请(范围外, 规则不变)
    const adminOwn = await requestRetitle(admin, W2, ADMIN, '老板 W2 的 O(变更)', '主管批不了这条')
    const out = await m.post(`/api/okr/plan/changes/${adminOwn}/approve`, {})
    assert.equal(out.status, 403)
    assert.equal(out.code, 8206)
    assert.equal((await admin.post(`/api/okr/plan/changes/${adminOwn}/cancel`)).status, 200)
  })

  test('3. MANAGER 批自己提的申请 → 仍 403 / 8206(自己计划上的、代别人提的都一样)', async () => {
    // a) 自己计划上、自己提的
    const own = await requestRetitle(m, W1, M, '主管的 O(变更)', '自己想改一下')
    const r1 = await m.post(`/api/okr/plan/changes/${own}/approve`, {})
    assert.equal(r1.status, 403)
    assert.equal(r1.code, 8206)
    const r1b = await m.post(`/api/okr/plan/changes/${own}/reject`, { note: '自己驳' })
    assert.equal(r1b.status, 403)
    assert.equal(r1b.code, 8206)
    assert.equal(await titleOf(W1, M.id), T('主管的 O'))
    // b) 代 E 提的(自己提的)
    const proxy = await requestRetitle(m, W2, E, '工程师 W2 的 O(主管代改)', '主管代员工调整')
    const r2 = await m.post(`/api/okr/plan/changes/${proxy}/approve`, {})
    assert.equal(r2.status, 403)
    assert.equal(r2.code, 8206)
    assert.equal(await titleOf(W2, E.id), T('工程师 W2 的 O(老板代改)'))
    // 两条都还是 PENDING, 交给 ADMIN 批 → 200(ADMIN 不是申请人也不是负责人, 不算自审批)
    const ok1 = await admin.post(`/api/okr/plan/changes/${own}/approve`, {})
    assert.equal(ok1.status, 200, ok1.message)
    assert.equal(ok1.data.selfDecide, undefined)
    const ok2 = await admin.post(`/api/okr/plan/changes/${proxy}/approve`, {})
    assert.equal(ok2.status, 200, ok2.message)
    assert.equal(await titleOf(W2, E.id), T('工程师 W2 的 O(主管代改)'))
  })

  test('4. ADMIN 驳回自己提的申请 → 200, REJECTED, 计划不变, 留痕 selfDecide', async () => {
    const before = await titleOf(W1, ADMIN.id)
    const id = await requestRetitle(admin, W1, ADMIN, '老板的 O(变更 3, 会被驳回)', '再试一个方向')
    const noNote = await admin.post(`/api/okr/plan/changes/${id}/reject`, {})
    assert.equal(noNote.status, 400)
    assert.equal(noNote.code, 8205)
    const r = await admin.post(`/api/okr/plan/changes/${id}/reject`, { note: '想了想还是不改' })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'REJECTED')
    assert.equal(r.data.decidedBy.id, ADMIN.id)
    assert.equal(r.data.appliedAt, null)
    assert.equal(r.data.selfDecide, true)
    assert.equal(await titleOf(W1, ADMIN.id), before)
    const rows = await planAudit(W1, ADMIN.id, 'CHANGE_REJECT')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].afterText, '已驳回(管理员自审批)，计划不变')
    const item = (await admin.get(`/api/okr/plan/audit?week=${K(W1)}&userId=${ADMIN.id}`)).data.items.find(i => i.action === 'CHANGE_REJECT')
    assert.deepEqual(item.details, { selfDecide: true })
    assert.equal((await sysAudit('okr.plan.change-reject', id))[0].d.selfDecide, true)
  })

  test('5. 工程师的申请、ADMIN 批准 → 200(原有路径), 不标 selfDecide', async () => {
    const id = await requestRetitle(e, W1, E, '工程师的 O(变更)', '需求方改了验收口径')
    // 工程师自己不能批
    const self = await e.post(`/api/okr/plan/changes/${id}/approve`, {})
    assert.equal(self.status, 403)
    const r = await admin.post(`/api/okr/plan/changes/${id}/approve`, { note: '同意' })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'APPROVED')
    assert.equal(r.data.selfDecide, undefined)
    assert.equal(await titleOf(W1, E.id), T('工程师的 O(变更)'))
    const rows = await planAudit(W1, E.id, 'CHANGE_APPROVE')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].afterText, '已批准并生效，改动 1 处；意见：同意')
    const item = (await e.get(`/api/okr/plan/audit?week=${K(W1)}&userId=${E.id}`)).data.items.find(i => i.action === 'CHANGE_APPROVE')
    assert.equal(item.details, undefined)
    assert.equal((await sysAudit('okr.plan.change-approve', id))[0].d.selfDecide, undefined)
  })
  test('6. 不传 week + ADMIN → 返回跨周的全部 PENDING(按 createdAt 倒序); 传 week 只回那一周', async () => {
    const a = await requestRetitle(e, W1, E, '工程师的 O(跨周 W1)', 'W1 的变更')
    const b = await requestRetitle(e, W2, E, '工程师 W2 的 O(跨周 W2)', 'W2 的变更')
    const all = await admin.get('/api/okr/plan/changes?status=PENDING')
    assert.equal(all.status, 200, all.message)
    const mine = all.data.filter(c => c.id === a || c.id === b)
    console.log(`ℹ admin GET /api/okr/plan/changes?status=PENDING (no week) → ${all.status} total=${all.data.length} ${JSON.stringify(mine.map(c => ({ id: c.id, week: c.week, status: c.status, owner: c.owner?.name, requestedBy: c.requestedBy?.name, createdAt: c.createdAt })))}`)
    assert.deepEqual(mine.map(c => c.id), [b, a], '两周的申请都在, 新的在前')
    assert.deepEqual(mine.map(c => c.week), [K(W2), K(W1)])
    assert.ok(all.data.every(c => c.status === 'PENDING'))
    for (let i = 1; i < all.data.length; i++) assert.ok(new Date(all.data[i - 1].createdAt) >= new Date(all.data[i].createdAt), '按 createdAt 倒序')
    // 空 week 参数同样视为不传
    const blank = await admin.get('/api/okr/plan/changes?status=PENDING&week=')
    assert.equal(blank.status, 200, blank.message)
    assert.deepEqual(blank.data.filter(c => c.id === a || c.id === b).map(c => c.id), [b, a])
    // 传 week 只回那一周
    const w1 = await admin.get(`/api/okr/plan/changes?status=PENDING&week=${K(W1)}`)
    assert.equal(w1.status, 200, w1.message)
    assert.deepEqual(w1.data.map(c => c.id), [a])
    // 收尾: 撤回, 不影响别的用例
    for (const id of [a, b]) assert.equal((await e.post(`/api/okr/plan/changes/${id}/cancel`)).status, 200)
  })
})
