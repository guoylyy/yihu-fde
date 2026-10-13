// FDE 平台 - 报表导出（Excel）
import { Router } from 'express'
import ExcelJS from 'exceljs'
import prisma from '../../lib/prisma.js'
import { internalAuth } from '../../lib/auth.js'
import { getBrand } from '../../config/brand.js'

const router = Router()
router.use(internalAuth)

// BigInt JSON 序列化
BigInt.prototype.toJSON = function () { return this.toString() }

/**
 * 通用工具：设置响应头 + 输出 .xlsx
 */
async function sendWorkbook(res, filename, workbook) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}.xlsx"`)
  const buffer = await workbook.xlsx.writeBuffer()
  res.send(Buffer.from(buffer))
}

/**
 * 美化样式：表头加粗 + 背景色
 */
function styleHeader(worksheet) {
  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF5B3ED8' } // 紫色
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }
  headerRow.height = 24
}

/**
 * 通用工具：列宽自适应
 */
function autoWidth(worksheet, columns) {
  columns.forEach((col, i) => {
    const maxLen = Math.max(
      String(col.label || '').length,
      ...col.values.map(v => String(v ?? '').length)
    )
    worksheet.getColumn(i + 1).width = Math.min(Math.max(maxLen + 4, 12), 40)
  })
}

/**
 * GET /api/fde/reports/projects/export
 * 项目列表报表
 * Query: status, customerId, from, to
 */
router.get('/projects/export', async (req, res) => {
  try {
    const { status, customerId, from, to, exclude_status } = req.query
    const where = { deletedAt: null }
    if (status) where.status = status
    // 与项目列表页一致: 未选状态时默认不含已验收
    else if (exclude_status) where.status = { notIn: String(exclude_status).split(',').filter(Boolean) }
    if (customerId) where.customerId = BigInt(customerId)
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }

    const projects = await prisma.project.findMany({
      where,
      include: { customer: { select: { name: true, shortName: true } } },
      orderBy: { id: 'desc' }
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = getBrand().name
    wb.created = new Date()
    const ws = wb.addWorksheet('项目列表', {
      properties: { tabColor: { argb: '5B3ED8' } }
    })

    const columns = [
      { header: '项目编号', key: 'code', width: 22 },
      { header: '项目名称', key: 'name', width: 36 },
      { header: '客户', key: 'customer', width: 24 },
      { header: '类型', key: 'type', width: 12 },
      { header: '状态', key: 'status', width: 14 },
      { header: '健康度', key: 'health', width: 10 },
      { header: '进度(%)', key: 'progress', width: 10 },
      { header: '预算(元)', key: 'budget', width: 16 },
      { header: '实际成本(元)', key: 'actualCost', width: 18 },
      { header: '开始日期', key: 'startDate', width: 14 },
      { header: '结束日期', key: 'endDate', width: 14 },
      { header: '描述', key: 'description', width: 40 }
    ]
    ws.columns = columns

    const statusMap = { DRAFT: '草稿', PROPOSAL: '方案中', APPROVED: '已批准', IN_PROGRESS: '进行中', ACCEPTED: '已验收', CLOSED: '已关闭', CANCELLED: '已取消' }
    const typeMap = { NEW: '新建', UPGRADE: '升级', MAINTENANCE: '运维', TRAINING: '培训' }
    const healthMap = { GREEN: '🟢 绿', YELLOW: '🟡 黄', RED: '🔴 红' }

    projects.forEach(p => {
      ws.addRow({
        code: p.code, name: p.name,
        customer: p.customer?.shortName || p.customer?.name || '',
        type: typeMap[p.type] || p.type || '',
        status: statusMap[p.status] || p.status,
        health: healthMap[p.health] || '',
        progress: p.progress,
        budget: Number(p.budget || 0),
        actualCost: Number(p.actualCost || 0),
        startDate: p.startDate ? new Date(p.startDate).toISOString().slice(0, 10) : '',
        endDate: p.endDate ? new Date(p.endDate).toISOString().slice(0, 10) : '',
        description: p.description || ''
      })
    })

    // 样式
    styleHeader(ws)
    // 数字列右对齐 + 千分位
    ;['budget', 'actualCost'].forEach(k => {
      const col = ws.getColumn(columns.findIndex(c => c.key === k) + 1)
      col.numFmt = '#,##0.00'
      col.alignment = { horizontal: 'right' }
    })
    ws.getColumn(columns.findIndex(c => c.key === 'progress') + 1).alignment = { horizontal: 'center' }

    // 冻结表头
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    // 汇总行
    const totalBudget = projects.reduce((s, p) => s + Number(p.budget || 0), 0)
    ws.addRow([])
    const summaryRow = ws.addRow(['', '合计', '', '', '', '', '',
      `¥${totalBudget.toLocaleString('zh-CN')}`,
      '', '', '', ''
    ])
    summaryRow.font = { bold: true }
    summaryRow.getCell(2).alignment = { horizontal: 'right' }

    const filename = `项目列表_${new Date().toISOString().slice(0, 10)}`
    await sendWorkbook(res, filename, wb)
  } catch (e) {
    console.error('[reports/projects/export]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/reports/timesheets/export
 * 工时月报
 * Query: from, to, projectId, engineerId, status
 */
router.get('/timesheets/export', async (req, res) => {
  try {
    const { from, to, projectId, engineerId, status } = req.query
    const where = { deletedAt: null }
    if (projectId) where.projectId = BigInt(projectId)
    if (engineerId) where.engineerId = BigInt(engineerId)
    if (status) where.status = status
    if (from || to) {
      where.workDate = {}
      if (from) where.workDate.gte = new Date(from)
      if (to) where.workDate.lte = new Date(to)
    }

    const timesheets = await prisma.timesheet.findMany({
      where,
      include: {
        project: { select: { code: true, name: true } },
        engineer: { include: { user: { select: { name: true } } } }
      },
      orderBy: [{ workDate: 'desc' }, { id: 'desc' }]
    })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('工时明细')
    ws.columns = [
      { header: '日期', key: 'workDate', width: 14 },
      { header: '项目编号', key: 'projectCode', width: 22 },
      { header: '项目名称', key: 'projectName', width: 32 },
      { header: '工程师', key: 'engineer', width: 14 },
      { header: '工时(h)', key: 'hours', width: 10 },
      { header: '地点', key: 'location', width: 14 },
      { header: '状态', key: 'status', width: 12 },
      { header: '工作内容', key: 'workContent', width: 50 }
    ]

    const statusMap = { DRAFT: '草稿', SUBMITTED: '已提交', APPROVED: '已批准', REJECTED: '已驳回' }
    timesheets.forEach(t => {
      ws.addRow({
        workDate: new Date(t.workDate).toISOString().slice(0, 10),
        projectCode: t.project?.code || '',
        projectName: t.project?.name || '',
        engineer: t.engineer?.user?.name || '',
        hours: Number(t.hours),
        location: t.location || '',
        status: statusMap[t.status] || t.status,
        workContent: t.workContent || ''
      })
    })
    styleHeader(ws)
    ws.getColumn('hours').numFmt = '0.0'
    ws.getColumn('hours').alignment = { horizontal: 'right' }
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    // 汇总：按工程师
    const ws2 = wb.addWorksheet('按工程师汇总')
    ws2.columns = [
      { header: '工程师', key: 'name', width: 18 },
      { header: '工时合计(h)', key: 'totalHours', width: 16 },
      { header: '记录数', key: 'count', width: 12 }
    ]
    const byEng = {}
    timesheets.forEach(t => {
      const k = t.engineer?.user?.name || '未知'
      if (!byEng[k]) byEng[k] = { totalHours: 0, count: 0 }
      byEng[k].totalHours += Number(t.hours)
      byEng[k].count++
    })
    Object.entries(byEng).sort((a, b) => b[1].totalHours - a[1].totalHours).forEach(([name, v]) => {
      ws2.addRow({ name, totalHours: Number(v.totalHours.toFixed(1)), count: v.count })
    })
    styleHeader(ws2)
    ws2.getColumn('totalHours').numFmt = '0.0'

    // 汇总：按项目
    const ws3 = wb.addWorksheet('按项目汇总')
    ws3.columns = [
      { header: '项目编号', key: 'code', width: 22 },
      { header: '项目名称', key: 'name', width: 32 },
      { header: '工时合计(h)', key: 'totalHours', width: 16 },
      { header: '记录数', key: 'count', width: 12 }
    ]
    const byProj = {}
    timesheets.forEach(t => {
      const k = t.project?.code || ''
      if (!k) return
      if (!byProj[k]) byProj[k] = { name: t.project?.name || '', totalHours: 0, count: 0 }
      byProj[k].totalHours += Number(t.hours)
      byProj[k].count++
    })
    Object.entries(byProj).sort((a, b) => b[1].totalHours - a[1].totalHours).forEach(([code, v]) => {
      ws3.addRow({ code, name: v.name, totalHours: Number(v.totalHours.toFixed(1)), count: v.count })
    })
    styleHeader(ws3)
    ws3.getColumn('totalHours').numFmt = '0.0'

    const rangeTag = from || to ? `_${from || ''}_${to || ''}` : `_${new Date().toISOString().slice(0, 7)}`
    await sendWorkbook(res, `工时月报${rangeTag}`, wb)
  } catch (e) {
    console.error('[reports/timesheets/export]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/reports/customers/export
 * 客户列表
 */
router.get('/customers/export', async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      include: { projects: { where: { deletedAt: null }, select: { id: true } } },
      orderBy: { id: 'asc' }
    })
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('客户列表')
    ws.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: '客户全称', key: 'name', width: 32 },
      { header: '简称', key: 'shortName', width: 16 },
      { header: '行业', key: 'industry', width: 16 },
      { header: '规模', key: 'scale', width: 12 },
      { header: '项目数', key: 'projectCount', width: 10 },
      { header: '地址', key: 'address', width: 40 },
      { header: '标签', key: 'tags', width: 24 },
      { header: '备注', key: 'notes', width: 30 }
    ]
    const scaleMap = { SMALL: '小型', MEDIUM: '中型', LARGE: '大型', GIANT: '巨型' }
    customers.forEach(c => {
      ws.addRow({
        id: Number(c.id),
        name: c.name,
        shortName: c.shortName || '',
        industry: c.industry || '',
        scale: scaleMap[c.scale] || c.scale || '',
        projectCount: c.projects.length,
        address: c.address || '',
        tags: Array.isArray(c.tags) ? c.tags.join('、') : '',
        notes: c.notes || ''
      })
    })
    styleHeader(ws)
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    await sendWorkbook(res, `客户列表_${new Date().toISOString().slice(0, 10)}`, wb)
  } catch (e) {
    console.error('[reports/customers/export]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
