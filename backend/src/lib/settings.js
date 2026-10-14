// 系统设置: 管理员在「系统设置」页改的本系统开关(存 app_settings, key 前缀 sys.)
// 品牌外观、访问地址、登录凭证都来自以虎 One, 不在这里配。
import prisma from './prisma.js'
import { basePathOf } from './platform.js'

const PREFIX = 'sys.'

export const SETTING_DEFS = [
  // 部门负责人(以虎 One 里负责某个部门的人)首次登录 / 未被手动改过角色时自动成为项目经理
  { key: 'auth.leaderIsManager', group: 'auth', type: 'bool', default: false },
  // 站内通知同时经以虎 One 发到本人的钉钉 / 飞书 / 企业微信
  { key: 'notify.platform', group: 'notify', type: 'bool', default: true }
]
const DEF_BY_KEY = new Map(SETTING_DEFS.map(d => [d.key, d]))

let saved = {}       // key → 规整后的值
let loaded = false

const parse = (d, raw) => (d.type === 'bool' ? raw === 'true' : raw)

/** 从库里加载保存的设置(启动时调用; 表不可用时用默认值) */
export async function loadSettings() {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } })
  saved = {}
  for (const r of rows) {
    const d = DEF_BY_KEY.get(r.key.slice(PREFIX.length))
    if (d) saved[d.key] = parse(d, r.value)
  }
  loaded = true
  return Object.keys(saved).length
}

/** 取一项的生效值(保存的值, 否则默认值); 首次调用时懒加载 */
export async function getSetting(key) {
  const d = DEF_BY_KEY.get(key)
  if (!d) throw new Error(`未知设置项: ${key}`)
  if (!loaded) await loadSettings().catch(() => { loaded = true })
  return key in saved ? saved[key] : d.default
}

/** 校验并规整一个值; null 表示恢复默认。非法时抛 Error(message 给用户看) */
export function normalizeSetting(key, raw) {
  const d = DEF_BY_KEY.get(key)
  if (!d) throw new Error(`未知设置项: ${key}`)
  if (raw === null || raw === undefined || raw === '') return null
  if (d.type === 'bool') {
    if (typeof raw !== 'boolean') throw new Error(`${key} 须为 true / false`)
    return raw
  }
  return String(raw)
}

/** 批量保存: values = { key: 值 | null }; 先全部校验再写库, 写完立即生效 */
export async function saveSettings(values, userId) {
  const changes = []
  for (const [key, raw] of Object.entries(values || {})) changes.push([key, normalizeSetting(key, raw)])
  await prisma.$transaction(changes.map(([key, v]) => v === null
    ? prisma.appSetting.deleteMany({ where: { key: PREFIX + key } })
    : prisma.appSetting.upsert({
      where: { key: PREFIX + key },
      update: { value: String(v), updatedBy: userId ? BigInt(userId) : null },
      create: { key: PREFIX + key, value: String(v), updatedBy: userId ? BigInt(userId) : null }
    })))
  for (const [key, v] of changes) {
    if (v === null) delete saved[key]
    else saved[key] = v
  }
  return changes.map(([key]) => key)
}

/** 每一项的当前值(给设置页) */
export function describeSettings() {
  return SETTING_DEFS.map(d => ({
    key: d.key, group: d.group, type: d.type, default: d.default,
    value: d.key in saved ? saved[d.key] : d.default
  }))
}

/** 本系统的对外地址: 平台注入的(经 platform.js 写进 PUBLIC_BASE_URL), 否则按请求推导(带平台路径前缀) */
export function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  if (!req) return ''
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim()
  return `${proto}://${host}${basePathOf(req)}`
}

/** 本系统自己的 MCP 地址(Agent 专属 Key 用): 对外地址 + /api/mcp */
export function mcpUrl(req) {
  const base = publicBaseUrl(req)
  return base ? `${base}/api/mcp` : '/api/mcp'
}
