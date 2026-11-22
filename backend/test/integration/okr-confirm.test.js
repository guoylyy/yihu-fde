// 集成测试 - 0.6.2: OKR 二级确认 + 变更申请 + 计划层修改记录
//
// 测试年份(与其他 OKR 用例错开): 2161–2169 年里连续的 7 周(以后的周, 周期由 prisma 现建: 6 周 IN_PROGRESS + 1 周 CLOSED), 绝不碰真实周。
// 人物: 工程师 A(主角, 团队甲) / 工程师 B(团队乙) / M(MANAGER, 团队甲负责人) / M2(MANAGER, 团队乙负责人) / ADMIN。
// 账号、团队现建现删; 三张新表按测试周期硬删(helpers.dropPlanTrail)。主角都在团队里, 通知不会落到库里真实的 ADMIN 身上。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2161, 2169)
const BASE = rnd(2, 40)
const wk = i => ({ year: YEAR, weekNo: BASE + i })
const MAIN = wk(0)      // 主流程: 提交 → 确认 → 锁定 → 变更申请
const AUDIT = wk(1)     // 修改记录四类(未确认, 直接改)
const PROG = wk(2)      // 锁定后进展 / 完成 / 评分照常可写, 且不进修改记录
const DRAFT = wk(3)     // 没提交也能确认; 锁定后复制 / 批量导入同样被拦
const CLOSED = wk(4)    // 已归档
const SAVED = wk(5)     // 只保存不提交 → 确认 = 一并提交
const SUBMITTED = wk(6) // 先提交再确认 → 提交时间不被覆盖
const WEEKS = [MAIN, AUDIT, PROG, DRAFT, CLOSED, SAVED, SUBMITTED]
const K = w => weekKey(w)

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

/** 计划快照(只取计划层字段, 用来比「没变」) */
async function planSnapshot(week, ownerId) {
  const c = await cycleOf(week)
  const objs = await prisma.okrObjective.findMany({
    where: { cycleId: c.id, ownerId: BigInt(ownerId) }, orderBy: { seq: 'asc' },
    include: { keyResults: { orderBy: { seq: 'asc' } } }
  })
  return JSON.stringify(objs.map(o => ({
    id: String(o.id), seq: o.seq, title: o.title, weight: o.weight, description: o.description,
    krs: o.keyResults.map(k => ({ id: String(k.id), seq: k.seq, title: k.title, metricType: k.metricType, unit: k.unit, targetValue: k.targetValue, weight: k.weight }))
  })))
}

async function auditRows(week, ownerId) {
  const c = await cycleOf(week)
  return prisma.okrPlanAudit.findMany({ where: { cycleId: c.id, ownerId: BigInt(ownerId) }, orderBy: { id: 'asc' } })
}

const T = s => `unit-test-cf ${s}`

describe('0.6.2 OKR 二级确认 / 变更申请 / 修改记录', () => {
  let A, B, M, M2, ADMIN
  let a, b, m, m2, admin
  let teamA, teamB
  let mainPlan    // MAIN 周提交后的 /cycle 数据
  const changeIds = {}

  const status = (u, week, userId) => api(u.token).get(`/api/okr/plan/confirm-status?week=${K(week)}&userId=${userId}`)
  const confirmOwner = (client, week, targetUserId) => client.post('/api/okr/plan/confirm-owner', { week: K(week), ...(targetUserId ? { targetUserId } : {}) })
  const confirmManager = (client, week, userId) => client.post('/api/okr/plan/confirm-manager', { week: K(week), userId })

  /** 当前计划 → POST /plan 同形(带 id) */
  async function currentObjectives(week, client = a) {
    const r = await client.get(`/api/okr/my?week=${K(week)}`)
    assert.equal(r.status, 200, r.message)
    return r.data.objectives.map(o => ({
      id: o.id, title: o.title, weight: o.weight, description: o.description,
      keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, unit: k.unit, targetValue: k.targetValue, weight: k.weight }))
    }))
  }

  before(async () => {
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-cf-工程师A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-cf-工程师B' })
    M = await createTestUser('MANAGER', { name: 'unit-test-cf-主管M' })
    M2 = await createTestUser('MANAGER', { name: 'unit-test-cf-主管M2' })
    ADMIN = await createTestUser('ADMIN', { name: 'unit-test-cf-老板' })
    a = api(A.token); b = api(B.token); m = api(M.token); m2 = api(M2.token); admin = api(ADMIN.token)
    teamA = await prisma.team.create({ data: { name: uniqName('cf甲').slice(0, 50), status: 1, leaderId: BigInt(M.id) } })
    teamB = await prisma.team.create({ data: { name: uniqName('cf乙').slice(0, 50), status: 1, leaderId: BigInt(M2.id) } })
    for (const u of [M, A]) await prisma.teamMembership.create({ data: { teamId: teamA.id, userId: BigInt(u.id) } })
    for (const u of [M2, B]) await prisma.teamMembership.create({ data: { teamId: teamB.id, userId: BigInt(u.id) } })
    for (const w of WEEKS) {
      await dropCycle(w)
      const { start, end } = weekRange(w.year, w.weekNo)
      await prisma.okrCycle.create({ data: { year: w.year, weekNo: w.weekNo, startDate: start, endDate: end, status: w === CLOSED ? 'CLOSED' : 'IN_PROGRESS' } })
    }
    // 归档周里 A 有一个 O(prisma 直接建)
    const closed = await cycleOf(CLOSED)
    await prisma.okrObjective.create({ data: { cycleId: closed.id, ownerId: BigInt(A.id), title: T('归档周 O'), weight: 100, submittedAt: new Date() } })

    // MAIN: A 提交 O1(60: BINARY 50 + NUMBER 10 个 50) / O2(40: PERCENT 100)
    const r = await a.post(`/api/okr/plan/submit?week=${K(MAIN)}`, {
      objectives: [
        { title: T('O1 订单模块上线'), weight: 60, keyResults: [
          { title: T('KR 上线'), metricType: 'BINARY', weight: 50 },
          { title: T('KR 门店数'), metricType: 'NUMBER', targetValue: 10, unit: '个', weight: 50 }
        ] },
        { title: T('O2 回访'), weight: 40, keyResults: [{ title: T('KR 回访覆盖率'), metricType: 'PERCENT', targetValue: 100, weight: 100 }] }
      ]
    })
    assert.equal(r.status, 200, r.message)
    mainPlan = r.data
  })

  after(async () => {
    const users = [A, B, M, M2, ADMIN].filter(Boolean)
    for (const w of WEEKS) await dropCycle(w).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map(u => BigInt(u.id)) } } }).catch(() => {})
    for (const t of [teamA, teamB].filter(Boolean)) {
      await prisma.teamMembership.deleteMany({ where: { teamId: t.id } }).catch(() => {})
      await prisma.team.delete({ where: { id: t.id } }).catch(() => {})
    }
    for (const u of users) await u.cleanup()
  })

  test('0. 提交后、确认前: lockStatus=DRAFT, can.confirmOwner=true', async () => {
    const s = await status(A, MAIN, A.id)
    assert.equal(s.status, 200, s.message)
    assert.equal(s.data.lockStatus, 'DRAFT')
    const my = await a.get(`/api/okr/my?week=${K(MAIN)}`)
    assert.equal(my.data.confirm.lockStatus, 'DRAFT')
    assert.equal(my.data.can.confirmOwner, true)
    assert.equal(my.data.can.edit, true)
  })

  test('4. 员工未确认时主管确认 → 400 / 8202', async () => {
    const r = await confirmManager(m, MAIN, A.id)
    assert.equal(r.status, 400)
    assert.equal(r.code, 8202)
    assert.match(r.message, /员工还没确认/)
  })

  test('5. 普通工程师确认别人 → 403; MANAGER 确认别的团队 → 403; 工程师做主管确认 → 403', async () => {
    const r1 = await confirmOwner(b, MAIN, A.id)
    assert.equal(r1.status, 403, r1.message)
    const r2 = await confirmManager(m2, MAIN, A.id)
    assert.equal(r2.status, 403)
    assert.equal(r2.code, 8206)
    const r3 = await confirmManager(b, MAIN, A.id)
    assert.equal(r3.status, 403)
    assert.equal((await status(A, MAIN, A.id)).data.lockStatus, 'DRAFT', '都没生效')
  })

  test('1. 员工确认 → AWAITING_MANAGER, audit 有 OWNER_CONFIRM; 重复确认不重复留痕', async () => {
    const r = await confirmOwner(a, MAIN)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.changed, true)
    assert.equal(r.data.lockStatus, 'AWAITING_MANAGER')
    assert.equal(r.data.ownerConfirmedBy.id, A.id)
    assert.ok(r.data.ownerConfirmedAt)
    const again = await confirmOwner(a, MAIN)
    assert.equal(again.status, 200)
    assert.equal(again.data.changed, false)
    const rows = (await auditRows(MAIN, A.id)).filter(x => x.action === 'OWNER_CONFIRM')
    assert.equal(rows.length, 1)
    assert.equal(String(rows[0].actorId), A.id)
    assert.equal(rows[0].source, 'CONFIRM')
  })

  test('2. 主管确认 → CONFIRMED, audit 有 MANAGER_CONFIRM; /my 锁定后 can.edit=false、can.requestChange=true', async () => {
    const r = await confirmManager(m, MAIN, A.id)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.changed, true)
    assert.equal(r.data.lockStatus, 'CONFIRMED')
    assert.equal(r.data.managerConfirmedBy.id, M.id)
    const again = await confirmManager(m, MAIN, A.id)
    assert.equal(again.data.changed, false)
    const rows = (await auditRows(MAIN, A.id)).filter(x => x.action === 'MANAGER_CONFIRM')
    assert.equal(rows.length, 1)
    assert.equal(String(rows[0].actorId), M.id)
    const my = await a.get(`/api/okr/my?week=${K(MAIN)}`)
    assert.equal(my.data.confirm.lockStatus, 'CONFIRMED')
    assert.equal(my.data.can.edit, false)
    assert.equal(my.data.can.requestChange, true)
    assert.equal(my.data.can.confirmOwner, false)
  })

  test('3. 锁定后 POST /plan、/plan/submit、主管代改 → 400 / 8201「本周 OKR 已确认，改动请提交变更申请」, 计划不变', async () => {
    const snap = await planSnapshot(MAIN, A.id)
    const objs = await currentObjectives(MAIN)
    objs[0].title = T('O1 偷偷改标题')
    for (const [client, path, extra] of [[a, '/api/okr/plan', {}], [a, '/api/okr/plan/submit', {}], [m, '/api/okr/plan', { targetUserId: A.id }]]) {
      const r = await client.post(`${path}?week=${K(MAIN)}`, { objectives: objs, ...extra })
      assert.equal(r.status, 400, `${path} ${r.message}`)
      assert.equal(r.code, 8201)
      assert.equal(r.message, '本周 OKR 已确认，改动请提交变更申请')
    }
    assert.equal(await planSnapshot(MAIN, A.id), snap)
  })

  test('6. 提交变更申请 → PENDING, 计划内容未变; 不写原因 → 400', async () => {
    const snap = await planSnapshot(MAIN, A.id)
    const objs = await currentObjectives(MAIN)
    objs[0].title = T('O1 订单模块上线(改期)')
    const noReason = await a.post('/api/okr/plan/changes', { week: K(MAIN), objectives: objs })
    assert.equal(noReason.status, 400)
    assert.equal(noReason.code, 8205)
    const r = await a.post('/api/okr/plan/changes', { week: K(MAIN), reason: '客户推迟验收, 标题改期', objectives: objs })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'PENDING')
    assert.equal(r.data.diffCount, 1)
    assert.equal(r.data.diffs[0].action, 'OBJECTIVE_EDIT')
    assert.equal(r.data.owner.id, A.id)
    changeIds.first = r.data.id
    assert.equal(await planSnapshot(MAIN, A.id), snap, '提交申请不改计划')
    const s = await status(A, MAIN, A.id)
    assert.equal(s.data.pendingChange.id, changeIds.first)
    const rows = (await auditRows(MAIN, A.id)).filter(x => x.action === 'CHANGE_REQUEST')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].reason, '客户推迟验收, 标题改期')
  })

  test('7. 同周第二条 PENDING → 400 / 8203', async () => {
    const r = await a.post('/api/okr/plan/changes', { week: K(MAIN), reason: '再来一条' })
    assert.equal(r.status, 400)
    assert.equal(r.code, 8203)
  })

  test('15(列表). 主管看得到本团队待批, 别的团队主管看不到; 待批带 diffs', async () => {
    const mine = await m.get(`/api/okr/plan/changes?week=${K(MAIN)}&status=PENDING`)
    assert.equal(mine.status, 200, mine.message)
    const it = mine.data.find(c => c.id === changeIds.first)
    assert.ok(it, 'M 看得到 A 的申请')
    assert.equal(it.diffCount, 1)
    const other = await m2.get(`/api/okr/plan/changes?week=${K(MAIN)}`)
    assert.equal(other.status, 200)
    assert.ok(!other.data.some(c => c.id === changeIds.first), 'M2 看不到')
    const self = await a.get(`/api/okr/plan/changes?week=${K(MAIN)}`)
    assert.ok(self.data.some(c => c.id === changeIds.first), '本人看得到自己的')
  })

  test('9. 驳回不填 note → 400; 填了 → REJECTED, 计划不变; 申请人自己 / 别的团队主管不能审批', async () => {
    const snap = await planSnapshot(MAIN, A.id)
    const self = await a.post(`/api/okr/plan/changes/${changeIds.first}/reject`, { note: '自己驳回' })
    assert.equal(self.status, 403)
    const outsider = await m2.post(`/api/okr/plan/changes/${changeIds.first}/reject`, { note: '越权' })
    assert.equal(outsider.status, 403)
    const noNote = await m.post(`/api/okr/plan/changes/${changeIds.first}/reject`, {})
    assert.equal(noNote.status, 400)
    assert.equal(noNote.code, 8205)
    const r = await m.post(`/api/okr/plan/changes/${changeIds.first}/reject`, { note: '标题别改, 周四前照原计划' })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'REJECTED')
    assert.equal(r.data.decisionNote, '标题别改, 周四前照原计划')
    assert.equal(r.data.decidedBy.id, M.id)
    assert.equal(r.data.appliedAt, null)
    assert.equal(await planSnapshot(MAIN, A.id), snap)
    const rows = (await auditRows(MAIN, A.id)).filter(x => x.action === 'CHANGE_REJECT')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].reason, '标题别改, 周四前照原计划')
    const twice = await m.post(`/api/okr/plan/changes/${changeIds.first}/approve`, {})
    assert.equal(twice.status, 400, '已驳回的不能再批')
  })

  test('10. 申请人 cancel → CANCELED, 计划不变; 别人撤 → 403', async () => {
    const snap = await planSnapshot(MAIN, A.id)
    const objs = await currentObjectives(MAIN)
    objs[1].weight = 50; objs[0].weight = 50
    const c = await a.post('/api/okr/plan/changes', { week: K(MAIN), reason: '想调权重', objectives: objs })
    assert.equal(c.status, 200, c.message)
    const byM = await m.post(`/api/okr/plan/changes/${c.data.id}/cancel`)
    assert.equal(byM.status, 403)
    const r = await a.post(`/api/okr/plan/changes/${c.data.id}/cancel`)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'CANCELED')
    assert.equal(await planSnapshot(MAIN, A.id), snap)
    assert.equal((await status(A, MAIN, A.id)).data.pendingChange, null)
    changeIds.canceled = c.data.id
  })

  test('8. 审批通过 → 计划被替换、applied_at 有值、audit 有 CHANGE_APPROVE 且逐条 diff 条数 = 实际改动数', async () => {
    const objs = await currentObjectives(MAIN)
    // 4 处改动: O1 标题、O1.KR2 目标值 10→20、O2 新增 KR、O2.KR1 权重 100→50
    objs[0].title = T('O1 订单模块上线 + 门店扩容')
    objs[0].keyResults[1].targetValue = 20
    objs[1].keyResults[0].weight = 50
    objs[1].keyResults.push({ title: T('KR 回访纪要'), metricType: 'BINARY', weight: 50 })
    const c = await a.post('/api/okr/plan/changes', { week: K(MAIN), reason: '客户追加 10 家门店', objectives: objs })
    assert.equal(c.status, 200, c.message)
    assert.equal(c.data.diffCount, 4)
    changeIds.approved = c.data.id
    const before = await auditRows(MAIN, A.id)

    const r = await m.post(`/api/okr/plan/changes/${c.data.id}/approve`, { note: '同意' })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.status, 'APPROVED')
    assert.ok(r.data.appliedAt, 'applied_at 有值')
    assert.equal(r.data.diffCount, 4)

    const my = await a.get(`/api/okr/my?week=${K(MAIN)}`)
    assert.equal(my.data.objectives[0].title, T('O1 订单模块上线 + 门店扩容'))
    assert.equal(my.data.objectives[0].keyResults[1].targetValue, 20)
    assert.equal(my.data.objectives[1].keyResults.length, 2)
    assert.equal(my.data.submission, 'ON_TIME', '审批套用不改提交状态')
    assert.equal(my.data.confirm.lockStatus, 'CONFIRMED', '批准后仍锁定')

    const fresh = (await auditRows(MAIN, A.id)).filter(x => !before.some(y => y.id === x.id))
    const approve = fresh.filter(x => x.action === 'CHANGE_APPROVE')
    assert.equal(approve.length, 1)
    assert.equal(String(approve[0].actorId), M.id)
    assert.equal(approve[0].reason, '客户追加 10 家门店')
    const diffs = fresh.filter(x => x.source === 'CHANGE_APPLY' && x.action !== 'CHANGE_APPROVE')
    assert.equal(diffs.length, 4, JSON.stringify(diffs.map(d => [d.action, d.field])))
    assert.ok(diffs.every(d => String(d.actorId) === M.id && d.reason === '客户追加 10 家门店'))
    const target = diffs.find(d => d.action === 'TARGET_EDIT')
    assert.equal(target.beforeText, '目标值 10个')
    assert.equal(target.afterText, '目标值 20个')
    const weight = diffs.find(d => d.action === 'WEIGHT_EDIT')
    assert.equal(weight.beforeText, '权重 100%')
    assert.equal(weight.afterText, '权重 50%')
    assert.ok(diffs.some(d => d.action === 'KR_ADD' && d.afterText.includes(T('KR 回访纪要'))))

    // 列表: /plan/audit 倒序, 最上面是批准那一行
    const list = await a.get(`/api/okr/plan/audit?week=${K(MAIN)}&userId=${A.id}`)
    assert.equal(list.status, 200, list.message)
    assert.equal(list.data.items[0].action, 'CHANGE_APPROVE')
    assert.equal(list.data.items[0].actionLabel, '批准变更')
    assert.equal(list.data.items[0].actorName, 'unit-test-cf-主管M')
    const t2 = list.data.items.find(x => x.action === 'TARGET_EDIT')
    assert.equal(t2.before, '目标值 10个')
    assert.equal(t2.after, '目标值 20个')
  })

  test('7b. 并发提两条变更申请 → 只成一条, 另一条 8203', async () => {
    const objs = await currentObjectives(MAIN)
    objs[0].title = T('并发改标题')
    const rs = await Promise.all([1, 2].map(i => a.post('/api/okr/plan/changes', { week: K(MAIN), reason: `并发 ${i}`, objectives: objs })))
    const okOnes = rs.filter(r => r.status === 200)
    assert.equal(okOnes.length, 1, JSON.stringify(rs.map(r => [r.status, r.code])))
    assert.equal(rs.find(r => r.status !== 200).code, 8203)
    const cancel = await a.post(`/api/okr/plan/changes/${okOnes[0].data.id}/cancel`)
    assert.equal(cancel.status, 200)
  })

  test('11. 修改记录覆盖四类: 改 O 标题 / 改 KR 目标值 / 加 KR / 删 O, 各一行且 before / after 正确', async () => {
    const r1 = await a.post(`/api/okr/plan?week=${K(AUDIT)}`, {
      objectives: [
        { title: T('A-O1 旧标题'), weight: 50, keyResults: [{ title: T('A-KR 交付件数'), metricType: 'NUMBER', targetValue: 10, unit: '件', weight: 100 }] },
        { title: T('A-O2 要删掉'), weight: 50, keyResults: [{ title: T('A-KR2'), metricType: 'BINARY', weight: 100 }] }
      ]
    })
    assert.equal(r1.status, 200, r1.message)
    const first = await auditRows(AUDIT, A.id)
    assert.deepEqual(first.map(x => x.action), ['OBJECTIVE_ADD', 'OBJECTIVE_ADD'], '首存: 每个 O 一行(含 KR 摘要)')
    const o1 = r1.data.objectives[0]
    const r2 = await a.post(`/api/okr/plan?week=${K(AUDIT)}`, {
      objectives: [{
        id: o1.id, title: T('A-O1 新标题'), weight: 50,
        keyResults: [
          { id: o1.keyResults[0].id, title: T('A-KR 交付件数'), metricType: 'NUMBER', targetValue: 20, unit: '件', weight: 100 },
          { title: T('A-KR 新增验收'), metricType: 'BINARY', weight: 0 }
        ]
      }]
    })
    assert.equal(r2.status, 200, r2.message)
    const rows = (await auditRows(AUDIT, A.id)).slice(first.length)
    assert.equal(rows.length, 4, JSON.stringify(rows.map(x => [x.action, x.field])))
    const one = act => { const xs = rows.filter(x => x.action === act); assert.equal(xs.length, 1, act); return xs[0] }
    const title = one('OBJECTIVE_EDIT')
    assert.equal(title.field, 'title')
    assert.equal(title.beforeText, T('A-O1 旧标题'))
    assert.equal(title.afterText, T('A-O1 新标题'))
    assert.match(title.targetRef, /^O1 /)
    const target = one('TARGET_EDIT')
    assert.equal(target.beforeText, '目标值 10件')
    assert.equal(target.afterText, '目标值 20件')
    assert.match(target.targetRef, /^O1\.KR1 /)
    const add = one('KR_ADD')
    assert.equal(add.beforeText, null)
    assert.match(add.afterText, /A-KR 新增验收/)
    assert.match(add.targetRef, /^O1\.KR2 /)
    const del = one('OBJECTIVE_DEL')
    assert.match(del.beforeText, /A-O2 要删掉/)
    assert.equal(del.afterText, null)
    assert.ok(rows.every(x => x.source === 'DIRECT' && String(x.actorId) === A.id))

    // 一模一样再存一次 → 不新增记录
    const n = (await auditRows(AUDIT, A.id)).length
    const same = await a.post(`/api/okr/plan?week=${K(AUDIT)}`, { objectives: await currentObjectives(AUDIT) })
    assert.equal(same.status, 200, same.message)
    assert.equal((await auditRows(AUDIT, A.id)).length, n)
  })

  test('12. 锁定后 appendUpdate / completeKr / self-score / manager-score 照常可写, 且不产生 plan audit 行', async () => {
    const s = await a.post(`/api/okr/plan/submit?week=${K(PROG)}`, {
      objectives: [{ title: T('P-O1'), weight: 100, keyResults: [{ title: T('P-KR'), metricType: 'BINARY', weight: 100 }] }]
    })
    assert.equal(s.status, 200, s.message)
    assert.equal((await confirmOwner(a, PROG)).status, 200)
    assert.equal((await confirmManager(m, PROG, A.id)).data.lockStatus, 'CONFIRMED')
    const n0 = (await auditRows(PROG, A.id)).length
    const o = s.data.objectives[0]
    const u = await a.post(`/api/okr/objectives/${o.id}/updates`, { content: '周二推进: 联调通过' })
    assert.equal(u.status, 200, u.message)
    const c = await a.post(`/api/okr/krs/${o.keyResults[0].id}/complete`, { done: true })
    assert.equal(c.status, 200, c.message)
    const self = await a.post('/api/okr/self-score', { objectiveId: o.id, score: 90 })
    assert.equal(self.status, 200, self.message)
    const mgr = await m.post('/api/okr/manager-score', { objectiveId: o.id, score: 85 })
    assert.equal(mgr.status, 200, mgr.message)
    assert.equal((await auditRows(PROG, A.id)).length, n0, '进展 / 完成 / 评分不进计划修改记录')
  })

  test('3b. 没提交也能确认(一并提交); 锁定后批量导入 / 复制 400 / 8171(已提交)', async () => {
    const d = await a.post(`/api/okr/plan?week=${K(DRAFT)}`, { objectives: [{ title: T('D-O1 草稿'), keyResults: [{ title: T('D-KR') }] }] })
    assert.equal(d.status, 200, d.message)
    // 代确认: M 替 A 点员工确认; 之后 M 自己不能再做主管确认(要两个人)
    const proxy = await confirmOwner(m, DRAFT, A.id)
    assert.equal(proxy.status, 200, proxy.message)
    assert.equal(proxy.data.ownerConfirmedBy.id, M.id)
    assert.equal(proxy.data.submitted, true)
    const dObjs = await prisma.okrObjective.findMany({ where: { cycleId: (await cycleOf(DRAFT)).id, ownerId: BigInt(A.id) } })
    assert.ok(dObjs.every(o => o.submittedAt && o.submittedByOperator === true), '代确认顺带提交记为代提交')
    const same = await confirmManager(m, DRAFT, A.id)
    assert.equal(same.status, 403)
    assert.equal(same.code, 8206)
    const r = await confirmManager(admin, DRAFT, A.id)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.lockStatus, 'CONFIRMED')
    const bulk = await a.post('/api/okr/plan/bulk-import', { week: K(DRAFT), mode: 'apply', text: '## unit-test-cf 批量 O\n- 批量 KR' })
    // 确认时已一并提交: 批量导入 / 复制先撞上「目标周已提交」(8171, 校验顺序在锁之前), 同样被拦
    assert.equal(bulk.status, 400, bulk.message)
    assert.equal(bulk.code, 8171)
    const copy = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(AUDIT), toWeek: K(DRAFT) })
    assert.equal(copy.status, 400, copy.message)
    assert.equal(copy.code, 8171)
  })

  test('3c. 只保存不提交 → 员工确认 = 一并提交: /my submission 非空、submittedAt 有值; 团队视图 submitted=true', async () => {
    // 不满足提交硬约束(O 权重合计 ≠ 100) → 确认 400 / 8204, 既不提交也不确认
    const badSave = await a.post(`/api/okr/plan?week=${K(SAVED)}`, { objectives: [
      { title: T('S-O1'), weight: 30, keyResults: [{ title: T('S-KR1') }] },
      { title: T('S-O2'), weight: 30, keyResults: [{ title: T('S-KR2') }] }
    ] })
    assert.equal(badSave.status, 200, badSave.message)
    const rejected = await confirmOwner(a, SAVED)
    assert.equal(rejected.status, 400, rejected.message)
    assert.equal(rejected.code, 8204)
    let my = await a.get(`/api/okr/my?week=${K(SAVED)}`)
    assert.equal(my.data.submission, 'NONE')
    assert.equal(my.data.confirm.lockStatus, 'DRAFT')

    const objs = (await currentObjectives(SAVED)).map(o => ({ ...o, weight: 50 }))
    const save = await a.post(`/api/okr/plan?week=${K(SAVED)}`, { objectives: objs })
    assert.equal(save.status, 200, save.message)
    my = await a.get(`/api/okr/my?week=${K(SAVED)}`)
    assert.equal(my.data.submission, 'NONE')
    assert.ok(my.data.objectives.every(o => !o.submittedAt))

    const r = await confirmOwner(a, SAVED)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.changed, true)
    assert.equal(r.data.submitted, true)
    assert.equal(r.data.lateSubmit, false)
    assert.equal(r.data.lockStatus, 'AWAITING_MANAGER')

    my = await a.get(`/api/okr/my?week=${K(SAVED)}`)
    assert.equal(my.status, 200, my.message)
    assert.equal(my.data.submission, 'ON_TIME')
    assert.ok(my.data.objectives.length === 2 && my.data.objectives.every(o => o.submittedAt && o.lateSubmit === false && o.submittedByOperator === false))
    assert.equal(new Date(my.data.objectives[0].submittedAt).getTime(), new Date(r.data.ownerConfirmedAt).getTime(), '提交时间 = 确认时间')

    const team = await m.get(`/api/okr/team?week=${K(SAVED)}`)
    assert.equal(team.status, 200, team.message)
    const row = team.data.rows.find(x => String(x.user.id) === A.id)
    assert.ok(row, '团队视图里有 A')
    assert.equal(row.submitted, true)
    assert.equal(row.submission, 'ON_TIME')
    assert.ok(team.data.summary.submitted >= 1)

    // 只记 OWNER_CONFIRM 一条(不另记提交行); 重复确认 submitted=false
    const confirms = (await auditRows(SAVED, A.id)).filter(x => x.action === 'OWNER_CONFIRM')
    assert.equal(confirms.length, 1)
    const again = await confirmOwner(a, SAVED)
    assert.equal(again.data.changed, false)
    assert.equal(again.data.submitted, false)
  })

  test('3d. 先提交再确认 → submittedAt 保持第一次提交的时间, submitted=false', async () => {
    const s = await a.post(`/api/okr/plan/submit?week=${K(SUBMITTED)}`, { objectives: [{ title: T('P-O1'), keyResults: [{ title: T('P-KR') }] }] })
    assert.equal(s.status, 200, s.message)
    const first = s.data.objectives[0].submittedAt
    assert.ok(first)
    await new Promise(res => setTimeout(res, 1100))
    const r = await confirmOwner(a, SUBMITTED)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.changed, true)
    assert.equal(r.data.submitted, false)
    assert.ok(new Date(r.data.ownerConfirmedAt).getTime() > new Date(first).getTime())
    const my = await a.get(`/api/okr/my?week=${K(SUBMITTED)}`)
    assert.equal(my.data.submission, 'ON_TIME')
    assert.equal(new Date(my.data.objectives[0].submittedAt).getTime(), new Date(first).getTime(), '提交时间未被确认覆盖')
  })

  test('13. CLOSED 周确认 → 400; CLOSED 周提变更 → 400', async () => {
    const c1 = await confirmOwner(a, CLOSED)
    assert.equal(c1.status, 400, c1.message)
    const c2 = await confirmManager(m, CLOSED, A.id)
    assert.equal(c2.status, 400, c2.message)
    const ch = await a.post('/api/okr/plan/changes', { week: K(CLOSED), reason: '归档了还想改' })
    assert.equal(ch.status, 400, ch.message)
    // 没锁的周提变更 → 400(直接改就行)
    const unlocked = await a.post('/api/okr/plan/changes', { week: K(AUDIT), reason: '没锁' })
    assert.equal(unlocked.status, 400)
    assert.equal(unlocked.code, 8205)
  })

  test('14. 四类通知各发 1 条(重复确认不重复发)', async () => {
    const mainCycle = await cycleOf(MAIN)
    assert.ok(mainCycle)
    const notes = async (userId, type) => (await prisma.notification.findMany({ where: { userId: BigInt(userId), type } }))
      .filter(n => JSON.parse(n.data || '{}').week === K(MAIN))
    const pending = await notes(M.id, 'OKR_PLAN_CONFIRM_PENDING')
    assert.equal(pending.length, 1)
    assert.equal(pending[0].title, `unit-test-cf-工程师A 已确认 W${String(MAIN.weekNo).padStart(2, '0')} OKR，待你确认`)
    const confirmed = await notes(A.id, 'OKR_PLAN_CONFIRMED')
    assert.equal(confirmed.length, 1)
    assert.match(confirmed[0].title, /OKR 已确认，已锁定；要改请提交变更申请/)
    const reqs = await notes(M.id, 'OKR_PLAN_CHANGE_REQUEST')
    for (const id of [changeIds.first, changeIds.canceled, changeIds.approved]) {
      const xs = reqs.filter(n => JSON.parse(n.data).changeId === id)
      assert.equal(xs.length, 1, `申请 #${id} 一条`)
    }
    assert.match(reqs.find(n => JSON.parse(n.data).changeId === changeIds.approved).title, /申请变更 W\d+ OKR：客户追加 10 家门店/)
    const decided = await notes(A.id, 'OKR_PLAN_CHANGE_DECIDED')
    for (const id of [changeIds.first, changeIds.approved]) {
      assert.equal(decided.filter(n => JSON.parse(n.data).changeId === id).length, 1, `审批 #${id} 一条`)
    }
    assert.equal(decided.filter(n => JSON.parse(n.data).changeId === changeIds.canceled).length, 0, '撤回不发审批通知')
    assert.equal((await notes(M2.id, 'OKR_PLAN_CONFIRM_PENDING')).length, 0, '别的团队主管收不到')
  })

  test('15. /plan/audit 权限: 本人可看自己; 主管看本团队; ADMIN 全部; 别的团队主管 / 工程师 → 403', async () => {
    const path = `/api/okr/plan/audit?week=${K(MAIN)}&userId=${A.id}`
    for (const client of [a, m, admin]) {
      const r = await client.get(path)
      assert.equal(r.status, 200, r.message)
      assert.ok(r.data.items.length > 0)
      assert.equal(r.data.week, K(MAIN))
    }
    for (const client of [b, m2]) {
      const r = await client.get(path)
      assert.equal(r.status, 403)
      assert.equal(r.code, 8206)
    }
    const lim = await a.get(`${path}&limit=2`)
    assert.equal(lim.data.items.length, 2)
  })
})
