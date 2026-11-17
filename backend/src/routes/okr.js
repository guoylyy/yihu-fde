// 周 OKR(公司管理级) —— /api/okr
//
// 与项目管理完全独立: 不挂项目、不产生任务、不记工时。
// 所有硬约束都在这里(经 services/okr.js)校验, 界面隐藏按钮只是体验, 不是防线。
//
// 助手(MCP)调用: 内部 token 带 via='mcp'。助手只能写进展 / KR 数值 / 自评,
// 计划的保存与提交、主管评分、未达成、归档与重开一律拒绝 —— 这些必须本人在页面上点。
import express from 'express'
import { internalAuth, requirePermission, hasPermission } from '../lib/auth.js'
import { logInternalAction } from '../lib/audit.js'
import { parseWeek, weekKey, isoWeekOf, shiftWeek } from '../services/okrRules.js'
import {
  OkrRuleError, getCycle, personWeek, savePlan, appendUpdate, patchKr, scoreObjective,
  markMiss, teamView, history, closeCycle, reopenCycle, okrTick
} from '../services/okr.js'
import { generateOkrDraft } from '../services/okrDraft.js'

const router = express.Router()
router.use(internalAuth)

const ok = (res, data) => res.json({ code: 0, data })

function fail(res, e, scope) {
  if (e instanceof OkrRuleError) return res.status(e.status).json({ code: e.code, message: e.message })
  console.error(`[okr ${scope}]`, e)
  res.status(500).json({ code: 9001, message: e.message })
}

const viaAssistant = req => req.user?.via === 'mcp'
const sourceOf = req => (viaAssistant(req) ? 'ASSISTANT' : 'MANUAL')

/** 这几件事必须人自己点, 助手代办一律 403 */
function humanOnly(what) {
  return (req, res, next) => {
    if (!viaAssistant(req)) return next()
    res.status(403).json({ code: 8120, message: `助手不能代${what}, 请本人在 OKR 页面上操作` })
  }
}

function weekOf(req, res) {
  const w = parseWeek(req.query.week ?? req.body?.week)
  if (!w) {
    res.status(400).json({ code: 8100, message: 'week 格式: current / next / prev / YYYY-Www(如 2026-W47)' })
    return null
  }
  return w
}

/** 看别人的 OKR 需要 okr.view.all; 不传 ownerId 就是自己 */
function resolveOwner(req, res) {
  const raw = req.query.ownerId
  if (raw == null || raw === '' || String(raw) === String(req.user.id)) return String(req.user.id)
  if (!/^\d+$/.test(String(raw))) {
    res.status(400).json({ code: 8100, message: 'ownerId 不合法' })
    return null
  }
  if (!hasPermission(req.user, 'okr.view.all')) {
    res.status(403).json({ code: 1003, message: '只能查看自己的 OKR(查看他人需要 okr.view.all)' })
    return null
  }
  return String(raw)
}

async function weekPayload(req, res, { detail }) {
  const week = weekOf(req, res)
  if (!week) return
  const ownerId = resolveOwner(req, res)
  if (!ownerId) return
  // 本周/下周没有周期就建一个(空的), 其他周不存在就如实返回 null
  const cur = isoWeekOf()
  const creatable = weekKey(week) === weekKey(cur) || weekKey(week) === weekKey(shiftWeek(cur, 1))
  const cycle = await getCycle(week, { create: creatable })
  if (!cycle) return ok(res, { cycle: null, week: weekKey(week), objectives: [] })
  const data = await personWeek(cycle, ownerId, { detail })
  const mine = ownerId === String(req.user.id)
  data.can = {
    edit: mine && data.cycle.editable,
    selfScore: mine && data.cycle.scorable,
    managerScore: !mine && data.cycle.scorable && hasPermission(req.user, 'okr.score.manager'),
    manageCycle: hasPermission(req.user, 'okr.cycle.manage')
  }
  ok(res, data)
}

// ---------------------------------------------------------------- 读

router.get('/cycle', async (req, res) => {
  try { await weekPayload(req, res, { detail: true }) } catch (e) { fail(res, e, 'cycle') }
})

router.get('/my', async (req, res) => {
  try { await weekPayload(req, res, { detail: false }) } catch (e) { fail(res, e, 'my') }
})

router.get('/team', requirePermission('okr.view.all'), async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    ok(res, await teamView(week))
  } catch (e) { fail(res, e, 'team') }
})

router.get('/history', async (req, res) => {
  try {
    const ownerId = resolveOwner(req, res)
    if (!ownerId) return
    ok(res, await history(ownerId, req.query.weeks))
  } catch (e) { fail(res, e, 'history') }
})

// ---------------------------------------------------------------- 计划

async function plan(req, res, submit) {
  const week = weekOf(req, res)
  if (!week) return
  const { late } = await savePlan({ ownerId: req.user.id, week, objectives: req.body?.objectives, submit })
  const cycle = await getCycle(week)
  const data = await personWeek(cycle, req.user.id)
  if (submit) {
    data.lateSubmit = !!late
    logInternalAction(req, 'okr.plan.submit', { resourceType: 'okr_cycle', resourceId: cycle.id, details: { week: weekKey(week), late: !!late } })
  }
  ok(res, data)
}

router.post('/plan', humanOnly('写或改本周计划'), async (req, res) => {
  try { await plan(req, res, false) } catch (e) { fail(res, e, 'plan') }
})

router.post('/plan/submit', humanOnly('提交本周计划'), async (req, res) => {
  try { await plan(req, res, true) } catch (e) { fail(res, e, 'plan/submit') }
})

// 贴周报 → O/KR 草稿: 只返回草稿给编辑器, 不写库、不提交(提交仍走上面的 /plan/submit 和它的校验)
router.post('/plan/draft-from-report', async (req, res) => {
  try {
    ok(res, await generateOkrDraft(req.body?.text))
  } catch (e) { fail(res, e, 'plan/draft-from-report') }
})

// ---------------------------------------------------------------- 进展

router.post('/objectives/:id/updates', async (req, res) => {
  try {
    const b = req.body || {}
    const u = await appendUpdate({
      objectiveId: req.params.id, userId: req.user.id, content: b.content, krId: b.krId,
      valueAfter: b.valueAfter, status: b.status, kind: b.kind || 'MIDWEEK',
      source: sourceOf(req), sourceQuote: viaAssistant(req) ? b.sourceQuote : null,
      agentProfileId: req.user.agentProfileId
    })
    ok(res, { id: String(u.id), krId: u.krId != null ? String(u.krId) : null, valueBefore: u.valueBefore, valueAfter: u.valueAfter, statusAfter: u.statusAfter, source: u.source })
  } catch (e) { fail(res, e, 'updates') }
})

router.patch('/krs/:id', async (req, res) => {
  try {
    const b = req.body || {}
    const u = await patchKr({
      krId: req.params.id, userId: req.user.id, currentValue: b.currentValue, status: b.status, note: b.note,
      source: sourceOf(req), sourceQuote: viaAssistant(req) ? b.sourceQuote : null,
      agentProfileId: req.user.agentProfileId
    })
    ok(res, { updateId: String(u.id), krId: String(u.krId), valueBefore: u.valueBefore, valueAfter: u.valueAfter, statusBefore: u.statusBefore, statusAfter: u.statusAfter, source: u.source })
  } catch (e) { fail(res, e, 'krs') }
})

// ---------------------------------------------------------------- 评分

router.post('/self-score', async (req, res) => {
  try {
    const b = req.body || {}
    const s = await scoreObjective({ objectiveId: b.objectiveId, userId: req.user.id, role: 'SELF', score: b.score, comment: b.comment, source: sourceOf(req) })
    ok(res, { id: String(s.id), objectiveId: String(s.objectiveId), role: s.role, score: s.score, source: s.source })
  } catch (e) { fail(res, e, 'self-score') }
})

router.post('/manager-score', humanOnly('打主管评分'), requirePermission('okr.score.manager'), async (req, res) => {
  try {
    const b = req.body || {}
    const s = await scoreObjective({ objectiveId: b.objectiveId, userId: req.user.id, role: 'MANAGER', score: b.score, comment: b.comment })
    logInternalAction(req, 'okr.score.manager', { resourceType: 'okr_objective', resourceId: s.objectiveId, details: { score: s.score } })
    ok(res, { id: String(s.id), objectiveId: String(s.objectiveId), role: s.role, score: s.score })
  } catch (e) { fail(res, e, 'manager-score') }
})

router.post('/objectives/:id/miss', humanOnly('填写未达成原因'), async (req, res) => {
  try {
    const b = req.body || {}
    const r = await markMiss({ objectiveId: req.params.id, userId: req.user.id, reason: b.reason, carryToNextWeek: !!b.carryToNextWeek })
    ok(res, {
      id: String(r.miss.id),
      carriedToWeek: r.nextCycle ? weekKey(r.nextCycle) : null,
      carriedToObjectiveId: r.carried ? String(r.carried.id) : null
    })
  } catch (e) { fail(res, e, 'miss') }
})

// ---------------------------------------------------------------- 周期管理

// 归档: 不传 week 默认上周(周一归档上周); 定时任务走 okrTick, 不经这里
router.post('/cycle/close', humanOnly('归档周期'), requirePermission('okr.cycle.manage'), async (req, res) => {
  try {
    const week = req.body?.week || req.query.week ? weekOf(req, res) : shiftWeek(isoWeekOf(), -1)
    if (!week) return
    const { cycle, changed } = await closeCycle(week, { by: req.user.id })
    if (changed) logInternalAction(req, 'okr.cycle.close', { resourceType: 'okr_cycle', resourceId: cycle.id, details: { week: weekKey(week) } })
    // 顺带保证本周周期存在(与定时任务同一口径)
    const tick = await okrTick()
    ok(res, { week: weekKey(week), status: cycle.status, changed, current: tick.current })
  } catch (e) { fail(res, e, 'cycle/close') }
})

router.post('/cycle/reopen', humanOnly('重开周期'), requirePermission('okr.cycle.manage'), async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    const reason = String(req.body?.reason ?? '').trim()
    if (!reason) return res.status(400).json({ code: 8113, message: '重开要写原因(留审计)' })
    const { cycle, before } = await reopenCycle(week, { by: req.user.id })
    // 审计必须落库, 这里等它写完
    await logInternalAction(req, 'okr.cycle.reopen', { resourceType: 'okr_cycle', resourceId: cycle.id, details: { week: weekKey(week), from: before, reason: reason.slice(0, 500) } })
    ok(res, { week: weekKey(week), status: cycle.status, from: before })
  } catch (e) { fail(res, e, 'cycle/reopen') }
})

export default router
