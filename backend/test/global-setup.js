// npm test 的全局 setup(node --test-global-setup): 集成测试默认自己起一个后端, 裸跑不依赖任何外部进程或会话里 export 的变量。
//
// 以前集成测试打 backend/.env 的 PORT(3005), 那是演示 / 开发在用的后端: 代码可能是旧的、也没开 FDE_LLM_STUB,
// 结果 assistant 套件整组 cancelled、新接口全挂, 看着像功能坏了。现在:
//   - 设了 TEST_API_BASE: 照旧打那个地址, 本文件什么都不做(想验证某个已起好的服务时用)
//   - 没设: 用当前工作树的代码在随机空闲端口起 `node src/index.js`(FDE_LLM_STUB=1、关定时任务、放宽限流),
//     等 /health 通了再把 TEST_API_BASE 交给各测试文件, 跑完杀掉
// 数据库仍读 backend/.env 的 DATABASE_URL; 只认本机库(localhost / 127.0.0.1 / ::1), 生产环境直接拒绝, 防止误连生产库。
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import dotenv from 'dotenv'

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const READY_TIMEOUT_MS = 60_000
let child = null

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** 当前生效的 DATABASE_URL: 已有环境变量优先, 否则读 backend/.env(与 src/lib/prisma.js 的 dotenv 行为一致) */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try { return dotenv.parse(readFileSync(path.join(BACKEND_DIR, '.env'))).DATABASE_URL || '' } catch { return '' }
}

function assertSafeDatabase() {
  if (process.env.NODE_ENV === 'production') throw new Error('[test] NODE_ENV=production 下拒绝跑集成测试')
  const url = databaseUrl()
  if (!url) throw new Error('[test] 找不到 DATABASE_URL(backend/.env 或环境变量), 集成测试需要一个本机测试库')
  let host
  try { host = new URL(url).hostname } catch { throw new Error('[test] DATABASE_URL 不是合法 URL') }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`[test] DATABASE_URL 指向 ${host}, 不是本机库; 集成测试会建删数据, 拒绝自动起后端(确实要打远端请自行设 TEST_API_BASE)`)
  }
}

async function waitReady(base, logs) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`[test] 测试后端启动即退出(code ${child.exitCode}):\n${logs.join('').slice(-2000)}`)
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) return
    } catch { /* 还没 listen */ }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`[test] 测试后端 ${READY_TIMEOUT_MS / 1000}s 内没起来:\n${logs.join('').slice(-2000)}`)
}

export async function globalSetup() {
  if (process.env.TEST_API_BASE) return
  assertSafeDatabase()
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const logs = []
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      FDE_LLM_STUB: '1',
      ENABLE_CRON: 'false',
      RATELIMIT_RELAX: 'true',
      DEV_LOGIN: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const keep = (b) => { logs.push(b.toString()); if (logs.length > 200) logs.shift() }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  try {
    await waitReady(base, logs)
  } catch (e) {
    child.kill('SIGKILL')
    throw e
  }
  // 各测试文件是子进程, 继承这里的环境变量
  process.env.TEST_API_BASE = base
}

export async function globalTeardown() {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5000)
    child.once('exit', () => { clearTimeout(t); resolve() })
    child.kill('SIGTERM')
  })
}
