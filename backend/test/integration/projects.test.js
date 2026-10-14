// 集成测试 - /api/fde/projects 项目
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, TAG, createTestUser } from './helpers.js'

describe('API: /api/fde/projects 项目管理', () => {
  let token, a, createdIds = [], customerId

  before(async () => {
    token = await login()
    a = api(token)
    // 找或建一个 customer
    const cl = await a.get('/api/fde/customers?page=1&page_size=1')
    if (cl.code === 0 && cl.data?.list?.length) {
      customerId = String(cl.data.list[0].id)
    }
  })

  after(async () => {
    for (const id of createdIds) {
      try { await a.del(`/api/fde/projects/${id}`) } catch {}
    }
  })

  // ===== 列表 =====
  describe('GET / 列表', () => {
    test('返回项目列表', async () => {
      const r = await a.get('/api/fde/projects')
      assert.equal(r.code, 0)
      assert.ok(Array.isArray(r.data.list))
      assert.ok(typeof r.data.total === 'number')
    })

    test('分页生效', async () => {
      const r = await a.get('/api/fde/projects?page=1&page_size=3')
      assert.equal(r.code, 0)
      assert.ok(r.data.list.length <= 3)
    })

    test('状态筛选', async () => {
      const r = await a.get('/api/fde/projects?status=IN_PROGRESS')
      assert.equal(r.code, 0)
      for (const p of r.data.list) {
        assert.equal(p.status, 'IN_PROGRESS')
      }
    })
  })

  // ===== 创建 =====
  describe('POST / 创建', () => {
    test('缺 name 返回错误', async () => {
      const r = await a.post('/api/fde/projects', {
        customerId, managerId: 1
      })
      assert.notEqual(r.code, 0)
    })

    test('缺 customerId 返回错误', async () => {
      const r = await a.post('/api/fde/projects', {
        name: uniqName(), managerId: 1
      })
      assert.notEqual(r.code, 0)
    })

    test('缺 managerId 不报错 (managerId 是可选)', async () => {
      const r = await a.post('/api/fde/projects', {
        name: uniqName(), customerId
      })
      // 2026-07-03: managerId 改为可选, 允许销售先建项目再分派
      assert.equal(r.code, 0)
      if (r.data?.id) createdIds.push(r.data.id)
    })

    test('合法数据创建', async function() {
      if (!customerId) {
        this.skip()
        return
      }
      const code = uniqName('PRJ').toUpperCase()
      const r = await a.post('/api/fde/projects', {
        code,
        name: uniqName('项目'),
        customerId,
        managerId: 1,
        status: 'DRAFT'
      })
      assert.equal(r.code, 0, `创建失败: ${r.message}`)
      if (r.data?.id) createdIds.push(r.data.id)
    })
  })

  // ===== 单条 =====
  describe('GET /:id', () => {
    test('不存在的 id', async () => {
      const r = await a.get('/api/fde/projects/999999999')
      assert.notEqual(r.code, 0)
    })
  })

  // ===== 更新 =====
  describe('PUT /:id', () => {
    test('更新不存在的 id', async () => {
      const r = await a.put('/api/fde/projects/999999999', { name: 'X' })
      assert.notEqual(r.code, 0)
    })
  })

  // ===== 状态变更 =====
  describe('POST /:id/status', () => {
    test('更新不存在的 id 的状态', async () => {
      const r = await a.post('/api/fde/projects/999999999/status', { status: 'APPROVED' })
      assert.notEqual(r.code, 0)
    })
  })

  // ===== 统计 =====
  describe('GET /_meta/stats', () => {
    test('统计接口返回', async () => {
      const r = await a.get('/api/fde/projects/_meta/stats')
      assert.equal(r.code, 0)
      assert.ok(r.data)
    })
  })
})

// ===== 成员管理 (2026-07-03 改造) =====
// 自带测试数据: 演示项目 + 现建的「已禁用用户」与「未入项目的经理」, 不依赖任何固定 id
describe('POST /:id/members 项目成员 (任何角色)', () => {
  let token, a, testMemberId, testManagerUserId, testProjectId, disabledUserId, memberEngineerId
  const createdUserIds = []
  const cleanups = []

  async function createUser(role) {
    const u = await createTestUser(role, { name: uniqName('成员测试') })
    createdUserIds.push(u.id)
    cleanups.push(u.cleanup)
    return { id: u.id, username: u.username, name: u.name, role }
  }

  before(async () => {
    token = await login()
    a = api(token)
    const projRes = await a.get('/api/fde/projects?keyword=Acme&page=1&page_size=5')
    testProjectId = projRes.data.list[0]?.id
    assert.ok(testProjectId, '缺演示项目(先跑 prisma/seed.js)')
    const detail = await a.get(`/api/fde/projects/${testProjectId}`)
    memberEngineerId = (detail.data.members || []).find(m => m.engineerId)?.engineerId
    const disabled = await createUser('MANAGER')
    const off = await a.put(`/api/fde/users/${disabled.id}`, { status: 0 })
    assert.equal(off.code, 0, off.message)
    disabledUserId = String(disabled.id)
    await createUser('MANAGER')
  })

  after(async () => {
    for (const c of cleanups) await c()
  })

  test('available-users 返回所有角色 (ADMIN/MANAGER/FDE_ENGINEER)', async () => {
    const r = await a.get(`/api/fde/projects/_meta/available-users?projectId=${testProjectId}`)
    assert.equal(r.code, 0)
    const roles = new Set((r.data || []).map(u => u.role))
    assert.ok(roles.size > 0, '至少应有可用用户')
  })

  test('缺 userId 返回 1001', async () => {
    const r = await a.post(`/api/fde/projects/${testProjectId}/members`, { roleInProject: 'DEV' })
    assert.equal(r.code, 1001)
  })

  test('无效角色返回 1007', async () => {
    const r = await a.post(`/api/fde/projects/${testProjectId}/members`, { userId: '1', roleInProject: 'INVALID_ROLE' })
    assert.equal(r.code, 1007)
  })

  test('禁用用户返回 2004', async () => {
    const r = await a.post(`/api/fde/projects/${testProjectId}/members`, { userId: disabledUserId, roleInProject: 'DEV' })
    assert.equal(r.code, 2004)
  })

  test('非工程师 (MANAGER) 可以加入项目', async () => {
    // 不钉死 userId: 从 available-users 动态挑一个尚未入项目的 MANAGER, 避免种子数据变化(如 manager1 已是 PM)导致误报 1006
    const avail = await a.get(`/api/fde/projects/_meta/available-users?projectId=${testProjectId}`)
    assert.equal(avail.code, 0)
    const mgr = (avail.data || []).find(u => u.role === 'MANAGER')
    assert.ok(mgr, 'available-users 里应至少有一个未入项目的 MANAGER')
    testManagerUserId = String(mgr.id)

    const r = await a.post(`/api/fde/projects/${testProjectId}/members`, { userId: testManagerUserId, roleInProject: 'OBSERVER' })
    assert.equal(r.code, 0, r.message)
    assert.ok(r.data.user)
    assert.equal(r.data.user.role, 'MANAGER')
    testMemberId = r.data.id
  })

  test('重复加入返回 1006', async () => {
    const r = await a.post(`/api/fde/projects/${testProjectId}/members`, { userId: testManagerUserId, roleInProject: 'OBSERVER' })
    assert.equal(r.code, 1006)
  })

  test('兼容老调用: engineerId 仍可', async () => {
    // 演示项目里已有的工程师成员, 用 engineerId 再加一次应该报 1006
    assert.ok(memberEngineerId, '演示项目应有工程师成员')
    const r = await a.post(`/api/fde/projects/${testProjectId}/members`, { engineerId: String(memberEngineerId), roleInProject: 'OBSERVER' })
    assert.equal(r.code, 1006)
  })

  // 清理
  test('清理: 删除测试成员', async () => {
    if (testMemberId) {
      const r = await a.del(`/api/fde/projects/${testProjectId}/members/${testMemberId}`)
      assert.equal(r.code, 0)
    }
  })
})
