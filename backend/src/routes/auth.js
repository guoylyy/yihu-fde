// 认证路由: 只用以虎 One 账号登录(OIDC 授权码 + PKCE)
// 本地开发 / 测试另有开发登录(DEV_LOGIN=true 且非生产、未装在平台上), 线上不存在
import express from 'express'
import crypto from 'node:crypto'
import prisma from '../lib/prisma.js'
import { signToken, verifyToken, internalAuth } from '../lib/auth.js'
import { oidcConfig, buildAuthorizeRequest, exchangeCode } from '../lib/oidc.js'
import { platformUser } from '../lib/yihuOne.js'
import { signInPlatformUser, OidcLoginError } from '../lib/identity.js'
import { basePathOf, ON_YIHU_ONE } from '../lib/platform.js'

const router = express.Router()

/** 开发登录: 只在本地开发 / 跑测试时打开, 生产和装在以虎 One 上一律关闭 */
export const devLoginEnabled = () =>
  process.env.DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production' && !ON_YIHU_ONE

/** 登录成功后的统一出参: 签发本系统 token + 用户摘要 */
async function issueLogin(user) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  const token = signToken({
    type: 'internal',
    userId: user.id,
    username: user.username,
    role: user.role,
    engineerId: user.engineer?.id
  })
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      engineerId: user.engineer?.id,
      avatarUrl: user.avatarUrl || null
    }
  }
}

/**
 * GET /api/auth/providers
 * 登录页用: 以虎 One 是否可用、是否打开了开发登录
 */
router.get('/providers', (req, res) => {
  const cfg = oidcConfig()
  res.json({
    code: 0,
    data: {
      platform: cfg.enabled ? { name: cfg.name } : null,
      devLogin: devLoginEnabled()
    }
  })
})

/**
 * POST /api/auth/dev-login { username }
 * 开发登录: 不验密码, 直接以某个本地账号进入。只在 devLoginEnabled() 时存在
 */
router.post('/dev-login', async (req, res) => {
  if (!devLoginEnabled()) return res.status(404).json({ code: 4040, message: 'Not found' })
  const username = String(req.body?.username || '').trim()
  const user = username && await prisma.user.findUnique({ where: { username }, include: { engineer: true } })
  if (!user || user.status !== 1 || user.deletedAt) return res.status(401).json({ code: 2003, message: '账号不存在或已停用' })
  res.json({ code: 0, message: 'ok', data: await issueLogin(user) })
})

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', internalAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: BigInt(req.user.userId) },
      include: { engineer: true }
    })
    if (!user) return res.status(404).json({ code: 2004, message: '用户不存在' })
    res.json({
      code: 0,
      message: 'ok',
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        phone: user.phone,
        email: user.email,
        engineerId: user.engineer?.id || null
      }
    })
  } catch (e) {
    console.error('[auth/me]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ==================== 以虎 One 统一登录 ====================
// 浏览器: /api/auth/oidc/login → 以虎 One 授权页 → /api/auth/oidc/callback → /admin/login?ticket=…
// 前端拿 ticket 调 POST /api/auth/oidc/exchange 换本系统 token(token 不进地址栏/浏览器历史)

const STATE_COOKIE = 'fde_oidc'
const STATE_TTL_SEC = 600
const TICKET_TTL = 60_000
const tickets = new Map()   // ticket → { data, exp }

function readCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '')
  return m ? decodeURIComponent(m[1]) : null
}

/** 回调地址: 显式配置优先, 否则按请求来源推(反向代理时取 X-Forwarded-*) */
function redirectUriFor(req, cfg) {
  if (cfg.redirectUri) return cfg.redirectUri
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim()
  return `${proto}://${host}${basePathOf(req)}/api/auth/oidc/callback`
}

/** 只允许站内相对路径, 防开放重定向 */
function safeNext(next) {
  const n = String(next || '')
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n.slice(0, 500) : '/admin/workbench'
}

// 装在以虎 One 上时页面地址带前缀(/apps/<code>), 跳转和 cookie 路径都要带上
function loginPageRedirect(req, res, params) {
  const q = new URLSearchParams(params)
  res.redirect(302, `${basePathOf(req)}/admin/login?${q}`)
}
const stateCookiePath = (req) => `${basePathOf(req)}/api/auth/oidc`

/**
 * GET /api/auth/oidc/login?next=/admin/...
 */
router.get('/oidc/login', async (req, res) => {
  const cfg = oidcConfig()
  if (!cfg.enabled) return res.status(404).json({ code: 4041, message: '还没有接入以虎 One' })
  try {
    const redirectUri = redirectUriFor(req, cfg)
    const { url, state, nonce, verifier } = await buildAuthorizeRequest(cfg, redirectUri)
    // state/nonce/PKCE 放进签名 cookie(短期, 仅回调路径可见), 服务端不存会话
    const sealed = signToken({ type: 'oidc_state', state, nonce, verifier, redirectUri, next: safeNext(req.query.next) }, `${STATE_TTL_SEC}s`)
    const secure = redirectUri.startsWith('https:') ? '; Secure' : ''
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=${encodeURIComponent(sealed)}; Path=${stateCookiePath(req)}; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SEC}${secure}`)
    res.redirect(302, url)
  } catch (e) {
    console.error('[auth/oidc/login]', e)
    loginPageRedirect(req, res, { sso_error: '无法连接以虎 One' })
  }
})

/**
 * GET /api/auth/oidc/callback?code=&state=
 */
router.get('/oidc/callback', async (req, res) => {
  const cfg = oidcConfig()
  if (!cfg.enabled) return res.status(404).json({ code: 4041, message: '还没有接入以虎 One' })
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=${stateCookiePath(req)}; HttpOnly; SameSite=Lax; Max-Age=0`)
  const saved = verifyToken(readCookie(req, STATE_COOKIE) || '')
  try {
    if (req.query.error) {
      return loginPageRedirect(req, res, { sso_error: req.query.error === 'access_denied' ? '你取消了授权' : String(req.query.error_description || req.query.error) })
    }
    const state = String(req.query.state || '')
    const ok = saved?.type === 'oidc_state' && state && saved.state.length === state.length &&
      crypto.timingSafeEqual(Buffer.from(saved.state), Buffer.from(state))
    if (!ok) return loginPageRedirect(req, res, { sso_error: '登录校验失败或已超时, 请重试' })

    const { accessToken } = await exchangeCode(cfg, {
      code: String(req.query.code || ''), redirectUri: saved.redirectUri, verifier: saved.verifier, nonce: saved.nonce
    })
    const pu = await platformUser(accessToken, cfg)
    if (!pu) throw new Error('读取以虎 One 用户信息失败')
    const user = await signInPlatformUser(pu, cfg)
    const data = await issueLogin(user)
    const ticket = crypto.randomBytes(24).toString('base64url')
    for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k)
    tickets.set(ticket, { data, exp: Date.now() + TICKET_TTL })
    loginPageRedirect(req, res, { ticket, next: saved.next })
  } catch (e) {
    if (!(e instanceof OidcLoginError)) console.error('[auth/oidc/callback]', e)
    loginPageRedirect(req, res, { sso_error: e instanceof OidcLoginError ? e.message : '登录失败, 请重试' })
  }
})

/**
 * POST /api/auth/oidc/exchange { ticket } → { token, user }  (ticket 一次有效, 60 秒过期)
 */
router.post('/oidc/exchange', (req, res) => {
  const ticket = String(req.body?.ticket || '')
  const hit = tickets.get(ticket)
  tickets.delete(ticket)
  if (!hit || hit.exp < Date.now()) return res.status(401).json({ code: 2003, message: '登录凭证无效或已过期, 请重新登录' })
  res.json({ code: 0, message: 'ok', data: hit.data })
})

export default router
