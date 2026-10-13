// v2.9.0(#1162) 看板派工自动开发: 派工单(人) + 运行(机器人) 接口
// 人侧: 创建=启动 / 列表 / 详情 / 暂停继续取消 / 运行取消重派 / 机器人清单
// 机器人侧(Agent 专属 Key): claim / progress / complete / fail —— 经 MCP 工具调用
import express from 'express'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { isProjectInScope } from './projects.js'
import * as svc from '../../services/devDispatch.js'

const router = express.Router()
router.use(internalAuth)

function fail(res, e) {
  const map = { 2004: 404, 9002: 400, 9003: 403, 9005: 409, 9009: 409, 1002: 400, 9030: 403 }
  if (map[e.code]) return res.status(map[e.code]).json({ code: e.code, message: e.message, ...(e.status ? { status: e.status } : {}) })
  console.error('[dev-dispatch]', e)
  res.status(500).json({ code: 9001, message: e.message })
}
const actor = (req) => ({ agentProfileId: req.user.agentProfileId || null, userId: req.user.id, role: req.user.role })

// ---------- 人侧 ----------
router.get('/', requirePermission('task.view'), async (req, res) => {
  try {
    const { projectId, status, includeDone } = req.query
    if (!projectId) return res.status(400).json({ code: 9002, message: 'projectId 必填' })
    if (!(await isProjectInScope(req.user, BigInt(projectId)))) return res.status(404).json({ code: 2004, message: '项目不存在' })
    res.json({ code: 0, data: { list: await svc.listDispatches({ projectId, status, includeDone: includeDone === 'true' }) } })
  } catch (e) { fail(res, e) }
})

router.get('/robots', requirePermission('task.view'), async (req, res) => {
  try { res.json({ code: 0, data: { list: await svc.listRobots() } }) } catch (e) { fail(res, e) }
})

router.post('/', requirePermission('task.edit'), async (req, res) => {
  try {
    const { projectId, milestoneId, scope, taskIds, agentProfileId, title, note } = req.body || {}
    if (!projectId) return res.status(400).json({ code: 9002, message: 'projectId 必填' })
    if (!(await isProjectInScope(req.user, BigInt(projectId)))) return res.status(404).json({ code: 2004, message: '项目不存在' })
    if (scope && !['MILESTONE', 'READY', 'TASKS'].includes(scope)) return res.status(400).json({ code: 9002, message: 'scope 必须为 MILESTONE/READY/TASKS' })
    const data = await svc.createDispatch({ projectId, milestoneId: milestoneId || null, scope: scope || 'MILESTONE', taskIds: Array.isArray(taskIds) ? taskIds : [], agentProfileId: agentProfileId || null, title, note, userId: req.user.id })
    res.json({ code: 0, data })
  } catch (e) { fail(res, e) }
})

router.get('/:id', requirePermission('task.view'), async (req, res) => {
  try {
    const d = await svc.getDispatch(req.params.id)
    if (!(await isProjectInScope(req.user, BigInt(d.projectId)))) return res.status(404).json({ code: 2004, message: '派工单不存在' })
    res.json({ code: 0, data: d })
  } catch (e) { fail(res, e) }
})

for (const action of ['pause', 'resume', 'cancel']) {
  router.post(`/:id/${action}`, requirePermission('task.edit'), async (req, res) => {
    try { res.json({ code: 0, data: await svc.setDispatchStatus({ id: req.params.id, action, userId: req.user.id }) }) } catch (e) { fail(res, e) }
  })
}

// GET /runs/peek — 无副作用: 这台机器人现在有没有能领的运行(机器人循环先 curl 这个, 没活不起 claude 会话)
router.get('/runs/peek', requirePermission('task.view'), async (req, res) => {
  try {
    const a = actor(req)
    const agentProfileId = a.agentProfileId || (['ADMIN', 'MANAGER'].includes(a.role) ? req.query.agentProfileId : null)
    if (!agentProfileId) return res.status(400).json({ code: 1002, message: '当前凭证未绑定机器人档案' })
    res.json({ code: 0, data: await svc.peekRuns({ agentProfileId, projectId: req.query.projectId || null }) })
  } catch (e) { fail(res, e) }
})

router.get('/runs/:runId', requirePermission('task.view'), async (req, res) => {
  try { res.json({ code: 0, data: await svc.getRun(req.params.runId, { eventsTake: Math.min(Number(req.query.events) || 50, 200) }) }) } catch (e) { fail(res, e) }
})
router.post('/runs/:runId/cancel', requirePermission('task.edit'), async (req, res) => {
  try { res.json({ code: 0, data: await svc.cancelRun({ runId: req.params.runId, userId: req.user.id }) }) } catch (e) { fail(res, e) }
})
router.post('/runs/:runId/redispatch', requirePermission('task.edit'), async (req, res) => {
  try { res.json({ code: 0, data: await svc.redispatchRun({ runId: req.params.runId, userId: req.user.id }) }) } catch (e) { fail(res, e) }
})

// ---------- 机器人侧 ----------

// POST /runs/claim  { projectId? , agentProfileId?(经理代领, 演练用) }
router.post('/runs/claim', requirePermission('task.edit'), async (req, res) => {
  try {
    const a = actor(req)
    let agentProfileId = a.agentProfileId
    if (!agentProfileId && req.body?.agentProfileId && ['ADMIN', 'MANAGER'].includes(a.role)) agentProfileId = String(req.body.agentProfileId)
    const data = await svc.claimRun({ agentProfileId, userId: a.userId, projectId: req.body?.projectId || null })
    res.json({ code: 0, data: data || { run: null, message: '暂无可领取的运行' } })
  } catch (e) { fail(res, e) }
})
router.post('/runs/:runId/progress', requirePermission('task.edit'), async (req, res) => {
  try {
    const { progress, phase, message, level, data } = req.body || {}
    res.json({ code: 0, data: await svc.reportProgress({ runId: req.params.runId, progress, phase, message, level, data, ...actor(req) }) })
  } catch (e) { fail(res, e) }
})
router.post('/runs/:runId/complete', requirePermission('task.edit'), async (req, res) => {
  try {
    const { summary, commits, branch, prUrl, testResult } = req.body || {}
    if (!summary) return res.status(400).json({ code: 9002, message: 'summary 必填：一段话说清做了什么' })
    res.json({ code: 0, data: await svc.completeRun({ runId: req.params.runId, summary, commits, branch, prUrl, testResult, ...actor(req) }) })
  } catch (e) { fail(res, e) }
})
router.post('/runs/:runId/fail', requirePermission('task.edit'), async (req, res) => {
  try {
    const { error, retryable } = req.body || {}
    if (!error) return res.status(400).json({ code: 9002, message: 'error 必填：说明为什么做不了' })
    res.json({ code: 0, data: await svc.failRun({ runId: req.params.runId, error, retryable: Boolean(retryable), ...actor(req) }) })
  } catch (e) { fail(res, e) }
})

export default router
