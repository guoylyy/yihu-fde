// 系统设置: 管理员在「系统设置」页改的实例级配置(品牌外观、访问地址)
//
// 每一项都对应一个环境变量, 取值优先级: 页面上保存的值 > 环境变量 > 内置默认。
// 保存的值存在 app_settings 表(key 前缀 sys.), 启动时与保存后写回 process.env —— 读这些环境变量的
// 既有代码(config/brand.js、oidc.js、storage.js、onboarding 配置包)不用改就跟着生效。
// 原始环境变量在加载本模块时留底, 页面上清空某项就恢复成它。
import prisma from './prisma.js'
import { basePathOf } from './platform.js'

const PREFIX = 'sys.'

export const SETTING_DEFS = [
  { key: 'brand.name', env: 'BRAND_NAME', group: 'brand', type: 'text', max: 50 },
  { key: 'brand.tagline', env: 'BRAND_TAGLINE', group: 'brand', type: 'text', max: 100 },
  { key: 'brand.logoUrl', env: 'BRAND_LOGO_URL', group: 'brand', type: 'image', max: 500 },
  { key: 'brand.primaryColor', env: 'BRAND_PRIMARY_COLOR', group: 'brand', type: 'color' },
  { key: 'url.publicBase', env: 'PUBLIC_BASE_URL', group: 'url', type: 'url', max: 300 },
  { key: 'url.mcp', env: 'PUBLIC_MCP_URL', group: 'url', type: 'url', max: 300 }
]
const DEF_BY_KEY = new Map(SETTING_DEFS.map(d => [d.key, d]))

// 加载本模块时的环境变量(platform.js 已经补过默认值), 清空设置时恢复成它
const ORIGINAL_ENV = Object.fromEntries(SETTING_DEFS.map(d => [d.env, process.env[d.env]]))

let saved = {}   // key → 页面上保存的值

function apply() {
  for (const d of SETTING_DEFS) {
    const v = saved[d.key] ?? ORIGINAL_ENV[d.env]
    if (v === undefined || v === '') delete process.env[d.env]
    else process.env[d.env] = v
  }
}

/** 从库里加载保存的设置并生效(启动时调用; 表不可用时保持环境变量) */
export async function loadSettings() {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } })
  saved = {}
  for (const r of rows) {
    const key = r.key.slice(PREFIX.length)
    if (DEF_BY_KEY.has(key) && r.value) saved[key] = r.value
  }
  apply()
  return Object.keys(saved).length
}

/**
 * 校验并规整一个值; 空串/null 表示清除(回到环境变量或默认)。非法时抛 Error(message 给用户看)
 */
export function normalizeSetting(key, raw) {
  const d = DEF_BY_KEY.get(key)
  if (!d) throw new Error(`未知设置项: ${key}`)
  if (raw === null || raw === undefined) return null
  const v = String(raw).trim()
  if (!v) return null
  if (/[\u0000-\u001f]/.test(v)) throw new Error(`${key} 含有不可见字符`)
  if (d.max && v.length > d.max) throw new Error(`${key} 最长 ${d.max} 个字符`)
  if (d.type === 'color') {
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) throw new Error('主色须为 #RRGGBB 格式, 如 #f54e00')
    return v.toLowerCase()
  }
  if (d.type === 'url' || d.type === 'image') {
    // 图片也可以是站内路径(上传后得到的 /uploads/...)
    if (d.type === 'image' && v.startsWith('/') && !v.startsWith('//')) return v
    let u
    try { u = new URL(v) } catch { throw new Error(`${key} 不是有效的地址`) }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`${key} 只支持 http / https 地址`)
    return d.type === 'url' ? v.replace(/\/+$/, '') : v
  }
  return v
}

/** 批量保存: values = { key: 值 | null }; 先全部校验再写库, 写完立即生效 */
export async function saveSettings(values, userId) {
  const changes = []
  for (const [key, raw] of Object.entries(values || {})) changes.push([key, normalizeSetting(key, raw)])
  await prisma.$transaction(changes.map(([key, v]) => v === null
    ? prisma.appSetting.deleteMany({ where: { key: PREFIX + key } })
    : prisma.appSetting.upsert({
      where: { key: PREFIX + key },
      update: { value: v, updatedBy: userId ? BigInt(userId) : null },
      create: { key: PREFIX + key, value: v, updatedBy: userId ? BigInt(userId) : null }
    })))
  for (const [key, v] of changes) {
    if (v === null) delete saved[key]
    else saved[key] = v
  }
  apply()
  return changes.map(([key]) => key)
}

/** 每一项的当前情况: 保存的值 / 环境变量 / 实际生效值与来源 */
export function describeSettings() {
  return SETTING_DEFS.map(d => {
    const envValue = ORIGINAL_ENV[d.env] || null
    const value = saved[d.key] ?? null
    return {
      key: d.key, group: d.group, type: d.type, env: d.env, max: d.max || null,
      value, envValue,
      source: value ? 'settings' : envValue ? 'env' : 'default'
    }
  })
}

/** 本系统的对外地址: 设置/环境变量里的, 否则按请求推导(反向代理时取 X-Forwarded-*, 带平台路径前缀) */
export function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  if (!req) return ''
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim()
  return `${proto}://${host}${basePathOf(req)}`
}

/** 给智能体用的 MCP 地址: 显式配置 > 对外地址 + /api/mcp */
export function mcpUrl(req) {
  if (process.env.PUBLIC_MCP_URL) return process.env.PUBLIC_MCP_URL
  const base = publicBaseUrl(req)
  return base ? `${base}/api/mcp` : '/api/mcp'
}
