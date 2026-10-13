// 集成测试 helper
// 用 fetch 直接打跑着的 yihu-backend (localhost:3005)
// 测试数据用 'unit-test-' 前缀，最后清理
import assert from 'node:assert/strict'

const BASE = process.env.TEST_API_BASE || 'http://localhost:3005'
export const ADMIN_PWD = process.env.TEST_ADMIN_PASSWORD || '123456'

/**
 * 登录获取 token
 */
export async function login(username = 'admin', password = ADMIN_PWD) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const d = await r.json()
  assert.equal(d.code, 0, `登录失败: ${d.message}`)
  return d.data.token
}

/**
 * 构造带 Authorization header 的 fetch wrapper
 */
export function api(token) {
  return {
    get: (path) => request('GET', path, null, token),
    post: (path, body) => request('POST', path, body, token),
    put: (path, body) => request('PUT', path, body, token),
    patch: (path, body) => request('PATCH', path, body, token),
    del: (path) => request('DELETE', path, null, token)
  }
}

export async function request(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, code: data?.code, message: data?.message, data: data?.data, raw: data }
}

/**
 * 测试数据生成器（带可识别前缀）
 */
export const TAG = 'unit-test-'
let counter = 0
export function uniqName(prefix = 'item') {
  return `${TAG}${prefix}-${Date.now()}-${++counter}`
}

/**
 * 等待 helper
 */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export { BASE }
