#!/usr/bin/env node
// yh-devlog: 把 Claude Code / Codex 会话推进 FDE(/api/devlog/conversations)
//   yh-devlog hook                 Claude Code Stop hook: 从 stdin 读 { transcript_path, session_id }, 报最近一个会话
//   yh-devlog import <path...>     导入指定会话文件(Claude Code jsonl / Codex rollout jsonl(.zst) / Codex .log)
//   yh-devlog sync [--days 3]      扫 ~/.claude/projects/**/*.jsonl, 按 mtime 过滤, 增量上报
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFile } from './parse.js'
import { loadConfig, send, enqueue, drainQueue, queueSize, readState, writeState, paths } from './client.js'

const HELP = `用法: yh-devlog <命令> [选项]

命令:
  hook                    作为 Claude Code Stop hook 运行（stdin 是 hook JSON），总是 exit 0
  import <文件...>         导入会话文件: Claude Code *.jsonl / Codex rollout-*.jsonl(.zst) / Codex *.log
  sync [--days 3]         扫 ~/.claude/projects/**/*.jsonl，只报最近 N 天改过且有新内容的文件

通用选项:
  --base <url>            FDE 地址（覆盖配置 baseUrl / FDE_DEVLOG_BASE），如 http://127.0.0.1:3010
  --token <key>           API Key 或登录 Token（覆盖配置 apiKey / FDE_DEVLOG_KEY）
  --stage <STAGE>         会话阶段，默认 CODING（REQUIREMENT/DESIGN/CODING/TEST/RETRO/GENERAL）
  --dry-run               只解析并打印要报的内容摘要，不发请求
  --json                  dry-run 时打印完整上报 JSON
  -q, --quiet             少打日志
  -h, --help              帮助

sync 选项:
  --days <n>              只看最近 n 天改过的文件（默认 3）
  --dir <path>            扫描目录（默认 ~/.claude/projects）
  --force                 忽略状态文件，全部重报（uid 幂等，不会重复建会话）

配置 ~/.fde-devlog.json: { "baseUrl": "...", "apiKey": "yh_xxx", "stage": "CODING" }
`

const STAGES = ['REQUIREMENT', 'DESIGN', 'CODING', 'TEST', 'RETRO', 'GENERAL']
const BOOL = new Set(['dry-run', 'json', 'quiet', 'help', 'force'])
const SHORT = { q: 'quiet', h: 'help' }

/** 手写参数解析: --k v / --k=v / 布尔开关 / -q -h; 其余是位置参数 */
export function parseArgs(argv) {
  const opts = {}
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { pos.push(...argv.slice(i + 1)); break }
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split(/=(.*)/s)
      if (BOOL.has(k)) { opts[k] = inline === undefined ? true : !/^(0|false|no)$/i.test(inline); continue }
      const v = inline !== undefined ? inline : argv[++i]
      if (v === undefined) throw new UsageError(`--${k} 需要一个值`)
      opts[k] = v
    } else if (/^-[a-z]$/i.test(a) && SHORT[a[1]]) opts[SHORT[a[1]]] = true
    else pos.push(a)
  }
  return { cmd: pos[0], args: pos.slice(1), opts }
}

class UsageError extends Error {}

const out = (...a) => console.log(...a)
const err = (...a) => console.error(...a)

function makeLog(opts, hook) {
  // hook 模式只写 stderr(Claude Code 会把 stdout 当 hook 输出解析)
  const w = hook ? err : out
  return { info: opts.quiet ? () => {} : (m) => w(m), warn: (m) => err(`! ${m}`) }
}

function config(opts, log) {
  if (opts.stage && !STAGES.includes(String(opts.stage).toUpperCase())) throw new UsageError(`--stage 只能是 ${STAGES.join('/')}`)
  return loadConfig({ base: opts.base, token: opts.token, stage: opts.stage }, log.warn)
}

const stripLocal = ({ sessionId, ...c }) => c

function describe(c) {
  const msgs = c.body?.messages?.length ?? 0
  return `${c.uid}  turns=${c.turns} msgs=${msgs}${c.truncated ? '(截断)' : ''} events=${c.events?.length ?? 0} shas=${c.commitShas?.length ?? 0}  ${c.title || ''}`
}

/** 发一组会话并打印结果; 返回是否全部成功(入队也算未成功) */
async function deliver(conf, convs, opts, log, { offline = false } = {}) {
  if (opts['dry-run']) {
    for (const c of convs) log.info(opts.json ? JSON.stringify(stripLocal(c), null, 2) : `[dry-run] ${describe(c)}`)
    return { ok: true, okUids: new Set(convs.map((c) => c.uid)) }
  }
  // 刚补发队列就连不上: 这次不再逐批重试, 直接入队
  if (offline) log.info('服务端刚才连不上，本次直接入队')
  const r = await send(conf, convs.map(stripLocal), { log: log.info, ...(offline ? { retries: 0 } : {}) })
  const byUid = new Map(convs.map((c) => [c.uid, c]))
  for (const i of r.items) log.info(`✓ ${i.created ? '新建' : '更新'} #${i.id}  ${describe(byUid.get(i.uid) || { uid: i.uid })}`)
  for (const e of r.errors) log.warn(`✗ ${e.uid}：${e.message}`)
  for (const f of r.failed) log.warn(`上报失败：${f}`)
  if (r.queued) log.warn(`${r.queued} 条已写入队列 ${paths().queue}，下次 sync / hook 时自动补发`)
  log.info(`完成：新建 ${r.created}，更新 ${r.updated}${r.errors.length ? `，失败 ${r.errors.length}` : ''}${r.queued ? `，入队 ${r.queued}` : ''}`)
  return { ok: !r.errors.length && !r.failed.length, okUids: new Set(r.items.map((i) => i.uid)) }
}

/** 补发队列; 返回 { offline, okUids } */
async function flushQueue(conf, opts, log) {
  const none = { offline: false, okUids: new Set() }
  if (opts['dry-run'] || !queueSize()) return none
  const r = await drainQueue(conf, { log: log.info })
  if (!r) return none
  if (r.items.length) log.info(`队列补发成功 ${r.items.length} 条`)
  for (const e of r.errors.filter((x) => !r.failed.includes(x.message))) log.warn(`✗ ${e.uid}：${e.message}（已移出队列）`)
  if (r.failed.length) log.warn(`队列补发仍失败（${r.failed[0]}），剩 ${queueSize()} 条留待下次`)
  return { offline: r.failed.length > 0, okUids: new Set(r.items.map((i) => i.uid)) }
}

function recordState(file, parsed, okUids) {
  const st = fs.statSync(file)
  const state = readState()
  state.files ||= {}
  const sessions = parsed.conversations.filter((c) => okUids.has(c.uid)).map((c) => c.sessionId)
  if (!sessions.length) return
  state.files[path.resolve(file)] = { sessions, lines: parsed.lines, size: st.size, mtimeMs: Math.round(st.mtimeMs), syncedAt: new Date().toISOString() }
  writeState(state)
}

// ---------- hook ----------

async function readStdin(timeoutMs = 5000) {
  if (process.stdin.isTTY) return ''
  return new Promise((resolve) => {
    const chunks = []
    const t = setTimeout(() => { process.stdin.destroy(); resolve(Buffer.concat(chunks).toString('utf8')) }, timeoutMs)
    process.stdin.on('data', (d) => chunks.push(d))
    process.stdin.on('end', () => { clearTimeout(t); resolve(Buffer.concat(chunks).toString('utf8')) })
    process.stdin.on('error', () => { clearTimeout(t); resolve('') })
  })
}

async function cmdHook(opts) {
  const log = makeLog(opts, true)
  // hook 里任何问题都不能挡住 Claude Code: 全部吞掉, exit 0
  try {
    const raw = await readStdin()
    let input
    try { input = JSON.parse(raw || '{}') } catch { log.warn('hook 输入不是 JSON，跳过'); return 0 }
    const file = input.transcript_path
    if (!file || !fs.existsSync(file)) { log.warn(`hook 输入里没有可读的 transcript_path（${file || '空'}），跳过`); return 0 }
    const conf = { ...config(opts, log), timeoutMs: 8000 }
    const parsed = parseFile(file, { stage: conf.stage, sessionId: input.session_id, latestOnly: true })
    if (!parsed.conversations.length) { log.info('会话里还没有对话内容，跳过'); return 0 }
    if (opts['dry-run']) { await deliver(conf, parsed.conversations, opts, log); return 0 }
    // 先入队再补发: hook 被 Claude Code 超时杀掉也不丢, 下次 hook / sync 接着发
    enqueue(parsed.conversations.map(stripLocal))
    const r = await flushQueue(conf, opts, log)
    for (const c of parsed.conversations) if (r.okUids.has(c.uid)) log.info(`✓ 已上报 ${describe(c)}`)
    recordState(file, parsed, r.okUids)
  } catch (e) {
    log.warn(`yh-devlog hook 出错（已忽略）：${e.message}`)
  }
  return 0
}

// ---------- import ----------

async function cmdImport(args, opts) {
  if (!args.length) throw new UsageError('用法: yh-devlog import <会话文件...>')
  const log = makeLog(opts)
  const conf = config(opts, log)
  const q = await flushQueue(conf, opts, log)
  let ok = true
  for (const a of args) {
    const file = a.replace(/^~(?=$|\/)/, os.homedir())
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { log.warn(`文件不存在：${a}`); ok = false; continue }
    let parsed
    try { parsed = parseFile(file, { stage: conf.stage }) } catch (e) { log.warn(`${a}：${e.message}`); ok = false; continue }
    log.info(`${a}  格式=${parsed.format} 行数=${parsed.lines} 大小=${(parsed.size / 1024).toFixed(0)}KB 会话=${parsed.conversations.length}`)
    if (!parsed.conversations.length) { log.warn('文件里没有可上报的对话'); continue }
    const r = await deliver(conf, parsed.conversations, opts, log, q)
    if (!opts['dry-run'] && parsed.format === 'claude') recordState(file, parsed, r.okUids)
    ok &&= r.ok
  }
  return ok ? 0 : 1
}

// ---------- sync ----------

function* walkJsonl(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'subagents' || e.name === 'memory' || e.name.startsWith('.')) continue // 子代理会话并在主会话里看, 不单独报
      yield* walkJsonl(p)
    } else if (e.isFile() && e.name.endsWith('.jsonl')) yield p
  }
}

async function cmdSync(opts) {
  const log = makeLog(opts)
  const days = opts.days === undefined ? 3 : Number(opts.days)
  if (!Number.isFinite(days) || days <= 0) throw new UsageError('--days 必须是正数')
  const dir = (opts.dir || path.join(os.homedir(), '.claude', 'projects')).replace(/^~(?=$|\/)/, os.homedir())
  if (!fs.existsSync(dir)) throw new UsageError(`目录不存在：${dir}`)
  const conf = config(opts, log)
  const q = await flushQueue(conf, opts, log)

  const since = Date.now() - days * 86400_000
  const state = readState()
  const files = []
  let scanned = 0
  let unchanged = 0
  for (const f of walkJsonl(dir)) {
    scanned++
    const st = fs.statSync(f)
    if (st.mtimeMs < since) continue
    const prev = state.files?.[path.resolve(f)]
    if (!opts.force && prev && prev.size === st.size && Math.round(st.mtimeMs) === prev.mtimeMs) { unchanged++; continue }
    files.push(f)
  }
  log.info(`扫描 ${dir}：共 ${scanned} 个 jsonl，最近 ${days} 天有变化 ${files.length} 个${unchanged ? `，没变的 ${unchanged} 个已跳过` : ''}`)

  const parsedByFile = []
  const convs = []
  for (const f of files) {
    try {
      const p = parseFile(f, { stage: conf.stage })
      const prev = state.files?.[path.resolve(f)]
      // 行数没涨(只是 touch 了)就不重报
      if (!opts.force && prev && prev.lines === p.lines) { recordState(f, p, new Set(p.conversations.map((c) => c.uid))); continue }
      parsedByFile.push([f, p])
      convs.push(...p.conversations)
    } catch (e) {
      log.warn(`${f}：${e.message}`)
    }
  }
  if (!convs.length) { log.info('没有需要上报的新会话'); return 0 }
  const r = await deliver(conf, convs, opts, log, q)
  if (!opts['dry-run']) for (const [f, p] of parsedByFile) recordState(f, p, r.okUids)
  if (!opts['dry-run']) log.info(`状态已写入 ${paths().state}`)
  return r.ok ? 0 : 1
}

// ---------- main ----------

export async function main(argv) {
  let parsed
  try { parsed = parseArgs(argv) } catch (e) { err(e.message); return 2 }
  const { cmd, args, opts } = parsed
  if (opts.help || !cmd || cmd === 'help') { out(HELP); return cmd || opts.help ? 0 : 2 }
  try {
    if (cmd === 'hook') return await cmdHook(opts)
    if (cmd === 'import') return await cmdImport(args, opts)
    if (cmd === 'sync') return await cmdSync(opts)
    throw new UsageError(`不认识的命令：${cmd}（可用 hook / import / sync，--help 看用法）`)
  } catch (e) {
    err(e instanceof UsageError ? e.message : `出错：${e.message}`)
    if (process.env.DEBUG) err(e.stack)
    return e instanceof UsageError ? 2 : 1
  }
}

const isMain = (() => {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname) } catch { return false }
})()
if (isMain) main(process.argv.slice(2)).then((code) => { process.exitCode = code })
