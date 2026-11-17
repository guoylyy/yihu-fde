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

// ---------------------------------------------------------------- 快速录入

export const KR_TITLE_MAX = 200

// 行首的列表记号: 1. 1、 1) (1) ① - • * · + 以及 markdown 待办框 [ ]
// 「3.5 天」「**加粗**」不是列表记号: 「N.」后面不能是数字, 「- * +」后面必须跟空白
const LIST_MARK = /^\s*(?:(?:\d{1,3}\.(?!\d)|\d{1,3}[、)）]|[（(]\d{1,3}[)）]|[①-⑳]|[-*+](?=\s)|[•·▪◦])\s*)+(?:\[[ xX]?\]\s*)?/

/**
 * 批量粘贴 KR: 一行一条, 去掉行首编号/列表记号和首尾空白, 跳过空行;
 * 超过 200 字的截断, clipped 记被截断的条数(界面提示用)
 */
export function splitBulkLines(text, max = KR_TITLE_MAX) {
  const items = []
  let clipped = 0
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(LIST_MARK, '').replace(/\s+$/, '').trim()
    if (!line) continue
    if (line.length > max) { clipped++; items.push(line.slice(0, max)) } else items.push(line)
  }
  return { items, clipped }
}

/** 数组里第 i 项上移(-1)/下移(+1), 越界不动; 原地改并返回 */
export function moveItem(arr, i, delta) {
  const j = i + delta
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  return arr
}

/**
 * 批量粘贴的 KR 插进某个 O: 原来只有一条空 KR(新建 O 时的占位)就顶替它; 不超过 max 条。
 * 返回 { added, dropped }
 */
export function insertKrs(obj, titles, { max = 10, makeKr }) {
  const krs = obj.keyResults
  if (krs.length === 1 && !String(krs[0].title || '').trim() && !krs[0].id) krs.splice(0, 1)
  const room = Math.max(0, max - krs.length)
  const take = titles.slice(0, room)
  for (const t of take) krs.push(makeKr(t))
  return { added: take.length, dropped: titles.length - take.length }
}

/** O 权重按 KR 条数占比, 取整合计 100(与后端 okrRules.weightsByKrCount 同口径) */
export function weightsByKrCount(counts) {
  const n = counts.length
  if (!n) return []
  let safe = counts.map(c => Math.max(0, Number(c) || 0))
  if (!safe.some(Boolean)) safe = safe.map(() => 1)
  const total = safe.reduce((s, c) => s + c, 0)
  const raw = safe.map(c => (c / total) * 100)
  const out = raw.map(Math.floor)
  let left = 100 - out.reduce((s, w) => s + w, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i]++
  return out
}

/** 后端生成的草稿 → 编辑器 initial(去掉指标里不该有的单位, 补状态) */
export function draftToEditor(objectives) {
  return (objectives || [])
    .map(o => ({
      title: String(o.title || '').trim(),
      description: o.description || '',
      weight: Number(o.weight) || 0,
      status: 'ON_TRACK',
      keyResults: (o.keyResults || [])
        .filter(k => String(k.title || '').trim())
        .map(k => ({
          title: String(k.title).trim(),
          metricType: k.metricType || 'BINARY',
          unit: k.metricType === 'NUMBER' ? (k.unit || '') : '',
          targetValue: k.metricType === 'BINARY' ? null : (k.targetValue ?? null),
          weight: Number(k.weight) || 0
        }))
    }))
    .filter(o => o.title || o.keyResults.length)
}

/** 粘贴的周报有效字数(不算空白), 与后端「少于 50 字不生成」同口径 */
export function reportLength(text) {
  return String(text || '').replace(/\s+/g, '').length
}
