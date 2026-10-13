// JWT 鉴权工具
import jwt from 'jsonwebtoken'
import { isModuleEnabled, moduleOfPermission } from '../config/edition.js'

// 生产环境必须配置 JWT_SECRET: 用公开的默认值等于谁都能伪造管理员 token
const SECRET = (() => {
  const s = process.env.JWT_SECRET
  if (s && s.length >= 16 && s !== 'dev-secret') return s
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET 未配置或过短(至少 16 位), 生产环境拒绝启动。生成: openssl rand -hex 32')
  }
  if (!s) console.warn('[auth] 未配置 JWT_SECRET, 开发模式使用临时默认值, 切勿用于生产')
  return s || 'dev-secret'
})()
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

export function signToken(payload, expiresIn) {
  // 1.2.7: 支持"下次自动登录"传长效期 (如 30d), 缺省用环境配置
  return jwt.sign(payload, SECRET, { expiresIn: expiresIn || EXPIRES_IN })
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET)
  } catch (e) {
    return null
  }
}

/**
 * Express 中间件：内部员工鉴权
 */
export function internalAuth(req, res, next) {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 1001, message: '未授权' })
  }
  const token = auth.slice(7)
  const payload = verifyToken(token)
  if (!payload || payload.type !== 'internal') {
    return res.status(401).json({ code: 1002, message: 'Token 无效或过期' })
  }
  req.user = payload
  // 兼容：payload 里字段是 userId，代码里很多地方用 req.user.id
  if (req.user.id == null && req.user.userId != null) {
    req.user.id = req.user.userId
  }
  next()
}

/**
 * 路由级角色权限检查中间件
 * 用法：router.use(internalAuth, requireRole('ADMIN', 'MANAGER'))
 *       或单个：router.use(requireRole('ADMIN'))
 *
 * 返回 403 表示未授权
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 1001, message: '未登录' })
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        code: 1003,
        message: `需要角色 ${allowedRoles.join(' / ')}，你是 ${req.user.role}`
      })
    }
    // 顺带把 id 补上，供后续 canAccessRecord / buildScopeWhere 用
    if (req.user.id == null && req.user.userId != null) {
      req.user.id = req.user.userId
    }
    next()
  }
}

/**
 * 检查当前用户是否拥有任一指定角色
 * (供业务逻辑里用，不是中间件)
 */
export function hasRole(user, ...roles) {
  return user && roles.includes(user.role)
}

/**
 * 细粒度操作权限矩阵（默认值 + 权限点目录）
 * key = 权限字符串（点号分隔，模块.动作）
 * value = 拥有此权限的【默认】角色数组
 *
 * 2026-07-20 角色权限配置: 此矩阵降级为"出厂默认值"。管理员可在后台
 * 「基础配置 → 角色权限配置」按权限点覆盖角色列表, 覆盖存 role_permissions 表,
 * 生效值 = DB 覆盖 ?? 此处默认。运行时统一走 getEffectiveRoles(perm)。
 */
export const PERMISSIONS = {
  // 模块入口 (原路由级 requireRole 白名单, 现改为可配置的 *.access 权限点)
  'customer.access':         ['ADMIN', 'MANAGER'],
  'project.access':          ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'engineer.access':         ['ADMIN', 'MANAGER'],
  'engineer_stats.access':   ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'timesheet.access':        ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'knowledge.access':        ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'skill.access':            ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],

  // 页面级查看权限 (前端菜单/路由控制用, 与 frontend/src/api/permissions.js 对应)
  'customer.view':           ['ADMIN', 'MANAGER'],
  'project.view':            ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'timesheet.view':          ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'me.view':                 ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],

  // 角色权限配置 (仅 ADMIN, 且不可在后台改动此权限点本身, 防止把自己锁在门外)
  'rolePermission.manage':   ['ADMIN'],
  // v1.3.2 角色管理 (动态角色 CRUD, 仅 ADMIN, 同样锁定)
  'role.manage':             ['ADMIN'],

  // 客户
  'customer.create':         ['ADMIN', 'MANAGER'],
  'customer.edit':           ['ADMIN', 'MANAGER'],
  'customer.delete':         ['ADMIN', 'MANAGER'],

  // 项目
  'project.create':          ['ADMIN', 'MANAGER'],
  'project.edit':            ['ADMIN', 'MANAGER'],
  'project.delete':          ['ADMIN', 'MANAGER'],
  'project.changeStatus':    ['ADMIN', 'MANAGER'],
  'project.manageMembers':   ['ADMIN', 'MANAGER'],
  // 项目预算/成本: FDE 工程师不可见
  'project.viewFinance':     ['ADMIN', 'MANAGER'],

  // 任务 (2026-07-20 拆分: 原先创建/删除借用 project.edit, 编辑/状态流转只验登录)
  // 注: 状态流转另有数据级校验——非管理层只能改自己负责的任务, 见 tasks.js
  'task.view':               ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  // v1.4.x 主人拍板: FDE 工程师可创建任务(个人任务管理/MCP 智能体场景)
  'task.create':             ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'task.edit':               ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'task.changeStatus':       ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'task.delete':             ['ADMIN', 'MANAGER'],

  // 子任务 (原先只验登录)
  'subtask.manage':          ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],

  // 里程碑/问题/风险 (2026-07-20 拆分: 原先借用 project.edit)
  'milestone.manage':        ['ADMIN', 'MANAGER'],
  'issue.manage':            ['ADMIN', 'MANAGER'],
  'risk.manage':             ['ADMIN', 'MANAGER'],

  // 工程师
  'engineer.view':           ['ADMIN', 'MANAGER'],
  'engineer.create':         ['ADMIN', 'MANAGER'],
  'engineer.edit':           ['ADMIN', 'MANAGER'],
  'engineer.disable':        ['ADMIN', 'MANAGER'],

  // 工时
  'timesheet.create':        ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'timesheet.edit':          ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'timesheet.delete':        ['ADMIN', 'MANAGER'],
  'timesheet.submit':        ['ADMIN', 'FDE_ENGINEER'],
  'timesheet.approve':       ['ADMIN', 'MANAGER'],

  // 报表导出
  'report.export':           ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],

  // 知识库
  'knowledge.view':      ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'knowledge.create':    ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'knowledge.edit':      ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'knowledge.delete':    ['ADMIN', 'MANAGER'],

  // 技能主数据
  'skill.manage':            ['ADMIN', 'MANAGER'],

  // v2.0.9 Skills 能力包框架 (#428): 查看全员, 维护限经理/管理员
  'skillPackage.view':       ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'skillPackage.manage':     ['ADMIN', 'MANAGER'],

  // v2.7 项目资产库 (#1140): 全员可看; 工程师可登记(进草稿)与登记复用; 发布/改/删限经理
  'asset.view':              ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'asset.create':            ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'asset.use':               ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'asset.manage':            ['ADMIN', 'MANAGER'],

  // v2.10.0 创意中心 (#1180): 面向全公司, 谁都能看能发能开话题; 转里程碑与置顶/搁置/删别人的限经理
  'idea.view':               ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'idea.create':             ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'idea.convert':            ['ADMIN', 'MANAGER'],
  'idea.manage':             ['ADMIN', 'MANAGER'],

  // v1.5.6 团队管理 (团队清单任何登录用户可读; 增删改/成员调整需此权限)
  'team.manage':             ['ADMIN'],

  // 用户管理（仅 ADMIN）
  'user.view':               ['ADMIN'],
  'user.create':             ['ADMIN'],
  'user.edit':               ['ADMIN'],
  'user.delete':             ['ADMIN'],
  'user.resetPassword':      ['ADMIN'],

  // API Key (MCP/智能体对接凭证): FDE 工程师可管理自己的 Key; 查看/签发他人 Key 仅 ADMIN
  'apiKey.manage':           ['ADMIN', 'FDE_ENGINEER'],
  'apiKey.manageAll':        ['ADMIN'],

  // 操作审计日志 (仅 ADMIN)
  'audit.list':              ['ADMIN'],

  // 2026-07-31 大模型配置 (基础模块, 仅存配置; 涉及 API 密钥, 收紧到 ADMIN)
  'llmConfig.manage':        ['ADMIN'],

  // v1.4.x 项目记录 (过程资料: 会议纪要/对接沟通/现场记录, 参与交付的都能记)
  'projectRecord.create':    ['ADMIN', 'MANAGER', 'FDE_ENGINEER'],
  'projectRecord.manage':    ['ADMIN', 'MANAGER'],

  // MCP 工具补全: 主动给同事发站内通知(只进站内信箱, 不外发飞书/邮件)
  // 收紧到管理侧 —— 谁都能发就成骚扰通道了
  'notification.send':       ['ADMIN', 'MANAGER']
}

// ===== 角色定义入库 (v1.3.2 动态角色) =====
// roles 表是角色清单的唯一权威源, 启动时加载到内存, 角色管理保存后即时刷新。
// 角色三属性: code(鉴权用, JWT/users.role 存它) / name(展示) / dataScope(数据范围)
// dataScope: ALL=全量 / OWN_PROJECTS=自己负责或参与的项目 / OWN_RECORDS=仅本人相关记录

export const DATA_SCOPES = ['ALL', 'OWN_PROJECTS', 'OWN_RECORDS']

// DB 不可用时的兜底(与 migration seed 一致), 保证鉴权永不因角色表故障而全站瘫痪
export const BUILTIN_ROLES = [
  { code: 'ADMIN',        name: '系统管理员', dataScope: 'ALL',          builtin: true, status: 1 },
  { code: 'MANAGER',      name: '项目经理',   dataScope: 'OWN_PROJECTS', builtin: true, status: 1 },
  { code: 'FDE_ENGINEER', name: 'FDE 工程师', dataScope: 'OWN_RECORDS',  builtin: true, status: 1 }
]

let roleCache = new Map(BUILTIN_ROLES.map(r => [r.code, r]))

/** 从 roles 表加载角色清单到内存 (启动时 & 角色管理保存后调用) */
export async function loadRoles() {
  const prisma = (await import('./prisma.js')).default
  const rows = await prisma.role.findMany({ orderBy: { sortOrder: 'asc' } })
  if (rows.length) {
    roleCache = new Map(rows.map(r => [r.code, {
      code: r.code, name: r.name, description: r.description,
      dataScope: r.dataScope, builtin: r.builtin, status: r.status, sortOrder: r.sortOrder
    }]))
  }
  return roleCache.size
}

/** 全部角色 (含停用, 供管理页); onlyActive=true 时只回启用的 (供下拉/校验) */
export function getRoles(onlyActive = false) {
  const list = [...roleCache.values()]
  return onlyActive ? list.filter(r => r.status === 1) : list
}

export function getRole(code) { return roleCache.get(code) || null }

/** 角色 code 是否合法(启用中) — 替代原 VALID_ROLES/ALLOWED_ROLES 硬编码 */
export function isValidRole(code) {
  const r = roleCache.get(code)
  return !!r && r.status === 1
}

/** 启用中的角色 code 列表 */
export function getValidRoleCodes() { return getRoles(true).map(r => r.code) }

/** 角色数据范围; 未知角色按最严格的 OWN_RECORDS 兜底 (存量用户挂在已删角色上时不放大可见面) */
export function getDataScope(code) {
  return roleCache.get(code)?.dataScope || 'OWN_RECORDS'
}

/** 角色展示名 (通知等文案用) */
export function getRoleName(code) { return roleCache.get(code)?.name || code }

// 兼容旧引用: 历史上是硬编码常量, 现在指向内置角色 code (新代码请用 isValidRole/getValidRoleCodes)
export const VALID_ROLES = BUILTIN_ROLES.map(r => r.code)

// ===== 角色权限动态配置 (2026-07-20) =====
// DB 覆盖缓存: perm -> [roles]。服务启动时加载, 后台保存后即时刷新。
// 不可后台配置的权限点 (防锁死/越权提权)
export const LOCKED_PERMISSIONS = ['rolePermission.manage', 'role.manage']

let permissionOverrides = {}

/** 从 role_permissions 表加载覆盖配置到内存 (启动时 & 保存后调用) */
export async function loadRolePermissions() {
  const prisma = (await import('./prisma.js')).default
  const rows = await prisma.rolePermission.findMany()
  const next = {}
  for (const row of rows) {
    // 只认目录里存在且未锁定的权限点; roles 按角色缓存做合法性过滤(v1.3.2: 动态角色)
    if (!PERMISSIONS[row.permission] || LOCKED_PERMISSIONS.includes(row.permission)) continue
    const roles = Array.isArray(row.roles) ? row.roles.filter(r => roleCache.has(r)) : null
    if (roles) next[row.permission] = roles
  }
  permissionOverrides = next
  return Object.keys(next).length
}

/** 权限点当前生效的角色列表: DB 覆盖 ?? 代码默认 */
export function getEffectiveRoles(perm) {
  return permissionOverrides[perm] || PERMISSIONS[perm]
}

/** 某权限点是否被后台配置覆盖过 */
export function isOverridden(perm) {
  return Object.prototype.hasOwnProperty.call(permissionOverrides, perm)
}

export function requirePermission(perm) {
  if (!PERMISSIONS[perm]) {
    throw new Error(`Unknown permission: ${perm}`)
  }
  // 每次请求时取生效角色, 保证后台改配置即时生效
  return (req, res, next) => {
    const allowedRoles = getEffectiveRoles(perm)
    if (!req.user) {
      return res.status(401).json({ code: 1001, message: '未登录' })
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        code: 1003,
        message: `缺少权限 ${perm}（需要角色 ${allowedRoles.join(' / ')}，你是 ${req.user.role}）`
      })
    }
    if (req.user.id == null && req.user.userId != null) {
      req.user.id = req.user.userId
    }
    next()
  }
}

export function hasPermission(user, perm) {
  if (!user) return false
  // v2.7.0 多实例: 本实例没启用的模块, 权限一律不成立 —— 与 /role-permissions/mine 下发给
  // 前端的清单保持同一口径, 否则会出现「界面隐藏了但接口照样吐数据」
  if (!isModuleEnabled(moduleOfPermission(perm))) return false
  const allowed = getEffectiveRoles(perm)
  if (!allowed) return false
  return allowed.includes(user.role)
}

/**
 * 数据级权限范围 — v1.3.2 起按角色的 dataScope 属性分支, 不再按角色字面量分支
 *
 * dataScope 语义 (逐实体对齐 v1.3.1 前的五角色行为, 回归基准):
 * - ALL          → 不过滤 (ADMIN)
 * - OWN_PROJECTS → 经理型: 自己负责(managerId)/创建/参与成员的项目; 业务单据看自己负责的项目
 *                  (原 MANAGER。工时/线索沿用原行为不过滤 — 审批流需要全量)
 * - OWN_RECORDS  → 个人型: 仅本人参与项目 + 本人产生/被指派的记录 (FDE_ENGINEER)
 */
export async function buildScopeWhere(user, entity) {
  if (!user) return {}
  const scope = getDataScope(user.role)
  if (scope === 'ALL') {
    return {}
  }
  const uid = BigInt(user.id)

  if (scope === 'OWN_PROJECTS') {
    if (entity === 'project') {
      // 前端建项目不填 managerId, 项目经理实际通过 ProjectMember(PM) 参与项目
      // 因此 managerId / 自己创建 / 成员关系 三者任一命中即可见
      const ids = await getMemberProjectIds(user)
      return {
        OR: [
          { managerId: uid },
          { createdBy: uid },
          ...(ids.length ? [{ id: { in: ids } }] : [])
        ]
      }
    }
    // timesheet(审批流需全量): 不过滤
    return {}
  }

  // ---- OWN_RECORDS (原 FDE_ENGINEER 行为) ----
  if (entity === 'project') {
    // 自己是成员的项目 (成员可能按 userId 关联(新)或只有 engineerId(历史), 双轨匹配)
    const ids = await getMemberProjectIds(user)
    return ids.length ? { id: { in: ids } } : { id: -1n }
  }
  if (entity === 'timesheet') {
    // 本人工程师档案下的记录; 无档案则必为空集
    const prisma = (await import('./prisma.js')).default
    const me = await prisma.engineer.findUnique({ where: { userId: uid } })
    if (!me) return { id: -1n }
    return { engineerId: me.id }
  }
  return {}
}

/**
 * 辅助: 当前用户作为成员参与的项目 id 列表 (userId OR engineerId 双轨匹配, 去重)
 */
async function getMemberProjectIds(user) {
  const prisma = (await import('./prisma.js')).default
  const uid = BigInt(user.id)
  const me = await prisma.engineer.findUnique({ where: { userId: uid } })
  const memberWhere = me
    ? { OR: [{ userId: uid }, { engineerId: me.id }] }
    : { userId: uid }
  const members = await prisma.projectMember.findMany({
    where: memberWhere,
    select: { projectId: true }
  })
  return [...new Set(members.map(m => m.projectId.toString()))].map(s => BigInt(s))
}

/**
 * 单条记录的访问判定（同步，只看手上这条记录的字段）。
 *
 * ⚠️ 局限: 它判断不了「成员关系」这类要查库的归属 —— OWN_RECORDS 角色(FDE 工程师)
 * 的 project 会落到末尾 return true, 也就是不做任何限制。这曾导致项目详情页放行、
 * 而同一项目的子资源(记录/里程碑/问题风险, 走 buildScopeWhere)返回 404, 两边口径分叉。
 * **项目的归属判定请用 routes/fde/projects.js 的 isProjectInScope()**, 它与 buildScopeWhere 同源。
 */
export function canAccessRecord(user, entity, record) {
  if (!user || !record) return false
  const scope = getDataScope(user.role)
  if (scope === 'ALL') return true
  const uid = BigInt(user.id)

  if (scope === 'OWN_PROJECTS') {
    if (entity === 'project') {
      // 与 buildScopeWhere 保持一致: managerId / 自己创建 / 成员关系 任一命中
      // 成员关系需要 record 带 members(含 userId); 未 include 时按前两项判断
      if (record.managerId != null && BigInt(record.managerId) === uid) return true
      if (record.createdBy != null && BigInt(record.createdBy) === uid) return true
      if (Array.isArray(record.members)) {
        return record.members.some(m => m.userId != null && BigInt(m.userId) === uid)
      }
      return false
    }
    return true
  }
  return true
}
