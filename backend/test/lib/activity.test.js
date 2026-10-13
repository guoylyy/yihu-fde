// 单元测试 - lib/activity.js 活动流记录
// 注：prisma 在导入时已连真实数据库，所以这里测的是"实际工作"而不是"失败降级"
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

let recordActivity
const cleanupIds = []

try {
  const mod = await import('../../src/lib/activity.js')
  recordActivity = mod.recordActivity
} catch (e) {
  console.error('❌ import activity.js 失败:', e.message)
}

describe('lib/activity.js - 活动流记录', () => {

  test('recordActivity 函数存在', () => {
    assert.equal(typeof recordActivity, 'function', 'recordActivity 应是函数')
  })

  test('recordActivity 函数签名包含 5 个必填参数', () => {
    const sig = recordActivity.toString()
    assert.match(sig, /actorId/)
    assert.match(sig, /entity/)
    assert.match(sig, /entityId/)
    assert.match(sig, /action/)
    assert.match(sig, /summary/)
  })

  test('recordActivity 成功创建活动', async () => {
    const r = await recordActivity({
      actorId: 1n, entity: 'test_unit', entityId: 999999n, action: 'created', summary: 'unit test'
    })
    assert.ok(r, '应返回创建的对象')
    assert.equal(r.entity, 'test_unit')
    assert.equal(r.action, 'created')
    assert.equal(r.summary, 'unit test')
    if (r?.id) cleanupIds.push(r.id)
  })

  test('recordActivity 接受 null actorId（系统操作）', async () => {
    const r = await recordActivity({
      actorId: null, entity: 'test_unit', entityId: 999999n, action: 'system_op', summary: '系统操作'
    })
    assert.ok(r, 'null actorId 也应成功')
    assert.equal(r.actorId, null)
    if (r?.id) cleanupIds.push(r.id)
  })

  test('recordActivity data 字段可以是 object', async () => {
    const r = await recordActivity({
      actorId: 1n, entity: 'test_unit', entityId: 999999n, action: 'updated', summary: 'data test',
      data: { key: 'value', count: 42 }
    })
    assert.ok(r)
    // data 应被 JSON.stringify
    assert.equal(typeof r.data, 'string')
    assert.ok(r.data.includes('key'))
    if (r?.id) cleanupIds.push(r.id)
  })

  test('recordActivity 接受 number 类型的 actorId（自动转 BigInt）', async () => {
    const r = await recordActivity({
      actorId: 1, entity: 'test_unit', entityId: 999999n, action: 'test_num', summary: 'num actor'
    })
    assert.ok(r)
    // BigInt 转换后应该等于 1n
    assert.equal(String(r.actorId), '1')
    if (r?.id) cleanupIds.push(r.id)
  })

  // cleanup
  after(async () => {
    if (cleanupIds.length) {
      const { default: prisma } = await import('../../src/lib/prisma.js')
      for (const id of cleanupIds) {
        try {
          await prisma.activity.delete({ where: { id } })
        } catch (e) {
          // ignore
        }
      }
      await prisma.$disconnect()
    }
  })
})
