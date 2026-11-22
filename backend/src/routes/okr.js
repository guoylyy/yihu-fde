// 周 OKR(公司管理级) —— /api/okr
//
// 与项目管理的任务 / 工时独立: 不产生任务、不记工时。5.0 起 O 可结构化挂项目(多项目, 见下方 OKR 5.0)。
// 所有硬约束都在这里(经 services/okr.js)校验, 界面隐藏按钮只是体验, 不是防线。
//
// 助手(MCP)调用: 内部 token 带 via='mcp'。助手只能写进展 / KR 数值 / 自评,
// 计划的保存与提交、主管评分、未达成、归档与重开一律拒绝 —— 这些必须本人在页面上点。
//
// OKR 2.0 代管: 写接口都接受可选 targetUserId(缺省 = 自己), 经 resolveOkrTarget 校验代管权限
// (ADMIN 任何人; MANAGER / 组长限本团队; 其余 403)。代填的记录写 operatorId, 返回带 onBehalfOf。
// 主管评分不在代管范围, 只给 okr.score.manager: ADMIN 任何人; MANAGER(0.5.8 起)限本团队成员。
// 归档(close-by-score)仍是 ADMIN 专属 —— 归档锁的是全公司这一周, 部门主管不能替全公司锁周。
//
// OKR 2.0 全员可见: 任何登录用户都能看任何人的 O / KR / 进展 / 自评; 主管评分(managerScore /
// managerComment / 主管评分记录)只返回给本人与评分范围覆盖此人的人(ADMIN 全部, MANAGER 本团队), 其他人不带这些字段。
//
// OKR 4.0: 项目周 OKR 文档(/projects, 全员可读, ADMIN / MANAGER / 项目成员可写)、每日进展总结(/daily)、
// 周评分进度与催交(/week/status、/week/remind, ADMIN 全部 / MANAGER 本团队)。不改上面任何既有规则。
//
// OKR 5.0: O 挂项目(okr_objective_projects, 一个 O 可挂多个)。/plan 的 objectives[i].projectIds 全量替换关联
// (不传 = 不动, [] = 清空; 都要是未删除的项目, 最多 10 个); /my /cycle /team 的 O 带 projects;
// /team?projectId= 按项目筛 O; /by-project 按项目分组; /projects/:id/objectives 某项目某周全部 O。
// 统计(close-by-score / person overview / stats)口径不变, 仍按人; /stats 的 O 只多带项目名称。
//
// OKR 6.0: KR 加阶段型(MILESTONE, 阶段明细 milestones); O 加卡点三件套(blockers / blockerOwnerId / blockerDueDate, 填了说明
// 另两个必填, 否则 8120)与 riskLevel(LOW/MEDIUM/HIGH), KR 加 blockers。/plan 不传这些字段 = 不动已有的。
// /my /cycle /team /by-project /projects/:id/objectives /person/:id/overview 的 O 带 riskLevel + blocker 摘要。
//
// OKR 7.0: 编计划提效(人点才做, 只写草稿, 不提交): /plan/copy-from-week 从某周复制 O/KR、/plan/bulk-import 粘贴 Markdown
// 批量建(preview 不落库)。目标周已提交 → 400(8171)。代管同 /plan(targetUserId)。不改上面任何权重 / 提交校验。
// /templates: 个人模板(只归本人, 存 Markdown, 用时交给 bulk-import)。
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
  markMiss, teamView, history, closeCycle, closeByScore, reopenCycle, okrTick, planWritable
} from '../services/okr.js'
import { generateOkrDraft } from '../services/okrDraft.js'
import { resolveOkrTarget, canManageOkrOf, teamListScope, forViewer, teamForViewer, managerScoreScope, scopeCovers, canSeeManagerScore, stripManagerScore } from '../services/okrAccess.js'
import { personOverview, weekStats, yearStats } from '../services/okrStats.js'
import { describeExempt, setExempt, isExempt } from '../services/okrExempt.js'
import { dailyView, dailyMissing, saveDailySummary } from '../services/okrDaily.js'
import { weekStatus, remindWeek, pendingPlanUsers } from '../services/okrWeekStatus.js'
import { listProjectDocs, getProjectDoc, loadProject, canWriteProjectDoc, saveProjectDoc } from '../services/okrProjectDocs.js'
import { projectBrief } from '../services/okrObjectiveProjects.js'
import { byProject, projectObjectives } from '../services/okrByProject.js'
import { okrBlockerTick } from '../services/okrBlockers.js'
import { copyFromWeek, bulkImport } from '../services/okrPlanImport.js'
import { listTemplates, createTemplate, deleteTemplate } from '../services/okrTemplates.js'

const router = express.Router()
router.use(internalAuth)

const ok = (res, data) => res.json({ code: 0, data })

function fail(res, e, scope) {
  if (e instanceof OkrRuleError) return res.status(e.status).json({ code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) })
  console.error(`[okr ${scope}]`, e)
  res.status(500).json({ code: 9001, message: e.message })
}

const viaAssistant = req => req.user?.via === 'mcp'
const isBoss = req => req.user?.role === 'ADMIN'
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
      can: { create: creatable && (mine || proxy) && !viaAssistant(req), proxy, edit: false, progress: false, selfScore: false, managerScore: false, manageCycle: hasPermission(req.user, 'okr.cycle.manage') }
    })
  }
  const data = await personWeek(cycle, ownerId, { detail })
  const scoreScope = await managerScoreScope(req.user)
  // 代管: 能替此人改计划 / 进展 / 自评(不含主管评分)
  const proxy = !mine && !viaAssistant(req) && await canManageOkrOf(req.user, ownerId, { targetRole: data.owner?.role })
  const submittedBefore = data.objectives.some(o => o.submittedAt)
  data.window = window
  // 免提交白名单: 不需要交 OKR(交了照常记录, 只是不进统计 / 提醒)
  data.exempt = await isExempt(ownerId)
  data.can = {
    // 计划可写: 进行中的周; 或周五复盘里这人还一条没交(补交, 记迟交)
    edit: (mine || proxy) && planWritable(data.cycle.status, submittedBefore),
    // OKR 3.0: KR 进展 / 完成开关, 已提交且没归档就能改(复盘里也能改, 自评前要把 KR 都标完)
    progress: (mine || proxy) && data.cycle.progressWritable && submittedBefore,
    selfScore: (mine || proxy) && data.cycle.scorable,
    proxy,
    // 主管分: 还要这个 O 有自评(逐个 O 由接口校验); 这里只给入口
    managerScore: !mine && data.cycle.scorable && scopeCovers(scoreScope, ownerId),
    // 这个人在不在我的主管评分范围里(不看周期状态; 评分面板据此决定列不列这个人)
    scoreOwner: !mine && scopeCovers(scoreScope, ownerId),
    // 归档只给 ADMIN
    closeByScore: isBoss(req) && hasPermission(req.user, 'okr.score.manager') && data.cycle.status !== 'CLOSED',
    manageCycle: hasPermission(req.user, 'okr.cycle.manage')
  }
  ok(res, forViewer(req.user, ownerId, data, scoreScope))
}

// ---------------------------------------------------------------- 读

router.get('/cycle', async (req, res) => {
  try { await weekPayload(req, res, { detail: true }) } catch (e) { fail(res, e, 'cycle') }
})

router.get('/my', async (req, res) => {
  try { await weekPayload(req, res, { detail: false }) } catch (e) { fail(res, e, 'my') }
})

// 团队本周 OKR: 登录即可看。每行带 objectives(简版, 含 projects)。ADMIN 看全部; 其他人看自己所在团队的成员(没挂团队就只有自己)。
// 主管分只留给评分范围覆盖的行(ADMIN 全部, MANAGER 本团队成员); 其余行 —— 包括自己那一行(自己的主管评分在 /my 里看) —— 不出现这个字段
router.get('/team', async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    // 5.0: ?projectId= 只留挂了该项目的 O(人照样全列); 项目不存在 / 已删 → 404
    const rawPid = req.query.projectId
    const project = rawPid == null || rawPid === '' ? null : await loadProject(rawPid)
    const data = await teamView(week, { onlyUserIds: await teamListScope(req.user), projectId: project ? project.id : null })
    if (project) data.project = projectBrief(project)
    ok(res, teamForViewer(data, await managerScoreScope(req.user)))
  } catch (e) { fail(res, e, 'team') }
})

// ---------------------------------------------------------------- 按项目看 O(OKR 5.0)
// 全员可见(不按团队裁剪, 免提交名单除外); 主管分 / 评语逐条按查看人裁剪: 本人 + 评分范围覆盖负责人的人才有

/** 逐条 O 剔除查看人看不到的主管分(按 O 的负责人判断) */
function objectivesForViewer(user, list, scope) {
  return list.map(o => (canSeeManagerScore(user, o.owner?.id, scope) ? o : stripManagerScore(o)))
}

router.get('/by-project', async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    const scope = await managerScoreScope(req.user)
    const groups = await byProject(week)
    ok(res, groups.map(g => ({ ...g, objectives: objectivesForViewer(req.user, g.objectives, scope) })))
  } catch (e) { fail(res, e, 'by-project') }
})

router.get('/projects/:projectId/objectives', async (req, res) => {
  try {
    const project = await loadProject(req.params.projectId)
    const week = weekOf(req, res)
    if (!week) return
    const data = await projectObjectives(project, week)
    ok(res, { ...data, objectives: objectivesForViewer(req.user, data.objectives, await managerScoreScope(req.user)) })
  } catch (e) { fail(res, e, 'projects/:id/objectives') }
})

router.get('/history', async (req, res) => {
  try {
    const ownerId = resolveOwner(req, res)
    if (!ownerId) return
    ok(res, forViewer(req.user, ownerId, await history(ownerId, req.query.weeks), await managerScoreScope(req.user)))
  } catch (e) { fail(res, e, 'history') }
})

// 个人 OKR 汇总(团队列表点进个人详情): 基本信息 + 当前周五项 + 最近 8 周趋势 + 按年聚合
router.get('/person/:userId/overview', async (req, res) => {
  try {
    ok(res, forViewer(req.user, req.params.userId, await personOverview(req.params.userId), await managerScoreScope(req.user)))
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
      return ok(res, forViewer(req.user, ownerId, await weekStats(ownerId, week), await managerScoreScope(req.user)))
    }
    if (scope === 'year') {
      const year = req.query.year == null || req.query.year === '' ? isoWeekOf().year : Number(req.query.year)
      if (!Number.isInteger(year) || year < 2000 || year > 2999) return res.status(400).json({ code: 8100, message: "year 要是 2000–2999 的整数" })
      return ok(res, forViewer(req.user, ownerId, await yearStats(ownerId, year), await managerScoreScope(req.user)))
    }
    res.status(400).json({ code: 8100, message: 'scope 只能是 week / year' })
  } catch (e) { fail(res, e, 'stats') }
})

// ---------------------------------------------------------------- 计划

async function plan(req, res, submit) {
  const week = weekOf(req, res)
  if (!week) return
  const t = await targetOf(req)
  const { late, projectLinks } = await savePlan({ ownerId: t.ownerId, operatorId: t.operatorId, week, objectives: req.body?.objectives, submit })
  const cycle = await getCycle(week)
  const data = await personWeek(cycle, t.ownerId)
  data.onBehalfOf = onBehalfOf(t)
  // 5.0: 这次显式设置了项目关联的 O → { objectiveId: [projectId...] }, 写进审计
  const projectIds = projectLinks.length ? Object.fromEntries(projectLinks.map(l => [l.objectiveId, l.projectIds])) : null
  const extra = { ...(t.onBehalf ? { ownerId: t.ownerId, onBehalf: true } : {}), ...(projectIds ? { projectIds } : {}) }
  if (submit) {
    data.lateSubmit = !!late
    data.submittedByOperator = t.onBehalf
    logInternalAction(req, 'okr.plan.submit', {
      resourceType: 'okr_cycle', resourceId: cycle.id,
      details: { week: weekKey(week), late: !!late, ...extra }
    })
  } else if (t.onBehalf || projectIds) {
    logInternalAction(req, 'okr.plan.save', { resourceType: 'okr_cycle', resourceId: cycle.id, details: { week: weekKey(week), ...extra } })
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

/** 收 multipart 单文件(同一套白名单 / 2MB 限制); 草稿导入与项目周 OKR 文档导入共用 */
const receiveOkrFile = scope => (req, res, next) => {
  draftUpload(req, res, (err) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件超过 2MB' : `上传失败: ${err.message}`
      return res.status(400).json({ code: err.code === 'LIMIT_FILE_SIZE' ? 8133 : 8132, message: msg })
    }
    fail(res, err, scope)
  })
}
const receiveDraftFile = receiveOkrFile('plan/draft-from-file')

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

// ---------------------------------------------------------------- 编计划提效(OKR 7.0)

/** fromWeek / toWeek 这类具名周参数; 不合法已回 400, 返回 null */
function namedWeek(req, res, field) {
  const w = parseWeek(req.body?.[field] ?? req.query[field])
  if (!w) {
    res.status(400).json({ code: 8100, message: `${field} 格式: current / next / prev / YYYY-Www(如 2026-W47)` })
    return null
  }
  return w
}

// 从某周复制: { fromWeek, toWeek, targetUserId?, objectiveIds? } → { createdObjectives, createdKrs, skipped, overdueBlockers, ... }
router.post('/plan/copy-from-week', humanOnly('复制计划'), async (req, res) => {
  try {
    const from = namedWeek(req, res, 'fromWeek')
    if (!from) return
    const to = namedWeek(req, res, 'toWeek')
    if (!to) return
    const t = await targetOf(req)
    const { cycleId, ...r } = await copyFromWeek({ ownerId: t.ownerId, operatorId: t.operatorId, from, to, objectiveIds: req.body?.objectiveIds })
    if (r.createdObjectives) {
      logInternalAction(req, 'okr.plan.copy', {
        resourceType: 'okr_cycle', resourceId: cycleId,
        details: { fromWeek: r.fromWeek, toWeek: r.toWeek, objectives: r.createdObjectives, krs: r.createdKrs, skipped: r.skipped.length, ...(t.onBehalf ? { ownerId: t.ownerId, onBehalf: true } : {}) }
      })
    }
    ok(res, { ...r, onBehalfOf: onBehalfOf(t) })
  } catch (e) { fail(res, e, 'plan/copy-from-week') }
})

// 粘贴 Markdown 批量建: { week, text, targetUserId?, mode: preview|apply }。preview 不落库(已提交的周也能看); apply 写草稿并审计 okr.plan.bulk
router.post('/plan/bulk-import', humanOnly('批量导入计划'), async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    const t = await targetOf(req)
    const mode = req.body?.mode ?? 'preview'
    const { cycleId, ...r } = await bulkImport({ ownerId: t.ownerId, operatorId: t.operatorId, week, text: req.body?.text, mode })
    if (mode === 'apply') {
      logInternalAction(req, 'okr.plan.bulk', {
        resourceType: 'okr_cycle', resourceId: cycleId,
        details: { week: r.week, objectives: r.createdObjectives, krs: r.createdKrs, truncated: r.truncated, skipped: r.skipped.length, unparsed: r.unparsed.length, ...(t.onBehalf ? { ownerId: t.ownerId, onBehalf: true } : {}) }
      })
    }
    ok(res, { ...r, onBehalfOf: onBehalfOf(t) })
  } catch (e) { fail(res, e, 'plan/bulk-import') }
})

// 个人 OKR 模板: 只看 / 建 / 删自己的
router.get('/templates', async (req, res) => {
  try { ok(res, await listTemplates(req.user.id)) } catch (e) { fail(res, e, 'templates') }
})

router.post('/templates', async (req, res) => {
  try { ok(res, await createTemplate(req.user.id, req.body || {})) } catch (e) { fail(res, e, 'templates post') }
})

router.delete('/templates/:id', async (req, res) => {
  try { ok(res, await deleteTemplate(req.user.id, req.params.id)) } catch (e) { fail(res, e, 'templates delete') }
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
    // 范围: ADMIN 不限; MANAGER 只能评本团队成员(自己的 O 放给服务端报 8109)。O 不存在交给服务端报 404
    const scope = await managerScoreScope(req.user)
    if (scope !== null && /^\d+$/.test(String(b.objectiveId ?? ''))) {
      const o = await prisma.okrObjective.findUnique({ where: { id: BigInt(b.objectiveId) }, select: { ownerId: true } })
      if (o && String(o.ownerId) !== String(req.user.id) && !scope.has(String(o.ownerId))) {
        return res.status(403).json({ code: 8117, message: '只能给自己团队的成员打分' })
      }
    }
    const s = await scoreObjective({ objectiveId: b.objectiveId, userId: req.user.id, role: 'MANAGER', score: b.score, comment: b.comment })
    logInternalAction(req, 'okr.score.manager', { resourceType: 'okr_objective', resourceId: s.objectiveId, details: { score: s.score, scorerRole: req.user.role } })
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

// ---------------------------------------------------------------- 项目周 OKR 文档(OKR 4.0)
// 每周每个项目一份基本 OKR(Markdown 文档), 全员可读; ADMIN / MANAGER / 该项目成员可写。
// 不做结构化、不做富文本: 手写 Markdown 保存, 或上传 .md/.txt/.docx 抽正文(与 draft-from-file 同一套解析)

router.get('/projects', async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    ok(res, await listProjectDocs(week))
  } catch (e) { fail(res, e, 'projects') }
})

router.get('/projects/:projectId', async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    ok(res, await getProjectDoc(req.params.projectId, week))
  } catch (e) { fail(res, e, 'projects/:id') }
})

/** 写权限 + 周参数; 不满足时已回包, 返回 null */
async function projectDocTarget(req, res) {
  const project = await loadProject(req.params.projectId)
  if (!(await canWriteProjectDoc(req.user, project))) {
    res.status(403).json({ code: 8152, message: '只有管理员、经理或该项目成员能编辑项目周 OKR' })
    return null
  }
  const week = weekOf(req, res)
  if (!week) return null
  return { project, week }
}

async function saveDoc(req, res, { title, contentMd, sourceFile, via }) {
  const t = await projectDocTarget(req, res)
  if (!t) return
  const { doc, created } = await saveProjectDoc({ project: t.project, week: t.week, title, contentMd, sourceFile, by: req.user.id })
  logInternalAction(req, 'okr.project_doc.save', {
    resourceType: 'okr_project_doc', resourceId: doc.id,
    details: { projectId: doc.projectId, week: doc.week, via, created, ...(sourceFile ? { sourceFile } : {}) }
  })
  ok(res, { ...doc, created })
}

router.put('/projects/:projectId', humanOnly('编辑项目周 OKR'), async (req, res) => {
  try {
    const b = req.body || {}
    await saveDoc(req, res, { title: b.title, contentMd: b.contentMd, sourceFile: null, via: 'edit' })
  } catch (e) { fail(res, e, 'projects/:id put') }
})

// 先校验权限再收文件: 没权限的人不用白传 2MB
async function projectDocGuard(req, res, next) {
  try {
    const project = await loadProject(req.params.projectId)
    if (!(await canWriteProjectDoc(req.user, project))) return res.status(403).json({ code: 8152, message: '只有管理员、经理或该项目成员能编辑项目周 OKR' })
    next()
  } catch (e) { fail(res, e, 'projects/:id/import') }
}

router.post('/projects/:projectId/import', humanOnly('导入项目周 OKR'), projectDocGuard, receiveOkrFile('projects/:id/import'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ code: 8132, message: '请用 multipart 字段 file 上传 .md / .txt / .docx' })
    const text = await fileText(req.file)
    if (!text.trim()) return res.status(400).json({ code: 8132, message: '文件里没有读到正文' })
    const title = String(req.body?.title || req.file.originalname.replace(/\.[^.]+$/, '')).slice(0, 200)
    await saveDoc(req, res, { title, contentMd: text, sourceFile: req.file.originalname, via: 'import' })
  } catch (e) { fail(res, e, 'projects/:id/import') }
})

// ---------------------------------------------------------------- 每日进展总结(OKR 4.0)
// 每人每天: autoItems(当天 okr_updates 自动归并) + 人补的一句 summary。免提交名单不出现。
// 写: 本人; 主管代写带 targetUserId(代管范围同计划 / 进展: ADMIN 任何人, MANAGER / 组长限本团队)

const isLead = req => ['ADMIN', 'MANAGER'].includes(req.user?.role)

/** ADMIN / MANAGER 才能看的汇总; 不满足已回 403 */
function leadOnly(what) {
  return (req, res, next) => {
    if (isLead(req)) return next()
    res.status(403).json({ code: 8161, message: `只有管理员或经理能${what}` })
  }
}

router.get('/daily', async (req, res) => {
  try {
    const scope = String(req.query.scope || 'team')
    if (!['team', 'me'].includes(scope)) return res.status(400).json({ code: 8100, message: 'scope 只能是 team / me' })
    const onlyUserIds = scope === 'me' ? new Set([String(req.user.id)]) : await teamListScope(req.user)
    ok(res, { scope, ...(await dailyView(req.query.date, { onlyUserIds })) })
  } catch (e) { fail(res, e, 'daily') }
})

router.get('/daily/missing', leadOnly('查看没写每日总结的名单'), async (req, res) => {
  try {
    ok(res, await dailyMissing(req.query.date, { onlyUserIds: await teamListScope(req.user) }))
  } catch (e) { fail(res, e, 'daily/missing') }
})

router.put('/daily', async (req, res) => {
  try {
    const b = req.body || {}
    const t = await targetOf(req)
    const { row, created, date } = await saveDailySummary({ ownerId: t.ownerId, operatorId: t.operatorId, by: req.user.id, dateKey: b.date, summaryMd: b.summaryMd })
    if (t.onBehalf) {
      logInternalAction(req, 'okr.daily.save', { resourceType: 'okr_daily_summary', resourceId: row.id, details: { date, ownerId: t.ownerId, onBehalf: true, created } })
    }
    ok(res, {
      id: String(row.id), userId: String(row.userId), date, summaryMd: row.summaryMd, hasWritten: true, created, updatedAt: row.updatedAt,
      operatorId: row.operatorId != null ? String(row.operatorId) : null, onBehalfOf: onBehalfOf(t)
    })
  } catch (e) { fail(res, e, 'daily put') }
})

// ---------------------------------------------------------------- 周评分进度 + 催交(OKR 4.0)
// ADMIN 看全部, MANAGER 看本团队(与 /team 同一口径)。催交只发给计划未交 / 自评没做完的人

router.get('/week/status', leadOnly('查看周评分进度'), async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    ok(res, await weekStatus(week, { onlyUserIds: await teamListScope(req.user) }))
  } catch (e) { fail(res, e, 'week/status') }
})

router.post('/week/remind', humanOnly('催交 OKR'), leadOnly('催交 OKR'), async (req, res) => {
  try {
    const week = weekOf(req, res)
    if (!week) return
    const r = await remindWeek(week, { userIds: req.body?.userIds, onlyUserIds: await teamListScope(req.user) })
    if (r.reminded.length) {
      logInternalAction(req, 'okr.week.remind', { resourceType: 'okr_cycle', details: { week: r.week, userIds: r.reminded.map(x => x.user.id) } })
    }
    ok(res, r)
  } catch (e) { fail(res, e, 'week/remind') }
})

// ---------------------------------------------------------------- 设置: 免提交白名单

// 登录可读: 前端据此在团队页 / 设置页显示「免提交」
router.get('/settings/exempt', async (req, res) => {
  try { ok(res, await describeExempt()) } catch (e) { fail(res, e, 'settings/exempt') }
})

// 仅 ADMIN: 整份覆盖, 校验都是真实用户、最多 50 人; 前后差异写审计
router.put('/settings/exempt', humanOnly('修改 OKR 免提交名单'), async (req, res) => {
  try {
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ code: 8142, message: '只有管理员能修改 OKR 免提交名单' })
    const diff = await setExempt(req.body?.userIds, { by: req.user.id })
    await logInternalAction(req, 'okr.settings.exempt', { resourceType: 'appSetting', details: diff })
    ok(res, await describeExempt())
  } catch (e) { fail(res, e, 'settings/exempt') }
})

// ---------------------------------------------------------------- 周期管理

// OKR 3.0 正常流程: 主管(ADMIN)把这周已提交的 O 都评完分 → 一键完成本周(CLOSED), 之后全部只读。
// 不再需要「开启本周」; 不传 week 默认本周。
// 0.5.8: okr.score.manager 放开给 MANAGER 后, 归档另加 role=ADMIN —— 锁的是全公司这一周
router.post('/cycle/close-by-score', humanOnly('完成本周评分并归档'), requirePermission('okr.score.manager'), async (req, res) => {
  try {
    if (!isBoss(req)) return res.status(403).json({ code: 8118, message: '关闭本周是老板的动作' })
    const week = req.body?.week || req.query.week ? weekOf(req, res) : isoWeekOf()
    if (!week) return
    const { cycle, changed, scored } = await closeByScore(week, { by: req.user.id })
    if (changed) {
      await logInternalAction(req, 'okr.cycle.close-by-score', { resourceType: 'okr_cycle', resourceId: cycle.id, details: { week: weekKey(week), scored } })
    }
    // 4.0: 不阻断关闭, 但把还没交计划的人(免提交除外)一并告诉老板
    const pendingUsers = await pendingPlanUsers(week)
    ok(res, { week: weekKey(week), status: cycle.status, changed, scored, closedAt: cycle.closedAt, closedBy: cycle.closedBy != null ? String(cycle.closedBy) : null, pendingUsers })
  } catch (e) { fail(res, e, 'cycle/close-by-score') }
})

// ADMIN 应急: 归档 / 重开(重开必须写原因留审计)。OKR 3.0 正常流程用不到, 归档走上面的 close-by-score
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

// ---------------------------------------------------------------- 卡点到期提醒(OKR 6.0)
// 定时任务每天跑一次; 这里给 ADMIN 手动触发一次(测试 / 排查)。幂等: 同一 O 同一天每人最多一条。?dryRun=1 只算不发
router.post('/admin/blocker-tick', humanOnly('触发卡点到期提醒'), async (req, res) => {
  try {
    if (!isBoss(req)) return res.status(403).json({ code: 8121, message: '只有管理员能手动触发卡点到期提醒' })
    const dryRun = ['1', 'true'].includes(String(req.query.dryRun ?? req.body?.dryRun ?? ''))
    const r = await okrBlockerTick(new Date(), { dryRun })
    if (!dryRun && r.notified) logInternalAction(req, 'okr.blocker.tick', { resourceType: 'okr_objective', details: { date: r.date, due: r.due, notified: r.notified } })
    ok(res, { ...r, dryRun })
  } catch (e) { fail(res, e, 'admin/blocker-tick') }
})

export default router
