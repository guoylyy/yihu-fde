// 集成测试 - 以虎 One 通讯录同步(真实数据库 + 本地假平台): 资料更新、平台停用 / 恢复、团队 = 平台部门
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import prisma from '../../src/lib/prisma.js'
import { syncDirectory } from '../../src/services/directorySync.js'

const stamp = Date.now()
const dept = { id: 800000 + (stamp % 100000), name: `交付${stamp}`, path: `全员/交付${stamp}`, isPrimary: true }
let server, users = [], directory = []
const saved = {}

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ code: 0, data: { list: directory } }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  for (const k of ['OIDC_ISSUER', 'OIDC_INTERNAL_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']) saved[k] = process.env[k]
  Object.assign(process.env, { OIDC_ISSUER: 'https://one.example.com', OIDC_INTERNAL_URL: `http://127.0.0.1:${server.address().port}`, OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's' })
  for (const n of [1, 2]) {
    users.push(await prisma.user.create({ data: { username: `unit-test-dir-${stamp}-${n}`, name: `旧名${n}`, role: 'FDE_ENGINEER', status: 1, oidcSubject: String(700000000 + (stamp % 1000000) * 10 + n) } }))
  }
})

after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  const team = await prisma.team.findUnique({ where: { platformDeptId: dept.id } })
  if (team) {
    await prisma.teamMembership.deleteMany({ where: { teamId: team.id } })
    await prisma.team.delete({ where: { id: team.id } })
  }
  await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } })
  server.close()
})

const entry = (u, extra = {}) => ({ id: Number(u.oidcSubject), name: u.name, active: true, depts: [dept], ...extra })

describe('syncDirectory', () => {
  test('全量: 资料按平台更新, 平台部门生成团队并带上成员', async () => {
    directory = [entry(users[0], { name: '新名1', email: `d1-${stamp}@example.com` }), entry(users[1])]
    const r = await syncDirectory({ full: true })
    assert.ok(!r.error, r.error)
    const u1 = await prisma.user.findUnique({ where: { id: users[0].id } })
    assert.deepEqual([u1.name, u1.email], ['新名1', `d1-${stamp}@example.com`])
    const team = await prisma.team.findUnique({ where: { platformDeptId: dept.id }, include: { members: true } })
    assert.equal(team.name, dept.path)
    assert.equal(team.members.length, 2)
  })

  test('手建的团队不归同步管', async () => {
    const manual = await prisma.team.create({ data: { name: `unit-test-manual-${stamp}`, status: 1 } })
    try {
      await syncDirectory({ full: true })
      assert.equal((await prisma.team.findUnique({ where: { id: manual.id } })).status, 1)
    } finally {
      await prisma.team.delete({ where: { id: manual.id } })
    }
  })

  test('平台上停用 → 本系统停用并退出团队; 恢复后自动启用', async () => {
    directory = [entry(users[0], { name: '新名1' }), entry(users[1], { active: false })]
    await syncDirectory({ full: true })
    const off = await prisma.user.findUnique({ where: { id: users[1].id } })
    assert.deepEqual([off.status, off.platformDisabled], [0, true])
    const team = await prisma.team.findUnique({ where: { platformDeptId: dept.id }, include: { members: true } })
    assert.deepEqual(team.members.map(m => String(m.userId)), [String(users[0].id)])

    directory = [entry(users[1])]
    await syncDirectory({ full: false })
    const on = await prisma.user.findUnique({ where: { id: users[1].id } })
    assert.deepEqual([on.status, on.platformDisabled], [1, false])
  })
})
