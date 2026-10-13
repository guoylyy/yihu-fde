// 集成测试 - v2.8.0(#1143) 任务依赖边 + 里程碑路径图聚合接口
// 自建专属客户/项目, 用完自清(不取列表第一条, 见 local-dev-setup 约定)
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('API: 任务依赖 / 路径图 (v2.8.0 #1143)', () => {
  let a, customerId, projectId, milestoneId, t1, t2, t3, t4, edge12
  const ids = () => [t1, t2, t3, t4].filter(Boolean).map(BigInt)

  before(async () => {
    a = api(await login())
    const c = await a.post('/api/fde/customers', { name: uniqName('路径图客户') })
    customerId = c.data.id
    const p = await a.post('/api/fde/projects', { name: uniqName('路径图项目'), customerId })
    projectId = p.data.id
    const m = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: '联调', goal: '接口全部打通' })
    assert.equal(m.code, 0, m.message)
    assert.equal(m.data.goal, '接口全部打通', '里程碑 goal 落库')
    milestoneId = m.data.id
    const mk = async (title, extra = {}) => {
      const r = await a.post('/api/fde/tasks', { projectId, milestoneId, title: uniqName(title), ...extra })
      assert.equal(r.code, 0, r.message)
      return r.data
    }
    t1 = (await mk('需求确认', { status: 'DONE' })).id
    t2 = (await mk('接口设计', { priority: 'HIGH' })).id
    t3 = (await mk('前端页面')).id
    // 建任务顺手挂前置
    const r4 = await mk('联调测试', { dependsOn: [t2, t3] })
    t4 = r4.id
    assert.deepEqual(r4.dependencyErrors, [], 'dependsOn 全部建成')
  })

  after(async () => {
    try {
      await prisma.taskDependency.deleteMany({ where: { OR: [{ predecessorId: { in: ids() } }, { successorId: { in: ids() } }] } }).catch(() => {})
      await prisma.comment.deleteMany({ where: { entity: 'task', entityId: { in: ids() } } }).catch(() => {})
      await prisma.task.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.milestone.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.project.deleteMany({ where: { id: BigInt(projectId) } }).catch(() => {})
      if (customerId) {
        await prisma.contact.deleteMany({ where: { customerId: BigInt(customerId) } }).catch(() => {})
        await prisma.customer.delete({ where: { id: BigInt(customerId) } }).catch(() => {})
      }
    } finally { await prisma.$disconnect().catch(() => {}) }
  })

  test('POST 建边 1→2 成功; 重复 → 409/9005', async () => {
    const r = await a.post('/api/fde/task-dependencies', { predecessorId: t1, successorId: t2, note: '等需求冻结' })
    assert.equal(r.code, 0, r.message)
    edge12 = r.data.id
    const dup = await a.post('/api/fde/task-dependencies', { predecessorId: t1, successorId: t2 })
    assert.equal(dup.status, 409)
    assert.equal(dup.code, 9005)
  })

  test('POST 成环 → 400/9006 且给出环路; 自指/跨项目也拒', async () => {
    // 已有 2→4, 4→? 无; 加 4→2 成环
    const r = await a.post('/api/fde/task-dependencies', { predecessorId: t4, successorId: t2 })
    assert.equal(r.status, 400)
    assert.equal(r.code, 9006)
    assert.ok(Array.isArray(r.raw.cyclePath) && r.raw.cyclePath.includes(String(t4)) && r.raw.cyclePath.includes(String(t2)), JSON.stringify(r.raw))
    const self = await a.post('/api/fde/task-dependencies', { predecessorId: t1, successorId: t1 })
    assert.equal(self.code, 9002)
  })

  test('FEEDBACK 回环边可以逆向建(不参与环检测)', async () => {
    const r = await a.post('/api/fde/task-dependencies', { predecessorId: t4, successorId: t2, type: 'FEEDBACK', note: '测试打回' })
    assert.equal(r.code, 0, r.message)
    // 改成 BLOCKS 会成环 → 拒
    const up = await a.put(`/api/fde/task-dependencies/${r.data.id}`, { type: 'BLOCKS' })
    assert.equal(up.code, 9006)
  })

  test('GET 任务详情带上下游与 blocked', async () => {
    const d = await a.get(`/api/fde/tasks/${t4}`)
    assert.equal(d.code, 0)
    assert.equal(d.data.predecessors.length, 2)
    assert.equal(d.data.blocked, true, 't2/t3 未完成 → t4 阻塞')
    assert.deepEqual(d.data.blockedBy.sort(), [String(t2), String(t3)].sort())
    const d2 = await a.get(`/api/fde/tasks/${t2}`)
    assert.equal(d2.data.blocked, false, 't1 已完成 → t2 不阻塞')
    assert.equal(d2.data.successors.length, 1)
    const n = await a.get(`/api/fde/task-dependencies?taskId=${t2}`)
    assert.equal(n.data.predecessors[0].task.id, String(t1))
  })

  test('GET 路径图: ready/blocked/topo/mermaid/里程碑 stats', async () => {
    const r = await a.get(`/api/fde/projects/${projectId}/roadmap?milestoneId=${milestoneId}`)
    assert.equal(r.code, 0, r.message)
    const g = r.data
    assert.equal(g.milestone.goal, '接口全部打通')
    assert.equal(g.nodes.length, 4)
    assert.deepEqual(g.ready.sort(), [String(t2), String(t3)].sort())
    assert.deepEqual(g.blocked, [String(t4)])
    assert.ok(g.topoOrder.indexOf(String(t1)) < g.topoOrder.indexOf(String(t2)))
    assert.ok(g.topoOrder.indexOf(String(t2)) < g.topoOrder.indexOf(String(t4)))
    assert.equal(g.edges.filter(e => e.type === 'FEEDBACK').length, 1)
    assert.match(g.mermaid, /flowchart LR/)
    assert.equal(g.criticalPath.taskIds.at(-1), String(t4))
    const ms = g.milestones.find(m => m.id === String(milestoneId))
    assert.deepEqual(ms.stats, { total: 4, done: 1, inProgress: 0, ready: 2, blocked: 1 })
    // 整项目视图同样能拿到
    const whole = await a.get(`/api/fde/projects/${projectId}/roadmap`)
    assert.equal(whole.data.nodes.length, 4)
    assert.equal(whole.data.milestone, null)
    // 不存在的里程碑 → 404
    const nf = await a.get(`/api/fde/projects/${projectId}/roadmap?milestoneId=999999999`)
    assert.equal(nf.status, 404)
  })

  test('前置完成后后继解除阻塞', async () => {
    await a.post(`/api/fde/tasks/${t2}/status`, { status: 'DONE' })
    await a.post(`/api/fde/tasks/${t3}/status`, { status: 'DONE' })
    const r = await a.get(`/api/fde/projects/${projectId}/roadmap?milestoneId=${milestoneId}`)
    assert.deepEqual(r.data.ready, [String(t4)])
    assert.deepEqual(r.data.blocked, [])
  })

  test('DELETE 按 id 与按对删边; 删任务连带清边', async () => {
    const r = await a.del(`/api/fde/task-dependencies/${edge12}`)
    assert.equal(r.code, 0)
    const pair = await a.del(`/api/fde/task-dependencies/pair?predecessorId=${t2}&successorId=${t4}`)
    assert.equal(pair.code, 0)
    assert.equal(pair.data.removed, 1)
    const again = await a.del(`/api/fde/task-dependencies/pair?predecessorId=${t2}&successorId=${t4}`)
    assert.equal(again.status, 404)
    // t3→t4 与 t4-.->t2 还在; 删 t4 后应全部失效
    const del = await a.del(`/api/fde/tasks/${t4}`)
    assert.equal(del.code, 0)
    const left = await prisma.taskDependency.count({ where: { deletedAt: null, OR: [{ predecessorId: BigInt(t4) }, { successorId: BigInt(t4) }] } })
    assert.equal(left, 0)
  })
})
