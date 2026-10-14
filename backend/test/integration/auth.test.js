// 集成测试 - /api/auth: 只用以虎 One 登录; 开发登录只在本地开发 / 测试打开
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { api, login, request } from './helpers.js'

describe('API: /api/auth 鉴权基础', () => {
  describe('登录方式', () => {
    test('providers: 没接平台时 platform=null, 测试环境开了开发登录', async () => {
      const r = await request('GET', '/api/auth/providers')
      assert.equal(r.code, 0)
      assert.equal(r.data.devLogin, true)
      assert.ok('platform' in r.data)
      assert.equal('password' in r.data, false)
    })

    test('账号密码登录已不存在', async () => {
      const r = await request('POST', '/api/auth/login', { username: 'admin', password: '123456' })
      assert.equal(r.status, 404)
    })

    test('没接平台时统一登录入口返回 404', async () => {
      const r = await request('GET', '/api/auth/oidc/login')
      assert.equal(r.status, 404)
    })

    test('开发登录: 不存在 / 缺用户名返回 401', async () => {
      assert.equal((await request('POST', '/api/auth/dev-login', { username: 'nobody-here' })).status, 401)
      assert.equal((await request('POST', '/api/auth/dev-login', {})).status, 401)
    })

    test('ticket 无效返回 401', async () => {
      const r = await request('POST', '/api/auth/oidc/exchange', { ticket: 'nope' })
      assert.equal(r.status, 401)
    })
  })

  describe('GET /me 当前用户', () => {
    test('带 token 返回用户信息', async () => {
      const r = await api(await login()).get('/api/auth/me')
      assert.equal(r.code, 0)
      assert.equal(r.data.username, 'admin')
      assert.equal('mustChangePassword' in r.data, false)
    })

    test('不带 token 返回 401', async () => {
      const r = await request('GET', '/api/auth/me')
      assert.equal(r.status, 401)
    })

    test('错误 token 返回 401', async () => {
      const r = await api('bad.token.here').get('/api/auth/me')
      assert.equal(r.status, 401)
    })
  })
})
