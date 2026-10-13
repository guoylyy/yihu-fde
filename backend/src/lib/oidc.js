// 统一登录(OpenID Connect): 用以虎 One 或任何标准 OIDC 身份提供方的账号登录
//
// 配置(环境变量):
//   OIDC_ISSUER            身份提供方地址, 如 https://one.example.com (以虎 One 的「访问地址」); 不配 = 关闭
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
//   OIDC_ADMIN_ROLES       身份提供方里这些角色的人建号时给 ADMIN, 逗号分隔, 默认 ADMIN; 置空 = 不映射
//   OIDC_ROLES_CLAIM       角色所在的 claim, 默认 roles
//
// 身份提供方只说明「他是谁」(sub 做主键), 「他能做什么」由本系统的角色决定: 已有账号的角色不随登录改动。
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import prisma from './prisma.js'
import { isValidRole } from './auth.js'
import { ENGINEER_ROLES } from './engineerRoles.js'

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
    adminRoles: (env.OIDC_ADMIN_ROLES ?? 'ADMIN').split(',').map(s => s.trim()).filter(Boolean),
    rolesClaim: env.OIDC_ROLES_CLAIM || 'roles'
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

/** 测试用: 清空发现文档与 access_token 缓存 */
export function resetOidcCaches() {
  discoveryCache = null
  tokenCache.clear()
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
 * code 换 token, 再取 userinfo。
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
  const claims = await fetchUserinfo(cfg, tok.access_token)
  if (!claims) throw new Error('读取用户信息失败')
  return { claims, accessToken: tok.access_token }
}

export async function fetchUserinfo(cfg, accessToken) {
  const doc = await discover(cfg)
  const r = await fetch(internal(doc.userinfo_endpoint, cfg), {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000)
  })
  if (!r.ok) return null
  const claims = await r.json().catch(() => null)
  return claims?.sub ? claims : null
}

// ---------- 身份 → 本地账号 ----------

/** 由 claims 拼一个合法且未占用的用户名(小写字母/数字/._-, ≤50) */
export function usernameCandidates(claims) {
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 40)
  const base = clean(claims.preferred_username) || clean(String(claims.email || '').split('@')[0]) || 'user'
  const sub = clean(claims.sub).slice(-8) || crypto.randomBytes(4).toString('hex')
  return [base, `${base}-${sub}`, `${base}-${crypto.randomBytes(4).toString('hex')}`]
}

/** 首次登录建号用的角色: 身份提供方里的管理员角色 → ADMIN, 其余 → 默认角色 */
export function roleFor(claims, cfg) {
  const raw = claims[cfg.rolesClaim]
  const roles = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []
  if (cfg.adminRoles.some(r => roles.includes(r))) return 'ADMIN'
  return cfg.defaultRole
}

export class OidcLoginError extends Error {}

/**
 * 按 sub 找本地账号; 没有就(按配置)用已验证邮箱关联, 或自动建号。
 * 返回 user(含 engineer); 账号停用/删除或不允许自动建号时抛 OidcLoginError
 */
export async function findOrCreateUser(claims, cfg = oidcConfig()) {
  const sub = String(claims.sub)
  let user = await prisma.user.findUnique({ where: { oidcSubject: sub }, include: { engineer: true } })

  if (!user && cfg.linkByEmail && claims.email && claims.email_verified === true) {
    const byEmail = await prisma.user.findMany({
      where: { email: String(claims.email), oidcSubject: null, deletedAt: null },
      take: 2
    })
    // 只在唯一命中时关联, 同邮箱多个账号时宁可新建也不猜
    if (byEmail.length === 1) {
      user = await prisma.user.update({
        where: { id: byEmail[0].id },
        data: { oidcSubject: sub },
        include: { engineer: true }
      })
    }
  }

  if (!user) {
    if (!cfg.autoCreate) throw new OidcLoginError('本系统还没有为你开通账号, 请联系管理员')
    const role = roleFor(claims, cfg)
    if (!isValidRole(role)) throw new OidcLoginError(`OIDC_DEFAULT_ROLE 配置的角色 ${role} 不存在`)
    let username = null
    for (const cand of usernameCandidates(claims)) {
      if (!(await prisma.user.findUnique({ where: { username: cand } }))) { username = cand; break }
    }
    // 本地密码设成随机值: 统一登录的账号不走密码登录(管理员可在用户管理里重置后再用)
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
    user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        name: String(claims.name || claims.preferred_username || username).slice(0, 50),
        email: claims.email ? String(claims.email).slice(0, 100) : null,
        phone: claims.phone_number ? String(claims.phone_number).slice(0, 20) : null,
        avatarUrl: claims.picture ? String(claims.picture).slice(0, 500) : null,
        role,
        status: 1,
        oidcSubject: sub
      }
    })
    if (ENGINEER_ROLES.includes(role)) {
      await prisma.engineer.create({ data: { userId: user.id, available: 1 } })
    }
    user = await prisma.user.findUnique({ where: { id: user.id }, include: { engineer: true } })
    console.log(`[oidc] 新建账号 ${user.username} (${role}) ← sub ${sub}`)
  }

  if (user.status !== 1 || user.deletedAt) throw new OidcLoginError('你的账号已停用, 请联系管理员')
  return user
}

// ---------- MCP: 身份提供方签发的 access_token → 本地用户 ----------

const tokenCache = new Map()   // sha256(token) → { at, user }
const TOKEN_CACHE_TTL = 300_000

/**
 * 以虎 One 的 AI 助手调本系统 MCP 时带的是它签发的 access_token:
 * 用 userinfo 换成身份(5 分钟缓存), 再映射到本地账号。不是有效 token 时返回 null
 */
export async function resolveOidcAccessToken(raw, cfg = oidcConfig()) {
  if (!cfg.enabled || !raw) return null
  const key = crypto.createHash('sha256').update(raw).digest('hex')
  const hit = tokenCache.get(key)
  if (hit && Date.now() - hit.at < TOKEN_CACHE_TTL) return hit.user
  let user = null
  try {
    const claims = await fetchUserinfo(cfg, raw)
    if (claims) user = await findOrCreateUser(claims, cfg)
  } catch (e) {
    if (!(e instanceof OidcLoginError)) console.warn('[oidc] access_token 校验失败:', e.message)
    user = null
  }
  if (tokenCache.size > 5000) tokenCache.clear()
  tokenCache.set(key, { at: Date.now(), user })
  return user
}
