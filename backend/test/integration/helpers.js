// 集成测试 helper
// 用 fetch 直接打跑着的后端。后端要开开发登录(backend/.env: DEV_LOGIN=true, 非生产)
// 地址: TEST_API_BASE > backend/.env 的 PORT > 3005。换端口验证新代码时一定要设 TEST_API_BASE,
// 否则会打到旧服务上, 一堆断言失败看着像功能坏了(打到没有该接口的服务会直接报"端口指错了")
// 测试数据用 'unit-test-' 前缀，最后清理
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  if (['FDE_ENGINEER', 'TEAM_LEAD', 'MANAGER'].includes(role)) await prisma.engineer.create({ data: { userId: user.id, available: 1 } })
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
  // 带上 pid: 各测试文件是并行的子进程, 计数器各自从 0 起, 同一毫秒会撞名(用户名唯一约束)
  return `${TAG}${prefix}-${Date.now()}-${process.pid}-${++counter}`
}

/**
 * 等待 helper
 */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 跨测试文件的互斥锁(各测试文件是并行的子进程)。给改全局设置的用例用, 比如 OKR 免提交名单
 * (okr.exemptUserIds): 一个文件读「原值」、另一个文件同时改, 断言就会互相踩。
 * mkdir 原子建锁目录; 超过 staleMs 没释放的锁(进程崩了)视为过期。返回 release()
 */
export async function acquireTestLock(name, { timeoutMs = 60000, staleMs = 120000 } = {}) {
  const dir = join(tmpdir(), `fde-test-lock-${name}`)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      mkdirSync(dir)
      return () => rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - statSync(dir).mtimeMs > staleMs) rmSync(dir, { recursive: true, force: true }) } catch {}
      if (Date.now() > deadline) throw new Error(`等测试锁 ${name} 超时(${dir})`)
      await sleep(50)
    }
  }
}

export { BASE }

// ---------- 助手 stub 探测 ----------
// 助手相关用例要靠 stub 大模型(按关键词出确定的工具调用)。后端没以 FDE_LLM_STUB=1 启动时这组用例跳过而不是失败,
// 免得「打到了演示后端」被误读成功能坏了。判定: GET /api/fde/assistant/status 的 data.stub(只有 stub 模式为 true)
export const STUB_SKIP = '需要后端以 FDE_LLM_STUB=1 启动'

/** 后端是否以 stub 大模型启动; 没启动时打一行提示 */
export async function probeStub(client, suite) {
  const st = await client.get('/api/fde/assistant/status')
  const on = st.code === 0 && st.data?.stub === true
  if (!on) {
    console.log(`ℹ [${suite}] ${BASE} 不是以 FDE_LLM_STUB=1 启动的后端，助手相关用例跳过（${STUB_SKIP}；不设 TEST_API_BASE 直接 npm test 会自动起一个）`)
  }
  return on
}

/** 只在 stub 后端上跑的用例: 否则 t.skip(STUB_SKIP)。stubOn 是取值函数(before 里才探测完) */
export function stubTest(stubOn) {
  return (name, fn) => test(name, async (t) => {
    if (!stubOn()) return t.skip(STUB_SKIP)
    return fn(t)
  })
}

/** 0.6.2: 删测试周期前顺手删它的确认 / 变更申请 / 修改记录(这三张表按 cycle_id 挂, 没有外键级联) */
export async function dropPlanTrail(cycleIds) {
  const ids = (cycleIds || []).filter(v => v != null).map(v => BigInt(String(v)))
  if (!ids.length) return
  const where = { cycleId: { in: ids } }
  await prisma.okrPlanAudit.deleteMany({ where })
  await prisma.okrPlanChange.deleteMany({ where })
  await prisma.okrPlanConfirm.deleteMany({ where })
}
