// 周 OKR 的纯规则: 周期计算、计划校验、完成度。不碰数据库, 单测直接覆盖。
//
// 时区固定 Asia/Shanghai(UTC+8, 无夏令时), 所以用固定偏移算, 不依赖运行机器的 TZ。

export const TZ_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const CYCLE_STATUSES = ['PLANNING', 'SUBMITTED', 'IN_PROGRESS', 'REVIEW', 'CLOSED']
export const OBJECTIVE_STATUSES = ['ON_TRACK', 'AT_RISK', 'DONE', 'MISSED', 'DROPPED']
export const KR_STATUSES = ['ON_TRACK', 'AT_RISK', 'DONE', 'MISSED']
export const BINARY_KR_STATUSES = ['DONE', 'MISSED']
export const METRIC_TYPES = ['BINARY', 'PERCENT', 'NUMBER']
export const UPDATE_KINDS = ['DAILY', 'MIDWEEK', 'FINAL']

export const MAX_OBJECTIVES = 3
export const MAX_KRS = 10
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

/** 只看时间, 这一周此刻应处的状态: 周一 PLANNING, 周二–周四 IN_PROGRESS, 周五起 REVIEW, 过完周日 CLOSED */
export function timeStatus(cycle, now = new Date()) {
  const t = now.getTime()
  const start = new Date(cycle.startDate).getTime()
  const end = new Date(cycle.endDate).getTime()
  if (t > end) return 'CLOSED'
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

/** 能不能评分(自评/主管评): 进行中和周五复盘; 归档后要主管重开 */
export function isScorable(status) {
  return status === 'IN_PROGRESS' || status === 'REVIEW'
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
  constructor(message, { status = 400, code = 8100 } = {}) {
    super(message)
    this.status = status
    this.code = code
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
 */
export function normalizePlan(objectives, { strict = false } = {}) {
  if (!Array.isArray(objectives)) throw new OkrRuleError('objectives 必须是数组', { code: 8101 })
  const active = objectives.filter(o => o && o.status !== 'DROPPED')
  if (active.length > MAX_OBJECTIVES) throw new OkrRuleError(`每周最多 ${MAX_OBJECTIVES} 个 O`, { code: 8101 })
  if (strict && active.length === 0) throw new OkrRuleError('至少要有 1 个 O 才能提交', { code: 8101 })

  const out = objectives.map((o, i) => {
    if (!o || typeof o !== 'object') throw new OkrRuleError(`第 ${i + 1} 个 O 格式不对`, { code: 8101 })
    const title = String(o.title ?? '').trim()
    if (!title) throw new OkrRuleError(`第 ${i + 1} 个 O 没有标题`, { code: 8101 })
    if (title.length > 200) throw new OkrRuleError(`第 ${i + 1} 个 O 标题超过 200 字`, { code: 8101 })
    const status = o.status ?? 'ON_TRACK'
    if (!OBJECTIVE_STATUSES.includes(status)) throw new OkrRuleError(`O 状态不合法: ${status}`, { code: 8101 })
    const krsIn = Array.isArray(o.keyResults) ? o.keyResults : []
    if (krsIn.length > MAX_KRS) throw new OkrRuleError(`「${title}」的 KR 超过 ${MAX_KRS} 条`, { code: 8102 })
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
      if (metricType !== 'BINARY' && strict && !(targetValue > 0)) {
        throw new OkrRuleError(`「${krTitle}」是数值型 KR, 目标值要大于 0`, { code: 8102 })
      }
      const st = checkKrStatus(metricType, k.status) ?? (metricType === 'BINARY' ? null : 'ON_TRACK')
      return {
        id: k.id != null && k.id !== '' ? String(k.id) : null,
        title: krTitle,
        metricType,
        unit: k.unit ? String(k.unit).slice(0, 20) : null,
        targetValue,
        currentValue,
        weight: k.weight,
        status: st
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
