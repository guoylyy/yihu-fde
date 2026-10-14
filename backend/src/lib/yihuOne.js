// 以虎 One 平台客户端: 本系统只作为以虎 One 的应用运行, 身份、通讯录、外观、消息都以平台为准
//
// 地址与凭证来自统一登录配置(oidc.js 的 oidcConfig: OIDC_ISSUER / OIDC_INTERNAL_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET),
// 装在平台上时由 platform.js 用平台注入的 YH_* 自动补齐。服务端调用一律走容器网络地址(serverUrl)。
//   GET  /api/sso/userinfo   access_token → 平台用户(角色、空间、部门、负责的部门)
//   GET  /api/open/app       本应用所属空间与平台外观
//   GET  /api/open/users     通讯录(增量)
//   POST /api/open/notify    给个人发钉钉 / 飞书 / 企业微信消息
//   POST /api/open/events    上报使用数据
import crypto from 'node:crypto'
import { oidcConfig, serverUrl } from './oidc.js'

const TIMEOUT_MS = 10000

export class PlatformError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

/** 是否接上了以虎 One(本地开发不配也能跑, 只是统一登录等不可用) */
export const platformEnabled = (cfg = oidcConfig()) => cfg.enabled

const basic = (cfg) => 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')

/** 调平台接口, 返回 data(平台统一 { code, data } 包装); 失败抛 PlatformError */
async function call(pathPart, { method = 'GET', body, auth, cfg = oidcConfig() } = {}) {
  if (!cfg.enabled) throw new PlatformError('还没有接入以虎 One(未配置统一登录)', 503)
  let r
  try {
    r = await fetch(serverUrl(pathPart, cfg), {
      method,
      headers: { Authorization: auth || basic(cfg), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (e) {
    throw new PlatformError(`连不上以虎 One：${e.message}`, 502)
  }
  const json = await r.json().catch(() => null)
  if (!r.ok || json?.code !== 0) throw new PlatformError(json?.message || `以虎 One 返回 ${r.status}`, r.status)
  return json.data
}

// ---------- 身份 ----------

const userCache = new Map()   // sha256(token) → { at, user }
const USER_TTL = 300_000

/**
 * 应用 access_token → 平台用户 { id, username, name, avatar, roles, space, depts, leaderOf, email, mobile }
 * 无效 token 返回 null。登录回调与 MCP(平台助手 / 个人 API Key 经平台转发)都用它
 */
export async function platformUser(accessToken, cfg = oidcConfig()) {
  if (!accessToken || !cfg.enabled) return null
  const key = crypto.createHash('sha256').update(accessToken).digest('hex')
  const hit = userCache.get(key)
  if (hit && Date.now() - hit.at < USER_TTL) return hit.user
  let user = null
  try {
    user = await call('/api/sso/userinfo', { auth: `Bearer ${accessToken}`, cfg })
  } catch (e) {
    if (e.status !== 401) throw e
  }
  if (userCache.size > 5000) userCache.clear()
  userCache.set(key, { at: Date.now(), user })
  return user
}

// ---------- 本应用信息(空间、外观) ----------

let appCache = null   // { at, data }
const APP_TTL = 600_000

/** 本应用在平台上的信息; 取不到时返回上次的(或 null), 不让外观/空间判断拖垮请求 */
export async function appInfo({ force = false, cfg = oidcConfig() } = {}) {
  if (!cfg.enabled) return null
  if (!force && appCache && Date.now() - appCache.at < APP_TTL) return appCache.data
  try {
    const data = await call('/api/open/app', { cfg })
    appCache = { at: Date.now(), data }
    return data
  } catch (e) {
    console.warn('[yihu-one] 读取应用信息失败:', e.message)
    return appCache?.data || null
  }
}

/** 同步读缓存的应用信息(给 getBrand 这类同步取值用); 没有则 null */
export const cachedAppInfo = () => appCache?.data || null

export function resetPlatformCaches() {
  userCache.clear()
  appCache = null
}

// ---------- 通讯录 / 消息 / 使用数据 ----------

/** 通讯录: 含已停用的人; updatedSince 做增量 */
export async function listDirectory({ updatedSince } = {}, cfg = oidcConfig()) {
  const q = new URLSearchParams({ includeInactive: 'true', ...(updatedSince ? { updatedSince: new Date(updatedSince).toISOString() } : {}) })
  return call(`/api/open/users?${q}`, { cfg })
}

/** 给平台用户发消息; 返回 { sent, skipped } */
export async function notifyPlatformUsers({ userIds, title, content, url }, cfg = oidcConfig()) {
  return call('/api/open/notify', { method: 'POST', body: { userIds, title, content, url }, cfg })
}

/** 上报使用数据(一批) */
export async function postEvents(events, cfg = oidcConfig()) {
  return call('/api/open/events', { method: 'POST', body: { events }, cfg })
}
