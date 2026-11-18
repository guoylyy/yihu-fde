// 0.5.0 开发会话 / 经验的前端常量与小工具(与后端 services/devlog/conversations.js 同口径)
export const SOURCES = ['PLATFORM_ASSISTANT', 'HERMES', 'CLAUDE_CODE', 'CODEX', 'PASTE']
export const STAGES = ['REQUIREMENT', 'DESIGN', 'CODING', 'TEST', 'RETRO', 'GENERAL']
export const STATUSES = ['PENDING_LINK', 'LINKED', 'IGNORED']
export const EXPERIENCE_KINDS = ['EXPERIENCE', 'DECISION', 'PITFALL', 'HOWTO', 'DRIFT']

/** Json 列可能是数组/字符串/null, 统一成字符串数组 */
export function strList(v) {
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : x?.text || JSON.stringify(x))).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

/** 正文 messages[] → [{ role, content }], 容错各种采集器格式 */
export function bodyMessages(body) {
  if (!Array.isArray(body)) return []
  return body
    .map(m => ({ role: String(m?.role || m?.speaker || 'note'), content: typeof m?.content === 'string' ? m.content : (m?.text ?? JSON.stringify(m?.content ?? '')) }))
    .filter(m => m.content)
}

/** 会话时间: 有开始时间用开始时间, 否则用入库时间; 返回 'MM-DD HH:mm' */
export function convTime(c) {
  const iso = c?.startedAt || c?.createdAt
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
