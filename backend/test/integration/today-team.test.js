// 集成测试 - 0.5.0 R3: 今日页/团队页用到的接口 + 工时降级成任务字段
// 覆盖: 任务 actualHours 读写/清空/校验(旧工时之和改名 timesheetHours)、/api/dev/conversations?engineerId=me、
//       /api/fde/me/approvals(工程师无审批权 / 管理员有明细)、/api/fde/team/overview(管理员可看, 工程师 403)。账号 / 项目现建现删
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { login, api, uniqName, createTestUser } from './helpers.js'

describe('0.5.0 R3 今日 / 团队 / 任务实际工时', () => {
  let admin, E, e, O, o, customerId, projectId, taskId
  const RUN = `r3${Date.now().toString(36)}`

  before(async () => {
    admin = api(await login('admin'))
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-今日工程师' })
    O = await createTestUser('FDE_ENGINEER', { name: 'unit-test-今日旁人' })
    e = api(E.token); o = api(O.token)
    const c = await admin.post('/api/fde/customers', { name: uniqName('今日客户'), industry: 'X' })
    assert.equal(c.code, 0, c.message)
    customerId = c.data.id
    const p = await admin.post('/api/fde/projects', { name: uniqName('今日项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    const m = await admin.post(`/api/fde/projects/${projectId}/members`, { userId: E.id, roleInProject: 'DEV' })
    assert.equal(m.code, 0, m.message)
    const t = await admin.post('/api/fde/tasks', { projectId, title: uniqName('今日任务'), assigneeUserId: E.id, priority: 'HIGH', actualHours: '1.5' })
    assert.equal(t.code, 0, t.message)
    taskId = t.data.id
  })

  after(async () => {
    await prisma.devConversation.deleteMany({ where: { uid: { startsWith: RUN } } })
    if (taskId) await admin.del(`/api/fde/tasks/${taskId}`).catch(() => {})
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await E?.cleanup(); await O?.cleanup()
  })

  test('任务实际工时: 新建可带, 返回 number; 编辑改/清空; 非法值 400', async () => {
    const d1 = await e.get(`/api/fde/tasks/${taskId}`)
    assert.equal(d1.code, 0, d1.message)
    assert.equal(d1.data.actualHours, 1.5, '新建带的实际工时落库且是数字')
    assert.equal(typeof d1.data.timesheetHours, 'number', '旧工时之和改名 timesheetHours')

    const u = await admin.put(`/api/fde/tasks/${taskId}`, { actualHours: 3.25 })
    assert.equal(u.code, 0, u.message)
    assert.equal(u.data.actualHours, 3.25, 'PUT 返回也是数字, 不是 Decimal 字符串')

    const list = await e.get(`/api/fde/tasks?mine=true&page_size=50`)
    assert.equal(list.code, 0, list.message)
    const row = list.data.list.find(t => String(t.id) === String(taskId))
    assert.ok(row, '我的任务列表里有它')
    assert.equal(row.actualHours, 3.25)

    for (const bad of [-1, '1.234', 'abc', 10000, true]) {
      const r = await admin.put(`/api/fde/tasks/${taskId}`, { actualHours: bad })
      assert.equal(r.status, 400, `actualHours=${JSON.stringify(bad)} 应 400`)
    }
    const cleared = await admin.put(`/api/fde/tasks/${taskId}`, { actualHours: null })
    assert.equal(cleared.code, 0, cleared.message)
    assert.equal(cleared.data.actualHours, null, '传 null 清空')
    const untouched = await admin.put(`/api/fde/tasks/${taskId}`, { title: uniqName('今日任务改名') })
    assert.equal(untouched.data.actualHours, null, '不传 actualHours 不改')
  })

  test('会话列表 engineerId=me 只返回我的', async () => {
    const mine = await e.post('/api/devlog/conversations', { conversations: [{ uid: `${RUN}-mine`, source: 'CLAUDE_CODE', title: '我的会话', summary: '修了登录。还有别的' }] })
    assert.ok([200, 201].includes(mine.status), mine.message)
    const other = await o.post('/api/devlog/conversations', { conversations: [{ uid: `${RUN}-other`, source: 'CLAUDE_CODE', title: '别人的会话' }] })
    assert.ok([200, 201].includes(other.status), other.message)

    const r = await e.get('/api/dev/conversations?engineerId=me&size=3')
    assert.equal(r.code, 0, r.message)
    const uids = r.data.list.map(c => c.uid)
    assert.ok(uids.includes(`${RUN}-mine`))
    assert.ok(!uids.includes(`${RUN}-other`))
    assert.ok(r.data.list.length <= 3)

    // 管理员看全部, 但 engineerId=me 只剩自己的
    const a = await admin.get('/api/dev/conversations?engineerId=me&size=100')
    assert.equal(a.code, 0, a.message)
    assert.ok(!a.data.list.some(c => c.uid.startsWith(RUN)), '管理员的「我的」不含工程师上报的')
    const bad = await e.get('/api/dev/conversations?engineerId=abc')
    assert.equal(bad.status, 400, '其它非法值照旧 400')
  })

  test('等我处理: 工程师 canApprove=false; 管理员有 total/counts/recent', async () => {
    const r = await e.get('/api/fde/me/approvals')
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.canApprove, false)
    assert.equal(r.data.total, 0)
    assert.deepEqual(r.data.recent, [])

    const a = await admin.get('/api/fde/me/approvals?limit=3')
    assert.equal(a.code, 0, a.message)
    assert.equal(a.data.canApprove, true)
    assert.equal(a.data.total, a.data.counts.timesheets + a.data.counts.tasksToVerify)
    assert.ok(a.data.recent.length <= 3)
    for (const it of a.data.recent) assert.ok(['TIMESHEET', 'TASK_VERIFY'].includes(it.kind) && it.link)
  })

  test('团队概览: 管理员能看负载, 工程师 403', async () => {
    const r = await admin.get('/api/fde/team/overview')
    assert.equal(r.code, 0, r.message)
    const me = r.data.list.find(x => x.userId === String(E.id))
    assert.ok(me, '新建的工程师在列表里')
    assert.ok(me.open >= 1, '手上至少有那条任务')
    assert.ok(me.highPriority >= 1)
    assert.ok(me.activeProjects >= 1)
    assert.ok(['IDLE', 'NORMAL', 'BUSY', 'OVERLOAD'].includes(me.load))
    assert.ok(!r.data.list.some(x => x.role === 'ADMIN'), '管理员不进工程师池')

    const denied = await e.get('/api/fde/team/overview')
    assert.equal(denied.status, 403)
  })
})
