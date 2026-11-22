// OKR 前端小收口: 项目 OKR 页默认只看进行中项目 + 人名筛选器显示(纯函数, 有单测)
//
// 后端 /okr/project-docs 不变: 返回全部未关闭项目(+ 本周有文档的), 每行带 project.status。
// 「进行中」= 已批准 / 进行中; 本周已有文档的项目不管状态都算(说明有人在推进)。

export const ACTIVE_PROJECT_STATUSES = ['APPROVED', 'IN_PROGRESS']
export const PROJECT_SCOPES = ['active', 'all']

export function isActiveProjectRow(r) {
  return !!r?.hasDoc || ACTIVE_PROJECT_STATUSES.includes(r?.project?.status)
}

/** 项目列表视图: scope=active 过滤到进行中; 有文档的排前, 其余按项目名; 计数按过滤后的算, allTotal 是接口返回的总数 */
export function projectDocView(list, scope = 'active') {
  const all = list?.rows || []
  const picked = scope === 'all' ? all : all.filter(isActiveProjectRow)
  const rows = picked
    .map((r, i) => [r, i])
    .sort(([a, i], [b, j]) => Number(!!b.hasDoc) - Number(!!a.hasDoc) || String(a.project?.name ?? '').localeCompare(String(b.project?.name ?? ''), 'zh') || i - j)
    .map(([r]) => r)
  return { scope, rows, total: rows.length, withDoc: rows.filter(r => r.hasDoc).length, allTotal: all.length }
}

/** 粗估文字宽度(px, 14px 字号): 全角字 14, 其余 8 */
export function textWidth(s) {
  let w = 0
  for (const ch of Array.from(String(s ?? ''))) w += /[⺀-￿]/.test(ch) ? 14 : 8
  return w
}

/**
 * 人名筛选器宽度: 头像 24 + 间距 + 姓名 + 「（我）」+ 内边距与箭头, 夹在 [min, max] 之间,
 * 选中后按钮跟着姓名变宽, 不截断
 */
export function pickerWidth(name, { isMe = false, meText = '', min = 140, max = 360 } = {}) {
  const w = 24 + 6 + textWidth(name) + (isMe ? 4 + Math.round(textWidth(meText) * 12 / 14) : 0) + 48
  return Math.max(min, Math.min(max, w))
}
