// 集成测试 - /api/fde/knowledge 知识库
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, TAG } from './helpers.js'

describe('API: /api/fde/knowledge 知识库', () => {
  let adminToken, managerToken, salesToken, fdeToken
  let createdIds = []
  let testProjectId

  before(async () => {
    adminToken = await login('admin')
    managerToken = await login('manager')
    salesToken = await login('sales')
    fdeToken = await login('fde001')

    const a = api(adminToken)
    const projRes = await a.get('/api/fde/projects?keyword=Acme&page=1&page_size=5')
    testProjectId = projRes.data.list[0]?.id
    if (!testProjectId) throw new Error('缺少测试项目')

  })

  after(async () => {
    const a = api(adminToken)
    for (const id of createdIds) {
      try { await a.del(`/api/fde/knowledge/${id}`) } catch {}
    }
  })

  // ===== 鉴权 =====
  describe('鉴权', () => {
    test('未登录 401', async () => {
      const r = await api('').get('/api/fde/knowledge')
      assert.notEqual(r.status, 200)
    })

    test('SALES 可看不可创建', async () => {
      const list = await api(salesToken).get('/api/fde/knowledge')
      assert.equal(list.status, 200)
      const create = await api(salesToken).post('/api/fde/knowledge', {
        title: uniqName('销售无权创建'), content: 'test'
      })
      assert.notEqual(create.status, 200, 'SALES 不应有 create 权限')
    })

    test('FDE_ENGINEER 可创建', async () => {
      const r = await api(fdeToken).post('/api/fde/knowledge', {
        title: uniqName('FDE 文章'), content: 'test', category: '技术方案'
      })
      assert.equal(r.status, 200)
      createdIds.push(r.data.id)
    })
  })

  // ===== CRUD =====
  describe('CRUD', () => {
    test('ADMIN 创建含关联交付物的文章', async () => {
      const body = {
        title: uniqName('知识文章'),
        category: '技术方案',
        content: '# 标题\n\n内容 **加粗** 文字。',
        tags: ['test', 'unit'],
        projectId: testProjectId
      }
      const r = await api(adminToken).post('/api/fde/knowledge', body)
      assert.equal(r.status, 200)
      assert.equal(r.code, 0)
      assert.equal(r.data.title, body.title)
      assert.deepEqual(r.data.tags, ['test', 'unit'])
      createdIds.push(r.data.id)
    })

    test('详情含项目', async () => {
      const create = await api(adminToken).post('/api/fde/knowledge', {
        title: uniqName('详情测试'),
        content: '内容',
        projectId: testProjectId
      })
      createdIds.push(create.data.id)

      const detail = await api(adminToken).get(`/api/fde/knowledge/${create.data.id}`)
      assert.equal(detail.code, 0)
      assert.equal(detail.data.id, create.data.id)
      assert.ok(detail.data.project, '应含项目信息')
    })

    test('更新标签', async () => {
      const create = await api(adminToken).post('/api/fde/knowledge', {
        title: uniqName('标签更新'),
        content: '内容'
      })
      createdIds.push(create.data.id)

      const update = await api(adminToken).put(`/api/fde/knowledge/${create.data.id}`, {
        tags: ['new']
      })
      assert.equal(update.code, 0)
      assert.deepEqual(update.data.tags, ['new'])
    })

    test('删除文章', async () => {
      const create = await api(adminToken).post('/api/fde/knowledge', {
        title: uniqName('删除测试'), content: 'x'
      })
      const del = await api(adminToken).del(`/api/fde/knowledge/${create.data.id}`)
      assert.equal(del.code, 0)
      const detail = await api(adminToken).get(`/api/fde/knowledge/${create.data.id}`)
      assert.equal(detail.status, 404)
    })
  })

  // ===== 浏览计数 =====
  describe('浏览计数', () => {
    test('view +1', async () => {
      const create = await api(adminToken).post('/api/fde/knowledge', {
        title: uniqName('浏览测试'), content: 'x'
      })
      createdIds.push(create.data.id)

      const before = create.data.viewCount
      const v1 = await api(adminToken).post(`/api/fde/knowledge/${create.data.id}/view`, {})
      assert.equal(v1.code, 0)
      assert.equal(v1.data.viewCount, before + 1)
      const v2 = await api(adminToken).post(`/api/fde/knowledge/${create.data.id}/view`, {})
      assert.equal(v2.data.viewCount, before + 2)
    })
  })

  // ===== 筛选 =====
  describe('GET / 列表筛选', () => {
    test('关键字搜索（标题）', async () => {
      const unique = uniqName('搜索关键词')
      const create = await api(adminToken).post('/api/fde/knowledge', {
        title: unique, content: 'x'
      })
      createdIds.push(create.data.id)

      const res = await api(adminToken).get(`/api/fde/knowledge?keyword=${encodeURIComponent(unique.slice(0, 20))}`)
      assert.equal(res.code, 0)
      assert.ok(res.data.total >= 1)
    })

    test('分类筛选', async () => {
      const cat = uniqName('分类A').slice(0, 20)
      await api(adminToken).post('/api/fde/knowledge', {
        title: uniqName('A1'), content: 'x', category: cat
      })
      await api(adminToken).post('/api/fde/knowledge', {
        title: uniqName('A2'), content: 'x', category: cat
      })

      const res = await api(adminToken).get(`/api/fde/knowledge?category=${encodeURIComponent(cat)}`)
      assert.equal(res.code, 0)
      for (const a of res.data.list) assert.equal(a.category, cat)
      // 清理
      for (const a of res.data.list) {
        createdIds.push(a.id)
      }
    })
  })

  // ===== 分类字典 =====
  describe('GET /categories', () => {
    test('返回分类 + 计数', async () => {
      const r = await api(adminToken).get('/api/fde/knowledge/categories')
      assert.equal(r.code, 0)
      assert.ok(Array.isArray(r.data))
      if (r.data.length) {
        assert.ok(typeof r.data[0].name === 'string')
        assert.ok(typeof r.data[0].count === 'number')
      }
    })
  })
})