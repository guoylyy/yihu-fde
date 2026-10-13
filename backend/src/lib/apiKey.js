// API Key 生成 / 校验 / MCP 鉴权中间件
// 供 MCP Server 等程序化客户端以用户身份调用（代理用户模式, 权限与数据范围随用户角色走）
import crypto from 'node:crypto'
import prisma from './prisma.js'
import { verifyToken } from './auth.js'
import { resolveOidcAccessToken } from './oidc.js'

const KEY_PREFIX = 'fde_'
// 旧版签发的 Key 前缀, 照常认
const LEGACY_PREFIXES = ['yhk_']

/** 是不是平台 API Key(而不是 JWT) */
export function isApiKeyFormat(raw) {
  return typeof raw === 'string' && [KEY_PREFIX, ...LEGACY_PREFIXES].some(p => raw.startsWith(p))
}

export function generateApiKey() {
  const raw = KEY_PREFIX + crypto.randomBytes(24).toString('base64url')
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) }
}

export function hashApiKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * 用 API Key 换出用户身份, 返回与 JWT payload 同构的对象（供 signToken / req.user 复用）
 * 失败返回 null
 */
export async function resolveApiKey(raw) {
  if (!isApiKeyFormat(raw)) return null
  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(raw) },
    include: { user: { include: { engineer: true } }, agentProfile: true }
  })
  if (!record || record.status !== 1) return null
  const user = record.user
  if (!user || user.status !== 1 || user.deletedAt) return null
  // v1.6.0: Agent 专属 Key —— Agent 停用/删除即 Key 失效
  const agent = record.agentProfile
  if (record.agentProfileId && (!agent || agent.status !== 1 || agent.deletedAt)) return null

  // 异步记录使用时间, 不阻塞请求; Agent Key 顺带刷新 Agent 活跃时间(自动心跳)
  prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  if (agent) {
    prisma.agentProfile.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } }).catch(() => {})
  }

  return {
    type: 'internal',
    userId: user.id.toString(),
    username: user.username,
    role: user.role,
    engineerId: user.engineer ? user.engineer.id.toString() : undefined,
    apiKeyId: record.id.toString(),
    apiKeyScope: record.scope || 'PERSONAL',
    agentProfileId: agent ? agent.id.toString() : undefined
  }
}

/** 归一化手机号: 去空格/横线/括号, 去 +86/86 国别前缀 */
export function normalizePhone(raw) {
  if (!raw) return ''
  let p = String(raw).replace(/[\s\-()]/g, '')
  if (p.startsWith('+86')) p = p.slice(3)
  else if (p.startsWith('86') && p.length === 13) p = p.slice(2)
  return p
}

/**
 * 用户登录 Token 换出用户身份（Agent 平台透传模式, 2026-07-29 替代原手机号路由）
 * 校验 JWT 有效性 + 用户仍启用未删除; 成功返回 payload, 失败返回 null
 */
export async function resolveUserToken(raw) {
  const decoded = verifyToken(raw)
  if (!decoded || decoded.type !== 'internal' || decoded.userId == null) return null
  // JWT 有效期最长 30 天, 期间用户可能被禁用/删除, MCP 场景逐次落库核验
  const user = await prisma.user.findUnique({
    where: { id: BigInt(decoded.userId) },
    include: { engineer: true }
  })
  if (!user || user.status !== 1 || user.deletedAt) return null
  return userPayload(user, 'USER_TOKEN')
}

/** 本地用户 → 与 internalAuth 同构的身份(带出默认 Agent 档案: report_presence 心跳需要 Agent 身份) */
async function userPayload(user, authVia) {
  const defaultAgent = await prisma.agentProfile.findFirst({
    where: { userId: user.id, status: 1, deletedAt: null },
    orderBy: { id: 'asc' }
  })
  return {
    type: 'internal',
    userId: user.id.toString(),
    username: user.username,
    role: user.role,
    engineerId: user.engineer && !user.engineer.deletedAt ? user.engineer.id.toString() : undefined,
    agentProfileId: defaultAgent ? defaultAgent.id.toString() : undefined,
    authVia
  }
}

/** 统一登录身份提供方(如以虎 One)签发的 access_token: 其 AI 助手调 MCP 时带的就是它 */
async function resolveOidcToken(raw) {
  const user = await resolveOidcAccessToken(raw)
  return user ? userPayload(user, 'OIDC_TOKEN') : null
}

/**
 * Express 中间件：MCP 鉴权, 两种凭证任选其一（均走 Authorization: Bearer 或 X-API-Key）
 * - fde_ 前缀(旧版 yhk_) → 个人 API Key（代理用户模式）
 * - 其余 → 用户登录 JWT（Agent 平台透传模式: 平台把用户自己的 Token 原样带过来）,
 *   再不行按统一登录身份提供方的 access_token 校验（以虎 One 的 AI 助手调 MCP）
 * 通过后 req.user 与 internalAuth 同构
 */
export function mcpAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const raw = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-api-key']
  const isApiKey = isApiKeyFormat(raw)
  const resolve = isApiKey
    ? resolveApiKey
    : async (t) => (await resolveUserToken(t)) || (await resolveOidcToken(t))
  resolve(raw)
    .then((payload) => {
      if (!payload) {
        return res.status(401).json({
          code: 1002,
          message: isApiKey
            ? 'API Key 无效或已吊销'
            : '凭证无效：请携带个人 API Key（fde_ 前缀）、本系统登录 Token 或统一登录(OIDC) access_token（Authorization: Bearer <token>）'
        })
      }
      if (payload.apiKeyScope === 'AGENT') {
        // 2026-07-29 手机号路由下线: AGENT 级共享 Key 不再可用
        return res.status(401).json({
          code: 1002,
          message: 'AGENT 级 API Key 已停用：请改为透传用户登录 Token（Authorization: Bearer <token>）, 或使用个人 API Key'
        })
      }
      req.user = payload
      req.user.id = payload.userId
      next()
    })
    .catch((e) => {
      console.error('[mcpAuth]', e)
      res.status(500).json({ code: 9001, message: e.message })
    })
}
