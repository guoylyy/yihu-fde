// 单元测试 - lib/auth.js JWT 签发/校验
// P0: 鉴权是平台最关键路径
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

// 在 import auth 之前设好 env
process.env.JWT_SECRET = 'test-secret-for-unit-tests'
process.env.JWT_EXPIRES_IN = '7d'

const { signToken, verifyToken } = await import('../../src/lib/auth.js')

describe('lib/auth.js - JWT', () => {
  test('signToken 签发合法 token', () => {
    const token = signToken({ id: 1, type: 'internal' })
    assert.ok(typeof token === 'string')
    assert.ok(token.split('.').length === 3, 'JWT 应该有 3 段')
  })

  test('verifyToken 验证合法 token', () => {
    const payload = { id: 42, type: 'internal', role: 'ADMIN' }
    const token = signToken(payload)
    const decoded = verifyToken(token)
    assert.ok(decoded, '应该返回 decoded')
    assert.equal(decoded.id, 42)
    assert.equal(decoded.type, 'internal')
    assert.equal(decoded.role, 'ADMIN')
  })

  test('verifyToken 拒绝伪造 token', () => {
    const fake = 'eyJhbGciOiJIUzI1NiJ9.fake.signature'
    const decoded = verifyToken(fake)
    assert.equal(decoded, null)
  })

  test('verifyToken 拒绝篡改的 payload', () => {
    const token = signToken({ id: 1, type: 'internal' })
    const parts = token.split('.')
    parts[1] = Buffer.from(JSON.stringify({ id: 999, type: 'admin' })).toString('base64url')
    const tampered = parts.join('.')
    const decoded = verifyToken(tampered)
    assert.equal(decoded, null)
  })

  test('verifyToken 拒绝空字符串/null/undefined', () => {
    assert.equal(verifyToken(''), null)
    assert.equal(verifyToken(null), null)
    assert.equal(verifyToken(undefined), null)
  })

  test('签发的 token 包含 type 字段，区分 internal/customer', () => {
    const internal = signToken({ id: 1, type: 'internal' })
    const customer = signToken({ id: 2, type: 'customer' })
    const decodedI = verifyToken(internal)
    const decodedC = verifyToken(customer)
    assert.equal(decodedI.type, 'internal')
    assert.equal(decodedC.type, 'customer')
  })

  test('token 包含 iat/exp 时间戳', () => {
    const token = signToken({ id: 1, type: 'internal' })
    const decoded = verifyToken(token)
    assert.ok(decoded.iat, '应该包含 iat')
    assert.ok(decoded.exp, '应该包含 exp')
    assert.ok(decoded.exp > decoded.iat, 'exp 应该 > iat')
  })
})
