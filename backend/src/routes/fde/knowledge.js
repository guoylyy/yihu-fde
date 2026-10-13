// FDE 平台 - 知识库 API（仅内部，customer 不能访问）
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requireRole, requirePermission } from '../../lib/auth.js'
import { notifyChat } from '../../lib/chatNotify.js'
import { buildKnowledgeWhere, toListItem, aggregateTags } from '../../lib/knowledgeQuery.js'

const router = express.Router()
router.use(internalAuth)
// 内部所有角色（含工程师）都可看
router.use(requirePermission('knowledge.access'))

const ARTICLE_FIELDS = ['title', 'category', 'content', 'tags', 'projectId']

function pick(obj, fields) {
  const out = {}
  for (const k of fields) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

// 标准化 tags：字符串 / 数组都接
function normalizeTags(v) {
  if (!v) return null
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  return null
}

/**
 * GET /api/fde/knowledge
 * 列表 + 筛选。v2.5.5(#913) 博客化: 新增 author_id / tag / date_from / date_to,
 * keyword 扩到分类与标签; 列表项默认不带正文, 附 summary/readMinutes(with_content=1 时保留正文, MCP 旧调用兼容)
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, page_size = 20 } = req.query
    const skip = (Number(page) - 1) * Number(page_size)
    const where = buildKnowledgeWhere(req.query)
    const keepContent = ['1', 'true'].includes(String(req.query.with_content || req.query.withContent || ''))

    const [rows, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({
        where,
        skip,
        take: Number(page_size),
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          author: { select: { id: true, name: true } },
          project: { select: { id: true, code: true, name: true } }
        }
      }),
      prisma.knowledgeArticle.count({ where })
    ])
    const list = rows.map(r => toListItem(r, { keepContent }))

    res.json({ code: 0, data: { list, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    console.error('[fde/knowledge GET /]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * GET /api/fde/knowledge/authors
 * v2.5.5(#913) 作者字典(去重 + 计数), 博客列表按作者筛选用
 */
router.get('/authors', async (req, res) => {
  try {
    const grouped = await prisma.knowledgeArticle.groupBy({
      by: ['createdBy'],
      where: { deletedAt: null },
      _count: { createdBy: true }
    })
    const ids = grouped.map(g => g.createdBy)
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
    const nameOf = new Map(users.map(u => [String(u.id), u.name]))
    const list = grouped
      .map(g => ({ id: g.createdBy, name: nameOf.get(String(g.createdBy)) || `用户#${g.createdBy}`, count: g._count.createdBy }))
      .sort((a, b) => b.count - a.count)
    res.json({ code: 0, data: list })
  } catch (e) {
    console.error('[fde/knowledge GET /authors]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * GET /api/fde/knowledge/tags
 * v2.5.5(#913) 标签字典(去重 + 计数); tags 是 JSON 列, 无法 groupBy, 在应用层汇总(文章量级几十到几百, 可接受)
 */
router.get('/tags', async (req, res) => {
  try {
    const rows = await prisma.knowledgeArticle.findMany({ where: { deletedAt: null }, select: { tags: true } })
    res.json({ code: 0, data: aggregateTags(rows) })
  } catch (e) {
    console.error('[fde/knowledge GET /tags]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * GET /api/fde/knowledge/categories
 * 分类字典（去重 + 计数）
 */
router.get('/categories', async (req, res) => {
  try {
    const grouped = await prisma.knowledgeArticle.groupBy({
      by: ['category'],
      where: { deletedAt: null, category: { not: null } },
      _count: { category: true }
    })
    const list = grouped
      .filter(g => g.category)
      .map(g => ({ name: g.category, count: g._count.category }))
      .sort((a, b) => b.count - a.count)
    res.json({ code: 0, data: list })
  } catch (e) {
    console.error('[fde/knowledge GET /categories]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * GET /api/fde/knowledge/:id
 * 详情（含关联交付物 + 关联项目）
 */
router.get('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const a = await prisma.knowledgeArticle.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true, customerId: true } },
      }
    })
    if (!a || a.deletedAt) return res.status(404).json({ code: 404, message: '文章不存在' })
    res.json({ code: 0, data: a })
  } catch (e) {
    console.error('[fde/knowledge GET /:id]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * POST /api/fde/knowledge/:id/view
 * 浏览计数 +1
 */
router.post('/:id/view', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const updated = await prisma.knowledgeArticle.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true }
    })
    res.json({ code: 0, data: { viewCount: updated.viewCount } })
  } catch (e) {
    console.error('[fde/knowledge POST /:id/view]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * POST /api/fde/knowledge
 * 新建（含关联交付物）
 */
router.post('/', requirePermission('knowledge.create'), async (req, res) => {
  try {
    const body = req.body
    if (!body.title || !body.content) {
      return res.status(400).json({ code: 400, message: '标题 / 内容不能为空' })
    }

    const data = pick(body, ARTICLE_FIELDS)
    data.tags = normalizeTags(data.tags)
    if (data.projectId) data.projectId = BigInt(data.projectId)
    data.createdBy = BigInt(req.user.id)
    const article = await prisma.knowledgeArticle.create({
      data,
      include: {
        author: { select: { id: true, name: true } }
      }
    })

    notifyChat({
      title: `📚 知识库新增：${article.title}`,
      content: `${req.user.name} 发布了一篇知识文章（${article.category || '未分类'}）`
    }).catch(() => {})

    res.json({ code: 0, data: article })
  } catch (e) {
    console.error('[fde/knowledge POST /]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * PUT /api/fde/knowledge/:id
 * 编辑（标题 / 内容 / 分类 / 标签 / 关联项目 / 关联交付物）
 */
router.put('/:id', requirePermission('knowledge.edit'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.knowledgeArticle.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) return res.status(404).json({ code: 404, message: '文章不存在' })

    const body = req.body
    const data = {}
    if (body.title !== undefined) data.title = body.title
    if (body.category !== undefined) data.category = body.category
    if (body.content !== undefined) data.content = body.content
    if (body.tags !== undefined) data.tags = normalizeTags(body.tags)
    if (body.projectId !== undefined) data.projectId = body.projectId ? BigInt(body.projectId) : null

    const updated = await prisma.knowledgeArticle.update({
      where: { id },
      data,
      include: {
        author: { select: { id: true, name: true } }
      }
    })
    res.json({ code: 0, data: updated })
  } catch (e) {
    console.error('[fde/knowledge PUT /:id]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

/**
 * DELETE /api/fde/knowledge/:id
 */
router.delete('/:id', requirePermission('knowledge.delete'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.knowledgeArticle.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) return res.status(404).json({ code: 404, message: '文章不存在' })
    await prisma.knowledgeArticle.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    console.error('[fde/knowledge DELETE /:id]', e)
    res.status(500).json({ code: 500, message: e.message })
  }
})

export default router