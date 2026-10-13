import { $t } from '../../../i18n/index.js'
// v2.10.0(#1180) 创意中心 —— 页面与组件共用的小工具

export const IDEA_STATUS = {
  OPEN: { label: $t('common.under_discussion'), type: 'info' },
  ADOPTED: { label: $t('common.converted_milestone'), type: 'success' },
  PARKED: { label: $t('common.shelve'), type: 'warning' },
  ARCHIVED: { label: $t('common.archived'), type: 'info' }   // v2.12.1(#1274)
}

/** Markdown 摘要 → 列表里显示的纯文本(去掉图片、标记符号, 压成一段) */
export function plainExcerpt(md, max = 160) {
  const text = String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max) + '…' : text
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** 评论是纯文本: 先转义再高亮 @提及、保留换行(不走 Markdown, 也不让 HTML 进来) */
export function renderComment(text) {
  return String(text || '')
    .replace(/[&<>"']/g, ch => ESCAPES[ch])
    .replace(/@([\w一-龥]+)/g, '<span class="at-mention">@$1</span>')
    .replace(/\n/g, '<br>')
}

export function isImage(att) {
  return /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(att?.fileUrl || att?.filename || '')
}

/** 评论按两层组织: 顶层评论 + 各自的回复 */
export function threadComments(comments = []) {
  const tops = comments.filter(c => !c.parentId).map(c => ({ ...c, replies: [] }))
  const byId = new Map(tops.map(c => [String(c.id), c]))
  for (const c of comments) {
    if (!c.parentId) continue
    const parent = byId.get(String(c.parentId))
    // 楼主那条被删了的回复, 升为顶层, 不让它凭空消失
    if (parent) parent.replies.push(c)
    else tops.push({ ...c, replies: [] })
  }
  return tops.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
}
