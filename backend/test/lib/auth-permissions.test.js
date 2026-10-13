// 单元测试 - lib/auth.js 权限中间件 + 工具函数
// P0: 权限是平台最关键路径（4 阶段权限）
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

process.env.JWT_SECRET = 'test-secret'
process.env.JWT_EXPIRES_IN = '7d'

const {
  signToken, verifyToken,
  requireRole, requirePermission, hasPermission,
  canAccessRecord, hasRole, internalAuth, PERMISSIONS
} = await import('../../src/lib/auth.js')

// helper: 构造一个 mock req/res/next
function mockReqRes(user = null) {
  const req = { user, headers: {} }
  const res = {
    statusCode: 200,
    _json: null,
    status(c) { this.statusCode = c; return this },
    json(data) { this._json = data; return this }
  }
  // 用 .fn 作 next 回调，用 .called 标记
  const nextMock = { called: false, fn: () => { nextMock.called = true } }
  return { req, res, next: nextMock }
}

describe('lib/auth.js - 角色/权限', () => {

  // ===== requireRole =====
  describe('requireRole 中间件', () => {
    test('允许的角色通过', () => {
      const mw = requireRole('ADMIN', 'MANAGER')
      const { req, res, next } = mockReqRes({ id: 1, role: 'ADMIN' })
      mw(req, res, next.fn)
      assert.equal(next.called, true)
    })

    test('不允许的角色返回 403', () => {
      const mw = requireRole('ADMIN')
      const { req, res, next } = mockReqRes({ id: 1, role: 'FDE_ENGINEER' })
      mw(req, res, next.fn)
      assert.equal(next.called, false)
      assert.equal(res.statusCode, 403)
      assert.equal(res._json.code, 1003)
    })

    test('未登录返回 401', () => {
      const mw = requireRole('ADMIN')
      const { req, res, next } = mockReqRes(null)
      mw(req, res, next.fn)
      assert.equal(res.statusCode, 401)
      assert.equal(next.called, false)
    })

    test('兼容 userId 和 id 字段（自动补全）', () => {
      const mw = requireRole('ADMIN')
      const { req, res, next } = mockReqRes({ userId: 42, role: 'ADMIN' })
      mw(req, res, next.fn)
      assert.equal(req.user.id, 42, 'id 应从 userId 补全')
      assert.equal(next.called, true)
    })
  })

  // ===== requirePermission =====
  describe('requirePermission 中间件', () => {
    test('合法权限字符串返回中间件', () => {
      const mw = requirePermission('user.create')
      assert.equal(typeof mw, 'function')
    })

    test('未知权限抛错', () => {
      assert.throws(() => requirePermission('nonexistent.perm'), /Unknown permission/)
    })

    test('admin 拥有所有 user.* 权限', () => {
      const { req, res, next } = mockReqRes({ id: 1, role: 'ADMIN' })
      requirePermission('user.create')(req, res, next.fn)
      assert.equal(next.called, true)
    })

    test('FDE_ENGINEER 没有 user.create 权限', () => {
      const { req, res, next } = mockReqRes({ id: 1, role: 'FDE_ENGINEER' })
      requirePermission('user.create')(req, res, next.fn)
      assert.equal(res.statusCode, 403)
    })
  })

  // ===== hasPermission =====
  describe('hasPermission 工具函数', () => {
    test('null user 返回 false', () => {
      assert.equal(hasPermission(null, 'user.create'), false)
    })

    test('未知权限返回 false', () => {
      assert.equal(hasPermission({ role: 'ADMIN' }, 'foo.bar'), false)
    })

    test('正确判断角色是否拥有权限', () => {
      assert.equal(hasPermission({ role: 'ADMIN' }, 'user.create'), true)
      assert.equal(hasPermission({ role: 'FDE_ENGINEER' }, 'user.create'), false)
      assert.equal(hasPermission({ role: 'FDE_ENGINEER' }, 'timesheet.create'), true)
      assert.equal(hasPermission({ role: 'SALES' }, 'timesheet.approve'), false)
    })
  })

  // ===== hasRole =====
  describe('hasRole 工具函数', () => {
    test('null user 返回 falsy', () => {
      assert.ok(!hasRole(null, 'ADMIN'))
    })

    test('匹配任一角色返回 true', () => {
      assert.equal(hasRole({ role: 'MANAGER' }, 'ADMIN', 'MANAGER', 'FDE'), true)
    })

    test('都不匹配返回 false', () => {
      assert.equal(hasRole({ role: 'SALES' }, 'ADMIN', 'MANAGER'), false)
    })
  })

  // ===== canAccessRecord =====
  describe('canAccessRecord 数据级权限', () => {
    test('null user/record 返回 false', () => {
      assert.equal(canAccessRecord(null, 'project', { id: 1 }), false)
      assert.equal(canAccessRecord({ id: 1 }, 'project', null), false)
    })

    test('ADMIN 可访问所有', () => {
      assert.equal(canAccessRecord({ id: 1, role: 'ADMIN' }, 'project', { managerId: 999n }), true)
    })

    test('PLATFORM 可访问所有', () => {
      assert.equal(canAccessRecord({ id: 1, role: 'PLATFORM' }, 'project', { managerId: 999n }), true)
    })

    test('MANAGER 只能访问自己负责的项目', () => {
      const mgr = { id: 5, role: 'MANAGER' }
      assert.equal(canAccessRecord(mgr, 'project', { managerId: 5n }), true)
      assert.equal(canAccessRecord(mgr, 'project', { managerId: 6n }), false)
    })


    test('FDE_ENGINEER 默认可访问（项目成员检查在别处）', () => {
      const fde = { id: 3, role: 'FDE_ENGINEER' }
      assert.equal(canAccessRecord(fde, 'project', { managerId: 999n }), true)
    })
  })

  // ===== internalAuth =====
  describe('鉴权中间件', () => {
    test('internalAuth 缺 header 返回 401', () => {
      const { req, res, next } = mockReqRes()
      internalAuth(req, res, next.fn)
      assert.equal(res.statusCode, 401)
      assert.equal(next.called, false)
    })

    test('internalAuth type 错误返回 401', () => {
      const token = signToken({ id: 1, type: 'customer' })
      const { req, res, next } = mockReqRes()
      req.headers.authorization = 'Bearer ' + token
      internalAuth(req, res, next.fn)
      assert.equal(res.statusCode, 401)
    })

    test('internalAuth 合法 token 通过', () => {
      const token = signToken({ id: 1, type: 'internal', role: 'ADMIN' })
      const { req, res, next } = mockReqRes()
      req.headers.authorization = 'Bearer ' + token
      internalAuth(req, res, next.fn)
      assert.equal(next.called, true)
      assert.equal(req.user.role, 'ADMIN')
    })

  })

  // ===== PERMISSIONS 矩阵完整性 =====
  describe('PERMISSIONS 矩阵', () => {
    test('所有权限 key 至少有一个角色', () => {
      for (const [perm, roles] of Object.entries(PERMISSIONS)) {
        assert.ok(Array.isArray(roles), `${perm} 应是角色数组`)
        assert.ok(roles.length > 0, `${perm} 至少 1 个角色`)
      }
    })

    test('所有角色都是合法角色', () => {
      // v1.2.5 加入 FINANCE 角色, 此名单当时漏更新, 基线一直红着; v1.5.4 补齐
      const VALID = ['ADMIN', 'PLATFORM', 'MANAGER', 'FDE_ENGINEER', 'SALES', 'FINANCE']
      for (const [perm, roles] of Object.entries(PERMISSIONS)) {
        for (const r of roles) {
          assert.ok(VALID.includes(r), `${perm} 含未知角色: ${r}`)
        }
      }
    })
  })
})
