// 集成测试 - 任务跨项目移动 (v1.9.2, 平台任务 #329)
// PUT /api/fde/tasks/:id 支持 projectId: 校验目标项目/里程碑脱离/评论子任务随任务走
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('API: 任务跨项目移动', () => {
  let a, customerId, p1, p2, milestoneId, taskId

  before(async () => {
    a = api(await login())
    const c = await a.post('/api/fde/customers', { name: uniqName('移动客户') })
    customerId = c.data.id
    p1 = (await a.post('/api/fde/projects', { name: uniqName('源项目'), customerId })).data.id
    p2 = (await a.post('/api/fde/projects', { name: uniqName('目标项目'), customerId })).data.id
    const ms = await a.post(`/api/fde/projects/${p1}/milestones`, { name: uniqName('源里程碑') })
    milestoneId = ms.data?.id
    const t = await a.post('/api/fde/tasks', {
      projectId: p1, title: uniqName('待移动任务'), ...(milestoneId ? { milestoneId } : {})
    })
    assert.equal(t.code, 0, `建任务失败: ${t.message}`)
    taskId = t.data.id
    const cm = await a.post('/api/fde/comments', { entity: 'task', entityId: taskId, content: '移动前的评论' })
    assert.equal(cm.code, 0, `建评论失败: ${cm.message}`)
  })

  after(async () => {
    try {
      await prisma.comment.deleteMany({ where: { entity: 'task', entityId: BigInt(taskId) } }).catch(() => {})
      await prisma.task.delete({ where: { id: BigInt(taskId) } }).catch(() => {})
      if (milestoneId) await prisma.milestone.delete({ where: { id: BigInt(milestoneId) } }).catch(() => {})
      await prisma.project.deleteMany({ where: { id: { in: [BigInt(p1), BigInt(p2)] } } }).catch(() => {})
      await prisma.contact.deleteMany({ where: { customerId: BigInt(customerId) } }).catch(() => {})
      await prisma.customer.delete({ where: { id: BigInt(customerId) } }).catch(() => {})
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  })

  test('移动到不存在的项目 → 400', async () => {
    const r = await a.put(`/api/fde/tasks/${taskId}`, { projectId: '999999999' })
    assert.equal(r.status, 400)
  })

  test('跨项目移动: projectId 生效, 里程碑自动脱离, 评论保留', async () => {
    const r = await a.put(`/api/fde/tasks/${taskId}`, { projectId: p2 })
    assert.equal(r.code, 0, r.message)
    const t = await prisma.task.findUnique({ where: { id: BigInt(taskId) } })
    assert.equal(String(t.projectId), String(p2))
    assert.equal(t.milestoneId, null, '跨项目移动后旧里程碑应脱离')
    const comments = await prisma.comment.count({ where: { entity: 'task', entityId: BigInt(taskId), deletedAt: null } })
    assert.equal(comments, 1, '评论应随任务保留')
  })

  test('移动时指定不属于目标项目的里程碑 → 400', async () => {
    if (!milestoneId) return
    const r = await a.put(`/api/fde/tasks/${taskId}`, { projectId: p1, milestoneId })
    // milestoneId 属 p1, 移回 p1 时合法 → 应成功; 再从 p1 移到 p2 带 p1 的里程碑 → 400
    assert.equal(r.code, 0, r.message)
    const bad = await a.put(`/api/fde/tasks/${taskId}`, { projectId: p2, milestoneId })
    assert.equal(bad.status, 400)
    assert.match(bad.message, /里程碑不属于目标项目/)
  })
})
