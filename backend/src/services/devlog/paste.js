// 粘贴通道: 一段纯文本对话 → messages[]; uid 按文本内容哈希, 同一段文本重复粘贴落到同一条会话
import { createHash } from 'node:crypto'
import { firstSentence } from './conversations.js'

export const MAX_PASTE_CHARS = 2_000_000

// 行首角色标记: 「用户: / 助手: / Human: / Assistant:」(中英文冒号), 也认 User / AI / Claude
const ROLE_HEAD = /^\s*(?:\*\*)?(用户|助手|human|assistant|user|ai|claude)(?:\*\*)?\s*[:：](?:\*\*)?\s?(.*)$/i
const ROLE_MAP = { 用户: 'user', human: 'user', user: 'user', 助手: 'assistant', assistant: 'assistant', ai: 'assistant', claude: 'assistant' }

/** 统一换行、去首尾空白; 哈希与解析都基于它(末尾多个换行不算新文本) */
export const normalizePaste = (text) => String(text ?? '').replace(/\r\n?/g, '\n').trim()

export const pasteUid = (text) => 'paste_' + createHash('sha256').update(normalizePaste(text)).digest('hex').slice(0, 24)

/**
 * 按角色标记切块。第一个标记之前的文字算一条 user 消息; 一个标记都没有时整段算一条 user 消息。
 * @returns {{ messages: {role,content}[], marked: boolean }}
 */
export function parsePaste(text) {
  const lines = normalizePaste(text).split('\n')
  const messages = []
  let cur = null
  let marked = false
  const flush = () => {
    if (cur) {
      const content = cur.lines.join('\n').trim()
      if (content) messages.push({ role: cur.role, content })
    }
  }
  for (const line of lines) {
    const m = line.match(ROLE_HEAD)
    if (m) {
      flush()
      marked = true
      cur = { role: ROLE_MAP[m[1].toLowerCase()], lines: [m[2]] }
    } else {
      if (!cur) cur = { role: 'user', lines: [] }
      cur.lines.push(line)
    }
  }
  flush()
  return { messages, marked }
}

/** 没给标题时: 第一条 user 消息的首句 */
export function pasteTitle(messages) {
  const first = messages.find((m) => m.role === 'user') || messages[0]
  return first ? firstSentence(first.content).slice(0, 200) : null
}
