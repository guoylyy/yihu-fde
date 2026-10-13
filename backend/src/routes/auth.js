// 认证路由: 账号密码登录 + 统一登录(OIDC, 如以虎 One)
import express from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import prisma from '../lib/prisma.js'
import { signToken, verifyToken, internalAuth } from '../lib/auth.js'
import { oidcConfig, buildAuthorizeRequest, exchangeCode, findOrCreateUser, OidcLoginError } from '../lib/oidc.js'
import { basePathOf } from '../lib/platform.js'

const router = express.Router()

/** PASSWORD_LOGIN=false 时只允许统一登录(接入以虎 One 后建议关掉本地密码) */
const passwordLoginEnabled = () => !['false', '0', 'no', 'off'].includes(String(process.env.PASSWORD_LOGIN ?? 'true').toLowerCase())

/** 登录成功后的统一出参: 签发本系统 token + 用户摘要 */
async function issueLogin(user, { remember = false } = {}) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  // 勾选"下次自动登录"发 30 天长效 token, 否则用默认有效期
  const token = signToken({
    type: 'internal',
    userId: user.id,
    username: user.username,
    role: user.role,
    engineerId: user.engineer?.id
  }, remember ? '30d' : undefined)
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      engineerId: user.engineer?.id,
      avatarUrl: user.avatarUrl || null,
      // 统一登录的账号没有可用的本地密码, 不走强制改密
      mustChangePassword: user.oidcSubject ? false : !!user.mustChangePassword
    }
  }
}

/**
 * GET /api/auth/providers
 * 登录页用: 有哪些登录方式
 */
router.get('/providers', (req, res) => {
  const cfg = oidcConfig()
  res.json({
    code: 0,
    data: {
      password: passwordLoginEnabled(),
      oidc: cfg.enabled ? { name: cfg.name } : null
    }
  })
})

/**
 * POST /api/auth/login
 * 账号密码登录
 */
router.post('/login', async (req, res) => {
  try {
    if (!passwordLoginEnabled()) {
      return res.status(403).json({ code: 2005, message: '本系统只允许统一登录' })
    }
    const { username, password, remember } = req.body
    if (!username || !password) {
      return res.status(400).json({ code: 1001, message: '参数错误' })
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: { engineer: true }
    })

    if (!user || user.status !== 1 || user.deletedAt) {
      return res.status(401).json({ code: 2003, message: '账号或密码错误' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return res.status(401).json({ code: 2003, message: '账号或密码错误' })
    }

    res.json({ code: 0, message: 'ok', data: await issueLogin(user, { remember }) })
  } catch (e) {
    console.error('[auth/login]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
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
        engineerId: user.engineer?.id || null,
        mustChangePassword: !!user.mustChangePassword
      }
    })
  } catch (e) {
    console.error('[auth/me]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ==================== 统一登录(OIDC) ====================
// 浏览器: /api/auth/oidc/login → 身份提供方授权页 → /api/auth/oidc/callback → /admin/login?ticket=…
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
  if (!cfg.enabled) return res.status(404).json({ code: 4041, message: '未配置统一登录' })
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
    loginPageRedirect(req, res, { sso_error: '无法连接统一登录服务' })
  }
})

/**
 * GET /api/auth/oidc/callback?code=&state=
 */
router.get('/oidc/callback', async (req, res) => {
  const cfg = oidcConfig()
  if (!cfg.enabled) return res.status(404).json({ code: 4041, message: '未配置统一登录' })
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

    const { claims } = await exchangeCode(cfg, {
      code: String(req.query.code || ''), redirectUri: saved.redirectUri, verifier: saved.verifier, nonce: saved.nonce
    })
    const user = await findOrCreateUser(claims, cfg)
    const data = await issueLogin(user)
    const ticket = crypto.randomBytes(24).toString('base64url')
    for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k)
    tickets.set(ticket, { data, exp: Date.now() + TICKET_TTL })
    loginPageRedirect(req, res, { ticket, next: saved.next })
  } catch (e) {
    if (!(e instanceof OidcLoginError)) console.error('[auth/oidc/callback]', e)
    loginPageRedirect(req, res, { sso_error: e instanceof OidcLoginError ? e.message : '统一登录失败, 请重试' })
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