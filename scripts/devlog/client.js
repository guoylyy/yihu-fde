// 配置读取 + 上报: POST {baseUrl}/devlog/conversations, 失败重试 3 次(指数退避), 仍失败写进本地队列, 下次 sync / hook 先补发
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// FDE_DEVLOG_HOME 可把配置/状态/队列整体挪到别的目录(测试用), 默认是用户主目录
const home = () => process.env.FDE_DEVLOG_HOME || os.homedir()
export const paths = () => ({
  config: path.join(home(), '.fde-devlog.json'),
  state: path.join(home(), '.fde-devlog-state.json'),
  queue: path.join(home(), '.fde-devlog-queue.jsonl')
})

const RETRIES = 3
const BASE_DELAY_MS = 500
const TIMEOUT_MS = 15000
const MAX_ITEMS_PER_REQ = 50 // 后端上限 100
const MAX_BYTES_PER_REQ = 8 * 1024 * 1024 // 后端 /api/devlog 收 20mb, 留足余量

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 读配置: 命令行 > 环境变量 > ~/.fde-devlog.json。warn(msg) 收集提示, 不抛错 */
export function loadConfig(cli = {}, warn = () => {}) {
  const file = paths().config
  let conf = {}
  if (fs.existsSync(file)) {
    try {
      conf = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      warn(`配置文件 ${file} 不是合法 JSON，已忽略（${e.message}）`)
    }
    try {
      const mode = fs.statSync(file).mode & 0o777
      if (process.platform !== 'win32' && mode & 0o077) warn(`配置文件里有 API Key，权限是 ${mode.toString(8)}，建议 chmod 600 ${file}`)
    } catch { /* 忽略 */ }
  }
  const baseUrl = cli.base || process.env.FDE_DEVLOG_BASE || conf.baseUrl
  const apiKey = cli.token || process.env.FDE_DEVLOG_KEY || conf.apiKey
  const stage = (cli.stage || process.env.FDE_DEVLOG_STAGE || conf.stage || 'CODING').toUpperCase()
  if (!baseUrl) warn(`没配置 baseUrl：在 ${file} 里写 "baseUrl"，或用 --base / FDE_DEVLOG_BASE`)
  if (!apiKey) warn(`没配置 apiKey：在 ${file} 里写 "apiKey"，或用 --token / FDE_DEVLOG_KEY（本次请求不带鉴权，服务端大概率回 401）`)
  return { baseUrl: baseUrl ? normalizeBase(baseUrl) : null, apiKey: apiKey || null, stage }
}

/** http://host:3010 → http://host:3010/api; 已经以 /api 结尾的原样用 */
export function normalizeBase(u) {
  const s = String(u).trim().replace(/\/+$/, '')
  return /\/api$/.test(s) ? s : `${s}/api`
}

/** 按条数与体积切批 */
function chunks(list) {
  const out = []
  let cur = []
  let bytes = 0
  for (const c of list) {
    const n = Buffer.byteLength(JSON.stringify(c))
    if (cur.length && (cur.length >= MAX_ITEMS_PER_REQ || bytes + n > MAX_BYTES_PER_REQ)) { out.push(cur); cur = []; bytes = 0 }
    cur.push(c)
    bytes += n
  }
  if (cur.length) out.push(cur)
  return out
}

class SendError extends Error {
  constructor(message, { retryable, queueable, status } = {}) {
    super(message)
    this.retryable = retryable
    this.queueable = queueable
    this.status = status
  }
}

async function postOnce(conf, batch) {
  const timeoutMs = conf.timeoutMs || TIMEOUT_MS
  const url = `${conf.baseUrl}/devlog/conversations`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(conf.apiKey ? { authorization: `Bearer ${conf.apiKey}` } : {}) },
      body: JSON.stringify({ conversations: batch }),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? `超时（${timeoutMs / 1000}s）` : e?.cause?.code || e?.cause?.message || e.message
    throw new SendError(`连不上 ${url}：${why}`, { retryable: true, queueable: true })
  }
  let json = null
  const text = await res.text()
  try { json = JSON.parse(text) } catch { /* 非 JSON(网关错误页等) */ }
  if (res.ok && json && json.code === 0) return json.data
  const msg = json?.message || text.replace(/\s+/g, ' ').slice(0, 200) || res.statusText
  const status = res.status
  // 5xx / 429 / 网关: 重试; 401/403: 不重试但入队(修好 Key 后补发); 其余 4xx 是数据问题, 入队也没用
  throw new SendError(`HTTP ${status}：${msg}`, {
    status,
    retryable: status >= 500 || status === 429,
    queueable: status >= 500 || status === 429 || status === 401 || status === 403 || status === 404
  })
}

/** 一批: 首发 + 最多重试 3 次, 间隔 0.5s / 1s / 2s */
async function postWithRetry(conf, batch, log, retries = RETRIES) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) {
      const wait = BASE_DELAY_MS * 2 ** (attempt - 1)
      log(`  第 ${attempt} 次重试（${wait}ms 后）…`)
      await sleep(wait)
    }
    try {
      return await postOnce(conf, batch)
    } catch (e) {
      lastErr = e
      if (!e.retryable) break
    }
  }
  throw lastErr
}

/**
 * 上报一组会话。不抛错, 返回汇总:
 * { created, updated, items:[{uid,id,created}], errors:[{uid,message}], queued, failed:[message] }
 */
export async function send(conf, conversations, { log = () => {}, queueOnFail = true, retries = RETRIES } = {}) {
  const sum = { created: 0, updated: 0, items: [], errors: [], queued: 0, failed: [] }
  if (!conversations.length) return sum
  if (!conf.baseUrl) {
    if (queueOnFail) sum.queued += enqueue(conversations)
    sum.failed.push('没配置 baseUrl')
    return sum
  }
  for (const batch of chunks(conversations)) {
    try {
      const d = await postWithRetry(conf, batch, log, retries)
      sum.created += d.created || 0
      sum.updated += d.updated || 0
      sum.items.push(...(d.items || []))
      sum.errors.push(...(d.errors || []))
    } catch (e) {
      sum.failed.push(e.message)
      if (queueOnFail && e.queueable !== false) sum.queued += enqueue(batch)
      else sum.errors.push(...batch.map((c) => ({ uid: c.uid, message: e.message })))
    }
  }
  return sum
}

// ---------- 失败队列 ----------

function readQueue() {
  const f = paths().queue
  if (!fs.existsSync(f)) return []
  const out = []
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { const o = JSON.parse(line); if (o?.conversation?.uid) out.push(o) } catch { /* 坏行丢弃 */ }
  }
  return out
}

function writeQueue(entries) {
  const f = paths().queue
  if (!entries.length) { if (fs.existsSync(f)) fs.unlinkSync(f); return }
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 })
}

/** 入队(同 uid 只留最新一份), 返回入队条数 */
export function enqueue(conversations) {
  const map = new Map(readQueue().map((e) => [e.conversation.uid, e]))
  const now = new Date().toISOString()
  for (const c of conversations) map.set(c.uid, { queuedAt: now, conversation: c })
  writeQueue([...map.values()])
  return conversations.length
}

export const queueSize = () => readQueue().length

/** 补发队列: 成功的移出, 失败的留着(不重复入队) */
export async function drainQueue(conf, { log = () => {} } = {}) {
  const entries = readQueue()
  if (!entries.length || !conf.baseUrl) return null
  log(`补发队列里的 ${entries.length} 条…`)
  const r = await send(conf, entries.map((e) => e.conversation), { log, queueOnFail: false })
  const done = new Set([...r.items.map((i) => i.uid), ...r.errors.filter((e) => !r.failed.includes(e.message)).map((e) => e.uid)])
  writeQueue(readQueue().filter((e) => !done.has(e.conversation.uid)))
  return r
}

// ---------- sync 状态 ----------

export function readState() {
  try { return JSON.parse(fs.readFileSync(paths().state, 'utf8')) } catch { return { version: 1, files: {} } }
}

export function writeState(state) {
  fs.writeFileSync(paths().state, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
}
