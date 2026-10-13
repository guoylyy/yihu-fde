// 操作审计日志（AuditLog 表 2026-06 就已预留 userType, 本次 PR⑤ 正式接入）
// 均为 fire-and-forget: 审计失败只打日志, 永不阻塞业务
import prisma from './prisma.js'

function clientMeta(req) {
  return {
    ip: (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '').slice(0, 45) || null,
    userAgent: (req.headers['user-agent'] || '').slice(0, 500) || null
  }
}

function write(data) {
  return prisma.auditLog.create({ data }).catch((e) => console.error('[audit]', e.message))
}

/** 内部操作 (req 需已过 internalAuth, 有 req.user) */
export function logInternalAction(req, action, { resourceType = null, resourceId = null, details = null } = {}) {
  return write({
    userType: 'INTERNAL',
    userId: req.user?.userId != null ? BigInt(req.user.userId) : null,
    action,
    resourceType,
    resourceId: resourceId != null ? BigInt(resourceId) : null,
    details,
    ...clientMeta(req)
  })
}
