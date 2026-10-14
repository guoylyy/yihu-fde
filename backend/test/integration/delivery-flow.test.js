// 集成测试 - 交付全流程的「可追踪」回归: 项目 → 里程碑 → 任务 → 指派(人 / 机器人) → 工时审批 → 验收 → 关闭
// 守的是 2026-10 走查发现的缺陷: 验收绕过、工时批后可改 / 自批 / 越权批、通知漏发、机器人在关闭的项目上继续领活等
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, BASE, createTestUser } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

const wait = (ms) => new Promise(r => setTimeout(r, ms))

describe('交付全流程: 可追踪与权限', () => {
  let admin, mgr, eng, mgrUser, engUser
  const ids = { customers: [], projects: [], agents: [] }
  const startedAt = new Date()

  /** 某人在本用例开始后收到的某类通知 */
  async function received(userId, type) {
    await wait(300)   // 通知在响应后异步写入
    return prisma.notification.findMany({ where: { userId: BigInt(userId), type, createdAt: { gte: startedAt } } })
  }

  async function newProject(who = mgr, extra = {}) {
    const c = await who.post('/api/fde/customers', { name: uniqName('流程客户') })
    ids.customers.push(c.data.id)
    const p = await who.post('/api/fde/projects', { name: uniqName('流程项目'), customerId: c.data.id, startDate: '2026-10-01', endDate: '2026-12-31', ...extra })
    assert.equal(p.code, 0, p.message)
    ids.projects.push(p.data.id)
    await who.post(`/api/fde/projects/${p.data.id}/members`, { userId: engUser.id, roleInProject: 'FDE' })
    return p.data.id
  }

  before(async () => {
    admin = api(await login('admin'))
    mgr = api(await login('manager'))
    eng = api(await login('fde001'))
    mgrUser = (await mgr.get('/api/auth/me')).data
    engUser = (await eng.get('/api/auth/me')).data
  })

  after(async () => {
    const pids = ids.projects.map(BigInt)
    const tasks = await prisma.task.findMany({ where: { projectId: { in: pids } }, select: { id: true } })
    const tids = tasks.map(t => t.id)
    const runs = await prisma.devRun.findMany({ where: { taskId: { in: tids } }, select: { id: true } })
    await prisma.devRunEvent.deleteMany({ where: { runId: { in: runs.map(r => r.id) } } })
    await prisma.devRun.deleteMany({ where: { id: { in: runs.map(r => r.id) } } })
    await prisma.devDispatch.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.comment.deleteMany({ where: { entity: 'task', entityId: { in: tids } } })
    await prisma.taskDependency.deleteMany({ where: { OR: [{ predecessorId: { in: tids } }, { successorId: { in: tids } }] } }).catch(() => {})
    await prisma.timesheet.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.task.deleteMany({ where: { id: { in: tids } } })
    await prisma.milestone.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.projectMember.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.activity.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ entity: 'project', entityId: { in: pids } }, { entity: 'task', entityId: { in: tids } }] } })
    await prisma.project.deleteMany({ where: { id: { in: pids } } })
    // 客户只软删: 其他并行跑的测试文件可能正拿着「列表里第一个客户」建项目, 硬删会让它们失败
    await prisma.customer.updateMany({ where: { id: { in: ids.customers.map(BigInt) } }, data: { deletedAt: new Date() } })
    const agents = ids.agents.map(BigInt)
    await prisma.agentActivityLog.deleteMany({ where: { agentProfileId: { in: agents } } }).catch(() => {})
    await prisma.agentPresence.deleteMany({ where: { agentProfileId: { in: agents } } }).catch(() => {})
    await prisma.apiKey.deleteMany({ where: { agentProfileId: { in: agents } } })
    await prisma.agentProfile.deleteMany({ where: { id: { in: agents } } })
    await prisma.notification.deleteMany({ where: { createdAt: { gte: startedAt }, userId: { in: [BigInt(mgrUser.id), BigInt(engUser.id), 1n] } } })
  })

  describe('任务: 指派要通知, 验收是经理的事', () => {
    let P, M
    before(async () => {
      P = await newProject()
      M = (await mgr.post(`/api/fde/projects/${P}/milestones`, { name: 'M1', plannedDate: '2026-11-01' })).data.id
    })

    test('里程碑计划日在项目周期外给提醒', async () => {
      const r = await mgr.post(`/api/fde/projects/${P}/milestones`, { name: '太早', plannedDate: '2026-09-01' })
      assert.equal(r.code, 0)
      assert.match(r.raw._warn, /早于项目开始日/)
    })

    test('改负责人(PUT)也通知新负责人', async () => {
      const t = await mgr.post('/api/fde/tasks', { projectId: P, milestoneId: M, title: uniqName('重新指派') })
      await mgr.put(`/api/fde/tasks/${t.data.id}`, { assigneeUserId: engUser.id })
      const got = await received(engUser.id, 'TASK_ASSIGNED')
      assert.ok(got.some(n => n.body.includes('重新指派')))
    })

    test('@姓名(带空格) 能通知到人', async () => {
      const t = await mgr.post('/api/fde/tasks', { projectId: P, milestoneId: M, title: uniqName('提及') })
      await mgr.post('/api/fde/comments', { entity: 'task', entityId: t.data.id, content: `请 @${engUser.name} 看一下` })
      assert.ok((await received(engUser.id, 'MENTIONED')).length >= 1)
    })

    test('工程师不能验收, 经理只能验收已完成的任务, 不能新建已验收的任务', async () => {
      const t = await mgr.post('/api/fde/tasks', { projectId: P, milestoneId: M, title: uniqName('验收'), assigneeUserId: engUser.id })
      assert.equal((await eng.post(`/api/fde/tasks/${t.data.id}/status`, { status: 'VERIFIED' })).status, 403)
      assert.equal((await eng.put(`/api/fde/tasks/${t.data.id}`, { status: 'VERIFIED' })).status, 403)
      assert.equal((await mgr.post(`/api/fde/tasks/${t.data.id}/status`, { status: 'VERIFIED' })).status, 403, '未完成不能验收')
      assert.equal((await eng.post(`/api/fde/tasks/${t.data.id}/status`, { status: 'DONE' })).code, 0)
      assert.equal((await mgr.post(`/api/fde/tasks/${t.data.id}/status`, { status: 'VERIFIED' })).code, 0)
      assert.equal((await eng.post('/api/fde/tasks', { projectId: P, title: 'x', status: 'VERIFIED' })).status, 400)
    })
  })

  describe('工时: 录入校验、审批权限、批后不可改', () => {
    // 每天合计不超过 24 小时是按人算的: 用一个新工程师, 不受种子账号已有工时影响
    let P, te, tester
    before(async () => {
      P = await newProject()
      tester = await createTestUser('FDE_ENGINEER')
      te = api(tester.token)
      await mgr.post(`/api/fde/projects/${P}/members`, { userId: tester.id, roleInProject: 'FDE' })
    })
    after(async () => {
      await prisma.timesheet.deleteMany({ where: { engineer: { userId: BigInt(tester.id) } } })
      await tester.cleanup()
    })

    test('超过 24 小时、未来日期、一天合计超 24 小时都拒绝', async () => {
      assert.equal((await te.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-14', hours: 26, workContent: 'x' })).status, 400)
      assert.equal((await te.post('/api/fde/timesheets', { projectId: P, workDate: '2099-01-01', hours: 2, workContent: 'x' })).status, 400)
      assert.equal((await te.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-10', hours: 20, workContent: 'a' })).code, 0)
      assert.equal((await te.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-10', hours: 6, workContent: 'b' })).status, 400)
    })

    test('不能直接建成已批准; 提交后审批人收到待审批通知', async () => {
      const r = await te.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-09', hours: 2, workContent: 'c', status: 'APPROVED' })
      assert.equal(r.data.status, 'SUBMITTED')
      assert.ok((await received(mgrUser.id, 'TIMESHEET_PENDING')).length >= 1)
    })

    test('审批人是本人; 批后不能改、工程师不能删、不能重复审批', async () => {
      const ts = await te.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-08', hours: 6, workContent: '正常' })
      assert.equal((await mgr.post(`/api/fde/timesheets/${ts.data.id}/approve`, { approved: true, approvedBy: 1 })).code, 0)
      const row = await prisma.timesheet.findUnique({ where: { id: BigInt(ts.data.id) } })
      assert.equal(String(row.approvedBy), String(mgrUser.id), '不收冒名的 approvedBy')
      assert.equal((await te.put(`/api/fde/timesheets/${ts.data.id}`, { hours: 12 })).status, 400)
      assert.notEqual((await te.del(`/api/fde/timesheets/${ts.data.id}`)).code, 0)
      assert.equal((await mgr.post(`/api/fde/timesheets/${ts.data.id}/approve`, { approved: false })).status, 400)
    })

    test('驳回原因通知到工程师; 改完自动重新提交', async () => {
      const ts = await te.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-07', hours: 3, workContent: '会被驳回' })
      await mgr.post(`/api/fde/timesheets/${ts.data.id}/approve`, { approved: false, reason: '请补充工作内容' })
      const got = await received(tester.id, 'TIMESHEET_REJECTED')
      assert.ok(got.some(n => n.body.includes('请补充工作内容')))
      const r = await te.put(`/api/fde/timesheets/${ts.data.id}`, { workContent: '补充了' })
      assert.equal(r.data.status, 'SUBMITTED')
      assert.equal(r.data.rejectReason, null)
    })

    test('经理不能审批自己的、也不能审批范围外项目的工时; 工程师不能改别人的', async () => {
      const own = await mgr.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-08', hours: 4, workContent: '经理自己' })
      assert.equal((await mgr.post(`/api/fde/timesheets/${own.data.id}/approve`, { approved: true })).status, 403)
      assert.equal((await te.put(`/api/fde/timesheets/${own.data.id}`, { hours: 1 })).status, 403)
      const other = await newProject(admin)
      await admin.post(`/api/fde/projects/${other}/members`, { userId: tester.id, roleInProject: 'FDE' })
      const ts = await te.post('/api/fde/timesheets', { projectId: other, workDate: '2026-10-06', hours: 1, workContent: 'x' })
      assert.equal((await mgr.post(`/api/fde/timesheets/${ts.data.id}/approve`, { approved: true })).status, 404)
    })
  })

  describe('机器人与关闭', () => {
    let P, M, key, agentId, dispatchId

    const mcp = async (name, args) => {
      const r = await fetch(BASE + '/api/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      })
      const j = await r.json()
      return JSON.parse(j.result.content[0].text).data
    }

    before(async () => {
      P = await newProject()
      M = (await mgr.post(`/api/fde/projects/${P}/milestones`, { name: 'M 机器人', plannedDate: '2026-11-20' })).data.id
      const ap = await eng.post('/api/fde/agent-profiles', { name: uniqName('流程机器人'), platform: 'CLAUDE_CODE' })
      agentId = ap.data.id; key = ap.data.apiKey; ids.agents.push(agentId)
      await mgr.post('/api/fde/tasks', { projectId: P, milestoneId: M, title: '没负责人的任务' })
      await mgr.post('/api/fde/tasks', { projectId: P, milestoneId: M, title: '第二个任务' })
      dispatchId = (await mgr.post('/api/fde/dev-dispatches', { projectId: P, milestoneId: M, scope: 'MILESTONE', agentProfileId: agentId })).data.id
    })

    test('机器人领到没负责人的任务, 记到它的主人名下', async () => {
      const claim = await mcp('claim_dev_run', { projectId: P })
      const task = await prisma.task.findUnique({ where: { id: BigInt(claim.run.taskId) } })
      assert.equal(String(task.assigneeId), String(engUser.engineerId))
    })

    test('里程碑完成: 提醒没做完的任务, 作废机器人运行, 机器人领不到', async () => {
      const r = await mgr.put(`/api/fde/projects/${P}/milestones/${M}`, { status: 'COMPLETED' })
      assert.match(r.raw._warn, /没做完/)
      const d = await mgr.get(`/api/fde/dev-dispatches/${dispatchId}`)
      assert.equal(d.data.status, 'CANCELLED')
      assert.ok(d.data.runs.every(x => ['CANCELLED', 'SUCCEEDED', 'FAILED'].includes(x.status)))
      assert.equal((await mcp('claim_dev_run', { projectId: P })).run, null)
    })

    test('项目关闭后不能再报工时、建任务、加里程碑', async () => {
      const r = await mgr.post(`/api/fde/projects/${P}/close`, { reason: '验证' })
      assert.equal(r.code, 0)
      assert.equal((await eng.post('/api/fde/timesheets', { projectId: P, workDate: '2026-10-05', hours: 1, workContent: 'x' })).status, 400)
      assert.equal((await eng.post('/api/fde/tasks', { projectId: P, title: 'x' })).status, 400)
      assert.equal((await mgr.post(`/api/fde/projects/${P}/milestones`, { name: 'x' })).status, 400)
    })
  })

  test('用户接口: 非数字 id 返回 404 而不是 500', async () => {
    assert.equal((await admin.get('/api/fde/users/assignable')).status, 404)
  })
})
