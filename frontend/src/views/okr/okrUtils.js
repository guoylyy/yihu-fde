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
    // OKR 5.0: 所属项目(多选); projects 只给下拉显示名字用, 提交时去掉
    projectIds: (o.projects || []).map(p => String(p.id)),
    projects: o.projects || [],
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

// ---------------------------------------------------------------- 补录 / 周切换边界(与后端 creatableRange 同口径)

export function compareKey(a, b) {
  const x = parseKey(a); const y = parseKey(b)
  if (!x || !y) return 0
  return x.year !== y.year ? x.year - y.year : x.weekNo - y.weekNo
}

/** 能新建 / 补录的周: 本年第 1 周 ~ 下周。后端给了 window 用后端的, 没给(老后端)按本机时间算 */
export function weekWindow(serverWindow, now = new Date()) {
  if (serverWindow?.from && serverWindow?.to) return { from: serverWindow.from, to: serverWindow.to }
  const cur = isoWeekOf(now)
  return { from: weekKey({ year: cur.year, weekNo: 1 }), to: shiftKey(weekKey(cur), 1) }
}

export function inWindow(key, win) {
  return compareKey(key, win.from) >= 0 && compareKey(key, win.to) <= 0
}

/**
 * 周切换箭头能不能点: 目标周在窗口内才能翻; 当前周在窗口外(比如从链接进了去年的周)时, 朝窗口方向的那个箭头可点。
 * 于是窗口第 1 周的 ‹(第 0 周)、下周的 ›(再往后)置灰, 不会翻过去才报错
 */
export function weekNav(key, win) {
  const prev = shiftKey(key, -1)
  const next = shiftKey(key, 1)
  return {
    prev: compareKey(prev, win.from) >= 0 && (compareKey(prev, win.to) <= 0 || compareKey(key, win.to) > 0),
    next: compareKey(next, win.to) <= 0 && (compareKey(next, win.from) >= 0 || compareKey(key, win.from) < 0)
  }
}

/** 周日 24:00(上海)之后 = 已过完的周; 此时写的计划是补录 */
export function isPastKey(key, now = new Date()) {
  const w = parseKey(key)
  if (!w) return false
  return weekStart(w).getTime() + 7 * DAY <= now.getTime()
}

/** 「26/第44周」 */
export function shortWeekLabel(key, t = (k, p) => `${p.p0}/W${p.p1}`) {
  const w = parseKey(key)
  return w ? t('okr.backfill.week_label', { p0: String(w.year).slice(-2), p1: w.weekNo }) : String(key || '')
}

/**
 * 这周这个人一条 O 都没有时的空态: 文案 + 主操作(没有操作 = action null)。
 * - 本人: 能写 → 过去周「补录这一周」, 本周/下周「新建本(下)周 OKR」; 已归档 / 超出窗口只给说明
 * - 看别人: 「<姓名> 这一周没有提交 OKR」, 只有代管权限才给「代 <姓名> 补录」
 * canCreate 以后端为准(cycle 不存在时 can.create, 存在时 can.edit), 不在前端放宽
 */
export function emptyState(d, { viewingOther = false, ownerName = '', now = new Date() } = {}) {
  if (!d || (d.objectives || []).length) return null
  const key = d.cycle?.key || d.week
  const win = weekWindow(d.window, now)
  const past = d.cycle ? (d.cycle.backfilled ?? isPastKey(key, now)) : (d.backfill ?? isPastKey(key, now))
  const canCreate = d.cycle ? !!d.can?.edit : !!d.can?.create
  const proxy = !!d.can?.proxy
  const name = ownerName || d.owner?.name || d.owner?.username || ''
  if (viewingOther) {
    const text = ['okr.backfill.other_none', { p0: name }]
    if (proxy && canCreate) return { text, action: 'proxy', label: [past ? 'okr.backfill.proxy_backfill' : 'okr.backfill.proxy_create', { p0: name }] }
    return { text, action: null }
  }
  if (canCreate) {
    if (past) return { text: ['okr.backfill.empty_past'], action: 'backfill', label: ['okr.backfill.action'] }
    const isNext = compareKey(key, weekKey(isoWeekOf(now))) > 0
    return { text: ['okr.backfill.empty_now'], action: 'create', label: [isNext ? 'okr.backfill.create_next' : 'okr.backfill.create_this'] }
  }
  if (d.cycle?.status === 'CLOSED') return { text: ['okr.backfill.archived'], action: null }
  if (!inWindow(key, win)) return { text: ['okr.backfill.out_of_window', { p0: win.from, p1: win.to }], action: null }
  return { text: ['okr.nothing_this_week'], action: null }
}

/** 这份计划是不是补录的: 有 O 在那周过完之后才提交 */
export function isBackfilledPlan(d) {
  const end = d?.cycle?.endDate
  if (!end) return false
  const t = new Date(end).getTime()
  return (d.objectives || []).some(o => o.status !== 'DROPPED' && o.submittedAt && new Date(o.submittedAt).getTime() > t)
}

// ---------------------------------------------------------------- OKR 3.0: KR 完成开关 / 自评前置 / 主管评分

/** 记过数值进度的 KR id 集合: 有一条进展真的改了数值(与后端 assertKrsHandled 同口径; 只看前端拿到的进展) */
export function progressedKrIds(objectives) {
  const out = new Set()
  for (const o of objectives || []) {
    for (const u of o.updates || []) {
      if (u.krId != null && u.valueAfter != null && u.valueAfter !== u.valueBefore) out.add(String(u.krId))
    }
  }
  return out
}

/** 一条 KR 算不算「处理完」: DONE / MISSED; 或数值型且状态非空、记过进度(同后端 okrRules.krHandled) */
export function krHandled(kr, progressed = false) {
  if (kr.status === 'DONE' || kr.status === 'MISSED') return true
  return kr.metricType !== 'BINARY' && kr.status != null && !!progressed
}

/**
 * 自评前置: 已提交、未 DROPPED 的 O 下还没处理完的 KR。
 * 返回 { total, handled, missing: [{ label:'O1-KR3', objectiveId, krId, title }] }(按 O、KR 顺序)
 */
export function krHandling(objectives) {
  const live = (objectives || []).filter(o => o.submittedAt && o.status !== 'DROPPED').sort((a, b) => a.seq - b.seq)
  const progressed = progressedKrIds(live)
  const missing = []
  let total = 0
  for (const o of live) {
    for (const k of [...(o.keyResults || [])].sort((a, b) => a.seq - b.seq)) {
      total++
      if (!krHandled(k, progressed.has(String(k.id)))) {
        missing.push({ label: `O${o.seq}-KR${k.seq}`, objectiveId: String(o.id), krId: String(k.id), title: k.title })
      }
    }
  }
  return { total, handled: total - missing.length, missing }
}

/** 标「未完成」前要不要先问进度: 数值型且当前值为空或 0(是/否型没有进度可填) */
export function needsProgressPrompt(kr) {
  return kr.metricType !== 'BINARY' && !(Number(kr.currentValue) > 0)
}

/** 进度输入框的上限: 百分比 100, 数值型 = 目标值 */
export function progressMax(kr) {
  return kr.metricType === 'PERCENT' ? 100 : Number(kr.targetValue) || 100
}

/** 校验进度输入: 返回数字或 null(不合法) */
export function parseProgress(input, kr) {
  const s = String(input ?? '').trim()
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return n >= 0 && n <= progressMax(kr) ? n : null
}

/**
 * /krs/:id/complete 的返回就地合进本周数据(不整页刷新): 换掉那条 KR, 更新所在 O 的完成度 / 状态, 以及整体完成度。
 * 返回被改的 O(找不到返回 null)
 */
export function applyKrComplete(data, res) {
  if (!data || !res?.kr) return null
  for (const o of data.objectives || []) {
    const i = (o.keyResults || []).findIndex(k => String(k.id) === String(res.kr.id))
    if (i < 0) continue
    o.keyResults.splice(i, 1, { ...o.keyResults[i], ...res.kr })
    if (res.objective) {
      if (res.objective.progress != null) o.progress = res.objective.progress
      if (res.objective.status) o.status = res.objective.status
    }
    if (res.completion !== undefined) data.completion = res.completion
    return o
  }
  return null
}

/** 自评面板: 每个 O 的分数都填了(0–100 整数) */
export function scoresComplete(rows) {
  return rows.length > 0 && rows.every(r => Number.isInteger(r.score) && r.score >= 0 && r.score <= 100)
}

/** 主管评分面板: 需要真的发请求的行(分数有变, 或写了新评语); 没自评 / 是自己的跳过 */
export function managerScoreChanges(rows) {
  return rows.filter(r => !r.locked && r.score != null && (r.score !== r.original || String(r.comment || '').trim()))
}

/**
 * 免提交名单的候选人: 平台用户列表 + 已在名单里的人(可能不在第一页 / 已停用), 按 id 去重。
 * 返回 [{ id, name, username, role }]
 */
export function exemptCandidates(list = [], selected = []) {
  const out = new Map()
  for (const u of [...(selected || []), ...(list || [])]) {
    const id = String(u.id)
    if (!out.has(id)) out.set(id, { id, name: u.name || '', username: u.username || '', role: u.role || '' })
  }
  return [...out.values()]
}

/** 名单是否改过(顺序无关) */
export function idsChanged(a = [], b = []) {
  const x = new Set(a.map(String)), y = new Set(b.map(String))
  return x.size !== y.size || [...x].some(id => !y.has(id))
}
