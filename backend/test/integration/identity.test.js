// 集成测试 - 平台用户 → 本系统账号(连真实数据库 + 本地假平台): 开通、按邮箱关联、角色规则、空间限制、停用
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import prisma from '../../src/lib/prisma.js'
import { oidcConfig } from '../../src/lib/oidc.js'
import { resetPlatformCaches } from '../../src/lib/yihuOne.js'
import { signInPlatformUser, OidcLoginError } from '../../src/lib/identity.js'
import { saveSettings } from '../../src/lib/settings.js'

let server, cfg
const stamp = Date.now()
const pid = (n) => 900000000 + (stamp % 1000000) * 10 + n   // 平台用户 id, 避开真实数据
const subs = []

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ code: 0, data: { code: 'fde', name: 'FDE', space: { id: 1, code: 'acme', name: 'Acme' }, brand: null } }))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  cfg = oidcConfig({ OIDC_ISSUER: 'https://one.example.com', OIDC_INTERNAL_URL: `http://127.0.0.1:${server.address().port}`, OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's' })
})

after(async () => {
  await saveSettings({ 'auth.leaderIsManager': null })
  const users = await prisma.user.findMany({ where: { OR: [{ oidcSubject: { in: subs.map(String) } }, { username: { startsWith: `unit-test-link-${stamp}` } }] }, select: { id: true } })
  const ids = users.map(u => u.id)
  await prisma.engineer.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  server.close()
})

beforeEach(() => resetPlatformCaches())

const pu = (n, extra = {}) => { subs.push(pid(n)); return { id: pid(n), username: `yh${stamp}${n}`, name: `平台用户${n}`, roles: ['MEMBER'], leaderOf: [], space: { code: 'acme' }, ...extra } }

describe('signInPlatformUser', () => {
  test('首次登录自动开通: 默认角色 + 工程师档案, 资料取平台', async () => {
    const u = await signInPlatformUser(pu(1, { email: `p1-${stamp}@example.com` }), cfg)
    assert.equal(u.role, 'FDE_ENGINEER')
    assert.equal(u.roleSource, 'DEFAULT')
    assert.equal(u.name, '平台用户1')
    assert.ok(u.engineer, '工程师角色自动建档案')
  })

  test('再次登录: 姓名按平台更新, 不重复开通', async () => {
    const again = await signInPlatformUser(pu(1, { name: '改名了' }), cfg)
    assert.equal(again.name, '改名了')
    assert.equal(await prisma.user.count({ where: { oidcSubject: String(pid(1)) } }), 1)
  })

  test('平台管理员 → 管理员; 不再是平台管理员 → 回到默认角色', async () => {
    assert.equal((await signInPlatformUser(pu(2, { roles: ['ADMIN'] }), cfg)).role, 'ADMIN')
    const back = await signInPlatformUser(pu(2), cfg)
    assert.deepEqual([back.role, back.roleSource], ['FDE_ENGINEER', 'DEFAULT'])
  })

  test('管理员手动设的角色登录时保留', async () => {
    const u = await signInPlatformUser(pu(3), cfg)
    await prisma.user.update({ where: { id: u.id }, data: { role: 'MANAGER', roleSource: 'MANUAL' } })
    assert.equal((await signInPlatformUser(pu(3), cfg)).role, 'MANAGER')
  })

  test('本系统改过平台管理员的角色: 再登录不会被改回管理员', async () => {
    const u = await signInPlatformUser(pu(8, { roles: ['ADMIN'] }), cfg)
    assert.equal(u.role, 'ADMIN')
    await prisma.user.update({ where: { id: u.id }, data: { role: 'FDE_ENGINEER', roleSource: 'MANUAL' } })
    const again = await signInPlatformUser(pu(8, { roles: ['ADMIN'] }), cfg)
    assert.deepEqual([again.role, again.roleSource], ['FDE_ENGINEER', 'MANUAL'])
  })

  test('本系统手动设成管理员的人, 平台上不是管理员也不会被降级', async () => {
    const u = await signInPlatformUser(pu(9), cfg)
    await prisma.user.update({ where: { id: u.id }, data: { role: 'ADMIN', roleSource: 'MANUAL' } })
    assert.equal((await signInPlatformUser(pu(9), cfg)).role, 'ADMIN')
  })

  test('部门负责人规则打开后, 负责人首次登录是项目经理', async () => {
    await saveSettings({ 'auth.leaderIsManager': true })
    const u = await signInPlatformUser(pu(4, { leaderOf: [7] }), cfg)
    assert.deepEqual([u.role, u.roleSource], ['MANAGER', 'DEPT_LEADER'])
    await saveSettings({ 'auth.leaderIsManager': null })
  })

  test('其他空间的人进不来', async () => {
    await assert.rejects(signInPlatformUser(pu(5, { space: { code: 'other' } }), cfg), (e) => e instanceof OidcLoginError && /Acme/.test(e.message))
  })

  test('按邮箱关联唯一的未绑定账号', async () => {
    const email = `link-${stamp}@example.com`
    const local = await prisma.user.create({ data: { username: `unit-test-link-${stamp}`, name: '老账号', email, role: 'MANAGER', status: 1 } })
    const u = await signInPlatformUser(pu(6, { email }), cfg)
    assert.equal(String(u.id), String(local.id))
    assert.equal(u.oidcSubject, String(pid(6)))
    assert.equal(u.role, 'MANAGER', '老账号原有角色(MANUAL)保留')
  })

  test('本系统停用的进不来; 平台停用后又恢复的自动启用', async () => {
    const u = await signInPlatformUser(pu(7), cfg)
    await prisma.user.update({ where: { id: u.id }, data: { status: 0 } })
    await assert.rejects(signInPlatformUser(pu(7), cfg), /停用/)
    await prisma.user.update({ where: { id: u.id }, data: { status: 0, platformDisabled: true } })
    assert.equal((await signInPlatformUser(pu(7), cfg)).status, 1)
  })
})
