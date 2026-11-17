// 集成测试 helper
// 用 fetch 直接打跑着的后端。后端要开开发登录(backend/.env: DEV_LOGIN=true, 非生产)
// 地址: TEST_API_BASE > backend/.env 的 PORT > 3005。换端口验证新代码时一定要设 TEST_API_BASE,
// 否则会打到旧服务上, 一堆断言失败看着像功能坏了(打到没有该接口的服务会直接报"端口指错了")
// 测试数据用 'unit-test-' 前缀，最后清理
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import prisma from '../../src/lib/prisma.js'

function portFromDotenv() {
  try {
    const text = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    const m = text.match(/^\s*PORT\s*=\s*["']?(\d+)["']?\s*$/m)
    return m ? m[1] : null
  } catch { return null }
}

const BASE = (process.env.TEST_API_BASE || `http://localhost:${portFromDotenv() || 3005}`).replace(/\/+$/, '')

/**
 * 打到的服务上根本没有这个接口(而不是业务上的 404): 八成是端口指错了, 打到了旧版本的服务。
 * 认两种响应体: {"message":"接口不存在"} 和 Express 默认的 "Cannot GET /api/..."。
 * 业务 404 都带 code(如 4041/1001), 不会误判。
 */
export function assertRouteExists(status, data, path) {
  if (status !== 404) return
  const missing = (data && typeof data === 'object' && data.code === undefined && data.message === '接口不存在') ||
    (typeof data === 'string' && /<pre>Cannot [A-Z]+ \//.test(data))
  if (missing) {
    throw new Error(`你现在打的是 ${BASE}，这个服务上没有 ${path.split('?')[0]} 接口，八成是端口指错了（用 TEST_API_BASE 指定）`)
  }
}

/**
 * 登录获取 token(开发登录: 只认用户名, 线上没有这个接口)
 */
export async function login(username = 'admin') {
  const r = await fetch(`${BASE}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  })
  const text = await r.text()
  let d
  try { d = JSON.parse(text) } catch { d = text }
  assertRouteExists(r.status, d, '/api/auth/dev-login')
  d = d && typeof d === 'object' ? d : {}
  assert.equal(d.code, 0, `登录失败(后端要开 DEV_LOGIN=true): ${d.message || r.status}`)
  return d.data.token
}

/**
 * 现建一个本地账号并登录(账号平时由以虎 One 登录开通, 测试里直接写库)。
 * 返回 { id, username, token, cleanup }; cleanup 硬删账号及工程师档案、成员关系、通知
 */
export async function createTestUser(role = 'FDE_ENGINEER', { name } = {}) {
  const username = uniqName('u').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40)
  const user = await prisma.user.create({
    data: { username, name: (name || uniqName('测试用户')).slice(0, 50), role, roleSource: 'MANUAL', status: 1, email: `${username}@test.local` }
  })
  if (['FDE_ENGINEER', 'MANAGER'].includes(role)) await prisma.engineer.create({ data: { userId: user.id, available: 1 } })
  const token = await login(username)
  return {
    id: String(user.id),
    username,
    name: user.name,
    token,
    async cleanup() {
      const uid = user.id
      await prisma.projectMember.deleteMany({ where: { userId: uid } }).catch(() => {})
      const eng = await prisma.engineer.findUnique({ where: { userId: uid }, select: { id: true } }).catch(() => null)
      if (eng) {
        await prisma.projectMember.deleteMany({ where: { engineerId: eng.id } }).catch(() => {})
        await prisma.engineer.delete({ where: { id: eng.id } }).catch(() => {})
      }
      await prisma.notification.deleteMany({ where: { userId: uid } }).catch(() => {})
      await prisma.user.delete({ where: { id: uid } }).catch(() => {})
    }
  }
}

/**
 * 构造带 Authorization header 的 fetch wrapper
 */
export function api(token) {
  return {
    get: (path, opts) => request('GET', path, null, token, opts),
    post: (path, body, opts) => request('POST', path, body, token, opts),
    put: (path, body, opts) => request('PUT', path, body, token, opts),
    patch: (path, body, opts) => request('PATCH', path, body, token, opts),
    del: (path, opts) => request('DELETE', path, null, token, opts)
  }
}

/**
 * opts.allowMissingRoute: 用例本来就在验证"这个接口已经没了"时传 true, 不做端口指错的检查
 */
export async function request(method, path, body, token, opts = {}) {
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
  if (!opts.allowMissingRoute) assertRouteExists(r.status, data, path)
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
