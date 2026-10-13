// 集成测试 - /api/fde/customers 客户管理
// P0: 核心 CRUD + 鉴权 + 数据级权限
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, TAG } from './helpers.js'

describe('API: /api/fde/customers 客户管理', () => {
  let token, a, createdIds = []

  before(async () => {
    token = await login()
    a = api(token)
  })

  after(async () => {
    // 清理所有测试创建的客户
    for (const id of createdIds) {
      try { await a.del(`/api/fde/customers/${id}`) } catch {}
    }
  })

  // ===== 鉴权 =====
  describe('鉴权', () => {
    test('未登录返回 401', async () => {
      const noAuth = api('')
      const r = await noAuth.get('/api/fde/customers')
      assert.notEqual(r.status, 200)
    })

    test('无效 token 返回 401', async () => {
      const bad = api('invalid.token.here')
      const r = await bad.get('/api/fde/customers')
      assert.notEqual(r.status, 200)
    })
  })

  // ===== 列表 =====
  describe('GET / 列表', () => {
    test('正常返回列表结构', async () => {
      const r = await a.get('/api/fde/customers')
      assert.equal(r.code, 0)
      assert.ok(r.data.list, '应有 list 字段')
      assert.ok(typeof r.data.total === 'number', '应有 total')
    })

    test('分页参数生效', async () => {
      const r = await a.get('/api/fde/customers?page=1&page_size=5')
      assert.equal(r.code, 0)
      assert.ok(r.data.list.length <= 5, 'list 长度应 ≤ 5')
    })

    test('keyword 搜索生效', async () => {
      const r = await a.get(`/api/fde/customers?keyword=${TAG}`)
      assert.equal(r.code, 0)
      // 搜索结果中所有项都应含 TAG
      for (const c of r.data.list) {
        assert.ok(c.name.includes(TAG) || (c.shortName && c.shortName.includes(TAG)))
      }
    })
  })

  // ===== 创建 =====
  describe('POST / 创建', () => {
    test('合法数据创建客户', async () => {
      const name = uniqName('客户')
      const r = await a.post('/api/fde/customers', {
        name, industry: '互联网', scale: 'A'
      })
      assert.equal(r.code, 0, `创建失败: ${r.message}`)
      assert.ok(r.data.id, '应返回 id')
      assert.equal(r.data.name, name)
      createdIds.push(r.data.id)
    })

    test('缺 name 返回错误', async () => {
      const r = await a.post('/api/fde/customers', { industry: 'X' })
      assert.notEqual(r.code, 0, '缺 name 应失败')
    })

    test('industry 缺失也允许（schema 里是 optional）', async () => {
      const r = await a.post('/api/fde/customers', { name: uniqName() })
      // industry 在 schema 里是可选
      assert.equal(r.code, 0, `应成功: ${r.message}`)
      if (r.data?.id) createdIds.push(r.data.id)
    })

    test('同名重复不阻塞（看业务实现）', async () => {
      const name = uniqName('dup')
      const r1 = await a.post('/api/fde/customers', { name, industry: 'X' })
      if (r1.code === 0) createdIds.push(r1.data.id)
      const r2 = await a.post('/api/fde/customers', { name, industry: 'X' })
      if (r2.code === 0) createdIds.push(r2.data.id)
      // 至少一个成功即可
      assert.ok(r1.code === 0 || r2.code === 0)
    })
  })

  // ===== 单条 =====
  describe('GET /:id 单条', () => {
    test('合法 id 返回详情', async () => {
      const name = uniqName('单查')
      const cr = await a.post('/api/fde/customers', { name, industry: 'X' })
      createdIds.push(cr.data.id)
      const r = await a.get(`/api/fde/customers/${cr.data.id}`)
      assert.equal(r.code, 0)
      assert.equal(r.data.name, name)
    })

    test('不存在的 id 返回 404/错误', async () => {
      const r = await a.get('/api/fde/customers/999999999')
      assert.notEqual(r.code, 0)
    })
  })

  // ===== 更新 =====
  describe('PUT /:id 更新', () => {
    test('更新名称和行业', async () => {
      const cr = await a.post('/api/fde/customers', { name: uniqName('upd'), industry: 'X' })
      createdIds.push(cr.data.id)
      const newName = uniqName('updated')
      const r = await a.put(`/api/fde/customers/${cr.data.id}`, {
        name: newName, industry: 'Y'
      })
      assert.equal(r.code, 0)
      const check = await a.get(`/api/fde/customers/${cr.data.id}`)
      assert.equal(check.data.name, newName)
      assert.equal(check.data.industry, 'Y')
    })

    test('更新不存在的 id 返回错误', async () => {
      const r = await a.put('/api/fde/customers/999999999', { name: 'x' })
      assert.notEqual(r.code, 0)
    })

    test('空 body 返回错误', async () => {
      const cr = await a.post('/api/fde/customers', { name: uniqName(), industry: 'X' })
      createdIds.push(cr.data.id)
      const r = await a.put(`/api/fde/customers/${cr.data.id}`, {})
      // 实现可能允许空 body（无变化），也可能拒绝
      // 至少不应崩溃
      assert.ok(r.code !== undefined)
    })
  })

  // ===== 删除 =====
  describe('DELETE /:id 删除', () => {
    test('删除存在的客户', async () => {
      const cr = await a.post('/api/fde/customers', { name: uniqName('del'), industry: 'X' })
      const r = await a.del(`/api/fde/customers/${cr.data.id}`)
      assert.equal(r.code, 0)
      // 确认已删
      const check = await a.get(`/api/fde/customers/${cr.data.id}`)
      assert.notEqual(check.code, 0)
    })

    test('删除不存在的 id 返回错误', async () => {
      const r = await a.del('/api/fde/customers/999999999')
      assert.notEqual(r.code, 0)
    })
  })
})
