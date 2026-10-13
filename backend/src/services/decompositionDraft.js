import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { chatJSON, chatComplete } from '../lib/llm.js'
import { recordActivity } from '../lib/activity.js'
import { loadProjectRoadmap, findCycle, DONE_STATUSES } from './roadmap.js'

const role = z.enum(['PM', 'ARCHITECT', 'DEV', 'QA', 'FDE'])
const level = z.enum(['L1_API', 'L2_UI', 'L3_STATIC'])
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
const ac = z.object({ acNo: z.string().trim().min(1).max(30), text: z.string().trim().min(1).max(5000), level }).strict()
const task = z.object({
  title: z.string().trim().min(1).max(200), role,
  // v2.8.0(#1145) 路径图 AI 面板: 可选描述/优先级/预估天数, 应用落库时带过去
  description: z.string().trim().max(5000).optional(),
  priority: priority.optional(),
  estimateDays: z.coerce.number().min(0.5).max(60).optional(),
  // v2.8.5(#1161) 验收下线: AC 改为可选
  acceptanceCriteria: z.array(ac).max(20).default([]), dependencies: z.array(z.string().trim().min(1).max(200)).max(20).default([])
}).strict()
export const decompositionDraftSchema = z.object({
  summary: z.string().trim().min(1).max(2000), openQuestions: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  milestones: z.array(z.object({ name: z.string().trim().min(1).max(200), goal: z.string().trim().max(2000).optional(), tasks: z.array(task).min(1).max(100) }).strict()).min(1).max(7)
}).strict()

export const decompositionRequestSchema = z.object({
  requirement: z.string().trim().min(20, '需求文本至少20个字符').max(30000, '需求文本不能超过30000个字符')
}).strict()

export const DECOMPOSITION_SYSTEM_PROMPT = `你是 FDE 需求拆解助手。只输出 JSON，不要 Markdown 或解释文字。
把客户原话/PRD/迭代目标拆成可执行的里程碑和任务树（一张路径图）：每个任务应是单人1-3天可完成的交付单元，标注角色(PM/ARCHITECT/DEV/QA/FDE)，可附 1-3 条可验证的完成标准(acceptanceCriteria, 可选)，依赖只能引用其他任务的完整标题，且依赖关系不得成环。
路径图要体现前后逻辑：能并行的分叉出去，最后汇聚到收尾任务；可选给 description(一句话做法)、priority、estimateDays(预估天数)。每个里程碑可给 goal(一句话完成定义)。
不确定的信息放入 openQuestions，不要臆造客户承诺、金额、工期或负责人。这是待人工审核的草案，不得创建任务。
输出结构（字段名与枚举值必须严格一致，英文大写枚举）：
{"summary":"一句话概括","openQuestions":["待澄清点"],"milestones":[{"name":"里程碑名","goal":"一句话完成定义","tasks":[{"title":"任务标题(唯一)","role":"DEV","description":"一句话做法","priority":"MEDIUM","estimateDays":2,"acceptanceCriteria":[{"acNo":"AC-1","text":"可验证的验收标准","level":"L1_API"}],"dependencies":["前置任务的完整标题"]}]}]}
role ∈ PM/ARCHITECT/DEV/QA/FDE；priority ∈ LOW/MEDIUM/HIGH/URGENT；level ∈ L1_API(接口可测)/L2_UI(界面可测)/L3_STATIC(静态检查)；acceptanceCriteria 可为空数组, 给的话必须是对象数组不能是字符串。`

/**
 * v2.8.0(#1145) 项目上下文: 已有里程碑与任务标题, 让 AI 别重复拆已有的任务、能接上已有的路径
 * @returns {{ text: string, targetMilestone: object|null }}
 */
export async function buildProjectContext(projectId, milestoneId) {
  if (!projectId) return { text: '', targetMilestone: null }
  const [project, milestones, tasks] = await Promise.all([
    prisma.project.findFirst({ where: { id: BigInt(projectId), deletedAt: null }, select: { name: true, type: true, description: true } }),
    prisma.milestone.findMany({ where: { projectId: BigInt(projectId), deletedAt: null }, orderBy: [{ sortOrder: 'asc' }], select: { id: true, name: true, status: true, goal: true } }),
    prisma.task.findMany({ where: { projectId: BigInt(projectId), deletedAt: null, archivedAt: null }, select: { id: true, title: true, status: true, milestoneId: true }, orderBy: { id: 'asc' }, take: 200 })
  ])
  if (!project) return { text: '', targetMilestone: null }
  const target = milestoneId ? milestones.find(m => String(m.id) === String(milestoneId)) || null : null
  const lines = [`项目：${project.name}${project.type ? `（${project.type}）` : ''}`]
  if (project.description) lines.push(`项目说明：${project.description.slice(0, 500)}`)
  if (milestones.length) lines.push('已有里程碑：' + milestones.map(m => `${m.name}[${m.status}]`).join('、'))
  if (target) {
    lines.push(`本次目标里程碑：「${target.name}」${target.goal ? `，完成定义：${target.goal}` : ''}。请把任务全部拆到这一个里程碑下（milestones 只给这一项，name 必须原样用「${target.name}」）。`)
    const inMs = tasks.filter(t => String(t.milestoneId) === String(target.id))
    if (inMs.length) lines.push('该里程碑已有任务（不要重复拆，可以在 dependencies 里引用它们的完整标题作为前置）：\n' + inMs.map(t => `- #${t.id} ${t.title} [${t.status}]`).join('\n'))
  } else if (tasks.length) {
    lines.push('项目已有任务（不要重复拆）：\n' + tasks.slice(0, 60).map(t => `- #${t.id} ${t.title} [${t.status}]`).join('\n'))
  }
  return { text: lines.join('\n'), targetMilestone: target }
}

export async function generateDecompositionDraft(requirement, { llm = chatJSON, context = '' } = {}) {
  const input = decompositionRequestSchema.parse({ requirement })
  const draft = await llm({
    system: DECOMPOSITION_SYSTEM_PROMPT,
    user: `${context ? `【项目上下文】\n${context}\n\n` : ''}请拆解以下需求，并严格返回 summary、openQuestions、milestones 字段的 JSON：\n\n${input.requirement}`,
    maxTokens: 12000
  })
  return { ...validateDecompositionDraft(normalizeDraft(draft), { knownTitles: extractKnownTitles(context) }), reviewRequired: true }
}

const PRIORITY_ALIAS = { 低: 'LOW', 中: 'MEDIUM', 高: 'HIGH', 紧急: 'URGENT', P0: 'URGENT', P1: 'HIGH', P2: 'MEDIUM', P3: 'LOW', LOW: 'LOW', MEDIUM: 'MEDIUM', MED: 'MEDIUM', NORMAL: 'MEDIUM', HIGH: 'HIGH', URGENT: 'URGENT', CRITICAL: 'URGENT' }
const ROLE_ALIAS = { PM: 'PM', 产品: 'PM', 项目经理: 'PM', ARCHITECT: 'ARCHITECT', ARCH: 'ARCHITECT', 架构: 'ARCHITECT', 架构师: 'ARCHITECT', DEV: 'DEV', 开发: 'DEV', 研发: 'DEV', 后端: 'DEV', 前端: 'DEV', QA: 'QA', 测试: 'QA', FDE: 'FDE', 交付: 'FDE', 实施: 'FDE' }
const LEVEL_ALIAS = { L1: 'L1_API', L1_API: 'L1_API', API: 'L1_API', 接口: 'L1_API', L2: 'L2_UI', L2_UI: 'L2_UI', UI: 'L2_UI', 界面: 'L2_UI', L3: 'L3_STATIC', L3_STATIC: 'L3_STATIC', STATIC: 'L3_STATIC', 静态: 'L3_STATIC' }
/**
 * v2.8.0(#1145) 模型输出容错: 大模型常把枚举写成中文/小写、把 AC 写成字符串、漏 dependencies ——
 * 这些"形状上的小错"在校验前归一化, 语义错误(依赖不存在/成环)仍由 validate 拒绝
 */
export function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return raw
  const up = (v) => String(v ?? '').trim().toUpperCase()
  const d = { summary: String(raw.summary ?? raw.title ?? '').trim() || '（无摘要）', openQuestions: [], milestones: [] }
  const oq = raw.openQuestions ?? raw.open_questions ?? raw.questions ?? []
  d.openQuestions = (Array.isArray(oq) ? oq : [oq]).map(q => typeof q === 'string' ? q : q?.text || q?.question || JSON.stringify(q)).map(q => String(q).trim()).filter(Boolean)
  let ms = raw.milestones ?? (Array.isArray(raw.tasks) ? [{ name: raw.milestone || raw.summary || '路径图', tasks: raw.tasks }] : [])
  if (!Array.isArray(ms)) ms = [ms]
  d.milestones = ms.map(m => ({
    name: String(m?.name ?? m?.title ?? '里程碑').trim(),
    ...(m?.goal ? { goal: String(m.goal).trim() } : {}),
    tasks: (Array.isArray(m?.tasks) ? m.tasks : []).map((t, i) => {
      let acs = t?.acceptanceCriteria ?? t?.acceptance_criteria ?? t?.ac ?? t?.acceptance ?? []
      if (typeof acs === 'string') acs = [acs]
      if (!Array.isArray(acs)) acs = [acs]
      const acceptanceCriteria = acs.map((a, j) => {
        if (typeof a === 'string') return { acNo: `AC-${j + 1}`, text: a.trim(), level: 'L1_API' }
        return { acNo: String(a?.acNo ?? a?.no ?? a?.id ?? `AC-${j + 1}`).trim() || `AC-${j + 1}`, text: String(a?.text ?? a?.description ?? a?.content ?? '').trim(), level: LEVEL_ALIAS[up(a?.level)] || 'L1_API' }
      }).filter(a => a.text)
      let deps = t?.dependencies ?? t?.dependsOn ?? t?.depends_on ?? t?.deps ?? []
      if (typeof deps === 'string') deps = deps.split(/[,，;；、]/)
      if (!Array.isArray(deps)) deps = []
      const out = {
        title: String(t?.title ?? t?.name ?? `任务${i + 1}`).trim(),
        role: ROLE_ALIAS[up(t?.role)] || ROLE_ALIAS[String(t?.role ?? '').trim()] || 'DEV',
        acceptanceCriteria,
        dependencies: deps.map(x => typeof x === 'string' ? x : x?.title || x?.name || '').map(x => String(x).trim()).filter(Boolean)
      }
      if (t?.description) out.description = String(t.description).trim()
      const pr = PRIORITY_ALIAS[up(t?.priority)] || PRIORITY_ALIAS[String(t?.priority ?? '').trim()]
      if (pr) out.priority = pr
      const days = Number(t?.estimateDays ?? t?.estimate_days ?? t?.days ?? t?.estimate)
      if (Number.isFinite(days) && days > 0) out.estimateDays = Math.min(60, Math.max(0.5, days))
      return out
    })
  })).filter(m => m.tasks.length)
  return d
}

/** 上下文里列出的已有任务标题(允许草案依赖它们) */
function extractKnownTitles(context) {
  const set = new Set()
  for (const m of String(context || '').matchAll(/^- #(\d+) (.+?) \[[A-Z_]+\]$/gm)) set.add(m[2].trim())
  return set
}

/**
 * 校验草案: 字段白名单 / 标题唯一 / 依赖存在(草案内或 knownTitles 已有任务) / 无环
 * @param {object} input
 * @param {{ knownTitles?: Set<string> }} [opts]
 */
export function validateDecompositionDraft(input, { knownTitles = new Set() } = {}) {
  const parsed = decompositionDraftSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`草案结构不合法: ${first.path.join('.')} ${first.message}${parsed.error.issues.length > 1 ? `（共 ${parsed.error.issues.length} 处）` : ''}`)
  }
  const draft = parsed.data
  const titles = draft.milestones.flatMap(m => m.tasks.map(t => t.title))
  const names = new Set(titles)
  if (names.size !== titles.length) throw new Error('任务标题必须唯一，依赖关系需要用唯一标题引用任务')
  const edges = new Map(draft.milestones.flatMap(m => m.tasks.map(t => [t.title, t.dependencies])))
  for (const [title, deps] of edges) for (const dep of deps) if (!names.has(dep) && !knownTitles.has(dep)) throw new Error(`依赖任务不存在: ${title} -> ${dep}`)
  const visiting = new Set(); const visited = new Set()
  function visit(n) { if (visiting.has(n)) throw new Error(`依赖关系存在循环: ${n}`); if (visited.has(n)) return; visiting.add(n); for (const d of edges.get(n) || []) if (names.has(d)) visit(d); visiting.delete(n); visited.add(n) }
  for (const n of names) visit(n)
  return { ...draft, taskCount: titles.length }
}

/**
 * v2.8.0(#1145) 草案落库: 一个事务里建里程碑(可选)/任务(source=AI)/依赖边, 写项目记录留痕
 * - 传 milestoneId: 草案里所有任务都挂到这个里程碑(忽略草案里程碑名)
 * - 不传: 按名字匹配已有里程碑(忽略大小写/空白), 没有就新建(单里程碑草案时 goal 取草案 goal 或 summary)
 * - 依赖引用草案外的标题时, 在项目已有任务里按标题找(找不到就跳过并记入 skippedDependencies)
 */
export async function applyDecompositionDraft({ projectId, milestoneId = null, draft: rawDraft, userId, agentProfileId = null, tx = null }) {
  const pid = BigInt(projectId)
  const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null }, select: { id: true, name: true } })
  if (!project) { const e = new Error('项目不存在'); e.code = 2004; throw e }
  const existingTasks = await prisma.task.findMany({ where: { projectId: pid, deletedAt: null, archivedAt: null }, select: { id: true, title: true } })
  const knownTitles = new Set(existingTasks.map(t => t.title))
  const draft = validateDecompositionDraft(rawDraft, { knownTitles })
  let target = null
  if (milestoneId) {
    target = await prisma.milestone.findFirst({ where: { id: BigInt(milestoneId), projectId: pid, deletedAt: null } })
    if (!target) { const e = new Error('里程碑不存在或不属于该项目'); e.code = 2004; throw e }
  }
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '')
  const existingMs = await prisma.milestone.findMany({ where: { projectId: pid, deletedAt: null }, select: { id: true, name: true, sortOrder: true } })
  const run = async (db) => {
    const createdMilestones = [], createdTasks = [], skipped = []
    const titleToId = new Map(existingTasks.map(t => [t.title, t.id]))
    let maxOrder = existingMs.reduce((m, x) => Math.max(m, x.sortOrder || 0), 0)
    for (const dm of draft.milestones) {
      let ms = target
      if (!ms) {
        const hit = existingMs.find(m => norm(m.name) === norm(dm.name))
        if (hit) ms = hit
        else {
          ms = await db.milestone.create({ data: { projectId: pid, name: dm.name, goal: dm.goal || (draft.milestones.length === 1 ? draft.summary : null), status: 'PENDING', sortOrder: ++maxOrder } })
          createdMilestones.push({ id: String(ms.id), name: ms.name })
        }
      }
      for (const t of dm.tasks) {
        const desc = [t.description, `角色：${t.role}`, t.estimateDays ? `预估：${t.estimateDays} 天` : null].filter(Boolean).join('\n')
        const created = await db.task.create({
          data: {
            projectId: pid, milestoneId: ms.id, title: t.title, description: desc || null,
            status: 'TODO', priority: t.priority || 'MEDIUM', source: 'AI', createdBy: BigInt(userId),
            acceptanceCriteria: t.acceptanceCriteria.length ? t.acceptanceCriteria : undefined
          }
        })
        titleToId.set(t.title, created.id)
        createdTasks.push({ id: String(created.id), title: created.title, milestoneId: String(ms.id), dependencies: t.dependencies })
      }
    }
    let edgeCount = 0
    for (const ct of createdTasks) {
      for (const dep of ct.dependencies) {
        const predId = titleToId.get(dep)
        if (!predId) { skipped.push(`${ct.title} -> ${dep}`); continue }
        await db.taskDependency.create({ data: { predecessorId: predId, successorId: BigInt(ct.id), type: 'BLOCKS', createdBy: BigInt(userId) } })
        edgeCount++
      }
    }
    await db.projectRecord.create({
      data: {
        projectId: pid, type: 'OTHER', title: `AI 路径图草案已应用：${draft.summary.slice(0, 120)}`,
        content: [
          `**摘要**：${draft.summary}`, '',
          `**落库**：任务 ${createdTasks.length} 个、依赖 ${edgeCount} 条${createdMilestones.length ? `、新建里程碑 ${createdMilestones.map(m => m.name).join('、')}` : ''}${target ? `、目标里程碑「${target.name}」` : ''}`, '',
          ...draft.milestones.flatMap(m => [`### ${m.name}`, ...m.tasks.map(t => `- ${t.title}（${t.role}）${t.dependencies.length ? ` ← ${t.dependencies.join('、')}` : ''}`), '']),
          ...(draft.openQuestions.length ? ['**待澄清**：', ...draft.openQuestions.map(q => `- ${q}`)] : []),
          ...(skipped.length ? ['', `**未能建立的依赖**（前置标题在项目里找不到）：`, ...skipped.map(s => `- ${s}`)] : [])
        ].join('\n'),
        occurredAt: new Date(), createdBy: BigInt(userId), createdByAgentId: agentProfileId ? BigInt(agentProfileId) : null
      }
    })
    return { milestones: createdMilestones, tasks: createdTasks.map(({ dependencies, ...t }) => t), edgeCount, skippedDependencies: skipped, targetMilestoneId: target ? String(target.id) : null }
  }
  const result = tx ? await run(tx) : await prisma.$transaction(run, { timeout: 30000 })
  recordActivity({ actorId: userId, entity: 'project', entityId: pid, action: 'roadmap_ai_applied', summary: `AI 路径图草案落库：${result.tasks.length} 个任务、${result.edgeCount} 条依赖`, data: { taskIds: result.tasks.map(t => t.id) } })
  return result
}

// ===================== 补依赖 / 解释路径 =====================

const SUGGEST_SYSTEM = `你是项目排期助手。只输出 JSON。给定一个里程碑下的任务清单（含编号、标题、状态、已有依赖），提议还缺的"先做→后做"硬依赖关系。
规则：只在确有先后逻辑(接口先于联调、设计先于开发、开发先于测试/上线)时提议；不要为并行任务硬造顺序；不要重复已有依赖；不要与已有依赖方向冲突；每条给一句理由。
输出 {"suggestions":[{"predecessorId":"前置任务编号","successorId":"后继任务编号","reason":"一句理由"}]}，最多 15 条，可以为空数组。`

export async function suggestDependencies({ projectId, milestoneId, llm = chatJSON }) {
  const rm = await loadProjectRoadmap(projectId, { milestoneId })
  if (!rm) { const e = new Error('里程碑不存在'); e.code = 2004; throw e }
  const nodes = rm.nodes.filter(n => !n.external)
  if (nodes.length < 2) return { suggestions: [], reason: '任务不足两个，无需补依赖' }
  const list = nodes.map(n => `#${n.id} ${n.title} [${n.status}]${n.predecessors.length ? ` 前置:${n.predecessors.map(p => '#' + p).join(',')}` : ''}`).join('\n')
  const out = await llm({ system: SUGGEST_SYSTEM, user: `里程碑：${rm.milestone?.name || '（整个项目）'}${rm.milestone?.goal ? `，完成定义：${rm.milestone.goal}` : ''}\n任务清单：\n${list}`, maxTokens: 4000 })
  const raw = Array.isArray(out?.suggestions) ? out.suggestions : []
  const ids = new Set(nodes.map(n => n.id))
  const existing = rm.edges.map(e => ({ predecessorId: e.source, successorId: e.target, type: e.type }))
  const have = new Set(rm.edges.map(e => `${e.source}>${e.target}`))
  const accepted = [], rejected = []
  for (const s of raw.slice(0, 15)) {
    const a = String(s.predecessorId || '').replace(/^#/, ''), b = String(s.successorId || '').replace(/^#/, '')
    const item = { predecessorId: a, successorId: b, reason: String(s.reason || '').slice(0, 200) }
    if (!ids.has(a) || !ids.has(b) || a === b) { rejected.push({ ...item, why: '编号不在本里程碑内' }); continue }
    if (have.has(`${a}>${b}`)) { rejected.push({ ...item, why: '已存在' }); continue }
    if (findCycle(existing, a, b)) { rejected.push({ ...item, why: '会成环' }); continue }
    existing.push({ predecessorId: a, successorId: b, type: 'BLOCKS' }); have.add(`${a}>${b}`)
    const na = nodes.find(n => n.id === a), nb = nodes.find(n => n.id === b)
    accepted.push({ ...item, predecessorTitle: na.title, successorTitle: nb.title })
  }
  return { suggestions: accepted, rejected }
}

const EXPLAIN_SYSTEM = `你是项目经理的排期参谋。用大白话中文、不超过 250 字、分 3 段短句回答：①现在能开工的是哪几个（按优先级）；②谁挡着谁、瓶颈在哪；③离里程碑终点还差几步、建议今天先做什么。只依据给定数据，不编造。不要 Markdown 标题。`

export async function explainRoadmap({ projectId, milestoneId, llm = chatComplete }) {
  const rm = await loadProjectRoadmap(projectId, { milestoneId })
  if (!rm) { const e = new Error('里程碑不存在'); e.code = 2004; throw e }
  const nodes = rm.nodes.filter(n => !n.external)
  if (!nodes.length) return { text: '这个里程碑还没有任务，先拆任务再来看路径。', stats: rm.stats }
  const facts = nodes.map(n => `#${n.id} ${n.title} | ${n.status} | 优先级${n.priority}${n.assignee ? ` | ${n.assignee.name}` : ' | 未指派'}${n.blocked ? ` | 阻塞于 ${n.blockedBy.map(x => '#' + x).join(',')}` : n.ready ? ' | 可开始' : ''}${n.dueDate ? ` | 截止 ${String(n.dueDate).slice(0, 10)}` : ''}`).join('\n')
  const text = await llm({
    system: EXPLAIN_SYSTEM,
    user: `里程碑：${rm.milestone?.name || '整个项目'}${rm.milestone?.goal ? `（完成定义：${rm.milestone.goal}）` : ''}\n统计：共 ${rm.stats.total}，完成 ${rm.stats.done}，进行中 ${rm.stats.inProgress}，可开始 ${rm.stats.ready}，阻塞 ${rm.stats.blocked}；关键路径 ${rm.criticalPath.taskIds.map(x => '#' + x).join('→') || '无'}，约 ${rm.criticalPath.totalDays} 天\n任务：\n${facts}\n\nMermaid：\n${rm.mermaid}`,
    maxTokens: 1200
  })
  return { text: String(text || '').trim(), stats: rm.stats, criticalPath: rm.criticalPath }
}

export { DONE_STATUSES }
