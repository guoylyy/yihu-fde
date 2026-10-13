// FDE 平台 - 客户管理 API（内部）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { logInternalAction } from '../../lib/audit.js'  // v2.1.6(#489) 联系人变更留痕
import { internalAuth, requireRole, requirePermission } from '../../lib/auth.js'
import { recordActivity } from '../../lib/activity.js'
import { pushNotificationToRole } from '../../lib/notify.js'

const router = express.Router()
router.use(internalAuth)
// 客户管理：ADMIN / MANAGER
router.use(requirePermission('customer.access'))

// 允许编辑的字段白名单
const CUSTOMER_FIELDS = ['name', 'shortName', 'industry', 'scale', 'address', 'tags', 'status', 'notes']
const CONTACT_FIELDS = ['name', 'title', 'phone', 'email', 'isPrimary', 'notes']

function pick(obj, fields) {
  const out = {}
  for (const k of fields) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

/**
 * GET /api/fde/customers
 * 客户列表（支持搜索 + 分页 + 行业/规模筛选）
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, page_size = 20, keyword = '', industry = '', scale = '' } = req.query
    const skip = (Number(page) - 1) * Number(page_size)
    const where = { deletedAt: null }
    if (keyword) where.name = { contains: keyword }
    if (industry) where.industry = industry
    if (scale) where.scale = scale

    const [list, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: Number(page_size),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { projects: true, contacts: true } }
        }
      }),
      prisma.customer.count({ where })
    ])

    res.json({ code: 0, message: 'ok', data: { list, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    console.error('[fde/customers GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/customers/:id
 * 客户详情（含联系人 + 项目数）
 */
router.get('/:id', async (req, res) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: BigInt(req.params.id), deletedAt: null },
      include: {
        contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
        projects: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true, code: true, name: true, status: true, progress: true, health: true, startDate: true, endDate: true }
        }
      }
    })
    if (!customer) return res.status(404).json({ code: 2004, message: '客户不存在' })
    res.json({ code: 0, message: 'ok', data: customer })
  } catch (e) {
    console.error('[fde/customers GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/customers/_meta/stats
 * 客户统计（仪表盘用）
 */
router.get('/_meta/stats', async (req, res) => {
  try {
    const [total, byIndustry] = await Promise.all([
      prisma.customer.count({ where: { deletedAt: null } }),
      prisma.customer.groupBy({
        by: ['industry'],
        where: { deletedAt: null, industry: { not: null } },
        _count: { _all: true }
      })
    ])
    res.json({
      code: 0,
      message: 'ok',
      data: { total, byIndustry: byIndustry.map(b => ({ industry: b.industry, count: b._count._all })) }
    })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/customers
 * 新建客户
 * body: { name, shortName?, industry?, scale?, address?, tags?, notes? }
 */
router.post('/', requirePermission('customer.create'), async (req, res) => {
  try {
    const data = pick(req.body, CUSTOMER_FIELDS)
    if (!data.name) return res.status(400).json({ code: 1001, message: '客户名称不能为空' })
    // tags 必须是 JSON 数组
    if (data.tags && !Array.isArray(data.tags)) {
      return res.status(400).json({ code: 1002, message: 'tags 必须是数组' })
    }
    const customer = await prisma.customer.create({ data })
    // 活动流 + 通知 MANAGER
    await recordActivity({
      actorId: req.user.id,
      entity: 'customer',
      entityId: customer.id,
      action: 'created',
      summary: `创建客户「${customer.name}」${customer.industry ? `（${customer.industry}）` : ''}`,
      data: { industry: customer.industry, scale: customer.scale }
    })
    await pushNotificationToRole('MANAGER', {
      type: 'CUSTOMER_CREATED',
      title: '🏢 新客户创建',
      body: `${customer.name}（${customer.industry || '未设行业'}）`,
      link: '/admin/customers',
      data: {
        customerId: String(customer.id),
        name: customer.name,
        industry: customer.industry,
        scale: customer.scale
      }
    })
    res.json({ code: 0, message: 'ok', data: customer })
  } catch (e) {
    console.error('[fde/customers POST /]', e)
    if (e.code === 'P2002') return res.status(400).json({ code: 1003, message: '客户名称已存在' })
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/customers/:id
 * 更新客户
 */
router.put('/:id', requirePermission('customer.edit'), async (req, res) => {
  try {
    const data = pick(req.body, CUSTOMER_FIELDS)
    if (data.tags !== undefined && !Array.isArray(data.tags)) {
      return res.status(400).json({ code: 1002, message: 'tags 必须是数组' })
    }
    const old = await prisma.customer.findUnique({ where: { id: BigInt(req.params.id) } })
    if (!old) return res.status(404).json({ code: 2004, message: '客户不存在' })
    const customer = await prisma.customer.update({
      where: { id: BigInt(req.params.id) },
      data
    })
    // 活动流：记录关键字段变化
    const changes = []
    if (old.name !== customer.name) changes.push(`名称「${old.name}」→「${customer.name}」`)
    if (old.level !== customer.level) changes.push(`级别 ${old.level}→${customer.level}`)
    if (old.industry !== customer.industry) changes.push(`行业「${old.industry || '未设'}」→「${customer.industry || '未设'}」`)
    if (changes.length) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'customer',
        entityId: customer.id,
        action: 'updated',
        summary: `更新客户「${customer.name}」：${changes.join('，')}`,
        data: { changes: changes.join(';') }
      })
    }
    res.json({ code: 0, message: 'ok', data: customer })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '客户不存在' })
    if (e.code === 'P2002') return res.status(400).json({ code: 1003, message: '客户名称已存在' })
    console.error('[fde/customers PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/customers/:id
 * 软删除客户
 */
router.delete('/:id', requirePermission('customer.delete'), async (req, res) => {
  try {
    const old = await prisma.customer.findUnique({ where: { id: BigInt(req.params.id) } })
    await prisma.customer.update({
      where: { id: BigInt(req.params.id) },
      data: { deletedAt: new Date() }
    })
    if (old) {
      await recordActivity({
        actorId: req.user.id,
        entity: 'customer',
        entityId: BigInt(req.params.id),
        action: 'updated',
        summary: `归档客户「${old.name}」`,
        data: { action: 'archive' }
      })
    }
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '客户不存在' })
    console.error('[fde/customers DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})


// v2.1.6(#489): 联系人字段校验 —— 手机/邮箱至少一个(评价发送依赖), 格式合法
function validateContact(data) {
  const phone = (data.phone || '').trim()
  const email = (data.email || '').trim()
  if (!phone && !email) return '手机号与邮箱至少填写一个（评价发送依赖联系方式）'
  if (phone && !/^[0-9+\-\s]{5,20}$/.test(phone)) return '手机号格式不正确'
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '邮箱格式不正确'
  return null
}

/**
 * POST /api/fde/customers/:id/contacts
 * 添加联系人
 */
router.post('/:id/contacts', requirePermission('customer.edit'), async (req, res) => {
  try {
    const data = pick(req.body, CONTACT_FIELDS)
    if (!data.name) return res.status(400).json({ code: 1001, message: '联系人姓名不能为空' })
    const invalid = validateContact(data)
    if (invalid) return res.status(400).json({ code: 1002, message: invalid })
    const contact = await prisma.contact.create({
      data: { ...data, customerId: BigInt(req.params.id) }
    })
    // 如果设为主联系人，先取消同客户的其它主联系人
    if (data.isPrimary === 1 || data.isPrimary === true) {
      await prisma.contact.updateMany({
        where: { customerId: BigInt(req.params.id), id: { not: contact.id } },
        data: { isPrimary: 0 }
      })
    }
    logInternalAction(req, 'CUSTOMER_CONTACT_ADD', { resourceType: 'contact', resourceId: contact.id, details: { customerId: req.params.id, name: data.name } })
    res.json({ code: 0, message: 'ok', data: contact })
  } catch (e) {
    console.error('[fde/customers POST /:id/contacts]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/customers/:customerId/contacts/:contactId
 * 删除联系人
 */
router.delete('/:customerId/contacts/:contactId', requirePermission('customer.edit'), async (req, res) => {
  try {
    await prisma.contact.update({
      where: { id: BigInt(req.params.contactId) },
      data: { deletedAt: new Date() }
    })
    logInternalAction(req, 'CUSTOMER_CONTACT_DELETE', { resourceType: 'contact', resourceId: req.params.contactId, details: { customerId: req.params.customerId } })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '联系人不存在' })
    console.error('[fde/customers DELETE /:customerId/contacts/:contactId]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/customers/:customerId/contacts/:contactId
 * 编辑联系人
 */
router.put('/:customerId/contacts/:contactId', requirePermission('customer.edit'), async (req, res) => {
  try {
    const data = pick(req.body, CONTACT_FIELDS)
    if (!data.name) return res.status(400).json({ code: 1001, message: '联系人姓名不能为空' })
    const invalid = validateContact(data)
    if (invalid) return res.status(400).json({ code: 1002, message: invalid })
    // 如果设为主联系人，先取消同客户的其它主联系人
    if (data.isPrimary === 1 || data.isPrimary === true) {
      await prisma.contact.updateMany({
        where: { customerId: BigInt(req.params.customerId), id: { not: BigInt(req.params.contactId) }, deletedAt: null },
        data: { isPrimary: 0 }
      })
    }
    const contact = await prisma.contact.update({
      where: { id: BigInt(req.params.contactId) },
      data
    })
    logInternalAction(req, 'CUSTOMER_CONTACT_UPDATE', { resourceType: 'contact', resourceId: req.params.contactId, details: { customerId: req.params.customerId, name: data.name } })
    res.json({ code: 0, message: 'ok', data: contact })
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ code: 2004, message: '联系人不存在' })
    console.error('[fde/customers PUT /:customerId/contacts/:contactId]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
