// v2.8.0(#1143) 里程碑路径图: 任务 DAG 的图算法与聚合
//
// 设计口径(docs/01-产品与需求/里程碑路径图方案-草案.md §2):
// - 边类型 BLOCKS = 硬依赖, 由 BLOCKS 边构成的图必须无环; FEEDBACK = 回环软边, 只表达"做完 B 可能回到 A 再迭代",
//   不参与环检测 / 阻塞计算 / 关键路径, 画成虚线
// - 派生量不落库: blocked = 未完成且存在 BLOCKS 前置未达 DONE/VERIFIED; ready = TODO/QUEUED 且不 blocked
// - 阻塞是提醒不是锁(主人拍板 2026-09-28)
//
// 本文件前半是纯函数(可单测), 后半是 Prisma 装载
import prisma from '../lib/prisma.js'

export const DEP_TYPES = ['BLOCKS', 'FEEDBACK']
export const DONE_STATUSES = ['DONE', 'VERIFIED']
const READY_STATUSES = ['TODO', 'QUEUED', 'REWORK']

const sid = (v) => String(v)
const isDone = (t) => DONE_STATUSES.includes(t.status)

/**
 * 在现有 BLOCKS 边上加一条 predecessor→successor 是否成环。
 * 成环返回环路(任务 id 数组, 首尾相接: [successor, ..., predecessor, successor]); 不成环返回 null。
 * FEEDBACK 边不参与判定。
 */
export function findCycle(edges, predecessorId, successorId) {
  const from = sid(predecessorId), to = sid(successorId)
  if (from === to) return [from, from]
  const adj = new Map()
  for (const e of edges) {
    if (e.type && e.type !== 'BLOCKS') continue
    const a = sid(e.predecessorId), b = sid(e.successorId)
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push(b)
  }
  // 从 successor 出发, 沿 BLOCKS 边能否走回 predecessor
  const prev = new Map([[to, null]])
  const queue = [to]
  while (queue.length) {
    const cur = queue.shift()
    if (cur === from) {
      const path = []
      for (let n = cur; n !== null; n = prev.get(n)) path.unshift(n)
      path.push(to)
      return path
    }
    for (const nxt of adj.get(cur) || []) {
      if (prev.has(nxt)) continue
      prev.set(nxt, cur)
      queue.push(nxt)
    }
  }
  return null
}

/** 计划工期(天): 有 plannedStart/End 取差值(至少 1), 否则 1 */
function durationDays(t) {
  if (t.plannedStartAt && t.plannedEndAt) {
    const d = Math.round((new Date(t.plannedEndAt) - new Date(t.plannedStartAt)) / 86400000) + 1
    return d > 0 ? d : 1
  }
  return 1
}

function mermaidLabel(s) {
  return String(s || '').replace(/["\[\]{}()<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
}

/**
 * 纯函数: 由任务与边构建路径图
 * @param {Object} p
 * @param {Array}  p.tasks      节点任务(已挂 assignee/subtaskStats/milestone 等展示字段)
 * @param {Array}  p.edges      两端都在 tasks 里的边 {id, predecessorId, successorId, type, note}
 * @param {Object} [p.milestone] 当前里程碑(有则生成终点节点)
 * @param {Set}    [p.focusIds]  聚焦集合(当前里程碑的任务 id); 不在集合里的节点标 external(跨里程碑前置)
 */
export function buildRoadmap({ tasks, edges, milestone = null, focusIds = null }) {
  const byId = new Map(tasks.map(t => [sid(t.id), t]))
  const preds = new Map(), succs = new Map()   // 仅 BLOCKS
  const allPreds = new Map(), allSuccs = new Map()
  for (const t of tasks) { preds.set(sid(t.id), []); succs.set(sid(t.id), []); allPreds.set(sid(t.id), []); allSuccs.set(sid(t.id), []) }
  const cleanEdges = []
  for (const e of edges) {
    const a = sid(e.predecessorId), b = sid(e.successorId)
    if (!byId.has(a) || !byId.has(b)) continue
    const type = e.type === 'FEEDBACK' ? 'FEEDBACK' : 'BLOCKS'
    cleanEdges.push({ id: e.id != null ? sid(e.id) : `${a}-${b}`, source: a, target: b, type, note: e.note || null })
    allPreds.get(b).push(a); allSuccs.get(a).push(b)
    if (type === 'BLOCKS') { preds.get(b).push(a); succs.get(a).push(b) }
  }

  // Kahn 拓扑排序(BLOCKS); 同层按优先级/截止日/id 稳定
  const PRIO = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
  const cmp = (x, y) => {
    const a = byId.get(x), b = byId.get(y)
    const pa = PRIO[a.priority] ?? 9, pb = PRIO[b.priority] ?? 9
    if (pa !== pb) return pa - pb
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity, db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
    if (da !== db) return da - db
    return Number(x) - Number(y)
  }
  const indeg = new Map([...preds].map(([k, v]) => [k, v.length]))
  let layer = [...indeg].filter(([, d]) => d === 0).map(([k]) => k).sort(cmp)
  const topoOrder = []
  const depth = new Map(layer.map(k => [k, 0]))
  while (layer.length) {
    const next = []
    for (const n of layer) {
      topoOrder.push(n)
      for (const s of succs.get(n)) {
        indeg.set(s, indeg.get(s) - 1)
        depth.set(s, Math.max(depth.get(s) ?? 0, (depth.get(n) ?? 0) + 1))
        if (indeg.get(s) === 0) next.push(s)
      }
    }
    layer = next.sort(cmp)
  }
  const hasCycle = topoOrder.length !== tasks.length   // 数据层理应无环, 这里只兜底不炸

  // 阻塞 / 可开始
  const nodes = []
  for (const id of (hasCycle ? tasks.map(t => sid(t.id)) : topoOrder)) {
    const t = byId.get(id)
    const blockedBy = preds.get(id).filter(p => !isDone(byId.get(p)))
    const blocked = !isDone(t) && blockedBy.length > 0
    const ready = READY_STATUSES.includes(t.status) && !blocked
    nodes.push({
      id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate || null,
      plannedStartAt: t.plannedStartAt || null,
      plannedEndAt: t.plannedEndAt || null,
      milestoneId: t.milestoneId != null ? sid(t.milestoneId) : null,
      milestoneName: t.milestone?.name || null,
      assignee: t.assignee || null,
      subtaskStats: t.subtaskStats || { total: 0, done: 0 },
      durationDays: durationDays(t),
      predecessors: allPreds.get(id),
      successors: allSuccs.get(id),
      blockedBy,
      blocked,
      ready,
      isEntry: preds.get(id).length === 0,
      isTerminal: succs.get(id).length === 0,
      depth: depth.get(id) ?? 0,
      external: focusIds ? !focusIds.has(id) : false
    })
  }
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // 关键路径: 未完成节点上按工期加权的最长链(完成的算 0 权, 不再占工期)
  let criticalPath = { taskIds: [], totalDays: 0 }
  if (!hasCycle && nodes.length) {
    const best = new Map(), via = new Map()
    for (const id of topoOrder) {
      const w = isDone(byId.get(id)) ? 0 : nodeMap.get(id).durationDays
      let base = 0, from = null
      for (const p of preds.get(id)) if ((best.get(p) ?? 0) > base) { base = best.get(p); from = p }
      best.set(id, base + w); via.set(id, from)
    }
    let end = null, max = -1
    for (const [id, v] of best) if (v > max) { max = v; end = id }
    const path = []
    for (let n = end; n; n = via.get(n)) path.unshift(n)
    criticalPath = { taskIds: max > 0 ? path : [], totalDays: Math.max(max, 0) }
  }

  // Mermaid 文本(AI 读图用)
  const lines = ['flowchart LR']
  for (const n of nodes) {
    const shape = n.external ? `[/"#${n.id} ${mermaidLabel(n.title)}"/]` : `["#${n.id} ${mermaidLabel(n.title)}"]`
    lines.push(`  T${n.id}${shape}`)
  }
  if (milestone) lines.push(`  M${sid(milestone.id)}(("🏁 ${mermaidLabel(milestone.name)}"))`)
  for (const e of cleanEdges) lines.push(`  T${e.source} ${e.type === 'FEEDBACK' ? '-. 回环 .->' : '-->'} T${e.target}`)
  if (milestone) for (const n of nodes) if (n.isTerminal && !n.external) lines.push(`  T${n.id} --> M${sid(milestone.id)}`)
  const cls = { done: [], active: [], blocked: [], ready: [] }
  for (const n of nodes) {
    if (isDone(n)) cls.done.push(`T${n.id}`)
    else if (n.status === 'IN_PROGRESS') cls.active.push(`T${n.id}`)
    else if (n.blocked) cls.blocked.push(`T${n.id}`)
    else if (n.ready) cls.ready.push(`T${n.id}`)
  }
  lines.push('  classDef done fill:#e8f5e9,stroke:#2e7d4f;', '  classDef active fill:#fff3e0,stroke:#d2521e;', '  classDef blocked fill:#fff,stroke:#e24b4a,stroke-width:2px;', '  classDef ready fill:#f5f5f5,stroke:#888;')
  for (const [k, v] of Object.entries(cls)) if (v.length) lines.push(`  class ${v.join(',')} ${k};`)

  const stats = {
    total: nodes.filter(n => !n.external).length,
    done: nodes.filter(n => !n.external && isDone(n)).length,
    inProgress: nodes.filter(n => !n.external && n.status === 'IN_PROGRESS').length,
    ready: nodes.filter(n => !n.external && n.ready).length,
    blocked: nodes.filter(n => !n.external && n.blocked).length,
    edges: cleanEdges.length
  }
  return {
    nodes,
    edges: cleanEdges,
    topoOrder,
    ready: nodes.filter(n => n.ready && !n.external).map(n => n.id),
    blocked: nodes.filter(n => n.blocked && !n.external).map(n => n.id),
    entries: nodes.filter(n => n.isEntry && !n.external).map(n => n.id),
    terminals: nodes.filter(n => n.isTerminal && !n.external).map(n => n.id),
    criticalPath,
    hasCycle,
    mermaid: lines.join('\n'),
    stats
  }
}

// ===================== Prisma 装载 =====================

/** 项目内全部活动任务(含 assignee / subtaskStats / milestone), 与任务列表接口口径一致 */
export async function loadProjectTasks(projectId) {
  const tasks = await prisma.task.findMany({
    where: { projectId: BigInt(projectId), deletedAt: null, archivedAt: null },
    include: { milestone: { select: { id: true, name: true, status: true } } }
  })
  const ids = tasks.map(t => t.id)
  const engineerIds = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean))]
  const [engineers, subStats] = await Promise.all([
    engineerIds.length ? prisma.engineer.findMany({ where: { id: { in: engineerIds } }, include: { user: { select: { id: true, name: true, avatarUrl: true } } } }) : [],
    ids.length ? prisma.subtask.groupBy({ by: ['taskId', 'done'], where: { taskId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : []
  ])
  const engMap = new Map(engineers.map(e => [sid(e.id), e]))
  const statMap = {}
  for (const s of subStats) {
    const k = sid(s.taskId)
    statMap[k] ||= { total: 0, done: 0 }
    statMap[k].total += s._count._all
    if (s.done === 1) statMap[k].done = s._count._all
  }
  return tasks.map(t => {
    const eng = t.assigneeId && engMap.get(sid(t.assigneeId))
    return {
      ...t,
      assignee: eng ? { id: sid(eng.id), userId: sid(eng.user.id), name: eng.user.name, avatarUrl: eng.user.avatarUrl } : null,
      subtaskStats: statMap[sid(t.id)] || { total: 0, done: 0 }
    }
  })
}

/** 项目内两端都活着的边 */
export async function loadProjectEdges(projectId) {
  return prisma.taskDependency.findMany({
    where: {
      deletedAt: null,
      predecessor: { projectId: BigInt(projectId), deletedAt: null, archivedAt: null },
      successor: { projectId: BigInt(projectId), deletedAt: null, archivedAt: null }
    },
    orderBy: { id: 'asc' }
  })
}

/**
 * 装载项目路径图
 * @param {bigint|string} projectId
 * @param {Object} [opts]
 * @param {string} [opts.milestoneId]  'none' = 未挂里程碑; 不传 = 整个项目
 */
export async function loadProjectRoadmap(projectId, { milestoneId } = {}) {
  const [allTasks, allEdges, milestones] = await Promise.all([
    loadProjectTasks(projectId),
    loadProjectEdges(projectId),
    prisma.milestone.findMany({
      where: { projectId: BigInt(projectId), deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { owner: { select: { id: true, name: true, avatarUrl: true } } }
    })
  ])
  // 每个里程碑的汇总(整项目算一次 blocked/ready, 再按里程碑归集)
  const whole = buildRoadmap({ tasks: allTasks, edges: allEdges })
  const nodeMap = new Map(whole.nodes.map(n => [n.id, n]))
  const summarize = (filterFn) => {
    const ns = whole.nodes.filter(filterFn)
    return {
      total: ns.length,
      done: ns.filter(n => DONE_STATUSES.includes(n.status)).length,
      inProgress: ns.filter(n => n.status === 'IN_PROGRESS').length,
      ready: ns.filter(n => n.ready).length,
      blocked: ns.filter(n => n.blocked).length
    }
  }
  const milestoneList = milestones.map(m => ({
    id: sid(m.id), name: m.name, goal: m.goal, status: m.status, plannedDate: m.plannedDate, actualDate: m.actualDate,
    sortOrder: m.sortOrder, owner: m.owner ? { id: sid(m.owner.id), name: m.owner.name, avatarUrl: m.owner.avatarUrl } : null,
    stats: summarize(n => n.milestoneId === sid(m.id))
  }))
  const orphanStats = summarize(n => n.milestoneId === null)

  let focusTasks = allTasks, focusMilestone = null, focusIds = null
  if (milestoneId) {
    const wanted = milestoneId === 'none' ? null : sid(milestoneId)
    if (wanted) {
      const m = milestones.find(x => sid(x.id) === wanted)
      if (!m) return null
      focusMilestone = m
    }
    focusIds = new Set(allTasks.filter(t => (t.milestoneId != null ? sid(t.milestoneId) : null) === wanted).map(t => sid(t.id)))
    // 跨里程碑前置: 焦点任务的 BLOCKS 前置若在别的里程碑, 作为 external 节点一并带出(否则 blocked 算不对)
    const extra = new Set()
    for (const e of allEdges) {
      const a = sid(e.predecessorId), b = sid(e.successorId)
      if (focusIds.has(b) && !focusIds.has(a)) extra.add(a)
    }
    focusTasks = allTasks.filter(t => focusIds.has(sid(t.id)) || extra.has(sid(t.id)))
  }
  const graph = buildRoadmap({ tasks: focusTasks, edges: allEdges, milestone: focusMilestone, focusIds })
  // 焦点视图里的 blocked 以整项目为准(external 节点自身的前置可能不在焦点集合里)
  for (const n of graph.nodes) {
    const w = nodeMap.get(n.id)
    if (w) { n.blocked = w.blocked; n.blockedBy = w.blockedBy; n.ready = w.ready }
  }
  graph.ready = graph.nodes.filter(n => n.ready && !n.external).map(n => n.id)
  graph.blocked = graph.nodes.filter(n => n.blocked && !n.external).map(n => n.id)
  return {
    milestone: focusMilestone ? { id: sid(focusMilestone.id), name: focusMilestone.name, goal: focusMilestone.goal, status: focusMilestone.status, plannedDate: focusMilestone.plannedDate } : null,
    milestones: milestoneList,
    orphanStats,
    ...graph,
    generatedAt: new Date().toISOString()
  }
}

/** 一条边落库前的全部校验(同项目 / 不自指 / 不重复 / BLOCKS 不成环). 通过返回 {a, b}; 失败抛带 code 的 Error */
export async function validateNewEdge({ predecessorId, successorId, type = 'BLOCKS', ignoreEdgeId = null }) {
  const a = BigInt(predecessorId), b = BigInt(successorId)
  const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })
  if (a === b) throw err(9002, '任务不能依赖自己')
  if (!DEP_TYPES.includes(type)) throw err(9002, `type 必须为 ${DEP_TYPES.join('/')}`)
  const [ta, tb] = await Promise.all([
    prisma.task.findFirst({ where: { id: a, deletedAt: null }, select: { id: true, projectId: true, title: true } }),
    prisma.task.findFirst({ where: { id: b, deletedAt: null }, select: { id: true, projectId: true, title: true } })
  ])
  if (!ta || !tb) throw err(9004, '任务不存在')
  if (ta.projectId !== tb.projectId) throw err(9002, '依赖关系只能建在同一项目的任务之间')
  const dup = await prisma.taskDependency.findFirst({ where: { predecessorId: a, successorId: b, deletedAt: null, ...(ignoreEdgeId ? { id: { not: BigInt(ignoreEdgeId) } } : {}) } })
  if (dup) throw err(9005, '这条依赖已经存在', { dependencyId: sid(dup.id) })
  if (type === 'BLOCKS') {
    const edges = await prisma.taskDependency.findMany({
      where: { deletedAt: null, type: 'BLOCKS', predecessor: { projectId: ta.projectId, deletedAt: null }, ...(ignoreEdgeId ? { id: { not: BigInt(ignoreEdgeId) } } : {}) },
      select: { predecessorId: true, successorId: true, type: true }
    })
    const cycle = findCycle(edges, a, b)
    if (cycle) {
      const titles = await prisma.task.findMany({ where: { id: { in: [...new Set(cycle)].map(BigInt) } }, select: { id: true, title: true } })
      const tm = new Map(titles.map(t => [sid(t.id), t.title]))
      throw err(9006, `会形成循环依赖: ${cycle.map(x => `#${x} ${tm.get(x) || ''}`.trim()).join(' → ')}`, { cyclePath: cycle })
    }
  }
  return { a: ta, b: tb }
}

/** 任务被删除/归档/跨项目移动时, 把它的所有活动边软删; 返回删了几条 */
export async function detachTaskEdges(taskId, tx = prisma) {
  const r = await tx.taskDependency.updateMany({
    where: { deletedAt: null, OR: [{ predecessorId: BigInt(taskId) }, { successorId: BigInt(taskId) }] },
    data: { deletedAt: new Date() }
  })
  return r.count
}

/** 单任务的上下游(get_task 用): predecessors/successors 各带对方任务摘要 + blocked */
export async function loadTaskNeighbors(taskId) {
  const id = BigInt(taskId)
  const edges = await prisma.taskDependency.findMany({
    where: { deletedAt: null, OR: [{ predecessorId: id }, { successorId: id }] },
    include: {
      predecessor: { select: { id: true, title: true, status: true, milestoneId: true, deletedAt: true } },
      successor: { select: { id: true, title: true, status: true, milestoneId: true, deletedAt: true } }
    },
    orderBy: { id: 'asc' }
  })
  const pick = (t) => ({ id: sid(t.id), title: t.title, status: t.status, milestoneId: t.milestoneId != null ? sid(t.milestoneId) : null })
  const predecessors = edges.filter(e => e.successorId === id && !e.predecessor.deletedAt).map(e => ({ dependencyId: sid(e.id), type: e.type, note: e.note, task: pick(e.predecessor) }))
  const successors = edges.filter(e => e.predecessorId === id && !e.successor.deletedAt).map(e => ({ dependencyId: sid(e.id), type: e.type, note: e.note, task: pick(e.successor) }))
  const blockedBy = predecessors.filter(p => p.type === 'BLOCKS' && !DONE_STATUSES.includes(p.task.status)).map(p => p.task.id)
  return { predecessors, successors, blockedBy }
}
