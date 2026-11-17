// 周 OKR 页面共用的小工具(纯函数, 有单测)

/** 上海日期 MM-DD */
export function shDate(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 0.456 → 46 */
export function pct(v) {
  return v == null ? null : Math.round(v * 100)
}

/** 个人状态 → 标签色 */
export const PERSONAL_TAG = {
  NOT_SUBMITTED: 'danger',
  IN_PROGRESS: 'primary',
  NEED_SELF_SCORE: 'warning',
  REVIEW: 'success',
  CLOSED: 'info'
}

export const OBJ_TAG = { ON_TRACK: 'primary', AT_RISK: 'warning', DONE: 'success', MISSED: 'danger', DROPPED: 'info' }

/** 均分到 100, 余数给最后一个(与后端 okrRules.equalWeights 同口径) */
export function equalWeights(n) {
  if (n <= 0) return []
  const base = Math.floor((100 / n) * 100) / 100
  const arr = Array(n).fill(base)
  arr[n - 1] = Math.round((100 - base * (n - 1)) * 100) / 100
  return arr
}

export function weightSum(items) {
  return Math.round(items.reduce((s, i) => s + Number(i.weight || 0), 0) * 100) / 100
}

/** 与后端同样的 ±0.01 容差 */
export function weightsOk(items) {
  return Math.abs(weightSum(items) - 100) <= 0.01 + 1e-9
}

/** KR 的值展示: 是/否型显示 完成/未完成, 数值型 3/4 个 */
export function krValueText(kr, t = (k) => k) {
  if (kr.metricType === 'BINARY') return kr.status === 'DONE' ? t('okr.done') : kr.status === 'MISSED' ? t('okr.missed') : t('okr.not_done')
  const unit = kr.metricType === 'PERCENT' ? '%' : (kr.unit || '')
  return `${fmtNum(kr.currentValue)}/${fmtNum(kr.targetValue)}${unit}`
}

function fmtNum(n) {
  if (n == null) return '-'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/** 服务端 OKR → 编辑器草稿(只保留计划字段) */
export function toDraft(objectives) {
  return (objectives || []).map(o => ({
    id: o.id,
    title: o.title,
    description: o.description || '',
    weight: o.weight,
    status: o.status,
    keyResults: (o.keyResults || []).map(k => ({
      id: k.id, title: k.title, metricType: k.metricType, unit: k.unit || '', targetValue: k.targetValue, weight: k.weight
    }))
  }))
}

/** 编辑器里删一个 / 加一个之后权重重新均分(用户手改过的场景由「调整权重」开关负责) */
export function rebalance(items) {
  const live = items.filter(i => i.status !== 'DROPPED')
  const ws = equalWeights(live.length)
  live.forEach((i, idx) => { i.weight = ws[idx] })
  return items
}

/** 提交前在页面上先查一遍三条硬约束(后端还会再查一次, 这里只为了早点告诉用户) */
export function planProblems(draft, t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k)) {
  const out = []
  const live = draft.filter(o => o.status !== 'DROPPED')
  if (!live.length) out.push(t('okr.need_one_objective'))
  for (const o of live) {
    if (!String(o.title || '').trim()) out.push(t('okr.objective_needs_title'))
    if (!o.keyResults.length) out.push(t('okr.objective_needs_kr', { p0: o.title || '?' }))
    else if (!weightsOk(o.keyResults)) out.push(t('okr.kr_weight_sum', { p0: o.title || '?', p1: weightSum(o.keyResults) }))
    for (const k of o.keyResults) {
      if (!String(k.title || '').trim()) out.push(t('okr.kr_needs_title', { p0: o.title || '?' }))
      // 与后端同口径: 数值型要有大于 0 的目标值; 百分比不填默认 100
      else if (k.metricType === 'NUMBER' && !(Number(k.targetValue) > 0)) out.push(t('okr.kr_needs_target', { p0: k.title }))
    }
  }
  if (live.length && !weightsOk(live)) out.push(t('okr.objective_weight_sum', { p0: weightSum(live) }))
  return out
}

// ---------------------------------------------------------------- 周号(与后端 okrRules 同算法, 上海时区)
const DAY = 86400000
const TZ = 8 * 3600 * 1000

export function isoWeekOf(date = new Date()) {
  const wall = new Date(date.getTime() + TZ)
  const d = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dow)
  const year = d.getUTCFullYear()
  return { year, weekNo: Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7) }
}

export function weekKey({ year, weekNo }) {
  return `${year}-W${String(weekNo).padStart(2, '0')}`
}

export function parseKey(key) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key || ''))
  return m ? { year: Number(m[1]), weekNo: Number(m[2]) } : null
}

/** 周一 00:00(上海)对应的时刻 */
export function weekStart({ year, weekNo }) {
  const jan4 = Date.UTC(year, 0, 4)
  const dow = new Date(jan4).getUTCDay() || 7
  return new Date(jan4 - (dow - 1) * DAY + (weekNo - 1) * 7 * DAY - TZ)
}

export function shiftKey(key, delta) {
  const w = parseKey(key) || isoWeekOf()
  return weekKey(isoWeekOf(new Date(weekStart(w).getTime() + delta * 7 * DAY + DAY)))
}
