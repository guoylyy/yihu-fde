// v2.9.0(#1162) 看板派工自动开发: 派工单 / 运行 / 事件 的业务逻辑
//
// 口径(docs/01-产品与需求/看板派工自动开发方案-v2.9.md §1):
// - 派工单 = 人在路径图上点「启动」: 项目 + 里程碑 + 一批任务(按拓扑序) + 指定机器人(或任意) + 备注; 建即 RUNNING
// - 运行   = 派工单里每个任务一条; 机器人 claim 时服务端挑「进行中派工单里第一条 PENDING 且前置任务都完成」的运行原子领取
// - 领取 → 任务 IN_PROGRESS; 完成 → 任务 DONE + 评论; 失败 → 任务回 QUEUED, 运行 FAILED 可重派
// - 心跳超 STALE_MINUTES 标失联(派生, UI 用); 超 RELEASE_MINUTES 由 cron 释放回 PENDING 供其他机器人接手
// - 一台机器同一时刻只领一个运行: claim 时若有未终态运行先返回它
import prisma from '../lib/prisma.js'
import { recordActivity } from '../lib/activity.js'
import { pushNotification } from '../lib/notify.js'
import { loadProjectRoadmap, DONE_STATUSES } from './roadmap.js'
import { isArchivedStatus } from './projectArchive.js'

export const DISPATCH_STATUSES = ['RUNNING', 'PAUSED', 'DONE', 'CANCELLED']
export const RUN_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']
export const RUN_TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED']
export const STALE_MINUTES = 30
export const RELEASE_MINUTES = 120
const sid = (v) => (v == null ? null : String(v))
const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })

async function addEvent(runId, { level = 'INFO', phase = null, progress = null, message, data = null }, db = prisma) {
  return db.devRunEvent.create({ data: { runId: BigInt(runId), level, phase: phase ? String(phase).slice(0, 40) : null, progress: progress == null ? null : Math.max(0, Math.min(100, Math.round(progress))), message: String(message || '').slice(0, 1000), data: data ?? undefined } })
}

/** 心跳 → AgentPresence(与巡检状态共用一张表, 看板「正在巡检」横幅也能看到机器人在干嘛) */
async function beatPresence(agentProfileId, { projectId, projectName, activity }) {
  if (!agentProfileId) return
  const profile = await prisma.agentProfile.findUnique({ where: { id: BigInt(agentProfileId) }, select: { name: true } })
  const data = { agentName: profile?.name || `Agent ${agentProfileId}`, projectId: projectId ? BigInt(projectId) : null, projectName: projectName || null, status: 'PATROLLING', activity: activity ? String(activity).slice(0, 300) : null, lastBeatAt: new Date() }
  await prisma.agentPresence.upsert({ where: { agentProfileId: BigInt(agentProfileId) }, create: { agentProfileId: BigInt(agentProfileId), ...data }, update: data }).catch(() => {})
}

// ===================== 派工单 =====================

/**
 * 创建派工单(= 启动)
 * @param {Object} p
 * @param {string} p.scope MILESTONE 里程碑全部未完成 / READY 只派可开始的 / TASKS 指定任务
 */
export async function createDispatch({ projectId, milestoneId = null, scope = 'MILESTONE', taskIds = [], agentProfileId = null, title, note = null, userId }) {
  const pid = BigInt(projectId)
  const project = await prisma.project.findFirst({ where: { id: pid, deletedAt: null }, select: { id: true, name: true } })
  if (!project) throw err(2004, '项目不存在')
  let milestone = null
  if (milestoneId) {
    milestone = await prisma.milestone.findFirst({ where: { id: BigInt(milestoneId), projectId: pid, deletedAt: null }, select: { id: true, name: true } })
    if (!milestone) throw err(2004, '里程碑不存在或不属于该项目')
  }
  if (agentProfileId) {
    const ap = await prisma.agentProfile.findFirst({ where: { id: BigInt(agentProfileId), deletedAt: null, status: 1 }, select: { id: true } })
    if (!ap) throw err(2004, '机器人档案不存在或已停用')
  }
  // 拓扑序来自路径图(整项目一张图, 跨里程碑前置也算)
  const rm = await loadProjectRoadmap(pid, milestoneId ? { milestoneId: String(milestoneId) } : {})
  const order = new Map(rm.topoOrder.map((id, i) => [id, i]))
  const nodeMap = new Map(rm.nodes.map(n => [n.id, n]))
  let candidates
  if (scope === 'TASKS') {
    const wanted = new Set(taskIds.map(String))
    candidates = rm.nodes.filter(n => wanted.has(n.id) && !n.external)
    if (candidates.length !== wanted.size) throw err(9002, '有任务不在该项目/里程碑内')
  } else if (scope === 'READY') {
    candidates = rm.nodes.filter(n => !n.external && n.ready)
  } else {
    candidates = rm.nodes.filter(n => !n.external && !DONE_STATUSES.includes(n.status))
  }
  candidates = candidates.filter(n => !DONE_STATUSES.includes(n.status))
  if (!candidates.length) throw err(9002, '没有可派工的任务（都已完成，或没有可开始的）')
  // 已在别的进行中派工单里的任务不重复派
  const busy = await prisma.devRun.findMany({ where: { taskId: { in: candidates.map(n => BigInt(n.id)) }, status: { in: ['PENDING', 'RUNNING'] } }, select: { taskId: true } })
  const busySet = new Set(busy.map(b => sid(b.taskId)))
  const fresh = candidates.filter(n => !busySet.has(n.id)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  if (!fresh.length) throw err(9005, '这些任务已经在别的派工单里排队/执行中')

  const dispatch = await prisma.$transaction(async (tx) => {
    const d = await tx.devDispatch.create({
      data: { projectId: pid, milestoneId: milestone ? milestone.id : null, title: (title || (milestone ? `派工：${milestone.name}` : `派工：${project.name}`)).slice(0, 200), note: note ? String(note).slice(0, 5000) : null, agentProfileId: agentProfileId ? BigInt(agentProfileId) : null, status: 'RUNNING', createdBy: BigInt(userId) }
    })
    for (const [i, n] of fresh.entries()) {
      const run = await tx.devRun.create({ data: { dispatchId: d.id, taskId: BigInt(n.id), seq: i, status: 'PENDING' } })
      await addEvent(run.id, { message: `进入派工单「${d.title}」，排队序 ${i + 1}/${fresh.length}` }, tx)
      // 收件箱任务顺手排入生产队列(与巡检模式口径一致: 自动开发只消化 QUEUED)
      if (n.status === 'TODO') await tx.task.update({ where: { id: BigInt(n.id) }, data: { status: 'QUEUED', queuedAt: new Date() } })
    }
    return d
  }, { timeout: 30000 })
  recordActivity({ actorId: userId, entity: 'project', entityId: pid, action: 'dev_dispatch_created', summary: `启动派工单「${dispatch.title}」，${fresh.length} 个任务`, data: { dispatchId: sid(dispatch.id), taskIds: fresh.map(n => n.id) } })
  return { ...serializeDispatch(dispatch), runCount: fresh.length, taskIds: fresh.map(n => n.id), skippedBusy: [...busySet] }
}

function serializeDispatch(d) {
  return { ...d, id: sid(d.id), projectId: sid(d.projectId), milestoneId: sid(d.milestoneId), agentProfileId: sid(d.agentProfileId), createdBy: sid(d.createdBy) }
}
export function serializeRun(r) {
  const stale = r.status === 'RUNNING' && r.heartbeatAt && (Date.now() - new Date(r.heartbeatAt).getTime()) > STALE_MINUTES * 60000
  return { ...r, id: sid(r.id), dispatchId: sid(r.dispatchId), taskId: sid(r.taskId), agentProfileId: sid(r.agentProfileId), stale, task: r.task ? { id: sid(r.task.id), title: r.task.title, status: r.task.status } : undefined, events: r.events ? r.events.map(serializeEvent) : undefined }
}
export function serializeEvent(e) { return { ...e, id: sid(e.id), runId: sid(e.runId) } }

export async function listDispatches({ projectId, status, includeDone = false }) {
  const where = { projectId: BigInt(projectId) }
  if (status) where.status = status
  else if (!includeDone) where.status = { in: ['RUNNING', 'PAUSED'] }
  const list = await prisma.devDispatch.findMany({ where, orderBy: { id: 'desc' }, take: 50, include: { runs: { select: { status: true } } } })
  return list.map(d => {
    const counts = {}
    for (const r of d.runs) counts[r.status] = (counts[r.status] || 0) + 1
    const { runs, ...rest } = d
    return { ...serializeDispatch(rest), counts, total: runs.length, done: (counts.SUCCEEDED || 0) + (counts.FAILED || 0) + (counts.CANCELLED || 0) }
  })
}

export async function getDispatch(id) {
  const d = await prisma.devDispatch.findUnique({ where: { id: BigInt(id) }, include: { runs: { orderBy: { seq: 'asc' }, include: { task: { select: { id: true, title: true, status: true } } } } } })
  if (!d) throw err(2004, '派工单不存在')
  const { runs, ...rest } = d
  return { ...serializeDispatch(rest), runs: runs.map(serializeRun) }
}

async function finishDispatchIfDone(dispatchId, db = prisma) {
  const open = await db.devRun.count({ where: { dispatchId: BigInt(dispatchId), status: { in: ['PENDING', 'RUNNING'] } } })
  if (open > 0) return false
  const d = await db.devDispatch.findUnique({ where: { id: BigInt(dispatchId) } })
  if (!d || ['DONE', 'CANCELLED'].includes(d.status)) return false
  await db.devDispatch.update({ where: { id: d.id }, data: { status: 'DONE', finishedAt: new Date() } })
  const runs = await db.devRun.findMany({ where: { dispatchId: d.id }, select: { status: true } })
  const ok = runs.filter(r => r.status === 'SUCCEEDED').length, bad = runs.filter(r => r.status === 'FAILED').length
  pushNotification({ userId: d.createdBy, type: 'DEV_DISPATCH_DONE', title: bad ? '🤖 派工单结束（有失败）' : '🤖 派工单全部完成', body: `「${d.title}」：成功 ${ok}${bad ? `，失败 ${bad}` : ''}`, link: `/admin/projects/${d.projectId}`, data: { dispatchId: sid(d.id), projectId: sid(d.projectId) } }).catch(() => {})
  return true
}

export async function setDispatchStatus({ id, action, userId }) {
  const d = await prisma.devDispatch.findUnique({ where: { id: BigInt(id) } })
  if (!d) throw err(2004, '派工单不存在')
  if (action === 'pause') {
    if (d.status !== 'RUNNING') throw err(9002, `当前状态 ${d.status} 不能暂停`)
    await prisma.devDispatch.update({ where: { id: d.id }, data: { status: 'PAUSED' } })
  } else if (action === 'resume') {
    if (d.status !== 'PAUSED') throw err(9002, `当前状态 ${d.status} 不能继续`)
    await prisma.devDispatch.update({ where: { id: d.id }, data: { status: 'RUNNING' } })
  } else if (action === 'cancel') {
    if (['DONE', 'CANCELLED'].includes(d.status)) throw err(9002, `当前状态 ${d.status} 不能取消`)
    await prisma.$transaction(async (tx) => {
      const pending = await tx.devRun.findMany({ where: { dispatchId: d.id, status: 'PENDING' }, select: { id: true, taskId: true } })
      for (const r of pending) { await tx.devRun.update({ where: { id: r.id }, data: { status: 'CANCELLED', finishedAt: new Date() } }); await addEvent(r.id, { level: 'WARN', message: '派工单被取消，未开始的运行作废' }, tx) }
      // 正在跑的运行也置取消(机器人下一次上报会收到 409, 自行停手); 任务状态保持 IN_PROGRESS 由人处理
      const running = await tx.devRun.findMany({ where: { dispatchId: d.id, status: 'RUNNING' }, select: { id: true } })
      for (const r of running) { await tx.devRun.update({ where: { id: r.id }, data: { status: 'CANCELLED', finishedAt: new Date() } }); await addEvent(r.id, { level: 'WARN', message: '派工单被取消，运行中止（任务保持生产中，请人工接手）' }, tx) }
      await tx.devDispatch.update({ where: { id: d.id }, data: { status: 'CANCELLED', finishedAt: new Date() } })
    })
  } else throw err(9002, 'action 必须为 pause/resume/cancel')
  recordActivity({ actorId: userId, entity: 'project', entityId: d.projectId, action: `dev_dispatch_${action}`, summary: `派工单「${d.title}」${{ pause: '暂停', resume: '继续', cancel: '取消' }[action]}` })
  return getDispatch(d.id)
}

/**
 * 项目关闭 / 里程碑完成时, 把还没跑完的机器人运行作废(机器人下一次上报收到 409 自行停手)。
 * milestoneId 不传 = 整个项目; 传了只作废这个里程碑里任务的运行。返回作废了几条
 */
export async function cancelOpenWork({ projectId, milestoneId = null, reason, userId }) {
  const runs = await prisma.devRun.findMany({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      dispatch: { projectId: BigInt(projectId), status: { in: ['RUNNING', 'PAUSED'] } },
      ...(milestoneId ? { task: { milestoneId: BigInt(milestoneId) } } : {})
    },
    select: { id: true, dispatchId: true, status: true }
  })
  if (!runs.length) return 0
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    for (const r of runs) {
      await tx.devRun.update({ where: { id: r.id }, data: { status: 'CANCELLED', finishedAt: now } })
      await addEvent(r.id, { level: 'WARN', message: `${reason}，${r.status === 'RUNNING' ? '运行中止（任务保持生产中，请人工确认）' : '未开始的运行作废'}` }, tx)
    }
    for (const dispatchId of new Set(runs.map(r => String(r.dispatchId)))) {
      const open = await tx.devRun.count({ where: { dispatchId: BigInt(dispatchId), status: { in: ['PENDING', 'RUNNING'] } } })
      if (!open) await tx.devDispatch.update({ where: { id: BigInt(dispatchId) }, data: { status: 'CANCELLED', finishedAt: now } })
    }
  })
  recordActivity({ actorId: userId, entity: 'project', entityId: BigInt(projectId), action: 'dev_dispatch_cancel', summary: `${reason}：作废 ${runs.length} 条机器人运行` })
  return runs.length
}

/** 这条运行还该不该跑: 任务已完成 / 删除、项目已关闭、里程碑已完成的不该(纯函数, 便于测试) */
export function runObsolete(task) {
  if (!task || task.deletedAt) return '任务已删除'
  if (DONE_STATUSES.includes(task.status)) return '任务已经完成'
  if (task.project && (task.project.deletedAt || isArchivedStatus(task.project.status))) return '项目已关闭'
  if (task.milestone && task.milestone.status === 'COMPLETED') return '里程碑已完成'
  return null
}

// ===================== 机器人侧 =====================

/** 任务的 BLOCKS 前置是否都完成(跨里程碑也算) */
async function prerequisitesDone(taskId) {
  const open = await prisma.taskDependency.count({ where: { successorId: BigInt(taskId), type: 'BLOCKS', deletedAt: null, predecessor: { deletedAt: null, status: { notIn: DONE_STATUSES } } } })
  return open === 0
}

/** 机器人拿活时的上下文包: 项目/里程碑/仓库/任务/上下游/派工备注 */
async function buildRunContext(run) {
  const task = await prisma.task.findUnique({ where: { id: run.taskId }, include: { project: { select: { id: true, code: true, name: true, description: true } }, milestone: { select: { id: true, name: true, goal: true } } } })
  const [repos, edges, subtasks, dispatch] = await Promise.all([
    prisma.projectRepository.findMany({ where: { projectId: task.projectId, deletedAt: null }, select: { name: true, url: true, defaultBranch: true } }),
    prisma.taskDependency.findMany({ where: { deletedAt: null, OR: [{ successorId: task.id }, { predecessorId: task.id }] }, include: { predecessor: { select: { id: true, title: true, status: true } }, successor: { select: { id: true, title: true, status: true } } } }),
    prisma.subtask.findMany({ where: { taskId: task.id, deletedAt: null }, orderBy: { order: 'asc' }, select: { id: true, title: true, done: true } }),
    prisma.devDispatch.findUnique({ where: { id: run.dispatchId }, select: { id: true, title: true, note: true } })
  ])
  const pick = (t) => ({ id: sid(t.id), title: t.title, status: t.status })
  return {
    project: { id: sid(task.project.id), code: task.project.code, name: task.project.name, description: task.project.description },
    milestone: task.milestone ? { id: sid(task.milestone.id), name: task.milestone.name, goal: task.milestone.goal } : null,
    repositories: repos,
    dispatch: { id: sid(dispatch.id), title: dispatch.title, note: dispatch.note },
    task: { id: sid(task.id), title: task.title, description: task.description, priority: task.priority, status: task.status, dueDate: task.dueDate, subtasks: subtasks.map(s => ({ id: sid(s.id), title: s.title, done: s.done === 1 })) },
    predecessors: edges.filter(e => e.successorId === task.id).map(e => ({ type: e.type, ...pick(e.predecessor) })),
    successors: edges.filter(e => e.predecessorId === task.id).map(e => ({ type: e.type, ...pick(e.successor) })),
    howto: '按任务描述开发；过程中每个阶段调 report_dev_run_progress（phase/progress/message）；commit message 带 #任务号；完成调 complete_dev_run 带 summary 与 commits；做不了调 fail_dev_run 说明原因。'
  }
}

/**
 * 机器人领活。agentProfileId 来自 Agent 专属 Key; 经理/管理员可传 agentProfileId 代领(测试/演练用)
 * @returns { run, context } 或 null(没活)
 */
export async function claimRun({ agentProfileId, userId, projectId = null }) {
  if (!agentProfileId) throw err(1002, '当前凭证未绑定机器人档案：请用该机器人的专属 API Key 调用')
  const apid = BigInt(agentProfileId)
  // #1280 被禁/注销档案: 专用错误码 9030 + 停手文案(区别于档案不存在的 2004)
  {
    const p = await prisma.agentProfile.findUnique({ where: { id: apid }, select: { status: true, name: true, deletedAt: true } })
    if (!p || p.deletedAt) throw err(2004, '机器人档案不存在或已删除')
    if (p.status !== 1) {
      const what = p.status === -1 ? '已注销' : '已被禁用'
      throw err(9030, `机器人档案「${p.name}」${what}，不能领取新任务。请立即停止本轮工作并退出，不要重试（恢复需主人或管理员在平台上重新启用）。`, { httpStatus: 403 })
    }
  }
  const profile = await prisma.agentProfile.findFirst({ where: { id: apid, deletedAt: null, status: 1 }, select: { id: true, name: true, userId: true } })
  if (!profile) throw err(2004, '机器人档案不存在或已停用')
  // 手上还有没跑完的, 先把它还回去(一台机器一次只干一件)
  const inHand = await prisma.devRun.findFirst({ where: { agentProfileId: apid, status: 'RUNNING' }, orderBy: { id: 'asc' } })
  if (inHand) {
    await prisma.devRun.update({ where: { id: inHand.id }, data: { heartbeatAt: new Date() } })
    return { run: serializeRun(inHand), context: await buildRunContext(inHand), resumed: true }
  }
  const dispatchWhere = { status: 'RUNNING', OR: [{ agentProfileId: null }, { agentProfileId: apid }], ...(projectId ? { projectId: BigInt(projectId) } : {}) }
  const candidates = await prisma.devRun.findMany({
    where: { status: 'PENDING', dispatch: dispatchWhere },
    orderBy: [{ dispatch: { startedAt: 'asc' } }, { seq: 'asc' }],
    take: 50, include: { dispatch: { select: { projectId: true, title: true } } }
  })
  for (const c of candidates) {
    // 已经不该跑的(任务做完了、项目关了、里程碑完成了): 顺手作废, 不领
    const target = await prisma.task.findUnique({
      where: { id: c.taskId },
      select: { status: true, deletedAt: true, project: { select: { status: true, deletedAt: true } }, milestone: { select: { status: true } } }
    })
    const obsolete = runObsolete(target)
    if (obsolete) {
      await prisma.devRun.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'CANCELLED', finishedAt: new Date() } })
      await addEvent(c.id, { level: 'WARN', message: `${obsolete}，运行作废` })
      await finishDispatchIfDone(c.dispatchId)
      continue
    }
    if (!(await prerequisitesDone(c.taskId))) continue
    const now = new Date()
    const claimed = await prisma.devRun.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'RUNNING', agentProfileId: apid, agentName: profile.name, claimedAt: now, startedAt: now, heartbeatAt: now, attempts: { increment: 1 }, progress: 0, phase: '领取', message: `${profile.name} 已领取` } })
    if (claimed.count !== 1) continue   // 被别的机器人抢先了, 看下一条
    const run = await prisma.devRun.findUnique({ where: { id: c.id } })
    const task = await prisma.task.findUnique({ where: { id: run.taskId }, select: { id: true, title: true, status: true, projectId: true, assigneeId: true } })
    if (task && !['IN_PROGRESS', ...DONE_STATUSES].includes(task.status)) {
      await prisma.task.update({ where: { id: task.id }, data: { status: 'IN_PROGRESS', startedAt: task.status === 'IN_PROGRESS' ? undefined : now } })
    }
    // 没有负责人的任务: 记到机器人主人名下, 否则在谁的「我的任务」里都看不到
    if (task && !task.assigneeId && profile.userId) {
      let owner = await prisma.engineer.findUnique({ where: { userId: profile.userId }, select: { id: true } })
      if (!owner) owner = await prisma.engineer.create({ data: { userId: profile.userId }, select: { id: true } })
      await prisma.task.update({ where: { id: task.id }, data: { assigneeId: owner.id } })
      recordActivity({ actorId: userId, entity: 'task', entityId: task.id, action: 'assigned', summary: `任务 "${task.title}" 由机器人「${profile.name}」领取，记到它的主人名下` })
    }
    await addEvent(run.id, { phase: '领取', progress: 0, message: `🤖 ${profile.name} 领取了任务 #${task.id} ${task.title}` })
    await prisma.comment.create({ data: { entity: 'task', entityId: task.id, authorId: BigInt(userId), content: `🤖 机器人「${profile.name}」已领取本任务（派工单「${c.dispatch.title}」，第 ${run.attempts} 次尝试），开始自动开发。` } }).catch(() => {})
    recordActivity({ actorId: userId, entity: 'task', entityId: task.id, action: 'dev_run_claimed', summary: `机器人「${profile.name}」领取任务 "${task.title}"`, data: { runId: sid(run.id), dispatchId: sid(run.dispatchId) } })
    const project = await prisma.project.findUnique({ where: { id: task.projectId }, select: { name: true } })
    await beatPresence(apid, { projectId: task.projectId, projectName: project?.name, activity: `派工开发 #${task.id} ${task.title}` })
    return { run: serializeRun(run), context: await buildRunContext(run), resumed: false }
  }
  await beatPresence(apid, { projectId, activity: '派工模式：暂无可领取的运行' })
  return null
}

/** 无副作用探活: 这台机器人现在能领几条(手上有活也算 1) */
export async function peekRuns({ agentProfileId, projectId = null }) {
  const apid = BigInt(agentProfileId)
  const inHand = await prisma.devRun.count({ where: { agentProfileId: apid, status: 'RUNNING' } })
  if (inHand) return { available: inHand, inHand: true }
  const dispatchWhere = { status: 'RUNNING', OR: [{ agentProfileId: null }, { agentProfileId: apid }], ...(projectId ? { projectId: BigInt(projectId) } : {}) }
  const candidates = await prisma.devRun.findMany({ where: { status: 'PENDING', dispatch: dispatchWhere }, select: { taskId: true }, take: 50 })
  let n = 0
  for (const c of candidates) if (await prerequisitesDone(c.taskId)) n++
  return { available: n, inHand: false, pending: candidates.length }
}

/** 校验运行归属: 机器人本人 或 经理/管理员 */
async function loadOwnedRun(runId, { agentProfileId, role }) {
  const run = await prisma.devRun.findUnique({ where: { id: BigInt(runId) }, include: { task: { select: { id: true, title: true, projectId: true, status: true } }, dispatch: { select: { id: true, title: true, createdBy: true } } } })
  if (!run) throw err(2004, '运行不存在')
  const mine = agentProfileId && sid(run.agentProfileId) === String(agentProfileId)
  const manager = ['ADMIN', 'MANAGER'].includes(role)
  if (!mine && !manager) throw err(9003, '只有领取该运行的机器人或经理可以操作')
  if (run.status !== 'RUNNING') throw err(9009, `运行已是 ${run.status}，不能再上报（派工单可能已取消或被释放，请重新 claim）`, { status: run.status })
  return run
}

export async function reportProgress({ runId, progress, phase, message, level = 'INFO', data = null, agentProfileId, userId, role }) {
  const run = await loadOwnedRun(runId, { agentProfileId, role })
  // #1280 被禁/注销档案拒绝进度上报(complete_dev_run 例外放行作收尾通道, 见文档)
  {
    const p = run.agentProfileId
      ? await prisma.agentProfile.findUnique({ where: { id: run.agentProfileId }, select: { status: true, name: true } })
      : null
    if (p && p.status !== 1) {
      const what = p.status === -1 ? '已注销' : '已被禁用'
      throw err(9030, `机器人档案「${p.name}」${what}，进度上报被拒绝。请停止工作：用 complete_dev_run(允许收尾)或直接退出，不要重试进度上报。`, { httpStatus: 403 })
    }
  }
  const patch = { heartbeatAt: new Date() }
  if (progress != null) patch.progress = Math.max(0, Math.min(99, Math.round(Number(progress))))
  if (phase) patch.phase = String(phase).slice(0, 40)
  if (message) patch.message = String(message).slice(0, 500)
  const updated = await prisma.devRun.update({ where: { id: run.id }, data: patch })
  await addEvent(run.id, { level: ['INFO', 'WARN', 'ERROR'].includes(level) ? level : 'INFO', phase: patch.phase || run.phase, progress: patch.progress ?? run.progress, message: message || `${phase || ''} ${progress ?? ''}`.trim() || '进度上报', data })
  await beatPresence(run.agentProfileId, { projectId: run.task.projectId, activity: `#${run.task.id} ${phase || ''} ${patch.progress ?? run.progress}% ${message || ''}`.trim() })
  return serializeRun(updated)
}

export async function completeRun({ runId, summary, commits = [], branch = null, prUrl = null, testResult = null, agentProfileId, userId, role }) {
  const run = await loadOwnedRun(runId, { agentProfileId, role })
  const result = { summary: String(summary || '').slice(0, 5000), commits: (Array.isArray(commits) ? commits : []).slice(0, 50).map(c => typeof c === 'string' ? { sha: c } : { sha: c.sha || c.hash || '', url: c.url || null, message: c.message || null }), branch, prUrl, testResult }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.devRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', progress: 100, phase: '完成', message: result.summary.slice(0, 500) || '完成', result, finishedAt: now, heartbeatAt: now } })
    await addEvent(run.id, { phase: '完成', progress: 100, message: `✅ 完成：${result.summary.slice(0, 900)}`, data: { commits: result.commits.length, branch, prUrl } }, tx)
    if (!DONE_STATUSES.includes(run.task.status)) await tx.task.update({ where: { id: run.task.id }, data: { status: 'DONE', completedAt: now } })
    const commitLines = result.commits.map(c => `- ${c.url ? `[${(c.sha || '').slice(0, 8)}](${c.url})` : (c.sha || '').slice(0, 8)}${c.message ? ` ${c.message}` : ''}`).join('\n')
    await tx.comment.create({ data: { entity: 'task', entityId: run.task.id, authorId: BigInt(userId), content: `🤖 机器人「${run.agentName || ''}」完成开发（派工单「${run.dispatch.title}」）\n\n${result.summary}${commitLines ? `\n\n**提交**\n${commitLines}` : ''}${branch ? `\n分支：${branch}` : ''}${prUrl ? `\nPR：${prUrl}` : ''}${testResult ? `\n测试：${typeof testResult === 'string' ? testResult : JSON.stringify(testResult)}` : ''}` } })
  })
  recordActivity({ actorId: userId, entity: 'task', entityId: run.task.id, action: 'completed', summary: `机器人「${run.agentName || ''}」完成任务 "${run.task.title}"`, data: { runId: sid(run.id) } })
  await finishDispatchIfDone(run.dispatchId)
  await beatPresence(run.agentProfileId, { projectId: run.task.projectId, activity: `完成 #${run.task.id}，等待下一单` })
  return getRun(run.id)
}

export async function failRun({ runId, error, retryable = false, agentProfileId, userId, role }) {
  const run = await loadOwnedRun(runId, { agentProfileId, role })
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.devRun.update({ where: { id: run.id }, data: { status: 'FAILED', phase: '失败', message: String(error || '').slice(0, 500), error: String(error || '').slice(0, 20000), finishedAt: now, heartbeatAt: now } })
    await addEvent(run.id, { level: 'ERROR', phase: '失败', message: `❌ 失败：${String(error || '').slice(0, 900)}`, data: { retryable } }, tx)
    // 任务回等候生产, 人可以改派/自己做; 若已被人置完成则不动
    if (run.task.status === 'IN_PROGRESS') await tx.task.update({ where: { id: run.task.id }, data: { status: 'QUEUED' } })
    await tx.comment.create({ data: { entity: 'task', entityId: run.task.id, authorId: BigInt(userId), content: `🤖 机器人「${run.agentName || ''}」未能完成本任务（派工单「${run.dispatch.title}」）：\n${String(error || '').slice(0, 2000)}${retryable ? '\n（机器人认为可重试）' : ''}` } })
    if (retryable && run.attempts < 3) {
      const again = await tx.devRun.create({ data: { dispatchId: run.dispatchId, taskId: run.taskId, seq: run.seq, status: 'PENDING', attempts: run.attempts } })
      await addEvent(again.id, { level: 'WARN', message: `上一次尝试失败（第 ${run.attempts} 次），自动重新排队` }, tx)
    }
  })
  recordActivity({ actorId: userId, entity: 'task', entityId: run.task.id, action: 'dev_run_failed', summary: `机器人「${run.agentName || ''}」执行任务 "${run.task.title}" 失败`, data: { runId: sid(run.id) } })
  pushNotification({ userId: run.dispatch.createdBy, type: 'DEV_RUN_FAILED', title: '🤖 机器人执行失败', body: `#${run.task.id} ${run.task.title}：${String(error || '').slice(0, 120)}`, link: `/admin/tasks?open=${run.task.id}`, data: { runId: sid(run.id), taskId: sid(run.task.id) } }).catch(() => {})
  await finishDispatchIfDone(run.dispatchId)
  return getRun(run.id)
}

export async function getRun(runId, { eventsTake = 50 } = {}) {
  const r = await prisma.devRun.findUnique({ where: { id: BigInt(runId) }, include: { task: { select: { id: true, title: true, status: true } }, events: { orderBy: { id: 'desc' }, take: eventsTake } } })
  if (!r) throw err(2004, '运行不存在')
  const out = serializeRun(r)
  out.events = out.events.reverse()
  return out
}

/** 人工: 取消单个运行 / 重派(FAILED 或 CANCELLED 的任务再排一条 PENDING) */
export async function cancelRun({ runId, userId }) {
  const run = await prisma.devRun.findUnique({ where: { id: BigInt(runId) }, include: { task: { select: { id: true, status: true } } } })
  if (!run) throw err(2004, '运行不存在')
  if (RUN_TERMINAL.includes(run.status)) throw err(9002, `运行已是 ${run.status}`)
  await prisma.$transaction(async (tx) => {
    await tx.devRun.update({ where: { id: run.id }, data: { status: 'CANCELLED', finishedAt: new Date() } })
    await addEvent(run.id, { level: 'WARN', message: '人工取消该运行' }, tx)
    if (run.status === 'PENDING' && run.task.status === 'QUEUED') { /* 保持排队态, 人可再派 */ }
  })
  await finishDispatchIfDone(run.dispatchId)
  return getRun(run.id)
}
export async function redispatchRun({ runId, userId }) {
  const run = await prisma.devRun.findUnique({ where: { id: BigInt(runId) }, include: { dispatch: true, task: { select: { id: true, status: true } } } })
  if (!run) throw err(2004, '运行不存在')
  if (!['FAILED', 'CANCELLED'].includes(run.status)) throw err(9002, `只有失败/取消的运行可以重派（当前 ${run.status}）`)
  if (DONE_STATUSES.includes(run.task.status)) throw err(9002, '任务已完成，无需重派')
  const busy = await prisma.devRun.findFirst({ where: { taskId: run.taskId, status: { in: ['PENDING', 'RUNNING'] } } })
  if (busy) throw err(9005, '该任务已有排队/执行中的运行')
  const again = await prisma.$transaction(async (tx) => {
    if (['DONE', 'CANCELLED'].includes(run.dispatch.status)) await tx.devDispatch.update({ where: { id: run.dispatchId }, data: { status: 'RUNNING', finishedAt: null } })
    const r = await tx.devRun.create({ data: { dispatchId: run.dispatchId, taskId: run.taskId, seq: run.seq, status: 'PENDING', attempts: run.attempts } })
    await addEvent(r.id, { message: '人工重派，重新排队' }, tx)
    if (run.task.status === 'TODO') await tx.task.update({ where: { id: run.taskId }, data: { status: 'QUEUED', queuedAt: new Date() } })
    return r
  })
  recordActivity({ actorId: userId, entity: 'task', entityId: run.taskId, action: 'dev_run_redispatched', summary: '重派机器人运行', data: { runId: sid(again.id) } })
  return getRun(again.id)
}

/** cron: 失联释放 —— RUNNING 且心跳超 RELEASE_MINUTES 的运行退回 PENDING, 任务回 QUEUED */
export async function releaseStaleRuns({ minutes = RELEASE_MINUTES } = {}) {
  const cutoff = new Date(Date.now() - minutes * 60000)
  const stale = await prisma.devRun.findMany({ where: { status: 'RUNNING', heartbeatAt: { lt: cutoff } }, include: { task: { select: { id: true, status: true } } } })
  for (const r of stale) {
    await prisma.$transaction(async (tx) => {
      await tx.devRun.update({ where: { id: r.id }, data: { status: 'PENDING', agentProfileId: null, agentName: null, claimedAt: null, startedAt: null, heartbeatAt: null, progress: 0, phase: null, message: `上一位机器人「${r.agentName || ''}」失联超 ${minutes} 分钟，已释放` } })
      await addEvent(r.id, { level: 'WARN', message: `机器人「${r.agentName || ''}」心跳超 ${minutes} 分钟无响应，运行释放回队列` }, tx)
      if (r.task.status === 'IN_PROGRESS') await tx.task.update({ where: { id: r.task.id }, data: { status: 'QUEUED' } })
    })
  }
  return { released: stale.length }
}

/** roadmap 用: 项目内任务 → 最新运行摘要, 以及进行中的派工单 */
export async function runsForProject(projectId) {
  const pid = BigInt(projectId)
  const runs = await prisma.devRun.findMany({ where: { task: { projectId: pid, deletedAt: null }, dispatch: { projectId: pid } }, orderBy: { id: 'desc' }, take: 500, select: { id: true, dispatchId: true, taskId: true, status: true, progress: true, phase: true, message: true, agentName: true, agentProfileId: true, heartbeatAt: true, finishedAt: true, attempts: true, updatedAt: true } })
  const byTask = {}
  for (const r of runs) {
    const k = sid(r.taskId)
    // 同任务多条: 未终态优先, 否则最新一条
    if (!byTask[k] || (!['PENDING', 'RUNNING'].includes(byTask[k].status) && ['PENDING', 'RUNNING'].includes(r.status))) byTask[k] = serializeRun(r)
  }
  const dispatches = await listDispatches({ projectId: projectId })

  // v2.12.0(#1258) 巡检模式并入同一 runs map: presence 带着 taskId 且心跳新鲜,
  // 节点即可无差别展示。派工 run 已占位时不覆盖（派工优先）。
  const staleLine = new Date(Date.now() - STALE_MINUTES * 60000)
  const patrols = await prisma.agentPresence.findMany({
    where: { taskId: { not: null }, projectId: pid, lastBeatAt: { gte: staleLine }, status: { not: 'OFFLINE' } },
    select: { taskId: true, agentProfileId: true, agentName: true, phase: true, progress: true, activity: true, lastBeatAt: true }
  })
  for (const p of patrols) {
    const k = sid(p.taskId)
    if (byTask[k]) continue   // 派工优先
    byTask[k] = {
      id: null, dispatchId: null, taskId: k,
      agentProfileId: sid(p.agentProfileId), agentName: p.agentName,
      status: 'RUNNING',     // 复用节点 run-running 的视觉态
      phase: p.phase || '巡检中',
      progress: p.progress ?? null,   // 巡检无进度时给 null, 节点不显示百分比(不假装)
      message: p.activity, heartbeatAt: p.lastBeatAt, stale: false,
      patrol: true           // 标记来源=巡检, 与派工区分
    }
  }

  return { runs: byTask, dispatches, activeDispatchCount: dispatches.filter(d => d.status === 'RUNNING').length }
}

/** 机器人清单: 平台为 CLAUDE_CODE 或能力标签含 dev-robot 的档案 + 在线态 */
export async function listRobots() {
  const [profiles, presences] = await Promise.all([
    prisma.agentProfile.findMany({ where: { deletedAt: null, status: 1 }, orderBy: { id: 'asc' }, include: { user: { select: { id: true, name: true } } } }),
    prisma.agentPresence.findMany()
  ])
  const pmap = new Map(presences.map(p => [sid(p.agentProfileId), p]))
  const running = await prisma.devRun.findMany({ where: { status: 'RUNNING' }, select: { agentProfileId: true, taskId: true, progress: true, phase: true } })
  const rmap = new Map(running.map(r => [sid(r.agentProfileId), r]))
  const now = Date.now()
  return profiles
    .filter(p => p.platform === 'CLAUDE_CODE' || /dev-robot|robot|自动开发/i.test(p.capabilities || '') || pmap.has(sid(p.id)))
    .map(p => {
      const pr = pmap.get(sid(p.id))
      const online = pr && pr.status !== 'OFFLINE' && (now - new Date(pr.lastBeatAt).getTime()) < 10 * 60000
      const cur = rmap.get(sid(p.id))
      return { id: sid(p.id), name: p.name, platform: p.platform, capabilities: p.capabilities, owner: p.user?.name, online: Boolean(online), lastBeatAt: pr?.lastBeatAt || p.lastActiveAt || null, activity: pr?.activity || null, current: cur ? { taskId: sid(cur.taskId), progress: cur.progress, phase: cur.phase } : null }
    })
}
