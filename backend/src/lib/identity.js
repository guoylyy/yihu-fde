// 平台用户 → 本系统账号。登录回调和 MCP(平台助手 / 个人 API Key 经平台转发)共用
//
// 规则(以虎 One 只说明「他是谁」, 「能做什么」由本系统的三个角色决定):
//   1. 只服务本应用所属的空间: 其他空间的人进不来(多空间按空间分数据之前)
//   2. 按平台用户 id 找人; 找不到时按邮箱关联唯一的未绑定账号; 再没有就自动开通
//   3. 姓名、邮箱、手机、头像每次以平台为准(登录、通讯录同步、从通讯录开通都一样, 见 platformProfile);
//      平台上有的字段在个人中心里只读, 平台上没有的(如没有头像)才能在本系统自己填
//   4. 角色: 管理员在本系统设过的(MANUAL)一律不动, 平台上怎么变都不覆盖;
//      没设过的按规则(每次登录重算) —— 平台管理员是本系统管理员; 打开「部门负责人自动成为项目经理」时负责人是项目经理; 否则默认角色
//   5. 本系统停用的账号进不来; 因平台停用而停用的, 平台恢复后自动启用
import crypto from 'node:crypto'
import prisma from './prisma.js'
import { oidcConfig } from './oidc.js'
import { appInfo, platformUser } from './yihuOne.js'
import { isValidRole } from './auth.js'
import { ENGINEER_ROLES } from './engineerRoles.js'
import { getSetting } from './settings.js'

export class OidcLoginError extends Error {}

/** 由平台用户拼一个合法且未占用的用户名候选(小写字母/数字/._-, ≤50) */
export function usernameCandidates(pu) {
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 40)
  const base = clean(pu.username) || clean(String(pu.email || '').split('@')[0]) || 'user'
  return [base, `${base}-${pu.id}`, `${base}-${crypto.randomBytes(4).toString('hex')}`]
}

/**
 * 角色规则(纯函数)。current = 本系统里的 { role, roleSource } 或 null(新开通)
 * 返回 { role, roleSource }
 */
export function computeRole(pu, current, { adminRoles, defaultRole, leaderIsManager }) {
  // 本系统里手动设过的角色优先于一切自动规则(包括平台管理员)
  if (current && current.roleSource === 'MANUAL') return { role: current.role, roleSource: 'MANUAL' }
  const roles = Array.isArray(pu.roles) ? pu.roles.map(String) : []
  if (adminRoles.some(r => roles.includes(r))) return { role: 'ADMIN', roleSource: 'PLATFORM_ADMIN' }
  if (leaderIsManager && Array.isArray(pu.leaderOf) && pu.leaderOf.length) return { role: 'MANAGER', roleSource: 'DEPT_LEADER' }
  return { role: defaultRole, roleSource: 'DEFAULT' }
}

/** 空间规则(纯函数): 平台没开多空间(没有 space)或同一空间才放行 */
export function spaceAllowed(pu, home) {
  if (!home?.code || !pu.space?.code) return true
  return pu.space.code === home.code
}

/**
 * 平台资料 → 本系统字段(纯函数, 只取能放下的)。data 是要写的值, fields 是平台提供了哪些(写进 users.platform_fields)
 * 登录(/api/sso/userinfo)、通讯录同步、从通讯录开通共用
 */
export function platformProfile(pu) {
  const data = {}
  const name = String(pu.name || pu.username || '').slice(0, 50)
  if (name) data.name = name
  if (pu.email) data.email = String(pu.email).slice(0, 100)
  if (pu.mobile) data.phone = String(pu.mobile).slice(0, 20)
  if (pu.avatar && String(pu.avatar).length <= 500) data.avatarUrl = String(pu.avatar)
  return { data, fields: Object.keys(data) }
}
function profileOf(pu) {
  const { data, fields } = platformProfile(pu)
  return { ...data, platformFields: fields }
}

async function ensureEngineer(user) {
  if (!ENGINEER_ROLES.includes(user.role)) return
  const has = await prisma.engineer.findUnique({ where: { userId: user.id } })
  if (!has) await prisma.engineer.create({ data: { userId: user.id, available: 1 } })
}

/**
 * 平台用户 → 本系统账号(含 engineer)。不允许进入时抛 OidcLoginError
 * @param {object} pu  /api/sso/userinfo 返回的平台用户
 */
export async function signInPlatformUser(pu, cfg = oidcConfig()) {
  const home = (await appInfo({ cfg }))?.space
  if (!spaceAllowed(pu, home)) throw new OidcLoginError(`本系统只对「${home.name}」开放`)

  const sub = String(pu.id)
  let user = await prisma.user.findUnique({ where: { oidcSubject: sub } })
  if (!user && cfg.linkByEmail && pu.email) {
    const byEmail = await prisma.user.findMany({ where: { email: String(pu.email), oidcSubject: null, deletedAt: null }, take: 2 })
    // 只在唯一命中时关联, 同邮箱多个账号时宁可新建也不猜
    if (byEmail.length === 1) user = await prisma.user.update({ where: { id: byEmail[0].id }, data: { oidcSubject: sub } })
  }

  const rules = { adminRoles: cfg.adminRoles, defaultRole: cfg.defaultRole, leaderIsManager: await getSetting('auth.leaderIsManager') }
  const next = computeRole(pu, user, rules)
  if (!isValidRole(next.role)) throw new OidcLoginError(`角色 ${next.role} 不存在，请管理员检查 OIDC_DEFAULT_ROLE`)

  if (!user) {
    if (!cfg.autoCreate) throw new OidcLoginError('本系统还没有为你开通账号，请联系管理员')
    let username = null
    for (const cand of usernameCandidates(pu)) {
      if (!(await prisma.user.findUnique({ where: { username: cand } }))) { username = cand; break }
    }
    user = await prisma.user.create({
      data: { username, ...profileOf(pu), name: profileOf(pu).name || username, oidcSubject: sub, status: 1, ...next }
    })
    console.log(`[identity] 新开通 ${user.username} (${user.role}, ${user.roleSource}) ← 平台用户 ${sub}`)
  } else {
    if (user.deletedAt || (user.status !== 1 && !user.platformDisabled)) throw new OidcLoginError('你的账号已停用，请联系管理员')
    const data = { ...profileOf(pu) }
    if (next.role !== user.role || next.roleSource !== user.roleSource) Object.assign(data, next)
    // 平台停用后又恢复的: 能走到这里说明平台上是在职的
    if (user.platformDisabled) Object.assign(data, { status: 1, platformDisabled: false })
    user = await prisma.user.update({ where: { id: user.id }, data })
  }
  await ensureEngineer(user)
  return prisma.user.findUnique({ where: { id: user.id }, include: { engineer: true } })
}

// ---------- MCP: 平台转发来的 access_token → 本系统用户 ----------

const seen = new Map()   // userId → 上次记 mcpLastUsedAt 的时间, 节流写库
const resolved = new Map()   // sha256(token) → { at, user }; 同一个 token 5 分钟内不重复对账
const RESOLVED_TTL = 300_000

/** 不是有效 token / 不允许进入时返回 null */
export async function resolvePlatformToken(raw, cfg = oidcConfig()) {
  if (!cfg.enabled || !raw) return null
  const key = crypto.createHash('sha256').update(raw).digest('hex')
  const hit = resolved.get(key)
  if (hit && Date.now() - hit.at < RESOLVED_TTL) return hit.user
  const user = await resolveUncached(raw, cfg)
  if (resolved.size > 5000) resolved.clear()
  resolved.set(key, { at: Date.now(), user })
  return user
}

async function resolveUncached(raw, cfg) {
  try {
    const pu = await platformUser(raw, cfg)
    if (!pu) return null
    const user = await signInPlatformUser(pu, cfg)
    const k = String(user.id)
    if (!seen.has(k) || Date.now() - seen.get(k) > 600_000) {
      seen.set(k, Date.now())
      prisma.user.update({ where: { id: user.id }, data: { mcpLastUsedAt: new Date() } }).catch(() => {})
    }
    return user
  } catch (e) {
    if (!(e instanceof OidcLoginError)) console.warn('[identity] access_token 校验失败:', e.message)
    return null
  }
}
