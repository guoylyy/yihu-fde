// FDE 平台 - 操作审计日志（只读; 仅 ADMIN）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'

const router = express.Router()
router.use(internalAuth)

/**
 * GET /api/fde/audit-logs?userType=&action=&from=&to=&page=&page_size=
 */
router.get('/', requirePermission('audit.list'), async (req, res) => {
  try {
    const { userType, action, from, to, page = 1, page_size = 50 } = req.query
    const where = {}
    if (userType) where.userType = userType
    if (action) where.action = { contains: action }
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59')
    }
    const [list, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(page_size),
        take: Number(page_size)
      }),
      prisma.auditLog.count({ where })
    ])

    // 补操作者姓名
    const internalIds = [...new Set(list.filter((l) => l.userType === 'INTERNAL' && l.userId).map((l) => l.userId))]
    const users = internalIds.length ? await prisma.user.findMany({ where: { id: { in: internalIds } }, select: { id: true, name: true, username: true } }) : []
    const uMap = new Map(users.map((u) => [String(u.id), `${u.name} (${u.username})`]))

    res.json({
      code: 0,
      data: {
        list: list.map((l) => ({
          id: l.id,
          userType: l.userType,
          actor: l.userId
            ? uMap.get(String(l.userId)) || `#${l.userId}`
            : '—',
          action: l.action,
          resourceType: l.resourceType,
          resourceId: l.resourceId,
          details: l.details,
          ip: l.ip,
          createdAt: l.createdAt
        })),
        total
      }
    })
  } catch (e) {
    console.error('[fde/audit-logs:list]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
