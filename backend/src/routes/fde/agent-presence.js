// v2.0.9(#435) Agent 巡检状态上报
// POST /api/fde/agent-presence            —— agent 经 MCP report_presence 上报心跳(幂等 upsert)
// GET  /api/fde/agent-presence/active     —— 活跃巡检 agent 列表(看板展示用, STALE 分钟内有心跳才算在线)
import { Router } from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth } from '../../lib/auth.js'
import { agentDisabledRejection } from '../../services/agentProfiles.js'

const router = Router()
router.use(internalAuth)

// 超过这么多分钟无心跳视为离线(巡检间隔 10 分钟, 3 倍容错)
const STALE_MINUTES = 30

/**
 * POST /
 * body: { projectId?, status?: PATROLLING|IDLE|OFFLINE, activity? }
 * 身份取自 token 的 agentProfileId(配置包 Key 自动带出), 无 Agent 档案的调用(纯用户 token)忽略。
 */
router.post('/', async (req, res) => {
  try {
    const agentProfileId = req.user.agentProfileId
    if (!agentProfileId) {
      return res.status(400).json({ code: 1002, message: '当前凭证未绑定 Agent 档案(请用开发配置包的 API Key 调用)' })
    }
    // #1280 被禁/注销档案拒绝心跳(在写库之前, 不产生脏数据)
    const rejection = await agentDisabledRejection(agentProfileId)
    if (rejection) return res.status(rejection.status).json(rejection.body)
    const { projectId, status = 'PATROLLING', activity } = req.body || {}
    if (!['PATROLLING', 'IDLE', 'OFFLINE'].includes(status)) {
      return res.status(400).json({ code: 1001, message: 'status 必须是 PATROLLING / IDLE / OFFLINE' })
    }
    let projectName = null
    let pid = null
    if (projectId) {
      try { pid = BigInt(projectId) } catch { return res.status(400).json({ code: 1001, message: 'projectId 不合法' }) }
      const p = await prisma.project.findFirst({ where: { id: pid, deletedAt: null }, select: { name: true } })
      if (!p) return res.status(404).json({ code: 2004, message: '项目不存在' })
      projectName = p.name
    }
    // v2.12.0(#1252): 任务颗粒度。仅当 body 带 taskId 字段(含 null/空串=清空)才覆盖,
    // 不带 taskId 的旧调用保持原值(向后兼容纯心跳)。
    let taskPatch = {}
    if ('taskId' in req.body) {
      const raw = req.body.taskId
      if (raw === null || raw === '' || raw === undefined) {
        taskPatch = { taskId: null, taskTitle: null, phase: null, progress: null }
      } else {
        let tid
        try { tid = BigInt(raw) } catch { return res.status(400).json({ code: 1001, message: 'taskId 不合法' }) }
        const t = await prisma.task.findFirst({ where: { id: tid, deletedAt: null }, select: { title: true, projectId: true } })
        if (!t) return res.status(404).json({ code: 2004, message: '任务不存在' })
        if (pid && t.projectId !== pid) {
          return res.status(400).json({ code: 1001, message: 'taskId 与 projectId 不属于同一项目' })
        }
        taskPatch = {
          taskId: tid,
          taskTitle: t.title.slice(0, 200),
          ...('phase' in req.body ? { phase: req.body.phase ? String(req.body.phase).slice(0, 30) : null } : {}),
          ...('progress' in req.body ? { progress: req.body.progress === null ? null : Math.min(99, Math.max(0, parseInt(req.body.progress, 10))) } : {})
        }
      }
    }

    const profile = await prisma.agentProfile.findUnique({ where: { id: BigInt(agentProfileId) }, select: { name: true } })
    const data = {
      agentName: profile?.name || `Agent ${agentProfileId}`,
      projectId: pid,
      projectName,
      status,
      activity: activity ? String(activity).slice(0, 300) : null,
      lastBeatAt: new Date(),
      ...taskPatch
    }
    // 幂等心跳: 同一 agent 永远只有一行, 重复上报刷新
    const saved = await prisma.agentPresence.upsert({
      where: { agentProfileId: BigInt(agentProfileId) },
      create: { agentProfileId: BigInt(agentProfileId), ...data },
      update: data
    })
    res.json({ code: 0, message: 'ok', data: { id: String(saved.id), status: saved.status, lastBeatAt: saved.lastBeatAt } })
  } catch (e) {
    console.error('[agent-presence POST]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /
 * v2.12.0(#1253) presence 读取出口: 查巡检 agent 列表, 默认只返回活跃(STALE 分钟内有心跳)。
 * query: projectId?, agentProfileId?(仅 MANAGER/ADMIN 可代查), activeOnly 默认 true, staleMinutes 默认 30
 * 非管理角色只能看得到与本凭证相关的行; 内部字段(activity)仅管理角色返回。
 */
router.get('/', async (req, res) => {
  try {
    const MANAGE_ROLES = ['ADMIN', 'MANAGER']
    const isManager = MANAGE_ROLES.includes(req.user.role)
    const staleMinutes = Math.min(1440, Math.max(1, parseInt(req.query.staleMinutes, 10) || STALE_MINUTES))
    const activeOnly = req.query.activeOnly !== 'false'

    const where = {}
    if (req.query.projectId) {
      try { where.projectId = BigInt(req.query.projectId) } catch { return res.status(400).json({ code: 1001, message: 'projectId 不合法' }) }
    }
    if (req.query.agentProfileId) {
      if (!isManager) return res.status(403).json({ code: 1003, message: '仅管理员可按 agentProfileId 查询' })
      try { where.agentProfileId = BigInt(req.query.agentProfileId) } catch { return res.status(400).json({ code: 1001, message: 'agentProfileId 不合法' }) }
    }
    if (activeOnly) where.lastBeatAt = { gte: new Date(Date.now() - staleMinutes * 60 * 1000) }
    // 非管理员只能看到自己档案的心跳
    if (!isManager) where.agentProfileId = BigInt(req.user.agentProfileId || 0)

    const rows = await prisma.agentPresence.findMany({
      where,
      orderBy: { lastBeatAt: 'desc' }
    })

    const list = rows.map(a => {
      const stale = a.status === 'OFFLINE' || Date.now() - a.lastBeatAt.getTime() > staleMinutes * 60 * 1000
      const onlineState = stale ? 'OFFLINE' : (a.taskId ? 'ONLINE_DEVELOPING' : 'ONLINE_IDLE')
      const row = {
        agentProfileId: String(a.agentProfileId),
        projectId: a.projectId ? String(a.projectId) : null,
        projectName: a.projectName,
        status: a.status,
        taskId: a.taskId ? String(a.taskId) : null,
        taskTitle: a.taskTitle,
        phase: a.phase,
        progress: a.progress,
        heartbeatAt: a.lastBeatAt,
        stale,
        onlineState
      }
      // 内部字段仅管理角色返回; 其他角色只给状态一层
      if (isManager) {
        row.agentName = a.agentName
        row.activity = a.activity
      }
      return row
    })

    res.json({ code: 0, message: 'ok', data: { list, staleMinutes } })
  } catch (e) {
    console.error('[agent-presence GET]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /active
 * 返回在线(STALE 分钟内有心跳)的巡检 agent; status=OFFLINE 或心跳过期的不算。
 * 兜底: 顺带把过期行标记为 OFFLINE(免得看板读到僵尸数据)。
 */
router.get('/active', async (req, res) => {
  try {
    const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
    await prisma.agentPresence.updateMany({
      where: { lastBeatAt: { lt: staleBefore }, status: { not: 'OFFLINE' } },
      data: { status: 'OFFLINE' }
    })
    const list = await prisma.agentPresence.findMany({
      where: { status: { not: 'OFFLINE' }, lastBeatAt: { gte: staleBefore } },
      select: { agentProfileId: true, agentName: true, projectId: true, projectName: true, status: true, activity: true, lastBeatAt: true },
      orderBy: { lastBeatAt: 'desc' }
    })
    res.json({
      code: 0, message: 'ok',
      data: {
        list: list.map(a => ({
          ...a,
          agentProfileId: String(a.agentProfileId),
          projectId: a.projectId ? String(a.projectId) : null,
          secondsAgo: Math.floor((Date.now() - a.lastBeatAt.getTime()) / 1000)
        })),
        staleMinutes: STALE_MINUTES
      }
    })
  } catch (e) {
    console.error('[agent-presence active]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
