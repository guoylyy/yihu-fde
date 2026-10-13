// v2.0.9 Skills 能力包 CRUD (#428)
// 能力包 = 元数据 + SKILL.md 原文, 供人工维护与 Agent 经 MCP 工具维护。
// 权限: skillPackage.view 全员可读(启用中的); skillPackage.manage 才能增删改。
// 注意: 老的 /api/fde/skills 是工程师技能主数据, 本路由是 /api/fde/skill-packages, 互不相干。
import { Router } from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission, hasPermission } from '../../lib/auth.js'
import { recordActivity } from '../../lib/activity.js'

const router = Router()
router.use(internalAuth)

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,79}$/
// v2.1.1(#455) 移除草稿态: 双态 启用/停用, 新增默认停用(schema default DISABLED); 存量 DRAFT 由发版脚本归一为 DISABLED
const STATUSES = ['ENABLED', 'DISABLED']

// 保存时从 SKILL.md frontmatter 回填缺失元数据(name/description/keywords)
function parseFrontmatter(content) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content || '')
  if (!m) return {}
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim())
    if (kv) out[kv[1]] = kv[2].trim()
  }
  return out
}

/** Agent 检索命中记录一条日志(action=LOAD/SEARCH) */
async function logUsage(pkg, { actorType = 'USER', actorId, actorName, action = 'LOAD' }) {
  try {
    await prisma.skillUsageLog.create({
      data: { skillPackageId: pkg.id, skillName: pkg.name, actorType, actorId: actorId ? BigInt(actorId) : null, actorName, action }
    })
  } catch (e) { console.warn('[skill-usage-log]', e.message) }
}

/**
 * GET /api/fde/skill-packages?keyword=&category=&status=&page=&page_size=
 * 列表: 名称/描述/分类/触发词 模糊搜索; 无 skillPackage.manage 权限时只看 ENABLED
 */
router.get('/', async (req, res) => {
  try {
    const { keyword = '', category = '', status = '', page = 1, page_size = 20 } = req.query
    const where = { deletedAt: null }
    if (!hasPermission(req.user, 'skillPackage.manage')) where.status = 'ENABLED'
    else if (status && STATUSES.includes(status)) where.status = status
    if (category) where.category = category
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { displayName: { contains: keyword } },
        { description: { contains: keyword } },
        { category: { contains: keyword } }
      ]
    }
    const [list, total] = await Promise.all([
      prisma.skillPackage.findMany({
        where,
        select: { id: true, name: true, displayName: true, description: true, category: true, keywords: true, version: true, status: true, projectId: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        skip: (Number(page) - 1) * Number(page_size),
        take: Number(page_size)
      }),
      prisma.skillPackage.count({ where })
    ])
    res.json({ code: 0, message: 'ok', data: { list, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    console.error('[skill-packages GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /match?text=<任务上下文>&projectId=   v2.0.9(#431)
 * Agent 触发机制: 按任务上下文文本匹配 skills —— 触发词命中(权重3) > 描述命中(2) > 名称/分类命中(1),
 * 返回按得分排序的 ENABLED skills(含 content 全文, Agent 拿到即可注入上下文), 并记 SEARCH 日志。
 */
router.get('/match', async (req, res) => {
  try {
    const text = String(req.query.text || '').trim()
    if (!text) return res.status(400).json({ code: 1001, message: 'text 必填(任务上下文/用户指令原文)' })
    const where = { deletedAt: null, status: 'ENABLED' }
    if (req.query.projectId) where.OR = [{ projectId: null }, { projectId: BigInt(req.query.projectId) }]
    const candidates = await prisma.skillPackage.findMany({ where, select: { id: true, name: true, displayName: true, description: true, category: true, keywords: true, content: true, version: true } })
    const scored = []
    for (const c of candidates) {
      let score = 0
      const hits = []
      for (const kw of (c.keywords || [])) {
        if (kw && text.includes(kw)) { score += 3; hits.push(kw) }
      }
      const haystack = `${c.name} ${c.displayName || ''} ${c.description || ''} ${c.category || ''}`
      for (const term of text.split(/[\s,，。;；!！?？]+/).filter(t => t.length >= 2)) {
        if (haystack.includes(term)) { score += 2; hits.push(term) }
      }
      if (score > 0) scored.push({ ...c, score, hits: [...new Set(hits)].slice(0, 5) })
    }
    scored.sort((a, b) => b.score - a.score)
    // Agent 检索留痕(每 skill 一条 SEARCH)
    for (const s of scored.slice(0, 5)) {
      await prisma.skillUsageLog.create({
        data: {
          skillPackageId: s.id, skillName: s.name,
          actorType: req.user.agentProfileId ? 'AGENT' : 'USER',
          actorId: req.user.agentProfileId || req.user.id,
          actorName: req.user.username, action: 'SEARCH'
        }
      }).catch(() => {})
    }
    res.json({ code: 0, message: 'ok', data: { list: scored.slice(0, 5), text: text.slice(0, 200) } })
  } catch (e) {
    console.error('[skill-packages match]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /:id  详情(含 content 全文); 无维护权限只能看 ENABLED
 */
router.get('/:id', async (req, res) => {
  try {
    const where = { id: BigInt(req.params.id), deletedAt: null }
    if (!hasPermission(req.user, 'skillPackage.manage')) where.status = 'ENABLED'
    const pkg = await prisma.skillPackage.findFirst({ where })
    if (!pkg) return res.status(404).json({ code: 2004, message: 'Skill 不存在或无权查看(可能未启用)' })
    if (String(req.query.log) === '1') await logUsage(pkg, { actorType: req.user.apiKeyScope ? 'AGENT' : 'USER', actorId: req.user.id, actorName: req.user.username, action: 'LOAD' })
    res.json({ code: 0, message: 'ok', data: pkg })
  } catch (e) {
    console.error('[skill-packages GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

function pickBody(body) {
  const data = {}
  if (body.name != null) data.name = String(body.name).trim()
  if (body.displayName !== undefined) data.displayName = body.displayName ? String(body.displayName).slice(0, 100) : null
  if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 500) : null
  if (body.category !== undefined) data.category = body.category ? String(body.category).slice(0, 50) : null
  if (body.keywords !== undefined) data.keywords = Array.isArray(body.keywords) ? body.keywords.map(k => String(k)).slice(0, 20) : null
  if (body.content != null) data.content = String(body.content)
  if (body.status != null && STATUSES.includes(body.status)) data.status = body.status
  if (body.attachments !== undefined) data.attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : null
  if (body.projectId !== undefined) data.projectId = body.projectId ? BigInt(body.projectId) : null
  return data
}

/**
 * POST /  新建(需 skillPackage.manage)
 * body: { name, displayName?, description?, category?, keywords?, content, status?, projectId? }
 * content 带 frontmatter 时缺失字段自动回填
 */
router.post('/', requirePermission('skillPackage.manage'), async (req, res) => {
  try {
    const data = pickBody(req.body || {})
    if (!data.name || !NAME_RE.test(data.name)) {
      return res.status(400).json({ code: 1001, message: 'name 必填且为 kebab-case（小写字母/数字/连字符, 2-80 位）' })
    }
    if (!data.content || !data.content.trim()) return res.status(400).json({ code: 1001, message: 'content(SKILL.md 正文) 必填' })
    const fm = parseFrontmatter(data.content)
    if (!data.displayName && fm.name) data.displayName = fm.name.slice(0, 100)
    if (!data.description && fm.description) data.description = fm.description.slice(0, 500)
    const dup = await prisma.skillPackage.findFirst({ where: { name: data.name, deletedAt: null } })
    if (dup) return res.status(400).json({ code: 1005, message: `name「${data.name}」已存在` })
    const pkg = await prisma.skillPackage.create({
      data: { ...data, createdBy: BigInt(req.user.id), updatedBy: BigInt(req.user.id) }
    })
    recordActivity({ actorId: BigInt(req.user.id), entity: 'skill', entityId: pkg.id, action: 'skill_created', summary: `创建了 Skill「${pkg.name}」` })
    res.json({ code: 0, message: 'ok', data: pkg })
  } catch (e) {
    console.error('[skill-packages POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /:id  编辑(需 skillPackage.manage); content 变更时 version+1
 */
router.put('/:id', requirePermission('skillPackage.manage'), async (req, res) => {
  try {
    const pkg = await prisma.skillPackage.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!pkg) return res.status(404).json({ code: 2004, message: 'Skill 不存在' })
    const data = pickBody(req.body || {})
    if (data.name != null && !NAME_RE.test(data.name)) return res.status(400).json({ code: 1001, message: 'name 必须为 kebab-case' })
    if (data.name && data.name !== pkg.name) {
      const dup = await prisma.skillPackage.findFirst({ where: { name: data.name, deletedAt: null, NOT: { id: pkg.id } } })
      if (dup) return res.status(400).json({ code: 1005, message: `name「${data.name}」已存在` })
    }
    if (data.content != null && data.content !== pkg.content) data.version = pkg.version + 1
    const updated = await prisma.skillPackage.update({
      where: { id: pkg.id },
      data: { ...data, updatedBy: BigInt(req.user.id) }
    })
    res.json({ code: 0, message: 'ok', data: updated })
  } catch (e) {
    console.error('[skill-packages PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /:id  软删(需 skillPackage.manage)
 */
router.delete('/:id', requirePermission('skillPackage.manage'), async (req, res) => {
  try {
    const pkg = await prisma.skillPackage.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!pkg) return res.status(404).json({ code: 2004, message: 'Skill 不存在' })
    await prisma.skillPackage.update({ where: { id: pkg.id }, data: { deletedAt: new Date(), status: 'DISABLED' } })
    res.json({ code: 0, message: 'ok' })
  } catch (e) {
    console.error('[skill-packages DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /:id/usage-logs  调用日志(需 skillPackage.manage, 支撑 #431 平台可查)
 */
router.get('/:id/usage-logs', requirePermission('skillPackage.manage'), async (req, res) => {
  try {
    const { page = 1, page_size = 50 } = req.query
    const where = { skillPackageId: BigInt(req.params.id) }
    const [list, total] = await Promise.all([
      prisma.skillUsageLog.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(page_size), take: Number(page_size)
      }),
      prisma.skillUsageLog.count({ where })
    ])
    res.json({ code: 0, message: 'ok', data: { list, total } })
  } catch (e) {
    console.error('[skill-packages usage-logs]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
