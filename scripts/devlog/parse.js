// 会话文件解析: Claude Code 的 ~/.claude/projects/**/<sessionId>.jsonl、Codex 的 rollout-*.jsonl(.zst) / 纯文本 .log
// 只读会话记录本身(用户/助手的文字、执行过的命令、改过的文件路径), 不读代码正文: 工具结果只用来认 git commit 的输出行。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { redact } from './redact.js'

export const BIG_FILE = 2 * 1024 * 1024 // 超过这个大小只取最后 KEEP_TAIL 条消息
export const KEEP_TAIL = 200
const MAX_MSG_CHARS = 30000 // 单条消息上限(用户贴了整份日志之类), 超出截断并标注
const MAX_EVENTS = 500 // 与后端一致
const MAX_SHAS = 10

// ---------- 读文件 ----------

/** 读会话文件文本; .zst 用系统 zstd 解压(Codex 新版会压缩归档) */
export function readSessionText(file) {
  if (file.endsWith('.zst')) {
    const r = spawnSync('zstd', ['-dc', file], { maxBuffer: 512 * 1024 * 1024 })
    if (r.error) throw new Error(`解压 ${path.basename(file)} 需要 zstd 命令（brew install zstd）`)
    if (r.status !== 0) throw new Error(`zstd 解压失败：${String(r.stderr).trim().slice(0, 200)}`)
    return r.stdout.toString('utf8')
  }
  return fs.readFileSync(file, 'utf8')
}

function jsonLines(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 正在写入的半行 / 坏行: 跳过 */ }
  }
  return out
}

export const countLines = (text) => text.split('\n').filter((l) => l.trim()).length

/** 认格式: claude | codex | codex-text */
export function detectFormat(text) {
  const rows = jsonLines(text.slice(0, 256 * 1024)).slice(0, 50)
  if (!rows.length) return 'codex-text'
  if (rows.some((o) => o.type === 'session_meta' || o.type === 'response_item' || o.type === 'turn_context')) return 'codex'
  if (rows.some((o) => typeof o.sessionId === 'string' || o.type === 'summary' || o.type === 'user' || o.type === 'assistant')) return 'claude'
  // 老版 Codex: 首行 { id, timestamp, instructions }, 之后直接是 { type:'message', role, content }
  if (rows.some((o) => o.type === 'message' && o.role)) return 'codex'
  throw new Error('不认识的会话格式（只支持 Claude Code jsonl 与 Codex 日志）')
}

// ---------- 通用小工具 ----------

const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

function clip(text) {
  const t = String(text || '')
  return t.length > MAX_MSG_CHARS ? `${t.slice(0, MAX_MSG_CHARS)}\n…（本条过长，已截断 ${t.length - MAX_MSG_CHARS} 字）` : t
}

/** 首句: 按中英文句末标点或换行切, 最长 120 字(与后端规则摘要同口径) */
export function firstSentence(text) {
  const t = String(text || '').trim()
  const m = t.match(/^[\s\S]*?(?:[。！？!?]|\.(?=\s)|\n|$)/)
  return oneLine(m ? m[0] : t, 120)
}

// 7~40 位十六进制, 前后不能贴着字母数字或横线(排除 uuid 片段), 至少带一个数字(排除 "defaced" 这类单词)
const SHA_RE = /(?<![\w-])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w-])/g
const COMMIT_CTX = /commit|提交/i
// git commit 的输出行: [feat/x 4bae90d] message / [main (root-commit) abc1234] ...
const GIT_COMMIT_OUT = /^\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,40})\]/gm

/** 从助手文字里抓 commit sha: 命中位置前后 80 字内出现 commit/提交 才算 */
export function shasFromText(text) {
  const out = []
  for (const m of String(text || '').matchAll(SHA_RE)) {
    const ctx = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80)
    if (COMMIT_CTX.test(ctx)) out.push(m[0])
  }
  return out
}
// 命令里带 git commit 时, 它的输出里 `git log --oneline` 风格的行首 sha 也算
const ONELINE = /^([0-9a-f]{7,40}) \S/gm
const shasFromGitOutput = (text, afterCommit = false) => {
  const t = String(text || '')
  const out = [...t.matchAll(GIT_COMMIT_OUT)].map((m) => m[1])
  if (afterCommit && !out.length) { const m = ONELINE.exec(t); ONELINE.lastIndex = 0; if (m && /\d/.test(m[1])) out.push(m[1]) }
  return out
}

/** 把相邻的同角色消息并成一条(助手一轮里被工具调用切开的多段文字) */
function pushMsg(list, role, text, ts) {
  const t = String(text || '').trim()
  if (!t) return
  const last = list[list.length - 1]
  if (last && last.role === role && role === 'assistant') { last.text += `\n\n${t}`; return }
  list.push({ role, text: t, ...(ts ? { ts } : {}) })
}

/**
 * 统一组装上报结构(字段名与后端 normalizeItem 一致)。
 * s = { uid, source, model, startedAt, endedAt, branch, cwd, messages, events, shas }
 */
export function buildConversation(s, { truncate = false, stage = 'CODING' } = {}) {
  let messages = s.messages.map((m) => ({ ...m, text: clip(m.text) }))
  const truncated = truncate && messages.length > KEEP_TAIL
  if (truncated) messages = messages.slice(-KEEP_TAIL)
  const users = messages.filter((m) => m.role === 'user')
  const allUsers = s.messages.filter((m) => m.role === 'user') // 标题/摘要看整段会话的开头, 不受截断影响
  const shas = [...new Set(s.shas)].slice(0, MAX_SHAS)
  const conv = {
    uid: s.uid,
    source: s.source,
    stage,
    model: s.model ? String(s.model).slice(0, 60) : undefined,
    startedAt: s.startedAt || undefined,
    endedAt: s.endedAt || undefined,
    turns: users.length,
    branch: s.branch ? String(s.branch).slice(0, 120) : undefined,
    cwd: s.cwd ? String(s.cwd).slice(0, 300) : undefined,
    title: oneLine(allUsers[0]?.text, 60) || undefined,
    summary: allUsers.slice(0, 3).map((m, i) => `${i + 1}. ${firstSentence(m.text)}`).join('\n') || undefined,
    commitShas: shas,
    body: { messages: messages.map(({ role, text }) => ({ role, text })), ...(truncated ? { truncated: true } : {}) },
    events: s.events.slice(0, MAX_EVENTS).map((e, i) => ({ seq: i + 1, ...e })),
    ...(truncated ? { truncated: true } : {})
  }
  for (const k of Object.keys(conv)) if (conv[k] === undefined) delete conv[k]
  // 发送前整体过一遍脱敏(标题、摘要、正文、命令都在里面)
  return redact(conv).value
}

// ---------- Claude Code ----------

const SYS_TAGS = /<(system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g
const NOISE = /^\[Request interrupted by user[^\]]*\]$|^No response requested\.?$/

/** 用户消息的文字; 只有工具结果 / 系统注入的返回 '' */
function claudeUserText(msg) {
  const c = msg?.content
  let text
  if (typeof c === 'string') text = c
  else if (Array.isArray(c)) {
    text = c.map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[图片]' : '')).filter(Boolean).join('\n')
  } else return ''
  // 斜杠命令: <command-name>/foo</command-name><command-args>x</command-args> → "/foo x"
  const cmd = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] || ''
    text = `${cmd[1].trim()} ${args.trim()}`.trim()
  }
  text = text.replace(SYS_TAGS, '').replace(/<command-(message|args)>[\s\S]*?<\/command-\1>/g, '').trim()
  return NOISE.test(text) ? '' : text
}

/** 工具结果: [{ id, text }] */
function claudeToolResults(msg) {
  const c = msg?.content
  if (!Array.isArray(c)) return []
  return c.filter((b) => b?.type === 'tool_result').map((b) => ({
    id: b.tool_use_id,
    text: typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text || '').join('\n') : ''
  }))
}

const EDIT_TOOLS = { Write: '新建', Edit: '修改', MultiEdit: '修改', NotebookEdit: '修改' }

/** 解析 Claude Code jsonl → 按 sessionId 分组的会话(按文件里首次出现的顺序) */
export function parseClaude(text) {
  const groups = new Map()
  const get = (id) => {
    if (!groups.has(id)) groups.set(id, { id, messages: [], events: [], shas: [], seenFiles: new Set(), commitCalls: new Set(), ts: [], models: [], branch: null, cwd: null })
    return groups.get(id)
  }
  for (const o of jsonLines(text)) {
    if (typeof o.sessionId !== 'string' || (o.type !== 'user' && o.type !== 'assistant')) continue
    if (o.isSidechain || o.isMeta || o.isCompactSummary || o.isVisibleInTranscriptOnly) continue
    const g = get(o.sessionId)
    if (o.timestamp) g.ts.push(o.timestamp)
    if (o.gitBranch) g.branch = o.gitBranch
    if (o.cwd) g.cwd = o.cwd
    const msg = o.message || {}
    if (o.type === 'user') {
      const t = claudeUserText(msg)
      if (t) pushMsg(g.messages, 'user', t, o.timestamp)
      for (const r of claudeToolResults(msg)) g.shas.push(...shasFromGitOutput(r.text, g.commitCalls.has(r.id)))
      continue
    }
    if (msg.model && msg.model !== '<synthetic>') g.models.push(msg.model)
    const blocks = Array.isArray(msg.content) ? msg.content : typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : []
    for (const b of blocks) {
      if (b?.type === 'text' && b.text?.trim()) {
        pushMsg(g.messages, 'assistant', b.text, o.timestamp)
        g.shas.push(...shasFromText(b.text))
      } else if (b?.type === 'tool_use') {
        const input = b.input || {}
        if (b.name === 'Bash' && input.command) {
          g.events.push({ kind: 'COMMAND', text: oneLine(input.command, 500), occurredAt: o.timestamp })
          if (/\bgit\b[^|;&]*\bcommit\b/.test(input.command)) g.commitCalls.add(b.id)
        } else if (EDIT_TOOLS[b.name] && (input.file_path || input.notebook_path)) {
          const f = input.file_path || input.notebook_path
          if (!g.seenFiles.has(f)) {
            g.seenFiles.add(f)
            g.events.push({ kind: 'ARTIFACT', text: `${EDIT_TOOLS[b.name]} ${f}`, files: [f], occurredAt: o.timestamp })
          }
        }
      }
    }
  }
  return [...groups.values()].filter((g) => g.messages.length).map((g) => {
    const ts = g.ts.slice().sort()
    return {
      uid: `claude:${g.id}`, sessionId: g.id, source: 'CLAUDE_CODE',
      model: g.models[g.models.length - 1], startedAt: ts[0], endedAt: ts[ts.length - 1],
      branch: g.branch, cwd: g.cwd, messages: g.messages, events: g.events, shas: g.shas
    }
  })
}

// ---------- Codex ----------

// 系统注入的用户消息(<environment_context>、<user_instructions>、AGENTS.md 等)整条跳过
const CODEX_INJECTED = /^\s*(<[\w-]+>[\s\S]*<\/[\w-]+>|# AGENTS\.md instructions[\s\S]*)\s*$/

const contentText = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.text || '')).filter(Boolean).join('\n') : '')

function codexCommands(item) {
  const cmds = []
  const add = (c) => { const s = Array.isArray(c) ? c.join(' ') : c; if (s && String(s).trim()) cmds.push(oneLine(s, 500)) }
  if (item.type === 'local_shell_call') add(item.action?.command)
  if (item.type === 'function_call' && /^(shell|exec_command|local_shell|container\.exec)$/.test(item.name || '')) {
    try { const a = JSON.parse(item.arguments || '{}'); add(a.command ?? a.cmd) } catch { /* 参数不是 JSON */ }
  }
  // 新版 Codex 把工具调用包在一段 JS 里: tools.exec_command({cmd:"..."})
  if (item.type === 'custom_tool_call' && typeof item.input === 'string') {
    for (const m of item.input.matchAll(/\bcmd\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      try { add(JSON.parse(m[1])) } catch { /* 跳过 */ }
    }
  }
  return cmds
}

/** apply_patch 里的文件路径(只要路径, 不要补丁内容) */
function codexPatchedFiles(item) {
  const src = item.type === 'custom_tool_call' ? item.input : item.type === 'function_call' ? item.arguments : ''
  if (typeof src !== 'string' || !/\*\*\* (Update|Add|Delete) File:/.test(src)) return []
  return [...src.matchAll(/\*\*\* (Update|Add|Delete) File: ([^\n"\\]+)/g)].map((m) => ({ op: m[1], file: m[2].trim() }))
}

export function parseCodex(text, file) {
  const s = { messages: [], events: [], shas: [], ts: [], model: null, id: null, cwd: null, branch: null }
  const seen = new Set()
  for (const o of jsonLines(text)) {
    if (o.timestamp) s.ts.push(o.timestamp)
    const p = o.payload || {}
    if (o.type === 'session_meta') {
      s.id = p.id || p.session_id || s.id
      s.cwd = p.cwd || s.cwd
      s.branch = p.git?.branch || s.branch
      continue
    }
    if (o.type === 'turn_context') { if (p.model) s.model = p.model; if (p.cwd) s.cwd = s.cwd || p.cwd; continue }
    if (o.type === 'event_msg' && p.type === 'thread_settings_applied' && p.thread_settings?.model) { s.model = p.thread_settings.model; continue }
    // 老版首行 { id, timestamp, instructions }
    if (!o.type && o.id && !s.id) { s.id = o.id; continue }
    const item = o.type === 'response_item' ? p : ['message', 'function_call', 'function_call_output', 'local_shell_call', 'custom_tool_call', 'custom_tool_call_output'].includes(o.type) ? o : null
    if (!item) continue
    if (item.type === 'message') {
      const t = contentText(item.content).trim()
      if (item.role === 'user' && t && !CODEX_INJECTED.test(t)) pushMsg(s.messages, 'user', t, o.timestamp)
      if (item.role === 'assistant' && t) { pushMsg(s.messages, 'assistant', t, o.timestamp); s.shas.push(...shasFromText(t)) }
      continue
    }
    if (/_output$/.test(item.type)) { s.shas.push(...shasFromGitOutput(contentText(item.output) || (typeof item.output === 'string' ? item.output : ''))); continue }
    for (const c of codexCommands(item)) s.events.push({ kind: 'COMMAND', text: c, occurredAt: o.timestamp })
    for (const { op, file: f } of codexPatchedFiles(item)) {
      if (seen.has(f)) continue
      seen.add(f)
      s.events.push({ kind: 'ARTIFACT', text: `${op === 'Add' ? '新建' : op === 'Delete' ? '删除' : '修改'} ${f}`, files: [f], occurredAt: o.timestamp })
    }
  }
  const ts = s.ts.slice().sort()
  return finishCodex(s, ts, file)
}

/** 纯文本 Codex 日志: 以 "user" / "codex" / "assistant" 单独成行(可带 [时间] 前缀)分段 */
export function parseCodexText(text, file) {
  const s = { messages: [], events: [], shas: [], ts: [], model: null, id: null, cwd: null, branch: null }
  const HEAD = /^(?:\[([^\]]+)\]\s*)?(user instructions:|user|codex|assistant|exec)\s*:?\s*(.*)$/i
  let cur = null
  const flush = () => {
    if (!cur) return
    const t = cur.lines.join('\n').trim()
    if (cur.role === 'exec') { if (t) s.events.push({ kind: 'COMMAND', text: oneLine(t.split('\n')[0], 500) }) }
    else if (t) { pushMsg(s.messages, cur.role, t, cur.ts); if (cur.role === 'assistant') s.shas.push(...shasFromText(t)) }
    cur = null
  }
  for (const line of text.split('\n')) {
    const m = line.match(HEAD)
    if (m && (m[1] || !m[3])) {
      flush()
      const k = m[2].toLowerCase()
      cur = { role: k.startsWith('user') ? 'user' : k === 'exec' ? 'exec' : 'assistant', ts: m[1] && !Number.isNaN(Date.parse(m[1])) ? new Date(m[1]).toISOString() : undefined, lines: m[3] ? [m[3]] : [] }
      if (cur.ts) s.ts.push(cur.ts)
      continue
    }
    const model = line.match(/^\s*model:\s*(\S+)/)
    if (model && !s.model) s.model = model[1]
    const wd = line.match(/^\s*workdir:\s*(\S+)/)
    if (wd && !s.cwd) s.cwd = wd[1]
    if (cur) cur.lines.push(line)
  }
  flush()
  if (!s.messages.length) throw new Error('没在日志里找到 user / codex 对话段落')
  return finishCodex(s, s.ts.slice().sort(), file)
}

function finishCodex(s, ts, file) {
  if (!s.messages.length) return []
  // 没有会话 id 时按文件绝对路径取哈希, 同一文件重复导入 uid 不变
  const id = s.id || crypto.createHash('sha1').update(path.resolve(file || '')).digest('hex').slice(0, 24)
  return [{
    uid: `codex:${id}`, sessionId: id, source: 'CODEX', model: s.model, startedAt: ts[0], endedAt: ts[ts.length - 1],
    branch: s.branch, cwd: s.cwd, messages: s.messages, events: s.events, shas: s.shas
  }]
}

// ---------- 入口 ----------

/**
 * 解析一个会话文件 → { format, lines, size, conversations: [上报结构] }
 * @param {string} file
 * @param {{ stage?: string, sessionId?: string, latestOnly?: boolean }} opts
 */
export function parseFile(file, opts = {}) {
  const size = fs.statSync(file).size
  const text = readSessionText(file)
  const format = detectFormat(text)
  let sessions = format === 'claude' ? parseClaude(text) : format === 'codex' ? parseCodex(text, file) : parseCodexText(text, file)
  if (opts.sessionId) {
    const hit = sessions.filter((x) => x.sessionId === opts.sessionId)
    if (hit.length) sessions = hit
  }
  if (opts.latestOnly && sessions.length > 1) {
    // 最近一个会话 = 最后一条记录时间最晚的那组
    sessions = [sessions.reduce((a, b) => (String(b.endedAt || '') >= String(a.endedAt || '') ? b : a))]
  }
  const truncate = size > BIG_FILE
  return {
    format, size, lines: countLines(text),
    conversations: sessions.map((x) => ({ sessionId: x.sessionId, ...buildConversation(x, { truncate, stage: opts.stage }) }))
  }
}
