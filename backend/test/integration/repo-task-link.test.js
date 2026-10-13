// 集成测试 - 任务↔提交自动关联 (v1.9.1, 平台任务 #328)
// 直接调 services/repoSync.js 的 linkCommitsToTasks(不依赖真实 Gitee),
// 验证: #taskId 命中生成任务评论 / 幂等不重复 / 跨项目引用不误挂 / 无引用零操作
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'
import { linkCommitsToTasks } from '../../src/services/repoSync.js'

describe('services/repoSync linkCommitsToTasks', () => {
  let a, customerId, projectId, otherProjectId, taskId, otherTaskId

  before(async () => {
    a = api(await login())
    const c = await a.post('/api/fde/customers', { name: uniqName('关联客户') })
    customerId = c.data.id
    const p1 = await a.post('/api/fde/projects', { name: uniqName('关联项目'), customerId })
    projectId = BigInt(p1.data.id)
    const p2 = await a.post('/api/fde/projects', { name: uniqName('别的项目'), customerId })
    otherProjectId = BigInt(p2.data.id)
    const t1 = await a.post('/api/fde/tasks', { projectId: String(projectId), title: uniqName('关联任务') })
    assert.equal(t1.code, 0, `建任务失败: ${t1.message}`)
    taskId = BigInt(t1.data.id)
    const t2 = await a.post('/api/fde/tasks', { projectId: String(otherProjectId), title: uniqName('别项目任务') })
    otherTaskId = BigInt(t2.data.id)
  })

  after(async () => {
    try {
      await prisma.comment.deleteMany({ where: { entity: 'task', entityId: { in: [taskId, otherTaskId] } } }).catch(() => {})
      await prisma.task.deleteMany({ where: { id: { in: [taskId, otherTaskId] } } }).catch(() => {})
      await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } }).catch(() => {})
      if (customerId) {
        await prisma.contact.deleteMany({ where: { customerId: BigInt(customerId) } }).catch(() => {})
        await prisma.customer.delete({ where: { id: BigInt(customerId) } }).catch(() => {})
      }
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  })

  const commentsOf = (id) => prisma.comment.findMany({ where: { entity: 'task', entityId: id, deletedAt: null } })

  test('提交信息带 #taskId → 生成任务关联评论', async () => {
    const n = await linkCommitsToTasks(projectId, [
      { sha: 'abc123def4567890', title: `fix: 登录空指针 #${taskId}`, author: '测试人', url: 'https://gitee.com/x/y/commit/abc123' }
    ])
    assert.equal(n, 1)
    const comments = await commentsOf(taskId)
    assert.equal(comments.length, 1)
    assert.match(comments[0].content, /自动关联提交 abc123de/)
    assert.match(comments[0].content, /登录空指针/)
  })

  test('同一提交再次同步 → 幂等不重复', async () => {
    const n = await linkCommitsToTasks(projectId, [
      { sha: 'abc123def4567890', title: `fix: 登录空指针 #${taskId}`, author: '测试人' }
    ])
    assert.equal(n, 0)
    assert.equal((await commentsOf(taskId)).length, 1)
  })

  test('引用别的项目的任务 id → 不误挂', async () => {
    const n = await linkCommitsToTasks(projectId, [
      { sha: 'ffff0000ffff0000', title: `chore: 顺手改 #${otherTaskId}` }
    ])
    assert.equal(n, 0)
    assert.equal((await commentsOf(otherTaskId)).length, 0)
  })

  test('无 #引用 / 引用不存在的任务 → 零操作', async () => {
    const n = await linkCommitsToTasks(projectId, [
      { sha: '1111222233334444', title: 'docs: 更新 README' },
      { sha: '5555666677778888', title: '修复 #999999999 编号不存在' }
    ])
    assert.equal(n, 0)
  })

  test('一条提交引用多个本项目任务 → 各挂一条', async () => {
    const t3 = await a.post('/api/fde/tasks', { projectId: String(projectId), title: uniqName('第二任务') })
    const task3 = BigInt(t3.data.id)
    try {
      const n = await linkCommitsToTasks(projectId, [
        { sha: '9999aaaabbbbcccc', title: `feat: 联动 #${taskId} #${task3}` }
      ])
      assert.equal(n, 2)
      assert.equal((await commentsOf(taskId)).length, 2)
      assert.equal((await commentsOf(task3)).length, 1)
    } finally {
      await prisma.comment.deleteMany({ where: { entity: 'task', entityId: task3 } }).catch(() => {})
      await prisma.task.delete({ where: { id: task3 } }).catch(() => {})
    }
  })
})
