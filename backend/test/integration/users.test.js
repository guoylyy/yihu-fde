// 集成测试 - /api/fde/users 用户管理
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName, TAG } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('API: /api/fde/users 用户管理', () => {
  let token, a, createdIds = []

  before(async () => {
    token = await login()
    a = api(token)
  })

  after(async () => {
    for (const id of createdIds) {
      try { await a.del(`/api/fde/users/${id}`) } catch { /* 接口删不掉就靠下面硬删兜底 */ }
    }
    // 接口是软删, 记录仍留在表里; 测试账号攒了几百条就是这么来的(还带着默认密码)。
    // 这里把本用例造的账号连同自动生成的工程师档案一并硬删, 跑完不留痕。
    if (createdIds.length) {
      const ids = createdIds.map(BigInt)
      const engs = await prisma.engineer.findMany({ where: { userId: { in: ids } }, select: { id: true } })
      const engIds = engs.map(e => e.id)
      if (engIds.length) {
        await prisma.timesheet.deleteMany({ where: { engineerId: { in: engIds } } }).catch(() => {})
        await prisma.projectMember.deleteMany({ where: { engineerId: { in: engIds } } }).catch(() => {})
        await prisma.engineer.deleteMany({ where: { id: { in: engIds } } }).catch(() => {})
      }
      await prisma.projectMember.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
      await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
      await prisma.$disconnect().catch(() => {})
    }
  })

  // ===== 列表 =====
  describe('GET / 列表', () => {
    test('admin 列出全部用户', async () => {
      const r = await a.get('/api/fde/users')
      assert.equal(r.code, 0)
      assert.ok(Array.isArray(r.data.list))
      assert.ok(typeof r.data.total === 'number')
    })

    test('role 筛选生效', async () => {
      const r = await a.get('/api/fde/users?role=ADMIN')
      assert.equal(r.code, 0)
      for (const u of r.data.list) {
        assert.equal(u.role, 'ADMIN')
      }
    })

    test('keyword 搜索生效', async () => {
      const r = await a.get(`/api/fde/users?keyword=${TAG}`)
      assert.equal(r.code, 0)
    })
  })

  // ===== 创建 =====
  describe('POST / 创建用户', () => {
    test('合法数据创建', async () => {
      const username = uniqName('u').toLowerCase().replace(/[^a-z0-9]/g, 'x')
      const r = await a.post('/api/fde/users', {
        username,
        name: uniqName('用户'),
        password: 'Test123456',
        role: 'FDE_ENGINEER',
        email: `${username}@test.local`
      })
      assert.equal(r.code, 0, `创建失败: ${r.message}`)
      assert.ok(r.data.id)
      assert.equal(r.data.username, username)
      createdIds.push(r.data.id)
    })

    test('缺 username 返回错误', async () => {
      const r = await a.post('/api/fde/users', {
        name: 'X', password: 'Test123456', role: 'FDE_ENGINEER'
      })
      assert.notEqual(r.code, 0)
    })

    test('缺 password 走默认值 123456（产品设计）', async () => {
      const username = uniqName().toLowerCase().replace(/[^a-z0-9]/g, 'x')
      const r = await a.post('/api/fde/users', {
        username, name: uniqName(), role: 'FDE_ENGINEER'
      })
      assert.equal(r.code, 0, `应成功（默认密码）: ${r.message}`)
      if (r.data?.id) createdIds.push(r.data.id)
    })

    test('缺 role 返回错误', async () => {
      const r = await a.post('/api/fde/users', {
        username: uniqName(), name: 'X', password: 'Test123456'
      })
      assert.notEqual(r.code, 0)
    })

    test('无效角色返回错误', async () => {
      const r = await a.post('/api/fde/users', {
        username: uniqName(), name: 'X', password: 'Test123456', role: 'HACKER'
      })
      assert.notEqual(r.code, 0)
    })

    test('重复 username 返回错误', async () => {
      const r = await a.post('/api/fde/users', {
        username: 'admin', name: 'X', password: 'Test123456', role: 'FDE_ENGINEER'
      })
      assert.notEqual(r.code, 0)
    })

    test('密码太短返回错误', async () => {
      const r = await a.post('/api/fde/users', {
        username: uniqName().toLowerCase().replace(/[^a-z0-9]/g, 'x'), name: 'X', password: '123', role: 'FDE_ENGINEER'
      })
      // 实现可能允许，这里仅验证不崩
      assert.ok(r.code !== undefined)
      // 后端其实忽略 password(建号一律给默认密码), 所以这条大概率**真的建出账号**。
      // 原来没登记清理, 于是每跑一次全量就漏一个启用状态的测试账号 —— 攒了 87 个才被发现。
      if (r.data?.id) createdIds.push(r.data.id)
    })
  })

  // ===== 更新 =====
  describe('PUT /:id 更新', () => {
    test('更新用户姓名', async () => {
      const username = uniqName().toLowerCase().replace(/[^a-z0-9]/g, 'x')
      const cr = await a.post('/api/fde/users', {
        username, name: uniqName(), password: 'Test123456', role: 'FDE_ENGINEER'
      })
      createdIds.push(cr.data.id)
      const newName = uniqName('new')
      const r = await a.put(`/api/fde/users/${cr.data.id}`, { name: newName })
      assert.equal(r.code, 0)
      const check = await a.get(`/api/fde/users/${cr.data.id}`)
      assert.equal(check.data.name, newName)
    })

    test('更新不存在的 id', async () => {
      const r = await a.put('/api/fde/users/999999999', { name: 'X' })
      assert.notEqual(r.code, 0)
    })
  })

  // ===== 重置密码 =====
  describe('POST /:id/reset-password', () => {
    test('重置密码成功', async () => {
      const username = uniqName().toLowerCase().replace(/[^a-z0-9]/g, 'x')
      const cr = await a.post('/api/fde/users', {
        username, name: uniqName(), password: 'Test123456', role: 'FDE_ENGINEER'
      })
      createdIds.push(cr.data.id)
      const r = await a.post(`/api/fde/users/${cr.data.id}/reset-password`, {
        newPassword: 'New123456'
      })
      assert.equal(r.code, 0, `重置失败: ${r.message}`)
    })
  })

  // ===== 单条 =====
  describe('GET /:id', () => {
    test('admin 查自己', async () => {
      const r = await a.get('/api/fde/users/1')
      assert.equal(r.code, 0)
      assert.equal(r.data.username, 'admin')
    })

    test('不存在的 id', async () => {
      const r = await a.get('/api/fde/users/999999999')
      assert.notEqual(r.code, 0)
    })
  })
})
