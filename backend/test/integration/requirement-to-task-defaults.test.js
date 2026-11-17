// 集成测试 - 需求生成任务的默认带入(v2.1.13#560 责任人 + v2.6.1 前端默认挂里程碑)
// 前端弹窗现在默认把「需求责任人」和「最新未完成里程碑」预填好, 依赖后端两件事:
//   ① 不传 assignee 时任务落到需求责任人(ownerId, 无档案懒建)
//   ② 传 milestoneId 时任务挂上该里程碑
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, createTestUser } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('需求生成任务: 责任人与里程碑默认带入', () => {
  // 全部自建, 不碰库里/别的套件的数据: 以前从 /engineers 列表"挑一个有档案的",
  // 而列表按用户创建时间倒序, 挑中的总是别的套件 createTestUser 现造的 unit-test 账号;
  // 对方收尾一硬删(档案+账号), 这边 to-task 反查不到档案、账号也没了 → assigneeId=null, 约一半概率挂。
  let a, customerId, projectId, milestoneId, engineerId, ownerUserId, anotherEngineerId
  const users = []
  const reqIds = []
  const taskIds = []

  async function newEngineer() {
    const u = await createTestUser('FDE_ENGINEER')
    users.push(u)
    const eng = await prisma.engineer.findUnique({ where: { userId: BigInt(u.id) }, select: { id: true } })
    assert.ok(eng, 'createTestUser(FDE_ENGINEER) 应建好工程师档案')
    return { userId: u.id, engineerId: eng.id.toString() }
  }

  before(async () => {
    a = api(await login('admin'))
    const c = await a.post('/api/fde/customers', { name: uniqName('生成任务默认值客户'), industry: 'X' })
    assert.equal(c.code, 0, c.message)
    customerId = c.data.id
    const p = await a.post('/api/fde/projects', { name: uniqName('生成任务默认值项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    const m = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: uniqName('当前里程碑') })
    assert.equal(m.code, 0, m.message)
    milestoneId = m.data.id
    // 需求责任人: 本套件自己建的工程师(engineerId/userId 双轨: 断言任务落到他的档案 id)
    ;({ userId: ownerUserId, engineerId } = await newEngineer())
    // 显式指派用的另一个工程师, 同样自建
    ;({ engineerId: anotherEngineerId } = await newEngineer())
  })

  after(async () => {
    // 顺序: 需求(引用 task) → 任务(引用工程师档案) → 项目 → 客户 → 账号/档案
    if (reqIds.length) await prisma.projectRequirement.deleteMany({ where: { id: { in: reqIds } } })
    if (taskIds.length) await prisma.task.deleteMany({ where: { id: { in: taskIds } } })
    if (projectId) await a.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await a.del(`/api/fde/customers/${customerId}`).catch(() => {})
    for (const u of users) await u.cleanup()
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
    const id = await newConfirmedReq('显式指派的需求', ownerUserId)
    const r = await a.post(`/api/fde/project-records/${projectId}/requirements/${id}/to-task`, { assigneeId: anotherEngineerId })
    assert.equal(r.code, 0, r.message)
    taskIds.push(BigInt(r.data.task.id))
    assert.equal(String(r.data.task.assigneeId), String(anotherEngineerId))
  })

  test('不传里程碑时任务不挂里程碑(前端可清空)', async () => {
    const id = await newConfirmedReq('不挂里程碑的需求', ownerUserId)
    const r = await a.post(`/api/fde/project-records/${projectId}/requirements/${id}/to-task`, {})
    assert.equal(r.code, 0, r.message)
    taskIds.push(BigInt(r.data.task.id))
    assert.equal(r.data.task.milestoneId, null)
  })
})
