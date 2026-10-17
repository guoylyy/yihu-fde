// 统一登录(OpenID Connect): 用以虎 One 账号登录(授权码 + PKCE)。拿到 access_token 后由 identity.js 换成平台用户
//
// 配置(环境变量):
// 装在以虎 One 上时这些都由 platform.js 按平台注入的 YH_* 自动补齐, 只有本地开发连自己的以虎 One 时才手动配:
//   OIDC_ISSUER            以虎 One 的访问地址, 如 https://one.example.com; 不配 = 没接平台
//   OIDC_CLIENT_ID         在身份提供方登记本应用拿到的 Client ID
//   OIDC_CLIENT_SECRET     对应的 Client Secret(只放服务端)
//   OIDC_NAME              登录按钮上显示的名字, 默认「以虎 One」
//   OIDC_REDIRECT_URI      回调地址, 默认 PUBLIC_BASE_URL + /api/auth/oidc/callback
//   OIDC_SCOPES            默认 "openid profile email"
//   OIDC_INTERNAL_URL      可选: 服务端访问身份提供方用的地址(同机 Docker 时如 http://host.docker.internal:18080),
//                          只替换 token / userinfo 端点的协议+主机; 授权页仍用浏览器能打开的 OIDC_ISSUER
//   OIDC_AUTO_CREATE       首次登录自动建本地账号, 默认 true
//   OIDC_LINK_BY_EMAIL     首次登录按已验证邮箱关联已有本地账号, 默认 true
//   OIDC_DEFAULT_ROLE      自动建号的角色, 默认 FDE_ENGINEER
//   OIDC_ADMIN_ROLES       以虎 One 里这些角色的人自动成为本系统管理员(本系统手动设过角色的除外), 逗号分隔, 默认 ADMIN; 置空 = 不映射
//
// 以虎 One 只说明「他是谁」(平台用户 id 做主键), 「他能做什么」由本系统的角色决定, 规则见 identity.js。
import crypto from 'node:crypto'

const bool = (v, dflt) => (v == null || v === '' ? dflt : !['false', '0', 'no', 'off'].includes(String(v).toLowerCase()))
const trim = (s) => String(s || '').replace(/\/+$/, '')

export function oidcConfig(env = process.env) {
  const issuer = trim(env.OIDC_ISSUER)
  const base = trim(env.PUBLIC_BASE_URL)
  return {
    enabled: !!(issuer && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET),
    issuer,
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    name: env.OIDC_NAME || '以虎 One',
    redirectUri: env.OIDC_REDIRECT_URI || (base ? `${base}/api/auth/oidc/callback` : ''),
    scopes: env.OIDC_SCOPES || 'openid profile email',
    internalUrl: trim(env.OIDC_INTERNAL_URL),
    autoCreate: bool(env.OIDC_AUTO_CREATE, true),
    linkByEmail: bool(env.OIDC_LINK_BY_EMAIL, true),
    defaultRole: env.OIDC_DEFAULT_ROLE || 'FDE_ENGINEER',
    adminRoles: (env.OIDC_ADMIN_ROLES ?? 'ADMIN').split(',').map(s => s.trim()).filter(Boolean)
  }
}

// ---------- 发现文档 ----------

let discoveryCache = null   // { issuer, at, doc }
const DISCOVERY_TTL = 3600_000

/** 服务端调用的端点: 配了 OIDC_INTERNAL_URL 时把协议+主机换掉 */
function internal(url, cfg) {
  if (!cfg.internalUrl) return url
  const u = new URL(url)
  const i = new URL(cfg.internalUrl)
  u.protocol = i.protocol
  u.host = i.host
  return u.toString()
}

/** 服务端访问身份提供方上某个路径的地址(OIDC_INTERNAL_URL 优先), 如 serverUrl('/api/open/llm') */
export function serverUrl(pathPart, cfg = oidcConfig()) {
  return internal(`${cfg.issuer}${pathPart}`, cfg)
}

export async function discover(cfg = oidcConfig()) {
  if (discoveryCache && discoveryCache.issuer === cfg.issuer && Date.now() - discoveryCache.at < DISCOVERY_TTL) {
    return discoveryCache.doc
  }
  const url = internal(`${cfg.issuer}/.well-known/openid-configuration`, cfg)
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`读取 OIDC 发现文档失败: HTTP ${r.status}`)
  const doc = await r.json()
  if (trim(doc.issuer) !== cfg.issuer) {
    throw new Error(`OIDC issuer 不一致: 配置 ${cfg.issuer}, 身份提供方返回 ${doc.issuer}`)
  }
  discoveryCache = { issuer: cfg.issuer, at: Date.now(), doc }
  return doc
}

/** 测试用: 清空发现文档缓存 */
export function resetOidcCaches() {
  discoveryCache = null
}

// ---------- 授权码流程 ----------

const b64url = (buf) => Buffer.from(buf).toString('base64url')

/** 生成 state / nonce / PKCE, 返回授权地址和要暂存的值 */
export async function buildAuthorizeRequest(cfg, redirectUri) {
  const doc = await discover(cfg)
  const state = b64url(crypto.randomBytes(24))
  const nonce = b64url(crypto.randomBytes(24))
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const u = new URL(doc.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('scope', cfg.scopes)
  u.searchParams.set('state', state)
  u.searchParams.set('nonce', nonce)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return { url: u.toString(), state, nonce, verifier }
}

function decodeJwtPayload(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')) } catch { return null }
}

/**
 * code 换 access_token(用户信息由调用方用 access_token 向平台取)。
 * token 与 userinfo 都是服务端直连身份提供方(TLS)拿到的, 按 OIDC Core 3.1.3.7 可不验 id_token 签名;
 * 这里仍核对 id_token 的 iss / aud / nonce, 防止串用别的应用或别的登录请求的 code。
 */
export async function exchangeCode(cfg, { code, redirectUri, verifier, nonce }) {
  const doc = await discover(cfg)
  const r = await fetch(internal(doc.token_endpoint, cfg), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // 与以虎 One SDK 一致: id/secret 原样拼接(不做 form 编码)
      Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }),
    signal: AbortSignal.timeout(10000)
  })
  const tok = await r.json().catch(() => ({}))
  if (!r.ok || !tok.access_token) {
    throw new Error(`换取 token 失败: ${tok.error_description || tok.error || `HTTP ${r.status}`}`)
  }
  if (tok.id_token) {
    const p = decodeJwtPayload(tok.id_token)
    const aud = Array.isArray(p?.aud) ? p.aud : [p?.aud]
    if (!p || trim(p.iss) !== cfg.issuer || !aud.includes(cfg.clientId)) throw new Error('id_token 的 iss / aud 不匹配')
    if (nonce && p.nonce !== nonce) throw new Error('id_token 的 nonce 不匹配')
  }
  return { accessToken: tok.access_token }
}
