// 从会话摘要生成经验草稿: 标题=摘要首句, 正文=决策+坑+产出, kind 按内容判断(人可再改)
import { firstSentence } from './conversations.js'

const HOWTO_RE = /(?:怎么|如何|步骤|教程|操作手册|how to)/i

/** kind: 只有坑 → PITFALL; 只有决策 → DECISION; 讲步骤 → HOWTO; 其余 EXPERIENCE */
export function guessKind({ summary = '', decisions = [], pitfalls = [] }) {
  if (pitfalls.length && !decisions.length) return 'PITFALL'
  if (decisions.length && !pitfalls.length) return 'DECISION'
  if (!decisions.length && !pitfalls.length && HOWTO_RE.test(summary)) return 'HOWTO'
  return 'EXPERIENCE'
}

/** 摘要首句; 规则摘要是「1. xxx」编号格式, 去掉编号 */
export function draftTitle(summary, fallback) {
  const s = firstSentence(String(summary || '').replace(/^\s*\d+[.、]\s*/, '')).replace(/[。.!！?？]+$/, '')
  return (s || String(fallback || '').trim() || '未命名经验').slice(0, 200)
}

export function draftBody({ summary = '', decisions = [], pitfalls = [], artifacts = [] }) {
  const sec = (h, items, fmt = (x) => x) => (items.length ? `## ${h}\n\n${items.map((x) => `- ${fmt(x)}`).join('\n')}` : '')
  const code = (x) => (/^(?:commit [0-9a-f]+|[\w@./-]+\.[A-Za-z0-9]{1,8})$/.test(x) ? `\`${x}\`` : x)
  const parts = [sec('决策', decisions), sec('踩坑', pitfalls), sec('产出', artifacts, code)].filter(Boolean)
  return parts.length ? parts.join('\n\n') : String(summary || '').trim()
}

/** 摘要结果 + 会话 → { title, body, kind, tags } */
export function draftFromSummary(s, conv) {
  return {
    title: draftTitle(s.summary, conv?.title),
    body: draftBody(s) || '（会话没有可沉淀的内容，请补充）',
    kind: guessKind(s),
    tags: Array.isArray(s.tags) ? s.tags.slice(0, 10) : []
  }
}
