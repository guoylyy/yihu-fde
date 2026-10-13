// 集成测试 - MCP 工具补全所需的新增 REST 路由
//   · GET  /projects/:id/milestones | /issues | /risks   (此前只能从项目详情整包捞)
//   · POST /notifications                                (主动发站内通知, 此前只能查)
//   · GET  /timesheets/_meta/summary?groupBy=            (周报/团队投入统计)
// 测试数据一律自建自清, 不碰库里已有记录。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, request, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('MCP 补全: 项目子资源列表接口', () => {
  let a, projectId
  const created = { milestones: [], issues: [], risks: [] }

  before(async () => {
    a = api(await login('admin'))
    // 自己造一个项目, 不占用库里已有数据
    const customers = await a.get('/api/fde/customers?page=1&page_size=1')
    const customerId = customers.data.list[0]?.id
    assert.ok(customerId, '库里至少要有一个客户才能跑这组用例')
    const p = await a.post('/api/fde/projects', { name: uniqName('项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
  })

  after(async () => {
    for (const id of created.milestones) await a.del(`/api/fde/projects/${projectId}/milestones/${id}`).catch(() => {})
    for (const id of created.issues) await a.del(`/api/fde/projects/${projectId}/issues/${id}`).catch(() => {})
    for (const id of created.risks) await a.del(`/api/fde/projects/${projectId}/risks/${id}`).catch(() => {})
    if (projectId) await a.del(`/api/fde/projects/${projectId}`).catch(() => {})
  })

  // ---------- 里程碑 ----------

  test('新建的项目里程碑列表为空', async () => {
    const r = await a.get(`/api/fde/projects/${projectId}/milestones`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.total, 0)
    assert.deepEqual(r.data.list, [])
  })

  test('建两个里程碑后能查到, 按 sortOrder 排', async () => {
    const m1 = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: uniqName('里程碑A'), plannedDate: '2026-09-01' })
    const m2 = await a.post(`/api/fde/projects/${projectId}/milestones`, { name: uniqName('里程碑B'), plannedDate: '2026-10-01' })
    assert.equal(m1.code, 0, m1.message)
    created.milestones.push(m1.data.id, m2.data.id)

    const r = await a.get(`/api/fde/projects/${projectId}/milestones`)
    assert.equal(r.data.total, 2)
    assert.ok(r.data.list[0].sortOrder <= r.data.list[1].sortOrder, '应按 sortOrder 排')
  })

  test('按状态过滤', async () => {
    // 关掉第一个
    await a.put(`/api/fde/projects/${projectId}/milestones/${created.milestones[0]}`, { status: 'COMPLETED' })
    const done = await a.get(`/api/fde/projects/${projectId}/milestones?status=COMPLETED`)
    assert.equal(done.data.total, 1)
    const pending = await a.get(`/api/fde/projects/${projectId}/milestones?status=PENDING`)
    assert.equal(pending.data.total, 1)
  })

  test('关闭里程碑会自动填实际完成日期 (close_milestone 依赖这条)', async () => {
    const r = await a.get(`/api/fde/projects/${projectId}/milestones?status=COMPLETED`)
    assert.ok(r.data.list[0].actualDate, 'COMPLETED 却没有 actualDate, close_milestone 就白做了')
  })

  test('非法状态值被拒', async () => {
    const r = await a.get(`/api/fde/projects/${projectId}/milestones?status=NOT_A_STATUS`)
    assert.equal(r.status, 400)
  })

  // ---------- 问题 / 风险 ----------

  test('问题列表: 按状态与严重度过滤', async () => {
    const i1 = await a.post(`/api/fde/projects/${projectId}/issues`, { title: uniqName('问题'), severity: 'CRITICAL' })
    const i2 = await a.post(`/api/fde/projects/${projectId}/issues`, { title: uniqName('问题'), severity: 'LOW', status: 'CLOSED' })
    assert.equal(i1.code, 0, i1.message)
    created.issues.push(i1.data.id, i2.data.id)

    const all = await a.get(`/api/fde/projects/${projectId}/issues`)
    assert.equal(all.data.total, 2)

    const open = await a.get(`/api/fde/projects/${projectId}/issues?status=OPEN`)
    assert.equal(open.data.total, 1)
    assert.equal(open.data.list[0].severity, 'CRITICAL')

    const critical = await a.get(`/api/fde/projects/${projectId}/issues?severity=CRITICAL`)
    assert.equal(critical.data.total, 1)
  })

  test('风险列表: 按状态过滤', async () => {
    const r1 = await a.post(`/api/fde/projects/${projectId}/risks`, { title: uniqName('风险'), probability: 'HIGH', impact: 'HIGH' })
    assert.equal(r1.code, 0, r1.message)
    created.risks.push(r1.data.id)

    const all = await a.get(`/api/fde/projects/${projectId}/risks`)
    assert.equal(all.data.total, 1)
    assert.equal(all.data.list[0].probability, 'HIGH')

    const closed = await a.get(`/api/fde/projects/${projectId}/risks?status=CLOSED`)
    assert.equal(closed.data.total, 0)
  })

  test('删掉的问题不再出现在列表里 (软删生效)', async () => {
    const before = await a.get(`/api/fde/projects/${projectId}/issues`)
    const victim = created.issues.pop()
    await a.del(`/api/fde/projects/${projectId}/issues/${victim}`)
    const after = await a.get(`/api/fde/projects/${projectId}/issues`)
    assert.equal(after.data.total, before.data.total - 1)
  })

  // ---------- 边界 ----------

  test('项目不存在时三个列表都 404', async () => {
    for (const sub of ['milestones', 'issues', 'risks']) {
      const r = await a.get(`/api/fde/projects/99999999/${sub}`)
      assert.equal(r.status, 404, `${sub} 应 404`)
    }
  })

  test('未登录一律 401', async () => {
    for (const sub of ['milestones', 'issues', 'risks']) {
      const r = await request('GET', `/api/fde/projects/${projectId}/${sub}`, null, null)
      assert.equal(r.status, 401, `${sub} 应 401`)
    }
  })
})

describe('MCP 补全: 主动发站内通知', () => {
  let a, myUserId
  const sent = []

  before(async () => {
    a = api(await login('admin'))
    const me = await a.get('/api/fde/me')
    myUserId = me.data.profile?.id
    assert.ok(myUserId, '拿不到本人 userId')
  })

  after(async () => {
    for (const id of sent) await a.del(`/api/fde/notifications/${id}`).catch(() => {})
  })

  test('能发给自己并在通知列表里查到', async () => {
    const title = uniqName('通知')
    const r = await a.post('/api/fde/notifications', { toUserId: myUserId, title, content: '正文内容' })
    assert.equal(r.code, 0, r.message)
    assert.ok(r.data.id)
    sent.push(r.data.id)

    const list = await a.get('/api/fde/notifications?page=1&page_size=20')
    const found = list.data.list.find(n => n.title === title)
    assert.ok(found, '发出去的通知应该出现在列表里')
    // 拍板: 正文要带上发送人, 收到的人一眼知道是谁让发的
    assert.match(found.body, /由 .+ 发送/)
  })

  // 回归护栏: 归属判定曾经拿 BigInt 直接 !== JWT 里的字符串 userId, 恒为真,
  // 导致"标记已读"和"删除通知"对所有人 403 —— 铃铛里那两个按钮一直是坏的。
  test('自己的通知能标记已读, 也能删掉 (归属判定的类型坑)', async () => {
    const title = uniqName('通知')
    const created = await a.post('/api/fde/notifications', { toUserId: myUserId, title })
    assert.equal(created.code, 0, created.message)
    const nid = created.data.id

    const read = await a.post(`/api/fde/notifications/${nid}/read`)
    assert.equal(read.code, 0, `标记已读失败: ${read.message}`)

    const del = await a.del(`/api/fde/notifications/${nid}`)
    assert.equal(del.code, 0, `删除失败: ${del.message}`)

    const list = await a.get('/api/fde/notifications?page=1&page_size=50')
    assert.ok(!list.data.list.some(n => n.title === title), '删掉的通知不该还在列表里')
  })

  test('标题必填', async () => {
    const r = await a.post('/api/fde/notifications', { toUserId: myUserId, title: '   ' })
    assert.equal(r.status, 400)
  })

  test('toUserId 必填', async () => {
    const r = await a.post('/api/fde/notifications', { title: uniqName('通知') })
    assert.equal(r.status, 400)
  })

  test('接收人不存在时 404', async () => {
    const r = await a.post('/api/fde/notifications', { toUserId: 99999999, title: uniqName('通知') })
    assert.equal(r.status, 404)
  })

  test('未登录 401', async () => {
    const r = await request('POST', '/api/fde/notifications', { toUserId: myUserId, title: 'x' }, null)
    assert.equal(r.status, 401)
  })
})

describe('MCP 补全: 工时汇总的 groupBy', () => {
  let a

  before(async () => { a = api(await login('admin')) })

  test('缺省行为不变 —— 仍按项目分组, list 里保留 projectId/project', async () => {
    const r = await a.get('/api/fde/timesheets/_meta/summary')
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.groupBy, 'PROJECT')
    assert.ok(Array.isArray(r.data.list))
    for (const x of r.data.list) {
      assert.ok('projectId' in x, '老看板依赖 projectId 字段, 不能丢')
      assert.ok('totalHours' in x && 'recordCount' in x)
    }
  })

  test('按人分组带出姓名', async () => {
    const r = await a.get('/api/fde/timesheets/_meta/summary?groupBy=ENGINEER')
    assert.equal(r.data.groupBy, 'ENGINEER')
    for (const x of r.data.list) {
      assert.ok('engineerId' in x)
      assert.ok('key' in x && 'totalHours' in x)
    }
  })

  test('按天分组的 key 是 YYYY-MM-DD 且升序', async () => {
    const r = await a.get('/api/fde/timesheets/_meta/summary?groupBy=DAY')
    assert.equal(r.data.groupBy, 'DAY')
    let prev = ''
    for (const x of r.data.list) {
      assert.match(x.key, /^\d{4}-\d{2}-\d{2}$/)
      assert.ok(x.key >= prev, '应按日期升序')
      prev = x.key
    }
  })

  test('totalHours 等于各分组之和', async () => {
    const r = await a.get('/api/fde/timesheets/_meta/summary?groupBy=ENGINEER')
    const sum = r.data.list.reduce((s, x) => s + x.totalHours, 0)
    assert.ok(Math.abs(sum - r.data.totalHours) < 0.001, `合计对不上: ${sum} vs ${r.data.totalHours}`)
  })

  test('非法 groupBy 被拒', async () => {
    const r = await a.get('/api/fde/timesheets/_meta/summary?groupBy=WHATEVER')
    assert.equal(r.status, 400)
  })

  test('三种分组的总工时一致 (同一批数据换个切法而已)', async () => {
    const [p, e, d] = await Promise.all([
      a.get('/api/fde/timesheets/_meta/summary?from=2026-01-01&to=2026-12-31&groupBy=PROJECT'),
      a.get('/api/fde/timesheets/_meta/summary?from=2026-01-01&to=2026-12-31&groupBy=ENGINEER'),
      a.get('/api/fde/timesheets/_meta/summary?from=2026-01-01&to=2026-12-31&groupBy=DAY')
    ])
    assert.ok(Math.abs(p.data.totalHours - e.data.totalHours) < 0.001, '按项目与按人合计应一致')
    assert.ok(Math.abs(p.data.totalHours - d.data.totalHours) < 0.001, '按项目与按天合计应一致')
  })
})
