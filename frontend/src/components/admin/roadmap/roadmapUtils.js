// v2.8.0(#1144) 路径图: 共用常量与 dagre 自动布局
import dagre from '@dagrejs/dagre'
import { $t } from '../../../i18n/index.js'

export const NODE_W = 220
export const NODE_H = 78
export const MILESTONE_W = 150
export const MILESTONE_H = 56

export const STATUS_LABELS = { TODO: $t('common.inbox'), QUEUED: $t('common.queued'), IN_PROGRESS: $t('common.in_progress_2'), DONE: $t('common.built'), VERIFIED: $t('common.accepted'), REWORK: $t('common.rework') }
export const STATUS_TYPES = { TODO: 'info', QUEUED: 'warning', IN_PROGRESS: 'primary', DONE: 'success', VERIFIED: 'success', REWORK: 'danger' }
export const PRIORITY_LABELS = { LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high'), URGENT: $t('common.urgent') }
export const PRIORITY_TYPES = { LOW: 'info', MEDIUM: 'primary', HIGH: 'warning', URGENT: 'danger' }
export const MS_STATUS_LABELS = { PENDING: $t('common.not_started'), IN_PROGRESS: $t('common.in_progress'), COMPLETED: $t('common.done_3'), DELAYED: $t('common.delayed') }
export const MS_STATUS_TYPES = { PENDING: 'info', IN_PROGRESS: 'primary', COMPLETED: 'success', DELAYED: 'danger' }
export const DEP_TYPE_LABELS = { BLOCKS: $t('common.hard_dependency'), FEEDBACK: $t('common.loop') }
// v2.9.0(#1163) 机器人运行态
export const RUN_STATUS_LABELS = { PENDING: $t('common.queued_2'), RUNNING: $t('roadmapUtils.robot_developing'), SUCCEEDED: $t('roadmapUtils.robot_finished'), FAILED: $t('roadmapUtils.robot_failed'), CANCELLED: $t('common.cancelled') }
export const RUN_STATUS_TYPES = { PENDING: 'info', RUNNING: 'primary', SUCCEEDED: 'success', FAILED: 'danger', CANCELLED: 'info' }
export const DISPATCH_STATUS_LABELS = { RUNNING: $t('common.in_progress'), PAUSED: $t('common.paused'), DONE: $t('common.done_3'), CANCELLED: $t('common.cancelled') }

export const isDone = (s) => s === 'DONE' || s === 'VERIFIED'

/** 节点视觉态: done / active / blocked / ready / idle(等前置但不算阻塞, 如 DONE 前置的 TODO) */
export function nodeTone(n) {
  if (isDone(n.status)) return 'done'
  if (n.status === 'IN_PROGRESS') return 'active'
  if (n.blocked) return 'blocked'
  if (n.ready) return 'ready'
  return 'idle'
}

/**
 * dagre 左→右布局; 只用 BLOCKS 边定层级(FEEDBACK 是回环, 参与布局会把图拧成麻花)
 * @returns Map<id, {x, y}> 左上角坐标(Vue Flow 口径)
 */
export function layoutGraph(nodes, edges, milestone, ghost = null) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 70, marginx: 16, marginy: 16 })
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const e of edges) if (e.type !== 'FEEDBACK' && g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  // v2.8.0(#1145) AI 草案幽灵节点参与布局, 才能看出接在哪条路径上
  if (ghost) {
    for (const n of ghost.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
    for (const e of ghost.edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  }
  const msId = milestone ? `m-${milestone.id}` : null
  if (msId) {
    g.setNode(msId, { width: MILESTONE_W, height: MILESTONE_H })
    for (const n of nodes) if (n.isTerminal && !n.external) g.setEdge(n.id, msId)
  }
  dagre.layout(g)
  const pos = new Map()
  for (const id of g.nodes()) {
    const p = g.node(id)
    if (!p) continue
    pos.set(id, { x: p.x - p.width / 2, y: p.y - p.height / 2 })
  }
  return pos
}

/** 把接口返回的 roadmap 转成 Vue Flow 的 nodes/edges */
/**
 * v2.8.0(#1145) 把 AI 草案转成幽灵节点/边: 草案内依赖按标题连 g-节点, 引用项目已有任务的依赖按标题连真实节点
 */
export function draftToGhost(draft, data) {
  if (!draft?.milestones?.length) return null
  const titleToReal = new Map((data?.nodes || []).map(n => [n.title, n.id]))
  const items = draft.milestones.flatMap(m => m.tasks.map(t => ({ ...t, milestoneName: m.name })))
  const titleToGhost = new Map(items.map((t, i) => [t.title, `g-${i}`]))
  const nodes = items.map((t, i) => ({ id: `g-${i}`, title: t.title, role: t.role, priority: t.priority || 'MEDIUM', estimateDays: t.estimateDays, acCount: t.acceptanceCriteria?.length || 0, milestoneName: t.milestoneName }))
  const edges = []
  for (const t of items) {
    for (const dep of t.dependencies || []) {
      const src = titleToGhost.get(dep) || titleToReal.get(dep)
      if (src) edges.push({ id: `ge-${src}-${titleToGhost.get(t.title)}`, source: src, target: titleToGhost.get(t.title) })
    }
  }
  return { nodes, edges }
}

export function toFlow(data, { highlightCritical = false, ghost = null } = {}) {
  if (!data) return { nodes: [], edges: [] }
  const pos = layoutGraph(data.nodes, data.edges, data.milestone, ghost)
  const critical = new Set(highlightCritical ? (data.criticalPath?.taskIds || []) : [])
  const runs = data.runs || {}
  const nodes = data.nodes.map(n => ({
    id: n.id,
    type: 'task',
    position: pos.get(n.id) || { x: 0, y: 0 },
    data: { ...n, tone: nodeTone(n), critical: critical.has(n.id), run: runs[n.id] || null },
    draggable: true,
    connectable: !n.external
  }))
  if (data.milestone) {
    nodes.push({
      id: `m-${data.milestone.id}`,
      type: 'milestone',
      position: pos.get(`m-${data.milestone.id}`) || { x: 0, y: 0 },
      data: { ...data.milestone, stats: data.stats },
      draggable: true,
      connectable: false
    })
  }
  const edges = data.edges.map(e => ({
    id: `e-${e.id}`,
    source: e.source,
    target: e.target,
    type: e.type === 'FEEDBACK' ? 'default' : 'smoothstep',
    animated: e.type !== 'FEEDBACK' && !isDone(data.nodes.find(n => n.id === e.source)?.status) && data.nodes.find(n => n.id === e.target)?.blocked,
    label: e.note || (e.type === 'FEEDBACK' ? $t('common.loop') : ''),
    labelStyle: { fontSize: '11px', fill: e.type === 'FEEDBACK' ? '#7c3aed' : '#78716c' },
    labelBgStyle: { fill: '#fff' },
    class: `dep-edge dep-${e.type.toLowerCase()}` + (critical.has(e.source) && critical.has(e.target) && e.type === 'BLOCKS' ? ' dep-critical' : ''),
    markerEnd: 'arrowclosed',
    data: { dependencyId: e.id, type: e.type, note: e.note, source: e.source, target: e.target }
  }))
  if (data.milestone) {
    for (const n of data.nodes) {
      if (!n.isTerminal || n.external) continue
      edges.push({
        id: `e-ms-${n.id}`, source: n.id, target: `m-${data.milestone.id}`, type: 'smoothstep',
        class: 'dep-edge dep-terminal', markerEnd: 'arrowclosed', selectable: false, data: { terminal: true }
      })
    }
  }
  if (ghost) {
    for (const n of ghost.nodes) nodes.push({ id: n.id, type: 'task', position: pos.get(n.id) || { x: 0, y: 0 }, data: { ...n, ghost: true, tone: 'ghost', status: 'TODO', predecessors: [], successors: [], blockedBy: [], subtaskStats: { total: 0, done: 0 } }, draggable: true, connectable: false, selectable: false })
    for (const e of ghost.edges) edges.push({ id: e.id, source: e.source, target: e.target, type: 'smoothstep', class: 'dep-edge dep-ghost', markerEnd: 'arrowclosed', selectable: false, data: { ghost: true } })
  }
  return { nodes, edges }
}
