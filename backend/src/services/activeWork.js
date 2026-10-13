// v2.12.0(#1254) activeWork 统一摘要: 把「这个任务现在被谁、以什么方式做着」
// 批量聚合成一个字段, 供 list_project_tasks / get_task / get_project_detail 复用。
//
// 合成优先级（关键, 别搞混）:
//   1. 有 RUNNING 的 devRun            → DISPATCH · DEVELOPING
//   2. 无 run, 但 presence 的心跳任务  → PATROL · PATROLLING
//   3. 任务 IN_PROGRESS 但两者都无     → MANUAL（绝不标成开发中）
//   4. 任务 QUEUED                     → QUEUED
//   5. 其余                            → null（不需要徽标）
// 失联: DISPATCH 看 run.heartbeatAt、PATROL 看 presence.lastBeatAt, 超 staleMinutes。
import prisma from '../lib/prisma.js'
import { STALE_MINUTES } from './devDispatch.js'

/**
 * 批量构建 taskId -> activeWork（一次查 runs、一次查 presence, 禁止 N+1）
 * @param {bigint[]} taskIds 当前页/当前项目要展示的任务 id
 * @param {Object} opts
 * @param {Map<bigint,{startedAt:Date|null}>} [opts.taskStartedAt] taskId -> 开工时间(判断心跳是否在开工之后)
 * @param {number} [opts.staleMinutes] 失联阈值, 默认 30
 * @param {boolean} [opts.internal=true) 是否内部视角(客户视角只给状态一层)
 * @returns {Promise<Map<string,object>>}
 */
export async function buildActiveWorkMap(taskIds, opts = {}) {
  const staleMinutes = opts.staleMinutes || STALE_MINUTES
  const ids = taskIds.filter(Boolean)
  const result = new Map()
  if (!ids.length) return result

  const now = Date.now()
  const staleLine = new Date(now - staleMinutes * 60 * 1000)

  // ① 批量取这些任务下 RUNNING 的运行（一个任务理论上至多一条活跃 run）
  const runs = await prisma.devRun.findMany({
    where: { taskId: { in: ids }, status: 'RUNNING' },
    select: {
      taskId: true, agentProfileId: true, agentName: true,
      progress: true, phase: true, message: true, heartbeatAt: true
    }
  })
  const runByTask = new Map()
  for (const r of runs) runByTask.set(String(r.taskId), r)

  // ② 批量取这些任务相关、且心跳落在任务上的 presence（taskId IN 本批）
  const presences = await prisma.agentPresence.findMany({
    where: { taskId: { in: ids } },
    select: {
      taskId: true, agentProfileId: true, agentName: true,
      phase: true, progress: true, activity: true, lastBeatAt: true, status: true
    }
  })
  const presenceByTask = new Map()
  for (const p of presences) presenceByTask.set(String(p.taskId), p)

  for (const tid of ids) {
    const key = String(tid)
    const run = runByTask.get(key)
    const presence = presenceByTask.get(key)
    const startedAt = opts.taskStartedAt?.get(tid)?.startedAt ?? null
    let work = null

    if (run) {
      // 派工模式
      const beat = run.heartbeatAt
      const stale = !beat || beat < staleLine
      work = {
        mode: 'DISPATCH',
        agentProfileId: String(run.agentProfileId || ''),
        status: stale ? 'STALE' : 'DEVELOPING',
        progress: run.progress,
        phase: run.phase,
        message: run.message,
        heartbeatAt: beat,
        stale
      }
      if (run.agentName) work.agentName = run.agentName
    } else if (presence && (!startedAt || presence.lastBeatAt >= startedAt)) {
      // 巡检模式：心跳必须晚于该任务开工时间, 否则可能是上个任务残留
      const stale = presence.status === 'OFFLINE' || presence.lastBeatAt < staleLine
      work = {
        mode: 'PATROL',
        agentProfileId: String(presence.agentProfileId || ''),
        status: stale ? 'STALE' : 'PATROLLING',
        message: presence.activity,
        heartbeatAt: presence.lastBeatAt,
        stale
      }
      // 巡检只有在 agent 主动报告时才带 phase/progress, 否则一律没有（不假装）
      if (presence.phase) work.phase = presence.phase
      if (presence.progress != null) work.progress = presence.progress
      work.agentName = presence.agentName
    }
    result.set(key, work)
  }

  // ③ 兜底状态不依赖 run/presence: 需要调用方按任务本身 status 补 MANUAL/QUEUED。
  //    这里只处理自动来源; 调用方对结果为 null 的任务再按状态补。
  return result
}

/**
 * 给没有自动来源的任务按自身状态补兜底 activeWork
 * @param {object} task 含 status
 * @param {object|null} current buildActiveWorkMap 的结果
 */
export function fallbackActiveWork(task, current) {
  if (current) return current
  if (task.status === 'IN_PROGRESS') {
    return { mode: null, agentProfileId: '', status: 'MANUAL', message: null, heartbeatAt: null, stale: false }
  }
  if (task.status === 'QUEUED') {
    return { mode: null, agentProfileId: '', status: 'QUEUED', message: null, heartbeatAt: null, stale: false }
  }
  return null
}

/**
 * 客户/外部视角收敛: 只留「正在自动开发」一层, 抹掉 agent 身份与内部 message。
 * MANUAL/QUEUED 原样保留（不含敏感信息）。
 */
export function redactActiveWork(work) {
  if (!work) return null
  if (work.agentProfileId || work.agentName || work.message) {
    return { status: '正在自动开发' }
  }
  return work
}
