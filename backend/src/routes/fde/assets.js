// v2.7 项目资产库 (#1140)
// 资产 = 另一个项目可以直接拿走用、且省 ≥1 人天的能力单元(三层 × 数据/方案/界面三类产物)。
// 方案: docs/01-产品与需求/项目资产沉淀方案-任务1140.md
//
// 权限口径:
//   asset.view   全员内部角色可看已发布资产
//   asset.create 工程师可登记(一律进 DRAFT 待审) —— 登记门槛要低, 否则库永远填不满
//   asset.use    登记复用(项目要在自己的数据范围内)
//   asset.manage 发布/改任意资产/删除/关联/版本
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission, hasPermission, buildScopeWhere } from '../../lib/auth.js'
import { buildScopedWhere } from '../../lib/scopedQuery.js'
import { logInternalAction } from '../../lib/audit.js'
import {
  ASSET_LAYERS, ASSET_LAYER_LABELS, ASSET_MATURITIES, ASSET_MATURITY_LABELS, ASSET_STATUSES,
  ASSET_AUTHORIZATIONS, ASSET_USAGE_MODES, ASSET_LINK_TYPES,
  scanAssetForLeaks, suggestAssets, taskContextText
} from '../../services/assets.js'
import { draftAssetFromProject } from '../../services/assetDraft.js'

const router = express.Router()
router.use(internalAuth)

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/

function toBigInt(v) {
  try { return v === undefined || v === null || v === '' ? null : BigInt(v) } catch { return undefined }
}
function strList(v, max = 30) {
  if (v === undefined) return undefined
  const list = Array.isArray(v) ? v : String(v || '').split(/[,，、\n]/)
  return [...new Set(list.map(x => String(x).trim()).filter(Boolean))].slice(0, max)
}

/** 资产查询条件: 非管理者只看已发布 + 自己登记的草稿 */
function visibilityWhere(user) {
  if (hasPermission(user, 'asset.manage')) return {}
  return { OR: [{ status: 'PUBLISHED' }, { createdBy: BigInt(user.id) }] }
}

async function findAsset(user, idOrSlug) {
  const key = String(idOrSlug)
  const where = /^\d+$/.test(key) ? { id: BigInt(key) } : { slug: key }
  return prisma.asset.findFirst({ where: { ...where, deletedAt: null, AND: [visibilityWhere(user)] } })
}

/** 校验并规整写入字段; partial=编辑 */
function assetPayload(b, { partial = false, isManager = false } = {}) {
  const out = {}
  const need = k => !partial || b[k] !== undefined
  if (need('slug')) {
    const slug = String(b.slug || '').trim().toLowerCase()
    if (!SLUG_RE.test(slug)) return { error: 'slug 需为小写字母/数字/短横线, 2~80 位, 如 express-quote' }
    out.slug = slug
  }
  if (need('name')) {
    out.name = String(b.name || '').trim().slice(0, 100)
    if (!out.name) return { error: '名称必填' }
  }
  if (need('summary')) {
    out.summary = String(b.summary || '').trim().slice(0, 300)
    if (!out.summary) return { error: '一句话说明必填' }
  }
  if (need('layer')) {
    if (!ASSET_LAYERS.includes(b.layer)) return { error: `layer 必须是 ${ASSET_LAYERS.join('/')}` }
    out.layer = b.layer
  }
  if (b.maturity !== undefined) {
    if (!ASSET_MATURITIES.includes(b.maturity)) return { error: `maturity 必须是 ${ASSET_MATURITIES.join('/')}` }
    out.maturity = b.maturity
  }
  if (b.authorization !== undefined) {
    if (!ASSET_AUTHORIZATIONS.includes(b.authorization)) return { error: `authorization 必须是 ${ASSET_AUTHORIZATIONS.join('/')}` }
    out.authorization = b.authorization
  }
  // 状态只有管理者能直接设; 工程师登记一律草稿, 发布走 /publish(要过扫描)
  if (b.status !== undefined && isManager) {
    if (!ASSET_STATUSES.includes(b.status)) return { error: `status 必须是 ${ASSET_STATUSES.join('/')}` }
    if (b.status === 'PUBLISHED') return { error: '发布请走「发布」操作(会做脱敏扫描)' }
    out.status = b.status
  }
  for (const k of ['techStack', 'industries', 'tags', 'keywords']) {
    const v = strList(b[k])
    if (v !== undefined) out[k] = v
  }
  if (b.sourcePaths !== undefined) out.sourcePaths = strList(b.sourcePaths, 50)
  for (const [k, max] of [['sourceRepo', 300], ['assetRepoPath', 200], ['demoUrl', 500], ['currentVersion', 40]]) {
    if (b[k] !== undefined) out[k] = b[k] ? String(b[k]).trim().slice(0, max) : null
  }
  if (out.demoUrl && !/^https?:\/\//i.test(out.demoUrl)) return { error: 'Demo 地址必须是 http(s)' }
  if (b.readme !== undefined) out.readme = b.readme ? String(b.readme) : null
  if (b.ontology !== undefined) {
    let o = b.ontology
    if (typeof o === 'string') {
      if (!o.trim()) o = null
      else { try { o = JSON.parse(o) } catch { return { error: 'ontology 需为 JSON' } } }
    }
    if (o !== null && (typeof o !== 'object' || Array.isArray(o))) return { error: 'ontology 需为对象 {objects, links, actions, shared}' }
    out.ontology = o
  }
  if (b.screenshots !== undefined) {
    const list = Array.isArray(b.screenshots) ? b.screenshots : []
    out.screenshots = list
      .map(x => (typeof x === 'string' ? { url: x } : { url: String(x?.url || ''), caption: x?.caption ? String(x.caption).slice(0, 100) : undefined }))
      .filter(x => /^https?:\/\//i.test(x.url) || x.url.startsWith('/'))
      .slice(0, 20)
  }
  if (b.sourceProjectId !== undefined) {
    const id = toBigInt(b.sourceProjectId)
    if (id === undefined) return { error: 'sourceProjectId 格式不正确' }
    out.sourceProjectId = id
  }
  if (b.ownerId !== undefined) {
    const id = toBigInt(b.ownerId)
    if (id === undefined) return { error: 'ownerId 格式不正确' }
    out.ownerId = id
  }
  if (b.estSavedDays !== undefined) {
    if (b.estSavedDays === null || b.estSavedDays === '') out.estSavedDays = null
    else {
      const n = Number(b.estSavedDays)
      if (!Number.isFinite(n) || n < 0 || n > 999) return { error: '预计节省人天需为 0~999' }
      out.estSavedDays = Math.round(n * 10) / 10
    }
  }
  // 口径校验: RESTRICTED 资产不能声称代码已抽离(L2/L3) —— 拍板③的硬约束
  const mat = out.maturity, auth = out.authorization
  if (mat && auth && ['L2', 'L3'].includes(mat) && auth === 'RESTRICTED') {
    return { error: '「仅参考」授权的资产不能标为 L2/L3（代码不得抽离）；请先确认客户授权或按通用重写后改为自研' }
  }
  return { data: out }
}

const LIST_SELECT = {
  id: true, slug: true, name: true, summary: true, layer: true, maturity: true, status: true,
  authorization: true, techStack: true, industries: true, tags: true, keywords: true,
  sourceProjectId: true, assetRepoPath: true, demoUrl: true, estSavedDays: true,
  currentVersion: true, usageCount: true, aiGenerated: true, ownerId: true, createdBy: true,
  createdAt: true, updatedAt: true,
  sourceProject: { select: { id: true, name: true, code: true } }
}

async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: list.map(BigInt) } }, select: { id: true, name: true } })
  return new Map(users.map(u => [String(u.id), u.name]))
}

/**
 * GET /api/fde/assets?keyword=&layer=&maturity=&status=&authorization=&industry=&tech=&sort=&page=&page_size=
 */
router.get('/', requirePermission('asset.view'), async (req, res) => {
  try {
    const { keyword = '', layer = '', maturity = '', status = '', authorization = '', industry = '', tech = '', sort = 'usage', page = 1, page_size = 20 } = req.query
    const and = [visibilityWhere(req.user)]
    const where = { deletedAt: null, AND: and }
    if (ASSET_LAYERS.includes(layer)) where.layer = layer
    if (ASSET_MATURITIES.includes(maturity)) where.maturity = maturity
    if (ASSET_STATUSES.includes(status)) where.status = status
    if (ASSET_AUTHORIZATIONS.includes(authorization)) where.authorization = authorization
    if (keyword) {
      and.push({ OR: [
        { name: { contains: keyword } }, { summary: { contains: keyword } },
        { slug: { contains: keyword } }, { readme: { contains: keyword } }
      ] })
    }
    // JSON 数组列用 array_contains 精确匹配(行业/技术栈都是枚举式短词)
    if (industry) and.push({ industries: { array_contains: [industry] } })
    if (tech) and.push({ techStack: { array_contains: [tech] } })
    const orderBy = sort === 'updated'
      ? [{ updatedAt: 'desc' }]
      : [{ usageCount: 'desc' }, { maturity: 'desc' }, { updatedAt: 'desc' }]
    const size = Math.min(100, Math.max(1, Number(page_size) || 20))
    const [list, total] = await Promise.all([
      prisma.asset.findMany({ where, select: LIST_SELECT, orderBy, skip: (Math.max(1, Number(page) || 1) - 1) * size, take: size }),
      prisma.asset.count({ where })
    ])
    const names = await userNames(list.map(a => a.ownerId))
    res.json({
      code: 0,
      data: {
        list: list.map(a => ({ ...a, ownerName: a.ownerId ? names.get(String(a.ownerId)) || '' : '' })),
        total, page: Number(page), page_size: size
      }
    })
  } catch (e) {
    console.error('[assets GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/assets/meta —— 枚举与筛选项(行业/技术栈取自现有数据), 前端下拉用
 */
router.get('/meta', requirePermission('asset.view'), async (req, res) => {
  try {
    const rows = await prisma.asset.findMany({
      where: { deletedAt: null, AND: [visibilityWhere(req.user)] },
      select: { industries: true, techStack: true, layer: true, maturity: true, status: true, usageCount: true, estSavedDays: true }
    })
    const industries = new Set(), techs = new Set()
    const byLayer = {}, byMaturity = {}
    let drafts = 0
    for (const r of rows) {
      ;(Array.isArray(r.industries) ? r.industries : []).forEach(x => industries.add(x))
      ;(Array.isArray(r.techStack) ? r.techStack : []).forEach(x => techs.add(x))
      byLayer[r.layer] = (byLayer[r.layer] || 0) + 1
      byMaturity[r.maturity] = (byMaturity[r.maturity] || 0) + 1
      if (r.status === 'DRAFT') drafts++
    }
    const usageAgg = await prisma.assetUsage.aggregate({
      where: { deletedAt: null, asset: { deletedAt: null } },
      _count: { _all: true }, _sum: { savedDays: true }
    })
    res.json({
      code: 0,
      data: {
        layers: ASSET_LAYER_LABELS, maturities: ASSET_MATURITY_LABELS,
        statuses: ASSET_STATUSES, authorizations: ASSET_AUTHORIZATIONS,
        usageModes: ASSET_USAGE_MODES, linkTypes: ASSET_LINK_TYPES,
        industries: [...industries].sort(), techStacks: [...techs].sort(),
        stats: {
          total: rows.length, drafts, byLayer, byMaturity,
          usageCount: usageAgg._count._all,
          savedDays: Number(usageAgg._sum.savedDays || 0)
        }
      }
    })
  } catch (e) {
    console.error('[assets GET /meta]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/assets/suggest?taskId= | ?text=&limit=3
 * 匹配推荐(与任务详情内联 suggestedAssets 同一套打分); 异常返空数组
 */
router.get('/suggest', requirePermission('asset.view'), async (req, res) => {
  try {
    let text = String(req.query.text || '')
    if (req.query.taskId) {
      const id = toBigInt(req.query.taskId)
      const task = id ? await prisma.task.findFirst({ where: { id, deletedAt: null }, select: { title: true, description: true } }) : null
      if (task) text = `${taskContextText(task)}\n${text}`
    }
    const list = await suggestAssets(text, { limit: req.query.limit })
    res.json({ code: 0, data: { list } })
  } catch (e) {
    console.error('[assets GET /suggest]', e)
    res.json({ code: 0, data: { list: [] } })
  }
})

/**
 * GET /api/fde/assets/link-targets?type=&keyword=  —— 建关联时的候选搜索
 */
router.get('/link-targets', requirePermission('asset.manage'), async (req, res) => {
  try {
    const { type, keyword = '' } = req.query
    const kw = String(keyword).trim()
    let list = []
    if (type === 'SKILL_PACKAGE') {
      list = (await prisma.skillPackage.findMany({
        where: { deletedAt: null, ...(kw ? { OR: [{ name: { contains: kw } }, { displayName: { contains: kw } }] } : {}) },
        select: { id: true, name: true, displayName: true }, take: 20, orderBy: { updatedAt: 'desc' }
      })).map(x => ({ id: x.id, label: x.displayName ? `${x.displayName}（${x.name}）` : x.name }))
    } else if (type === 'KNOWLEDGE') {
      list = (await prisma.knowledgeArticle.findMany({
        where: { deletedAt: null, ...(kw ? { title: { contains: kw } } : {}) },
        select: { id: true, title: true }, take: 20, orderBy: { updatedAt: 'desc' }
      })).map(x => ({ id: x.id, label: x.title }))
    } else if (type === 'ASSET') {
      list = (await prisma.asset.findMany({
        where: { deletedAt: null, ...(kw ? { OR: [{ name: { contains: kw } }, { slug: { contains: kw } }] } : {}) },
        select: { id: true, name: true, slug: true }, take: 20
      })).map(x => ({ id: x.id, label: `${x.name}（${x.slug}）` }))
    } else {
      return res.status(400).json({ code: 1001, message: `type 必须是 ${ASSET_LINK_TYPES.join('/')}` })
    }
    res.json({ code: 0, data: { list } })
  } catch (e) {
    console.error('[assets GET /link-targets]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/assets/by-project/:projectId —— 项目页「资产」块: 出自本项目的 + 本项目复用过的
 */
router.get('/by-project/:projectId', requirePermission('asset.view'), async (req, res) => {
  try {
    const projectId = toBigInt(req.params.projectId)
    if (!projectId) return res.status(400).json({ code: 1001, message: '项目 id 不正确' })
    const scope = await buildScopeWhere(req.user, 'project')
    const project = await prisma.project.findFirst({ where: buildScopedWhere({ id: projectId, deletedAt: null }, scope), select: { id: true } })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const vis = visibilityWhere(req.user)
    const [sourced, usages] = await Promise.all([
      prisma.asset.findMany({ where: { sourceProjectId: projectId, deletedAt: null, AND: [vis] }, select: LIST_SELECT, orderBy: { updatedAt: 'desc' } }),
      prisma.assetUsage.findMany({
        where: { projectId, deletedAt: null, asset: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        include: { asset: { select: { id: true, slug: true, name: true, layer: true, maturity: true } } }
      })
    ])
    res.json({ code: 0, data: { sourced, usages } })
  } catch (e) {
    console.error('[assets GET /by-project]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/assets/draft-from-project/:projectId —— asset.create
 * 项目收尾时从本项目起草资产草稿(AI 起草; 未配大模型时按项目数据生成骨架), 一律 DRAFT 待审
 */
router.post('/draft-from-project/:projectId', requirePermission('asset.create'), async (req, res) => {
  try {
    const projectId = toBigInt(req.params.projectId)
    if (!projectId) return res.status(400).json({ code: 1001, message: '项目 id 不正确' })
    const scope = await buildScopeWhere(req.user, 'project')
    const project = await prisma.project.findFirst({
      where: buildScopedWhere({ id: projectId, deletedAt: null }, scope),
      select: { id: true, name: true, code: true, description: true }
    })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const result = await draftAssetFromProject(project, { userId: req.user.id, hint: req.body?.hint })
    res.json({ code: 0, message: `已起草 ${result.created.length} 个资产草稿`, data: result })
  } catch (e) {
    console.error('[assets POST /draft-from-project]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /api/fde/assets/:idOrSlug —— 详情(含出处/版本/复用记录/关联)
 */
router.get('/:idOrSlug', requirePermission('asset.view'), async (req, res) => {
  try {
    const asset = await findAsset(req.user, req.params.idOrSlug)
    if (!asset) return res.status(404).json({ code: 2004, message: '资产不存在' })
    const [sourceProject, versions, usages, links] = await Promise.all([
      asset.sourceProjectId ? prisma.project.findUnique({ where: { id: asset.sourceProjectId }, select: { id: true, name: true, code: true } }) : null,
      prisma.assetVersion.findMany({ where: { assetId: asset.id }, orderBy: { createdAt: 'desc' } }),
      prisma.assetUsage.findMany({
        where: { assetId: asset.id, deletedAt: null }, orderBy: { createdAt: 'desc' },
        include: { project: { select: { id: true, name: true, code: true } } }
      }),
      prisma.assetLink.findMany({ where: { assetId: asset.id }, orderBy: { createdAt: 'asc' } })
    ])
    const names = await userNames([asset.ownerId, asset.createdBy, ...usages.map(u => u.createdBy), ...versions.map(v => v.createdBy)])
    res.json({
      code: 0,
      data: {
        ...asset,
        sourceProject,
        ownerName: asset.ownerId ? names.get(String(asset.ownerId)) || '' : '',
        creatorName: asset.createdBy ? names.get(String(asset.createdBy)) || '' : '',
        versions: versions.map(v => ({ ...v, creatorName: names.get(String(v.createdBy)) || '' })),
        usages: usages.map(u => ({ ...u, creatorName: names.get(String(u.createdBy)) || '' })),
        links: await resolveLinks(links),
        savedDaysTotal: usages.reduce((s, u) => s + Number(u.savedDays || 0), 0),
        canEdit: hasPermission(req.user, 'asset.manage') || (asset.status === 'DRAFT' && String(asset.createdBy) === String(req.user.id))
      }
    })
  } catch (e) {
    console.error('[assets GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/** 把多态关联解析成可展示的名称 + 前端跳转地址 */
async function resolveLinks(links) {
  const ids = t => links.filter(l => l.targetType === t).map(l => l.targetId)
  const [skills, articles, assets] = await Promise.all([
    ids('SKILL_PACKAGE').length ? prisma.skillPackage.findMany({ where: { id: { in: ids('SKILL_PACKAGE') } }, select: { id: true, name: true, displayName: true, status: true } }) : [],
    ids('KNOWLEDGE').length ? prisma.knowledgeArticle.findMany({ where: { id: { in: ids('KNOWLEDGE') } }, select: { id: true, title: true } }) : [],
    ids('ASSET').length ? prisma.asset.findMany({ where: { id: { in: ids('ASSET') }, deletedAt: null }, select: { id: true, name: true, slug: true } }) : []
  ])
  const m = (list) => new Map(list.map(x => [String(x.id), x]))
  const maps = { SKILL_PACKAGE: m(skills), KNOWLEDGE: m(articles), ASSET: m(assets) }
  return links.map(l => {
    const t = maps[l.targetType]?.get(String(l.targetId))
    let label = '(已删除)', href = null
    if (t) {
      if (l.targetType === 'SKILL_PACKAGE') { label = t.displayName ? `${t.displayName}（${t.name}）` : t.name; href = '/admin/skill-packages' }
      if (l.targetType === 'KNOWLEDGE') { label = t.title; href = `/admin/knowledge/${t.id}` }
      if (l.targetType === 'ASSET') { label = `${t.name}（${t.slug}）`; href = `/admin/assets/${t.slug}` }
    }
    return { ...l, label, href, missing: !t, extra: l.targetType === 'SKILL_PACKAGE' && t ? { status: t.status } : undefined }
  })
}

/**
 * POST /api/fde/assets —— asset.create
 * 工程师登记一律 DRAFT; 管理者登记直接可用(PUBLISHED 仍需走 /publish 过扫描, 这里落 DRAFT 或 DEPRECATED)
 */
router.post('/', requirePermission('asset.create'), async (req, res) => {
  try {
    const isManager = hasPermission(req.user, 'asset.manage')
    const { data, error } = assetPayload(req.body || {}, { isManager })
    if (error) return res.status(400).json({ code: 1001, message: error })
    const dup = await prisma.asset.findUnique({ where: { slug: data.slug } })
    if (dup) return res.status(400).json({ code: 1002, message: `slug「${data.slug}」已被「${dup.name}」占用` })
    const asset = await prisma.asset.create({
      data: {
        ...data,
        status: data.status || 'DRAFT',
        ownerId: data.ownerId ?? BigInt(req.user.id),
        createdBy: BigInt(req.user.id), updatedBy: BigInt(req.user.id)
      }
    })
    logInternalAction(req, 'asset.create', { resourceType: 'asset', resourceId: asset.id, details: { slug: asset.slug } })
    res.json({ code: 0, data: asset })
  } catch (e) {
    console.error('[assets POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/assets/:id —— asset.manage, 或登记人改自己的草稿
 */
router.put('/:id', requirePermission('asset.create'), async (req, res) => {
  try {
    const existing = await findAsset(req.user, req.params.id)
    if (!existing) return res.status(404).json({ code: 2004, message: '资产不存在' })
    const isManager = hasPermission(req.user, 'asset.manage')
    if (!isManager && !(existing.status === 'DRAFT' && String(existing.createdBy) === String(req.user.id))) {
      return res.status(403).json({ code: 1003, message: '只能修改自己登记且未发布的资产；已发布的资产需经理修改' })
    }
    const { data, error } = assetPayload(req.body || {}, { partial: true, isManager })
    if (error) return res.status(400).json({ code: 1001, message: error })
    // L2/L3 × RESTRICTED 的约束要拿合并后的值判断(只改一边也要拦)
    const mat = data.maturity || existing.maturity, auth = data.authorization || existing.authorization
    if (['L2', 'L3'].includes(mat) && auth === 'RESTRICTED') {
      return res.status(400).json({ code: 1001, message: '「仅参考」授权的资产不能标为 L2/L3（代码不得抽离）' })
    }
    if (data.slug && data.slug !== existing.slug) {
      const dup = await prisma.asset.findUnique({ where: { slug: data.slug } })
      if (dup) return res.status(400).json({ code: 1002, message: `slug「${data.slug}」已被占用` })
    }
    const asset = await prisma.asset.update({ where: { id: existing.id }, data: { ...data, updatedBy: BigInt(req.user.id) } })
    res.json({ code: 0, data: asset })
  } catch (e) {
    console.error('[assets PUT /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/assets/:id/publish { force? } —— asset.manage
 * 发布前扫描: 密钥样式一律拦; 客户名命中默认拦, 经理确认后可 force(记审计)
 */
router.post('/:id/publish', requirePermission('asset.manage'), async (req, res) => {
  try {
    const existing = await findAsset(req.user, req.params.id)
    if (!existing) return res.status(404).json({ code: 2004, message: '资产不存在' })
    if (existing.status === 'PUBLISHED') return res.status(400).json({ code: 1002, message: '已是发布状态' })
    const scan = await scanAssetForLeaks(existing)
    if (scan.secrets.length) {
      return res.status(400).json({ code: 1005, message: `方案/本体里疑似含密钥（${scan.secrets.join('、')}），请清除后再发布`, data: scan })
    }
    const force = !!req.body?.force
    if (scan.customers.length && !force) {
      return res.status(400).json({ code: 1006, message: `方案里出现客户名：${scan.customers.join('、')}。请脱敏，或确认可公开后强制发布`, data: scan })
    }
    const asset = await prisma.asset.update({
      where: { id: existing.id },
      data: { status: 'PUBLISHED', updatedBy: BigInt(req.user.id) }
    })
    logInternalAction(req, 'asset.publish', {
      resourceType: 'asset', resourceId: asset.id,
      details: { slug: asset.slug, forcedCustomers: force ? scan.customers : undefined }
    })
    res.json({ code: 0, message: '已发布', data: asset })
  } catch (e) {
    console.error('[assets POST /:id/publish]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/assets/:id (软删) —— asset.manage
 */
router.delete('/:id', requirePermission('asset.manage'), async (req, res) => {
  try {
    const existing = await findAsset(req.user, req.params.id)
    if (!existing) return res.status(404).json({ code: 2004, message: '资产不存在' })
    // 软删要释放 slug, 否则同名资产永远建不回来
    await prisma.asset.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), slug: `${existing.slug}-deleted-${existing.id}`.slice(0, 80) }
    })
    logInternalAction(req, 'asset.delete', { resourceType: 'asset', resourceId: existing.id, details: { slug: existing.slug } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    console.error('[assets DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/assets/:id/usages { projectId, taskId?, mode?, savedDays?, feedback? } —— asset.use
 */
router.post('/:id/usages', requirePermission('asset.use'), async (req, res) => {
  try {
    const asset = await findAsset(req.user, req.params.id)
    if (!asset) return res.status(404).json({ code: 2004, message: '资产不存在' })
    if (asset.status !== 'PUBLISHED') return res.status(400).json({ code: 1002, message: '资产还未发布，不能登记复用' })
    const b = req.body || {}
    const projectId = toBigInt(b.projectId)
    if (!projectId) return res.status(400).json({ code: 1001, message: '请选择复用到哪个项目' })
    const scope = await buildScopeWhere(req.user, 'project')
    const project = await prisma.project.findFirst({ where: buildScopedWhere({ id: projectId, deletedAt: null }, scope), select: { id: true, name: true } })
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    let taskId = null
    if (b.taskId) {
      taskId = toBigInt(b.taskId)
      const task = taskId ? await prisma.task.findFirst({ where: { id: taskId, projectId, deletedAt: null }, select: { id: true } }) : null
      if (!task) return res.status(400).json({ code: 1001, message: '任务不存在或不属于该项目' })
    }
    const mode = b.mode || 'REFERENCE'
    if (!ASSET_USAGE_MODES.includes(mode)) return res.status(400).json({ code: 1001, message: `mode 必须是 ${ASSET_USAGE_MODES.join('/')}` })
    let savedDays = null
    if (b.savedDays !== undefined && b.savedDays !== null && b.savedDays !== '') {
      const n = Number(b.savedDays)
      if (!Number.isFinite(n) || n < 0 || n > 999) return res.status(400).json({ code: 1001, message: '节省人天需为 0~999' })
      savedDays = Math.round(n * 10) / 10
    }
    const [usage] = await prisma.$transaction([
      prisma.assetUsage.create({
        data: {
          assetId: asset.id, projectId, taskId, mode, savedDays,
          feedback: b.feedback ? String(b.feedback).slice(0, 2000) : null,
          createdBy: BigInt(req.user.id)
        }
      }),
      prisma.asset.update({ where: { id: asset.id }, data: { usageCount: { increment: 1 } } })
    ])
    res.json({ code: 0, message: `已登记：${asset.name} 复用到 ${project.name}`, data: usage })
  } catch (e) {
    console.error('[assets POST /:id/usages]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/assets/:id/usages/:usageId —— asset.manage 或登记人本人
 */
router.delete('/:id/usages/:usageId', requirePermission('asset.use'), async (req, res) => {
  try {
    const asset = await findAsset(req.user, req.params.id)
    if (!asset) return res.status(404).json({ code: 2004, message: '资产不存在' })
    const usage = await prisma.assetUsage.findFirst({ where: { id: toBigInt(req.params.usageId) || 0n, assetId: asset.id, deletedAt: null } })
    if (!usage) return res.status(404).json({ code: 2004, message: '复用记录不存在' })
    if (!hasPermission(req.user, 'asset.manage') && String(usage.createdBy) !== String(req.user.id)) {
      return res.status(403).json({ code: 1003, message: '只能撤销自己登记的复用记录' })
    }
    await prisma.$transaction([
      prisma.assetUsage.update({ where: { id: usage.id }, data: { deletedAt: new Date() } }),
      prisma.asset.update({ where: { id: asset.id }, data: { usageCount: { decrement: asset.usageCount > 0 ? 1 : 0 } } })
    ])
    res.json({ code: 0, message: '已撤销' })
  } catch (e) {
    console.error('[assets DELETE /:id/usages/:usageId]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/assets/:id/links { targetType, targetId, note? } —— asset.manage
 */
router.post('/:id/links', requirePermission('asset.manage'), async (req, res) => {
  try {
    const asset = await findAsset(req.user, req.params.id)
    if (!asset) return res.status(404).json({ code: 2004, message: '资产不存在' })
    const { targetType, note } = req.body || {}
    const targetId = toBigInt(req.body?.targetId)
    if (!ASSET_LINK_TYPES.includes(targetType)) return res.status(400).json({ code: 1001, message: `targetType 必须是 ${ASSET_LINK_TYPES.join('/')}` })
    if (!targetId) return res.status(400).json({ code: 1001, message: 'targetId 必填' })
    if (targetType === 'ASSET' && targetId === asset.id) return res.status(400).json({ code: 1001, message: '不能关联自己' })
    const model = { SKILL_PACKAGE: 'skillPackage', KNOWLEDGE: 'knowledgeArticle', ASSET: 'asset' }[targetType]
    const target = await prisma[model].findUnique({ where: { id: targetId }, select: { id: true } })
    if (!target) return res.status(400).json({ code: 1001, message: '关联对象不存在' })
    const link = await prisma.assetLink.upsert({
      where: { assetId_targetType_targetId: { assetId: asset.id, targetType, targetId } },
      create: { assetId: asset.id, targetType, targetId, note: note ? String(note).slice(0, 200) : null, createdBy: BigInt(req.user.id) },
      update: { note: note ? String(note).slice(0, 200) : null }
    })
    res.json({ code: 0, data: link })
  } catch (e) {
    console.error('[assets POST /:id/links]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.delete('/:id/links/:linkId', requirePermission('asset.manage'), async (req, res) => {
  try {
    const asset = await findAsset(req.user, req.params.id)
    if (!asset) return res.status(404).json({ code: 2004, message: '资产不存在' })
    const { count } = await prisma.assetLink.deleteMany({ where: { id: toBigInt(req.params.linkId) || 0n, assetId: asset.id } })
    if (!count) return res.status(404).json({ code: 2004, message: '关联不存在' })
    res.json({ code: 0, message: '已移除' })
  } catch (e) {
    console.error('[assets DELETE /:id/links]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/assets/:id/versions { version, changelog?, commitSha? } —— asset.manage
 * 记一次升版, 同时刷新 currentVersion
 */
router.post('/:id/versions', requirePermission('asset.manage'), async (req, res) => {
  try {
    const asset = await findAsset(req.user, req.params.id)
    if (!asset) return res.status(404).json({ code: 2004, message: '资产不存在' })
    const version = String(req.body?.version || '').trim().slice(0, 40)
    if (!version) return res.status(400).json({ code: 1001, message: '版本号必填' })
    const exists = await prisma.assetVersion.findUnique({ where: { assetId_version: { assetId: asset.id, version } } })
    if (exists) return res.status(400).json({ code: 1002, message: `版本 ${version} 已存在` })
    const [v] = await prisma.$transaction([
      prisma.assetVersion.create({
        data: {
          assetId: asset.id, version,
          changelog: req.body?.changelog ? String(req.body.changelog) : null,
          commitSha: req.body?.commitSha ? String(req.body.commitSha).slice(0, 64) : null,
          createdBy: BigInt(req.user.id)
        }
      }),
      prisma.asset.update({ where: { id: asset.id }, data: { currentVersion: version } })
    ])
    res.json({ code: 0, data: v })
  } catch (e) {
    console.error('[assets POST /:id/versions]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
