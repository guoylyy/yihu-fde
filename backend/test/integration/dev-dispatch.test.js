// 集成测试 - v2.9.0(#1162) 看板派工: 启动派工单 → 机器人领活(前置约束/原子) → 进度 → 完成/失败 → 派工单收口 → roadmap 带 runs
// 自建客户/项目/机器人档案, 用完自清; 机器人由管理员 agentProfileId 代领(演练通道)
// claim 一律带 projectId: 共享库里可能有别的项目的派工单在跑(本地演示数据), 不带会领到别人的活
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'
import { releaseStaleRuns } from '../../src/services/devDispatch.js'

describe('API: 看板派工 (v2.9.0 #1162)', () => {
  let a, customerId, projectId, milestoneId, robotId, robot2Id, adminUserId, tA, tB, tC, dispatchId, runA, runB, runC

  before(async () => {
    const token = await login(); a = api(token)
    const me = await a.get('/api/fde/me'); adminUserId = me.data.profile.id
    const c = await a.post('/api/fde/customers', { name: uniqName('派工客户') }); customerId = c.data.id
    const p = await a.post('/api/fde/projects', { name: uniqName('派工项目'), customerId }); projectId = p.data.id
    const m = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: '机器人试跑', goal: '三个任务全部由机器人完成' }); milestoneId = m.data.id
    const mk = async (title, extra = {}) => (await a.post('/api/fde/tasks', { projectId, milestoneId, title: uniqName(title), ...extra })).data.id
    tA = await mk('A 接口')
    tB = await mk('B 页面', { dependsOn: [tA] })
    tC = await mk('C 联调', { dependsOn: [tA, tB] })
    const r1 = await prisma.agentProfile.create({ data: { userId: BigInt(adminUserId), name: uniqName('机器人甲'), platform: 'CLAUDE_CODE', capabilities: 'dev-robot' } }); robotId = String(r1.id)
    const r2 = await prisma.agentProfile.create({ data: { userId: BigInt(adminUserId), name: uniqName('机器人乙'), platform: 'CLAUDE_CODE', capabilities: 'dev-robot' } }); robot2Id = String(r2.id)
  })

  after(async () => {
    try {
      const ds = await prisma.devDispatch.findMany({ where: { projectId: BigInt(projectId) }, select: { id: true } })
      const dids = ds.map(d => d.id)
      const runs = await prisma.devRun.findMany({ where: { dispatchId: { in: dids } }, select: { id: true } })
      await prisma.devRunEvent.deleteMany({ where: { runId: { in: runs.map(r => r.id) } } }).catch(() => {})
      await prisma.devRun.deleteMany({ where: { dispatchId: { in: dids } } }).catch(() => {})
      await prisma.devDispatch.deleteMany({ where: { id: { in: dids } } }).catch(() => {})
      const tasks = await prisma.task.findMany({ where: { projectId: BigInt(projectId) }, select: { id: true } }); const tids = tasks.map(t => t.id)
      await prisma.taskDependency.deleteMany({ where: { OR: [{ predecessorId: { in: tids } }, { successorId: { in: tids } }] } }).catch(() => {})
      await prisma.comment.deleteMany({ where: { entity: 'task', entityId: { in: tids } } }).catch(() => {})
      await prisma.task.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.milestone.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
      await prisma.project.deleteMany({ where: { id: BigInt(projectId) } }).catch(() => {})
      await prisma.agentPresence.deleteMany({ where: { agentProfileId: { in: [BigInt(robotId), BigInt(robot2Id)] } } }).catch(() => {})
      await prisma.agentProfile.deleteMany({ where: { id: { in: [BigInt(robotId), BigInt(robot2Id)] } } }).catch(() => {})
      if (customerId) { await prisma.contact.deleteMany({ where: { customerId: BigInt(customerId) } }).catch(() => {}); await prisma.customer.delete({ where: { id: BigInt(customerId) } }).catch(() => {}) }
    } finally { await prisma.$disconnect().catch(() => {}) }
  })

  test('启动派工单: 里程碑全部未完成任务按拓扑序入队, TODO 顺手排入 QUEUED', async () => {
    const r = await a.post('/api/fde/dev-dispatches', { projectId, milestoneId, scope: 'MILESTONE', note: '只改 backend 目录' })
    assert.equal(r.code, 0, r.message)
    dispatchId = r.data.id
    assert.equal(r.data.runCount, 3)
    assert.deepEqual(r.data.taskIds, [String(tA), String(tB), String(tC)], '拓扑序 A→B→C')
    const t = await prisma.task.findUnique({ where: { id: BigInt(tA) } })
    assert.equal(t.status, 'QUEUED')
    // 同一批任务不能重复派
    const dup = await a.post('/api/fde/dev-dispatches', { projectId, milestoneId, scope: 'MILESTONE' })
    assert.equal(dup.status, 409)
  })

  test('机器人领活: 只能领前置都完成的 A; B/C 被挡; 任务置 IN_PROGRESS 并返回上下文包', async () => {
    const r = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robotId, projectId })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.run.taskId, String(tA))
    assert.equal(r.data.run.status, 'RUNNING')
    assert.equal(r.data.run.attempts, 1)
    runA = r.data.run.id
    assert.equal(r.data.context.milestone.goal, '三个任务全部由机器人完成')
    assert.equal(r.data.context.dispatch.note, '只改 backend 目录')
    assert.equal(r.data.context.successors.length, 2)
    assert.match(r.data.context.howto, /report_dev_run_progress/)
    const t = await prisma.task.findUnique({ where: { id: BigInt(tA) } })
    assert.equal(t.status, 'IN_PROGRESS')
    // 第二台机器人此刻领不到(B/C 前置未完成)
    const r2 = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robot2Id, projectId })
    assert.equal(r2.data.run, null)
    // 甲再 claim 拿回手上的活(resumed)
    const again = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robotId, projectId })
    assert.equal(again.data.resumed, true)
    assert.equal(again.data.run.id, runA)
  })

  test('进度上报写事件与心跳; roadmap 带 runs', async () => {
    const p1 = await a.post(`/api/fde/dev-dispatches/runs/${runA}/progress`, { progress: 40, phase: '开发', message: '写完接口, 开始自测' })
    assert.equal(p1.code, 0, p1.message)
    assert.equal(p1.data.progress, 40)
    const rm = await a.get(`/api/fde/projects/${projectId}/roadmap?milestoneId=${milestoneId}`)
    assert.equal(rm.data.runs[String(tA)].status, 'RUNNING')
    assert.equal(rm.data.runs[String(tA)].progress, 40)
    assert.equal(rm.data.runs[String(tB)].status, 'PENDING')
    assert.equal(rm.data.activeDispatchCount, 1)
    const run = await a.get(`/api/fde/dev-dispatches/runs/${runA}`)
    assert.ok(run.data.events.length >= 3)
    assert.equal(run.data.events.at(-1).message, '写完接口, 开始自测')
  })

  test('完成 A: 任务 DONE + 评论带提交; 之后 B 可领, C 仍被挡', async () => {
    const done = await a.post(`/api/fde/dev-dispatches/runs/${runA}/complete`, { summary: '接口完成并自测通过', commits: [{ sha: 'abc1234def', url: 'https://gitee.com/x/y/commit/abc1234def', message: 'feat: A 接口 #' + tA }], testResult: '12/12 通过' })
    assert.equal(done.code, 0, done.message)
    assert.equal(done.data.status, 'SUCCEEDED')
    assert.equal(done.data.progress, 100)
    const t = await prisma.task.findUnique({ where: { id: BigInt(tA) } })
    assert.equal(t.status, 'DONE')
    const cm = await prisma.comment.findFirst({ where: { entity: 'task', entityId: BigInt(tA) }, orderBy: { id: 'desc' } })
    assert.match(cm.content, /完成开发/); assert.match(cm.content, /abc1234d/)
    // 再上报已终态的运行 → 409/9009
    const late = await a.post(`/api/fde/dev-dispatches/runs/${runA}/progress`, { progress: 50 })
    assert.equal(late.status, 409); assert.equal(late.code, 9009)
    const r = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robot2Id, projectId })
    assert.equal(r.data.run.taskId, String(tB)); runB = r.data.run.id
    const r3 = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robotId, projectId })
    assert.equal(r3.data.run, null, 'C 要等 B')
  })

  test('失败 B(可重试): 任务回 QUEUED, 自动重排一条 PENDING, 甲能接手', async () => {
    const f = await a.post(`/api/fde/dev-dispatches/runs/${runB}/fail`, { error: '本地起不来: 缺 .env', retryable: true })
    assert.equal(f.code, 0, f.message)
    assert.equal(f.data.status, 'FAILED')
    const t = await prisma.task.findUnique({ where: { id: BigInt(tB) } })
    assert.equal(t.status, 'QUEUED')
    const d = await a.get(`/api/fde/dev-dispatches/${dispatchId}`)
    assert.equal(d.data.status, 'RUNNING')
    assert.equal(d.data.runs.filter(r => r.taskId === String(tB)).length, 2, 'B 有失败的一条 + 重排的一条')
    const r = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robotId, projectId })
    assert.equal(r.data.run.taskId, String(tB)); assert.equal(r.data.run.attempts, 2)
    runB = r.data.run.id
    await a.post(`/api/fde/dev-dispatches/runs/${runB}/complete`, { summary: 'B 页面完成' })
  })

  test('失联释放: 心跳过期的运行退回 PENDING, 任务回 QUEUED', async () => {
    const r = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robot2Id, projectId })
    assert.equal(r.data.run.taskId, String(tC)); runC = r.data.run.id
    await prisma.devRun.update({ where: { id: BigInt(runC) }, data: { heartbeatAt: new Date(Date.now() - 3 * 3600 * 1000) } })
    const rel = await releaseStaleRuns()
    assert.ok(rel.released >= 1)
    const run = await prisma.devRun.findUnique({ where: { id: BigInt(runC) } })
    assert.equal(run.status, 'PENDING'); assert.equal(run.agentProfileId, null)
    assert.equal((await prisma.task.findUnique({ where: { id: BigInt(tC) } })).status, 'QUEUED')
  })

  test('暂停后领不到活; 继续后领到 C 并完成 → 派工单 DONE', async () => {
    await a.post(`/api/fde/dev-dispatches/${dispatchId}/pause`)
    const none = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robotId, projectId })
    assert.equal(none.data.run, null)
    await a.post(`/api/fde/dev-dispatches/${dispatchId}/resume`)
    const r = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robotId, projectId })
    assert.equal(r.data.run.taskId, String(tC))
    await a.post(`/api/fde/dev-dispatches/runs/${r.data.run.id}/complete`, { summary: 'C 联调完成' })
    const d = await a.get(`/api/fde/dev-dispatches/${dispatchId}`)
    assert.equal(d.data.status, 'DONE')
    assert.ok(d.data.finishedAt)
    const list = await a.get(`/api/fde/dev-dispatches?projectId=${projectId}&includeDone=true`)
    assert.equal(list.data.list[0].counts.SUCCEEDED, 3)
    const robots = await a.get('/api/fde/dev-dispatches/robots')
    assert.ok(robots.data.list.some(x => x.id === robotId && x.online))
  })

  test('无机器人身份且非代领 → 400; 取消派工单把 PENDING 作废', async () => {
    const bad = await a.post('/api/fde/dev-dispatches/runs/claim', {})
    assert.equal(bad.status, 400)
    const t4 = (await a.post('/api/fde/tasks', { projectId, milestoneId, title: uniqName('D 收尾') })).data.id
    const d2 = await a.post('/api/fde/dev-dispatches', { projectId, scope: 'TASKS', taskIds: [t4], agentProfileId: robotId })
    assert.equal(d2.code, 0, d2.message)
    const c = await a.post(`/api/fde/dev-dispatches/${d2.data.id}/cancel`)
    assert.equal(c.data.status, 'CANCELLED')
    assert.equal(c.data.runs[0].status, 'CANCELLED')
    // 指定给甲的单, 乙领不到; 取消后甲也领不到
    const none = await a.post('/api/fde/dev-dispatches/runs/claim', { agentProfileId: robotId, projectId })
    assert.equal(none.data.run, null)
  })
})
