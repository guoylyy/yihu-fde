// 集成测试 - v2.8.0(#1145) AI 拆解草案落库 apply(不依赖大模型, 草案手写)
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

const ac = (t) => [{ acNo: 'AC-1', text: t, level: 'L1_API' }]

describe('API: POST /api/fde/decomposition/apply (v2.8.0 #1145)', () => {
  let a, customerId, projectId, milestoneId, seedTaskId

  before(async () => {
    a = api(await login())
    const c = await a.post('/api/fde/customers', { name: uniqName('AI草案客户') })
    customerId = c.data.id
    const p = await a.post('/api/fde/projects', { name: uniqName('AI草案项目'), customerId })
    projectId = p.data.id
    const m = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: '联调' })
    milestoneId = m.data.id
    const t = await a.post('/api/fde/tasks', { projectId, milestoneId, title: '需求冻结', status: 'DONE' })
    seedTaskId = t.data.id
  })

  after(async () => {
    try {
      const tasks = await prisma.task.findMany({ where: { projectId: BigInt(projectId) }, select: { id: true } })
      const ids = tasks.map(t => t.id)
      await prisma.taskDependency.deleteMany({ where: { OR: [{ predecessorId: { in: ids } }, { successorId: { in: ids } }] } }).catch(() => {})
      await prisma.projectRecord.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.task.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.milestone.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.project.deleteMany({ where: { id: BigInt(projectId) } }).catch(() => {})
      if (customerId) {
        await prisma.contact.deleteMany({ where: { customerId: BigInt(customerId) } }).catch(() => {})
        await prisma.customer.delete({ where: { id: BigInt(customerId) } }).catch(() => {})
      }
    } finally { await prisma.$disconnect().catch(() => {}) }
  })

  test('有环草案整单拒绝, 不落任何数据', async () => {
    const before = await prisma.task.count({ where: { projectId: BigInt(projectId) } })
    const r = await a.post('/api/fde/decomposition/apply', {
      projectId, milestoneId,
      draft: { summary: '环', milestones: [{ name: '联调', tasks: [
        { title: 'A', role: 'DEV', acceptanceCriteria: ac('a'), dependencies: ['B'] },
        { title: 'B', role: 'DEV', acceptanceCriteria: ac('b'), dependencies: ['A'] }
      ] }] }
    })
    assert.equal(r.status, 400)
    assert.match(r.message, /循环/)
    assert.equal(await prisma.task.count({ where: { projectId: BigInt(projectId) } }), before)
  })

  test('挂到指定里程碑: 建任务(source=AI)+依赖, 可依赖项目已有任务, 写项目记录', async () => {
    const r = await a.post('/api/fde/decomposition/apply', {
      projectId, milestoneId,
      draft: {
        summary: '对话服务上线', openQuestions: ['是否要灰度'],
        milestones: [{ name: '随便什么名字都挂到目标里程碑', tasks: [
          { title: '接口设计', role: 'ARCHITECT', priority: 'HIGH', estimateDays: 2, acceptanceCriteria: ac('接口文档评审通过'), dependencies: ['需求冻结'] },
          { title: '后端实现', role: 'DEV', description: '按接口文档实现', acceptanceCriteria: [{ acNo: 'AC-1', text: '接口 200', level: 'L1_API' }, { acNo: 'AC-2', text: '页面可用', level: 'L2_UI' }], dependencies: ['接口设计'] },
          { title: '联调测试', role: 'QA', acceptanceCriteria: ac('用例全过'), dependencies: ['后端实现'] }
        ] }]
      }
    })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.tasks.length, 3)
    assert.equal(r.data.edgeCount, 3, '含依赖已有任务「需求冻结」的那条')
    assert.deepEqual(r.data.milestones, [], '指定了目标里程碑就不新建')
    assert.equal(r.data.targetMilestoneId, String(milestoneId))
    const t = await prisma.task.findUnique({ where: { id: BigInt(r.data.tasks[1].id) } })
    assert.equal(t.source, 'AI')
    // v2.8.5(#1161) 验收下线: 不再按 AC 推导 reviewLevel
    assert.match(t.description, /按接口文档实现/)
    assert.equal(String(t.milestoneId), String(milestoneId))
    // 路径图里: 接口设计 ready(前置需求冻结已完成), 后端实现/联调 blocked
    const g = await a.get(`/api/fde/projects/${projectId}/roadmap?milestoneId=${milestoneId}`)
    assert.deepEqual(g.data.ready, [r.data.tasks[0].id])
    assert.equal(g.data.blocked.length, 2)
    const rec = await prisma.projectRecord.findFirst({ where: { projectId: BigInt(projectId) }, orderBy: { id: 'desc' } })
    assert.match(rec.title, /AI 路径图草案已应用/)
    assert.match(rec.content, /是否要灰度/)
  })

  test('不传里程碑: 按名匹配已有里程碑, 没有就新建(带 goal)', async () => {
    const r = await a.post('/api/fde/decomposition/apply', {
      projectId,
      draft: { summary: '两个里程碑', milestones: [
        { name: ' 联调 ', tasks: [{ title: '压测', role: 'QA', acceptanceCriteria: ac('TPS 达标'), dependencies: [] }] },
        { name: '上线', goal: '生产可用', tasks: [{ title: '灰度发布', role: 'FDE', acceptanceCriteria: ac('灰度 10% 无告警'), dependencies: ['压测'] }] }
      ] }
    })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.milestones.length, 1)
    assert.equal(r.data.milestones[0].name, '上线')
    const ms = await prisma.milestone.findUnique({ where: { id: BigInt(r.data.milestones[0].id) } })
    assert.equal(ms.goal, '生产可用')
    const t = await prisma.task.findUnique({ where: { id: BigInt(r.data.tasks[0].id) } })
    assert.equal(String(t.milestoneId), String(milestoneId), '「 联调 」按名匹配到已有里程碑')
  })

  test('无权限的项目 → 404; 缺 draft → 400', async () => {
    const r = await a.post('/api/fde/decomposition/apply', { projectId })
    assert.equal(r.status, 400)
    const nf = await a.post('/api/fde/decomposition/apply', { projectId: 999999999, draft: { summary: 'x', milestones: [{ name: 'm', tasks: [{ title: 't', role: 'DEV', acceptanceCriteria: ac('x') }] }] } })
    assert.equal(nf.status, 404)
  })
})
