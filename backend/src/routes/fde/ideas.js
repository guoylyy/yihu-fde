// v2.10.0(#1180) 创意中心 —— 面向全公司的想法与需求广场
//
// 话题(频道) → 想法 → 讨论 → 转成某个项目的里程碑。不绑定单一项目, 全员可进。
// 评论存在通用 comments 表(entity='idea'), 但读写都走这里: 要维护想法上的计数/活跃时间, 还要通知作者。
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission, hasPermission, buildScopeWhere } from '../../lib/auth.js'
import { buildScopedWhere } from '../../lib/scopedQuery.js'
import { pushNotification } from '../../lib/notify.js'
import { recordActivity } from '../../lib/activity.js'
import { logInternalAction } from '../../lib/audit.js'
import { LlmNotConfiguredError } from '../../lib/llm.js'
import { buildProjectContext } from '../../services/decompositionDraft.js'
import { isProjectInScope } from './projects.js'
import {
  IDEA_STATUSES, resolveMentions, summarizeIdea, draftMilestoneFromIdea, convertIdeaToMilestone
} from '../../services/ideas.js'

const router = express.Router()
router.use(internalAuth, requirePermission('idea.view'))

// 非数字 id 直接 404, 免得 BigInt() 抛异常变成 500
for (const name of ['id', 'commentId']) {
  router.param(name, (req, res, next, value) => /^\d+$/.test(value) ? next() : res.status(404).json({ code: 2004, message: '不存在' }))
}

const USER_SELECT = { id: true, name: true, avatarUrl: true, role: true }
const EXCERPT_CHARS = 400

function fail(res, e, scope) {
  if (e instanceof LlmNotConfiguredError) return res.status(400).json({ code: 4101, message: e.message })
  if (e.code === 2004) return res.status(404).json({ code: 2004, message: e.message })
  if (e.code === 9003) return res.status(400).json({ code: 9003, message: e.message })
  console.error(`[fde/ideas ${scope}]`, e)
  res.status(500).json({ code: 9001, message: e.message })
}

const isManager = req => hasPermission(req.user, 'idea.manage')
const isMine = (req, authorId) => String(authorId) === String(req.user.id)

function cleanAttachments(input) {
  if (!Array.isArray(input)) return undefined
  return input
    .filter(a => a && a.fileUrl)
    .slice(0, 9)
    .map(a => ({ filename: String(a.filename || '附件').slice(0, 200), fileUrl: String(a.fileUrl), fileSize: Number(a.fileSize) || 0 }))
}

async function loadUsers(ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))].map(BigInt)
  if (!uniq.length) return new Map()
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: USER_SELECT })
  return new Map(users.map(u => [String(u.id), u]))
}

/**
 * 列表/详情共用: 补上作者、去向(项目/里程碑)、我是否点过赞
 * 广场是全员可见的, 但项目不是: 去向只对项目在自己数据范围内的人展开, 其他人只知道「已转里程碑」
 */
async function decorate(req, ideas) {
  if (!ideas.length) return []
  const scope = await buildScopeWhere(req.user, 'project')
  const [users, projects, milestones, likes] = await Promise.all([
    loadUsers(ideas.map(i => i.authorId)),
    prisma.project.findMany({
      where: buildScopedWhere({ id: { in: ideas.map(i => i.projectId).filter(Boolean) }, deletedAt: null }, scope),
      select: { id: true, code: true, name: true }
    }),
    prisma.milestone.findMany({
      where: { id: { in: ideas.map(i => i.milestoneId).filter(Boolean) } },
      select: { id: true, name: true, status: true }
    }),
    prisma.ideaLike.findMany({
      where: { userId: BigInt(req.user.id), ideaId: { in: ideas.map(i => i.id) } },
      select: { ideaId: true }
    })
  ])
  const projectMap = new Map(projects.map(p => [String(p.id), p]))
  const milestoneMap = new Map(milestones.map(m => [String(m.id), m]))
  const liked = new Set(likes.map(l => String(l.ideaId)))
  return ideas.map(({ projectId, milestoneId, ...i }) => {
    const project = projectId ? projectMap.get(String(projectId)) || null : null
    return {
      ...i,
      author: users.get(String(i.authorId)) || null,
      viaAgent: !!i.agentProfileId,
      project,
      milestone: project && milestoneId ? milestoneMap.get(String(milestoneId)) || null : null,
      liked: liked.has(String(i.id))
    }
  })
}

async function findIdea(id) {
  return prisma.idea.findFirst({ where: { id: BigInt(id), deletedAt: null }, include: { topic: { select: { id: true, name: true, icon: true } } } })
}

// ============================================================
// 话题
// ============================================================

/** GET /api/fde/ideas/topics — 全部话题 + 各自的想法数 */
router.get('/topics', async (req, res) => {
  try {
    const [topics, counts] = await Promise.all([
      prisma.ideaTopic.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.idea.groupBy({ by: ['topicId', 'status'], where: { deletedAt: null }, _count: { _all: true } })
    ])
    const list = topics.map(t => {
      const rows = counts.filter(c => String(c.topicId) === String(t.id))
      return {
        ...t,
        archived: !!t.archivedAt,
        ideaCount: rows.reduce((s, r) => s + r._count._all, 0),
        openCount: rows.filter(r => r.status === 'OPEN').reduce((s, r) => s + r._count._all, 0)
      }
    })
    res.json({ code: 0, data: { list } })
  } catch (e) { fail(res, e, 'GET /topics') }
})

/** POST /api/fde/ideas/topics { name, description?, icon? } — 谁都可以开话题 */
router.post('/topics', requirePermission('idea.create'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ code: 9002, message: '话题名称不能为空' })
    if (name.length > 60) return res.status(400).json({ code: 9002, message: '话题名称不能超过 60 个字' })
    const dup = await prisma.ideaTopic.findFirst({ where: { name, deletedAt: null } })
    if (dup) return res.status(400).json({ code: 9003, message: '已经有同名话题了' })
    const max = await prisma.ideaTopic.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } })
    const topic = await prisma.ideaTopic.create({
      data: {
        name,
        description: req.body.description ? String(req.body.description).slice(0, 500) : null,
        icon: req.body.icon ? String(req.body.icon).slice(0, 20) : null,
        sortOrder: (max._max.sortOrder || 0) + 1,
        createdBy: BigInt(req.user.id)
      }
    })
    res.json({ code: 0, data: { ...topic, archived: false, ideaCount: 0, openCount: 0 } })
  } catch (e) { fail(res, e, 'POST /topics') }
})

/** PUT /api/fde/ideas/topics/:id { name?, description?, icon?, sortOrder?, archived? } — 创建人或管理者 */
router.put('/topics/:id', requirePermission('idea.create'), async (req, res) => {
  try {
    const topic = await prisma.ideaTopic.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!topic) return res.status(404).json({ code: 2004, message: '话题不存在' })
    if (!isManager(req) && !isMine(req, topic.createdBy)) return res.status(403).json({ code: 1003, message: '只有话题创建人或管理者可以修改' })
    const b = req.body || {}
    const data = {}
    if (b.name !== undefined) {
      const name = String(b.name).trim()
      if (!name) return res.status(400).json({ code: 9002, message: '话题名称不能为空' })
      const dup = await prisma.ideaTopic.findFirst({ where: { name, deletedAt: null, id: { not: topic.id } } })
      if (dup) return res.status(400).json({ code: 9003, message: '已经有同名话题了' })
      data.name = name.slice(0, 60)
    }
    if (b.description !== undefined) data.description = b.description ? String(b.description).slice(0, 500) : null
    if (b.icon !== undefined) data.icon = b.icon ? String(b.icon).slice(0, 20) : null
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0
    if (b.archived !== undefined) data.archivedAt = b.archived ? (topic.archivedAt || new Date()) : null
    const updated = await prisma.ideaTopic.update({ where: { id: topic.id }, data })
    res.json({ code: 0, data: { ...updated, archived: !!updated.archivedAt } })
  } catch (e) { fail(res, e, 'PUT /topics/:id') }
})

/** DELETE /api/fde/ideas/topics/:id — 只能删空话题; 有想法的请归档 */
router.delete('/topics/:id', requirePermission('idea.create'), async (req, res) => {
  try {
    const topic = await prisma.ideaTopic.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
    if (!topic) return res.status(404).json({ code: 2004, message: '话题不存在' })
    if (!isManager(req) && !isMine(req, topic.createdBy)) return res.status(403).json({ code: 1003, message: '只有话题创建人或管理者可以删除' })
    const used = await prisma.idea.count({ where: { topicId: topic.id, deletedAt: null } })
    if (used) return res.status(400).json({ code: 9003, message: `话题下还有 ${used} 条想法，不能删除；不想再用可以归档` })
    await prisma.ideaTopic.update({ where: { id: topic.id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) { fail(res, e, 'DELETE /topics/:id') }
})

// ============================================================
// 想法
// ============================================================

/**
 * GET /api/fde/ideas
 * Query: topicId, status, keyword, mine=true, sort=active(默认, 最近有动静)/new/hot, page, page_size
 */
router.get('/', async (req, res) => {
  try {
    const { topicId = '', status = '', keyword = '', mine = '', sort = 'active', page = 1, page_size = 20 } = req.query
    const size = Math.min(100, Math.max(1, Number(page_size) || 20))
    const where = { deletedAt: null }
    if (topicId) where.topicId = BigInt(topicId)
    // #1274 已归档的想法默认不进列表, 显式筛 status=ARCHIVED 才看
    if (status && IDEA_STATUSES.includes(status)) where.status = status
    else if (!status) where.status = { not: 'ARCHIVED' }
    if (mine === 'true') where.authorId = BigInt(req.user.id)
    if (keyword) where.OR = [{ title: { contains: String(keyword) } }, { content: { contains: String(keyword) } }]
    const order = sort === 'new' ? [{ createdAt: 'desc' }]
      : sort === 'hot' ? [{ likeCount: 'desc' }, { commentCount: 'desc' }, { lastActivityAt: 'desc' }]
        : [{ lastActivityAt: 'desc' }]
    const [rows, total] = await Promise.all([
      prisma.idea.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, ...order],
        skip: (Math.max(1, Number(page) || 1) - 1) * size,
        take: size,
        include: { topic: { select: { id: true, name: true, icon: true } } }
      }),
      prisma.idea.count({ where })
    ])
    const list = (await decorate(req, rows)).map(({ content, aiSummary, ...i }) => ({
      ...i,
      excerpt: content.length > EXCERPT_CHARS ? content.slice(0, EXCERPT_CHARS) + '…' : content,
      hasAiSummary: !!aiSummary
    }))
    res.json({ code: 0, data: { list, total, page: Number(page) || 1, page_size: size } })
  } catch (e) { fail(res, e, 'GET /') }
})

/** POST /api/fde/ideas { topicId, title, content, attachments? } */
router.post('/', requirePermission('idea.create'), async (req, res) => {
  try {
    const b = req.body || {}
    const title = String(b.title || '').trim()
    const content = String(b.content || '').trim()
    if (!b.topicId || !title || !content) return res.status(400).json({ code: 9002, message: '话题 / 标题 / 内容必填' })
    const topic = await prisma.ideaTopic.findFirst({ where: { id: BigInt(b.topicId), deletedAt: null } })
    if (!topic) return res.status(404).json({ code: 2004, message: '话题不存在' })
    if (topic.archivedAt) return res.status(400).json({ code: 9003, message: '话题已归档，不能再发新想法' })

    const idea = await prisma.idea.create({
      data: {
        topicId: topic.id,
        title: title.slice(0, 200),
        content,
        attachments: cleanAttachments(b.attachments),
        authorId: BigInt(req.user.id),
        agentProfileId: req.user.agentProfileId ? BigInt(req.user.agentProfileId) : null
      },
      include: { topic: { select: { id: true, name: true, icon: true } } }
    })
    recordActivity({
      actorId: BigInt(req.user.id), entity: 'idea', entityId: idea.id,
      action: 'created', summary: `在创意中心「${topic.name}」发布想法「${idea.title}」`
    })
    notifyMentions(req, idea, content)
    const [decorated] = await decorate(req, [idea])
    res.json({ code: 0, data: decorated })
  } catch (e) { fail(res, e, 'POST /') }
})

/** GET /api/fde/ideas/:id — 详情 + 讨论 */
router.get('/:id', async (req, res) => {
  try {
    const idea = await findIdea(req.params.id)
    if (!idea) return res.status(404).json({ code: 2004, message: '想法不存在' })
    const comments = await prisma.comment.findMany({
      where: { entity: 'idea', entityId: idea.id, deletedAt: null },
      orderBy: { createdAt: 'asc' }
    })
    const users = await loadUsers(comments.map(c => c.authorId))
    const [decorated] = await decorate(req, [idea])
    const manager = isManager(req)
    res.json({
      code: 0,
      data: {
        ...decorated,
        comments: comments.map(c => ({
          id: c.id, content: c.content, parentId: c.parentId, createdAt: c.createdAt,
          author: users.get(String(c.authorId)) || null,
          canDelete: manager || isMine(req, c.authorId)
        })),
        can: {
          edit: manager || isMine(req, idea.authorId),
          manage: manager,
          convert: hasPermission(req.user, 'idea.convert') && hasPermission(req.user, 'milestone.manage')
        }
      }
    })
  } catch (e) { fail(res, e, 'GET /:id') }
})

/**
 * PUT /api/fde/ideas/:id
 * 作者或管理者: title / content / topicId / attachments; 仅管理者: status(OPEN/PARKED) / pinned
 */
router.put('/:id', requirePermission('idea.create'), async (req, res) => {
  try {
    const idea = await findIdea(req.params.id)
    if (!idea) return res.status(404).json({ code: 2004, message: '想法不存在' })
    const manager = isManager(req)
    if (!manager && !isMine(req, idea.authorId)) return res.status(403).json({ code: 1003, message: '只有作者或管理者可以修改' })
    const b = req.body || {}
    const data = {}
    if (b.title !== undefined) {
      const title = String(b.title).trim()
      if (!title) return res.status(400).json({ code: 9002, message: '标题不能为空' })
      data.title = title.slice(0, 200)
    }
    if (b.content !== undefined) {
      const content = String(b.content).trim()
      if (!content) return res.status(400).json({ code: 9002, message: '内容不能为空' })
      data.content = content
    }
    if (b.attachments !== undefined) data.attachments = cleanAttachments(b.attachments) || []
    if (b.topicId !== undefined && String(b.topicId) !== String(idea.topicId)) {
      const topic = await prisma.ideaTopic.findFirst({ where: { id: BigInt(b.topicId), deletedAt: null } })
      if (!topic) return res.status(404).json({ code: 2004, message: '话题不存在' })
      data.topicId = topic.id
    }
    if (b.status !== undefined || b.pinned !== undefined) {
      if (!manager) return res.status(403).json({ code: 1003, message: '只有管理者可以置顶或改状态' })
      if (b.status !== undefined) {
        if (!['OPEN', 'PARKED'].includes(b.status)) return res.status(400).json({ code: 9002, message: '状态只能改为 讨论中 / 搁置；转里程碑请用「转为里程碑」' })
        if (idea.status === 'ADOPTED') return res.status(400).json({ code: 9003, message: '已转里程碑的想法不能再改状态' })
        data.status = b.status
      }
      if (b.pinned !== undefined) data.pinned = b.pinned ? 1 : 0
    }
    const updated = await prisma.idea.update({
      where: { id: idea.id }, data,
      include: { topic: { select: { id: true, name: true, icon: true } } }
    })
    const [decorated] = await decorate(req, [updated])
    res.json({ code: 0, data: decorated })
  } catch (e) { fail(res, e, 'PUT /:id') }
})

/** DELETE /api/fde/ideas/:id — 作者或管理者 */
router.delete('/:id', requirePermission('idea.create'), async (req, res) => {
  try {
    const idea = await findIdea(req.params.id)
    if (!idea) return res.status(404).json({ code: 2004, message: '想法不存在' })
    if (!isManager(req) && !isMine(req, idea.authorId)) return res.status(403).json({ code: 1003, message: '只有作者或管理者可以删除' })
    await prisma.idea.update({ where: { id: idea.id }, data: { deletedAt: new Date() } })
    logInternalAction(req, 'IDEA_DELETE', { resourceType: 'IDEA', resourceId: idea.id, details: { title: idea.title } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) { fail(res, e, 'DELETE /:id') }
})

/** POST /api/fde/ideas/:id/archive — 归档(#1274/#1276): 作者或管理者; 讨论中/搁置/已转里程碑均可归档 */
router.post('/:id/archive', requirePermission('idea.create'), async (req, res) => {
  try {
    const idea = await findIdea(req.params.id)
    if (!idea) return res.status(404).json({ code: 2004, message: '想法不存在' })
    if (!isManager(req) && !isMine(req, idea.authorId)) return res.status(403).json({ code: 1003, message: '只有发布人或管理者可以归档' })
    if (idea.status === 'ARCHIVED') return res.status(400).json({ code: 9003, message: '该想法已归档' })
    const updated = await prisma.idea.update({
      where: { id: idea.id }, data: { status: 'ARCHIVED', pinned: 0 },
      include: { topic: { select: { id: true, name: true, icon: true } } }
    })
    logInternalAction(req, 'IDEA_ARCHIVE', { resourceType: 'IDEA', resourceId: idea.id, details: { title: idea.title } })
    const [decorated] = await decorate(req, [updated])
    res.json({ code: 0, message: '已归档', data: decorated })
  } catch (e) { fail(res, e, 'POST /:id/archive') }
})

/** POST /api/fde/ideas/:id/unarchive — 恢复(#1274/#1276): 作者或管理者; 转过里程碑的恢复回 ADOPTED, 其余回 OPEN */
router.post('/:id/unarchive', requirePermission('idea.create'), async (req, res) => {
  try {
    const idea = await findIdea(req.params.id)
    if (!idea) return res.status(404).json({ code: 2004, message: '想法不存在' })
    if (!isManager(req) && !isMine(req, idea.authorId)) return res.status(403).json({ code: 1003, message: '只有发布人或管理者可以恢复' })
    if (idea.status !== 'ARCHIVED') return res.status(400).json({ code: 9003, message: '只有已归档的想法能恢复' })
    // 归档前转过里程碑的(projectId 有值)恢复回 ADOPTED, 去向信息才不会丢
    const restored = idea.projectId ? 'ADOPTED' : 'OPEN'
    const updated = await prisma.idea.update({
      where: { id: idea.id }, data: { status: restored },
      include: { topic: { select: { id: true, name: true, icon: true } } }
    })
    logInternalAction(req, 'IDEA_UNARCHIVE', { resourceType: 'IDEA', resourceId: idea.id, details: { title: idea.title, restored } })
    const [decorated] = await decorate(req, [updated])
    res.json({ code: 0, message: '已恢复', data: decorated })
  } catch (e) { fail(res, e, 'POST /:id/unarchive') }
})

/** POST /api/fde/ideas/batch-archive { ideaIds: [..] } — 批量归档(#1276): 逐条校验发布人或管理者, 返回逐条结果 */
router.post('/batch-archive', requirePermission('idea.create'), async (req, res) => {
  try {
    const raw = req.body?.ideaIds
    if (!Array.isArray(raw) || !raw.length) return res.status(400).json({ code: 9002, message: 'ideaIds 不能为空' })
    const ids = [...new Set(raw.map(v => { try { return BigInt(v) } catch { return null } }).filter(Boolean))].slice(0, 100)
    const manager = isManager(req)
    let archived = 0
    const failed = []
    for (const id of ids) {
      const idea = await prisma.idea.findFirst({ where: { id, deletedAt: null } })
      if (!idea) { failed.push({ id: String(id), reason: '想法不存在' }); continue }
      if (!manager && !isMine(req, idea.authorId)) { failed.push({ id: String(id), reason: '只有发布人或管理者可以归档' }); continue }
      if (idea.status === 'ARCHIVED') { failed.push({ id: String(id), reason: '该想法已归档' }); continue }
      await prisma.idea.update({ where: { id }, data: { status: 'ARCHIVED', pinned: 0 } })
      logInternalAction(req, 'IDEA_ARCHIVE', { resourceType: 'IDEA', resourceId: id, details: { title: idea.title, batch: true } })
      archived++
    }
    res.json({ code: 0, data: { archived, failed, total: ids.length } })
  } catch (e) { fail(res, e, 'POST /batch-archive') }
})

/** POST /api/fde/ideas/:id/like — 点赞/取消(再点一次取消) */
router.post('/:id/like', requirePermission('idea.create'), async (req, res) => {
  try {
    const idea = await findIdea(req.params.id)
    if (!idea) return res.status(404).json({ code: 2004, message: '想法不存在' })
    if (idea.status === 'ARCHIVED') return res.status(400).json({ code: 9003, message: '已归档的想法不能再点赞' })
    const key = { ideaId_userId: { ideaId: idea.id, userId: BigInt(req.user.id) } }
    const existed = await prisma.ideaLike.findUnique({ where: key })
    if (existed) await prisma.ideaLike.delete({ where: key })
    else await prisma.ideaLike.create({ data: { ideaId: idea.id, userId: BigInt(req.user.id) } })
    // 计数以明细为准重算, 并发点赞也不会漂
    const likeCount = await prisma.ideaLike.count({ where: { ideaId: idea.id } })
    await prisma.idea.update({ where: { id: idea.id }, data: { likeCount } })
    res.json({ code: 0, data: { liked: !existed, likeCount } })
  } catch (e) { fail(res, e, 'POST /:id/like') }
})

// ============================================================
// 讨论
// ============================================================

/** @ 到的人即时通知(必看档, 复用 MENTIONED) */
async function notifyMentions(req, idea, content, exclude = new Set()) {
  try {
    const users = await resolveMentions(content)
    for (const u of users) {
      if (exclude.has(String(u.id))) continue
      exclude.add(String(u.id))
      pushNotification({
        userId: u.id, actorId: req.user.id, type: 'MENTIONED',
        title: '💬 有人在创意中心提到了你',
        body: `「${idea.title}」：${String(content).slice(0, 100)}`,
        link: `/admin/ideas?idea=${idea.id}`,
        data: { entity: 'idea', entityId: String(idea.id) }
      }).catch(() => {})
    }
  } catch (e) {
    console.error('[fde/ideas notifyMentions]', e)
  }
  return exclude
}

/** POST /api/fde/ideas/:id/comments { content, parentId? } */
router.post('/:id/comments', requirePermission('idea.create'), async (req, res) => {
  try {
    const idea = await findIdea(req.params.id)
    if (!idea) return res.status(404).json({ code: 2004, message: '想法不存在' })
    if (idea.status === 'ARCHIVED') return res.status(400).json({ code: 9003, message: '已归档的想法不能再评论' })
    const content = String(req.body?.content || '').trim()
    if (!content) return res.status(400).json({ code: 9002, message: '评论内容不能为空' })
    let parent = null
    if (req.body.parentId) {
      parent = await prisma.comment.findFirst({ where: { id: BigInt(req.body.parentId), entity: 'idea', entityId: idea.id, deletedAt: null } })
      if (!parent) return res.status(404).json({ code: 2004, message: '要回复的评论不存在' })
    }
    const mentioned = await resolveMentions(content)
    const now = new Date()
    const [comment] = await prisma.$transaction([
      prisma.comment.create({
        data: {
          entity: 'idea', entityId: idea.id, authorId: BigInt(req.user.id), content,
          // 讨论只做两层: 回复的回复也挂到楼主那条下面
          parentId: parent ? (parent.parentId || parent.id) : null,
          mentions: mentioned.length ? JSON.stringify(mentioned.map(u => String(u.id))) : null
        }
      }),
      prisma.idea.update({ where: { id: idea.id }, data: { commentCount: { increment: 1 }, lastActivityAt: now } })
    ])

    // 通知: 被 @ 的人(必看) → 被回复的人、想法作者(进每日摘要, 不逐条打扰); 同一个人只通知一次
    const notified = await notifyMentions(req, idea, content)
    for (const uid of [parent?.authorId, idea.authorId]) {
      if (!uid || notified.has(String(uid))) continue
      notified.add(String(uid))
      pushNotification({
        userId: uid, actorId: req.user.id, type: 'IDEA_COMMENTED',
        title: '💡 你参与的想法有新讨论',
        body: `「${idea.title}」：${content.slice(0, 100)}`,
        link: `/admin/ideas?idea=${idea.id}`,
        data: { ideaId: String(idea.id), commentId: String(comment.id) }
      }).catch(() => {})
    }

    const users = await loadUsers([req.user.id])
    res.json({
      code: 0,
      data: {
        id: comment.id, content: comment.content, parentId: comment.parentId, createdAt: comment.createdAt,
        author: users.get(String(req.user.id)) || null, canDelete: true
      }
    })
  } catch (e) { fail(res, e, 'POST /:id/comments') }
})

/** DELETE /api/fde/ideas/:id/comments/:commentId — 评论作者或管理者 */
router.delete('/:id/comments/:commentId', requirePermission('idea.create'), async (req, res) => {
  try {
    const comment = await prisma.comment.findFirst({
      where: { id: BigInt(req.params.commentId), entity: 'idea', entityId: BigInt(req.params.id), deletedAt: null }
    })
    if (!comment) return res.status(404).json({ code: 2004, message: '评论不存在' })
    if (!isManager(req) && !isMine(req, comment.authorId)) return res.status(403).json({ code: 1003, message: '只有评论作者或管理者可以删除' })
    await prisma.$transaction([
      prisma.comment.update({ where: { id: comment.id }, data: { deletedAt: new Date() } }),
      prisma.idea.update({ where: { id: comment.entityId }, data: { commentCount: { decrement: 1 } } })
    ])
    res.json({ code: 0, message: '已删除' })
  } catch (e) { fail(res, e, 'DELETE /:id/comments/:commentId') }
})

// ============================================================
// AI 辅助 + 转里程碑
// ============================================================

/** POST /api/fde/ideas/:id/ai-summary — AI 把讨论收拢成结论, 存在想法上 */
router.post('/:id/ai-summary', requirePermission('idea.create'), async (req, res) => {
  try {
    res.json({ code: 0, data: await summarizeIdea(req.params.id) })
  } catch (e) { fail(res, e, 'POST /:id/ai-summary') }
})

/** POST /api/fde/ideas/:id/ai-milestone-draft { projectId? } — AI 起草里程碑, 只返回草稿不落库 */
router.post('/:id/ai-milestone-draft', requirePermission('idea.convert'), async (req, res) => {
  try {
    const { projectId } = req.body || {}
    if (projectId && !(await isProjectInScope(req.user, BigInt(projectId)))) return res.status(404).json({ code: 2004, message: '项目不存在' })
    const ctx = await buildProjectContext(projectId)
    res.json({ code: 0, data: await draftMilestoneFromIdea(req.params.id, { projectContext: ctx.text }) })
  } catch (e) { fail(res, e, 'POST /:id/ai-milestone-draft') }
})

/**
 * POST /api/fde/ideas/:id/convert — 想法转成项目里程碑
 * body: { projectId, milestoneId? } 并入已有里程碑; 或 { projectId, name?, goal?, description?, plannedDate?, ownerId? } 新建
 */
router.post('/:id/convert', requirePermission('idea.convert'), async (req, res) => {
  try {
    const b = req.body || {}
    if (!b.projectId) return res.status(400).json({ code: 9002, message: '请选择要分配到的项目' })
    // 转化的结果是在项目里建里程碑, 所以还要有里程碑的管理权
    if (!hasPermission(req.user, 'milestone.manage')) return res.status(403).json({ code: 1003, message: '需要里程碑管理权限' })
    if (!(await isProjectInScope(req.user, BigInt(b.projectId)))) return res.status(404).json({ code: 2004, message: '项目不存在' })
    if (b.plannedDate && Number.isNaN(new Date(b.plannedDate).getTime())) return res.status(400).json({ code: 9002, message: '计划完成日期格式不对，应为 YYYY-MM-DD' })

    const { idea, milestone, project, created } = await convertIdeaToMilestone({
      ideaId: req.params.id, projectId: b.projectId, milestoneId: b.milestoneId || null,
      name: b.name, goal: b.goal, description: b.description, plannedDate: b.plannedDate, ownerId: b.ownerId,
      userId: req.user.id
    })
    logInternalAction(req, 'IDEA_CONVERT', {
      resourceType: 'IDEA', resourceId: idea.id,
      details: { projectId: String(project.id), milestoneId: String(milestone.id), created }
    })
    res.json({ code: 0, data: { idea, milestone, project, created } })
  } catch (e) { fail(res, e, 'POST /:id/convert') }
})

export default router
