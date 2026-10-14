/**
 * 品牌 —— 跟随以虎 One
 *
 * 本系统作为以虎 One 的应用运行, 外观以平台为准(GET /api/open/app, 见 lib/yihuOne.js):
 *   name          应用在平台上登记的名称(如「FDE 交付管理」)
 *   logoUrl       平台(或本应用所属空间)的 LOGO
 *   primaryColor  平台主题的强调色(highlight), 页面上的主色 var(--brand-primary)
 *   platformName  平台(或空间)名称, 如「以虎 One」
 * 没接平台(本地开发)时用下方默认值。
 */
import { cachedAppInfo } from '../lib/yihuOne.js'

const DEFAULTS = {
  name: 'FDE Platform',
  tagline: '',   // 留空 = 前端按界面语言显示默认副标题
  logoUrl: '',
  primaryColor: '#f54e00',
  siteUrl: '',
  platformName: ''
}

export function getBrand(app = cachedAppInfo()) {
  const b = app?.brand
  const color = b?.theme?.tokens?.highlight
  return {
    name: app?.name || DEFAULTS.name,
    tagline: DEFAULTS.tagline,
    logoUrl: b?.logo || DEFAULTS.logoUrl,
    primaryColor: /^#[0-9a-f]{6}$/i.test(color || '') ? color : DEFAULTS.primaryColor,
    siteUrl: (process.env.PUBLIC_BASE_URL || DEFAULTS.siteUrl).replace(/\/$/, ''),
    platformName: b?.name || DEFAULTS.platformName
  }
}

export { DEFAULTS as BRAND_DEFAULTS }
