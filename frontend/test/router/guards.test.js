// 单元测试 - 路由守卫
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRequiresInternalAuth,
  collectRequiredRoles,
  resolveGuard,
  isPlatformPublicPath,
  shouldRedirectToLogin
} from '../../src/router/guards.js'

describe('router/guards.js - 路由守卫', () => {

  // ===== v2.11.0(#1181) 没有官网前台的实例 =====
  describe('没有官网前台时哪些地址转去登录', () => {
    test('使用文档与工程师邀请页是生产系统自己的公开页', () => {
      for (const p of ['/docs', '/docs/mcp']) assert.equal(isPlatformPublicPath(p), true, p)
      for (const p of ['/', '/cases', '/join', '/documents', '/in', '/i/abc123', '/portal/login']) assert.equal(isPlatformPublicPath(p), false, p)
    })
    test('有官网时什么都不拦', () => {
      for (const p of ['/', '/cases', '/docs', '/admin/workbench']) assert.equal(shouldRedirectToLogin(p, true), false, p)
    })
    test('没有官网时: 官网页转登录, 文档/邀请/后台/门户照常', () => {
      for (const p of ['/', '/cases/x', '/blog', '/join', '/login', '/orders', '/i/tok', '/portal/login']) assert.equal(shouldRedirectToLogin(p, false), true, p)
      for (const p of ['/docs/mcp', '/admin/login', '/admin/ideas']) assert.equal(shouldRedirectToLogin(p, false), false, p)
    })
  })

  // ===== isRequiresInternalAuth =====
  describe('isRequiresInternalAuth', () => {
    test('matched 含 requiresInternalAuth', () => {
      const matched = [{ meta: { requiresInternalAuth: true } }]
      assert.equal(isRequiresInternalAuth(matched), true)
    })
    test('matched 不含 requiresInternalAuth', () => {
      const matched = [{ meta: {} }]
      assert.equal(isRequiresInternalAuth(matched), false)
    })
    test('空 matched', () => {
      assert.equal(isRequiresInternalAuth([]), false)
    })
  })

  // ===== collectRequiredRoles =====
  describe('collectRequiredRoles', () => {
    test('空 matched 返回空数组', () => {
      assert.deepEqual(collectRequiredRoles([]), [])
    })
    test('单层 requiredRoles', () => {
      const matched = [{ meta: { requiredRoles: ['ADMIN', 'PLATFORM'] } }]
      assert.deepEqual(collectRequiredRoles(matched), ['ADMIN', 'PLATFORM'])
    })
    test('多层嵌套 requiredRoles（父子路由）', () => {
      const matched = [
        { meta: { requiredRoles: ['ADMIN', 'PLATFORM', 'MANAGER', 'SALES'] } },  // 父
        { meta: { requiredRoles: ['ADMIN'] } }                                     // 子
      ]
      // 当前实现是 flat 合并（不去重）
      const r = collectRequiredRoles(matched)
      assert.ok(r.includes('ADMIN'))
      assert.ok(r.includes('PLATFORM'))
      assert.ok(r.includes('MANAGER'))
      assert.ok(r.includes('SALES'))
    })
    test('无 requiredRoles', () => {
      const matched = [{ meta: {} }, { meta: { requiresInternalAuth: true } }]
      assert.deepEqual(collectRequiredRoles(matched), [])
    })
  })

  // ===== resolveGuard =====
  describe('resolveGuard 决策', () => {
    // 公共路由
    const publicMatched = [{ meta: {} }]

    // 内部鉴权路由
    const internalMatched = [
      { meta: { requiresInternalAuth: true, requiredRoles: ['ADMIN', 'PLATFORM', 'MANAGER', 'SALES'] } },
      { meta: { requiredRoles: ['ADMIN'] } }  // 子路由
    ]
    const internalAnyRole = [
      { meta: { requiresInternalAuth: true } }
    ]

    // 公共路由
    test('公共路由：任何人都能进', () => {
      assert.equal(resolveGuard(publicMatched, {}), true)
      assert.equal(resolveGuard(publicMatched, { internalToken: 'x' }), true)
    })

    // 内部鉴权
    test('内部鉴权：无 token 跳 AdminLogin', () => {
      const r = resolveGuard(internalAnyRole, {})
      assert.equal(r.name, 'AdminLogin')
    })
    test('内部鉴权：有 token 通过', () => {
      const r = resolveGuard(internalAnyRole, { internalToken: 'tok' })
      assert.equal(r, true)
    })
    test('内部鉴权 + requiredRoles：admin 通过', () => {
      const r = resolveGuard(internalMatched, { internalToken: 'tok', role: 'ADMIN' })
      assert.equal(r, true)
    })
    test('内部鉴权 + requiredRoles：PLATFORM 通过', () => {
      const r = resolveGuard(internalMatched, { internalToken: 'tok', role: 'PLATFORM' })
      assert.equal(r, true)
    })
    test('内部鉴权 + requiredRoles：FDE_ENGINEER 拒绝', () => {
      const r = resolveGuard(internalMatched, { internalToken: 'tok', role: 'FDE_ENGINEER' })
      assert.equal(r.name, 'AdminWorkbench', 'FDE 应被弹回个人工作台')
    })
    test('内部鉴权 + requiredRoles：无 role 也通过（降级）', () => {
      // 注：当前实现只检查 role 存在且不在白名单时才拦截
      // role 为 undefined 时不拦截（设计：用户信息缺失就放行让页面兜底）
      const r = resolveGuard(internalMatched, { internalToken: 'tok' })
      assert.equal(r, true)
    })

    // ===== v1.3.0: requiredPerm 权限点校验 =====
    const permMatched = [
      { meta: { requiresInternalAuth: true } },
      { meta: { requiredPerm: 'project.view', requiredRoles: ['ADMIN'] } }
    ]
    test('requiredPerm + canFn 通过时放行（忽略 requiredRoles）', () => {
      const r = resolveGuard(permMatched, { internalToken: 'tok', role: 'FDE_ENGINEER' }, () => true)
      assert.equal(r, true)
    })
    test('requiredPerm + canFn 拒绝时弹回个人工作台（即使角色在白名单）', () => {
      const r = resolveGuard(permMatched, { internalToken: 'tok', role: 'ADMIN' }, () => false)
      assert.equal(r.name, 'AdminWorkbench')
    })
    test('requiredPerm 但未传 canFn：回退 requiredRoles', () => {
      const r = resolveGuard(permMatched, { internalToken: 'tok', role: 'SALES' })
      assert.equal(r.name, 'AdminWorkbench')
      const r2 = resolveGuard(permMatched, { internalToken: 'tok', role: 'ADMIN' })
      assert.equal(r2, true)
    })
    test('多层 requiredPerm 需全部通过', () => {
      const matched = [
        { meta: { requiresInternalAuth: true, requiredPerm: 'a' } },
        { meta: { requiredPerm: 'b' } }
      ]
      const r = resolveGuard(matched, { internalToken: 'tok' }, p => p === 'a')
      assert.equal(r.name, 'AdminWorkbench')
    })

  })
})
