// OKR 前端小收口: 人名筛选器显示(纯函数, 有单测)。
// 精简第二轮: 项目 OKR 页下线, 「默认只看进行中项目」那部分一并删除。

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
