// 路由守卫工具函数（供测试用）
// 从 router/index.js 抽出，便于单测

/**
 * 免登录的公开页: 使用文档。
 */
export function isPlatformPublicPath(path) {
  return path === '/docs' || path.startsWith('/docs/')
}

/**
 * 这个地址要不要转去后台登录页
 */
export function shouldRedirectToLogin(path, publicSite) {
  if (publicSite) return false
  if (path.startsWith('/admin')) return false
  return !isPlatformPublicPath(path)
}

/**
 * 检查目标路由是否需要内部账号鉴权
 */
export function isRequiresInternalAuth(matched) {
  return matched.some(r => r.meta?.requiresInternalAuth)
}

/**
 * 收集所有匹配路由的 requiredRoles
 */
export function collectRequiredRoles(matched) {
  return matched
    .map(r => r.meta?.requiredRoles)
    .filter(Boolean)
    .flat()
}

/**
 * 收集所有匹配路由的 requiredPerm（v1.3.0 权限点化路由校验）
 */
export function collectRequiredPerms(matched) {
  return matched
    .map(r => r.meta?.requiredPerm)
    .filter(Boolean)
}

/**
 * 鉴权决策：返回 next() 参数
 * v1.3.0: 路由声明了 requiredPerm 且传入 canFn 时按权限点判断(复用服务端生效权限,
 * 后台改权限矩阵路由级同步生效); 否则回退 requiredRoles 角色白名单。
 * v2.6.0(#959): 越权时弹回个人工作台(全员可进)。
 * @param {Array} matched - route.matched
 * @param {Object} auth - { internalToken, role }
 * @param {Function|null} canFn - 权限点判断函数 can(perm) => boolean
 * @returns {Object|boolean}  - next() 参数
 */
export function resolveGuard(matched, auth, canFn = null) {
  // 内部账号
  if (isRequiresInternalAuth(matched)) {
    if (!auth.internalToken) {
      return { name: 'AdminLogin', query: { redirect: 'protected' } }
    }
    const perms = collectRequiredPerms(matched)
    if (perms.length && typeof canFn === 'function') {
      return perms.every(p => canFn(p)) ? true : { name: 'AdminWorkbench' }
    }
    const need = collectRequiredRoles(matched)
    if (need.length && auth.role && !need.includes(auth.role)) {
      return { name: 'AdminWorkbench' }
    }
    return true  // next()
  }
  return true
}
