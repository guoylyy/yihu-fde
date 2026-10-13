/**
 * 品牌配置 —— 多实例的第二层差异(第一层是 config/edition.js 的模块开关)
 *
 * 界面上的名字/标识/主色由环境变量决定, 不配用下方默认值。
 * 只管「后台 + 客户门户 + 邮件 + 智能体提示词」这些登录前后都要用、又不适合每次查库的品牌位。
 *
 *   BRAND_NAME=Acme Delivery      # 顶栏/登录页/浏览器标题/邮件/AI 助手自称
 *   BRAND_TAGLINE=交付管理平台      # 登录页副标题
 *   BRAND_LOGO_URL=https://.../logo.png   # 留空用内置标志
 *   BRAND_PRIMARY_COLOR=#1f5d8c
 *   BRAND_SITE_URL=https://example.com    # 对外链接(邮件按钮/邀请落地页)的站点根地址
 */
const DEFAULTS = {
  name: 'FDE Platform',
  tagline: '',   // 留空 = 前端按界面语言显示默认副标题
  logoUrl: '',
  primaryColor: '#f54e00',
  siteUrl: ''
}

export function getBrand(env = process.env) {
  return {
    name: env.BRAND_NAME || DEFAULTS.name,
    tagline: env.BRAND_TAGLINE || DEFAULTS.tagline,
    logoUrl: env.BRAND_LOGO_URL || DEFAULTS.logoUrl,
    primaryColor: env.BRAND_PRIMARY_COLOR || DEFAULTS.primaryColor,
    siteUrl: (env.BRAND_SITE_URL || env.PUBLIC_BASE_URL || DEFAULTS.siteUrl).replace(/\/$/, '')
  }
}

/** 是否用的默认品牌 —— 日志与自检用 */
export function isDefaultBrand(env = process.env) {
  return getBrand(env).name === DEFAULTS.name
}

export { DEFAULTS as BRAND_DEFAULTS }
