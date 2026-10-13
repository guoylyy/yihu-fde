// FDE 平台 - 工程师绩效统计 API
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission } from '../../lib/auth.js'

const router = express.Router()
router.use(internalAuth)
// FDE 工程师可看自己；ADMIN/MANAGER 可看全部
router.use(requirePermission('engineer_stats.access'))

/**
 * GET /api/fde/engineer-stats/:id?months=6
 * 工程师绩效卡：
 * - 总工时/已审批工时（最近 N 月）
 * - 项目数（参与/进行中）
 * - 月度工时趋势
 * - 利用率（工时 / 工作日 × 8h 容量）
 */
router.get('/:id', async (req, res) => {
  try {
    const engineerId = BigInt(req.params.id)
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 12)

    const engineer = await prisma.engineer.findUnique({
      where: { id: engineerId },
      include: { user: { select: { name: true, username: true, status: true } } }
    })
    if (!engineer) return res.status(404).json({ code: 2004, message: '工程师不存在' })
    // FDE 只能看自己的绩效
    if (req.user.role === 'FDE_ENGINEER' && engineer.userId !== BigInt(req.user.id)) {
      return res.status(403).json({ code: 1003, message: '只能查看自己的绩效' })
    }

    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    // 工时
    const timesheets = await prisma.timesheet.findMany({
      where: {
        engineerId,
        deletedAt: null,
        workDate: { gte: from, lte: to }
      },
      orderBy: { workDate: 'asc' }
    })
    const totalHours = timesheets.reduce((s, t) => s + Number(t.hours), 0)
    const approvedHours = timesheets.filter(t => t.status === 'APPROVED').reduce((s, t) => s + Number(t.hours), 0)
    const submittedHours = timesheets.filter(t => t.status === 'SUBMITTED').reduce((s, t) => s + Number(t.hours), 0)
    const draftHours = timesheets.filter(t => t.status === 'DRAFT').reduce((s, t) => s + Number(t.hours), 0)

    // 月度聚合
    const monthlyMap = new Map()
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthlyMap.set(key, { yearMonth: key, total: 0, approved: 0 })
    }
    for (const t of timesheets) {
      const key = `${t.workDate.getFullYear()}-${String(t.workDate.getMonth() + 1).padStart(2, '0')}`
      if (monthlyMap.has(key)) {
        const m = monthlyMap.get(key)
        m.total += Number(t.hours)
        if (t.status === 'APPROVED') m.approved += Number(t.hours)
      }
    }

    // 项目
    const projectMembers = await prisma.projectMember.findMany({
      where: { engineerId, leaveDate: null },
      include: { project: { select: { id: true, code: true, name: true, status: true, progress: true, endDate: true } } }
    })
    const projectCount = projectMembers.length
    const activeProjects = projectMembers.filter(m => m.project.status === 'IN_PROGRESS').length
    const completedProjects = projectMembers.filter(m => m.project.status === 'COMPLETED').length

    // 工作日天数（粗算：每月 22 个工作日 × 月数）
    const workDays = months * 22
    const capacity = workDays * 8  // 8h/天 容量
    const utilization = capacity > 0 ? Math.round((approvedHours / capacity) * 100) : 0

    // 客户覆盖
    const customerIds = await prisma.projectMember.findMany({
      where: { engineerId, leaveDate: null },
      include: { project: { select: { customerId: true } } }
    })
    const uniqueCustomers = new Set(customerIds.map(m => m.project.customerId?.toString()).filter(Boolean))

    res.json({
      code: 0, message: 'ok',
      data: {
        engineer: {
          id: engineer.id,
          name: engineer.user.name,
          username: engineer.user.username,
          status: engineer.user.status,
          level: engineer.level,
          city: engineer.city,
          dailyRate: engineer.dailyRate,
          available: engineer.available
        },
        summary: {
          totalHours: Math.round(totalHours * 10) / 10,
          approvedHours: Math.round(approvedHours * 10) / 10,
          submittedHours: Math.round(submittedHours * 10) / 10,
          draftHours: Math.round(draftHours * 10) / 10,
          utilization,                          // %
          capacityHours: capacity,
          months
        },
        projects: {
          total: projectCount,
          active: activeProjects,
          completed: completedProjects
        },
        customers: {
          uniqueCount: uniqueCustomers.size
        },
        monthly: [...monthlyMap.values()]
      }
    })
  } catch (e) {
    console.error('[fde/engineer-stats]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router