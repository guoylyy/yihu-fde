/**
 * 版本(edition)信息 —— 多实例前端侧
 *
 * 一个前端镜像跑所有实例, 版本差异在运行时从 /api/public/edition 取(免登录,
 * 登录页在登录前就要知道实例的品牌)。登录后的菜单不用管这里: 后端
 * /role-permissions/mine 已经按模块过滤过权限, 菜单会自动收敛。
 *
 *   full   = 全部模块都开
 *   tenant = 裁剪过的实例(关掉了部分模块)
 */
const KEY = 'fde_edition'

/** 同步读缓存; 首帧就要用(路由守卫), 所以不能等接口 */
export function getEdition() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}

export function isTenantEdition() {
  return getEdition()?.edition === 'tenant'
}

/** 实例品牌(名字/副标题/Logo/主色); 没取到用默认 */
export const DEFAULT_BRAND = { name: 'FDE Platform', tagline: '', logoUrl: '', primaryColor: '#f54e00', siteUrl: '' }
export function getBrand() {
  return getEdition()?.brand || DEFAULT_BRAND
}

/** 本系统版本号(后端 package.json); 没取到返回空串 */
export function getVersion() {
  return getEdition()?.version || ''
}

/** 这个版本的更新说明 */
export const releaseNotesUrl = (v) => `https://github.com/guoylyy/yihu-fde/releases/tag/v${v}`

export function moduleEnabled(code) {
  const e = getEdition()
  if (!e || !Array.isArray(e.enabledModules)) return true
  return e.enabledModules.includes(code)
}

/** 应用启动时拉一次, 失败保持上次缓存(或按全量走) */
export async function refreshEdition() {
  try {
    const res = await fetch('/api/public/edition')
    const data = await res.json()
    if (data.code !== 0) return getEdition()
    localStorage.setItem(KEY, JSON.stringify(data.data))
    applyBrand(data.data.brand)
    return data.data
  } catch {
    return getEdition()
  }
}

/** 把品牌落到文档上: 浏览器标题 + 主色 CSS 变量(组件用 var(--brand-primary)) */
export function applyBrand(brand = getBrand()) {
  if (typeof document === 'undefined' || !brand) return
  const name = brand.name || DEFAULT_BRAND.name
  document.title = brand.tagline ? `${name} - ${brand.tagline}` : name
  document.documentElement.style.setProperty('--brand-primary', brand.primaryColor || DEFAULT_BRAND.primaryColor)
}
