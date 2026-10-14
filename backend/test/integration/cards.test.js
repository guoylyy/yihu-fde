// 集成测试 - /api/fde/cards 首页数据卡片小接口 + 对应 MCP 工具的 structuredContent
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { login, api } from './helpers.js'
import { TOOLS } from '../../src/mcp/tools.js'
import { annotationsOf } from '../../src/mcp/index.js'

describe('API: /api/fde/cards', () => {
  let admin, fde
  before(async () => {
    admin = api(await login('admin'))
    fde = api(await login('fde001'))
  })

  test('数字类返回 { total }', async () => {
    for (const p of ['/api/fde/cards/my-open-task-count', '/api/fde/cards/my-week-hours']) {
      const r = await fde.get(p)
      assert.equal(r.code, 0, `${p}: ${r.message}`)
      assert.equal(typeof r.data.total, 'number', p)
    }
  })

  test('列表类返回 { list } 且不超过 limit', async () => {
    for (const p of ['my-tasks', 'project-health', 'overdue-tasks', 'pending-approvals']) {
      const r = await admin.get(`/api/fde/cards/${p}?limit=3`)
      assert.equal(r.code, 0, `${p}: ${r.message}`)
      assert.ok(Array.isArray(r.data.list), p)
      assert.ok(r.data.list.length <= 3, p)
    }
  })

  test('工时趋势按周补齐, 适合折线', async () => {
    const r = await fde.get('/api/fde/cards/my-hours-trend?weeks=6')
    assert.equal(r.data.list.length, 6)
    assert.ok(r.data.list.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.week) && typeof x.hours === 'number'))
  })

  test('工程师没有审批权限时待审批为空', async () => {
    const r = await fde.get('/api/fde/cards/pending-approvals')
    assert.deepEqual(r.data, { total: 0, list: [] })
  })

  test('卡片工具都是只读的, 都标了 card', () => {
    const cards = TOOLS.filter(t => t.card)
    assert.equal(cards.length, 7)
    for (const t of cards) assert.equal(annotationsOf(t).readOnlyHint, true, t.name)
  })
})
