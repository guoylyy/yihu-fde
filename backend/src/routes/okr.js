// 周 OKR(公司管理级) —— /api/okr
//
// 与项目管理完全独立: 不挂项目、不产生任务、不记工时。
// 所有硬约束都在这里(经 services/okr.js)校验, 界面隐藏按钮只是体验, 不是防线。
//
// 助手(MCP)调用: 内部 token 带 via='mcp'。助手只能写进展 / KR 数值 / 自评,
// 计划的保存与提交、主管评分、未达成、归档与重开一律拒绝 —— 这些必须本人在页面上点。
//
// OKR 2.0 代管: 写接口都接受可选 targetUserId(缺省 = 自己), 经 resolveOkrTarget 校验代管权限
// (ADMIN 任何人; MANAGER / 组长限本团队; 其余 403)。代填的记录写 operatorId, 返回带 onBehalfOf。
// 主管评分不在代管范围, 仍只给 okr.score.manager(ADMIN)。
//
// OKR 2.0 全员可见: 任何登录用户都能看任何人的 O / KR / 进展 / 自评; 主管评分(managerScore /
// managerComment / 主管评分记录)只返回给本人与 ADMIN, 其他人的响应里直接不带这些字段。
import express from 'express'
import multer from 'multer'
import mammoth from 'mammoth'
import prisma from '../lib/prisma.js'
import { decodeOriginalName } from '../lib/storage.js'
import { internalAuth, requirePermission, hasPermission } from '../lib/auth.js'
import { logInternalAction } from '../lib/audit.js'
import { parseWeek, weekKey, isoWeekOf, shiftWeek, weekRange, submitDeadline, creatableRange, isCreatableWeek, isPastWeek } from '../services/okrRules.js'
import {
  OkrRuleError, getCycle, personWeek, savePlan, appendUpdate, patchKr, completeKr, scoreObjective,
  markMiss, teamView, history, closeCycle, reopenCycle, okrTick, planWritable
} from '../services/okr.js'
import { generateOkrDraft } from '../services/okrDraft.js'
import { resolveOkrTarget, canManageOkrOf, teamListScope, forViewer, stripManagerScore } from '../services/okrAccess.js'
import { personOverview, weekStats, yearStats } from '../services/okrStats.js'

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

/** 写操作的目标人: body.targetUserId > query.targetUserId > 自己 */
function targetOf(req) {
  const raw = req.body?.targetUserId ?? req.query.targetUserId
  return resolveOkrTarget(req.user, raw, { viaAssistant: viaAssistant(req) })
}

/** 返回里的代管标记: 本人操作为 null */
const onBehalfOf = t => (t.onBehalf ? { ownerId: t.ownerId, operatorId: t.operatorId } : null)

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

/** 看谁的 OKR: ownerId / userId, 不传就是自己。OKR 2.0 起登录即可看别人(主管评分另行剔除) */
function resolveOwner(req, res) {
  const raw = req.query.ownerId ?? req.query.userId
  if (raw == null || raw === '' || String(raw) === String(req.user.id)) return String(req.user.id)
  if (!/^\d+$/.test(String(raw))) {
    res.status(400).json({ code: 8100, message: 'ownerId 不合法' })
    return null
  }
  return String(raw)
}

async function weekPayload(req, res, { detail }) {
  const week = weekOf(req, res)
  if (!week) return
  const ownerId = resolveOwner(req, res)
  if (!ownerId) return
  // 本周/下周没有周期就建一个(空的); 过去的周读的时候不建 —— 补录由写接口(保存/提交计划)建
  const now = new Date()
  const cur = isoWeekOf(now)
  const autoCreate = weekKey(week) === weekKey(cur) || weekKey(week) === weekKey(shiftWeek(cur, 1))
  const cycle = await getCycle(week, { create: autoCreate, now })
  const mine = ownerId === String(req.user.id)
  // 新建窗口(本年第 1 周 ~ 下周): 前端据此决定空态给不给「补录这一周」, 周切换箭头到边界置灰
  const { from, to } = creatableRange(now)
  const window = { from: weekKey(from), to: weekKey(to) }
  if (!cycle) {
    const owner = await prisma.user.findUnique({ where: { id: BigInt(ownerId) }, select: { id: true, name: true, username: true, avatarUrl: true, role: true } })
    const proxy = !mine && !viaAssistant(req) && !!owner && await canManageOkrOf(req.user, ownerId, { targetRole: owner.role })
    const creatable = isCreatableWeek(week, now)
    const { start, end } = weekRange(week.year, week.weekNo)
    return ok(res, {
      cycle: null,
      week: weekKey(week),
      startDate: start,
      endDate: end,
      submitDeadline: submitDeadline(start),
      backfill: isPastWeek(week, now),
      window,
      owner: owner ? { id: String(owner.id), name: owner.name, username: owner.username, avatarUrl: owner.avatarUrl, role: owner.role } : { id: ownerId },
      objectives: [],
      can: { create: creatable && (mine || proxy) && !viaAssistant(req), proxy, edit: false, selfScore: false, managerScore: false, manageCycle: hasPermission(req.user, 'okr.cycle.manage') }
    })
  }
  const data = await personWeek(cycle, ownerId, { detail })
  // 代管: 能替此人改计划 / 进展 / 自评(不含主管评分)
  const proxy = !mine && !viaAssistant(req) && await canManageOkrOf(req.user, ownerId, { targetRole: data.owner?.role })
  const submittedBefore = data.objectives.some(o => o.submittedAt)
  data.window = window
  data.can = {
    // 计划可写: 进行中的周; 或周五复盘里这人还一条没交(补交, 记迟交)
    edit: (mine || proxy) && planWritable(data.cycle.status, submittedBefore),
    selfScore: (mine || proxy) && data.cycle.scorable,
    proxy,
    managerScore: !mine && data.cycle.scorable && hasPermission(req.user, 'okr.score.manager'),
    manageCycle: hasPermission(req.user, 'okr.cycle.manage')
  }
  ok(res, forViewer(req.user, ownerId, data))
}

// ---------------------------------------------------------------- 读

router.get('/cycle', async (req, res) => {
  try { await weekPayload(req, res, { detail: true }) } catch (e) { fail(res, e, 'cycle') }
})

router.get('/my', async (req, res) => {
  try { await weekPayload(req, res, { detail: false }) } catch (e) { fail(res, e, 'my') }
})

// 团队本周 OKR: 登录即可看。ADMIN 看全部; 其他人看自己所在团队的成员(没挂团队就只有自己)。
// 不是 ADMIN 的, 整份响应剔除主管评分 —— 包括自己那一行(自己的主管评分在 /my 里看), 列表里不出现这个字段
router.get('/team', async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    const data = await teamView(week, { onlyUserIds: await teamListScope(req.user) })
    ok(res, hasPermission(req.user, 'okr.score.manager') ? data : stripManagerScore(data))
  } catch (e) { fail(res, e, 'team') }
})

router.get('/history', async (req, res) => {
  try {
    const ownerId = resolveOwner(req, res)
    if (!ownerId) return
    ok(res, forViewer(req.user, ownerId, await history(ownerId, req.query.weeks)))
  } catch (e) { fail(res, e, 'history') }
})

// 个人 OKR 汇总(团队列表点进个人详情): 基本信息 + 当前周五项 + 最近 8 周趋势 + 按年聚合
router.get('/person/:userId/overview', async (req, res) => {
  try {
    ok(res, forViewer(req.user, req.params.userId, await personOverview(req.params.userId)))
  } catch (e) { fail(res, e, 'person/overview') }
})

// 个人按周 / 按年统计: ?userId=&scope=week|year&week=2026-W47&year=2026(userId 缺省 = 自己)
// 只读 okr_* 表现算, 不排名; 主管评分只给本人与 ADMIN
router.get('/stats', async (req, res) => {
  try {
    const ownerId = resolveOwner(req, res)
    if (!ownerId) return
    const scope = String(req.query.scope || 'week')
    if (scope === 'week') {
      const week = weekOf(req, res)
      if (!week) return
      return ok(res, forViewer(req.user, ownerId, await weekStats(ownerId, week)))
    }
    if (scope === 'year') {
      const year = req.query.year == null || req.query.year === '' ? isoWeekOf().year : Number(req.query.year)
      if (!Number.isInteger(year) || year < 2000 || year > 2999) return res.status(400).json({ code: 8100, message: "year 要是 2000–2999 的整数" })
      return ok(res, forViewer(req.user, ownerId, await yearStats(ownerId, year)))
    }
    res.status(400).json({ code: 8100, message: 'scope 只能是 week / year' })
  } catch (e) { fail(res, e, 'stats') }
})

// ---------------------------------------------------------------- 计划

async function plan(req, res, submit) {
  const week = weekOf(req, res)
  if (!week) return
  const t = await targetOf(req)
  const { late } = await savePlan({ ownerId: t.ownerId, operatorId: t.operatorId, week, objectives: req.body?.objectives, submit })
  const cycle = await getCycle(week)
  const data = await personWeek(cycle, t.ownerId)
  data.onBehalfOf = onBehalfOf(t)
  if (submit) {
    data.lateSubmit = !!late
    data.submittedByOperator = t.onBehalf
    logInternalAction(req, 'okr.plan.submit', {
      resourceType: 'okr_cycle', resourceId: cycle.id,
      details: { week: weekKey(week), late: !!late, ...(t.onBehalf ? { ownerId: t.ownerId, onBehalf: true } : {}) }
    })
  } else if (t.onBehalf) {
    logInternalAction(req, 'okr.plan.save', { resourceType: 'okr_cycle', resourceId: cycle.id, details: { week: weekKey(week), ownerId: t.ownerId, onBehalf: true } })
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
// targetUserId: 主管替某个员工生成(要有代管权限); 草稿标注是替谁生成的, 仍然不落库
async function draftTarget(req) {
  const t = await targetOf(req)
  const u = await prisma.user.findUnique({ where: { id: BigInt(t.ownerId) }, select: { id: true, name: true, username: true } })
  return {
    target: { id: t.ownerId, name: u?.name ?? null, username: u?.username ?? null },
    onBehalfOf: onBehalfOf(t)
  }
}

router.post('/plan/draft-from-report', async (req, res) => {
  try {
    const who = await draftTarget(req)
    ok(res, { ...(await generateOkrDraft(req.body?.text)), ...who })
  } catch (e) { fail(res, e, 'plan/draft-from-report') }
})

// 上传本周文档 → O/KR 草稿(经理可替员工导入)。.md / .txt / .docx, 单文件 ≤ 2MB;
// 解析出正文后复用 generateOkrDraft, 返回结构与 draft-from-report 相同, 另带 fileName。不落库
export const DRAFT_FILE_MAX_BYTES = 2 * 1024 * 1024
const DRAFT_FILE_EXT = /\.(md|markdown|txt|docx)$/i
const draftUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DRAFT_FILE_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    file.originalname = decodeOriginalName(file.originalname)
    if (!DRAFT_FILE_EXT.test(file.originalname)) {
      return cb(new OkrRuleError('只支持 .md / .txt / .docx(老版 .doc 请先另存为 .docx)', { code: 8132 }))
    }
    cb(null, true)
  }
}).single('file')

function receiveDraftFile(req, res, next) {
  draftUpload(req, res, (err) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件超过 2MB' : `上传失败: ${err.message}`
      return res.status(400).json({ code: err.code === 'LIMIT_FILE_SIZE' ? 8133 : 8132, message: msg })
    }
    fail(res, err, 'plan/draft-from-file')
  })
}

async function fileText(file) {
  const name = file.originalname.toLowerCase()
  if (name.endsWith('.docx')) {
    let r
    try { r = await mammoth.extractRawText({ buffer: file.buffer }) } catch {
      throw new OkrRuleError('读不出这个 .docx(文件损坏或不是 Word 文档)', { code: 8132 })
    }
    return r.value || ''
  }
  return file.buffer.toString('utf8').replace(/^\uFEFF/, '')
}

router.post('/plan/draft-from-file', receiveDraftFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ code: 8132, message: '请用 multipart 字段 file 上传 .md / .txt / .docx' })
    const who = await draftTarget(req)
    const text = await fileText(req.file)
    ok(res, { ...(await generateOkrDraft(text)), fileName: req.file.originalname, ...who })
  } catch (e) { fail(res, e, 'plan/draft-from-file') }
})

// ---------------------------------------------------------------- 进展

router.post('/objectives/:id/updates', async (req, res) => {
  try {
    const b = req.body || {}
    const t = await targetOf(req)
    const u = await appendUpdate({
      objectiveId: req.params.id, userId: req.user.id, ownerId: t.ownerId, content: b.content, krId: b.krId,
      valueAfter: b.valueAfter, status: b.status, kind: b.kind || 'MIDWEEK',
      source: sourceOf(req), sourceQuote: viaAssistant(req) ? b.sourceQuote : null,
      agentProfileId: req.user.agentProfileId
    })
    ok(res, {
      id: String(u.id), krId: u.krId != null ? String(u.krId) : null, valueBefore: u.valueBefore, valueAfter: u.valueAfter, statusAfter: u.statusAfter, source: u.source,
      operatorId: u.operatorId != null ? String(u.operatorId) : null, onBehalfOf: onBehalfOf(t)
    })
  } catch (e) { fail(res, e, 'updates') }
})

router.patch('/krs/:id', async (req, res) => {
  try {
    const b = req.body || {}
    const t = await targetOf(req)
    const u = await patchKr({
      krId: req.params.id, userId: req.user.id, ownerId: t.ownerId, currentValue: b.currentValue, status: b.status, note: b.note,
      source: sourceOf(req), sourceQuote: viaAssistant(req) ? b.sourceQuote : null,
      agentProfileId: req.user.agentProfileId
    })
    ok(res, {
      updateId: String(u.id), krId: String(u.krId), valueBefore: u.valueBefore, valueAfter: u.valueAfter, statusBefore: u.statusBefore, statusAfter: u.statusAfter, source: u.source,
      operatorId: u.operatorId != null ? String(u.operatorId) : null, onBehalfOf: onBehalfOf(t)
    })
  } catch (e) { fail(res, e, 'krs') }
})

// KR 完成开关: { done: true|false }。true → DONE(值拉满); false → MISSED(明确未完成, 数值型进度不动)
router.post('/krs/:id/complete', async (req, res) => {
  try {
    const b = req.body || {}
    const t = await targetOf(req)
    const r = await completeKr({
      krId: req.params.id, userId: req.user.id, ownerId: t.ownerId, done: b.done, note: b.note,
      source: sourceOf(req), sourceQuote: viaAssistant(req) ? b.sourceQuote : null,
      agentProfileId: req.user.agentProfileId
    })
    const u = r.update
    ok(res, {
      kr: r.kr, objective: r.objective, completion: r.completion,
      updateId: String(u.id), statusBefore: u.statusBefore, statusAfter: u.statusAfter, valueBefore: u.valueBefore, valueAfter: u.valueAfter,
      operatorId: u.operatorId != null ? String(u.operatorId) : null, onBehalfOf: onBehalfOf(t)
    })
  } catch (e) { fail(res, e, 'krs/complete') }
})

// ---------------------------------------------------------------- 评分

router.post('/self-score', async (req, res) => {
  try {
    const b = req.body || {}
    const t = await targetOf(req)
    const s = await scoreObjective({ objectiveId: b.objectiveId, userId: req.user.id, ownerId: t.ownerId, role: 'SELF', score: b.score, comment: b.comment, source: sourceOf(req) })
    ok(res, {
      id: String(s.id), objectiveId: String(s.objectiveId), role: s.role, score: s.score, source: s.source,
      operatorId: s.operatorId != null ? String(s.operatorId) : null, onBehalfOf: onBehalfOf(t)
    })
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
    const t = await targetOf(req)
    const r = await markMiss({ objectiveId: req.params.id, userId: req.user.id, ownerId: t.ownerId, reason: b.reason, carryToNextWeek: !!b.carryToNextWeek })
    ok(res, {
      id: String(r.miss.id), onBehalfOf: onBehalfOf(t),
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
