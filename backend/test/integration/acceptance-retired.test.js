// 集成测试 - v2.8.5(#1161) 验收体系下线: 8 条接口统一 410 桩, 不返回业务数据
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { login, api } from './helpers.js'

describe('v2.8.5 验收接口已下线 (410)', () => {
  let a
  before(async () => { a = api(await login()) })
  const cases = [
    ['get', '/api/fde/tasks/_meta/acceptance-stats'],
    ['get', '/api/fde/tasks/_meta/acceptance-samples'],
    ['get', '/api/fde/tasks/_meta/regression-cases'],
    ['post', '/api/fde/tasks/_meta/regression-run'],
    ['get', '/api/fde/tasks/_meta/regression-runs'],
    ['get', '/api/fde/tasks/_meta/feedback-stats'],
    ['post', '/api/fde/tasks/1/accept'],
    ['get', '/api/fde/tasks/1/acceptance-records']
  ]
  for (const [m, path] of cases) {
    test(`${m.toUpperCase()} ${path} → 410`, async () => {
      const r = await a[m](path, m === 'post' ? {} : undefined)
      assert.equal(r.status, 410)
      assert.equal(r.code, 410)
      assert.equal(r.raw.retiredIn, 'v2.8.5')
      assert.equal(r.data, undefined)
    })
  }
  test('任务详情与状态流转不受影响, source-stats 仍在', async () => {
    const r = await a.get('/api/fde/tasks/_meta/source-stats')
    assert.equal(r.code, 0)
  })
})
