// 单元测试 - v2.1.14 buildScopedWhere 边界行为(PR 评审改进项, 2026-09-12)
// 纯函数无 DB 依赖, node --test 可直接跑
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildScopedWhere } from '../../src/lib/scopedQuery.js'

describe('lib/scopedQuery.js', () => {
  test('常规: baseWhere 与 scope 同时保留于 AND', () => {
    const base = { id: 66, deletedAt: null }
    const scope = { id: { in: [20, 66] } }
    assert.deepEqual(buildScopedWhere(base, scope), { AND: [base, scope] })
  })

  test('scope 为 undefined → 仅 baseWhere, 不产生空元素', () => {
    const base = { id: 66, deletedAt: null }
    assert.deepEqual(buildScopedWhere(base, undefined), { AND: [base] })
    assert.deepEqual(buildScopedWhere(base, null), { AND: [base] })
  })

  test('scope 为空对象 → 保留为 AND 元素(Prisma 恒真, 语义安全)', () => {
    const base = { id: 66 }
    assert.deepEqual(buildScopedWhere(base, {}), { AND: [{ id: 66 }, {}] })
  })

  test('冲突键回归(串项目根因): 双方都有 id 时禁止 spread 覆盖, 必须求交', () => {
    // 修复前: { id: 66, ...{ id: { in: [20] } } } → { id: { in: [20] } }, URL id 66 被静默吞掉
    // 修复后: 两个 id 同时在 AND 内, 数据库取交集, 访问不可见项目 66 命中 0 条
    const w = buildScopedWhere({ id: 66, deletedAt: null }, { id: { in: [20] } })
    assert.deepEqual(w, { AND: [{ id: 66, deletedAt: null }, { id: { in: [20] } }] })
    assert.equal(w.AND.length, 2)
    assert.deepEqual(w.AND[0].id, 66, 'URL 资源 id 必须原样保留, 不被 scope 覆盖')
    assert.deepEqual(w.AND[1].id, { in: [20] }, 'scope 范围条件必须原样保留')
  })

  test('ADMIN 空范围场景: scope 为空对象 + baseWhere 含 OR 组合条件', () => {
    const base = { OR: [{ name: { contains: '星河' } }, { code: 'P66' }] }
    const w = buildScopedWhere(base, {})
    assert.deepEqual(w, { AND: [base, {}] })
    assert.equal(w.AND[0], base, 'baseWhere 引用不被拷贝/篡改')
  })

  test('多键 scope(含 deletedAt)同样完整保留', () => {
    const w = buildScopedWhere({ id: 66 }, { id: { in: [66] }, deletedAt: null, ownerId: 8 })
    assert.deepEqual(w.AND[1], { id: { in: [66] }, deletedAt: null, ownerId: 8 })
  })
})
