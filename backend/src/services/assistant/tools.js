// AI 助手的工具集。三类:
//   查(read)   —— 经当前用户身份调自己的接口, 结果按该用户的数据范围
//   写(draft)  —— 只出草稿, 不落库; 人点「确认」后由正常业务接口写入
//   总结(summary)—— 收集事实交给模型写成文字, 不改数据
// perm: 用这个工具需要的权限点(与背后的业务接口一致); 没权限的工具不给模型看, 模型硬调也会被拒并留痕
import { hasPermission } from '../../lib/auth.js'
import prisma from '../../lib/prisma.js'
import { buildDraft, resolveProject, KIND_PERM, draftToolResult } from './drafts.js'
import { fmt, weekRange, parseWeek, parseDate, dbDay, tsDay, businessDay } from './dates.js'

const DONE = ['DONE', 'VERIFIED']
const STATUS_LABEL = { TODO: '待办', QUEUED: '排队中', IN_PROGRESS: '进行中', DONE: '已完成', VERIFIED: '已验收', REWORK: '返工' }
const PROJECT_STATUS = { PROPOSAL: '立项中', APPROVED: '已立项', IN_PROGRESS: '进行中', ACCEPTED: '已验收', CLOSED: '已关闭', CANCELLED: '已取消' }
const PRIORITY_LABEL = { URGENT: '紧急', HIGH: '高', MEDIUM: '中', LOW: '低' }
const HEALTH_LABEL = { GREEN: '正常', YELLOW: '有风险', RED: '告警' }
const MILESTONE_STATUS = { PENDING: '未开始', IN_PROGRESS: '进行中', COMPLETED: '已完成', DELAYED: '已延期' }

const day = dbDay   // DATE 列(截止日 / 工作日期 / 计划日期)
/** 截止日已过且没做完 */
const isOverdue = (t, now) => !!t.dueDate && !DONE.includes(t.status) && dbDay(t.dueDate) < fmt(businessDay(now))

function taskBrief(t, now) {
  const overdue = isOverdue(t, now)
  return {
    id: String(t.id), title: t.title, project: t.project?.name || null,
    status: STATUS_LABEL[t.status] || t.status, priority: PRIORITY_LABEL[t.priority] || t.priority,
    dueDate: day(t.dueDate), ...(overdue ? { overdue: true } : {}),
    ...(t.blockedBy?.length ? { blockedBy: t.blockedBy.map((b) => b.title) } : {})
  }
}

async function myEngineerId(user) {
  if (user.engineerId) return String(user.engineerId)
  const e = await prisma.engineer.findUnique({ where: { userId: BigInt(user.userId ?? user.id) }, select: { id: true } })
  return e ? String(e.id) : null
}

/** 解析项目参数: 失败时直接返回给模型的错误对象 */
async function projectOrError(ctx, ref) {
  if (!ref) return { error: '缺少 project：请告诉我是哪个项目（名称或编号均可），或先调 list_my_projects' }
  const r = await resolveProject(ctx.lookup, ref)
  if (r.project) return { project: r.project }
  if (r.candidates) return { error: `对上了多个项目，请让用户选：${r.candidates.map((p) => `${p.name}(id ${p.id})`).join('、')}` }
  return { error: `在用户参与的项目里没找到「${ref}」` }
}

async function myTasks(ctx, query = {}) {
  const r = await ctx.api('GET', '/api/fde/tasks', { query: { mine: 'true', page_size: 200, ...query } })
  if (r.code !== 0) throw new Error(r.message || '查任务失败')
  return r.data.list
}

async function myTimesheets(ctx, from, to) {
  const engineerId = await myEngineerId(ctx.user)
  if (!engineerId) return []
  const r = await ctx.api('GET', '/api/fde/timesheets', { query: { from, to, engineerId, page_size: 200 } })
  if (r.code !== 0) throw new Error(r.message || '查工时失败')
  return r.data.list || []
}

const projectParam = { type: 'string', description: '项目名称、编号或 id，口语简称也行（如「电梯导轨」）' }

export const TOOLS = [
  // ================= 查 =================
  {
    name: 'list_my_projects', kind: 'read', perm: 'project.view',
    description: '列出我参与的项目（名称、编号、阶段、健康度、进度）。用户问「我有哪些项目」「XX 项目现在什么阶段」或需要把口述的项目名对上时用。无必填参数。',
    parameters: { type: 'object', properties: { keyword: { type: 'string', description: '可选，按项目名/编号模糊筛' } } },
    async run(a, ctx) {
      const r = await ctx.api('GET', '/api/fde/projects', { query: { page_size: 50, keyword: a.keyword } })
      if (r.code !== 0) return { error: r.message }
      return {
        total: r.data.total,
        projects: r.data.list.map((p) => ({
          id: String(p.id), code: p.code, name: p.name, stage: PROJECT_STATUS[p.status] || p.status,
          health: HEALTH_LABEL[p.autoHealth?.light || p.health] || null, progress: p.progress ?? null
        }))
      }
    }
  },
  {
    name: 'get_project_summary', kind: 'read', perm: 'project.view',
    description: '查一个项目的详情：里程碑、进行中的任务、逾期任务、最近动态（近 7 天完成的任务与报工）、未关闭的问题和风险。用户问某个项目「进展如何」「最近在干什么」时用。必填 project。',
    parameters: { type: 'object', properties: { project: projectParam }, required: ['project'] },
    async run(a, ctx) {
      const pr = await projectOrError(ctx, a.project)
      if (pr.error) return pr
      const p = await ctx.lookup.project(pr.project.id)
      if (!p) return { error: '项目不存在或无权访问' }
      const now = ctx.today
      const weekAgo = fmt(new Date(businessDay(now).getTime() - 7 * 86400000))
      const tasks = p.tasks || []
      return {
        id: String(p.id), name: p.name, code: p.code, stage: PROJECT_STATUS[p.status] || p.status, progress: p.progress,
        health: p.autoHealth ? { light: HEALTH_LABEL[p.autoHealth.light], signals: p.autoHealth.signals?.map((s) => `${s.label}：${s.detail}`) } : null,
        milestones: (p.milestones || []).map((m) => ({ name: m.name, status: MILESTONE_STATUS[m.status] || m.status, plannedDate: day(m.plannedDate), owner: m.owner?.name || null })),
        inProgress: tasks.filter((t) => ['IN_PROGRESS', 'QUEUED', 'REWORK'].includes(t.status)).slice(0, 15).map((t) => taskBrief(t, now)),
        overdue: tasks.filter((t) => isOverdue(t, now)).slice(0, 15).map((t) => taskBrief(t, now)),
        taskCounts: { total: tasks.length, done: tasks.filter((t) => DONE.includes(t.status)).length },
        recentActivity: [
          ...tasks.filter((t) => t.completedAt && tsDay(t.completedAt) >= weekAgo).slice(0, 10).map((t) => `完成任务「${t.title}」(${tsDay(t.completedAt)})`),
          ...(p.timesheets || []).filter((x) => day(x.workDate) >= weekAgo).slice(0, 10).map((x) => `${x.engineer?.user?.name || '成员'} ${day(x.workDate)} 报工 ${Number(x.hours)}h：${String(x.workContent || '').slice(0, 60)}`)
        ],
        openIssues: (p.issues || []).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status)).slice(0, 10).map((i) => ({ title: i.title, severity: i.severity, status: i.status })),
        openRisks: (p.risks || []).filter((r) => !['CLOSED', 'MITIGATED'].includes(r.status)).slice(0, 10).map((r) => ({ title: r.title, impact: r.impact, status: r.status }))
      }
    }
  },
  {
    name: 'list_my_tasks', kind: 'read', perm: 'task.view',
    description: '查分配给我的任务。用户问「我这周有哪些任务要交」「我有什么逾期的」「电梯导轨项目我还有啥没做」时用。range 选时间口径：this_week=本周截止(含已逾期)、next_week=下周截止、overdue=已逾期、all=全部未完成（默认 all）；也可直接给 due_before（如「周五」「11/20」）。返回任务标题、项目、状态、优先级、截止日、是否逾期。',
    parameters: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: ['this_week', 'next_week', 'overdue', 'all'], description: '时间口径，默认 all' },
        due_before: { type: 'string', description: '可选，截止日不晚于这天，口语日期均可' },
        project: { ...projectParam, description: '可选，只看某个项目' },
        include_done: { type: 'boolean', description: '是否包含已完成/已验收，默认 false' }
      }
    },
    async run(a, ctx) {
      let projectId
      if (a.project) {
        const pr = await projectOrError(ctx, a.project)
        if (pr.error) return pr
        projectId = pr.project.id
      }
      const now = ctx.today
      let list = await myTasks(ctx, { projectId })
      if (!a.include_done) list = list.filter((t) => !DONE.includes(t.status))
      let window = null
      const range = a.range || 'all'
      if (a.due_before) {
        const d = parseDate(a.due_before, now)
        if (!d) return { error: `due_before「${a.due_before}」认不出，请换成具体日期` }
        window = { to: d }
      } else if (range === 'this_week') window = { to: weekRange(now, 0).to }
      else if (range === 'next_week') window = weekRange(now, 1)
      if (window) list = list.filter((t) => t.dueDate && day(t.dueDate) <= window.to && (!window.from || day(t.dueDate) >= window.from))
      if (range === 'overdue') list = list.filter((t) => isOverdue(t, now))
      return {
        today: fmt(businessDay(now)), range, ...(window ? { window } : {}),
        total: list.length,
        tasks: list.slice(0, 50).map((t) => taskBrief(t, now)),
        ...(range !== 'all' ? { noDueDate: '没有截止日期的任务不在本次结果里，用户需要时用 range=all 再查' } : {})
      }
    }
  },
  {
    name: 'search_anything', kind: 'read', perm: null,
    description: '全局搜索：按关键字同时搜项目、任务、需求、客户、知识条目（都只在当前用户能看到的范围内）。用户说「帮我找一下 XX」「XX 在哪」又不确定是什么类型时用。必填 keyword。',
    parameters: { type: 'object', properties: { keyword: { type: 'string', description: '关键字' } }, required: ['keyword'] },
    async run(a, ctx) {
      const kw = String(a.keyword || '').trim().slice(0, 50)
      if (!kw) return { error: '缺少 keyword' }
      const safe = async (fn) => { try { return await fn() } catch { return [] } }
      const [projects, tasks, customers, knowledge] = await Promise.all([
        safe(async () => { const r = await ctx.api('GET', '/api/fde/projects', { query: { keyword: kw, page_size: 5 } }); return r.code === 0 ? r.data.list.map((p) => ({ id: String(p.id), name: p.name, code: p.code })) : [] }),
        safe(async () => { const r = await ctx.api('GET', '/api/fde/tasks', { query: { keyword: kw, page_size: 8 } }); return r.code === 0 ? r.data.list.map((t) => ({ id: String(t.id), title: t.title, project: t.project?.name, status: STATUS_LABEL[t.status] || t.status })) : [] }),
        safe(async () => {
          if (!hasPermission(ctx.user, 'customer.view')) return []
          const r = await ctx.api('GET', '/api/fde/customers', { query: { keyword: kw, page_size: 5 } })
          return r.code === 0 ? (r.data.list || []).map((c) => ({ id: String(c.id), name: c.name })) : []
        }),
        safe(async () => { const r = await ctx.api('GET', '/api/fde/knowledge', { query: { keyword: kw, page_size: 5 } }); return r.code === 0 ? (r.data.list || []).map((k) => ({ id: String(k.id), title: k.title, category: k.category })) : [] })
      ])
      // 需求没有全局搜索接口: 在我参与的项目里逐个查(最多 15 个项目)
      const requirements = await safe(async () => {
        const out = []
        for (const p of (await ctx.lookup.projects()).slice(0, 15)) {
          const r = await ctx.api('GET', `/api/fde/project-records/${p.id}/requirements`)
          if (r.code !== 0) continue
          for (const q of r.data.list) if (q.title.includes(kw) || String(q.detail || '').includes(kw)) out.push({ id: String(q.id), title: q.title, project: p.name, status: q.status })
          if (out.length >= 8) break
        }
        return out
      })
      return { keyword: kw, projects, tasks, requirements, customers, knowledge }
    }
  },
  {
    name: 'list_my_timesheets', kind: 'read', perm: 'timesheet.view',
    description: '查我某一周的工时（按天汇总 + 明细）。用户问「我这周报了多少工时」「上周工时」时用。week 可填 本周/上周/下周 或周内任意一天，默认本周。',
    parameters: { type: 'object', properties: { week: { type: 'string', description: '本周 / 上周 / 某个日期，默认本周' } } },
    async run(a, ctx) {
      const { from, to } = parseWeek(a.week, ctx.today)
      const list = await myTimesheets(ctx, from, to)
      const byDay = {}
      for (const t of list) byDay[day(t.workDate)] = (byDay[day(t.workDate)] || 0) + Number(t.hours)
      return {
        from, to, totalHours: list.reduce((s, t) => s + Number(t.hours), 0), byDay,
        entries: list.slice(0, 60).map((t) => ({ date: day(t.workDate), hours: Number(t.hours), project: t.project?.name || null, content: String(t.workContent || '').slice(0, 80), status: t.status }))
      }
    }
  },
  {
    name: 'list_pending_approvals', kind: 'read', perm: 'timesheet.approve',
    description: '（经理/管理员）查等我审批的工时。用户问「有哪些工时等我批」时用。只能查，审批要到工时页面操作。',
    parameters: { type: 'object', properties: {} },
    async run(a, ctx) {
      const r = await ctx.api('GET', '/api/fde/timesheets', { query: { status: 'SUBMITTED', page_size: 50 } })
      if (r.code !== 0) return { error: r.message }
      return { total: r.data.total, entries: (r.data.list || []).map((t) => ({ id: String(t.id), who: t.engineer?.user?.name || null, date: day(t.workDate), hours: Number(t.hours), project: t.project?.name, content: String(t.workContent || '').slice(0, 60) })) }
    }
  },

  // ================= 写(只出草稿) =================
  {
    name: 'draft_task', kind: 'draft', perm: KIND_PERM.task,
    description: '新建任务的草稿（不会直接保存，用户确认后才创建）。用户说「帮我建个任务」「给 XX 项目加个待办」时用。必填 project、title；可选 assignee（负责人姓名，不说默认是用户本人）、due_date（截止日，口语日期如「周五」「下周三」「11/20」均可）、priority（低/中/高/紧急）、description。一句话里有几件事就调几次。',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        title: { type: 'string', description: '任务标题，简洁的动宾短语，如「把图纸确认单发给客户」' },
        assignee: { type: 'string', description: '负责人姓名；「我」或不填 = 用户本人' },
        due_date: { type: 'string', description: '截止日期，口语即可' },
        priority: { type: 'string', description: '低/中/高/紧急' },
        description: { type: 'string', description: '补充说明，可选' }
      },
      required: ['project', 'title']
    },
    run: (a, ctx) => ctx.addDraft('task', a)
  },
  {
    name: 'draft_requirement', kind: 'draft', perm: KIND_PERM.requirement,
    description: '新建项目需求的草稿（进项目「需求」列表，状态为待确认；不会直接保存）。用户说「记一个需求」「客户提了个需求」时用。必填 project、title；可选 detail（背景与验收要点）、priority、owner（责任人姓名，必须是项目成员）。',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        title: { type: 'string', description: '一句话需求点（≤50 字）' },
        detail: { type: 'string', description: '背景与验收要点' },
        priority: { type: 'string', description: '低/中/高/紧急' },
        owner: { type: 'string', description: '责任人姓名，可选' }
      },
      required: ['project', 'title']
    },
    run: (a, ctx) => ctx.addDraft('requirement', a)
  },
  {
    name: 'draft_timesheet', kind: 'draft', perm: KIND_PERM.timesheet,
    description: '记工时的草稿（不会直接保存，用户确认后提交进审批）。用户说「帮我报个工时」「今天在 XX 项目干了 3 小时」时用。必填 project、hours（「半天」=4、「一天」=8、「2小时」均可）、work_content（具体做了什么，不能笼统）；date 默认今天，口语日期即可；可选 task（关联任务的标题关键字或 id）。',
    parameters: {
      type: 'object',
      properties: {
        project: projectParam,
        date: { type: 'string', description: '工作日期，默认今天' },
        hours: { type: 'string', description: '小时数' },
        work_content: { type: 'string', description: '具体工作内容' },
        task: { type: 'string', description: '可选，关联任务标题关键字或 id' }
      },
      required: ['project', 'hours', 'work_content']
    },
    run: (a, ctx) => ctx.addDraft('timesheet', a)
  },
  {
    name: 'draft_comment', kind: 'draft', perm: KIND_PERM.comment,
    description: '在任务或项目下发评论的草稿（不会直接发出，用户确认后才发）。用户说「在 XX 任务下留言」「跟 XX 说一声」时用。挂在任务上传 task（标题关键字或 id），挂在项目上传 project，二选一；必填 content；要 @ 谁就在 content 里写「@姓名」或放进 mentions。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '任务标题关键字或 id（挂在任务上时）' },
        project: { ...projectParam, description: '项目（挂在项目上时）' },
        content: { type: 'string', description: '评论内容' },
        mentions: { type: 'array', items: { type: 'string' }, description: '要 @ 的同事姓名' }
      },
      required: ['content']
    },
    run: (a, ctx) => ctx.addDraft('comment', a)
  },

  // ================= 总结(不改数据) =================
  {
    name: 'weekly_report', kind: 'summary', perm: null,
    description: '生成「我这一周」的周报素材：本周完成的任务、进行中的、逾期/被阻塞的、本周内还要交的、本周工时按项目汇总、下周到期的任务。用户说「总结一下我这周的工作」「帮我写周报」时用。拿到结果后按「完成了什么 / 卡在哪 / 下周建议」三段写给用户，只用返回的事实，不要编造。week 默认本周。',
    parameters: { type: 'object', properties: { week: { type: 'string', description: '本周 / 上周 / 某个日期，默认本周' } } },
    async run(a, ctx) {
      const now = ctx.today
      const { from, to } = parseWeek(a.week, now)
      const next = weekRange(new Date(`${to}T00:00:00Z`), 1)
      const [tasks, sheets] = await Promise.all([myTasks(ctx), myTimesheets(ctx, from, to)])
      const inWeek = (ts) => ts && tsDay(ts) >= from && tsDay(ts) <= to
      const hoursByProject = {}
      for (const s of sheets) {
        const k = s.project?.name || `项目#${s.projectId}`
        hoursByProject[k] = (hoursByProject[k] || 0) + Number(s.hours)
      }
      return {
        week: { from, to },
        completed: tasks.filter((t) => DONE.includes(t.status) && inWeek(t.completedAt)).map((t) => taskBrief(t, now)),
        inProgress: tasks.filter((t) => ['IN_PROGRESS', 'QUEUED', 'REWORK'].includes(t.status)).map((t) => taskBrief(t, now)),
        stuck: tasks.filter((t) => isOverdue(t, now) || (!DONE.includes(t.status) && t.blockedBy?.length)).map((t) => taskBrief(t, now)),
        // 本周还没到期、但本周内要交的(待办也算, 不只看「进行中」)
        dueThisWeek: tasks.filter((t) => !DONE.includes(t.status) && !isOverdue(t, now) && t.dueDate && day(t.dueDate) <= to).map((t) => taskBrief(t, now)),
        dueNextWeek: tasks.filter((t) => !DONE.includes(t.status) && t.dueDate && day(t.dueDate) >= next.from && day(t.dueDate) <= next.to).map((t) => taskBrief(t, now)),
        timesheet: { totalHours: sheets.reduce((s, t) => s + Number(t.hours), 0), byProject: hoursByProject, entries: sheets.slice(0, 30).map((s) => `${day(s.workDate)} ${Number(s.hours)}h ${String(s.workContent || '').slice(0, 60)}`) },
        format: '按三段输出：一、完成了什么；二、卡在哪（逾期/阻塞，以及本周内还没交的 dueThisWeek）；三、下周建议（结合卡点、本周未交和下周到期给 2~4 条）。没有的项写「无」。'
      }
    }
  },
  {
    name: 'project_health', kind: 'summary', perm: 'project.view',
    description: '指定项目的健康度小结素材：系统自动红绿灯与信号、进度、延期里程碑、逾期/阻塞任务、未关闭的问题与风险。用户问「XX 项目健康吗」「XX 项目有什么风险」时用。拿到后按「进度 / 风险 / 阻塞」三点写结论，只用返回的事实。必填 project。',
    parameters: { type: 'object', properties: { project: projectParam }, required: ['project'] },
    async run(a, ctx) {
      const pr = await projectOrError(ctx, a.project)
      if (pr.error) return pr
      const p = await ctx.lookup.project(pr.project.id)
      if (!p) return { error: '项目不存在或无权访问' }
      const now = ctx.today
      const tasks = p.tasks || []
      const open = tasks.filter((t) => !DONE.includes(t.status))
      return {
        name: p.name, stage: PROJECT_STATUS[p.status] || p.status, progress: p.progress,
        light: HEALTH_LABEL[p.autoHealth?.light || p.health] || '未知',
        signals: (p.autoHealth?.signals || []).map((s) => ({ level: HEALTH_LABEL[s.level] || s.level, what: s.label, detail: s.detail })),
        tasks: { total: tasks.length, done: tasks.length - open.length, open: open.length },
        delayedMilestones: (p.milestones || []).filter((m) => m.status !== 'COMPLETED' && m.plannedDate && day(m.plannedDate) < fmt(businessDay(now))).map((m) => ({ name: m.name, plannedDate: day(m.plannedDate) })),
        overdueTasks: open.filter((t) => isOverdue(t, now)).slice(0, 15).map((t) => taskBrief(t, now)),
        openIssues: (p.issues || []).filter((i) => !['RESOLVED', 'CLOSED'].includes(i.status)).map((i) => ({ title: i.title, severity: i.severity })),
        openRisks: (p.risks || []).filter((r) => !['CLOSED', 'MITIGATED'].includes(r.status)).map((r) => ({ title: r.title, impact: r.impact })),
        format: '按三点输出：进度、风险、阻塞；最后一句给结论（正常/需关注/需介入）。'
      }
    }
  }
]

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name))

/** 当前用户能用的工具 */
export const toolsFor = (user) => TOOLS.filter((t) => !t.perm || hasPermission(user, t.perm))

/** OpenAI function calling 格式 */
export const toOpenAI = (list) => list.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))

export { buildDraft, draftToolResult }
