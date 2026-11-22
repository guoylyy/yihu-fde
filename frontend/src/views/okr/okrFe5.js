// OKR 前端第五批: 导出 / 连续未达成预警 —— 纯函数(页面和组件只管画, 规则都在这里, 方便单测)。
// 后端契约: GET /api/okr/export、/api/okr/risk/objectives(见 backend/src/routes/okr.js), 前端不改口径。
// 精简第二轮: 决策记录、按项目导出、团队页风险面板随页面下线, 对应函数一并删除。

const sid = v => (v == null ? '' : String(v))

// ---------------------------------------------------------------- 一、导出

/** 团队导出只给 ADMIN / MANAGER(后端 exportAudience 同口径: 其余 403 8181) */
export const mayExportTeam = (user) => user?.role === 'ADMIN' || user?.role === 'MANAGER'

/**
 * 导出下拉的选项。
 * page='mine': Excel 明细 / Word 汇报 —— 导当前看的人(默认自己)这一周, scope=person
 * page='team': 上面两项导自己; ADMIN / MANAGER 多一项「团队 Excel」(scope=team)。最多 3 项
 * @returns {{ key, label, params: { week, scope, format, userId? } }[]}
 */
export function exportItems({ page = 'mine', user, week, userId } = {}) {
  const self = sid(userId || user?.id)
  const person = format => ({ week, scope: 'person', format, userId: self })
  const items = [
    { key: 'xlsx', label: 'okr.fe5.export_xlsx', params: person('xlsx') },
    { key: 'docx', label: 'okr.fe5.export_docx', params: person('docx') }
  ]
  if (page === 'team' && mayExportTeam(user)) {
    items.push({ key: 'team', label: 'okr.fe5.export_team', params: { week, scope: 'team', format: 'xlsx' }, divided: true })
  }
  return items
}

/** /api/okr/export?...(空值不带) */
export function exportUrl(params = {}) {
  const q = new URLSearchParams()
  for (const k of ['week', 'scope', 'format', 'userId']) {
    if (params[k] != null && params[k] !== '') q.set(k, String(params[k]))
  }
  return '/api/okr/export?' + q.toString()
}

/** Content-Disposition → 文件名: filename*=UTF-8'' 优先, 退回 filename="..."; 都没有用 fallback */
export function fileNameFromDisposition(header, fallback = 'okr-export') {
  const h = String(header || '')
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(h)
  if (star) {
    try { return decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')) } catch { /* 坏编码, 退回 filename= */ }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(h) || /filename\s*=\s*([^;]+)/i.exec(h)
  return plain ? plain[1].trim() : fallback
}

/**
 * 拉文件并触发浏览器下载(fetch blob + <a download>), 不开新标签页、不把 JSON 显示出来。
 * 失败时后端是 JSON 错误体: 抛出带后端文案的 Error(403 / 400 原样透出)。
 * deps 可注入(单测用): fetchImpl / token / doc / urlApi
 * @returns {Promise<{ name: string, size: number }>}
 */
export async function downloadExport(params, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch
  const token = deps.token ?? (globalThis.localStorage?.getItem('fde_internal_token') || '')
  const doc = deps.doc || globalThis.document
  const urlApi = deps.urlApi || globalThis.URL
  const res = await fetchImpl(exportUrl(params), { headers: token ? { Authorization: 'Bearer ' + token } : {} })
  if (!res.ok) {
    let msg = ''
    try { msg = (await res.json())?.message || '' } catch { /* 不是 JSON */ }
    const err = new Error(msg || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  const blob = await res.blob()
  const name = fileNameFromDisposition(res.headers.get('Content-Disposition'), `OKR-${params.week || ''}.${params.format || 'xlsx'}`)
  const href = urlApi.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = href
  a.download = name
  a.style.display = 'none'
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => urlApi.revokeObjectURL(href), 1000)
  return { name, size: blob.size }
}

/** 12345 → "12.1 KB" */
export function fileSizeText(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------- 二、连续未达成预警

/** 只认 2 档; 其余(没命中)返回 '' */
export const levelOf = (lv) => (lv === 'CRITICAL' || lv === 'WARN' ? lv : '')

/**
 * O id → 预警。一条线有「当前周的 O」(currentObjectiveId)和「最近已结束周的 O」(objectiveId), 两个 id 都挂上,
 * 看本周和看上周的卡片都能对上
 */
export function riskByObjective(items = []) {
  const m = new Map()
  for (const it of items) {
    const v = { n: it.consecutiveMissedWeeks, level: levelOf(it.level), item: it }
    if (it.objectiveId) m.set(sid(it.objectiveId), v)
    if (it.currentObjectiveId) m.set(sid(it.currentObjectiveId), v)
  }
  return m
}

/** 卡片右上的红 / 黄点: consecutiveMissedWeeks >= 2 才出 */
export function streakOf(map, obj) {
  const v = map?.get?.(sid(obj?.id))
  if (!v || !(v.n >= 2) || !v.level) return null
  return { n: v.n, level: v.level }
}

/** 我的 OKR 顶部: 只要这个人的; CRITICAL 在前(后端已排, 再兜一道) */
export function myRiskBars(items = [], ownerId) {
  const own = items.filter(i => sid(i.ownerId) === sid(ownerId) && levelOf(i.level) && i.consecutiveMissedWeeks >= 2)
  return own.sort((a, b) => (a.level === b.level ? b.consecutiveMissedWeeks - a.consecutiveMissedWeeks : a.level === 'CRITICAL' ? -1 : 1))
}

/** 最近 n 周完成率小条形(老 → 新); 没 O 的周 rate=null */
export function recentRates(item, n = 3) {
  return (item?.weeklyRates || []).slice(-n).map(w => ({
    week: w.week,
    rate: w.rate,
    pct: w.rate == null ? null : Math.round(w.rate * 100),
    missed: !!w.missed
  }))
}

/** 「看看」滚到哪张卡: 先按 id(当前周 / 已结束周), 再按同一负责人 + 标题(后端串线的口径) */
const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
export function findRiskTarget(objectives = [], item) {
  if (!item) return null
  const ids = [item.currentObjectiveId, item.objectiveId].filter(Boolean).map(sid)
  const byId = objectives.find(o => ids.includes(sid(o.id)))
  if (byId) return sid(byId.id)
  const byTitle = objectives.find(o => norm(o.title) === norm(item.title))
  return byTitle ? sid(byTitle.id) : null
}
