// 单元测试 - 平台用户 → 本系统账号的纯规则: 角色、空间、用户名; 通讯录同步与使用数据的纯函数(不连数据库)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { computeRole, spaceAllowed, usernameCandidates, platformProfile } from '../../src/lib/identity.js'
import { teamNameFor, userChanges } from '../../src/services/directorySync.js'
import { matchAction } from '../../src/lib/usage.js'

const rules = { adminRoles: ['ADMIN'], defaultRole: 'FDE_ENGINEER', leaderIsManager: false }

describe('computeRole', () => {
  test('平台管理员自动成为本系统管理员(没手动设过角色时)', () => {
    assert.deepEqual(computeRole({ roles: ['ADMIN'] }, null, rules), { role: 'ADMIN', roleSource: 'PLATFORM_ADMIN' })
    assert.deepEqual(computeRole({ roles: ['MEMBER', 'ADMIN'] }, { role: 'FDE_ENGINEER', roleSource: 'DEFAULT' }, rules).role, 'ADMIN')
  })
  test('本系统手动设过的角色优先于平台管理员, 不会被改回去', () => {
    assert.deepEqual(computeRole({ roles: ['ADMIN'] }, { role: 'MANAGER', roleSource: 'MANUAL' }, rules), { role: 'MANAGER', roleSource: 'MANUAL' })
    assert.deepEqual(computeRole({ roles: ['MEMBER'] }, { role: 'ADMIN', roleSource: 'MANUAL' }, rules), { role: 'ADMIN', roleSource: 'MANUAL' })
  })
  test('管理员在本系统设过的角色(MANUAL)登录时不改', () => {
    assert.deepEqual(computeRole({ roles: ['MEMBER'], leaderOf: [3] }, { role: 'MANAGER', roleSource: 'MANUAL' }, { ...rules, leaderIsManager: true }),
      { role: 'MANAGER', roleSource: 'MANUAL' })
  })
  test('不再是平台管理员的, 回到按规则算(默认角色)', () => {
    assert.deepEqual(computeRole({ roles: ['MEMBER'] }, { role: 'ADMIN', roleSource: 'PLATFORM_ADMIN' }, rules), { role: 'FDE_ENGINEER', roleSource: 'DEFAULT' })
  })
  test('部门负责人规则: 打开时负责人是项目经理, 关闭时是默认角色', () => {
    const pu = { roles: ['MEMBER'], leaderOf: [12] }
    assert.deepEqual(computeRole(pu, null, { ...rules, leaderIsManager: true }), { role: 'MANAGER', roleSource: 'DEPT_LEADER' })
    assert.deepEqual(computeRole(pu, null, rules), { role: 'FDE_ENGINEER', roleSource: 'DEFAULT' })
    assert.deepEqual(computeRole({ roles: ['MEMBER'], leaderOf: [] }, { role: 'MANAGER', roleSource: 'DEPT_LEADER' }, { ...rules, leaderIsManager: true }),
      { role: 'FDE_ENGINEER', roleSource: 'DEFAULT' })
  })
  test('OIDC_ADMIN_ROLES 置空则不映射管理员', () => {
    assert.equal(computeRole({ roles: ['ADMIN'] }, null, { ...rules, adminRoles: [] }).role, 'FDE_ENGINEER')
  })
})

describe('spaceAllowed', () => {
  const home = { code: 'acme', name: 'Acme' }
  test('同一空间、或平台 / 用户没有空间信息时放行', () => {
    assert.equal(spaceAllowed({ space: { code: 'acme' } }, home), true)
    assert.equal(spaceAllowed({}, home), true)
    assert.equal(spaceAllowed({ space: { code: 'other' } }, null), true)
  })
  test('其他空间的人挡住', () => {
    assert.equal(spaceAllowed({ space: { code: 'other' } }, home), false)
  })
})

test('usernameCandidates: 合法字符, 依次退到邮箱前缀, 撞名带平台 id', () => {
  const [a, b] = usernameCandidates({ id: 36, username: 'Zhang San!' })
  assert.equal(a, 'zhangsan')
  assert.equal(b, 'zhangsan-36')
  assert.equal(usernameCandidates({ id: 1, email: 'Li.Si@corp.com' })[0], 'li.si')
  assert.equal(usernameCandidates({ id: 1, username: '张三' })[0], 'user')
})

describe('通讯录同步', () => {
  test('userChanges: 资料以平台为准; 平台停用 → 停用, 恢复 → 启用; 手动停用的不自动启用', () => {
    const u = { name: '旧名', email: 'a@x.com', phone: null, status: 1, platformDisabled: false, platformFields: ['name', 'email'] }
    assert.deepEqual(userChanges(u, { name: '新名', email: 'a@x.com', active: true }), { name: '新名' })
    assert.deepEqual(userChanges(u, { name: '旧名', email: 'a@x.com', active: false }), { status: 0, platformDisabled: true })
    assert.deepEqual(userChanges({ ...u, status: 0, platformDisabled: true }, { name: '旧名', email: 'a@x.com', active: true }), { status: 1, platformDisabled: false })
    assert.equal(userChanges({ ...u, status: 0, platformDisabled: false }, { name: '旧名', email: 'a@x.com', active: true }), null)
  })
  test('teamNameFor: 用部门路径, 太长保留末段, 重名带部门 id', () => {
    const taken = new Set()
    assert.equal(teamNameFor({ id: 1, name: '前道', path: '全员/制造中心/前道' }, taken), '全员/制造中心/前道')
    assert.equal(teamNameFor({ id: 2, name: '前道', path: '全员/制造中心/前道' }, taken), '全员/制造中心/前道 #2')
    const long = teamNameFor({ id: 3, name: '交付一组', path: 'x'.repeat(80) }, taken)
    assert.ok(long.length <= 50 && long.endsWith('交付一组'))
  })
})

test('matchAction: 认出关键操作, 其余不报', () => {
  assert.deepEqual(matchAction('POST', '/tasks', {}), { action: 'task.create', detail: {} })
  assert.deepEqual(matchAction('POST', '/tasks/12/status', { status: 'DONE' }), { action: 'task.status', detail: { taskId: '12', status: 'DONE' } })
  assert.equal(matchAction('POST', '/timesheets/5/approve', { approved: false }).detail.approved, false)
  assert.equal(matchAction('PUT', '/tasks/12', {}), null)
  assert.equal(matchAction('POST', '/notifications/read-all', {}), null)
})

describe('资料以以虎 One 为准', () => {
  test('platformProfile: 平台有的字段写进来并记成只读, 没有的不动', () => {
    const p = platformProfile({ id: 5, name: '赵立恒', email: 'zhao@example.com', mobile: null, avatar: 'https://static.example.com/a.png' })
    assert.deepEqual(p.data, { name: '赵立恒', email: 'zhao@example.com', avatarUrl: 'https://static.example.com/a.png' })
    assert.deepEqual(p.fields, ['name', 'email', 'avatarUrl'])
    assert.deepEqual(platformProfile({ id: 6, username: 'liu' }).fields, ['name'])
    // 放不下的头像(太长)不要
    assert.equal(platformProfile({ name: 'x', avatar: 'data:' + 'a'.repeat(600) }).data.avatarUrl, undefined)
  })
  test('userChanges: 通讯录同步头像和只读标记; 老平台的通讯录不带头像时不动头像', () => {
    const user = { name: '赵立恒', email: null, phone: null, avatarUrl: '/avatars/cartoon-1.svg', platformFields: ['name'], status: 1 }
    assert.deepEqual(userChanges(user, { name: '赵立恒', avatar: 'https://static.example.com/a.png', active: true }),
      { avatarUrl: 'https://static.example.com/a.png', platformFields: ['name', 'avatarUrl'] })
    // 老平台：没有 avatar 这个键
    assert.equal(userChanges(user, { name: '赵立恒', active: true }), null)
    // 平台上有了邮箱
    assert.deepEqual(userChanges(user, { name: '赵立恒', email: 'z@example.com', avatar: null, active: true }), { email: 'z@example.com', platformFields: ['name', 'email'] })
  })
})
