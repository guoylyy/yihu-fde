// 集成测试 - /api/auth 登录 + me
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { api, uniqName, ADMIN_PWD } from './helpers.js'

describe('API: /api/auth 鉴权基础', () => {

  // ===== 登录 =====
  describe('POST /login 登录', () => {
    test('正确凭据返回 token', async () => {
      const r = await fetch('http://localhost:3005/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: ADMIN_PWD })
      })
      const d = await r.json()
      assert.equal(d.code, 0)
      assert.ok(d.data.token, '应返回 token')
      assert.ok(d.data.token.split('.').length === 3, 'JWT 3 段')
    })

    test('错误密码返回错误', async () => {
      const r = await fetch('http://localhost:3005/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong' })
      })
      const d = await r.json()
      assert.notEqual(d.code, 0)
    })

    test('不存在的用户返回错误', async () => {
      const r = await fetch('http://localhost:3005/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody-here', password: 'x' })
      })
      const d = await r.json()
      assert.notEqual(d.code, 0)
    })

    test('缺 username 返回错误', async () => {
      const r = await fetch('http://localhost:3005/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'x' })
      })
      const d = await r.json()
      assert.notEqual(d.code, 0)
    })

    test('缺 password 返回错误', async () => {
      const r = await fetch('http://localhost:3005/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin' })
      })
      const d = await r.json()
      assert.notEqual(d.code, 0)
    })

    test('空 body 返回错误', async () => {
      const r = await fetch('http://localhost:3005/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const d = await r.json()
      assert.notEqual(d.code, 0)
    })
  })

  // ===== me =====
  describe('GET /me 当前用户', () => {
    test('带 token 返回用户信息', async () => {
      const lr = await fetch('http://localhost:3005/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: ADMIN_PWD })
      })
      const ld = await lr.json()
      const a = api(ld.data.token)
      const r = await a.get('/api/auth/me')
      assert.equal(r.code, 0)
      assert.equal(r.data.username, 'admin')
    })

    test('不带 token 返回 401', async () => {
      const r = await fetch('http://localhost:3005/api/auth/me')
      assert.equal(r.status, 401)
    })

    test('错误 token 返回 401', async () => {
      const a = api('not.a.jwt')
      const r = await a.get('/api/auth/me')
      assert.equal(r.status, 401)
    })
  })
})
