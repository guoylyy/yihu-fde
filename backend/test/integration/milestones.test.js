// 集成测试 - 项目里程碑 CRUD (2026-07-03)
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { login, api } from './helpers.js'

describe('API: 项目里程碑 CRUD (2026-07-03)', () => {
  let token, a, testProjectId = 1
  const createdIds = []

  before(async () => {
    token = await login('admin')
    a = api(token)
  })

  test('POST 新增里程碑', async () => {
    const r = await a.post(`/api/fde/projects/${testProjectId}/milestones`, {
      name: '需求评审',
      description: '跟客户过一遍需求',
      plannedDate: '2026-07-20'
    })
    assert.equal(r.code, 0, r.message)
    assert.ok(r.data.id)
    assert.equal(r.data.name, '需求评审')
    assert.equal(r.data.status, 'PENDING')
    assert.ok(!r.data.actualDate, '新建时 actualDate 应为 null')
    createdIds.push(r.data.id)
  })

  test('POST 空 name 返回 1001', async () => {
    const r = await a.post(`/api/fde/projects/${testProjectId}/milestones`, { name: '' })
    assert.equal(r.code, 1001)
  })

  test('POST 非法 status 返回 1002', async () => {
    const r = await a.post(`/api/fde/projects/${testProjectId}/milestones`, { name: 'X', status: 'INVALID' })
    assert.equal(r.code, 1002)
  })

  test('POST 不存在的项目 → 2004', async () => {
    const r = await a.post('/api/fde/projects/9999/milestones', { name: 'X' })
    assert.equal(r.code, 2004)
  })

  test('PUT 改名字和描述', async () => {
    const id = createdIds[0]
    const r = await a.put(`/api/fde/projects/${testProjectId}/milestones/${id}`, {
      name: '需求评审 v2',
      description: '需求评审更新'
    })
    assert.equal(r.code, 0)
    assert.equal(r.data.name, '需求评审 v2')
  })

  test('PUT 改状态为 COMPLETED → 自动填 actualDate', async () => {
    const id = createdIds[0]
    const r = await a.put(`/api/fde/projects/${testProjectId}/milestones/${id}`, {
      status: 'COMPLETED'
    })
    assert.equal(r.code, 0)
    assert.equal(r.data.status, 'COMPLETED')
    assert.ok(r.data.actualDate, 'COMPLETED 应自动填 actualDate')
  })

  test('PUT 不存在的里程碑 → 2004', async () => {
    const r = await a.put(`/api/fde/projects/${testProjectId}/milestones/9999`, { name: 'X' })
    assert.equal(r.code, 2004)
  })

  test('GET 项目详情包含里程碑', async () => {
    const r = await a.get(`/api/fde/projects/${testProjectId}`)
    assert.equal(r.code, 0)
    assert.ok(Array.isArray(r.data.milestones))
    const ms = r.data.milestones.find(m => m.id === createdIds[0])
    assert.ok(ms, '新建的里程碑应在列表中')
  })

  test('DELETE 软删里程碑', async () => {
    const id = createdIds[0]
    const r = await a.del(`/api/fde/projects/${testProjectId}/milestones/${id}`)
    assert.equal(r.code, 0)
    // 再查项目详情, 应没有这个里程碑
    const detail = await a.get(`/api/fde/projects/${testProjectId}`)
    const ms = detail.data.milestones.find(m => m.id === id)
    assert.equal(ms, undefined, '软删后不应在 list 中')
  })

  test('DELETE 不存在的里程碑 → 2004', async () => {
    const r = await a.del(`/api/fde/projects/${testProjectId}/milestones/9999`)
    assert.equal(r.code, 2004)
  })
})