// 0.5.0 开发过程会话回流(挂在 /api 下, 路径不带 /fde 前缀):
//   POST /api/devlog/conversations             批量上报, 按 uid 幂等 upsert(登录用户 / API Key 均可, 采集器用 Key)
//   GET  /api/dev/conversations                列表(默认不带正文, ?withBody=1 才带)
//   GET  /api/dev/conversations/:id            详情(含事件与正文)
//   POST /api/dev/conversations/:id/link       关联项目/任务/里程碑/阶段 → LINKED, 写审计
//   POST /api/dev/conversations/:id/summarize  出摘要: 有模型走 chatJSON, 没有降级规则(mode:'rules')
//   GET  /api/projects/:id/timeline            项目下会话按阶段分组
//   POST /api/experience/from-conversation     从会话沉淀经验, 写审计
//   GET  /api/experience                       经验列表
//
// 数据范围: 角色 dataScope=ALL(管理员)看全部; 其余看自己的(engineerId=本人 或 本人上报);
//          经理型(OWN_PROJECTS)另外能看自己负责/参与项目下的会话
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, hasPermission, getDataScope, buildScopeWhere } from '../../lib/auth.js'
import { mcpAuth } from '../../lib/apiKey.js'
import { logInternalAction } from '../../lib/audit.js'
import { chatJSON, getActiveLlmConfig, LlmNotConfiguredError } from '../../lib/llm.js'
import { stubEnabled } from '../../services/assistant/stub.js'
import { isProjectInScope } from './projects.js'
import {
  SOURCES, STAGES, STATUSES, EXPERIENCE_KINDS, MAX_BATCH, InputError,
  normalizeItem, upsertConversation, fillProjectFromRefs, ruleSummary, transcriptForModel
} from '../../services/devlog/conversations.js'

const router = express.Router()

const isId = (v) => /^[1-9]\d{0,17}$/.test(String(v ?? ''))
const fail = (res, status, code, message) => res.status(status).json({ code, message })
const userIdOf = (req) => BigInt(req.user.userId ?? req.user.id)
const serverError = (tag) => (res, e) => { console.error(`[devlog ${tag}]`, e); res.status(500).json({ code: 9001, message: e.message }) }

async function engineerIdOf(req) {
  if (req._engineerId !== undefined) return req._engineerId
  const eng = await prisma.engineer.findUnique({ where: { userId: userIdOf(req) }, select: { id: true, deletedAt: true } })
  req._engineerId = eng && !eng.deletedAt ? eng.id : null
  return req._engineerId
}

/** 会话的数据范围 where 片段; ALL 返回 {} */
async function conversationScope(req) {
  const scope = getDataScope(req.user.role)
  if (scope === 'ALL') return {}
  const eng = await engineerIdOf(req)
  const or = [{ createdBy: userIdOf(req) }]
  if (eng) or.push({ engineerId: eng })
  if (scope === 'OWN_PROJECTS') {
    const projects = await prisma.project.findMany({ where: { AND: [{ deletedAt: null }, await buildScopeWhere(req.user, 'project')] }, select: { id: true } })
    if (projects.length) or.push({ projectId: { in: projects.map((p) => p.id) } })
  }
  return { OR: or }
}

async function findVisibleConversation(req, include) {
  if (!isId(req.params.id)) return null
  return prisma.devConversation.findFirst({
    where: { AND: [{ id: BigInt(req.params.id), deletedAt: null }, await conversationScope(req)] },
    include
  })
}

const LIST_SELECT = {
  id: true, uid: true, source: true, stage: true, engineerId: true, projectId: true, taskId: true, milestoneId: true,
  model: true, startedAt: true, endedAt: true, turns: true, tokens: true, cost: true, branch: true, cwd: true,
  title: true, summary: true, decisions: true, pitfalls: true, tags: true, commitShas: true, bodyRedacted: true,
  status: true, createdBy: true, createdAt: true, updatedAt: true
}

/** 工程师 id → 姓名 */
async function engineerNames(ids) {
  const uniq = [...new Set(ids.filter((x) => x != null).map(String))].map(BigInt)
  if (!uniq.length) return new Map()
  const rows = await prisma.engineer.findMany({ where: { id: { in: uniq } }, select: { id: true, user: { select: { name: true } } } })
  return new Map(rows.map((r) => [String(r.id), r.user?.name || null]))
}

const view = (c, names) => ({
  ...c,
  cost: c.cost != null ? Number(c.cost) : null,
  engineerName: c.engineerId != null ? names.get(String(c.engineerId)) ?? null : null
})

function page(req) {
  const p = Math.max(1, parseInt(req.query.page, 10) || 1)
  const size = Math.min(100, Math.max(1, parseInt(req.query.size, 10) || 20))
  return { skip: (p - 1) * size, take: size, page: p, size }
}

// ---------- 上报 ----------

router.post('/devlog/conversations', mcpAuth, async (req, res) => {
  const list = req.body?.conversations
  if (!Array.isArray(list) || !list.length) return fail(res, 400, 9002, 'conversations 必须是非空数组')
  if (list.length > MAX_BATCH) return fail(res, 400, 9002, `一次最多上报 ${MAX_BATCH} 条`)
  try {
    const actor = { userId: userIdOf(req), engineerId: await engineerIdOf(req), all: getDataScope(req.user.role) === 'ALL' }
    let created = 0
    let updated = 0
    const items = []
    const errors = []
    for (const raw of list) {
      const uid = raw && typeof raw === 'object' && raw.uid != null ? String(raw.uid) : null
      try {
        const r = await upsertConversation(normalizeItem(raw), actor)
        r.created ? created++ : updated++
        items.push({ uid, id: String(r.id), created: r.created })
      } catch (e) {
        if (!(e instanceof InputError)) console.error('[devlog ingest]', uid, e)
        errors.push({ uid, message: e instanceof InputError ? e.message : `保存失败：${String(e.message || e).slice(0, 200)}` })
      }
    }
    res.status(created ? 201 : 200).json({ code: 0, data: { created, updated, items, errors } })
  } catch (e) { serverError('ingest')(res, e) }
})

// ---------- 查询 ----------

router.get('/dev/conversations', internalAuth, async (req, res) => {
  try {
    const q = req.query
    const and = [{ deletedAt: null }, await conversationScope(req)]
    for (const k of ['projectId', 'engineerId']) {
      if (q[k] == null || q[k] === '') continue
      if (!isId(q[k])) return fail(res, 400, 9002, `${k} 不合法`)
      and.push({ [k]: BigInt(q[k]) })
    }
    for (const [k, list] of [['stage', STAGES], ['source', SOURCES], ['status', STATUSES]]) {
      if (!q[k]) continue
      const v = String(q[k]).toUpperCase()
      if (!list.includes(v)) return fail(res, 400, 9002, `${k} 只能是 ${list.join('/')}`)
      and.push({ [k]: v })
    }
    if (q.keyword) {
      const kw = String(q.keyword).trim().slice(0, 100)
      if (kw) and.push({ OR: [{ title: { contains: kw } }, { summary: { contains: kw } }, { uid: { contains: kw } }, { branch: { contains: kw } }] })
    }
    const range = {}
    if (q.from) { const d = new Date(q.from); if (Number.isNaN(d.getTime())) return fail(res, 400, 9002, 'from 不是合法时间'); range.gte = d }
    if (q.to) { const d = new Date(q.to); if (Number.isNaN(d.getTime())) return fail(res, 400, 9002, 'to 不是合法时间'); range.lte = d }
    if (range.gte || range.lte) and.push({ OR: [{ startedAt: range }, { startedAt: null, createdAt: range }] })

    const withBody = ['1', 'true'].includes(String(q.withBody || ''))
    const where = { AND: and }
    const { skip, take, page: p, size } = page(req)
    const [rows, total] = await Promise.all([
      prisma.devConversation.findMany({
        where, skip, take,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: { ...LIST_SELECT, ...(withBody ? { body: true } : {}) }
      }),
      prisma.devConversation.count({ where })
    ])
    const names = await engineerNames(rows.map((r) => r.engineerId))
    res.json({ code: 0, data: { list: rows.map((r) => view(r, names)), total, page: p, size } })
  } catch (e) { serverError('list')(res, e) }
})

router.get('/dev/conversations/:id', internalAuth, async (req, res) => {
  try {
    const c = await findVisibleConversation(req, { events: { orderBy: { seq: 'asc' } } })
    if (!c) return fail(res, 404, 9004, '会话不存在或无权查看')
    const names = await engineerNames([c.engineerId])
    res.json({ code: 0, data: view(c, names) })
  } catch (e) { serverError('detail')(res, e) }
})

router.post('/dev/conversations/:id/link', internalAuth, async (req, res) => {
  try {
    if (getDataScope(req.user.role) !== 'ALL' && !hasPermission(req.user, 'project.view')) {
      return fail(res, 403, 1003, '缺少权限 project.view')
    }
    const c = await findVisibleConversation(req)
    if (!c) return fail(res, 404, 9004, '会话不存在或无权查看')
    const b = req.body || {}
    const patch = {}
    for (const k of ['projectId', 'taskId', 'milestoneId']) {
      if (b[k] === undefined) continue
      if (b[k] === null || b[k] === '') { patch[k] = null; continue }
      if (!isId(b[k])) return fail(res, 400, 9002, `${k} 不合法`)
      patch[k] = BigInt(b[k])
    }
    if (b.stage !== undefined) {
      const s = String(b.stage).toUpperCase()
      if (!STAGES.includes(s)) return fail(res, 400, 9002, `stage 只能是 ${STAGES.join('/')}`)
      patch.stage = s
    }
    // 只给了任务/里程碑: 补上所属项目(且校验指向的记录存在)
    const refs = { taskId: patch.taskId || undefined, milestoneId: patch.milestoneId || undefined, projectId: patch.projectId || undefined }
    try { await fillProjectFromRefs(refs) } catch (e) { if (e instanceof InputError) return fail(res, 400, 9002, e.message); throw e }
    if (patch.projectId === undefined && refs.projectId) patch.projectId = refs.projectId
    if (patch.projectId && !(await isProjectInScope(req.user, patch.projectId))) return fail(res, 403, 1003, '无权关联到该项目')

    const changed = Object.keys(patch).filter((k) => String(patch[k] ?? '') !== String(c[k] ?? ''))
    if (!changed.length) return res.json({ code: 0, data: { id: String(c.id), status: c.status, changed: [] } })
    const data = { ...patch, status: 'LINKED' }
    const row = await prisma.devConversation.update({ where: { id: c.id }, data, select: LIST_SELECT })
    await logInternalAction(req, 'devlog.conversation.link', {
      resourceType: 'dev_conversation', resourceId: c.id,
      details: {
        uid: c.uid, changed,
        before: Object.fromEntries(changed.map((k) => [k, c[k] == null ? null : String(c[k])])),
        after: Object.fromEntries(changed.map((k) => [k, patch[k] == null ? null : String(patch[k])]))
      }
    })
    res.json({ code: 0, data: { ...view(row, await engineerNames([row.engineerId])), changed } })
  } catch (e) { serverError('link')(res, e) }
})

const SUMMARY_SYSTEM = [
  '你在整理一段软件开发过程中的 AI 会话记录，输出给交付平台做过程沉淀。',
  '只输出一个 JSON 对象，不要任何解释：{"summary": string, "decisions": string[], "pitfalls": string[], "tags": string[]}',
  'summary：3~6 句中文，讲清楚这次会话要解决什么、做了什么、结论是什么。',
  'decisions：做出的技术/方案决策，每条一句；没有就空数组。',
  'pitfalls：踩到的坑及原因，每条一句；没有就空数组。',
  'tags：3~8 个短标签（技术栈、模块名）。只用记录里出现的事实，不要编造。'
].join('\n')

const strList = (v, n = 20) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n).map((s) => s.slice(0, 500)) : [])

router.post('/dev/conversations/:id/summarize', internalAuth, async (req, res) => {
  try {
    const c = await findVisibleConversation(req, { events: { orderBy: { seq: 'asc' } } })
    if (!c) return fail(res, 404, 9004, '会话不存在或无权查看')

    let result = null
    let mode = 'rules'
    let reason = null
    // stub 模式没有摘要能力, 与「没配模型」一样走规则
    if (!stubEnabled()) {
      try {
        const config = await getActiveLlmConfig()
        const out = await chatJSON({ system: SUMMARY_SYSTEM, user: transcriptForModel(c, c.events), maxTokens: 1500, config, timeoutMs: 60_000 })
        if (out && typeof out.summary === 'string' && out.summary.trim()) {
          result = { summary: out.summary.trim().slice(0, 20000), decisions: strList(out.decisions), pitfalls: strList(out.pitfalls), tags: strList(out.tags, 10) }
          mode = 'model'
        } else reason = '模型没有返回 summary'
      } catch (e) {
        reason = e instanceof LlmNotConfiguredError ? e.message : `模型调用失败：${String(e.message || e).slice(0, 200)}`
        if (!(e instanceof LlmNotConfiguredError)) console.error('[devlog summarize]', e.message)
      }
    } else reason = 'stub 模式'
    let files
    if (!result) {
      const r = ruleSummary(c, c.events)
      files = r.files
      result = { summary: r.summary, decisions: r.decisions, pitfalls: r.pitfalls, tags: r.tags }
    }

    await prisma.devConversation.update({ where: { id: c.id }, data: result })
    await logInternalAction(req, 'devlog.conversation.summarize', { resourceType: 'dev_conversation', resourceId: c.id, details: { mode, ...(reason ? { reason } : {}) } })
    res.json({ code: 0, data: { id: String(c.id), mode, ...(reason && mode === 'rules' ? { reason } : {}), ...result, ...(files ? { files } : {}) } })
  } catch (e) { serverError('summarize')(res, e) }
})

// ---------- 项目时间线 ----------

router.get('/projects/:id/timeline', internalAuth, async (req, res) => {
  try {
    if (!isId(req.params.id)) return fail(res, 400, 9002, '项目 id 不合法')
    const projectId = BigInt(req.params.id)
    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } })
    if (!project) return fail(res, 404, 9004, '项目不存在')
    if (!hasPermission(req.user, 'project.view') || !(await isProjectInScope(req.user, projectId))) return fail(res, 403, 1003, '无权访问该项目')

    const rows = await prisma.devConversation.findMany({
      where: { AND: [{ projectId, deletedAt: null, status: { not: 'IGNORED' } }, await conversationScope(req)] },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, uid: true, source: true, stage: true, title: true, summary: true, startedAt: true, endedAt: true, engineerId: true, turns: true, commitShas: true, taskId: true, milestoneId: true }
    })
    const names = await engineerNames(rows.map((r) => r.engineerId))
    const groups = Object.fromEntries(STAGES.map((s) => [s, []]))
    for (const r of rows) {
      (groups[r.stage] || groups.GENERAL).push({
        id: String(r.id), uid: r.uid, source: r.source, title: r.title, summary: r.summary,
        startedAt: r.startedAt, endedAt: r.endedAt, engineerId: r.engineerId != null ? String(r.engineerId) : null,
        engineerName: r.engineerId != null ? names.get(String(r.engineerId)) ?? null : null,
        turns: r.turns, commitShas: r.commitShas || [],
        taskId: r.taskId != null ? String(r.taskId) : null, milestoneId: r.milestoneId != null ? String(r.milestoneId) : null
      })
    }
    res.json({ code: 0, data: groups })
  } catch (e) { serverError('timeline')(res, e) }
})

// ---------- 经验沉淀 ----------

router.post('/experience/from-conversation', internalAuth, async (req, res) => {
  try {
    const b = req.body || {}
    if (!isId(b.conversationId)) return fail(res, 400, 9002, 'conversationId 不合法')
    const title = String(b.title ?? '').trim()
    const body = String(b.body ?? '').trim()
    if (!title) return fail(res, 400, 9002, '请填写标题')
    if (title.length > 200) return fail(res, 400, 9002, '标题最长 200 字')
    if (!body) return fail(res, 400, 9002, '请填写正文')
    const kind = b.kind ? String(b.kind).toUpperCase() : 'EXPERIENCE'
    if (!EXPERIENCE_KINDS.includes(kind)) return fail(res, 400, 9002, `kind 只能是 ${EXPERIENCE_KINDS.join('/')}`)
    let reusableLevel = 2
    if (b.reusableLevel != null && b.reusableLevel !== '') {
      reusableLevel = Number(b.reusableLevel)
      if (!Number.isInteger(reusableLevel) || reusableLevel < 1 || reusableLevel > 5) return fail(res, 400, 9002, 'reusableLevel 取 1~5')
    }
    if (b.tags != null && !Array.isArray(b.tags)) return fail(res, 400, 9002, 'tags 必须是数组')

    req.params.id = String(b.conversationId)
    const c = await findVisibleConversation(req)
    if (!c) return fail(res, 404, 9004, '会话不存在或无权查看')

    const row = await prisma.devExperience.create({
      data: { title, kind, body, projectId: c.projectId, conversationId: c.id, tags: b.tags ? strList(b.tags) : undefined, reusableLevel, createdBy: userIdOf(req) }
    })
    await logInternalAction(req, 'devlog.experience.create', { resourceType: 'dev_experience', resourceId: row.id, details: { conversationId: String(c.id), kind, title } })
    res.status(201).json({ code: 0, data: row })
  } catch (e) { serverError('experience create')(res, e) }
})

router.get('/experience', internalAuth, async (req, res) => {
  try {
    const q = req.query
    const and = [{ deletedAt: null }]
    if (q.kind) {
      const k = String(q.kind).toUpperCase()
      if (!EXPERIENCE_KINDS.includes(k)) return fail(res, 400, 9002, `kind 只能是 ${EXPERIENCE_KINDS.join('/')}`)
      and.push({ kind: k })
    }
    if (q.projectId) {
      if (!isId(q.projectId)) return fail(res, 400, 9002, 'projectId 不合法')
      and.push({ projectId: BigInt(q.projectId) })
    }
    if (q.keyword) {
      const kw = String(q.keyword).trim().slice(0, 100)
      if (kw) and.push({ OR: [{ title: { contains: kw } }, { body: { contains: kw } }] })
    }
    if (q.tag) and.push({ tags: { array_contains: [String(q.tag).slice(0, 100)] } })
    const where = { AND: and }
    const { skip, take, page: p, size } = page(req)
    const [list, total] = await Promise.all([
      prisma.devExperience.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
      prisma.devExperience.count({ where })
    ])
    res.json({ code: 0, data: { list, total, page: p, size } })
  } catch (e) { serverError('experience list')(res, e) }
})

export default router
