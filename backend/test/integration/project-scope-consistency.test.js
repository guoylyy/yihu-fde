// 集成测试 - 员工反馈的两个问题
//   ① 同一个项目, 两个账号看到的记录内容不同
//   ② 备用金账单没有批量通过
//
// ① 的根因: 项目详情用 canAccessRecord(对 FDE 工程师/销售的 project 直接 return true),
// 而项目记录等子资源用 buildScopeWhere(只认成员关系) —— 两边口径分叉,
// 表现就是"页面打得开、记录是空的", 而前端把 404 静默吞了, 于是看起来像"内容不一样"。
// 这里守的是: 详情页放行的项目, 它的子资源也必须放行; 详情页挡掉的, 子资源也挡掉。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, request, uniqName, createTestUser } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('项目详情与子资源的数据范围必须一致', () => {
  let admin, projectId, recordId, customerId

  before(async () => {
    admin = api(await login('admin'))
    // 自建专属客户, 不取列表第一条 —— 并行跑时 list[0] 可能是其他套件正在清理的
    // unit-test 客户, 会导致建项目报「客户不存在」(2026-09-10 #855)
    const c = await admin.post('/api/fde/customers', { name: uniqName('范围一致性客户'), industry: '互联网', scale: 'A' })
    assert.equal(c.code, 0, `建测试客户失败: ${c.message}`)
    customerId = c.data.id
    const p = await admin.post('/api/fde/projects', { name: uniqName('项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    const r = await admin.post(`/api/fde/project-records/${projectId}/records`, {
      type: 'COMM', title: uniqName('对接沟通'), content: '员工反馈复现用'
    })
    assert.equal(r.code, 0, r.message)
    recordId = r.data.id
  })

  after(async () => {
    if (recordId) await admin.del(`/api/fde/project-records/records/${recordId}`).catch(() => {})
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await prisma.$disconnect().catch(() => {})
  })

  test('管理员两处都能看到, 且记录条数对得上', async () => {
    const detail = await admin.get(`/api/fde/projects/${projectId}`)
    assert.equal(detail.code, 0, detail.message)
    const recs = await admin.get(`/api/fde/project-records/${projectId}/records`)
    assert.equal(recs.code, 0, recs.message)
    assert.equal(recs.data.total, 1)
  })

  // 核心回归: 拿一个**非项目成员**的内部账号, 详情与记录必须给出同一个结论。
  // 修复前: 详情 200(canAccessRecord 放行) + 记录 404(buildScopeWhere 挡住) —— 正是员工看到的现象。
  //
  // 注意这条用例必须自己造账号。最初写成"从库里挑一个非成员账号", 结果本地库挑不到就静默跳过,
  // 把修复前的代码放回去照样绿 —— 那是个假护栏。现在自建 FDE 工程师与项目经理各一个, 用完删掉。
  // 工程师 / 项目经理都不该看到自己没参与的项目; ADMIN 是全局范围, 不在此列。
  for (const role of ['FDE_ENGINEER', 'MANAGER']) {
    test(`非成员的 ${role}: 项目详情与项目记录的放行结论必须一致`, async () => {
      const u = await createThrowawayUser(role)
      try {
        const a = api(u.token)
        const detail = await a.get(`/api/fde/projects/${projectId}`)
        const recs = await a.get(`/api/fde/project-records/${projectId}/records`)
        assert.equal(
          detail.code === 0, recs.code === 0,
          `口径分叉: ${role} 详情=${detail.status} 记录=${recs.status}。` +
          '详情页放得进去、记录却 404, 用户就会以为「两个账号看到的内容不一样」'
        )
        // 非成员本来就不该看到这个项目, 两处都应挡住
        assert.notEqual(detail.code, 0, `${role} 不是项目成员, 详情就不该放行`)
      } finally {
        await u.cleanup()
      }
    })
  }

  test('把人加进项目后, 详情与记录同时放行', async () => {
    const u = await createThrowawayUser('FDE_ENGINEER')
    try {
      const a = api(u.token)
      assert.notEqual((await a.get(`/api/fde/projects/${projectId}`)).code, 0, '加人之前应该进不去')

      const add = await admin.post(`/api/fde/projects/${projectId}/members`, { userId: u.id, roleInProject: 'FDE' })
      assert.equal(add.code, 0, add.message)

      const detail = await a.get(`/api/fde/projects/${projectId}`)
      const recs = await a.get(`/api/fde/project-records/${projectId}/records`)
      assert.equal(detail.code, 0, `加进成员后详情应放行: ${detail.message}`)
      assert.equal(recs.code, 0, `加进成员后记录也应放行: ${recs.message}`)
      assert.equal(recs.data.total, 1, '成员应该看得到项目里那条记录')
    } finally {
      await u.cleanup()
    }
  })

  test('项目不存在时, 详情与记录都是 404', async () => {
    const detail = await admin.get('/api/fde/projects/99999999')
    const recs = await admin.get('/api/fde/project-records/99999999/records')
    assert.equal(detail.status, 404)
    assert.equal(recs.status, 404)
  })

  test('记录只属于自己的项目 —— 换个项目查不到这条', async () => {
    const customers = await admin.get('/api/fde/customers?page=1&page_size=1')
    const other = await admin.post('/api/fde/projects', { name: uniqName('项目'), customerId: customers.data.list[0].id })
    try {
      const recs = await admin.get(`/api/fde/project-records/${other.data.id}/records`)
      assert.equal(recs.code, 0, recs.message)
      assert.equal(recs.data.total, 0, '新项目不该看到别的项目的记录')
    } finally {
      await admin.del(`/api/fde/projects/${other.data.id}`).catch(() => {})
    }
  })
})

// ========================================================================
// v2.1.14 串项目回归 —— scope 条件不得覆盖 URL 项目 id
// 根因: findScopedProject 等处 where 写法为 { id: URL项目id, deletedAt, ...scope },
// scope 含 id 字段(OWN_RECORDS 角色返回 { id: { in: 参与项目ids } })时 spread 会把
// URL 里的项目 id 覆盖掉, findFirst 在可见集合内命中固定项目 —— 所有项目返回同一份数据
// (员工报障「每个项目的会议记录都一样, A 新增全项目同步」即此)。
// 修复: where 改 AND 显式求交。这里守的是: 成员访问每个项目, 只能看到该项目的记录。
describe('scope 条件不得覆盖 URL 项目 id (v2.1.14 串项目回归)', () => {
  let admin, customerId, projA, projB

  before(async () => {
    admin = api(await login('admin'))
    const c = await admin.post('/api/fde/customers', { name: uniqName('串项目回归客户'), industry: '互联网', scale: 'A' })
    assert.equal(c.code, 0, `建测试客户失败: ${c.message}`)
    customerId = c.data.id
    const a = await admin.post('/api/fde/projects', { name: uniqName('串项目A'), customerId })
    const b = await admin.post('/api/fde/projects', { name: uniqName('串项目B'), customerId })
    assert.equal(a.code, 0, a.message)
    assert.equal(b.code, 0, b.message)
    projA = a.data.id
    projB = b.data.id
    // 只往 A 放一条记录, B 保持空 —— 成员看 B 必须是 0 条; 修复前的写法会命中固定项目,
    // B 的响应里出现 A 那条记录(正是员工看到的「所有项目显示同一份会议记录」)
    const r = await admin.post(`/api/fde/project-records/${projA}/records`, {
      type: 'COMM', title: uniqName('A专有会议记录'), content: '只属于项目A'
    })
    assert.equal(r.code, 0, r.message)
  })

  after(async () => {
    const ids = [projA, projB].filter(Boolean).map(String)
    if (ids.length) {
      const all = await admin.get(`/api/fde/project-records/${projA}/records?page_size=100`).catch(() => null)
      for (const rec of all?.data?.list || []) {
        await admin.del(`/api/fde/project-records/records/${rec.id}`).catch(() => {})
      }
    }
    for (const pid of ids) await admin.del(`/api/fde/projects/${pid}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await prisma.$disconnect().catch(() => {})
  })

  test('FDE 成员同时参与 A/B 两项目: 各项目只返回各自的记录', async () => {
    const u = await createThrowawayUser('FDE_ENGINEER')
    try {
      for (const pid of [projA, projB]) {
        const add = await admin.post(`/api/fde/projects/${pid}/members`, { userId: u.id, roleInProject: 'FDE' })
        assert.equal(add.code, 0, `加成员失败: ${add.message}`)
      }
      const a = api(u.token)
      const recsA = await a.get(`/api/fde/project-records/${projA}/records`)
      assert.equal(recsA.code, 0, `A 项目应放行: ${recsA.message}`)
      assert.equal(recsA.data.total, 1, 'A 项目应恰好 1 条自己的记录')
      const recsB = await a.get(`/api/fde/project-records/${projB}/records`)
      assert.equal(recsB.code, 0, `成员访问 B 也应放行: ${recsB.message}`)
      assert.equal(
        recsB.data.total, 0,
        `★ 串项目复现: B 项目必须 0 条, 实际 ${recsB.data.total} 条 —— scope 覆盖了 URL 项目 id, B 的页面出现了别的项目的记录`
      )
    } finally {
      await u.cleanup()
    }
  })

  test('非成员访问项目必须被挡, 且绝不能返回别的项目数据', async () => {
    const u = await createThrowawayUser('FDE_ENGINEER')
    try {
      const recsB = await api(u.token).get(`/api/fde/project-records/${projB}/records`)
      assert.notEqual(recsB.code, 0, '非成员应被数据范围挡住(404); 若 200 说明范围条件失效')
    } finally {
      await u.cleanup()
    }
  })
})

/** 现建一个内部账号并登录, 返回 token 与清理函数(见 helpers.createTestUser) */
const createThrowawayUser = (role) => createTestUser(role)
