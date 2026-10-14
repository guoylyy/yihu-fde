// Markdown → 安全 HTML：资产方案等由用户录入的 Markdown 用这个渲染
// marked 不做消毒；这里用 DOMParser 去掉脚本、内嵌框架、事件属性和 javascript: 链接（不引新依赖）。
import { marked } from 'marked'

const DROP_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'form']

/** 去掉 HTML 里能执行代码的部分(脚本 / 内嵌框架 / 事件属性 / javascript: 链接), 返回 { doc, root } 便于继续加工 */
function clean(html) {
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html')
  const root = doc.getElementById('r')
  root.querySelectorAll(DROP_TAGS.join(',')).forEach(el => el.remove())
  root.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const val = String(attr.value || '').trim().toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && (val.startsWith('javascript:') || val.startsWith('data:text/html'))) el.removeAttribute(attr.name)
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer') }
  })
  return { doc, root }
}

/** 已经是 HTML 的(如自己加工过的 marked 输出): 只做消毒 */
export function sanitizeHtml(html) {
  return clean(html || '').root.innerHTML
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch])

/**
 * 评论纯文本 → 安全 HTML: 先转义, 再把 @提及 高亮。
 * names: 已知的姓名 / 用户名(姓名可能带空格, 如 "Sam Chen"), 长的先匹配; 没给就按 @连续字符 兜底
 */
export function renderMentionText(text, names = []) {
  let html = escapeHtml(text)
  const known = [...new Set(names.filter(Boolean).map(n => escapeHtml(n)))].sort((a, b) => b.length - a.length)
  const parts = known.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = parts.length ? new RegExp(`@(${parts.join('|')}|[\\w一-龥]+)`, 'g') : /@([\w一-龥]+)/g
  html = html.replace(re, '<span class="at-mention">@$1</span>')
  return html
}

export function renderSafeMarkdown(md) {
  const html = marked.parse(md || '', { gfm: true, breaks: false })
  const { doc, root } = clean(html)
  // 表格包一层横滚容器，窄屏不撑破布局
  root.querySelectorAll('table').forEach(t => {
    const wrap = doc.createElement('div')
    wrap.className = 'md-table-wrap'
    t.parentNode.insertBefore(wrap, t)
    wrap.appendChild(t)
  })
  return root.innerHTML
}
