// 集成测试 - 0.6.5: 管理员可以做所有人的主管确认(含自己那份)
//
// 老板原话: 管理员账号提交的 OKR 要等主管确认, 但系统里没有比 ADMIN 更高的角色, 那份永远停在 AWAITING_MANAGER。
// 规则: ADMIN 可以确认任何人(含自己), 「员工确认与主管确认要两个人」只约束 MANAGER / TEAM_LEAD; MANAGER 仍不能确认自己。
//
// 测试年份(与其他 OKR 用例错开): 2191–2199 年里连续的 4 周(以后的周, 周期由 prisma 现建 IN_PROGRESS), 绝不碰真实周。
// 人物: 工程师 E / M(MANAGER) / ADMIN(测试账号)。两个现建团队:
//   甲: 负责人 M, 成员 M / E / ADMIN   乙: 负责人 ADMIN, 成员 ADMIN / M
// 这样 managersOf(任何一人) 都落在这三个账号上, 员工确认的「待你确认」通知不会落到库里真实的 ADMIN 身上。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2191, 2199)
const BASE = rnd(2, 40)
const wk = i => ({ year: YEAR, weekNo: BASE + i })
const SELF = wk(0)    // ADMIN 自确认 / MANAGER 想自确认
const MPROXY = wk(1)  // M 代 E 点员工确认, 再点主管确认 → 仍 denied
const NORMAL = wk(2)  // E 自己确认, ADMIN 主管确认 → 行为不变
const APROXY = wk(3)  // ADMIN 代 E 点员工确认, 再点主管确认 → ADMIN 不受「两个人」限制
const WEEKS = [SELF, MPROXY, NORMAL, APROXY]
const K = w => weekKey(w)
const T = s => `unit-test-ac ${s}`

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

describe('0.6.5 管理员可以确认所有人的 OKR(含自己)', () => {
  let E, M, ADMIN
  let e, m, admin
  let teamA, teamB

  const confirmOwner = (client, week, targetUserId) => client.post('/api/okr/plan/confirm-owner', { week: K(week), ...(targetUserId ? { targetUserId } : {}) })
  const confirmManager = (client, week, userId) => client.post('/api/okr/plan/confirm-manager', { week: K(week), userId })
  const savePlan = (client, week, title, targetUserId) => client.post(`/api/okr/plan?week=${K(week)}`, {
    ...(targetUserId ? { targetUserId } : {}),
    objectives: [{ title: T(title), keyResults: [{ title: T(`${title} KR`) }] }]
  })
  const notes = async (userId, type, week) => (await prisma.notification.findMany({ where: { userId: BigInt(userId), type } }))
    .filter(n => JSON.parse(n.data || '{}').week === K(week))
  const planAudit = async (week, ownerId, action) => {
    const c = await cycleOf(week)
    return prisma.okrPlanAudit.findMany({ where: { cycleId: c.id, ownerId: BigInt(ownerId), action }, orderBy: { id: 'asc' } })
  }
  const sysAudit = async (actorId, week, ownerId) => (await prisma.auditLog.findMany({ where: { userId: BigInt(actorId), action: 'okr.plan.confirm-manager' }, orderBy: { id: 'asc' } }))
    .map(r => ({ ...r, d: typeof r.details === 'string' ? JSON.parse(r.details) : r.details }))
    .filter(r => r.d?.week === K(week) && String(r.d?.ownerId) === String(ownerId))

  before(async () => {
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-ac-工程师E' })
    M = await createTestUser('MANAGER', { name: 'unit-test-ac-主管M' })
    ADMIN = await createTestUser('ADMIN', { name: 'unit-test-ac-老板' })
    e = api(E.token); m = api(M.token); admin = api(ADMIN.token)
    teamA = await prisma.team.create({ data: { name: uniqName('ac甲').slice(0, 50), status: 1, leaderId: BigInt(M.id) } })
    teamB = await prisma.team.create({ data: { name: uniqName('ac乙').slice(0, 50), status: 1, leaderId: BigInt(ADMIN.id) } })
    for (const u of [M, E, ADMIN]) await prisma.teamMembership.create({ data: { teamId: teamA.id, userId: BigInt(u.id) } })
    for (const u of [ADMIN, M]) await prisma.teamMembership.create({ data: { teamId: teamB.id, userId: BigInt(u.id) } })
    for (const w of WEEKS) {
      await dropCycle(w)
      const { start, end } = weekRange(w.year, w.weekNo)
      await prisma.okrCycle.create({ data: { year: w.year, weekNo: w.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS' } })
    }
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

  test('1. ADMIN 提交自己的计划 → confirm-owner → confirm-manager{userId: 自己} → 200, lockStatus=CONFIRMED', async () => {
    const s = await savePlan(admin, SELF, '老板自己的 O')
    assert.equal(s.status, 200, s.message)
    const o = await confirmOwner(admin, SELF)
    assert.equal(o.status, 200, o.message)
    assert.equal(o.data.lockStatus, 'AWAITING_MANAGER')
    assert.equal(o.data.ownerConfirmedBy.id, ADMIN.id)
    // 入口: 自己那份待主管确认时, ADMIN 的 can.confirmManager=true
    const before = await admin.get(`/api/okr/my?week=${K(SELF)}`)
    assert.equal(before.status, 200, before.message)
    assert.equal(before.data.can.confirmManager, true)

    const r = await confirmManager(admin, SELF, ADMIN.id)
    console.log(`ℹ admin self-confirm POST /api/okr/plan/confirm-manager ${JSON.stringify({ week: K(SELF), userId: ADMIN.id })} → ${r.status} ${JSON.stringify({ code: r.code, data: r.data })}`)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.changed, true)
    assert.equal(r.data.lockStatus, 'CONFIRMED')
    assert.equal(r.data.managerConfirmedBy.id, ADMIN.id)
    // 重复点不报错、不重复留痕
    const again = await confirmManager(admin, SELF, ADMIN.id)
    assert.equal(again.status, 200, again.message)
    assert.equal(again.data.changed, false)
    // 锁定后自己也不能直接改
    const edit = await savePlan(admin, SELF, '锁定后再改')
    assert.equal(edit.status, 400)
    assert.equal(edit.code, 8201)
  })

  test('2. 自确认留痕: MANAGER_CONFIRM 且 details 含 selfConfirm=true; 通知文案「已由管理员确认并锁定」', async () => {
    const rows = await planAudit(SELF, ADMIN.id, 'MANAGER_CONFIRM')
    assert.equal(rows.length, 1)
    assert.equal(String(rows[0].actorId), ADMIN.id)
    assert.equal(rows[0].afterText, '已确认(锁定, 管理员自确认)')
    // /plan/audit 视图
    const view = await admin.get(`/api/okr/plan/audit?week=${K(SELF)}&userId=${ADMIN.id}`)
    assert.equal(view.status, 200, view.message)
    const item = view.data.items.find(i => i.action === 'MANAGER_CONFIRM')
    console.log(`ℹ admin self-confirm audit item ${JSON.stringify(item)}`)
    assert.deepEqual(item.details, { selfConfirm: true })
    assert.equal(item.actionLabel, '主管确认')
    // 系统审计(audit_logs)
    const sys = await sysAudit(ADMIN.id, SELF, ADMIN.id)
    assert.equal(sys.length, 1)
    console.log(`ℹ admin self-confirm audit_logs ${JSON.stringify({ action: sys[0].action, details: sys[0].d })}`)
    assert.equal(sys[0].d.selfConfirm, true)
    // 通知: 发给自己, 但不是「主管已确认」
    const n = await notes(ADMIN.id, 'OKR_PLAN_CONFIRMED', SELF)
    assert.equal(n.length, 1)
    assert.equal(n[0].title, `${K(SELF)} OKR 已由管理员确认并锁定`)
    assert.ok(!n[0].body.includes('主管已确认'), n[0].body)
  })

  test('3. MANAGER 想确认自己 → 仍 403 / 8206; 入口不给', async () => {
    const s = await savePlan(m, SELF, '主管自己的 O')
    assert.equal(s.status, 200, s.message)
    const o = await confirmOwner(m, SELF)
    assert.equal(o.status, 200, o.message)
    const my = await m.get(`/api/okr/my?week=${K(SELF)}`)
    assert.equal(my.data.can.confirmManager, false)
    const r = await confirmManager(m, SELF, M.id)
    assert.equal(r.status, 403)
    assert.equal(r.code, 8206)
    const st = await m.get(`/api/okr/plan/confirm-status?week=${K(SELF)}&userId=${M.id}`)
    assert.equal(st.data.lockStatus, 'AWAITING_MANAGER')
    assert.equal((await planAudit(SELF, M.id, 'MANAGER_CONFIRM')).length, 0)
  })

  test('4. MANAGER 代员工点了员工确认, 再点主管确认 → 仍 403 / 8206(原规则不放松)', async () => {
    const s = await savePlan(m, MPROXY, 'M 代 E 的 O', E.id)
    assert.equal(s.status, 200, s.message)
    const o = await confirmOwner(m, MPROXY, E.id)
    assert.equal(o.status, 200, o.message)
    assert.equal(o.data.ownerConfirmedBy.id, M.id)
    const view = await m.get(`/api/okr/cycle?week=${K(MPROXY)}&userId=${E.id}`)
    assert.equal(view.status, 200, view.message)
    assert.equal(view.data.can.confirmManager, false)
    const r = await confirmManager(m, MPROXY, E.id)
    assert.equal(r.status, 403)
    assert.equal(r.code, 8206)
    assert.equal((await m.get(`/api/okr/plan/confirm-status?week=${K(MPROXY)}&userId=${E.id}`)).data.lockStatus, 'AWAITING_MANAGER')
  })

  test('5. ADMIN 确认别人(员工已自己确认)→ 200, 行为不变: 无 selfConfirm, 通知仍是「已确认，已锁定」', async () => {
    const s = await savePlan(e, NORMAL, 'E 自己的 O')
    assert.equal(s.status, 200, s.message)
    const o = await confirmOwner(e, NORMAL)
    assert.equal(o.status, 200, o.message)
    const r = await confirmManager(admin, NORMAL, E.id)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.lockStatus, 'CONFIRMED')
    assert.equal(r.data.managerConfirmedBy.id, ADMIN.id)
    const rows = await planAudit(NORMAL, E.id, 'MANAGER_CONFIRM')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].afterText, '已确认(锁定)')
    const item = (await e.get(`/api/okr/plan/audit?week=${K(NORMAL)}&userId=${E.id}`)).data.items.find(i => i.action === 'MANAGER_CONFIRM')
    assert.equal(item.details, undefined)
    const sys = await sysAudit(ADMIN.id, NORMAL, E.id)
    assert.equal(sys.length, 1)
    assert.equal(sys[0].d.selfConfirm, undefined)
    const n = await notes(E.id, 'OKR_PLAN_CONFIRMED', NORMAL)
    assert.equal(n.length, 1)
    assert.equal(n[0].title, `W${String(NORMAL.weekNo).padStart(2, '0')} OKR 已确认，已锁定；要改请提交变更申请`)
    assert.equal(n[0].body, `${K(NORMAL)} 的计划主管已确认`)
  })

  test('6. ADMIN 代员工点了员工确认, 再点主管确认 → 200(「两个人」只约束主管, ADMIN 不受限)', async () => {
    const s = await savePlan(admin, APROXY, 'ADMIN 代 E 的 O', E.id)
    assert.equal(s.status, 200, s.message)
    const o = await confirmOwner(admin, APROXY, E.id)
    assert.equal(o.status, 200, o.message)
    assert.equal(o.data.ownerConfirmedBy.id, ADMIN.id)
    const view = await admin.get(`/api/okr/cycle?week=${K(APROXY)}&userId=${E.id}`)
    assert.equal(view.data.can.confirmManager, true)
    const r = await confirmManager(admin, APROXY, E.id)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.lockStatus, 'CONFIRMED')
    // 不是自确认(owner ≠ actor): 不标 selfConfirm
    assert.equal((await sysAudit(ADMIN.id, APROXY, E.id))[0].d.selfConfirm, undefined)
  })
})
