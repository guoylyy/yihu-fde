// 单元测试 - fde.projectRecords.extractRequirements 封装
// 会议记录「梳理需求」曾因该方法缺失报 is not a function；stub fetch 验证 URL / method / 拆包
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'

const originalFetch = global.fetch
const originalSetTimeout = global.setTimeout
const calls = []
const timeouts = []

const memStore = { fde_internal_token: 'mock-token' }
global.localStorage = {
  getItem: (k) => memStore[k] || null,
  setItem: (k, v) => { memStore[k] = String(v) },
  removeItem: (k) => { delete memStore[k] }
}

global.fetch = async (url, options) => {
  calls.push({ url, options })
  return { status: 200, json: async () => ({ code: 0, message: 'ok', data: { count: 3, unowned: 1 } }) }
}

const { fde } = await import('../../src/api/index.js')

after(() => {
  global.fetch = originalFetch
  global.setTimeout = originalSetTimeout
})

describe('API: fde.projectRecords.extractRequirements', () => {
  test('方法存在', () => {
    assert.equal(typeof fde.projectRecords.extractRequirements, 'function')
  })

  test('POST 到 records/:rid/requirements/extract，180s 超时，返回 data', async () => {
    global.setTimeout = (fn, ms, ...rest) => { timeouts.push(ms); return originalSetTimeout(fn, ms, ...rest) }
    const d = await fde.projectRecords.extractRequirements(7, 42)
    global.setTimeout = originalSetTimeout

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/api/fde/project-records/7/records/42/requirements/extract')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.body, '{}')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer mock-token')
    assert.ok(timeouts.includes(180000), `expected 180000ms timeout, got ${timeouts}`)
    assert.deepEqual(d, { count: 3, unowned: 1 })
  })
})
