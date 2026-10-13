// 集成测试 - v2.6.1 需求清单「落地情况」筛选
// 背景: 已生成任务/里程碑的需求混在「已确认」里, 再次批量生成任务时容易误操作,
//       故 GET /requirements 支持 landed=0(未生成任务与里程碑) / landed=1(任一已生成)。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('v2.6.1 需求清单落地筛选', () => {
  let a, projectId, reqIds = []

  before(async () => {
    a = api(await login('admin'))
    const customers = await a.get('/api/fde/customers?page=1&page_size=1')
    const p = await a.post('/api/fde/projects', { name: uniqName('落地筛选项目'), customerId: customers.data.list[0].id })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    // 直接落库造三种形态: 未生成 / 已生成任务 / 已生成里程碑(生成动作本身另有测试覆盖)
    const t = await a.post('/api/fde/tasks', { projectId, title: uniqName('落地任务') })
    assert.equal(t.code, 0, t.message)
    const m = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: uniqName('落地里程碑') })
    assert.equal(m.code, 0, m.message)
    for (const [title, extra] of [
      ['未落地需求', {}],
      ['已生成任务需求', { taskId: BigInt(t.data.id) }],
      ['已生成里程碑需求', { milestoneId: BigInt(m.data.id) }]
    ]) {
      const row = await prisma.projectRequirement.create({
        data: { projectId: BigInt(projectId), title: uniqName(title), status: 'CONFIRMED', ...extra }
      })
      reqIds.push(row.id)
    }
  })

  after(async () => {
    if (reqIds.length) await prisma.projectRequirement.deleteMany({ where: { id: { in: reqIds } } })
    if (projectId) await a.del(`/api/fde/projects/${projectId}`).catch(() => {})
  })

  test('不传 landed 时返回全部需求', async () => {
    const r = await a.get(`/api/fde/project-records/${projectId}/requirements`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.list.length, 3)
  })

  test('landed=0 只返回未生成任务与里程碑的需求', async () => {
    const r = await a.get(`/api/fde/project-records/${projectId}/requirements?landed=0`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.list.length, 1)
    assert.equal(r.data.list[0].taskId, null)
    assert.equal(r.data.list[0].milestoneId, null)
  })

  test('landed=1 返回已生成任务或里程碑的需求', async () => {
    const r = await a.get(`/api/fde/project-records/${projectId}/requirements?landed=1`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.list.length, 2)
    assert.ok(r.data.list.every(q => q.taskId || q.milestoneId), '不该混进未落地的需求')
  })

  test('落地筛选与状态筛选叠加生效', async () => {
    const r = await a.get(`/api/fde/project-records/${projectId}/requirements?status=CONFIRMED&landed=1`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.list.length, 2)
    const none = await a.get(`/api/fde/project-records/${projectId}/requirements?status=DRAFT&landed=1`)
    assert.equal(none.data.list.length, 0)
  })
})
