/**
 * 版本(edition)模块开关 —— 多实例的功能裁剪层
 *
 * 一份代码、一个镜像跑多个客户实例, 差异只允许来自这里的环境变量 + 数据库内容,
 * 不允许出现「某客户专属分支」。默认(不配置)= 全量。
 *
 * 配置方式(二选一, 白名单优先):
 *   ENABLED_MODULES=projects,tasks,timesheets   # 只开这些(+ 核心模块)
 *   DISABLED_MODULES=ideas                      # 开全量但关掉这些
 *
 * 模块码见 config/modules.js 的 MODULE_NAMES,
 * 避免两处维护各自的模块清单。
 */
import { MODULE_NAMES, MODULE_PREFIXES, resolveModule } from './modules.js'

/** 核心模块: 关掉系统就跑不起来, 不接受开关 */
export const CORE_MODULES = new Set([
  'auth',      // 登录
  'me',        // 个人中心(工作台/我的项目)
  'admin',     // 用户/角色/权限/团队等系统管理
  'uploads',   // 文件上传
  'notifications',
  'public',    // 公开接口(健康检查/免登录页)
  'other'      // 未归类前缀: 一律放行, 避免新接口被静默 404
])

/** 全部已知模块码 */
export const ALL_MODULES = Object.keys(MODULE_NAMES)

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * 计算本实例启用的模块集合。读环境变量, 未配置即全量。
 * @param {object} env 便于测试注入
 */
export function resolveEnabledModules(env = process.env) {
  const whitelist = parseList(env.ENABLED_MODULES)
  const blacklist = parseList(env.DISABLED_MODULES)
  if (whitelist.length) {
    return new Set([...CORE_MODULES, ...whitelist.filter(m => ALL_MODULES.includes(m))])
  }
  if (blacklist.length) {
    const off = new Set(blacklist.filter(m => !CORE_MODULES.has(m)))
    return new Set(ALL_MODULES.filter(m => !off.has(m)))
  }
  return new Set(ALL_MODULES)
}

let enabled = resolveEnabledModules()

/** 进程启动后重新读一次环境变量(测试用) */
export function reloadEdition(env = process.env) {
  enabled = resolveEnabledModules(env)
  return enabled
}

export function isModuleEnabled(code) {
  return CORE_MODULES.has(code) || enabled.has(code)
}

/** 当前启用模块码(排序后), 下发给前端做菜单/路由收敛 */
export function enabledModuleList() {
  return [...enabled].sort()
}

/** 版本标识: 全量 = full, 裁剪过 = tenant。只用于展示与日志 */
export function editionName() {
  return enabled.size === ALL_MODULES.length ? 'full' : 'tenant'
}

/**
 * 权限 key → 模块码。key 形如 'task.create' / 'idea.view',
 * 取第一段做映射; 映射表必须覆盖 auth.js 里出现过的每一个前缀(有测试守护)。
 */
export const PERM_PREFIX_MODULE = {
  // 交付主线
  project: 'projects', 'project.viewFinance': 'projects',
  projectRecord: 'project_records', milestone: 'projects',
  issue: 'projects', risk: 'projects', report: 'reports',
  task: 'tasks', subtask: 'tasks',
  timesheet: 'timesheets', knowledge: 'knowledge',
  // 人
  engineer: 'engineers', engineer_stats: 'engineers', skill: 'engineers',
  skillPackage: 'engineers',
  asset: 'assets',   // v2.7(#1140) 项目资产库
  idea: 'ideas',     // v2.10.0(#1180) 创意中心
  // 客户
  customer: 'customers',
  // 平台自身
  notification: 'notifications',
  me: 'me',
  user: 'admin', role: 'admin', rolePermission: 'admin', team: 'admin',
  audit: 'admin', apiKey: 'admin',
  llmConfig: 'admin'
}

export function moduleOfPermission(key) {
  const k = String(key)
  // 整 key 精确匹配优先(个别权限点跨域, 如 project.viewFinance), 其次按前缀
  return PERM_PREFIX_MODULE[k] || PERM_PREFIX_MODULE[k.split('.')[0]] || 'other'
}

/** 过滤掉未启用模块的权限 —— 前端菜单读的是这份清单, 模块一关菜单自动塌陷 */
export function filterEnabledPermissions(keys) {
  return keys.filter(k => isModuleEnabled(moduleOfPermission(k)))
}

/** 路径 → 模块码(复用使用分析的前缀表) */
export function moduleOfPath(path) {
  return resolveModule(path)
}

/**
 * Express 中间件: 未启用模块的接口一律 404, 与「这个版本没有这个功能」表现一致。
 * 放在所有业务路由之前挂载。
 */
export function editionGuard(req, res, next) {
  const code = moduleOfPath(req.path)
  if (isModuleEnabled(code)) return next()
  res.status(404).json({ code: 4041, message: '当前版本未启用该功能' })
}

export { MODULE_NAMES, MODULE_PREFIXES }
