// FDE 平台 - 智能助手会话管理（历史文本落库）
// POST   /api/fde/agent-conversations           创建会话
// POST   /api/fde/agent-conversations/log       v1.6.0 第三方 Agent 对话回传(整段落库, source=EXTERNAL)
// GET    /api/fde/agent-conversations           我的会话列表(updatedAt 倒序, 可按 projectId/source 过滤)
// GET    /api/fde/agent-conversations/project/:projectId  v1.6.0 项目下全部关联会话(跨归属人, 走项目数据范围)
// GET    /api/fde/agent-conversations/:id       会话详情(含 messages 按 ts 升序)
// GET    /api/fde/agent-conversations/:id/messages  仅拉消息
// PATCH  /api/fde/agent-conversations/:id       v1.6.0 挂/摘 项目、客户, 改标题
// DELETE /api/fde/agent-conversations/:id       软删除
import { buildScopedWhere } from '../../lib/scopedQuery.js'
import { Router } from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, buildScopeWhere } from '../../lib/auth.js'

const router = Router()
router.use(internalAuth)

function serialize(conv, extra = {}) {
  return {
    id: conv.id.toString(),
    title: conv.title || '',
    openhexId: conv.openhexId || null,
    source: conv.source || 'INTERNAL',
    projectId: conv.projectId ? conv.projectId.toString() : null,
    customerId: conv.customerId ? conv.customerId.toString() : null,
    agentProfileId: conv.agentProfileId ? conv.agentProfileId.toString() : null,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messageCount: conv._count?.messages,
    messages: (conv.messages || []).map(serializeMessage),
    ...extra
  }
}
function serializeMessage(m) {
  return { id: m.id.toString(), role: m.role, text: m.text, ts: m.ts }
}

// 归属校验: 只能操作自己的会话
async function findOwned(req) {
  return prisma.agentConversation.findFirst({
    where: { id: BigInt(req.params.id), userId: BigInt(req.user.id), deletedAt: null }
  })
}

// 项目归属校验(套数据范围, 防越权), 套路同 project-records
async function findScopedProject(user, projectIdRaw) {
  let projectId
  try { projectId = BigInt(projectIdRaw) } catch { return null }
  const projectScope = await buildScopeWhere(user, 'project')
  return prisma.project.findFirst({
    // v2.1.14 fix: AND 求交防 scope 的 id 条件覆盖 URL 项目 id
    where: buildScopedWhere({ id: projectId, deletedAt: null }, projectScope),
    select: { id: true, customerId: true }
  })
}

// 会话关联字段的统一校验: 返回 { data } 或 { error }
async function resolveLinks(user, { projectId, customerId }) {
  const data = {}
  if (projectId !== undefined) {
    if (projectId === null || projectId === '') {
      data.projectId = null
    } else {
      const project = await findScopedProject(user, projectId)
      if (!project) return { error: '项目不存在或无权访问' }
      data.projectId = project.id
      // 挂了项目未显式给客户时, 客户跟着项目走
      if (customerId === undefined && project.customerId) data.customerId = project.customerId
    }
  }
  if (customerId !== undefined) {
    if (customerId === null || customerId === '') {
      data.customerId = null
    } else {
      let cid
      try { cid = BigInt(customerId) } catch { return { error: 'customerId 不合法' } }
      const customer = await prisma.customer.findFirst({ where: { id: cid, deletedAt: null }, select: { id: true } })
      if (!customer) return { error: '客户不存在' }
      data.customerId = customer.id
    }
  }
  return { data }
}

// POST / - 创建会话 body: { title?, projectId?, customerId? }
router.post('/', async (req, res) => {
  try {
    const links = await resolveLinks(req.user, req.body || {})
    if (links.error) return res.status(400).json({ code: 9002, message: links.error })
    const conv = await prisma.agentConversation.create({
      data: { userId: BigInt(req.user.id), title: req.body?.title || null, ...links.data }
    })
    res.json({ code: 0, data: serialize(conv) })
  } catch (e) {
    console.error('[agent-conversations POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// POST /log - v1.6.0 第三方 Agent 对话回传
// body: { conversationId?, title?, projectId?, customerId?, messages: [{ role: USER|ASSISTANT, text, ts? }] }
// 不带 conversationId 新建(source=EXTERNAL); 带则续写自己名下的 EXTERNAL 会话(分段回传长对话)
// Agent 身份取自凭证(经专属 Key 的调用 req.user.agentProfileId 自带), 人手动调也能用只是不记 Agent
router.post('/log', async (req, res) => {
  try {
    const { conversationId, title, messages } = req.body || {}
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ code: 9002, message: 'messages 必填: [{ role: USER|ASSISTANT, text, ts? }]' })
    }
    if (messages.length > 500) {
      return res.status(400).json({ code: 9002, message: '单次最多回传 500 条消息, 过长对话请分段(带 conversationId 续写)' })
    }
    const cleaned = []
    for (const m of messages) {
      const role = String(m?.role || '').toUpperCase()
      if (!['USER', 'ASSISTANT'].includes(role)) {
        return res.status(400).json({ code: 9002, message: `role 只能是 USER/ASSISTANT, 收到: ${m?.role}` })
      }
      if (!m?.text || !String(m.text).trim()) continue
      const ts = m.ts && !isNaN(new Date(m.ts).getTime()) ? new Date(m.ts) : new Date()
      cleaned.push({ role, text: String(m.text), ts })
    }
    if (!cleaned.length) return res.status(400).json({ code: 9002, message: 'messages 里没有有效内容' })

    let conv
    if (conversationId !== undefined && conversationId !== null && conversationId !== '') {
      conv = await prisma.agentConversation.findFirst({
        where: { id: BigInt(conversationId), userId: BigInt(req.user.id), source: 'EXTERNAL', deletedAt: null }
      })
      if (!conv) return res.status(404).json({ code: 9004, message: '续写的会话不存在(只能续写自己名下 EXTERNAL 来源的会话)' })
    } else {
      const links = await resolveLinks(req.user, req.body || {})
      if (links.error) return res.status(400).json({ code: 9002, message: links.error })
      const firstUser = cleaned.find(m => m.role === 'USER')
      conv = await prisma.agentConversation.create({
        data: {
          userId: BigInt(req.user.id),
          title: (title && String(title).slice(0, 200)) || (firstUser ? firstUser.text.slice(0, 30) : 'Agent 对话'),
          source: 'EXTERNAL',
          agentProfileId: req.user.agentProfileId ? BigInt(req.user.agentProfileId) : null,
          ...links.data
        }
      })
    }
    await prisma.agentMessage.createMany({
      data: cleaned.map(m => ({ conversationId: conv.id, ...m }))
    })
    // 续写时刷新 updatedAt(列表按其倒序)
    await prisma.agentConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } })
    res.json({ code: 0, message: '对话已留存', data: { id: conv.id.toString(), appended: cleaned.length } })
  } catch (e) {
    console.error('[agent-conversations POST /log]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// GET / - 我的会话列表, 可选 ?projectId=&source=
router.get('/', async (req, res) => {
  try {
    const where = { userId: BigInt(req.user.id), deletedAt: null }
    if (req.query.projectId) {
      try { where.projectId = BigInt(req.query.projectId) } catch { /* 非法值当无过滤 */ }
    }
    if (['INTERNAL', 'EXTERNAL'].includes(req.query.source)) where.source = req.query.source
    const list = await prisma.agentConversation.findMany({
      where,
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100
    })
    res.json({ code: 0, data: list.map(c => serialize(c)) })
  } catch (e) {
    console.error('[agent-conversations GET /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// GET /project/:projectId - v1.6.0 项目下全部关联会话(跨归属人), 供过程资源时间线
router.get('/project/:projectId', async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const list = await prisma.agentConversation.findMany({
      where: { projectId: project.id, deletedAt: null },
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200
    })
    // 归属人与 Agent 名字(时间线上展示"谁的哪个 Agent")
    const userIds = [...new Set(list.map(c => c.userId))]
    const agentIds = [...new Set(list.filter(c => c.agentProfileId).map(c => c.agentProfileId))]
    const [users, agents] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
      agentIds.length ? prisma.agentProfile.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : []
    ])
    const umap = new Map(users.map(u => [String(u.id), u.name]))
    const amap = new Map(agents.map(a => [String(a.id), a.name]))
    res.json({
      code: 0,
      data: list.map(c => serialize(c, {
        ownerName: umap.get(String(c.userId)) || '',
        agentName: c.agentProfileId ? (amap.get(String(c.agentProfileId)) || '') : ''
      }))
    })
  } catch (e) {
    console.error('[agent-conversations GET /project]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 详情访问: 本人的会话; 或已挂到项目且我有该项目数据范围(时间线查看他人 Agent 沉淀)
async function findViewable(req) {
  const conv = await prisma.agentConversation.findFirst({
    where: { id: BigInt(req.params.id), deletedAt: null }
  })
  if (!conv) return null
  if (String(conv.userId) === String(req.user.id)) return conv
  if (conv.projectId && await findScopedProject(req.user, conv.projectId)) return conv
  return null
}

// GET /:id - 会话详情(含消息)
router.get('/:id', async (req, res) => {
  try {
    const owned = await findViewable(req)
    if (!owned) return res.status(404).json({ code: 9004, message: '会话不存在' })
    const conv = await prisma.agentConversation.findFirst({
      where: { id: owned.id },
      include: { messages: { orderBy: { ts: 'asc' } } }
    })
    res.json({ code: 0, data: serialize(conv) })
  } catch (e) {
    console.error('[agent-conversations GET /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// GET /:id/messages - 仅拉消息(ts 升序)
router.get('/:id/messages', async (req, res) => {
  try {
    const conv = await findViewable(req)
    if (!conv) return res.status(404).json({ code: 9004, message: '会话不存在' })
    const messages = await prisma.agentMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { ts: 'asc' }
    })
    res.json({ code: 0, data: messages.map(serializeMessage) })
  } catch (e) {
    console.error('[agent-conversations GET /:id/messages]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// PATCH /:id - 挂/摘 项目、客户, 改标题(仅本人)
router.patch('/:id', async (req, res) => {
  try {
    const conv = await findOwned(req)
    if (!conv) return res.status(404).json({ code: 9004, message: '会话不存在' })
    const { title } = req.body || {}
    const links = await resolveLinks(req.user, req.body || {})
    if (links.error) return res.status(400).json({ code: 9002, message: links.error })
    const data = { ...links.data }
    if (title !== undefined) data.title = title ? String(title).slice(0, 200) : null
    const updated = await prisma.agentConversation.update({ where: { id: conv.id }, data })
    res.json({ code: 0, message: '已更新', data: serialize(updated) })
  } catch (e) {
    console.error('[agent-conversations PATCH /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// DELETE /:id - 软删除
router.delete('/:id', async (req, res) => {
  try {
    const conv = await findOwned(req)
    if (!conv) return res.status(404).json({ code: 9004, message: '会话不存在' })
    await prisma.agentConversation.update({ where: { id: conv.id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, data: { id: conv.id.toString() } })
  } catch (e) {
    console.error('[agent-conversations DELETE /:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
