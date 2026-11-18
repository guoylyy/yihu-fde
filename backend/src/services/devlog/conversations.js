// 开发会话回流: 上报落库(按 uid 幂等 upsert)、正文工具函数、规则版摘要
import prisma from '../../lib/prisma.js'
import { redact } from './redact.js'

export const SOURCES = ['PLATFORM_ASSISTANT', 'HERMES', 'CLAUDE_CODE', 'CODEX', 'PASTE']
export const STAGES = ['REQUIREMENT', 'DESIGN', 'CODING', 'TEST', 'RETRO', 'GENERAL']
export const STATUSES = ['PENDING_LINK', 'LINKED', 'IGNORED']
export const EVENT_KINDS = ['DECISION', 'PITFALL', 'COMMAND', 'ARTIFACT', 'NOTE', 'QUOTE']
export const EXPERIENCE_KINDS = ['EXPERIENCE', 'DECISION', 'PITFALL', 'HOWTO', 'DRIFT']
export const MAX_BATCH = 100
const MAX_EVENTS = 500

export class InputError extends Error {}

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const isId = (v) => /^[1-9]\d{0,17}$/.test(String(v ?? ''))

function optId(v, name) {
  if (isEmpty(v)) return undefined
  if (!isId(v)) throw new InputError(`${name} 不合法`)
  return BigInt(v)
}
function optDate(v, name) {
  if (isEmpty(v)) return undefined
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new InputError(`${name} 不是合法时间`)
  return d
}
function optInt(v, name) {
  if (isEmpty(v)) return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 2_147_483_647) throw new InputError(`${name} 必须是非负整数`)
  return n
}
function optStr(v, name, max) {
  if (isEmpty(v)) return undefined
  const s = String(v)
  if (s.length > max) throw new InputError(`${name} 最长 ${max} 字`)
  return s
}
function optEnum(v, name, list) {
  if (isEmpty(v)) return undefined
  const s = String(v).toUpperCase()
  if (!list.includes(s)) throw new InputError(`${name} 只能是 ${list.join('/')}`)
  return s
}
function optArray(v, name) {
  if (isEmpty(v)) return undefined
  if (!Array.isArray(v)) throw new InputError(`${name} 必须是数组`)
  return v
}

/** 正文里的消息数组: 认 messages[] 或 { messages: [] } */
export function messagesOf(body) {
  if (Array.isArray(body)) return body
  if (body && Array.isArray(body.messages)) return body.messages
  return []
}

/** 单条消息的文本: content 字符串 / content 块数组([{type:'text',text}]) / text */
export function textOf(m) {
  if (!m || typeof m !== 'object') return typeof m === 'string' ? m : ''
  const c = m.content ?? m.text
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.type === 'text' || b?.text ? b.text || '' : '')).filter(Boolean).join('\n')
  return ''
}

const roleOf = (m) => String(m?.role || '').toLowerCase()

/**
 * 校验并归一化一条上报。返回 { uid, data, events }; data 只含非空字段(更新时只覆盖这些)。
 * 不合法抛 InputError(只影响这一条)
 */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') throw new InputError('每条会话必须是对象')
  const uid = optStr(raw.uid, 'uid', 64)
  if (!uid) throw new InputError('缺少 uid')
  const data = {
    source: optEnum(raw.source, 'source', SOURCES),
    stage: optEnum(raw.stage, 'stage', STAGES),
    engineerId: optId(raw.engineerId, 'engineerId'),
    projectId: optId(raw.projectId, 'projectId'),
    taskId: optId(raw.taskId, 'taskId'),
    milestoneId: optId(raw.milestoneId, 'milestoneId'),
    model: optStr(raw.model, 'model', 60),
    startedAt: optDate(raw.startedAt, 'startedAt'),
    endedAt: optDate(raw.endedAt, 'endedAt'),
    turns: optInt(raw.turns, 'turns'),
    tokens: optInt(raw.tokens, 'tokens'),
    branch: optStr(raw.branch, 'branch', 120),
    cwd: optStr(raw.cwd, 'cwd', 300),
    title: optStr(raw.title, 'title', 200),
    summary: optStr(raw.summary, 'summary', 60000),
    decisions: optArray(raw.decisions, 'decisions'),
    pitfalls: optArray(raw.pitfalls, 'pitfalls'),
    tags: optArray(raw.tags, 'tags'),
    commitShas: optArray(raw.commitShas, 'commitShas')
  }
  if (!isEmpty(raw.cost)) {
    const c = Number(raw.cost)
    if (!Number.isFinite(c) || c < 0 || c >= 1e8) throw new InputError('cost 不合法')
    data.cost = c.toFixed(4)
  }
  if (!isEmpty(raw.body)) {
    if (typeof raw.body !== 'object') throw new InputError('body 必须是 messages 数组')
    const r = redact(raw.body)
    data.body = r.value
    data.bodyRedacted = r.redacted
    if (data.turns === undefined) data.turns = messagesOf(r.value).filter((m) => roleOf(m) === 'user').length
  }
  // 摘要类字段里也可能贴了密钥, 一并脱敏(不影响 bodyRedacted 的口径)
  for (const k of ['title', 'summary', 'decisions', 'pitfalls']) {
    if (data[k] !== undefined) data[k] = redact(data[k]).value
  }

  const events = (optArray(raw.events, 'events') || []).slice(0, MAX_EVENTS).map((e, i) => {
    if (!e || typeof e !== 'object') throw new InputError(`events[${i}] 必须是对象`)
    const seq = optInt(e.seq, `events[${i}].seq`) ?? i + 1
    const kind = optEnum(e.kind, `events[${i}].kind`, EVENT_KINDS) || 'NOTE'
    const text = isEmpty(e.text) ? null : redact(String(e.text)).value
    if (!text) throw new InputError(`events[${i}] 缺少 text`)
    return { seq, kind, text, files: optArray(e.files, `events[${i}].files`), occurredAt: optDate(e.occurredAt, `events[${i}].occurredAt`) }
  })

  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k]
  return { uid, data, events }
}

/** 只给了 taskId / milestoneId 时补上所属项目; 指向不存在的记录报错 */
export async function fillProjectFromRefs(data) {
  if (data.taskId) {
    const t = await prisma.task.findFirst({ where: { id: data.taskId, deletedAt: null }, select: { projectId: true } })
    if (!t) throw new InputError(`任务 ${data.taskId} 不存在`)
    if (data.projectId && data.projectId !== t.projectId) throw new InputError(`任务 ${data.taskId} 不属于项目 ${data.projectId}`)
    if (!data.projectId) data.projectId = t.projectId
  }
  if (data.milestoneId) {
    const m = await prisma.milestone.findFirst({ where: { id: data.milestoneId, deletedAt: null }, select: { projectId: true } })
    if (!m) throw new InputError(`里程碑 ${data.milestoneId} 不存在`)
    if (data.projectId && data.projectId !== m.projectId) throw new InputError(`里程碑 ${data.milestoneId} 不属于项目 ${data.projectId}`)
    if (!data.projectId) data.projectId = m.projectId
  }
  if (data.projectId) {
    const p = await prisma.project.findFirst({ where: { id: data.projectId, deletedAt: null }, select: { id: true } })
    if (!p) throw new InputError(`项目 ${data.projectId} 不存在`)
  }
  return data
}

/**
 * 按 uid upsert 一条会话(含事件)。
 * @param {object} o.item       normalizeItem 的结果
 * @param {object} o.actor      { userId: BigInt, engineerId: BigInt|null, all: boolean } all=能代任何人上报
 * @returns {{ id: BigInt, created: boolean }}
 */
export async function upsertConversation({ uid, data, events }, actor) {
  // 非管理员只能上报自己的会话: engineerId 一律记成本人
  if (!actor.all) {
    if (data.engineerId && data.engineerId !== actor.engineerId) throw new InputError('只能上报自己的会话（engineerId 必须是本人）')
    if (actor.engineerId) data.engineerId = actor.engineerId
  }
  await fillProjectFromRefs(data)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.devConversation.findUnique({ where: { uid } })
    let row
    let created = false
    if (existing) {
      if (!actor.all && !ownedBy(existing, actor)) throw new InputError('这个 uid 已被别人的会话占用')
      const patch = { ...data }
      if (patch.projectId && existing.status === 'PENDING_LINK') patch.status = 'LINKED'
      if (existing.deletedAt) patch.deletedAt = null
      row = await tx.devConversation.update({ where: { id: existing.id }, data: patch })
    } else {
      if (!data.source) throw new InputError('新会话缺少 source')
      row = await tx.devConversation.create({
        data: { uid, ...data, status: data.projectId ? 'LINKED' : 'PENDING_LINK', createdBy: actor.userId }
      })
      created = true
    }
    for (const e of events) {
      await tx.devConversationEvent.upsert({
        where: { conversationId_seq: { conversationId: row.id, seq: e.seq } },
        create: { conversationId: row.id, ...e },
        update: { kind: e.kind, text: e.text, ...(e.files ? { files: e.files } : {}), ...(e.occurredAt ? { occurredAt: e.occurredAt } : {}) }
      })
    }
    return { id: row.id, created }
  })
}

export function ownedBy(conv, actor) {
  if (actor.engineerId && conv.engineerId === actor.engineerId) return true
  return conv.createdBy != null && conv.createdBy === actor.userId
}

// ---------- 规则版摘要(模型不可用时降级) ----------

// 前后边界认中文标点与汉字(「看下src/a.js。」), 否则中文正文里的路径抓不到
const FILE_RE = /(?:^|[\s`'"(\[（，。：；、\u4e00-\u9fff])((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z0-9]{1,8}|[\w-]+\.(?:js|mjs|cjs|ts|tsx|jsx|vue|py|go|rs|java|kt|rb|php|sql|prisma|json|ya?ml|toml|md|sh|css|scss|html))(?::\d+)?(?=$|[\s`'",)\]:;，。；：！？、）\u4e00-\u9fff])/g

/** 文本里提到的文件路径(去重, 最多 30 个) */
export function detectFiles(texts) {
  const out = new Set()
  for (const t of texts) {
    for (const m of String(t || '').matchAll(FILE_RE)) {
      const f = m[1]
      if (/^https?:/.test(f) || /^\d+(\.\d+)+$/.test(f)) continue
      out.add(f)
      if (out.size >= 30) return [...out]
    }
  }
  return [...out]
}

/** 一段话的首句(按中英文句末标点或换行切), 最长 120 字 */
export function firstSentence(text) {
  const t = String(text || '').trim()
  const m = t.match(/^[\s\S]*?(?:[。！？!?]|\.(?=\s)|\n|$)/)
  return (m ? m[0] : t).replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** 规则摘要: 前 3 条 user 消息首句 + 检测到的文件路径; 决策/坑取已上报的事件 */
export function ruleSummary(conv, events = []) {
  const msgs = messagesOf(conv.body)
  const userTexts = msgs.filter((m) => roleOf(m) === 'user').map(textOf).filter((t) => t.trim())
  const firsts = userTexts.slice(0, 3).map(firstSentence).filter(Boolean)
  const files = detectFiles([...msgs.map(textOf), ...events.map((e) => e.text)])
  const lines = []
  if (firsts.length) lines.push(...firsts.map((s, i) => `${i + 1}. ${s}`))
  if (files.length) lines.push(`涉及文件：${files.join('、')}`)
  return {
    summary: lines.join('\n') || conv.title || '（会话没有可用的用户消息）',
    decisions: events.filter((e) => e.kind === 'DECISION').map((e) => e.text),
    pitfalls: events.filter((e) => e.kind === 'PITFALL').map((e) => e.text),
    tags: [...new Set(files.map((f) => f.split('.').pop().toLowerCase()))].slice(0, 10),
    files
  }
}

/** 给模型看的正文: 按角色拼接, 截到 maxChars(正文本身入库不截断, 只是喂模型时限长) */
export function transcriptForModel(conv, events = [], maxChars = 24000) {
  const parts = messagesOf(conv.body).map((m) => {
    const t = textOf(m) || (m?.tool ? `[工具 ${m.tool}] ${JSON.stringify(m.args ?? '')}` : '')
    return t ? `[${roleOf(m) || 'msg'}] ${t}` : ''
  }).filter(Boolean)
  if (events.length) parts.push('--- 事件 ---', ...events.map((e) => `[${e.kind}] ${e.text}`))
  const all = parts.join('\n')
  return all.length > maxChars ? all.slice(0, maxChars) + '\n…（后文省略）' : all
}

// ---------- 平台 AI 助手落库 ----------

/** 工具参数摘要: 只留一行 JSON, 最长 200 字(脱敏在整体正文上统一做) */
export function argsDigest(args) {
  let s
  try { s = JSON.stringify(args ?? {}) } catch { s = String(args) }
  return s.length > 200 ? s.slice(0, 200) + '…' : s
}

/**
 * 把平台助手的一轮对话追加进 DevConversation(uid = 'pa_' + agent_conversations.id)。
 * 正文只存 user / assistant 文本, 工具调用只存 { tool, args 摘要 }; 同一会话多轮累加在同一行。
 * 失败由调用方吞掉, 不影响对话本身
 */
export async function recordAssistantTurn({ conversationId, title, startedAt, userId, engineerId, stage, model, userText, reply, toolCalls = [] }) {
  const uid = `pa_${conversationId}`
  const existing = await prisma.devConversation.findUnique({ where: { uid }, select: { id: true, body: true, bodyRedacted: true } })
  const now = new Date()
  const turn = [
    { role: 'user', content: userText, ts: now.toISOString() },
    ...toolCalls.map((t) => ({ role: 'tool', tool: t.tool, args: t.args })),
    { role: 'assistant', content: reply, ts: now.toISOString() }
  ]
  const r = redact([...messagesOf(existing?.body), ...turn])
  const turns = messagesOf(r.value).filter((m) => roleOf(m) === 'user').length
  const common = { body: r.value, bodyRedacted: !!existing?.bodyRedacted || r.redacted, turns, endedAt: now, ...(model ? { model: String(model).slice(0, 60) } : {}) }
  return prisma.devConversation.upsert({
    where: { uid },
    create: {
      uid, source: 'PLATFORM_ASSISTANT', stage: stage || 'GENERAL', engineerId: engineerId || null,
      title: title ? redact(String(title)).value.slice(0, 200) : null, startedAt: startedAt || now, createdBy: userId, ...common
    },
    update: { ...common, ...(stage ? { stage } : {}) },
    select: { id: true, uid: true }
  })
}
