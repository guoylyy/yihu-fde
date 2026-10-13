// 集成测试 - v1.6.3 列表过滤参数别名(第三方反馈修复)
// 反馈原文: "list_timesheets 的 projectId/engineerId/offset 等过滤参数实际不生效,
//           只能 page/pageSize 翻页拉全量后本地过滤"
// 根因: 后端只认 snake_case, 驼峰传参被静默忽略(不报错) —— 最阴的失败模式, 用测试钉死两种命名等价。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('v1.6.3 工时列表过滤参数别名', () => {
  let a, projectId, engineerId
  const created = []

  before(async () => {
    a = api(await login('admin'))
    const customers = await a.get('/api/fde/customers?page=1&page_size=1')
    const p = await a.post('/api/fde/projects', { name: uniqName('过滤别名项目'), customerId: customers.data.list[0].id })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    // 取一个有工程师档案的人(engineerId/userId 双轨: 列表里可能混着无档案用户 id=null)
    const engineers = await a.get('/api/fde/engineers?page=1&page_size=50')
    engineerId = engineers.data.list.find(e => e.id != null)?.id
    assert.ok(engineerId, '库里至少要有一个建了档案的工程师')
    for (const d of ['2026-08-11', '2026-08-12', '2026-08-13']) {
      const t = await a.post('/api/fde/timesheets', {
        projectId, engineerId, workDate: d, hours: 8, workContent: uniqName('联调')
      })
      assert.equal(t.code, 0, t.message)
      created.push(t.data.id)
    }
  })

  after(async () => {
    if (created.length) await prisma.timesheet.deleteMany({ where: { id: { in: created.map(BigInt) } } })
    if (projectId) await a.del(`/api/fde/projects/${projectId}`).catch(() => {})
  })

  test('驼峰 projectId 过滤生效(与 snake 结果一致)', async () => {
    const camel = await a.get(`/api/fde/timesheets?projectId=${projectId}`)
    const snake = await a.get(`/api/fde/timesheets?project_id=${projectId}`)
    assert.equal(camel.code, 0)
    assert.equal(camel.data.total, 3, '驼峰过滤应命中本项目 3 条')
    assert.equal(camel.data.total, snake.data.total, '两种命名结果应一致')
    assert.ok(camel.data.list.every(t => String(t.projectId) === String(projectId)))
  })

  test('驼峰 engineerId 过滤生效', async () => {
    const r = await a.get(`/api/fde/timesheets?projectId=${projectId}&engineerId=${engineerId}`)
    assert.equal(r.data.total, 3)
    const none = await a.get(`/api/fde/timesheets?projectId=${projectId}&engineerId=99999999`)
    assert.equal(none.data.total, 0, '不存在的工程师应过滤出 0 条')
  })

  test('offset 生效且优先于 page', async () => {
    const all = await a.get(`/api/fde/timesheets?projectId=${projectId}&page_size=2`)
    assert.equal(all.data.list.length, 2)
    const off = await a.get(`/api/fde/timesheets?projectId=${projectId}&page_size=2&offset=2&page=1`)
    assert.equal(off.data.list.length, 1, 'offset=2 应只剩最后 1 条(page 参数被忽略)')
    assert.equal(off.data.total, 3, 'total 不受 offset 影响')
  })

  test('pageSize 驼峰别名生效', async () => {
    const r = await a.get(`/api/fde/timesheets?projectId=${projectId}&pageSize=1`)
    assert.equal(r.data.list.length, 1)
    assert.equal(r.data.page_size, 1)
  })

  test('知识库列表的 projectId 别名同样生效(不 400 不静默)', async () => {
    const k = await a.get(`/api/fde/knowledge?projectId=${projectId}`)
    assert.equal(k.code, 0)
    assert.equal(k.data.total, 0)
  })
})
