// 以虎 One 的「标准工具」: 老板的每日经营简报、老板助理、管理层首页按这三个名字来取数据
// (约定见以虎 One 开发中心「让应用出现在老板的简报里」 /dev/briefing):
//   get_key_metrics({ period })   关键指标: 在管项目、红黄灯项目、逾期任务、待我处理
//   get_daily_summary({ since })  变化与风险: 红灯 / 黄灯项目、逾期任务、最近的项目动态
//   list_pending_decisions()      等这个人拍板的事: 待审批工时、待验收任务
// 都走已有的 REST 接口、以当前用户身份调用, 数据范围和他在页面上看到的一致; 某个接口没权限就跳过那一项
import { z } from 'zod'

const ok = (r) => r && r.httpStatus < 400 && r.code === 0
const base = () => String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
const link = (path) => (base() ? `${base()}${path}` : undefined)

async function metrics(callApi, user) {
  const [stats, overdue, todos] = await Promise.all([
    callApi(user, { method: 'GET', path: '/api/fde/projects/_meta/stats' }),
    callApi(user, { method: 'GET', path: '/api/fde/tasks', query: { overdue: 1, page_size: 1 } }),
    callApi(user, { method: 'GET', path: '/api/fde/me/todos', query: { scope: 'approve' } })
  ])
  const out = []
  if (ok(stats)) {
    const h = Object.fromEntries((stats.data.byHealth || []).map(b => [b.health, b.count]))
    out.push({ name: '在管项目', value: stats.data.total || 0, unit: '个', url: link('/admin/projects') })
    out.push({ name: '红灯项目', value: h.RED || 0, unit: '个', good: !h.RED, url: link('/admin/projects?health=RED') })
    out.push({ name: '黄灯项目', value: h.YELLOW || 0, unit: '个', good: !h.YELLOW, url: link('/admin/projects?health=YELLOW') })
  }
  if (ok(overdue)) out.push({ name: '逾期任务', value: overdue.data.total || 0, unit: '个', good: !overdue.data.total, url: link('/admin/tasks?overdue=1') })
  if (ok(todos)) {
    const n = (todos.data.items || []).filter(i => i.kind === 'APPROVAL').length
    out.push({ name: '待我审批 / 验收', value: n, unit: '类', good: n === 0, url: link('/admin/workbench') })
  }
  return { metrics: out }
}

async function summary(callApi, user, { since }) {
  const from = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date(Date.now() - 24 * 3600_000)
  const [red, yellow, overdue, acts] = await Promise.all([
    callApi(user, { method: 'GET', path: '/api/fde/projects', query: { health: 'RED', page_size: 10 } }),
    callApi(user, { method: 'GET', path: '/api/fde/projects', query: { health: 'YELLOW', page_size: 10 } }),
    callApi(user, { method: 'GET', path: '/api/fde/tasks', query: { overdue: 1, page_size: 10 } }),
    callApi(user, { method: 'GET', path: '/api/fde/activities', query: { scope: 'all', page_size: 50 } })
  ])
  const items = []
  const projectItem = (p, level) => ({
    title: `项目「${p.name}」${level === 'risk' ? '红灯' : '黄灯'}`,
    detail: [p.manager?.name && `负责人 ${p.manager.name}`, p.endDate && `计划完成 ${String(p.endDate).slice(0, 10)}`, p.progress != null && `进度 ${p.progress}%`].filter(Boolean).join('，') || null,
    level,
    url: link(`/admin/projects/${p.id}`)
  })
  if (ok(red)) items.push(...(red.data.list || []).map(p => projectItem(p, 'risk')))
  if (ok(yellow)) items.push(...(yellow.data.list || []).map(p => projectItem(p, 'warn')))
  if (ok(overdue)) {
    const list = overdue.data.list || []
    if (list.length) {
      items.push({
        title: `${overdue.data.total} 个任务已逾期`,
        detail: list.slice(0, 3).map(t => `${t.title}${t.dueDate ? `（截止 ${String(t.dueDate).slice(0, 10)}）` : ''}`).join('；'),
        level: 'warn',
        url: link('/admin/tasks?overdue=1')
      })
    }
  }
  if (ok(acts)) {
    for (const a of (acts.data.list || []).filter(x => new Date(x.createdAt) >= from).slice(0, 10)) {
      items.push({ title: a.summary, level: 'info', at: a.createdAt, url: a.entity === 'project' ? link(`/admin/projects/${a.entityId}`) : undefined })
    }
  }
  return { items }
}

async function decisions(callApi, user) {
  const todos = await callApi(user, { method: 'GET', path: '/api/fde/me/todos', query: { scope: 'approve' } })
  if (!ok(todos)) return { items: [] }
  return {
    items: (todos.data.items || []).filter(i => i.kind === 'APPROVAL').map(i => ({
      id: i.id, title: i.title, detail: i.sub || null, url: i.link ? link(i.link) : undefined
    }))
  }
}

/** 给 mcp/index.js 注册用: [{ name, description, schema, run(user, args) }] */
export function standardTools(callApi) {
  return [
    {
      name: 'get_key_metrics',
      description: '以虎 One 标准工具：交付的关键指标（在管项目、红灯 / 黄灯项目、逾期任务、待我审批或验收），按当前用户能看到的范围统计。老板简报和管理层首页用。',
      schema: { period: z.enum(['today', 'week', 'month']).optional().describe('统计口径，默认 month（这些指标都是当前状态，口径不影响）') },
      run: (user) => metrics(callApi, user)
    },
    {
      name: 'get_daily_summary',
      description: '以虎 One 标准工具：交付的变化与风险——红灯 / 黄灯项目、逾期任务、since 以来的项目动态，风险在前。老板简报和管理层首页用。',
      schema: { since: z.string().optional().describe('动态从什么时候算起，ISO 时间，默认 24 小时前') },
      run: (user, a) => summary(callApi, user, a || {})
    },
    {
      name: 'list_pending_decisions',
      description: '以虎 One 标准工具：等当前用户处理的审批——待审批的工时、待验收的任务。老板简报和管理层首页用。',
      schema: {},
      run: (user) => decisions(callApi, user)
    }
  ]
}
