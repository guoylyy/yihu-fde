// FDE 平台 - 项目记录 (v1.4.x 主人拍板: 过程资料时间线)
// 会议纪要/对接沟通/现场照片视频/资料归档全部沉淀到项目, 让进展更可掌握
// 查看跟随项目数据范围; 所有参与交付的角色都可记录(降低沉淀门槛)
import { buildScopedWhere } from '../../lib/scopedQuery.js'
import express from 'express'
import multer from 'multer'
import fs from 'fs'
import os from 'os'
import path from 'path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission, buildScopeWhere, hasPermission } from '../../lib/auth.js'
import { recordActivity } from '../../lib/activity.js'
import { uploadFile, decodeOriginalName, sanitizeFilename } from '../../lib/storage.js'
import { chatJSON, LlmNotConfiguredError } from '../../lib/llm.js'
import { parseChat } from '../../lib/chatParser.js'

const router = express.Router()
router.use(internalAuth)

// v1.6.0 Agent 协作: +CHAT 客户聊天记录 / +RESEARCH 研究记录(过程资源沉淀)
const RECORD_TYPES = ['MEETING', 'COMM', 'SITE', 'FILE', 'CHAT', 'RESEARCH', 'OTHER']
export const RECORD_TYPE_LABELS = { MEETING: '会议纪要', COMM: '对接沟通', SITE: '现场记录', FILE: '资料归档', CHAT: '聊天记录', RESEARCH: '研究记录', OTHER: '其他' }

// 附件展示方式按扩展名推断
function attachmentKind(filename) {
  if (/\.(jpe?g|png|gif|webp)$/i.test(filename)) return 'IMAGE'
  if (/\.(mp4|mov|webm)$/i.test(filename)) return 'VIDEO'
  return 'FILE'
}

// v2.1.13(#560): 在职项目成员 [{userId, name}] —— 待办责任人匹配/校验用(双轨: userId 直连或经工程师档案)
async function listMemberUsers(projectId) {
  const members = await prisma.projectMember.findMany({
    where: { projectId, leaveDate: null },
    include: {
      user: { select: { id: true, name: true } },
      engineer: { select: { user: { select: { id: true, name: true } } } }
    }
  })
  const out = []
  for (const m of members) {
    const u = m.user || m.engineer?.user
    if (u?.name && !out.some(x => String(x.userId) === String(u.id))) out.push({ userId: u.id, name: u.name })
  }
  return out
}

// 项目归属校验(套数据范围, 防越权)
async function findScopedProject(user, projectIdRaw) {
  let projectId
  try { projectId = BigInt(projectIdRaw) } catch { return null }
  const projectScope = await buildScopeWhere(user, 'project')
  // v2.1.14 fix: scope 条件可能与 id 冲突(FDE_ENGINEER 的 project scope 含 id 字段),
  // 直接 spread 会覆盖上方 id: projectId, 导致任意项目请求都返回固定项目的数据(串项目根因)。
  // 改用 AND 显式求交: 项目 id 必须同时命中 URL 指定 id 与数据范围。
  return prisma.project.findFirst({
    where: buildScopedWhere({ id: projectId, deletedAt: null }, projectScope),
    select: { id: true, code: true, name: true, customerId: true }
  })
}

/**
 * GET /api/fde/projects/:projectId/records?type=&page=&page_size=
 */
router.get('/:projectId/records', requirePermission('project.view'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })

    const { type, page = 1, page_size = 20 } = req.query
    const where = { projectId: project.id, deletedAt: null }
    if (type && RECORD_TYPES.includes(type)) where.type = type

    const skip = (Number(page) - 1) * Number(page_size)
    const [list, total] = await Promise.all([
      prisma.projectRecord.findMany({
        where,
        skip,
        take: Number(page_size),
        orderBy: { occurredAt: 'desc' },
        include: {
          attachments: true,
          // v1.9.11(#360): 关联展示 —— 该会议产生的需求(含生成的任务/里程碑回链)
          requirements: {
            where: { deletedAt: null },
            select: { id: true, title: true, status: true, priority: true, taskId: true, milestoneId: true },
            orderBy: { id: 'asc' }
          }
        }
      }),
      prisma.projectRecord.count({ where })
    ])
    // 创建人姓名 + Agent 来源名(v1.6.0: 展示"某某的某 Agent 沉淀")
    const uids = [...new Set(list.map(r => String(r.createdBy)))]
    const aids = [...new Set(list.filter(r => r.createdByAgentId).map(r => r.createdByAgentId))]
    const [users, agents] = await Promise.all([
      uids.length ? prisma.user.findMany({ where: { id: { in: uids.map(BigInt) } }, select: { id: true, name: true } }) : [],
      aids.length ? prisma.agentProfile.findMany({ where: { id: { in: aids } }, select: { id: true, name: true } }) : []
    ])
    const umap = new Map(users.map(u => [String(u.id), u.name]))
    const amap = new Map(agents.map(a => [String(a.id), a.name]))
    res.json({
      code: 0,
      data: {
        list: list.map(r => ({
          ...r,
          creatorName: umap.get(String(r.createdBy)) || '',
          agentName: r.createdByAgentId ? (amap.get(String(r.createdByAgentId)) || '') : ''
        })),
        total, typeLabels: RECORD_TYPE_LABELS,
        page: Number(page), page_size: Number(page_size)
      }
    })
  } catch (e) {
    console.error('[fde/project-records GET]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ---------- 2026-07-31 会议纪要文档导入(md/docx/pdf → 大模型抽取字段 → 前端确认后走普通创建) ----------
// 腾讯会议/飞书会议导出的纪要直接丢进来, 免去手工誊抄
const importStorage = multer.diskStorage({
  destination: path.join(os.tmpdir(), 'fde-uploads'),
  filename: (req, file, cb) => {
    file.originalname = decodeOriginalName(file.originalname)
    cb(null, `${Date.now()}_${sanitizeFilename(file.originalname)}`)
  }
})
const importUpload = multer({
  storage: importStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/\.(md|markdown|txt|docx|pdf)$/i.test(file.originalname)) {
      return cb(new Error('仅支持 .md / .txt / .docx / .pdf（老版 .doc 请先另存为 .docx）'))
    }
    cb(null, true)
  }
})

async function extractDocText(file) {
  const fs = await import('node:fs/promises')
  const buffer = await fs.readFile(file.path)
  const name = file.originalname.toLowerCase()
  if (/\.(md|markdown|txt)$/.test(name)) return buffer.toString('utf8')
  if (name.endsWith('.docx')) {
    const r = await mammoth.extractRawText({ buffer })
    return r.value || ''
  }
  if (name.endsWith('.pdf')) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const r = await parser.getText()
      return r.text || ''
    } finally { await parser.destroy?.().catch(() => {}) }
  }
  return ''
}

const EXTRACT_SYSTEM = `你是一个会议纪要整理助手。用户会给你一份会议/沟通文档的原始文本(可能来自腾讯会议、飞书会议导出, 含转写噪音)。
请只输出一个 JSON 对象(不要 markdown 围栏、不要解释), 字段:
{
  "type": "MEETING 或 COMM 或 OTHER (会议纪要选 MEETING, 一对一/群聊沟通选 COMM, 判断不了选 MEETING)",
  "title": "一句话标题, 概括主题, 不超过 50 字",
  "occurredAt": "文档中的会议/沟通时间, 格式 YYYY-MM-DD HH:mm, 只有日期就 YYYY-MM-DD, 找不到就 null",
  "attendees": "参会/参与人姓名, 逗号分隔的字符串, 找不到就 null",
  "content": "整理后的纪要正文, Markdown 格式。排版要求(v2.0.0 #370 推文风格): 按需组织为 ## 📌 议题 / ## 💬 讨论要点 / ## ✅ 结论 / ## 📋 待办 四节(没有内容的节省略); 每个标题、段落、列表之间必须空一行; 要点用列表逐条列, 每条一句话; 待办格式「- **负责人**: 事项（期限）」; 关键决策用 **加粗**。保留关键信息, 去掉转写噪音和寒暄, 不要编造文档里没有的内容"
}`

/**
 * POST /api/fde/projects/:projectId/records/extract  (multipart: file)
 * 解析文档 → 大模型抽取 → 返回草稿字段 + 已上传的原文件附件, 由前端确认后调创建接口
 */
router.post('/:projectId/records/extract', requirePermission('projectRecord.create'), importUpload.single('file'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    if (!req.file) return res.status(400).json({ code: 9002, message: '未收到文件 (字段名: file)' })

    const rawText = (await extractDocText(req.file)).trim()
    if (!rawText) return res.status(400).json({ code: 9002, message: '文档解析不到文字内容(扫描件 PDF 暂不支持, 请用带文字层的导出文档)' })

    // 原文档同步上传存储, 作为记录附件一并保留(失败不阻断抽取)
    let attachment = null
    try {
      const up = await uploadFile(req.file)
      attachment = { filename: req.file.originalname, fileUrl: up.url, fileSize: req.file.size }
    } catch (e) {
      console.warn('[records:extract] 原文件上传失败(忽略):', e.message)
    }

    // 过长截断, 避免超出模型输入(30k 字符对纪要场景足够)
    const MAX_CHARS = 30000
    const truncated = rawText.length > MAX_CHARS
    const draft = await chatJSON({
      system: EXTRACT_SYSTEM,
      user: (truncated ? rawText.slice(0, MAX_CHARS) + '\n\n(注: 文档过长已截断)' : rawText),
      maxTokens: 8192
    })

    res.json({
      code: 0,
      data: {
        draft: {
          type: RECORD_TYPES.includes(draft.type) ? draft.type : 'MEETING',
          title: String(draft.title || req.file.originalname.replace(/\.[^.]+$/, '')).slice(0, 200),
          content: draft.content || rawText.slice(0, 5000),
          occurredAt: draft.occurredAt || null,
          attendees: draft.attendees || null
        },
        attachment,
        truncated
      }
    })
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) return res.status(400).json({ code: 4101, message: e.message })
    console.error('[fde/project-records extract]', e)
    res.status(500).json({ code: 9001, message: '识别失败: ' + e.message })
  }
})

// ---------- v1.6.1 聊天记录导入(微信 txt/飞书) ----------
// 两入口: 粘贴文本(JSON {text}) / 上传导出文件(multipart file, multer 对非 multipart 请求自动跳过)
// 规则解析优先(lib/chatParser), 认不出降级纯文本 —— 只为看得清服务, 不走大模型(决策⑤)
router.post('/:projectId/records/parse-chat', requirePermission('projectRecord.create'), importUpload.single('file'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })

    let rawText = ''
    let attachment = null
    if (req.file) {
      rawText = (await extractDocText(req.file)).trim()
      // 原始导出文件上传存储留档(失败不阻断)
      try {
        const up = await uploadFile(req.file)
        attachment = { filename: req.file.originalname, fileUrl: up.url, fileSize: req.file.size }
      } catch (e) {
        console.warn('[records:parse-chat] 原文件上传失败(忽略):', e.message)
      }
    } else {
      rawText = String(req.body?.text || '').trim()
    }
    if (!rawText) return res.status(400).json({ code: 9002, message: '没有可解析的内容(粘贴文本或上传导出文件)' })
    if (rawText.length > 500000) return res.status(400).json({ code: 9002, message: '内容过长(>50万字符), 请拆分导入' })

    const parsed = parseChat(rawText)
    const PREVIEW_MAX = 2000
    res.json({
      code: 0,
      data: {
        parsed: parsed.ok,
        pattern: parsed.pattern,
        messages: parsed.messages.slice(0, PREVIEW_MAX),
        truncated: parsed.messages.length > PREVIEW_MAX,
        speakers: parsed.speakers,
        occurredAt: parsed.occurredAt,
        markdown: parsed.markdown,
        attachment
      }
    })
  } catch (e) {
    console.error('[fde/project-records parse-chat]', e)
    res.status(500).json({ code: 9001, message: '解析失败: ' + e.message })
  }
})

// ---------- v1.6.1 客户轴聚合: 该客户名下所有项目的交互史(对接/聊天/会议 + Agent 对话) ----------
// 打单/复盘前一页看全交互; 项目按调用者数据范围过滤, 不越权
router.get('/customer/:customerId/interactions', requirePermission('customer.view'), async (req, res) => {
  try {
    let customerId
    try { customerId = BigInt(req.params.customerId) } catch { return res.status(400).json({ code: 9002, message: 'customerId 不合法' }) }
    const customer = await prisma.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { id: true } })
    if (!customer) return res.status(404).json({ code: 2004, message: '客户不存在' })

    const projectScope = await buildScopeWhere(req.user, 'project')
    const projects = await prisma.project.findMany({
      // v2.1.14 fix: 同 findScopedProject, AND 求交防 scope 的 id 条件覆盖 customerId 查询语义
      where: buildScopedWhere({ customerId, deletedAt: null }, projectScope),
      select: { id: true, code: true, name: true }
    })
    const pids = projects.map(p => p.id)
    const pmap = new Map(projects.map(p => [String(p.id), p]))

    const { type, page = 1, page_size = 20 } = req.query
    const typeWhere = type && RECORD_TYPES.includes(type) ? [type] : ['COMM', 'CHAT', 'MEETING']
    const where = { projectId: { in: pids }, type: { in: typeWhere }, deletedAt: null }
    const skip = (Number(page) - 1) * Number(page_size)
    const [list, total, conversations] = await Promise.all([
      pids.length ? prisma.projectRecord.findMany({
        where, skip, take: Number(page_size),
        orderBy: { occurredAt: 'desc' },
        include: { attachments: true }
      }) : [],
      pids.length ? prisma.projectRecord.count({ where }) : 0,
      prisma.agentConversation.findMany({
        where: {
          deletedAt: null,
          OR: [{ customerId }, ...(pids.length ? [{ projectId: { in: pids } }] : [])]
        },
        include: { _count: { select: { messages: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 100
      })
    ])

    // 创建人/Agent/归属人姓名
    const uids = [...new Set([...list.map(r => String(r.createdBy)), ...conversations.map(c => String(c.userId))])]
    const aids = [...new Set([...list.filter(r => r.createdByAgentId).map(r => r.createdByAgentId),
      ...conversations.filter(c => c.agentProfileId).map(c => c.agentProfileId)])]
    const [users, agents] = await Promise.all([
      uids.length ? prisma.user.findMany({ where: { id: { in: uids.map(BigInt) } }, select: { id: true, name: true } }) : [],
      aids.length ? prisma.agentProfile.findMany({ where: { id: { in: aids } }, select: { id: true, name: true } }) : []
    ])
    const umap = new Map(users.map(u => [String(u.id), u.name]))
    const amap = new Map(agents.map(a => [String(a.id), a.name]))

    res.json({
      code: 0,
      data: {
        records: {
          list: list.map(r => ({
            ...r,
            creatorName: umap.get(String(r.createdBy)) || '',
            agentName: r.createdByAgentId ? (amap.get(String(r.createdByAgentId)) || '') : '',
            projectCode: pmap.get(String(r.projectId))?.code || '',
            projectName: pmap.get(String(r.projectId))?.name || ''
          })),
          total, page: Number(page), page_size: Number(page_size)
        },
        conversations: conversations.map(c => ({
          id: c.id.toString(),
          title: c.title || '',
          source: c.source,
          projectId: c.projectId ? c.projectId.toString() : null,
          projectCode: c.projectId ? (pmap.get(String(c.projectId))?.code || '') : '',
          updatedAt: c.updatedAt,
          messageCount: c._count.messages,
          ownerName: umap.get(String(c.userId)) || '',
          agentName: c.agentProfileId ? (amap.get(String(c.agentProfileId)) || '') : ''
        })),
        typeLabels: RECORD_TYPE_LABELS
      }
    })
  } catch (e) {
    console.error('[fde/project-records customer-interactions]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/projects/:projectId/records
 * { type, title, content?, occurredAt?, attendees?, attachments?: [{filename,fileUrl,fileSize}] }
 */
router.post('/:projectId/records', requirePermission('projectRecord.create'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })

    const { type, title, content, occurredAt, attendees, attachments } = req.body || {}
    if (!RECORD_TYPES.includes(type)) return res.status(400).json({ code: 9002, message: '记录类型不正确' })
    if (!title || !String(title).trim()) return res.status(400).json({ code: 9002, message: '请填写标题' })

    const record = await prisma.projectRecord.create({
      data: {
        projectId: project.id,
        type,
        title: String(title).trim().slice(0, 200),
        content: content || null,
        occurredAt: occurredAt && !isNaN(new Date(occurredAt).getTime()) ? new Date(occurredAt) : new Date(),
        attendees: attendees ? String(attendees).slice(0, 500) : null,
        createdBy: BigInt(req.user.id),
        // v1.6.0: 经 Agent 专属 Key 的写入记 Agent 归属(callApi 签的 JWT 里带过来)
        createdByAgentId: req.user.agentProfileId ? BigInt(req.user.agentProfileId) : null
      }
    })
    const atts = Array.isArray(attachments) ? attachments.slice(0, 20) : []
    for (const a of atts) {
      if (!a?.fileUrl || !a?.filename) continue
      await prisma.projectRecordAttachment.create({
        data: {
          recordId: record.id,
          filename: String(a.filename).slice(0, 200),
          fileUrl: String(a.fileUrl),
          fileSize: a.fileSize ? BigInt(a.fileSize) : null,
          kind: attachmentKind(a.filename)
        }
      }).catch(() => {})
    }

    recordActivity({
      actorId: req.user.id, entity: 'project', entityId: project.id, action: 'created',
      summary: `记录${RECORD_TYPE_LABELS[type]}「${record.title}」`
    }).catch(() => {})

    res.json({ code: 0, data: record })
  } catch (e) {
    console.error('[fde/project-records POST]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /api/fde/records/:id  编辑(创建人或经理层)
 */
router.put('/records/:id', requirePermission('projectRecord.create'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.projectRecord.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '记录不存在' })
    const isOwner = String(existing.createdBy) === String(req.user.id)
    if (!isOwner && !hasPermission(req.user, 'projectRecord.manage')) {
      return res.status(403).json({ code: 1003, message: '只能编辑自己创建的记录' })
    }
    const { type, title, content, occurredAt, attendees, attachments } = req.body || {}
    const data = {}
    if (type !== undefined) {
      if (!RECORD_TYPES.includes(type)) return res.status(400).json({ code: 9002, message: '记录类型不正确' })
      data.type = type
    }
    if (title !== undefined) {
      if (!String(title).trim()) return res.status(400).json({ code: 9002, message: '标题不能为空' })
      data.title = String(title).trim().slice(0, 200)
    }
    if (content !== undefined) data.content = content || null
    if (occurredAt !== undefined && !isNaN(new Date(occurredAt).getTime())) data.occurredAt = new Date(occurredAt)
    if (attendees !== undefined) data.attendees = attendees ? String(attendees).slice(0, 500) : null

    const updated = await prisma.projectRecord.update({ where: { id }, data })
    // 附件传入时整体重建(前端全量提交)
    if (Array.isArray(attachments)) {
      await prisma.projectRecordAttachment.deleteMany({ where: { recordId: id } })
      for (const a of attachments.slice(0, 20)) {
        if (!a?.fileUrl || !a?.filename) continue
        await prisma.projectRecordAttachment.create({
          data: {
            recordId: id,
            filename: String(a.filename).slice(0, 200),
            fileUrl: String(a.fileUrl),
            fileSize: a.fileSize ? BigInt(a.fileSize) : null,
            kind: attachmentKind(a.filename)
          }
        }).catch(() => {})
      }
    }
    res.json({ code: 0, data: updated })
  } catch (e) {
    console.error('[fde/project-records PUT]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * DELETE /api/fde/records/:id  (创建人或经理层)
 */
router.delete('/records/:id', requirePermission('projectRecord.create'), async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const existing = await prisma.projectRecord.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return res.status(404).json({ code: 9004, message: '记录不存在' })
    const isOwner = String(existing.createdBy) === String(req.user.id)
    if (!isOwner && !hasPermission(req.user, 'projectRecord.manage')) {
      return res.status(403).json({ code: 1003, message: '只能删除自己创建的记录' })
    }
    await prisma.projectRecord.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, message: '已删除' })
  } catch (e) {
    console.error('[fde/project-records DELETE]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ==================== v1.9.8(#350) 会议驱动需求: 纪要 → 结构化需求 ====================

router.post('/:projectId/records/:recordId/requirements/extract', requirePermission('projectRecord.create'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const record = await prisma.projectRecord.findFirst({
      where: { id: BigInt(req.params.recordId), projectId: project.id, deletedAt: null }
    })
    if (!record) return res.status(404).json({ code: 2004, message: '记录不存在' })
    if (!record.content || record.content.trim().length < 20) {
      return res.status(400).json({ code: 1002, message: '纪要正文太短, 无法梳理(先补充会议内容或等转写完成)' })
    }
    const milestones = await prisma.milestone.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { name: true, status: true }, orderBy: { sortOrder: 'asc' }
    })
    // v2.1.13(#560): 成员名单给 LLM 做责任人归属参考, 返回后按姓名匹配回填 ownerId
    const memberUsers = await listMemberUsers(project.id)
    const result = await chatJSON({
      system: `你是资深产品经理, 负责把客户会议纪要梳理成结构化的产品对接需求。只输出 JSON:
{"requirements":[{"title":"一句话需求点(<=50字)","detail":"背景与验收要点(2-4句, 引用纪要原意不编造)","priority":"LOW|MEDIUM|HIGH|URGENT","owner":"责任人姓名"}]}
规则: 只提取真实需求/待办/变更, 寒暄与既成事实不算; 每条独立可执行; 没有需求就返回空数组。
owner 规则(每项待办要有责任人): 纪要里明确提到谁负责/谁跟进就填谁(优先用成员名单里的写法), 没提到就填空字符串, 不要瞎猜。`,
      user: `# 项目背景\n项目: ${project.name}\n${project.description ? '目标: ' + project.description.slice(0, 500) : ''}\n里程碑: ${milestones.map(m => `${m.name}[${m.status}]`).join(' / ') || '无'}\n项目成员: ${memberUsers.map(u => u.name).join('、') || '无'}\n\n# 会议纪要「${record.title}」\n${record.content.slice(0, 6000)}`,
      maxTokens: 2000
    })
    const items = Array.isArray(result?.requirements) ? result.requirements.slice(0, 20) : []
    const created = []
    for (const it of items) {
      if (!it?.title) continue
      // v2.1.13(#560): 责任人姓名 → 项目成员匹配(全等优先, 其次包含); 匹配不上保留 ownerName 供人工指认
      const ownerRaw = (it.owner || '').toString().trim()
      let ownerId = null
      if (ownerRaw) {
        const hit = memberUsers.find(u => u.name === ownerRaw)
          || memberUsers.find(u => u.name.includes(ownerRaw) || ownerRaw.includes(u.name))
        if (hit) ownerId = BigInt(hit.userId)
      }
      created.push(await prisma.projectRequirement.create({
        data: {
          projectId: project.id, recordId: record.id,
          title: String(it.title).slice(0, 200), detail: it.detail ? String(it.detail) : null,
          priority: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(it.priority) ? it.priority : 'MEDIUM',
          ownerId, ownerName: ownerRaw ? ownerRaw.slice(0, 50) : null,
          createdBy: BigInt(req.user.id)
        }
      }))
    }
    // v2.1.13(#560): 无责任人条数随响应返回, 前端高亮提示逐条指认
    const unowned = created.filter(r => !r.ownerId).length
    recordActivity({ actorId: BigInt(req.user.id), entity: 'record', entityId: record.id, action: 'requirements_extracted', summary: `从「${record.title}」梳理出 ${created.length} 条需求${unowned ? `(${unowned} 条无责任人)` : ''}` })
    res.json({ code: 0, data: { count: created.length, unowned, list: created } })
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) return res.status(400).json({ code: 8001, message: e.message })
    console.error('[project-records requirements/extract]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /:projectId/workflow  交付工作流全链路计数 (v2.0.0 #368)
 * 开会→需求→任务→验收 各环节数量 + 三类卡点(需求确认停滞/任务未指派/生产完成未验收)
 */
const WORKFLOW_STALL_DAYS = 3
router.get('/:projectId/workflow', requirePermission('project.view'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const stallCutoff = new Date(Date.now() - WORKFLOW_STALL_DAYS * 86400e3)
    const [meetingCount, latestMeeting, reqGroups, reqToTask, stalledDraft, taskGroups, unassigned, staleDone] = await Promise.all([
      prisma.projectRecord.count({ where: { projectId: project.id, type: 'MEETING', deletedAt: null } }),
      prisma.projectRecord.findFirst({
        where: { projectId: project.id, type: 'MEETING', deletedAt: null },
        orderBy: { occurredAt: 'desc' }, select: { id: true, title: true, occurredAt: true }
      }),
      prisma.projectRequirement.groupBy({ by: ['status'], where: { projectId: project.id, deletedAt: null }, _count: { _all: true } }),
      prisma.projectRequirement.count({ where: { projectId: project.id, deletedAt: null, taskId: { not: null } } }),
      prisma.projectRequirement.count({ where: { projectId: project.id, deletedAt: null, status: 'DRAFT', createdAt: { lt: stallCutoff } } }),
      // 任务不排除已归档 —— 已验收归档的历史也算「已交付」, 否则归档后流水线清零失真
      prisma.task.groupBy({ by: ['status'], where: { projectId: project.id, deletedAt: null }, _count: { _all: true } }),
      prisma.task.count({ where: { projectId: project.id, deletedAt: null, assigneeId: null, status: { in: ['TODO', 'QUEUED'] } } }),
      prisma.task.count({ where: { projectId: project.id, deletedAt: null, status: 'DONE', completedAt: { lt: stallCutoff } } })
    ])
    const reqBy = Object.fromEntries(reqGroups.map(g => [g.status, g._count._all]))
    const taskBy = Object.fromEntries(taskGroups.map(g => [g.status, g._count._all]))
    res.json({
      code: 0,
      data: {
        stallDays: WORKFLOW_STALL_DAYS,
        meeting: { count: meetingCount, latest: latestMeeting },
        requirement: {
          total: (reqBy.DRAFT || 0) + (reqBy.CONFIRMED || 0) + (reqBy.REJECTED || 0),
          draft: reqBy.DRAFT || 0, confirmed: reqBy.CONFIRMED || 0, rejected: reqBy.REJECTED || 0,
          toTask: reqToTask, stalledDraft
        },
        task: {
          total: Object.values(taskBy).reduce((a, b) => a + b, 0),
          todo: taskBy.TODO || 0, queued: taskBy.QUEUED || 0, inProgress: taskBy.IN_PROGRESS || 0,
          done: taskBy.DONE || 0, verified: taskBy.VERIFIED || 0,
          unassigned, staleDone
        }
      }
    })
  } catch (e) {
    console.error('[project-records GET workflow]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /:projectId/requirements?status=&record_id=  需求清单
 */
router.get('/:projectId/requirements', requirePermission('project.view'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const where = { projectId: project.id, deletedAt: null }
    if (req.query.status) where.status = String(req.query.status)
    if (req.query.record_id) where.recordId = BigInt(req.query.record_id)
    // v2.6.1: 落地筛选 —— 已生成任务/里程碑的需求会混在「已确认」里干扰再次生成, 支持分开看
    // landed=1 已生成(任务或里程碑任一), landed=0 未生成(两者都空)
    const landed = req.query.landed ?? req.query.generated
    if (landed !== undefined && landed !== '') {
      if (['1', 'true', 'yes'].includes(String(landed).toLowerCase())) {
        where.OR = [{ taskId: { not: null } }, { milestoneId: { not: null } }]
      } else {
        where.taskId = null
        where.milestoneId = null
      }
    }
    // v2.0.1(#389): 按生成时间倒序(原状态优先分组导致新需求埋在中间, 难判断优先级)
    const list = await prisma.projectRequirement.findMany({
      where, orderBy: { id: 'desc' },
      include: { record: { select: { id: true, title: true } } }
    })
    // v2.1.13(#560): 带出责任人姓名(owner 已指认) —— ownerName 是 LLM 提示原文, 指认后以 owner 为准
    const ownerIds = [...new Set(list.map(r => r.ownerId).filter(Boolean))]
    const owners = ownerIds.length
      ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
      : []
    const omap = new Map(owners.map(u => [String(u.id), u.name]))
    res.json({
      code: 0,
      data: {
        list: list.map(r => ({
          ...r,
          owner: r.ownerId ? { id: r.ownerId, name: omap.get(String(r.ownerId)) || null } : null
        }))
      }
    })
  } catch (e) {
    console.error('[project-records GET requirements]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * PUT /:projectId/requirements/:id  编辑/确认/驳回
 * body: { title?, detail?, priority?, status? (CONFIRMED|REJECTED|DRAFT) }
 * 确认/驳回记录操作人与时间(#351 的确认流数据底座); 生成任务在 #351
 */
router.put('/:projectId/requirements/:id', requirePermission('projectRecord.create'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const existing = await prisma.projectRequirement.findFirst({
      where: { id: BigInt(req.params.id), projectId: project.id, deletedAt: null }
    })
    if (!existing) return res.status(404).json({ code: 2004, message: '需求不存在' })
    const { title, detail, priority, status } = req.body || {}
    const data = {}
    if (title !== undefined) data.title = String(title).slice(0, 200)
    if (detail !== undefined) data.detail = detail || null
    if (priority !== undefined) {
      if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority)) return res.status(400).json({ code: 1002, message: '无效优先级' })
      data.priority = priority
    }
    // v2.1.13(#560): 责任人指认/更换/清除(传 null 或空串清除); 责任人必须是在职项目成员
    if (req.body.ownerId !== undefined) {
      if (req.body.ownerId) {
        const memberUsers = await listMemberUsers(project.id)
        const hit = memberUsers.find(u => String(u.userId) === String(req.body.ownerId))
        if (!hit) return res.status(400).json({ code: 1002, message: '责任人必须是该项目的在职成员' })
        data.ownerId = BigInt(req.body.ownerId)
      } else {
        data.ownerId = null
      }
    }
    // v2.1.13(#560): 关联已有 FDE 任务(纪要→任务链路); 传 null 解除关联
    if (req.body.linkTaskId !== undefined) {
      if (req.body.linkTaskId) {
        const task = await prisma.task.findFirst({
          where: { id: BigInt(req.body.linkTaskId), projectId: project.id, deletedAt: null }, select: { id: true }
        })
        if (!task) return res.status(400).json({ code: 1002, message: '任务不存在或不属于该项目' })
        data.taskId = task.id
      } else {
        data.taskId = null
      }
    }
    if (status !== undefined) {
      if (!['DRAFT', 'CONFIRMED', 'REJECTED'].includes(status)) return res.status(400).json({ code: 1002, message: '无效状态' })
      // v2.1.13(#560) 确认闸门: 待办无责任人不可确认(必填落在决策点, 草稿期允许为空由前端高亮)
      if (status === 'CONFIRMED') {
        const effectiveOwner = data.ownerId !== undefined ? data.ownerId : existing.ownerId
        if (!effectiveOwner) return res.status(400).json({ code: 1006, message: `待办「${existing.title.slice(0, 30)}」未指定责任人, 请先指认再确认` })
      }
      data.status = status
      data.confirmedBy = status === 'DRAFT' ? null : BigInt(req.user.id)
      data.confirmedAt = status === 'DRAFT' ? null : new Date()
    }
    const updated = await prisma.projectRequirement.update({ where: { id: existing.id }, data })
    res.json({ code: 0, data: updated })
  } catch (e) {
    console.error('[project-records PUT requirements/:id]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /:projectId/requirements/:id/to-task { milestoneId? }
 * v1.9.9(#351): 已确认需求一键生成任务(进看板收件箱), 双向留痕
 */
router.post('/:projectId/requirements/:id/to-task', requirePermission('task.create'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const reqm = await prisma.projectRequirement.findFirst({
      where: { id: BigInt(req.params.id), projectId: project.id, deletedAt: null },
      include: { record: { select: { title: true } } }
    })
    if (!reqm) return res.status(404).json({ code: 2004, message: '需求不存在' })
    if (reqm.status !== 'CONFIRMED') return res.status(400).json({ code: 1002, message: '仅已确认的需求可生成任务' })
    if (reqm.taskId) return res.status(400).json({ code: 1002, message: '该需求已生成过任务' })
    let milestoneId = null
    if (req.body?.milestoneId) {
      const ms = await prisma.milestone.findFirst({ where: { id: BigInt(req.body.milestoneId), projectId: project.id, deletedAt: null } })
      if (!ms) return res.status(400).json({ code: 1002, message: '里程碑不属于该项目' })
      milestoneId = ms.id
    }
    // v2.0.7(#420): 生成时直接指派负责人 —— 与任务创建同款双轨: assigneeId(工程师档案) 或
    // assigneeUserId(无档案成员如经理/销售, 自动补建档案)
    // v2.1.13(#560): 未显式指派时默认落到待办责任人(ownerId, userId 懒建档) —— 纪要责任人一路带到任务
    let assigneeId = null
    const assigneeUserId = req.body?.assigneeUserId || (!req.body?.assigneeId && reqm.ownerId ? reqm.ownerId : null)
    if (req.body?.assigneeId) assigneeId = BigInt(req.body.assigneeId)
    else if (assigneeUserId) {
      let eng = await prisma.engineer.findUnique({ where: { userId: BigInt(assigneeUserId) } })
      // 责任人账号可能已被删除: 不再懒建档案, 任务先不指派
      if (!eng && await prisma.user.findFirst({ where: { id: BigInt(assigneeUserId), deletedAt: null }, select: { id: true } })) {
        eng = await prisma.engineer.create({ data: { userId: BigInt(assigneeUserId) } })
      }
      assigneeId = eng?.id ?? null
    }
    const task = await prisma.task.create({
      data: {
        projectId: project.id, milestoneId, assigneeId,
        title: reqm.title, priority: reqm.priority, status: 'TODO',
        description: `${reqm.detail || ''}\n\n—— 来源: 会议记录「${reqm.record?.title || '手工录入'}」· 需求 #${reqm.id}(已确认)`
      }
    })
    await prisma.projectRequirement.update({ where: { id: reqm.id }, data: { taskId: task.id } })
    recordActivity({ actorId: BigInt(req.user.id), entity: 'task', entityId: task.id, action: 'created', summary: `需求「${reqm.title}」生成任务` })
    res.json({ code: 0, data: { task } })
  } catch (e) {
    console.error('[requirements to-task]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /:projectId/requirements/:id/to-milestone { plannedDate? }
 * v1.9.9(#351): 已确认需求生成里程碑(大颗粒需求直接立里程碑)
 */
router.post('/:projectId/requirements/:id/to-milestone', requirePermission('milestone.manage'), async (req, res) => {
  try {
    const project = await findScopedProject(req.user, req.params.projectId)
    if (!project) return res.status(404).json({ code: 2004, message: '项目不存在或无权访问' })
    const reqm = await prisma.projectRequirement.findFirst({
      where: { id: BigInt(req.params.id), projectId: project.id, deletedAt: null },
      include: { record: { select: { title: true } } }
    })
    if (!reqm) return res.status(404).json({ code: 2004, message: '需求不存在' })
    if (reqm.status !== 'CONFIRMED') return res.status(400).json({ code: 1002, message: '仅已确认的需求可生成里程碑' })
    if (reqm.milestoneId) return res.status(400).json({ code: 1002, message: '该需求已生成过里程碑' })
    const maxOrder = await prisma.milestone.aggregate({ where: { projectId: project.id, deletedAt: null }, _max: { sortOrder: true } })
    const ms = await prisma.milestone.create({
      data: {
        projectId: project.id, name: reqm.title.slice(0, 200),
        description: `${reqm.detail || ''}\n—— 来源: 会议记录「${reqm.record?.title || '手工录入'}」· 需求 #${reqm.id}`,
        plannedDate: req.body?.plannedDate ? new Date(req.body.plannedDate) : null,
        status: 'PENDING', sortOrder: (maxOrder._max.sortOrder || 0) + 1
      }
    })
    await prisma.projectRequirement.update({ where: { id: reqm.id }, data: { milestoneId: ms.id } })
    recordActivity({ actorId: BigInt(req.user.id), entity: 'milestone', entityId: ms.id, action: 'created', summary: `需求「${reqm.title}」生成里程碑` })
    res.json({ code: 0, data: { milestone: ms } })
  } catch (e) {
    console.error('[requirements to-milestone]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
