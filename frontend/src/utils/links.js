// 通知等来源给的跳转地址: 站内路径走路由; 完整网址(如官网管理后台, 已是独立项目)新开页
export function isExternalLink(link) {
  return /^https?:\/\//i.test(String(link || ''))
}

export function openLink(router, link) {
  if (!link) return
  if (isExternalLink(link)) window.open(link, '_blank', 'noopener')
  else router.push(link)
}
