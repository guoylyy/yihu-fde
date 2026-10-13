// Markdown → 安全 HTML：资产方案等由用户录入的 Markdown 用这个渲染
// marked 不做消毒；这里用 DOMParser 去掉脚本、内嵌框架、事件属性和 javascript: 链接（不引新依赖）。
import { marked } from 'marked'

const DROP_TAGS = ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'form']

export function renderSafeMarkdown(md) {
  const html = marked.parse(md || '', { gfm: true, breaks: false })
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
  // 表格包一层横滚容器，窄屏不撑破布局
  root.querySelectorAll('table').forEach(t => {
    const wrap = doc.createElement('div')
    wrap.className = 'md-table-wrap'
    t.parentNode.insertBefore(wrap, t)
    wrap.appendChild(t)
  })
  return root.innerHTML
}
