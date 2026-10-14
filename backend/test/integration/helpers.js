// 集成测试 helper
// 用 fetch 直接打跑着的后端 (localhost:3005)。后端要开开发登录(backend/.env: DEV_LOGIN=true, 非生产)
// 测试数据用 'unit-test-' 前缀，最后清理
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'

const BASE = process.env.TEST_API_BASE || 'http://localhost:3005'

/**
 * 登录获取 token(开发登录: 只认用户名, 线上没有这个接口)
 */
export async function login(username = 'admin') {
  const r = await fetch(`${BASE}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  })
  const d = await r.json().catch(() => ({}))
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
