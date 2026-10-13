// 单元测试 - notifications API 行为
// 用 node:test 模拟 fetch 行为，验证 API 封装正确性
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

// 拦截全局 fetch
const originalFetch = global.fetch
let fetchCalls = []
let mockResponse = null

// 在 import 前准备好 localStorage 模拟
const memStore = {}
global.localStorage = {
  getItem: (k) => memStore[k] || null,
  setItem: (k, v) => { memStore[k] = String(v) },
  removeItem: (k) => { delete memStore[k] }
}

// 登录态
memStore.fde_internal_token = 'mock-token'

global.fetch = async (url, options) => {
  fetchCalls.push({ url, options })
  return {
    status: mockResponse.status,
    json: async () => mockResponse.body
  }
}

function resetMock(body) {
  fetchCalls = []
  mockResponse = { status: 200, body: body || { code: 0, message: 'ok', data: [] } }
}

const { fde } = await import('../../src/api/index.js')

after(() => {
  global.fetch = originalFetch
})

describe('API: fde.notifications 通知中心', () => {

  // ===== list =====
  describe('list 列表', () => {
    test('默认分页请求', async () => {
      resetMock({
        code: 0, message: 'ok',
        data: { list: [{ id: '1', type: 'TEST', title: 't' }], total: 1 }
      })
      const r = await fde.notifications.list()
      assert.equal(fetchCalls.length, 1)
      assert.ok(fetchCalls[0].url.includes('/api/fde/notifications'))
      assert.equal(r.list.length, 1)
      assert.equal(r.total, 1)
    })

    test('传 page 参数', async () => {
      resetMock()
      await fde.notifications.list({ page: 2, page_size: 5 })
      assert.ok(fetchCalls[0].url.includes('page=2'))
      assert.ok(fetchCalls[0].url.includes('page_size=5'))
    })

    test('传 type 过滤', async () => {
      resetMock()
      await fde.notifications.list({ type: 'USER_INVITED' })
      assert.ok(fetchCalls[0].url.includes('type=USER_INVITED'))
    })

    test('传 read=false 只查未读', async () => {
      resetMock()
      await fde.notifications.list({ read: false })
      assert.ok(fetchCalls[0].url.includes('read=false'))
    })

    test('API 错误抛错', async () => {
      mockResponse = { status: 200, body: { code: 1001, message: '未登录' } }
      fetchCalls = []
      await assert.rejects(
        () => fde.notifications.list(),
        /未登录/
      )
    })
  })

  // ===== unreadCount =====
  describe('unreadCount 未读数', () => {
    test('返回未读数', async () => {
      resetMock({ code: 0, message: 'ok', data: { count: 5 } })
      const r = await fde.notifications.unreadCount()
      assert.equal(r.count, 5)
      assert.ok(fetchCalls[0].url.includes('unread-count'))
    })

    test('未读数 0', async () => {
      resetMock({ code: 0, message: 'ok', data: { count: 0 } })
      const r = await fde.notifications.unreadCount()
      assert.equal(r.count, 0)
    })
  })

  // ===== markRead =====
  describe('markRead 标记已读', () => {
    test('POST 通知 ID', async () => {
      resetMock({ code: 0, message: 'ok', data: { success: true } })
      const r = await fde.notifications.markRead('123')
      assert.equal(fetchCalls[0].options.method, 'POST')
      assert.ok(fetchCalls[0].url.includes('/123/read'))
      assert.equal(r.success, true)
    })

    test('标记已读 API 错误抛错', async () => {
      mockResponse = { status: 200, body: { code: 1005, message: '通知不存在' } }
      fetchCalls = []
      await assert.rejects(
        () => fde.notifications.markRead('999999'),
        /通知不存在/
      )
    })
  })

  // ===== readAll =====
  describe('readAll 全部已读', () => {
    test('POST 全部已读', async () => {
      resetMock({ code: 0, message: 'ok', data: { count: 10 } })
      const r = await fde.notifications.readAll()
      assert.equal(fetchCalls[0].options.method, 'POST')
      assert.ok(fetchCalls[0].url.includes('read-all'))
      assert.equal(r.count, 10)
    })
  })

  // ===== remove =====
  describe('remove 删除', () => {
    test('DELETE 通知', async () => {
      resetMock()
      await fde.notifications.remove('123')
      assert.equal(fetchCalls[0].options.method, 'DELETE')
      assert.ok(fetchCalls[0].url.includes('/123'))
    })
  })
})

describe('API: fde.activities 活动流', () => {

  describe('list 列表', () => {
    test('默认请求', async () => {
      resetMock()
      await fde.activities.list()
      assert.ok(fetchCalls[0].url.includes('/api/fde/activities'))
    })

    test('scope=mine', async () => {
      resetMock()
      await fde.activities.list({ scope: 'mine' })
      assert.ok(fetchCalls[0].url.includes('scope=mine'))
    })

    test('scope=project', async () => {
      resetMock()
      await fde.activities.list({ scope: 'project' })
      assert.ok(fetchCalls[0].url.includes('scope=project'))
    })

    test('scope=all', async () => {
      resetMock()
      await fde.activities.list({ scope: 'all' })
      assert.ok(fetchCalls[0].url.includes('scope=all'))
    })
  })

  describe('recent 最近', () => {
    test('返回最近 10 条', async () => {
      resetMock({ code: 0, message: 'ok', data: [{ id: '1' }, { id: '2' }] })
      const r = await fde.activities.recent()
      assert.ok(fetchCalls[0].url.includes('recent'))
      assert.equal(r.length, 2)
    })
  })
})
