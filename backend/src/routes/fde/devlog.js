// 0.5.0 开发过程会话回流(挂在 /api 下, 路径不带 /fde 前缀):
//   POST /api/devlog/conversations             批量上报, 按 uid 幂等 upsert(登录用户 / API Key 均可, 采集器用 Key)
//   GET  /api/dev/conversations                列表(默认不带正文, ?withBody=1 才带; engineerId=me 只看我的)
//   GET  /api/dev/conversations/:id            详情(含事件与正文)
//   POST /api/dev/conversations/:id/link       关联项目/任务/里程碑/阶段 → LINKED, 写审计
//   POST /api/dev/conversations/:id/summarize  出摘要: 有模型走 chatJSON, 没有降级规则(mode:'rules'); GENERAL 时按建议回填 stage
//   POST /api/dev/conversations/paste          粘贴一段对话 → 会话(uid 按文本哈希, 重复粘贴不新增) + 自动摘要
//   POST /api/devlog/upload                    上传对话文件(multipart files[], 最多 20 个、单个 50MB) → 逐个解析入库 + 自动摘要
//   GET  /api/projects/:id/timeline            项目下会话按阶段分组
//   POST /api/experience/from-conversation     从会话沉淀经验, 写审计; auto:true 由摘要生成草稿(preview:true 只返回草稿不落库)
//   GET  /api/experience                       经验列表
//   GET  /api/experience/:id                   详情(含 obsidianPath、来源会话摘要)
//   PATCH /api/experience/:id                  改标题/正文/kind/tags/可复用度(本人或管理员)
//   POST /api/experience/:id/sync-obsidian     单条同步到 Obsidian(本人或管理员), 返回路径
//   POST /api/experience/sync-all              批量补同步(管理员), 返回 { synced, skipped, failed }
//
// 数据范围: 角色 dataScope=ALL(管理员)看全部; 其余看自己的(engineerId=本人 或 本人上报);
//          经理型(OWN_PROJECTS)另外能看自己负责/参与项目下的会话
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { decodeOriginalName } from '../../lib/storage.js'
import prisma from '../../lib/prisma.js'
import { internalAuth, hasPermission, getDataScope, buildScopeWhere } from '../../lib/auth.js'
import { mcpAuth } from '../../lib/apiKey.js'
import { logInternalAction } from '../../lib/audit.js'
import { isProjectInScope } from './projects.js'
import {
  SOURCES, STAGES, STATUSES, EXPERIENCE_KINDS, MAX_BATCH, InputError,
  normalizeItem, upsertConversation, fillProjectFromRefs
} from '../../services/devlog/conversations.js'
import { summarizeAndApply, ruleExtract, strList } from '../../services/devlog/summarize.js'
import { parsePaste, pasteUid, pasteTitle, MAX_PASTE_CHARS } from '../../services/devlog/paste.js'
import { draftFromSummary } from '../../services/devlog/experience.js'
import { decodeSessionBuffer, parseSessionText, contentUid } from '../../services/devlog/parseSessions.js'
import { syncExperience, syncAll } from '../../services/obsidian.js'

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
    // engineerId=me: 「我的会话」= 归到我工程师档案下的, 或者我本人上报/粘贴的(没建档案也能看到自己的)
    if (String(q.engineerId || '').toLowerCase() === 'me') {
      const eng = await engineerIdOf(req)
      and.push({ OR: [{ createdBy: userIdOf(req) }, ...(eng ? [{ engineerId: eng }] : [])] })
    }
    for (const k of ['projectId', 'engineerId']) {
      if (q[k] == null || q[k] === '') continue
      if (k === 'engineerId' && String(q[k]).toLowerCase() === 'me') continue
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

router.post('/dev/conversations/:id/summarize', internalAuth, async (req, res) => {
  try {
    const c = await findVisibleConversation(req, { events: { orderBy: { seq: 'asc' } } })
    if (!c) return fail(res, 404, 9004, '会话不存在或无权查看')
    const r = await summarizeAndApply(c, c.events)
    await logInternalAction(req, 'devlog.conversation.summarize', {
      resourceType: 'dev_conversation', resourceId: c.id,
      details: { mode: r.mode, ...(r.reason ? { reason: r.reason } : {}), ...(r.stageApplied ? { stage: r.stage } : {}) }
    })
    res.json({ code: 0, data: summaryView(c.id, r) })
  } catch (e) { serverError('summarize')(res, e) }
})

/** 摘要接口的返回: 规则模式带 reason 与 files */
function summaryView(id, r) {
  const { reason, files, ...rest } = r
  return { id: String(id), ...rest, ...(r.mode === 'rules' && reason ? { reason } : {}), ...(files ? { files } : {}) }
}

// ---------- 粘贴通道 ----------

router.post('/dev/conversations/paste', internalAuth, async (req, res) => {
  try {
    const b = req.body || {}
    if (typeof b.text !== 'string' || !b.text.trim()) return fail(res, 400, 9002, '请粘贴对话内容（text）')
    if (b.text.length > MAX_PASTE_CHARS) return fail(res, 400, 9002, `内容太长（最多 ${MAX_PASTE_CHARS} 字）`)
    const { messages } = parsePaste(b.text)
    const uid = pasteUid(b.text)
    // 自动标题只在新建时用; 重复粘贴不带 title 时保留原标题(可能是人填的)
    const given = b.title != null && String(b.title).trim() ? String(b.title).trim() : null
    const isNew = !(await prisma.devConversation.findUnique({ where: { uid }, select: { id: true } }))
    let item
    try {
      item = normalizeItem({
        uid, source: 'PASTE', stage: b.stage, projectId: b.projectId,
        title: given || (isNew ? pasteTitle(messages) : undefined),
        body: messages
      })
    } catch (e) { if (e instanceof InputError) return fail(res, 400, 9002, e.message); throw e }
    if (item.data.projectId && !(await isProjectInScope(req.user, item.data.projectId))) return fail(res, 403, 1003, '无权关联到该项目')

    const actor = { userId: userIdOf(req), engineerId: await engineerIdOf(req), all: getDataScope(req.user.role) === 'ALL' }
    let saved
    try { saved = await upsertConversation(item, actor) } catch (e) {
      if (e instanceof InputError) return fail(res, /占用/.test(e.message) ? 409 : 400, 9002, e.message)
      throw e
    }
    const c = await prisma.devConversation.findUnique({ where: { id: saved.id }, include: { events: { orderBy: { seq: 'asc' } } } })
    const r = await summarizeAndApply(c, c.events)
    await logInternalAction(req, 'devlog.conversation.paste', {
      resourceType: 'dev_conversation', resourceId: c.id,
      details: { uid: c.uid, created: saved.created, messages: messages.length, mode: r.mode }
    })
    res.status(saved.created ? 201 : 200).json({
      code: 0,
      data: { ...summaryView(c.id, r), uid: c.uid, created: saved.created, title: c.title, messages: messages.length }
    })
  } catch (e) { serverError('paste')(res, e) }
})

// ---------- 上传对话文件 ----------

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const UPLOAD_MAX_FILES = 20
const UPLOAD_EXT = /\.(jsonl|json|log|txt|md|zst)$/i

// 内存存储引擎: 超过 50MB / 扩展名不支持的文件不让整个请求失败, 只丢弃内容、标记出来, 由路由逐个报错
// (multer 自带的 limits.fileSize / fileFilter 会中断整批, 一个大文件就把同批其它文件也挡掉了)
const memoryCapped = {
  _handleFile(req, file, cb) {
    file.originalname = decodeOriginalName(file.originalname)
    const chunks = []
    let size = 0
    let rejected = UPLOAD_EXT.test(file.originalname) ? null : 'ext'
    file.stream.on('data', (c) => {
      size += c.length
      if (rejected) return
      if (size > UPLOAD_MAX_BYTES) { rejected = 'size'; chunks.length = 0; return }
      chunks.push(c)
    })
    file.stream.on('error', cb)
    file.stream.on('end', () => cb(null, { buffer: rejected ? null : Buffer.concat(chunks), size, rejected }))
  },
  _removeFile(req, file, cb) { file.buffer = null; cb(null) }
}
const sessionUpload = multer({ storage: memoryCapped, limits: { files: UPLOAD_MAX_FILES } })

function uploadFiles(req, res, next) {
  sessionUpload.array('files', UPLOAD_MAX_FILES)(req, res, (err) => {
    if (!err) return next()
    const message = err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
      ? (err.field && err.field !== 'files' ? `文件字段名应为 files（收到 ${err.field}）` : `一次最多上传 ${UPLOAD_MAX_FILES} 个文件`)
      : `上传失败：${err.message}`
    fail(res, 400, 9002, message)
  })
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

/** 一个上传文件 → 解析出的会话(上报结构); 认不出 / 太大 / 类型不对抛 Error(文案直接给前端) */
function parseUploaded(file, stage) {
  const name = file.originalname
  if (file.rejected === 'size') {
    throw new Error(`文件 ${mb(file.size)}，超过 ${mb(UPLOAD_MAX_BYTES)} 上限；大会话请用命令行导入：yh-devlog import <文件>（见 scripts/devlog/README.md）`)
  }
  if (file.rejected === 'ext') throw new Error(`不支持的文件类型 ${path.extname(name) || '（无扩展名）'}：支持 .jsonl / .json / .log / .txt / .md / .zst`)
  const text = decodeSessionBuffer(file.buffer, name)
  if (!text.trim()) throw new Error('文件是空的')
  const parsed = parseSessionText(text, { file: name, size: file.buffer.length, stage, fallbackUid: contentUid(text) })
  if (!parsed.conversations.length) throw new Error('文件里没有可用的对话消息')
  return parsed.conversations
}

router.post('/devlog/upload', internalAuth, uploadFiles, async (req, res) => {
  try {
    const files = req.files || []
    if (!files.length) return fail(res, 400, 9002, '请选择要上传的对话文件（字段名 files）')
    const b = req.body || {}
    let stage
    if (b.stage) {
      stage = String(b.stage).toUpperCase()
      if (!STAGES.includes(stage)) return fail(res, 400, 9002, `stage 只能是 ${STAGES.join('/')}`)
    }
    let projectId
    if (b.projectId) {
      if (!isId(b.projectId)) return fail(res, 400, 9002, 'projectId 不合法')
      projectId = BigInt(b.projectId)
      const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } })
      if (!p) return fail(res, 404, 9004, '项目不存在')
      if (!(await isProjectInScope(req.user, projectId))) return fail(res, 403, 1003, '无权关联到该项目')
    }
    const actor = { userId: userIdOf(req), engineerId: await engineerIdOf(req), all: getDataScope(req.user.role) === 'ALL' }
    let engineerId
    if (b.engineerId) {
      if (!isId(b.engineerId)) return fail(res, 400, 9002, 'engineerId 不合法')
      engineerId = BigInt(b.engineerId)
      if (!actor.all && engineerId !== actor.engineerId) return fail(res, 403, 1003, '只有管理员能把会话指派给别人')
      const eng = await prisma.engineer.findFirst({ where: { id: engineerId, deletedAt: null }, select: { id: true } })
      if (!eng) return fail(res, 404, 9004, '工程师不存在')
    }

    const items = []
    const errors = []
    for (const file of files) {
      const name = file.originalname
      let convs
      try { convs = parseUploaded(file, stage) } catch (e) { errors.push({ file: name, message: e.message }); continue }
      file.buffer = null
      for (const conv of convs) {
        try {
          const { sessionId, truncated, ...raw } = conv
          const existing = await prisma.devConversation.findUnique({ where: { uid: raw.uid }, select: { id: true } })
          // 重复上传没指定阶段: 保留原来的阶段(可能是人改过的)
          if (existing && !stage) delete raw.stage
          // 通用文本没有时间戳: 新建时记上传时间, 否则列表(按开始时间倒序)里会沉到最后
          if (!existing && !raw.startedAt) raw.startedAt = new Date().toISOString()
          const item = normalizeItem({ ...raw, ...(projectId ? { projectId: String(projectId) } : {}), ...(engineerId ? { engineerId: String(engineerId) } : {}) })
          const saved = await upsertConversation(item, actor)
          const c = await prisma.devConversation.findUnique({ where: { id: saved.id }, include: { events: { orderBy: { seq: 'asc' } } } })
          let r = null
          try { r = await summarizeAndApply(c, c.events) } catch (e) { console.error('[devlog upload summarize]', e) }
          items.push({
            file: name, ok: true, conversationId: String(c.id), uid: c.uid, created: saved.created,
            source: c.source, stage: r?.stage || c.stage, turns: c.turns, title: c.title,
            summary: r?.summary ?? c.summary, mode: r?.mode || null, truncated: !!truncated
          })
        } catch (e) {
          if (!(e instanceof InputError)) console.error('[devlog upload]', name, e)
          errors.push({ file: name, message: e instanceof InputError ? e.message : `保存失败：${String(e.message || e).slice(0, 200)}` })
        }
      }
    }
    await logInternalAction(req, 'DEVLOG_UPLOAD', {
      resourceType: 'dev_conversation',
      details: {
        files: files.map((f) => f.originalname), items: items.length, created: items.filter((i) => i.created).length, errors: errors.length,
        sources: [...new Set(items.map((i) => i.source))],
        ...(projectId ? { projectId: String(projectId) } : {}), ...(engineerId ? { engineerId: String(engineerId) } : {})
      }
    })
    res.status(items.some((i) => i.created) ? 201 : 200).json({ code: 0, data: { items, errors } })
  } catch (e) { serverError('upload')(res, e) }
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

/** 经验字段校验(新建/修改共用); partial=true 时只校验给了的字段。返回 { data } 或 { error } */
function experienceInput(b, partial) {
  const data = {}
  if (!partial || b.title !== undefined) {
    const title = String(b.title ?? '').trim()
    if (!title) return { error: '请填写标题' }
    if (title.length > 200) return { error: '标题最长 200 字' }
    data.title = title
  }
  if (!partial || b.body !== undefined) {
    const body = String(b.body ?? '').trim()
    if (!body) return { error: '请填写正文' }
    if (body.length > 60000) return { error: '正文最长 60000 字' }
    data.body = body
  }
  if (b.kind !== undefined && b.kind !== null && b.kind !== '') {
    const kind = String(b.kind).toUpperCase()
    if (!EXPERIENCE_KINDS.includes(kind)) return { error: `kind 只能是 ${EXPERIENCE_KINDS.join('/')}` }
    data.kind = kind
  } else if (!partial) data.kind = 'EXPERIENCE'
  if (b.reusableLevel != null && b.reusableLevel !== '') {
    const n = Number(b.reusableLevel)
    if (!Number.isInteger(n) || n < 1 || n > 5) return { error: 'reusableLevel 取 1~5' }
    data.reusableLevel = n
  }
  if (b.tags != null) {
    if (!Array.isArray(b.tags)) return { error: 'tags 必须是数组' }
    data.tags = strList(b.tags, 10)
  }
  return { data }
}

const pick = (v, fallback) => (v === undefined || v === null || (typeof v === 'string' && !v.trim()) ? fallback : v)

router.post('/experience/from-conversation', internalAuth, async (req, res) => {
  try {
    const b = req.body || {}
    if (!isId(b.conversationId)) return fail(res, 400, 9002, 'conversationId 不合法')
    req.params.id = String(b.conversationId)
    const c = await findVisibleConversation(req, { events: { orderBy: { seq: 'asc' } } })
    if (!c) return fail(res, 404, 9004, '会话不存在或无权查看')

    // auto: 用会话摘要生成草稿; 会话还没摘要就先跑一次(规则兜底)并落到会话上。人填了的字段优先
    let draft = null
    let mode = null
    if (b.auto === true || b.auto === 'true') {
      let s
      if (c.summary) {
        const rules = ruleExtract(c, c.events)
        s = { summary: c.summary, decisions: strList(c.decisions), pitfalls: strList(c.pitfalls), tags: strList(c.tags, 10), artifacts: rules.artifacts }
        mode = 'stored'
      } else {
        s = await summarizeAndApply(c, c.events)
        mode = s.mode
      }
      draft = draftFromSummary(s, c)
      if (b.preview === true || b.preview === 'true') {
        return res.json({ code: 0, data: { ...draft, conversationId: String(c.id), projectId: c.projectId != null ? String(c.projectId) : null, reusableLevel: 2, mode } })
      }
    }
    const merged = draft
      ? { title: pick(b.title, draft.title), body: pick(b.body, draft.body), kind: pick(b.kind, draft.kind), tags: pick(b.tags, draft.tags), reusableLevel: b.reusableLevel }
      : b
    const { data, error } = experienceInput(merged, false)
    if (error) return fail(res, 400, 9002, error)

    const row = await prisma.devExperience.create({
      data: { reusableLevel: 2, ...data, projectId: c.projectId, conversationId: c.id, createdBy: userIdOf(req) }
    })
    await logInternalAction(req, 'devlog.experience.create', {
      resourceType: 'dev_experience', resourceId: row.id,
      details: { conversationId: String(c.id), kind: row.kind, title: row.title, ...(draft ? { auto: true, mode } : {}) }
    })
    res.status(201).json({ code: 0, data: { ...row, ...(draft ? { auto: true, mode } : {}) } })
  } catch (e) { serverError('experience create')(res, e) }
})

/** 经验本人或管理员才能改 / 同步 */
const canEditExperience = (req, exp) => getDataScope(req.user.role) === 'ALL' || (exp.createdBy != null && exp.createdBy === userIdOf(req))

async function findExperience(req) {
  if (!isId(req.params.id)) return null
  return prisma.devExperience.findFirst({ where: { id: BigInt(req.params.id), deletedAt: null } })
}

router.post('/experience/sync-all', internalAuth, async (req, res) => {
  try {
    if (getDataScope(req.user.role) !== 'ALL') return fail(res, 403, 1003, '只有管理员能批量同步')
    const where = {}
    const projectId = req.body?.projectId ?? req.query.projectId
    if (projectId != null && projectId !== '') {
      if (!isId(projectId)) return fail(res, 400, 9002, 'projectId 不合法')
      where.projectId = BigInt(projectId)
    }
    let r
    try { r = await syncAll(where) } catch (e) { return fail(res, 400, 9002, e.message) } // vault 路径不可用
    await logInternalAction(req, 'devlog.experience.sync_all', { resourceType: 'dev_experience', details: { ...r, errors: r.errors.length, ...(where.projectId ? { projectId: String(where.projectId) } : {}) } })
    res.json({ code: 0, data: r })
  } catch (e) { serverError('experience sync-all')(res, e) }
})

router.get('/experience/:id', internalAuth, async (req, res) => {
  try {
    const exp = await findExperience(req)
    if (!exp) return fail(res, 404, 9004, '经验不存在')
    const project = exp.projectId ? await prisma.project.findUnique({ where: { id: exp.projectId }, select: { id: true, name: true } }) : null
    // 来源会话: 在自己数据范围内才给摘要, 否则只给 id
    let conversation = null
    if (exp.conversationId) {
      req.params.id = String(exp.conversationId)
      const c = await findVisibleConversation(req)
      conversation = c
        ? { id: String(c.id), uid: c.uid, title: c.title, summary: c.summary, source: c.source, stage: c.stage, startedAt: c.startedAt, createdAt: c.createdAt, visible: true }
        : { id: String(exp.conversationId), visible: false }
    }
    res.json({ code: 0, data: { ...exp, projectName: project?.name ?? null, conversation, canEdit: canEditExperience(req, exp) } })
  } catch (e) { serverError('experience detail')(res, e) }
})

router.patch('/experience/:id', internalAuth, async (req, res) => {
  try {
    const exp = await findExperience(req)
    if (!exp) return fail(res, 404, 9004, '经验不存在')
    if (!canEditExperience(req, exp)) return fail(res, 403, 1003, '只能改自己沉淀的经验')
    const { data, error } = experienceInput(req.body || {}, true)
    if (error) return fail(res, 400, 9002, error)
    if (!Object.keys(data).length) return res.json({ code: 0, data: exp })
    const row = await prisma.devExperience.update({ where: { id: exp.id }, data })
    await logInternalAction(req, 'devlog.experience.update', { resourceType: 'dev_experience', resourceId: exp.id, details: { changed: Object.keys(data) } })
    res.json({ code: 0, data: row })
  } catch (e) { serverError('experience update')(res, e) }
})

router.post('/experience/:id/sync-obsidian', internalAuth, async (req, res) => {
  try {
    const exp = await findExperience(req)
    if (!exp) return fail(res, 404, 9004, '经验不存在')
    if (!canEditExperience(req, exp)) return fail(res, 403, 1003, '只能同步自己沉淀的经验')
    const r = await syncExperience(exp.id)
    await logInternalAction(req, 'devlog.experience.sync', { resourceType: 'dev_experience', resourceId: exp.id, details: r })
    // 写文件失败不是请求错误: 数据库记录照旧, 返回 ok:false 让前端提示
    res.json({ code: 0, data: r })
  } catch (e) { serverError('experience sync')(res, e) }
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
