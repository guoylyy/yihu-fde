// 集成测试 - 任务状态流转 CAS 互斥 + 抢单落负责人 (0.5.4)
// POST /api/fde/tasks/:id/status: 先读后条件更新; 状态竞争 409/code 9010; 权限失败仍 403; 重复提交幂等
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, createTestUser } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('API: 任务状态 CAS 互斥 / 抢单', () => {
  let admin, A, B, C, customerId, projectId
  const taskIds = []
  const engId = async (u) => (await prisma.engineer.findUnique({ where: { userId: BigInt(u.id) } })).id

  async function newTask({ assignee = null, status = 'QUEUED' } = {}) {
    const t = await admin.post('/api/fde/tasks', { projectId, title: uniqName('抢单任务') })
    assert.equal(t.code, 0, `建任务失败: ${t.message}`)
    taskIds.push(t.data.id)
    await prisma.task.update({
      where: { id: BigInt(t.data.id) },
      data: { status, assigneeId: assignee ? await engId(assignee) : null }
    })
    return t.data.id
  }
  const assigneeOf = async (id) => (await prisma.task.findUnique({ where: { id: BigInt(id) } })).assigneeId
  const setStatus = (u, id, status) => api(u.token).post(`/api/fde/tasks/${id}/status`, { status })

  before(async () => {
    admin = api(await login())
    A = await createTestUser('FDE_ENGINEER', { name: uniqName('甲') })
    B = await createTestUser('FDE_ENGINEER', { name: uniqName('乙') })
    C = await createTestUser('FDE_ENGINEER', { name: uniqName('丙') })   // 不是项目成员
    customerId = (await admin.post('/api/fde/customers', { name: uniqName('抢单客户') })).data.id
    projectId = (await admin.post('/api/fde/projects', { name: uniqName('抢单项目'), customerId })).data.id
    for (const u of [A, B]) {
      await prisma.projectMember.create({ data: { projectId: BigInt(projectId), userId: BigInt(u.id), engineerId: await engId(u) } })
    }
  })

  after(async () => {
    try {
      const ids = taskIds.map(BigInt)
      await prisma.activity.deleteMany({ where: { entity: 'task', entityId: { in: ids } } }).catch(() => {})
      await prisma.task.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
      await prisma.projectMember.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.project.delete({ where: { id: BigInt(projectId) } }).catch(() => {})
      await prisma.contact.deleteMany({ where: { customerId: BigInt(customerId) } }).catch(() => {})
      // 并行的其它套件(如 timesheets-filter-alias)会借用「最新客户」建项目, 被借用时不删, 免得外键报错刷屏
      const borrowed = await prisma.project.count({ where: { customerId: BigInt(customerId) } }).catch(() => 1)
      if (!borrowed) await prisma.customer.delete({ where: { id: BigInt(customerId) } }).catch(() => {})
      for (const u of [A, B, C]) await u?.cleanup()
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  })

  test('用例1: 已指派给 A 的 QUEUED 任务, A 开工 200; B 再置 IN_PROGRESS → 409/9010, 负责人不变', async () => {
    const id = await newTask({ assignee: A })
    const ra = await setStatus(A, id, 'IN_PROGRESS')
    assert.equal(ra.status, 200, ra.message)
    assert.equal(ra.data.status, 'IN_PROGRESS')
    const rb = await setStatus(B, id, 'IN_PROGRESS')
    assert.equal(rb.status, 409, rb.message)
    assert.equal(rb.code, 9010)
    assert.equal(rb.data.status, 'IN_PROGRESS')
    assert.equal(rb.data.assigneeName, A.name)
    assert.match(rb.message, new RegExp(`负责人 ${A.name}`))
    assert.equal(String(await assigneeOf(id)), String(await engId(A)))
  })

  test('用例2: 未指派的 QUEUED 任务, A 抢单 200 且落成负责人; B 再抢 → 409, 负责人仍是 A', async () => {
    const id = await newTask()
    const ra = await setStatus(A, id, 'IN_PROGRESS')
    assert.equal(ra.status, 200, ra.message)
    assert.equal(String(ra.data.assigneeId), String(await engId(A)))
    const rb = await setStatus(B, id, 'IN_PROGRESS')
    assert.equal(rb.status, 409, rb.message)
    assert.equal(rb.code, 9010)
    assert.equal(rb.data.assigneeName, A.name)
    assert.equal(String(await assigneeOf(id)), String(await engId(A)))
  })

  test('用例2b: 未指派任务 A/B 并发抢单, 只有一个 200, 另一个 409, 负责人是抢到的那个', async () => {
    const id = await newTask()
    const [ra, rb] = await Promise.all([setStatus(A, id, 'IN_PROGRESS'), setStatus(B, id, 'IN_PROGRESS')])
    const statuses = [ra.status, rb.status].sort()
    assert.deepEqual(statuses, [200, 409], `A=${ra.status} ${ra.message} / B=${rb.status} ${rb.message}`)
    const winner = ra.status === 200 ? A : B
    const loser = ra.status === 200 ? rb : ra
    assert.equal(loser.code, 9010)
    assert.equal(String(await assigneeOf(id)), String(await engId(winner)))
  })

  test('用例3: 回归 —— ADMIN 改状态 200; 非负责人改别人 QUEUED 任务仍 403; 非项目成员抢未指派任务 403', async () => {
    const id = await newTask({ assignee: A })
    const r1 = await admin.post(`/api/fde/tasks/${id}/status`, { status: 'IN_PROGRESS' })
    assert.equal(r1.status, 200, r1.message)
    const r2 = await admin.post(`/api/fde/tasks/${id}/status`, { status: 'DONE' })
    assert.equal(r2.status, 200, r2.message)

    const id2 = await newTask({ assignee: A })
    const rb = await setStatus(B, id2, 'IN_PROGRESS')
    assert.equal(rb.status, 403, rb.message)
    assert.equal(rb.code, 9003)

    const id3 = await newTask()
    const rc = await setStatus(C, id3, 'IN_PROGRESS')
    assert.equal(rc.status, 403, rc.message)
    assert.equal(await assigneeOf(id3), null)
    const rd = await setStatus(A, id3, 'DONE')   // 未指派任务不是抢单动作, 工程师仍无权改
    assert.equal(rd.status, 403, rd.message)

    const bad = await setStatus(A, id3, 'NOPE')
    assert.equal(bad.status, 400)
  })

  test('用例4: 幂等 —— 已是 IN_PROGRESS 时负责人再置 IN_PROGRESS 仍 200', async () => {
    const id = await newTask()
    const r1 = await setStatus(A, id, 'IN_PROGRESS')
    assert.equal(r1.status, 200, r1.message)
    const r2 = await setStatus(A, id, 'IN_PROGRESS')
    assert.equal(r2.status, 200, r2.message)
    assert.equal(r2.data.status, 'IN_PROGRESS')
    assert.equal(String(await assigneeOf(id)), String(await engId(A)))
  })
})
