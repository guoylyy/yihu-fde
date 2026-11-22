// 集成测试 - 0.6.4 能力矩阵: 人人能看自己, 只有管理员能改
// 布局: 团队 T = 组长 L + 工程师 E、F; 另一个工程师 G 不在任何团队。E、F、G 各有一条人工技能, F 另有一条会话候选。
//   GET  /api/team/skills            工程师只拿到自己那一条(成员/格子/技能列都不带别人), singlePoints 为空
//   POST /api/team/skills/:id        只有 ADMIN; 组长、工程师(哪怕改自己)都 403
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { login, api, createTestUser } from './helpers.js'

describe('0.6.4 能力矩阵: 人人看自己, 只有管理员能改', () => {
  const RUN = `sk64${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  let admin, adminId, L, E, F, G, lead, engE
  const eid = {}
  const created = { team: null, skills: [] }
  let SE, SF, SG, SFD // E / F / G 各自会的技能; SFD 只在 F 的会话里出现(候选)

  before(async () => {
    admin = api(await login('admin'))
    adminId = (await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })).id
    L = await createTestUser('TEAM_LEAD', { name: `${RUN}-组长L` })
    E = await createTestUser('FDE_ENGINEER', { name: `${RUN}-工程师E` })
    F = await createTestUser('FDE_ENGINEER', { name: `${RUN}-工程师F` })
    G = await createTestUser('FDE_ENGINEER', { name: `${RUN}-工程师G` })
    lead = api(L.token); engE = api(E.token)
    for (const [k, u] of Object.entries({ L, E, F, G })) {
      eid[k] = (await prisma.engineer.findUnique({ where: { userId: BigInt(u.id) }, select: { id: true } })).id
    }
    const t = await prisma.team.create({ data: { name: `${RUN}-T`, leaderId: BigInt(L.id) } })
    created.team = t.id
    await prisma.teamMembership.createMany({
      data: [{ teamId: t.id, userId: BigInt(L.id) }, { teamId: t.id, userId: BigInt(E.id) }, { teamId: t.id, userId: BigInt(F.id) }]
    })
    SE = await prisma.skill.create({ data: { name: `${RUN}se` } })
    SF = await prisma.skill.create({ data: { name: `${RUN}sf` } })
    SG = await prisma.skill.create({ data: { name: `${RUN}sg` } })
    SFD = await prisma.skill.create({ data: { name: `${RUN}sfd` } })
    created.skills.push(SE.id, SF.id, SG.id, SFD.id)
    await prisma.engineerSkill.createMany({
      data: [
        { engineerId: eid.E, skillId: SE.id, level: 3 },
        { engineerId: eid.F, skillId: SF.id, level: 4 },
        { engineerId: eid.F, skillId: SE.id, level: 2 },
        { engineerId: eid.G, skillId: SG.id, level: 5 }
      ]
    })
    await prisma.devConversation.create({
      data: { uid: `${RUN}-conv`, source: 'CLAUDE_CODE', engineerId: eid.F, title: `排查 ${SFD.name}`, createdAt: new Date(Date.now() - 5 * 86400000) }
    })
  })

  after(async () => {
    const engIds = Object.values(eid)
    await prisma.devConversation.deleteMany({ where: { uid: { startsWith: RUN } } })
    const esIds = (await prisma.engineerSkill.findMany({ where: { engineerId: { in: engIds } }, select: { id: true } })).map(r => r.id)
    await prisma.auditLog.deleteMany({ where: { resourceType: 'engineer_skill', resourceId: { in: esIds } } })
    await prisma.engineerSkill.deleteMany({ where: { engineerId: { in: engIds } } })
    await prisma.skill.deleteMany({ where: { id: { in: created.skills } } })
    if (created.team) {
      await prisma.teamMembership.deleteMany({ where: { teamId: created.team } })
      await prisma.team.delete({ where: { id: created.team } }).catch(() => {})
    }
    for (const u of [L, E, F, G]) if (u) await u.cleanup()
  })

  test('1. 工程师 GET → 200, members 只有自己一条, 不带别人的姓名/等级', async () => {
    const r = await engE.get('/api/team/skills')
    assert.equal(r.status, 200, r.message)
    assert.equal(r.code, 0, r.message)
    const { members, cells, skills, singlePoints } = r.data
    assert.equal(members.length, 1)
    assert.equal(members[0].engineerId, String(eid.E))
    assert.equal(members[0].name, E.name)
    assert.equal(r.raw.meta.scope, 'SELF')
    assert.ok(cells.length >= 1)
    assert.ok(cells.every(c => c.engineerId === String(eid.E)), '格子只有自己的')
    assert.deepEqual(cells.map(c => [c.skillId, c.level, c.source]), [[String(SE.id), 3, 'MANUAL']])
    assert.deepEqual(skills.map(s => s.id), [String(SE.id)], '技能列只来自自己的格子, 别人会的技能不出列')
    assert.deepEqual(singlePoints, [], '单点风险是跨人推导的, 不给')
    const raw = JSON.stringify(r.data)
    for (const other of [F, G, L]) assert.ok(!raw.includes(other.name), `响应里不该出现 ${other.name}`)
    for (const k of ['F', 'G', 'L']) assert.ok(!raw.includes(`"${eid[k]}"`), `响应里不该出现别人的 engineerId ${eid[k]}`)
    for (const s of [SF, SG, SFD]) assert.ok(!raw.includes(s.name), `别人的技能 ${s.name} 不该出现`)
  })

  test('2. 工程师改自己的等级 → 403, 库里不变', async () => {
    const r = await engE.post(`/api/team/skills/${eid.E}`, { skillId: String(SE.id), level: 5 })
    assert.equal(r.status, 403)
    assert.equal(r.code, 1003)
    const confirm = await engE.post('/api/team/skills/confirm', { engineerId: String(eid.E), skillName: `${RUN}x`, level: 3 })
    assert.equal(confirm.status, 403, 'confirm 同样 403')
    const row = await prisma.engineerSkill.findUnique({ where: { engineerId_skillId: { engineerId: eid.E, skillId: SE.id } } })
    assert.equal(row.level, 3)
    assert.equal(await prisma.skill.count({ where: { name: `${RUN}x` } }), 0, '没有顺手建出技能')
  })

  test('3. 组长改本组的人 → 403(0.6.4 收紧)', async () => {
    const r = await lead.post(`/api/team/skills/${eid.F}`, { skillId: String(SF.id), level: 1 })
    assert.equal(r.status, 403)
    assert.equal(r.code, 1003)
    const c = await lead.post('/api/team/skills/confirm', { engineerId: String(eid.F), skillName: SFD.name, level: 2 })
    assert.equal(c.status, 403, '组长确认候选也 403')
    const row = await prisma.engineerSkill.findUnique({ where: { engineerId_skillId: { engineerId: eid.F, skillId: SF.id } } })
    assert.equal(row.level, 4)
    // 组长读本组不变
    const g = await lead.get('/api/team/skills')
    assert.equal(g.code, 0, g.message)
    assert.equal(g.raw.meta.scope, 'TEAM')
    assert.deepEqual(g.data.members.map(m => m.engineerId).sort(), [eid.L, eid.E, eid.F].map(String).sort())
    assert.ok(!g.data.cells.some(c => c.engineerId === String(eid.G)), '组长看不到组外的 G')
  })

  test('4. ADMIN 改同一人 → 200, 等级写入 + 审计', async () => {
    const r = await admin.post(`/api/team/skills/${eid.F}`, { skillId: String(SF.id), level: 1 })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.code, 0, r.message)
    assert.deepEqual([r.data.engineerId, r.data.level, r.data.source], [String(eid.F), 1, 'MANUAL'])
    const row = await prisma.engineerSkill.findUnique({ where: { engineerId_skillId: { engineerId: eid.F, skillId: SF.id } } })
    assert.equal(row.level, 1)
    const audit = await prisma.auditLog.findFirst({ where: { action: 'team.skill.set', resourceType: 'engineer_skill', resourceId: row.id, userId: adminId }, orderBy: { id: 'desc' } })
    assert.ok(audit, '审计落库')
    assert.equal(audit.details.level, 1)
    assert.equal(audit.details.before, 4)
  })

  test('5. ADMIN GET 仍是全部人(≥ 3), 含组外的 G', async () => {
    const r = await admin.get('/api/team/skills')
    assert.equal(r.code, 0, r.message)
    assert.equal(r.raw.meta.scope, 'ALL')
    assert.ok(r.data.members.length >= 3)
    for (const k of ['L', 'E', 'F', 'G']) assert.ok(r.data.members.some(m => m.engineerId === String(eid[k])), `有 ${k}`)
    assert.ok(r.data.singlePoints.includes(String(SG.id)), '全量视角下单点风险照常给')
  })

  test('6. 未登录 GET → 401', async () => {
    const r = await api(null).get('/api/team/skills')
    assert.equal(r.status, 401)
  })
})
