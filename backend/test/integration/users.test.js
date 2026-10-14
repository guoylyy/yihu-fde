// 集成测试 - /api/fde/users 用户管理(人以以虎 One 为准: 没有本地建号和密码, 本系统只管角色与启停)
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, TAG, createTestUser } from './helpers.js'

describe('API: /api/fde/users 用户管理', () => {
  let a, target, fdeApi

  before(async () => {
    a = api(await login())
    target = await createTestUser('FDE_ENGINEER')
    fdeApi = api(target.token)
  })

  after(async () => {
    await target?.cleanup()
  })

  describe('GET / 列表', () => {
    test('admin 列出全部用户, 带角色来源与平台绑定信息', async () => {
      const r = await a.get('/api/fde/users')
      assert.equal(r.code, 0)
      assert.ok(Array.isArray(r.data.list))
      assert.ok(typeof r.data.total === 'number')
      assert.ok('roleSource' in r.data.list[0])
    })

    test('role 筛选生效', async () => {
      const r = await a.get('/api/fde/users?role=ADMIN')
      assert.equal(r.code, 0)
      for (const u of r.data.list) assert.equal(u.role, 'ADMIN')
    })

    test('keyword 搜索生效', async () => {
      const r = await a.get(`/api/fde/users?keyword=${TAG}`)
      assert.equal(r.code, 0)
    })

    test('非管理员不能看用户列表', async () => {
      assert.notEqual((await fdeApi.get('/api/fde/users')).code, 0)
    })
  })

  describe('开通: 只能从以虎 One 通讯录选人', () => {
    test('没接以虎 One 时开通返回 503', async () => {
      const r = await a.post('/api/fde/users', { platformUserId: 1, role: 'FDE_ENGINEER' })
      assert.equal(r.status, 503)
      assert.equal((await a.get('/api/fde/users/platform-directory')).status, 503)
    })
  })

  describe('PUT /:id 改角色 / 启停', () => {
    test('改角色后记为管理员设置(MANUAL)', async () => {
      const r = await a.put(`/api/fde/users/${target.id}`, { role: 'MANAGER' })
      assert.equal(r.code, 0, r.message)
      const d = await a.get(`/api/fde/users/${target.id}`)
      assert.equal(d.data.role, 'MANAGER')
      assert.equal(d.data.roleSource, 'MANUAL')
    })

    test('姓名 / 邮箱以平台为准, 这里改不了', async () => {
      await a.put(`/api/fde/users/${target.id}`, { name: '被改的名字', email: 'x@y.z' })
      const d = await a.get(`/api/fde/users/${target.id}`)
      assert.notEqual(d.data.name, '被改的名字')
    })

    test('无效角色返回错误', async () => {
      const r = await a.put(`/api/fde/users/${target.id}`, { role: 'HACKER' })
      assert.notEqual(r.code, 0)
    })

    test('更新不存在的 id', async () => {
      const r = await a.put('/api/fde/users/999999999', { role: 'FDE_ENGINEER' })
      assert.notEqual(r.code, 0)
    })
  })

  describe('没有密码相关接口', () => {
    test('重置密码 / 改密码接口已不存在', async () => {
      assert.equal((await a.post(`/api/fde/users/${target.id}/reset-password`, {})).status, 404)
      assert.equal((await fdeApi.put('/api/fde/users/me/change-password', { oldPassword: 'a', newPassword: 'b' })).status, 403)
    })
  })

  describe('GET /:id', () => {
    test('admin 查自己', async () => {
      const r = await a.get('/api/fde/users/1')
      assert.equal(r.code, 0)
      assert.ok(r.data.username)
    })

    test('不存在的 id', async () => {
      const r = await a.get('/api/fde/users/999999999')
      assert.notEqual(r.code, 0)
    })
  })
})
