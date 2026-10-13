// 集成测试 - 需求生成任务的默认带入(v2.1.13#560 责任人 + v2.6.1 前端默认挂里程碑)
// 前端弹窗现在默认把「需求责任人」和「最新未完成里程碑」预填好, 依赖后端两件事:
//   ① 不传 assignee 时任务落到需求责任人(ownerId, 无档案懒建)
//   ② 传 milestoneId 时任务挂上该里程碑
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('需求生成任务: 责任人与里程碑默认带入', () => {
  let a, projectId, milestoneId, engineerId, ownerUserId
  const reqIds = []
  const taskIds = []

  before(async () => {
    a = api(await login('admin'))
    const customers = await a.get('/api/fde/customers?page=1&page_size=1')
    const p = await a.post('/api/fde/projects', { name: uniqName('生成任务默认值项目'), customerId: customers.data.list[0].id })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    const m = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: uniqName('当前里程碑') })
    assert.equal(m.code, 0, m.message)
    milestoneId = m.data.id
    // 取一个已建档工程师当需求责任人(engineerId/userId 双轨: 断言任务落到他的档案 id)
    const engineers = await a.get('/api/fde/engineers?page=1&page_size=50')
    const hit = engineers.data.list.find(e => e.id != null && e.userId != null)
    assert.ok(hit, '库里至少要有一个建了档案的工程师')
    engineerId = hit.id
    ownerUserId = hit.userId
  })

  after(async () => {
    if (reqIds.length) await prisma.projectRequirement.deleteMany({ where: { id: { in: reqIds } } })
    if (taskIds.length) await prisma.task.deleteMany({ where: { id: { in: taskIds } } })
    if (projectId) await a.del(`/api/fde/projects/${projectId}`).catch(() => {})
  })

  async function newConfirmedReq(title, ownerId) {
    const row = await prisma.projectRequirement.create({
      data: { projectId: BigInt(projectId), title: uniqName(title), status: 'CONFIRMED', ownerId: ownerId ? BigInt(ownerId) : null }
    })
    reqIds.push(row.id)
    return row.id.toString()
  }

  test('不传负责人时任务落到需求的责任人, 并挂上传入的里程碑', async () => {
    const id = await newConfirmedReq('带责任人的需求', ownerUserId)
    const r = await a.post(`/api/fde/project-records/${projectId}/requirements/${id}/to-task`, { milestoneId })
    assert.equal(r.code, 0, r.message)
    taskIds.push(BigInt(r.data.task.id))
    assert.equal(String(r.data.task.assigneeId), String(engineerId), '任务负责人应等于需求责任人的工程师档案')
    assert.equal(String(r.data.task.milestoneId), String(milestoneId))
  })

  test('显式传 assigneeId 时以传入的为准, 不被责任人覆盖', async () => {
    const other = await a.get('/api/fde/engineers?page=1&page_size=50')
    const another = other.data.list.find(e => e.id != null && String(e.id) !== String(engineerId))
    if (!another) return   // 库里只有一个工程师档案时跳过
    const id = await newConfirmedReq('显式指派的需求', ownerUserId)
    const r = await a.post(`/api/fde/project-records/${projectId}/requirements/${id}/to-task`, { assigneeId: another.id })
    assert.equal(r.code, 0, r.message)
    taskIds.push(BigInt(r.data.task.id))
    assert.equal(String(r.data.task.assigneeId), String(another.id))
  })

  test('不传里程碑时任务不挂里程碑(前端可清空)', async () => {
    const id = await newConfirmedReq('不挂里程碑的需求', ownerUserId)
    const r = await a.post(`/api/fde/project-records/${projectId}/requirements/${id}/to-task`, {})
    assert.equal(r.code, 0, r.message)
    taskIds.push(BigInt(r.data.task.id))
    assert.equal(r.data.task.milestoneId, null)
  })
})
