// AI 助手的「草稿」: 把模型给的参数校验、解析成可以直接交给正常业务接口的 payload。这里只读不写:
// 项目 / 负责人 / 任务按名字在「当前用户看得到的范围」里解析(经自己的接口查), 认不出的字段不猜, 记进 missing 让模型反问、让人在卡片上补。
// 落库只发生在人点「确认」之后(routes/fde/assistant.js → submitDraft), 走的是和页面按钮同一条接口
import prisma from '../../lib/prisma.js'
import { findMentions } from '../../lib/mentions.js'
import { parseDate } from './dates.js'

export const DRAFT_KINDS = ['task', 'requirement', 'timesheet', 'comment']
export const KIND_LABEL = { task: '任务', requirement: '需求', timesheet: '工时', comment: '评论' }
/** 生成 / 确认某类草稿需要的权限点(与对应业务接口一致); null = 登录即可 */
export const KIND_PERM = { task: 'task.create', requirement: 'projectRecord.create', timesheet: 'timesheet.create', comment: null }

/** 各类草稿可编辑字段(白名单)与必填字段 */
export const FIELDS = {
  task: { keys: ['projectId', 'title', 'description', 'assigneeUserId', 'dueDate', 'priority'], required: ['projectId', 'title'] },
  requirement: { keys: ['projectId', 'title', 'detail', 'priority', 'ownerId'], required: ['projectId', 'title'] },
  timesheet: { keys: ['projectId', 'workDate', 'hours', 'workContent', 'taskId'], required: ['projectId', 'workDate', 'hours', 'workContent'] },
  comment: { keys: ['entity', 'entityId', 'content'], required: ['entity', 'entityId', 'content'] }
}
export const FIELD_LABEL = {
  projectId: '项目', title: '标题', description: '描述', assigneeUserId: '负责人', dueDate: '截止日期', priority: '优先级',
  detail: '详情', ownerId: '责任人', workDate: '日期', hours: '小时', workContent: '工作内容', taskId: '关联任务',
  entity: '评论对象', entityId: '评论对象', content: '内容'
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const PRIORITY_WORDS = [[/紧急|加急|urgent|最高|马上|立刻/i, 'URGENT'], [/高|重要|high/i, 'HIGH'], [/低|不急|low/i, 'LOW'], [/中|普通|一般|medium|normal/i, 'MEDIUM']]
const ME = /^(我|我自己|自己|本人|me|myself)$/i
const ID_RE = /^[1-9]\d{0,17}$/

const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max))
const isId = (v) => ID_RE.test(String(v ?? ''))

export function parsePriority(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (PRIORITIES.includes(s.toUpperCase())) return s.toUpperCase()
  for (const [re, p] of PRIORITY_WORDS) if (re.test(s)) return p
  return null
}

/** 「半天」「一天」「2小时」「1.5h」「90分钟」→ 小时数(0.25 步进, 0 < h ≤ 24); 认不出 null */
export function parseHours(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v > 0 && v <= 24 ? Math.round(v * 4) / 4 : null
  const s = String(v).trim()
  if (/^半天$/.test(s)) return 4
  if (/^(一|1)\s*天$|^全天$/.test(s)) return 8
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(分钟|min|m)$/i)
  if (m) return parseHours(Number(m[1]) / 60)
  m = s.match(/^(\d+(?:\.\d+)?)\s*(小时|个小时|h|hr|hrs|hours?)?$/i)
  if (m) return parseHours(Number(m[1]))
  const cn = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 }
  m = s.match(/^([一两二三四五六七八])(个半)?\s*(个)?小时$/)
  if (m) return cn[m[1]] + (m[2] ? 0.5 : 0)
  return null
}

const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/(项目|工程|系统)$/, '')

/** 名字匹配, 分三档取第一档有结果的: 全等 > 名字包含说法(「导轨」→「电梯导轨精度检测系统」) > 说法包含名字; 返回命中列表(可能多个) */
export function matchByName(list, ref, nameOf = (x) => x.name, extra = () => []) {
  const q = normName(ref)
  if (!q) return []
  const keys = (x) => [nameOf(x), ...extra(x)].map(normName).filter(Boolean)
  for (const hit of [(k) => k === q, (k) => k.includes(q), (k) => k.length >= 2 && q.includes(k)]) {
    const found = list.filter((x) => keys(x).some(hit))
    if (found.length) return found
  }
  return []
}

// ---------- 当前用户范围内的数据(经自己的接口查, 结果在一次对话内缓存) ----------

export function makeLookup(api, user) {
  const cache = new Map()
  const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key) }
  return {
    user,
    /** 我看得到的项目(进行中 + 已验收前的) */
    projects: () => once('projects', async () => {
      const r = await api('GET', '/api/fde/projects', { query: { page_size: 100 } })
      return r.code === 0 ? r.data.list.map((p) => ({ id: String(p.id), name: p.name, code: p.code, status: p.status })) : []
    }),
    /** 项目详情(无权访问返回 null) */
    project: (id) => once(`project:${id}`, async () => {
      const r = await api('GET', `/api/fde/projects/${id}`)
      return r.code === 0 ? r.data : null
    }),
    /** 项目在职成员 [{ userId, name }] */
    members: (id) => once(`members:${id}`, async () => {
      const r = await api('GET', `/api/fde/projects/${id}`)
      if (r.code !== 0) return []
      const out = []
      for (const m of r.data.members || []) {
        if (m.leaveDate) continue
        const u = m.user || m.engineer?.user
        if (u && !out.some((x) => x.userId === String(u.id))) out.push({ userId: String(u.id), name: u.name })
      }
      return out
    }),
    me: () => once('me', async () => {
      const u = await prisma.user.findUnique({ where: { id: BigInt(user.userId ?? user.id) }, select: { id: true, name: true } })
      return { userId: String(u.id), name: u.name }
    })
  }
}

/** 项目引用(id / 编号 / 名称) → { project } | { candidates } | { notFound } */
export async function resolveProject(lookup, ref) {
  const list = await lookup.projects()
  const s = str(ref, 200)
  if (!s) return {}
  if (isId(s)) {
    const hit = list.find((p) => p.id === s)
    if (hit) return { project: hit }
    // 列表默认不含已验收的项目: 按 id 再查一次详情(仍走数据范围)
    const p = await lookup.project(s)
    if (p) return { project: { id: String(p.id), name: p.name, code: p.code, status: p.status } }
  }
  const hits = matchByName(list, s, (p) => p.name, (p) => [p.code])
  if (hits.length === 1) return { project: hits[0] }
  if (hits.length > 1) return { candidates: hits.slice(0, 8) }
  return { notFound: s }
}

/** 人(「我」/ 姓名 / userId) → 项目成员里的 { userId, name } */
async function resolvePerson(lookup, projectId, ref) {
  const s = str(ref, 50)
  if (!s || ME.test(s)) return { person: await lookup.me() }
  const members = projectId ? await lookup.members(projectId) : []
  if (isId(s)) {
    const hit = members.find((m) => m.userId === s)
    if (hit) return { person: hit }
  }
  const hits = matchByName(members, s.replace(/^@/, ''))
  if (hits.length === 1) return { person: hits[0] }
  if (hits.length > 1) return { candidates: hits }
  return { notFound: s }
}

/** 任务引用(id / 标题关键字) → 我看得到的任务; projectId 给了就限在该项目 */
async function resolveTask(api, ref, projectId) {
  const s = str(ref, 200)
  if (!s) return {}
  if (isId(s)) {
    const r = await api('GET', `/api/fde/tasks/${s}`)
    if (r.code === 0 && (!projectId || String(r.data.projectId) === String(projectId))) {
      return { task: { id: String(r.data.id), title: r.data.title, projectId: String(r.data.projectId), projectName: r.data.project?.name } }
    }
  }
  const r = await api('GET', '/api/fde/tasks', { query: { keyword: s.replace(/^#/, ''), projectId, page_size: 10 } })
  const list = r.code === 0 ? r.data.list : []
  if (list.length === 1) return { task: { id: String(list[0].id), title: list[0].title, projectId: String(list[0].projectId), projectName: list[0].project?.name } }
  if (list.length > 1) return { candidates: list.slice(0, 8).map((t) => ({ id: String(t.id), title: t.title, projectName: t.project?.name })) }
  return { notFound: s }
}

/** 评论里 @ 到的人: 在职用户里按姓名 / 用户名认 */
export async function mentionsOf(content) {
  if (!String(content || '').includes('@')) return []
  const users = await prisma.user.findMany({ where: { deletedAt: null, status: 1 }, select: { id: true, name: true, username: true } })
  return findMentions(content, users).map((u) => ({ userId: String(u.id), name: u.name }))
}

/**
 * 模型给的参数 → 草稿 { kind, payload, labels, missing, warnings }
 * labels: { names: { 字段: 显示名 }, options: { projects, members }, mentions }(卡片上显示与下拉选项用)
 */
export async function buildDraft(kind, args = {}, { api, lookup, today = new Date() }) {
  const payload = {}
  const names = {}
  const warnings = []
  const options = {}
  const a = args || {}

  // ---- 项目(四类都可能用到; 评论挂在项目上时也靠它) ----
  let project = null
  const projectRef = a.project_id ?? a.projectId ?? a.project
  if (kind !== 'comment' || (!a.task && !a.task_id && projectRef)) {
    const r = await resolveProject(lookup, projectRef)
    if (r.project) project = r.project
    else if (r.candidates) warnings.push(`「${str(projectRef, 50)}」对上了多个项目：${r.candidates.map((p) => p.name).join('、')}，请选一个`)
    else if (r.notFound) warnings.push(`在你参与的项目里没找到「${r.notFound}」`)
  }
  options.projects = (await lookup.projects()).slice(0, 50).map((p) => ({ id: p.id, name: p.name }))
  if (project) {
    payload.projectId = project.id
    names.projectId = project.name
    if (!options.projects.some((p) => p.id === project.id)) options.projects.unshift({ id: project.id, name: project.name })
  }

  if (kind === 'task') {
    payload.title = str(a.title, 200) || undefined
    payload.description = str(a.description, 5000) || undefined
    const pr = parsePriority(a.priority)
    payload.priority = pr || 'MEDIUM'
    if (a.priority && !pr) warnings.push(`优先级「${str(a.priority, 20)}」认不出，先按「中」`)
    const due = a.due_date ?? a.dueDate ?? a.due
    if (due) {
      const d = parseDate(due, today)
      if (d) payload.dueDate = d
      else warnings.push(`截止日期「${str(due, 30)}」认不出，请在卡片上选`)
    }
    const r = await resolvePerson(lookup, payload.projectId, a.assignee ?? a.assignee_name ?? a.assigneeUserId)
    if (r.person) { payload.assigneeUserId = r.person.userId; names.assigneeUserId = r.person.name }
    else if (r.candidates) warnings.push(`负责人「${str(a.assignee, 20)}」对上了多个人：${r.candidates.map((m) => m.name).join('、')}`)
    else if (r.notFound) warnings.push(`项目成员里没有「${r.notFound}」，负责人先空着`)
    if (payload.projectId) options.members = await lookup.members(payload.projectId)
  } else if (kind === 'requirement') {
    payload.title = str(a.title, 200) || undefined
    payload.detail = str(a.detail ?? a.description, 5000) || undefined
    payload.priority = parsePriority(a.priority) || 'MEDIUM'
    if (a.owner) {
      const r = await resolvePerson(lookup, payload.projectId, a.owner)
      if (r.person) { payload.ownerId = r.person.userId; names.ownerId = r.person.name }
      else warnings.push(`责任人「${str(a.owner, 20)}」不是该项目在职成员，先空着（确认需求前要补）`)
    }
    if (payload.projectId) options.members = await lookup.members(payload.projectId)
  } else if (kind === 'timesheet') {
    const wd = a.work_date ?? a.workDate ?? a.date ?? '今天'
    const d = parseDate(wd, today)
    if (d) payload.workDate = d
    else warnings.push(`日期「${str(wd, 30)}」认不出`)
    const h = parseHours(a.hours)
    if (h) payload.hours = h
    else if (a.hours != null) warnings.push(`小时数「${str(a.hours, 20)}」认不出（0.25~24）`)
    payload.workContent = str(a.work_content ?? a.workContent ?? a.content, 2000) || undefined
    if (a.task || a.task_id) {
      const r = await resolveTask(api, a.task_id ?? a.task, payload.projectId)
      if (r.task) { payload.taskId = r.task.id; names.taskId = r.task.title }
      else if (r.candidates) warnings.push(`关联任务对上了多个：${r.candidates.map((t) => t.title).join('、')}`)
      else if (r.notFound) warnings.push(`该项目里没找到任务「${r.notFound}」，先不关联`)
    }
  } else if (kind === 'comment') {
    const taskRef = a.task_id ?? a.task
    if (taskRef) {
      const r = await resolveTask(api, taskRef, payload.projectId)
      if (r.task) {
        payload.entity = 'task'; payload.entityId = r.task.id
        names.entityId = `任务「${r.task.title}」${r.task.projectName ? `（${r.task.projectName}）` : ''}`
        delete payload.projectId; delete names.projectId
      } else if (r.candidates) warnings.push(`任务「${str(taskRef, 40)}」对上了多个：${r.candidates.map((t) => t.title).join('、')}`)
      else if (r.notFound) warnings.push(`你看得到的任务里没有「${r.notFound}」`)
    } else if (payload.projectId) {
      payload.entity = 'project'; payload.entityId = payload.projectId
      names.entityId = `项目「${names.projectId}」`
      delete payload.projectId; delete names.projectId
    }
    let content = str(a.content, 2000)
    // 模型把要 @ 的人单独给了: 补进正文(正文里已有就不重复)
    for (const n of (Array.isArray(a.mentions) ? a.mentions : []).slice(0, 10)) {
      const name = str(n, 50).replace(/^@/, '')
      if (name && !content.includes('@' + name)) content = `@${name} ${content}`
    }
    payload.content = content || undefined
  }

  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k]
  const missing = FIELDS[kind].required.filter((k) => payload[k] == null || payload[k] === '')
  const labels = { names, options }
  if (kind === 'comment') {
    labels.mentions = await mentionsOf(payload.content)
    const said = (String(payload.content || '').match(/@([^\s@,，。:：]+)/g) || []).map((x) => x.slice(1))
    const unknown = said.filter((n) => !labels.mentions.some((m) => m.name === n || n.startsWith(m.name)))
    if (unknown.length) warnings.push(`@${unknown.join('、@')} 不是在职同事，不会收到通知`)
  }
  if (warnings.length) labels.warnings = warnings
  return { kind, payload, labels, missing, warnings }
}

/**
 * 确认前再过一遍人改过的 payload: 白名单字段、类型、日期; 项目必须在当前用户范围内
 * 返回 { payload, missing, error? }
 */
export async function normalizeForSubmit(kind, draftPayload, override, { lookup, today = new Date() }) {
  const spec = FIELDS[kind]
  const merged = { ...draftPayload }
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    for (const k of spec.keys) {
      // 评论挂在哪儿不让在卡片上改(只能重新让助手出草稿), 免得改成任意 id
      if (kind === 'comment' && (k === 'entity' || k === 'entityId')) continue
      if (k in override) merged[k] = override[k]
    }
  }
  const out = {}
  for (const k of spec.keys) {
    let v = merged[k]
    if (v === undefined || v === null || v === '') continue
    if (['projectId', 'assigneeUserId', 'ownerId', 'taskId', 'entityId'].includes(k)) {
      if (!isId(v)) return { error: `${FIELD_LABEL[k]}不合法` }
      v = String(v)
    } else if (k === 'dueDate' || k === 'workDate') {
      v = parseDate(v, today)
      if (!v) return { error: `${FIELD_LABEL[k]}格式不对` }
    } else if (k === 'priority') {
      v = parsePriority(v)
      if (!v) return { error: '优先级只能是 低/中/高/紧急' }
    } else if (k === 'hours') {
      v = parseHours(v)
      if (!v) return { error: '小时数要在 0.25 到 24 之间' }
    } else if (k === 'entity') {
      if (!['task', 'project'].includes(v)) return { error: '评论只能挂在任务或项目上' }
    } else {
      v = String(v).trim()
      if (!v) continue
    }
    out[k] = v
  }
  const missing = spec.required.filter((k) => out[k] == null)
  if (out.projectId) {
    const p = await lookup.project(out.projectId)
    if (!p) return { error: '项目不存在或你无权访问' }
  }
  return { payload: out, missing }
}

/** 草稿 → 正常业务接口(与页面按钮同一个): { method, path, body, link(result) } */
export function submitSpec(kind, p) {
  if (kind === 'task') {
    return { method: 'POST', path: '/api/fde/tasks', body: p, link: (r) => `/admin/tasks?open=${r.id}` }
  }
  if (kind === 'requirement') {
    const { projectId, ...body } = p
    return { method: 'POST', path: `/api/fde/project-records/${projectId}/requirements`, body, link: () => `/admin/projects/${projectId}` }
  }
  if (kind === 'timesheet') {
    return { method: 'POST', path: '/api/fde/timesheets', body: p, link: () => '/admin/timesheets' }
  }
  if (kind === 'comment') {
    return {
      method: 'POST', path: '/api/fde/comments', body: p,
      link: () => (p.entity === 'task' ? `/admin/tasks?open=${p.entityId}` : `/admin/projects/${p.entityId}`)
    }
  }
  throw new Error(`不支持的草稿类型 ${kind}`)
}

/** 给前端 / 历史会话看的草稿 */
export function draftView(d) {
  const labels = d.labels || {}
  return {
    id: String(d.id),
    kind: d.kind,
    status: d.status,
    payload: d.payload,
    names: labels.names || {},
    options: labels.options || {},
    mentions: labels.mentions || [],
    warnings: labels.warnings || [],
    missing: d.missing || [],
    resultId: d.resultId || null,
    link: d.resultId ? linkOf(d) : null,
    lastError: d.lastError || null,
    createdAt: d.createdAt,
    submittedAt: d.submittedAt,
    discardedAt: d.discardedAt
  }
}

function linkOf(d) {
  try { return submitSpec(d.kind, d.payload).link({ id: d.resultId }) } catch { return null }
}

/** 给模型看的草稿结果(工具返回值): 不含选项清单, 只说清填了什么、缺什么 */
export function draftToolResult(d) {
  return {
    draft: true,
    kind: d.kind,
    note: '已生成草稿卡片，等用户在界面上核对后点「确认」才会保存。不要说「已创建」。',
    filled: Object.fromEntries(Object.entries(d.payload).map(([k, v]) => [FIELD_LABEL[k] || k, d.labels.names[k] || v])),
    missing: d.missing.map((k) => FIELD_LABEL[k] || k),
    warnings: d.warnings
  }
}
