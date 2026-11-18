// 集成测试 - 0.5.0 R4a 组长层 + 团队四屏接口(/api/team/*)
// 布局: 团队 T1 = 组长 L + 工程师 A、B; 团队 T2 = 工程师 C。L 只能看 T1, 老板看全部, 工程师 403。
// 任务 / 会话 / OKR / 技能直接写库造数(只验接口口径), 账号、团队、项目现建现删。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { isoWeekOf, weekRange } from '../../src/services/okrRules.js'
import { login, api, uniqName, createTestUser } from './helpers.js'

describe('0.5.0 R4a 组长层 / 团队四屏', () => {
  const RUN = `r4a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  let admin, L, A, B, C, lead, eng
  const eid = {} // 角色字母 → engineerId 字符串
  const created = { teams: [], customer: null, project: null, cycle: null, skills: [], objectives: [] }
  let S1, S2, S3 // 技能: S1 只有 A 手工会(另有 C 的会话候选), S2 有 L、B 两人手工会, S3 只在 C 的会话里出现

  async function engineerOf(u) {
    const e = await prisma.engineer.findUnique({ where: { userId: BigInt(u.id) }, select: { id: true } })
    return e.id
  }
  async function addTasks(engineerId, n, extra = {}) {
    for (let i = 0; i < n; i++) {
      await prisma.task.create({ data: { projectId: created.project, title: `${RUN}-任务-${i}`, assigneeId: engineerId, status: 'IN_PROGRESS', ...extra } })
    }
  }
  async function addConversations(engineerId, n, extra = {}) {
    for (let i = 0; i < n; i++) {
      await prisma.devConversation.create({
        data: { uid: `${RUN}-${engineerId}-${i}-${Math.random().toString(36).slice(2, 6)}`, source: 'CLAUDE_CODE', engineerId, projectId: created.project, title: `${RUN} 会话`, ...extra }
      })
    }
  }

  before(async () => {
    admin = api(await login('admin'))
    L = await createTestUser('TEAM_LEAD', { name: 'unit-test-组长L' })
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-组员A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-组员B' })
    C = await createTestUser('FDE_ENGINEER', { name: 'unit-test-别组C' })
    lead = api(L.token); eng = api(A.token)
    for (const [k, u] of Object.entries({ L, A, B, C })) eid[k] = await engineerOf(u)

    const t1 = await prisma.team.create({ data: { name: `${RUN}-T1`, leaderId: BigInt(L.id) } })
    const t2 = await prisma.team.create({ data: { name: `${RUN}-T2` } })
    created.teams.push(t1.id, t2.id)
    await prisma.teamMembership.createMany({
      data: [
        { teamId: t1.id, userId: BigInt(L.id) }, { teamId: t1.id, userId: BigInt(A.id) },
        { teamId: t1.id, userId: BigInt(B.id) }, { teamId: t2.id, userId: BigInt(C.id) }
      ]
    })

    const cust = await prisma.customer.create({ data: { name: `${RUN}-客户` } })
    created.customer = cust.id
    const proj = await prisma.project.create({ data: { code: `${RUN}-P`.toUpperCase(), name: `${RUN}-项目`, customerId: cust.id, createdBy: BigInt(L.id) } })
    created.project = proj.id

    // 负载: A 3 个进行中(60%), B 6 个(120% WARN), L 8 个(160% OVER)
    await addTasks(eid.A, 3)
    await addTasks(eid.B, 6)
    await addTasks(eid.L, 8)
    // 本周完成: B、L 各 1 个
    await addTasks(eid.B, 1, { status: 'DONE', completedAt: new Date() })
    await addTasks(eid.L, 1, { status: 'DONE', completedAt: new Date() })
    // 本周会话: C 3 条(DRIFT), L 1 条; A、B 0 条
    await addConversations(eid.C, 3)
    await addConversations(eid.L, 1)

    // 本周 OKR: A 提交了一个目标(→ ONLY_WORDS)
    const wk = isoWeekOf(new Date())
    let cycle = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: wk.year, weekNo: wk.weekNo } } })
    if (!cycle) {
      const { start, end } = weekRange(wk.year, wk.weekNo)
      cycle = await prisma.okrCycle.create({ data: { year: wk.year, weekNo: wk.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS' } })
      created.cycle = cycle.id
    }
    const o = await prisma.okrObjective.create({ data: { cycleId: cycle.id, ownerId: BigInt(A.id), title: `${RUN} 交付登录模块`, weight: 100, submittedAt: new Date() } })
    created.objectives.push(o.id)

    // 技能
    S1 = await prisma.skill.create({ data: { name: `${RUN}s1` } })
    S2 = await prisma.skill.create({ data: { name: `${RUN}s2` } })
    S3 = await prisma.skill.create({ data: { name: `${RUN}s3` } })
    created.skills.push(S1.id, S2.id, S3.id)
    await prisma.engineerSkill.createMany({
      data: [
        { engineerId: eid.A, skillId: S1.id, level: 3 },
        { engineerId: eid.L, skillId: S2.id, level: 4 },
        { engineerId: eid.B, skillId: S2.id, level: 2 }
      ]
    })
    // C 的会话: tags 里有 S1, 标题里有 S3 —— 只能成为 DERIVED 候选
    await prisma.devConversation.create({
      data: { uid: `${RUN}-skill`, source: 'CLAUDE_CODE', engineerId: eid.C, title: `排查 ${S3.name} 的问题`, tags: [S1.name], createdAt: new Date(Date.now() - 30 * 86400000) }
    })
  })

  after(async () => {
    const engIds = Object.values(eid)
    await prisma.devConversation.deleteMany({ where: { uid: { startsWith: RUN } } })
    if (created.project) await prisma.task.deleteMany({ where: { projectId: created.project } })
    if (created.project) await prisma.project.delete({ where: { id: created.project } }).catch(() => {})
    if (created.customer) await prisma.customer.delete({ where: { id: created.customer } }).catch(() => {})
    await prisma.okrObjective.deleteMany({ where: { id: { in: created.objectives } } })
    if (created.cycle) await prisma.okrCycle.delete({ where: { id: created.cycle } }).catch(() => {})
    const esIds = (await prisma.engineerSkill.findMany({ where: { engineerId: { in: engIds } }, select: { id: true } })).map(r => r.id)
    await prisma.auditLog.deleteMany({ where: { resourceType: 'engineer_skill', resourceId: { in: esIds } } })
    await prisma.engineerSkill.deleteMany({ where: { engineerId: { in: engIds } } })
    await prisma.skill.deleteMany({ where: { name: { startsWith: RUN } } })
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: created.teams } } })
    await prisma.team.deleteMany({ where: { id: { in: created.teams } } })
    for (const u of [L, A, B, C]) await u?.cleanup()
  })

  const ids = rows => rows.map(r => r.engineerId)

  test('members: 组长只看本组, 老板看全部, 工程师 403', async () => {
    const r = await lead.get('/api/team/members')
    assert.equal(r.code, 0, r.message)
    assert.equal(r.raw.meta.scope, 'TEAM')
    assert.deepEqual(ids(r.data).sort(), [eid.L, eid.A, eid.B].map(String).sort(), '组长看到 L/A/B, 看不到别组的 C')

    const a = await admin.get('/api/team/members')
    assert.equal(a.code, 0, a.message)
    for (const k of ['L', 'A', 'B', 'C']) assert.ok(ids(a.data).includes(String(eid[k])), `老板能看到 ${k}`)

    const e = await eng.get('/api/team/members')
    assert.equal(e.status, 403)

    const me = r.data.find(m => m.engineerId === String(eid.A))
    assert.equal(me.role, 'FDE_ENGINEER')
    assert.equal(me.activeTaskCount, 3)
    assert.equal(me.loadPct, 60)
    assert.deepEqual(me.committedObjectives, [{ title: `${RUN} 交付登录模块`, weight: 100 }])
    assert.deepEqual(me.skills, [{ name: S1.name, level: 3, source: 'MANUAL' }])
    const l = r.data.find(m => m.engineerId === String(eid.L))
    assert.ok(l.lastConversationAt, '有会话的人带最近会话时间')
    assert.equal(r.data.find(m => m.engineerId === String(eid.B)).lastConversationAt, null)
  })

  test('load: 3 个 60% OK / 6 个 120% WARN / 8 个 160% OVER, plannedHours 为 null', async () => {
    const r = await lead.get('/api/team/load')
    assert.equal(r.code, 0, r.message)
    assert.equal(r.raw.meta.threshold, 5)
    const row = k => r.data.find(x => x.engineerId === String(eid[k]))
    assert.deepEqual([row('A').loadPct, row('A').level], [60, 'OK'])
    assert.deepEqual([row('B').loadPct, row('B').level], [120, 'WARN'])
    assert.deepEqual([row('L').loadPct, row('L').level], [160, 'OVER'])
    assert.equal(row('A').plannedHours, null, '任务没有预估工时字段, 不编数')
    assert.equal(row('A').committedWeight, 100)
    assert.equal(row('L').conversationCount, 1)
    assert.equal(row('C'), undefined, '别组的人不在组长的负载里')

    const old = await lead.get('/api/team/load?week=2020-01-08')
    assert.equal(old.code, 0, old.message)
    assert.equal(old.data.find(x => x.engineerId === String(eid.L)).conversationCount, 0, '会话数按所选周统计')
    const bad = await lead.get('/api/team/load?week=20201')
    assert.equal(bad.status, 400)
  })

  test('promise: 三种标记各一条, 响应里没有 score / rank; 组长无权看', async () => {
    const r = await admin.get('/api/team/promise')
    assert.equal(r.code, 0, r.message)
    const row = k => r.data.find(x => x.engineerId === String(eid[k]))
    assert.equal(row('A').flag, 'ONLY_WORDS', 'A 有 OKR 但本周 0 完成')
    assert.equal(row('B').flag, 'ELSEWHERE', 'B 有任务但 0 会话')
    assert.equal(row('C').flag, 'DRIFT', 'C 会话 ≥3 且 0 完成')
    assert.equal(row('L').flag, null, 'L 有完成有会话, 不提示')
    assert.equal(row('B').completedTasks, 1)
    assert.equal(row('C').conversationCount, 3)
    assert.equal(row('C').projectCount, 1)
    assert.deepEqual(row('A').objectives, [{ title: `${RUN} 交付登录模块`, weight: 100 }])

    const text = JSON.stringify(r.raw)
    assert.ok(!text.includes('"score"'), '不许出现 score 字段')
    assert.ok(!text.includes('"rank"'), '不许出现 rank 字段')
    for (const p of r.data) for (const k of Object.keys(p)) assert.ok(!/score|rank/i.test(k), `字段 ${k} 像分数/排名`)

    const l = await lead.get('/api/team/promise')
    assert.equal(l.status, 403, 'promise 只给 team.view.all(老板)')
  })

  test('okr.score.manager 的生效角色不含 TEAM_LEAD; 组长打主管分 403', async () => {
    const r = await admin.get('/api/fde/role-permissions')
    assert.equal(r.code, 0, r.message)
    const perm = k => r.data.permissions.find(p => p.key === k)
    assert.ok(!perm('okr.score.manager').roles.includes('TEAM_LEAD'))
    assert.ok(!perm('okr.score.manager').defaultRoles.includes('TEAM_LEAD'))
    assert.deepEqual([...perm('team.view').roles].sort(), ['ADMIN', 'TEAM_LEAD'])
    assert.deepEqual(perm('team.view.all').roles, ['ADMIN'])
    assert.ok(r.data.roles.some(x => x.code === 'TEAM_LEAD'), '角色清单里有组长')

    const s = await lead.post('/api/okr/manager-score', { objectiveId: String(created.objectives[0]), score: 80 })
    assert.equal(s.status, 403, '组长能看不能评')
  })

  test('skills: DERIVED 候选 level=null 且不参与 singlePoints', async () => {
    const r = await admin.get('/api/team/skills')
    assert.equal(r.code, 0, r.message)
    const { skills, members, cells, singlePoints } = r.data
    const cell = (k, s) => cells.filter(c => c.engineerId === String(eid[k]) && c.skillId === String(s.id))
    assert.ok(members.some(m => m.engineerId === String(eid.C)))
    for (const s of [S1, S2, S3]) assert.ok(skills.some(x => x.id === String(s.id) && x.name === s.name))

    assert.deepEqual(cell('A', S1).map(c => [c.source, c.level]), [['MANUAL', 3]])
    const d1 = cell('C', S1)
    assert.equal(d1.length, 1)
    assert.deepEqual([d1[0].source, d1[0].level, d1[0].candidate], ['DERIVED', null, true], 'tags 命中 → 候选')
    assert.deepEqual(cell('C', S3).map(c => [c.source, c.level, c.candidate]), [['DERIVED', null, true]], '标题命中 → 候选')

    assert.ok(singlePoints.includes(String(S1.id)), 'S1 只有 A 手工会, C 的候选不算第二个人')
    assert.ok(!singlePoints.includes(String(S2.id)), 'S2 两人会, 不是单点')
    assert.ok(!singlePoints.includes(String(S3.id)), 'S3 只有候选, 没人确认过, 不算单点')

    const l = await lead.get('/api/team/skills')
    assert.equal(l.code, 0, l.message)
    assert.ok(!l.data.cells.some(c => c.engineerId === String(eid.C)), '组长看不到别组的格子')
    assert.ok(!l.data.skills.some(s => s.id === String(S3.id)), '本组没人沾 S3, 不出列')
  })

  test('写接口: 设等级写 MANUAL + 审计; 只能改本组; level 校验', async () => {
    const r = await lead.post(`/api/team/skills/${eid.A}`, { skillId: String(S2.id), level: 5 })
    assert.equal(r.code, 0, r.message)
    assert.deepEqual([r.data.source, r.data.level], ['MANUAL', 5])
    const row = await prisma.engineerSkill.findUnique({ where: { engineerId_skillId: { engineerId: eid.A, skillId: S2.id } } })
    assert.equal(row.level, 5)
    const audit = await prisma.auditLog.findFirst({ where: { action: 'team.skill.set', resourceType: 'engineer_skill', resourceId: row.id, userId: BigInt(L.id) } })
    assert.ok(audit, '审计落库')
    assert.equal(audit.details.level, 5)
    assert.equal(audit.details.before, null)
    const engRow = await prisma.engineer.findUnique({ where: { id: eid.A }, select: { skills: true } })
    assert.ok(engRow.skills.includes(S2.name), '冗余 skills JSON 同步')

    const again = await lead.post(`/api/team/skills/${eid.A}`, { skillId: String(S2.id), level: 2 })
    assert.equal(again.code, 0, again.message)
    const a2 = await prisma.auditLog.findFirst({ where: { action: 'team.skill.set', resourceId: row.id }, orderBy: { id: 'desc' } })
    assert.equal(a2.details.before, 5, '审计记下改前等级')

    assert.equal((await lead.post(`/api/team/skills/${eid.C}`, { skillId: String(S1.id), level: 3 })).status, 403, '别组的人不能改')
    assert.equal((await lead.post(`/api/team/skills/${eid.A}`, { skillId: String(S1.id), level: 0 })).status, 400)
    assert.equal((await lead.post(`/api/team/skills/${eid.A}`, { skillId: String(S1.id), level: 6 })).status, 400)
    assert.equal((await lead.post(`/api/team/skills/${eid.A}`, { skillId: '999999999', level: 3 })).status, 404)
    assert.equal((await eng.post(`/api/team/skills/${eid.A}`, { skillId: String(S1.id), level: 3 })).status, 403, '工程师没有 team.view')
  })

  test('confirm: 技能不存在就建, 再写成 MANUAL + 审计; 已有技能不重复建', async () => {
    const name = `${RUN}new`
    const r = await lead.post('/api/team/skills/confirm', { engineerId: String(eid.B), skillName: ` ${name} `, level: 4 })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.skillCreated, true)
    assert.equal(r.data.skillName, name, '去掉首尾空格')
    const skill = await prisma.skill.findUnique({ where: { name } })
    assert.ok(skill)
    const es = await prisma.engineerSkill.findUnique({ where: { engineerId_skillId: { engineerId: eid.B, skillId: skill.id } } })
    assert.equal(es.level, 4)
    const audit = await prisma.auditLog.findFirst({ where: { action: 'team.skill.confirm', resourceId: es.id } })
    assert.ok(audit, '审计落库')
    assert.equal(audit.details.skillName, name)

    // 把 C 的 S3 候选确认掉(老板可以改任何人)
    const c = await admin.post('/api/team/skills/confirm', { engineerId: String(eid.C), skillName: S3.name, level: 3 })
    assert.equal(c.code, 0, c.message)
    assert.equal(c.data.skillCreated, false)
    assert.equal(c.data.skillId, String(S3.id))
    const after = await admin.get('/api/team/skills')
    const cs3 = after.data.cells.filter(x => x.engineerId === String(eid.C) && x.skillId === String(S3.id))
    assert.deepEqual(cs3.map(x => x.source), ['MANUAL'], '确认后候选让位给 MANUAL')
    assert.ok(after.data.singlePoints.includes(String(S3.id)), '确认后 S3 有且只有 1 人会 → 单点')

    assert.equal((await lead.post('/api/team/skills/confirm', { engineerId: String(eid.B), skillName: '', level: 3 })).status, 400)
  })
})
