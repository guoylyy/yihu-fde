// 周 OKR 的纯规则: 周期计算、计划校验、完成度。不碰数据库, 单测直接覆盖。
//
// 时区固定 Asia/Shanghai(UTC+8, 无夏令时), 所以用固定偏移算, 不依赖运行机器的 TZ。

export const TZ_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const CYCLE_STATUSES = ['PLANNING', 'SUBMITTED', 'IN_PROGRESS', 'REVIEW', 'CLOSED']
export const OBJECTIVE_STATUSES = ['ON_TRACK', 'AT_RISK', 'DONE', 'MISSED', 'DROPPED']
export const KR_STATUSES = ['ON_TRACK', 'AT_RISK', 'DONE', 'MISSED']
export const BINARY_KR_STATUSES = ['DONE', 'MISSED']
// MILESTONE(6.0): 阶段型 —— targetValue = 阶段总数, currentValue = 已完成阶段数, 阶段明细存 milestones(JSON)
export const METRIC_TYPES = ['BINARY', 'PERCENT', 'NUMBER', 'MILESTONE']
export const UPDATE_KINDS = ['DAILY', 'MIDWEEK', 'FINAL']
// 6.0: O 的风险等级(前端画红黄绿)
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH']
export const BLOCKER_MAX = 2000
export const BLOCKER_INCOMPLETE_MSG = '填了卡点就要写清卡在谁、什么时候要'

// 0.6.5 起这两个是「默认值」: 实际上限读系统设置(services/okrLimits.js), 没配时用它们
export const MAX_OBJECTIVES = 3
export const MAX_KRS = 10
export const MAX_MILESTONES = 20
export const WEIGHT_EPSILON = 0.01
/** 低于这个完成率连续两周的人, 团队视图单独列一段 */
export const LOW_COMPLETION = 0.6

// ---------------------------------------------------------------- 周期

/** 某个时刻在上海时区的「墙上时间」, 用 UTC 字段读 */
function shanghaiWall(date) {
  return new Date(date.getTime() + TZ_OFFSET_MS)
}

/** ISO 年-周号(按上海日期) */
export function isoWeekOf(date = new Date()) {
  const wall = shanghaiWall(date)
  const d = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()))
  const dow = d.getUTCDay() || 7 // 周一=1 … 周日=7
  d.setUTCDate(d.getUTCDate() + 4 - dow) // 本周的周四决定 ISO 年
  const year = d.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  const weekNo = Math.ceil(((d.getTime() - jan1) / DAY_MS + 1) / 7)
  return { year, weekNo }
}

/** ISO 年-周号 → 周一 00:00 / 周日 23:59:59.999(上海), 返回真实时刻 */
export function weekRange(year, weekNo) {
  // ISO: 1 月 4 日所在的周是第 1 周
  const jan4 = Date.UTC(year, 0, 4)
  const jan4Dow = new Date(jan4).getUTCDay() || 7
  const week1MondayWall = jan4 - (jan4Dow - 1) * DAY_MS
  const mondayWall = week1MondayWall + (weekNo - 1) * 7 * DAY_MS
  const start = new Date(mondayWall - TZ_OFFSET_MS)
  const end = new Date(mondayWall + 7 * DAY_MS - 1 - TZ_OFFSET_MS)
  return { start, end }
}

/** 一年有几个 ISO 周(52 或 53) */
export function weeksInYear(year) {
  return isoWeekOf(new Date(Date.UTC(year, 11, 28, 4))).weekNo
}

export function shiftWeek({ year, weekNo }, delta) {
  const { start } = weekRange(year, weekNo)
  return isoWeekOf(new Date(start.getTime() + delta * 7 * DAY_MS + DAY_MS))
}

export function weekKey({ year, weekNo }) {
  return `${year}-W${String(weekNo).padStart(2, '0')}`
}

/**
 * 能新建 / 补录计划的周: 本(ISO)年第 1 周 ~ 下周。
 * 过去的周可以补录(记迟交), 未来只放到下周, 防止随手造出几十年后的周期
 */
export function creatableRange(now = new Date()) {
  const cur = isoWeekOf(now)
  return { from: { year: cur.year, weekNo: 1 }, to: shiftWeek(cur, 1) }
}

export function isCreatableWeek(week, now = new Date()) {
  const { from, to } = creatableRange(now)
  return compareWeek(week, from) >= 0 && compareWeek(week, to) <= 0
}

/** 整周已经过完(周日 24:00 之后): 这时才写的计划算补录 */
export function isPastWeek(week, now = new Date()) {
  return weekRange(week.year, week.weekNo).end.getTime() < now.getTime()
}

/**
 * 解析 week 参数: 空 / current / next / prev / YYYY-Www。不合法返回 null
 */
export function parseWeek(raw, now = new Date()) {
  const cur = isoWeekOf(now)
  const s = String(raw ?? '').trim()
  if (!s || s === 'current') return cur
  if (s === 'next') return shiftWeek(cur, 1)
  if (s === 'prev' || s === 'last') return shiftWeek(cur, -1)
  const m = /^(\d{4})-?W(\d{1,2})$/i.exec(s)
  if (!m) return null
  const year = Number(m[1])
  const weekNo = Number(m[2])
  if (year < 2000 || year > 2999 || weekNo < 1 || weekNo > weeksInYear(year)) return null
  return { year, weekNo }
}

export function compareWeek(a, b) {
  return a.year !== b.year ? a.year - b.year : a.weekNo - b.weekNo
}

/** 周一 24:00 之后提交算迟交 */
export function submitDeadline(cycleStart) {
  return new Date(new Date(cycleStart).getTime() + DAY_MS)
}

export function isLate(cycleStart, at = new Date()) {
  return at.getTime() >= submitDeadline(cycleStart).getTime()
}

const STATUS_ORDER = { PLANNING: 0, SUBMITTED: 0, IN_PROGRESS: 1, REVIEW: 2, CLOSED: 3 }

/**
 * 只看时间, 这一周此刻应处的状态: 周一 PLANNING, 周二–周四 IN_PROGRESS, 周五起 REVIEW。
 * OKR 3.0: 过完周日仍是 REVIEW —— 时间不再把周期推成 CLOSED, 归档只由主管评分完成(close-by-score)
 * 或 ADMIN 应急归档触发
 */
export function timeStatus(cycle, now = new Date()) {
  const t = now.getTime()
  const start = new Date(cycle.startDate).getTime()
  if (t >= start + 4 * DAY_MS) return 'REVIEW'
  if (t >= start + DAY_MS) return 'IN_PROGRESS'
  return 'PLANNING'
}

/**
 * 读周期时顺手按时间往前推(只进不退)。
 * 主管重开过、还没再次归档的周期不自动推进 —— 否则一重开就又被时间推回 CLOSED。
 * 返回需要变成的状态, 不需要变返回 null
 */
export function nextStatus(cycle, now = new Date()) {
  if (isReopened(cycle)) return null
  const want = timeStatus(cycle, now)
  return STATUS_ORDER[want] > STATUS_ORDER[cycle.status] ? want : null
}

export function isReopened(cycle) {
  if (!cycle.reopenedAt) return false
  return !cycle.closedAt || new Date(cycle.reopenedAt) > new Date(cycle.closedAt)
}

/** 计划/进展/KR 数值能不能改 */
export function isEditable(status) {
  return status === 'PLANNING' || status === 'SUBMITTED' || status === 'IN_PROGRESS'
}

/**
 * 计划能不能写: 进行中的周照旧; 周五复盘(REVIEW)里, 这周一条都还没提交的人也可以补上计划(记迟交),
 * 免得周五之后打开就是死路。已提交过的人 REVIEW 里计划仍只读; 已归档(CLOSED)一律只读
 */
export function planWritable(cycleStatus, submittedBefore) {
  return isEditable(cycleStatus) || (cycleStatus === 'REVIEW' && !submittedBefore)
}

/**
 * 能不能评分(自评/主管评)。OKR 3.0 起不卡时间: 只要没归档(CLOSED)就能评;
 * 自评另有「KR 都处理完」的前置(unhandledKrs), 主管评另要求员工已自评。归档后要 ADMIN 重开
 */
export function isScorable(status) {
  return CYCLE_STATUSES.includes(status) && status !== 'CLOSED'
}

/**
 * KR 进展(数值 / 状态 / 完成开关)能不能写: 没归档就能写。
 * 周五复盘里也要能改 —— 自评前得先把每条 KR 标成完成或未完成
 */
export function isProgressWritable(status) {
  return CYCLE_STATUSES.includes(status) && status !== 'CLOSED'
}

/**
 * 一条 KR 算不算「处理完」(自评前置): 状态是 DONE / MISSED;
 * 或数值型 KR 状态非空且本人记过进度(progressed = 这条 KR 有过带数值的进展记录)。
 * 当前值默认就是 0, 所以「已填」看的是有没有人填过, 不看值本身
 */
export function krHandled(kr, progressed = false) {
  if (kr.status === 'DONE' || kr.status === 'MISSED') return true
  return kr.metricType !== 'BINARY' && kr.status != null && !!progressed
}

/**
 * 一个人这周还没处理完的 KR, 返回标签(O{序号}-KR{序号}), 按 O、KR 顺序。
 * 只看未 DROPPED 的 O; progressedKrIds: 记过数值进度的 KR id(字符串)集合
 */
export function unhandledKrs(objectives, progressedKrIds = new Set()) {
  const out = []
  const live = (objectives || []).filter(o => o.status !== 'DROPPED').sort((x, y) => x.seq - y.seq)
  for (const o of live) {
    for (const k of [...(o.keyResults || [])].sort((x, y) => x.seq - y.seq)) {
      if (!krHandled(k, progressedKrIds.has(String(k.id)))) out.push(`O${o.seq}-KR${k.seq}`)
    }
  }
  return out
}

// ---------------------------------------------------------------- 权重

const round2 = n => Math.round(n * 100) / 100

/** 均分到 100, 余数给最后一个: 3 个 → 33.33 / 33.33 / 33.34 */
export function equalWeights(n) {
  if (n <= 0) return []
  const base = Math.floor((100 / n) * 100) / 100
  const arr = Array(n).fill(base)
  arr[n - 1] = round2(100 - base * (n - 1))
  return arr
}

export function weightsSumOk(weights) {
  const sum = weights.reduce((s, w) => s + Number(w || 0), 0)
  // 1e-9: 浮点误差, 否则 33.33×3=99.99 会算成差 0.0100000000000051 被误拒
  return Math.abs(sum - 100) <= WEIGHT_EPSILON + 1e-9
}

/** 全部没填权重 → 均分; 填了一部分或全部 → 原样(由校验判断合计) */
export function fillWeights(items) {
  const allEmpty = items.every(i => i.weight === undefined || i.weight === null || i.weight === '')
  if (!allEmpty) return items.map(i => ({ ...i, weight: Number(i.weight) }))
  const ws = equalWeights(items.length)
  return items.map((i, idx) => ({ ...i, weight: ws[idx] }))
}

// ---------------------------------------------------------------- 计划校验

export class OkrRuleError extends Error {
  constructor(message, { status = 400, code = 8100, data } = {}) {
    super(message)
    this.status = status
    this.code = code
    // 可选: 随错误一起返回给前端的结构化信息(如 close-by-score 的缺项列表)
    if (data !== undefined) this.data = data
  }
}

function num(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/** KR 状态与类型是否相容 */
export function checkKrStatus(metricType, status) {
  if (status === undefined || status === null || status === '') return null
  if (metricType === 'BINARY') {
    if (!BINARY_KR_STATUSES.includes(status)) {
      throw new OkrRuleError(`是/否型 KR 的状态只能是 DONE 或 MISSED, 不能是 ${status}`, { code: 8104 })
    }
  } else if (!KR_STATUSES.includes(status)) {
    throw new OkrRuleError(`KR 状态不合法: ${status}`, { code: 8104 })
  }
  return status
}

/**
 * 规整一份计划(保存草稿与提交共用)。
 * 输入: [{ id?, title, description?, weight?, status?, keyResults: [{ id?, title, metricType?, unit?, targetValue?, currentValue?, weight?, status? }] }]
 * strict=true 时(提交)校验三条硬约束: 每个 O 至少 1 个 KR、O 权重合计 100、每个 O 的 KR 权重合计 100。
 * 草稿只做类型与长度校验, 不要求凑齐。
 * limits: { maxObjectives, maxKrsPerObjective }(0.6.5, 来自系统设置); 不传或缺字段用默认值 MAX_OBJECTIVES / MAX_KRS
 */
export function normalizePlan(objectives, { strict = false, today = shanghaiDateKey(), limits } = {}) {
  const maxObjectives = limits?.maxObjectives ?? MAX_OBJECTIVES
  const maxKrsPerObjective = limits?.maxKrsPerObjective ?? MAX_KRS
  if (!Array.isArray(objectives)) throw new OkrRuleError('objectives 必须是数组', { code: 8101 })
  const active = objectives.filter(o => o && o.status !== 'DROPPED')
  if (active.length > maxObjectives) throw new OkrRuleError(`每周最多 ${maxObjectives} 个 O`, { code: 8101 })
  if (strict && active.length === 0) throw new OkrRuleError('至少要有 1 个 O 才能提交', { code: 8101 })

  const out = objectives.map((o, i) => {
    if (!o || typeof o !== 'object') throw new OkrRuleError(`第 ${i + 1} 个 O 格式不对`, { code: 8101 })
    const title = String(o.title ?? '').trim()
    if (!title) throw new OkrRuleError(`第 ${i + 1} 个 O 没有标题`, { code: 8101 })
    if (title.length > 200) throw new OkrRuleError(`第 ${i + 1} 个 O 标题超过 200 字`, { code: 8101 })
    const status = o.status ?? 'ON_TRACK'
    if (!OBJECTIVE_STATUSES.includes(status)) throw new OkrRuleError(`O 状态不合法: ${status}`, { code: 8101 })
    const krsIn = Array.isArray(o.keyResults) ? o.keyResults : []
    if (krsIn.length > maxKrsPerObjective) throw new OkrRuleError(`「${title}」的 KR 超过 ${maxKrsPerObjective} 条`, { code: 8102 })
    if (strict && status !== 'DROPPED' && krsIn.length === 0) {
      throw new OkrRuleError(`「${title}」还没有 KR: 每个 O 至少 1 个 KR`, { code: 8102 })
    }
    const krs = fillWeights(krsIn.map((k, j) => {
      if (!k || typeof k !== 'object') throw new OkrRuleError(`「${title}」第 ${j + 1} 条 KR 格式不对`, { code: 8102 })
      const krTitle = String(k.title ?? '').trim()
      if (!krTitle) throw new OkrRuleError(`「${title}」第 ${j + 1} 条 KR 没有内容`, { code: 8102 })
      if (krTitle.length > 200) throw new OkrRuleError(`「${title}」第 ${j + 1} 条 KR 超过 200 字`, { code: 8102 })
      const metricType = k.metricType ?? 'BINARY'
      if (!METRIC_TYPES.includes(metricType)) throw new OkrRuleError(`KR 类型不合法: ${metricType}`, { code: 8102 })
      let targetValue = num(k.targetValue)
      let currentValue = num(k.currentValue) ?? 0
      if (Number.isNaN(targetValue) || Number.isNaN(currentValue)) throw new OkrRuleError(`「${krTitle}」的数值不是数字`, { code: 8102 })
      if (metricType === 'BINARY') targetValue = 1
      else if (metricType === 'PERCENT' && targetValue === null) targetValue = 100
      let milestones = null
      if (metricType === 'MILESTONE') {
        // 阶段型: 阶段数决定目标值; 没给阶段明细时 targetValue 至少 1。草稿也校验(0 个阶段没有意义)
        const ms = normalizeMilestones(k.milestones, krTitle)
        if (ms && ms.length) {
          if (targetValue !== null && targetValue !== ms.length) {
            throw new OkrRuleError(`「${krTitle}」有 ${ms.length} 个阶段, 目标值却是 ${targetValue}; 阶段型 KR 的目标值 = 阶段数`, { code: 8102 })
          }
          targetValue = ms.length
        }
        if (!Number.isInteger(targetValue) || targetValue < 1) {
          throw new OkrRuleError(`「${krTitle}」是阶段型 KR, 至少要有 1 个阶段(targetValue 为 ≥1 的整数)`, { code: 8102 })
        }
        if (ms && (k.currentValue === undefined || k.currentValue === null || k.currentValue === '')) {
          currentValue = ms.filter(m => m.done).length
        }
        checkMilestoneValue(currentValue, targetValue, krTitle)
        milestones = ms ? milestonesWithDone(ms, currentValue) : null
      }
      if (metricType !== 'BINARY' && strict && !(targetValue > 0)) {
        throw new OkrRuleError(`「${krTitle}」是数值型 KR, 目标值要大于 0`, { code: 8102 })
      }
      let st = checkKrStatus(metricType, k.status) ?? (metricType === 'BINARY' ? null : 'ON_TRACK')
      if (metricType === 'MILESTONE') {
        st = milestoneStatus({ done: currentValue, target: targetValue, milestones, status: st, explicit: k.status != null && k.status !== '', today })
      }
      return {
        id: k.id != null && k.id !== '' ? String(k.id) : null,
        title: krTitle,
        // 6.0: KR 卡点说明; undefined = 没传(不动已有的), '' / null = 清空
        blockers: k.blockers === undefined ? undefined : (String(k.blockers ?? '').trim().slice(0, BLOCKER_MAX) || null),
        metricType,
        unit: k.unit ? String(k.unit).slice(0, 20) : null,
        targetValue,
        currentValue,
        weight: k.weight,
        status: st,
        milestones
      }
    }))
    if (krs.some(k => !Number.isFinite(k.weight) || k.weight < 0)) throw new OkrRuleError(`「${title}」的 KR 权重要是非负数`, { code: 8103 })
    if (strict && krs.length && !weightsSumOk(krs.map(k => k.weight))) {
      throw new OkrRuleError(`「${title}」的 KR 权重合计是 ${round2(krs.reduce((s, k) => s + k.weight, 0))}, 要等于 100`, { code: 8103 })
    }
    return {
      id: o.id != null && o.id !== '' ? String(o.id) : null,
      title,
      description: o.description ? String(o.description).slice(0, 5000) : null,
      // 6.0: 卡点三件套与风险; undefined = 没传(不动已有的, 老前端整份覆盖时不能把卡点清掉)
      ...normalizeBlocker(o, title),
      riskLevel: normalizeRiskLevel(o.riskLevel, title),
      weight: status === 'DROPPED' ? 0 : o.weight,
      status,
      keyResults: krs.map((k, j) => ({ ...k, seq: j + 1 }))
    }
  })

  // O 权重: DROPPED 固定 0, 其余全空则均分
  const live = out.filter(o => o.status !== 'DROPPED')
  const filled = fillWeights(live)
  live.forEach((o, i) => { o.weight = filled[i].weight })
  if (live.some(o => !Number.isFinite(o.weight) || o.weight < 0)) throw new OkrRuleError('O 的权重要是非负数', { code: 8103 })
  if (strict && !weightsSumOk(live.map(o => o.weight))) {
    throw new OkrRuleError(`本周 O 的权重合计是 ${round2(live.reduce((s, o) => s + o.weight, 0))}, 要等于 100`, { code: 8103 })
  }
  return out.map((o, i) => ({ ...o, seq: i + 1 }))
}

// ---------------------------------------------------------------- 卡点 / 风险(6.0)

/**
 * O 的卡点三件套: blockers(说明) / blockerOwnerId(卡在谁) / blockerDueDate(依赖截止日 YYYY-MM-DD)。
 * 三个都没传 → {}(保存时不动已有的); 说明为空 → 三个一起清空; 说明非空 → 另两个必填且合法, 否则 8120
 */
export function normalizeBlocker(o, title = '') {
  if (o.blockers === undefined && o.blockerOwnerId === undefined && o.blockerDueDate === undefined) return {}
  const text = String(o.blockers ?? '').trim()
  if (!text) return { blockers: null, blockerOwnerId: null, blockerDueDate: null }
  if (text.length > BLOCKER_MAX) throw new OkrRuleError(`「${title}」的卡点说明超过 ${BLOCKER_MAX} 字`, { code: 8120 })
  const owner = o.blockerOwnerId == null ? '' : String(o.blockerOwnerId).trim()
  const due = o.blockerDueDate == null ? '' : String(o.blockerDueDate).trim().slice(0, 10)
  if (!owner || !due) throw new OkrRuleError(BLOCKER_INCOMPLETE_MSG, { code: 8120 })
  if (!/^\d+$/.test(owner)) throw new OkrRuleError(`${BLOCKER_INCOMPLETE_MSG}: 「${title}」的 blockerOwnerId 要是用户 id`, { code: 8120 })
  if (!isDateKey(due)) throw new OkrRuleError(`${BLOCKER_INCOMPLETE_MSG}: 「${title}」的 blockerDueDate 要是 YYYY-MM-DD`, { code: 8120 })
  return { blockers: text, blockerOwnerId: owner, blockerDueDate: due }
}

/** 风险等级: 没传(undefined / null)返回 undefined = 不动; 只认 LOW / MEDIUM / HIGH */
export function normalizeRiskLevel(v, title = '') {
  if (v === undefined || v === null) return undefined
  if (!RISK_LEVELS.includes(v)) throw new OkrRuleError(`「${title}」的风险等级只能是 ${RISK_LEVELS.join(' / ')}, 不能是 ${v}`, { code: 8101 })
  return v
}

/** 卡点逾期: 截止日早于今天(上海), 且 O 还没完成(DONE; 已放弃的 DROPPED 也不算) */
export function blockerOverdue(o, today = shanghaiDateKey()) {
  const due = dateKeyOf(o.blockerDueDate)
  return !!(o.blockers && due && due < today && !['DONE', 'DROPPED'].includes(o.status))
}

/** Date(@db.Date, UTC 零点) / 字符串 → YYYY-MM-DD; 空返回 null */
export function dateKeyOf(v) {
  if (v === undefined || v === null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

/** 多个 O 里最高的风险等级(DROPPED 不算); 没有 O 返回 null */
export function maxRiskLevel(objectives) {
  const live = (objectives || []).filter(o => o.status !== 'DROPPED')
  if (!live.length) return null
  return live.reduce((m, o) => (RISK_LEVELS.indexOf(o.riskLevel || 'LOW') > RISK_LEVELS.indexOf(m) ? (o.riskLevel || 'LOW') : m), 'LOW')
}

// ---------------------------------------------------------------- 阶段型 KR(MILESTONE, 6.0)

/** 上海日期 YYYY-MM-DD */
export function shanghaiDateKey(now = new Date()) {
  return new Date(now.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)
}

/** YYYY-MM-DD 且是真实日期 */
export function isDateKey(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * 规整阶段明细: [{ name, dueDate?, done? }] → [{ name, dueDate, done }]。
 * 没传(undefined / null)返回 null(调用方决定沿用旧的); done 只用来在没给 currentValue 时数已完成个数,
 * 最终以服务器按已完成阶段数回写的为准
 */
export function normalizeMilestones(raw, krTitle = '') {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) throw new OkrRuleError(`「${krTitle}」的 milestones 要是数组`, { code: 8102 })
  if (raw.length > MAX_MILESTONES) throw new OkrRuleError(`「${krTitle}」的阶段超过 ${MAX_MILESTONES} 个`, { code: 8102 })
  return raw.map((m, i) => {
    if (!m || typeof m !== 'object') throw new OkrRuleError(`「${krTitle}」第 ${i + 1} 个阶段格式不对`, { code: 8102 })
    const name = String(m.name ?? '').trim()
    if (!name) throw new OkrRuleError(`「${krTitle}」第 ${i + 1} 个阶段没有名称`, { code: 8102 })
    if (name.length > 100) throw new OkrRuleError(`「${krTitle}」第 ${i + 1} 个阶段名称超过 100 字`, { code: 8102 })
    const due = m.dueDate === undefined || m.dueDate === null || m.dueDate === '' ? null : String(m.dueDate).slice(0, 10)
    if (due !== null && !isDateKey(due)) throw new OkrRuleError(`「${krTitle}」第 ${i + 1} 个阶段的日期要是 YYYY-MM-DD`, { code: 8102 })
    return { name, dueDate: due, done: m.done === true }
  })
}

/** 阶段按顺序推进: 前 done 个完成, 其余未完成(done 由服务器回写, 不信前端) */
export function milestonesWithDone(list, done) {
  return (list || []).map((m, i) => ({ name: m.name, dueDate: m.dueDate ?? null, done: i < done }))
}

/** 已完成阶段数: 0..target 的整数, 否则 400 */
export function checkMilestoneValue(v, target, krTitle = '') {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isInteger(n) || n < 0 || n > Number(target)) {
    throw new OkrRuleError(`「${krTitle}」是阶段型 KR, 已完成阶段数只能是 0–${target} 的整数`, { code: 8104 })
  }
  return n
}

/** 存库的 JSON → 数组; 坏数据当空 */
export function parseMilestones(raw) {
  if (!raw) return []
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

/** 有没有已过截止日(早于 today)还没完成的阶段 */
export function milestoneOverdue(milestones, today = shanghaiDateKey()) {
  return (milestones || []).some(m => !m.done && m.dueDate && m.dueDate < today)
}

/**
 * 阶段型 KR 的状态。status = 本次明确给的状态, 没给就是原状态; explicit = 本次是否明确给了状态。
 * - 明确标 MISSED → MISSED; 原来是 MISSED 且还没全部完成 → 仍 MISSED(只有人能把它改回来)
 * - 全部阶段完成 → DONE
 * - 有阶段逾期未完成 → AT_RISK(不会自动改成 MISSED)
 * - 其余沿用; 从 DONE 退回(有阶段被取消) → ON_TRACK
 */
export function milestoneStatus({ done, target, milestones, status, explicit = false, today = shanghaiDateKey() }) {
  if (status === 'MISSED' && (explicit || done < target)) return 'MISSED'
  if (done >= target) return 'DONE'
  if (milestoneOverdue(milestones, today)) return 'AT_RISK'
  if (!status || status === 'DONE') return 'ON_TRACK'
  return status
}

// ---------------------------------------------------------------- 完成度

/** 单条 KR 的进度 0–1 */
export function krProgress(kr) {
  if (kr.status === 'DONE') return 1
  if (kr.metricType === 'BINARY') return 0
  const target = Number(kr.targetValue)
  if (!(target > 0)) return 0
  return Math.max(0, Math.min(1, Number(kr.currentValue || 0) / target))
}

/** O 的完成度 0–1: KR 进度按 KR 权重加权 */
export function objectiveProgress(o) {
  const krs = o.keyResults || []
  if (!krs.length) return 0
  const wsum = krs.reduce((s, k) => s + Number(k.weight || 0), 0)
  if (wsum <= 0) return krs.reduce((s, k) => s + krProgress(k), 0) / krs.length
  return krs.reduce((s, k) => s + krProgress(k) * Number(k.weight || 0), 0) / wsum
}

/** 一个人一周的完成度 0–1: O 完成度按 O 权重加权(DROPPED 不计) */
export function personProgress(objectives) {
  const live = (objectives || []).filter(o => o.status !== 'DROPPED')
  if (!live.length) return null
  const wsum = live.reduce((s, o) => s + Number(o.weight || 0), 0)
  if (wsum <= 0) return live.reduce((s, o) => s + objectiveProgress(o), 0) / live.length
  return live.reduce((s, o) => s + objectiveProgress(o) * Number(o.weight || 0), 0) / wsum
}

/** 按 O 权重加权的分数(自评或主管分), 没人打分返回 null */
export function weightedScore(objectives, field) {
  const scored = (objectives || []).filter(o => o.status !== 'DROPPED' && o[field] != null)
  if (!scored.length) return null
  const wsum = scored.reduce((s, o) => s + Number(o.weight || 0), 0)
  if (wsum <= 0) return round2(scored.reduce((s, o) => s + o[field], 0) / scored.length)
  return round2(scored.reduce((s, o) => s + o[field] * Number(o.weight || 0), 0) / wsum)
}

/** KR 全部 DONE → O 自动 DONE; 不会把手工设的 MISSED/DROPPED 改掉 */
export function derivedObjectiveStatus(o) {
  if (['MISSED', 'DROPPED'].includes(o.status)) return o.status
  const krs = o.keyResults || []
  if (krs.length && krs.every(k => k.status === 'DONE')) return 'DONE'
  if (o.status === 'DONE') return 'ON_TRACK' // 有 KR 被改回未完成
  return o.status
}

export function validScore(v) {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isInteger(n) || n < 0 || n > 100) {
    throw new OkrRuleError('分数要是 0–100 的整数', { code: 8106 })
  }
  return n
}

/** 个人在这一周的状态标签: NOT_SUBMITTED / IN_PROGRESS / NEED_SELF_SCORE / REVIEW / CLOSED */
export function personalStatus(cycleStatus, objectives) {
  const live = (objectives || []).filter(o => o.status !== 'DROPPED')
  if (cycleStatus === 'CLOSED') return 'CLOSED'
  const submitted = live.length > 0 && live.every(o => o.submittedAt)
  if (!submitted) return 'NOT_SUBMITTED'
  if (cycleStatus === 'REVIEW') return live.every(o => o.selfScore != null) ? 'REVIEW' : 'NEED_SELF_SCORE'
  return 'IN_PROGRESS'
}

// ---------------------------------------------------------------- 快速录入(贴周报生成草稿)用的纯规则

/** 贴周报生成: 有效字数(不算空白)少于这个不生成 */
export const MIN_REPORT_LENGTH = 50

/**
 * O 权重按 KR 条数占比分, 取整且合计正好 100(最大余数法, 并列时靠前的先拿)。
 * 3/2/1 → 50/33/17
 */
export function weightsByKrCount(counts) {
  const n = counts.length
  if (!n) return []
  const safe = counts.map(c => Math.max(0, Number(c) || 0))
  const total = safe.reduce((s, c) => s + c, 0)
  if (!total) return equalIntWeights(n)
  const raw = safe.map(c => (c / total) * 100)
  const out = raw.map(Math.floor)
  let left = 100 - out.reduce((s, w) => s + w, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i]++
  return out
}

function equalIntWeights(n) {
  return weightsByKrCount(Array(n).fill(1))
}

// ---------------------------------------------------------------- 连续未达成预警(10.0)
//
// 「未达成」的判定只在这里: O 级 isObjectiveMissedInWeek, 人级 isPersonMissedInWeek。别处一律调这两个, 不另写条件。

/** 连续未达成 ≥ 2 周 → WARN(黄); ≥ 3 周 → CRITICAL(红, 置顶); 有逾期卡点且 ≥ 2 周 → 升一档 */
export const STREAK_WARN_WEEKS = 2
export const STREAK_CRITICAL_WEEKS = 3
export const STREAK_LEVELS = ['WARN', 'CRITICAL']

/**
 * 单个 O 在某一周是否「未达成」:
 *   status = MISSED
 *   或 status ≠ DONE 且 该周已过(周日早于 today) 且 完成率 < 60% 且 该周没有主管评分
 * o: 带 keyResults 的 O(完成率按 objectiveProgress 现算); week: { year, weekNo }; today: 上海日期 YYYY-MM-DD
 */
export function isObjectiveMissedInWeek(o, week, today = shanghaiDateKey()) {
  if (!o) return false
  if (o.status === 'MISSED') return true
  if (o.status === 'DONE') return false
  const weekEndKey = shanghaiDateKey(weekRange(week.year, week.weekNo).end)
  if (!(weekEndKey < today)) return false
  if (o.managerScore != null) return false
  return objectiveProgress(o) < LOW_COMPLETION
}

/**
 * 人在某一周是否「完成率偏低」: 这周交了计划、周已结束(ended), 且完成率 < 60%。
 * summary: personSummary 的结果(submitted / completion)
 */
export function isPersonMissedInWeek(summary, { ended = true } = {}) {
  return !!(ended && summary?.submitted && summary.completion != null && summary.completion < LOW_COMPLETION)
}

/** 从最近一周往前数连续为 true 的个数; flags 按时间升序(最后一个是最近一周) */
export function trailingStreak(flags) {
  let n = 0
  for (let i = flags.length - 1; i >= 0 && flags[i]; i--) n++
  return n
}

/** 档位: < 2 周 → null; ≥ 3 → CRITICAL; ≥ 2 → WARN, 有逾期卡点升 CRITICAL */
export function streakLevel(n, hasOverdueBlocker = false) {
  if (n >= STREAK_CRITICAL_WEEKS) return 'CRITICAL'
  if (n >= STREAK_WARN_WEEKS) return hasOverdueBlocker ? 'CRITICAL' : 'WARN'
  return null
}
