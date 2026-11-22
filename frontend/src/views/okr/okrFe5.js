// OKR 前端第五批: 导出 / 决策记录 / 连续未达成预警 —— 纯函数(页面和组件只管画, 规则都在这里, 方便单测)。
// 后端契约: GET /api/okr/export、/api/okr/decisions*、/api/okr/risk/objectives(见 backend/src/routes/okr.js), 前端不改口径。
import { weekKey, isoWeekOf, parseKey, weekStart } from './okrUtils.js'
import { todayKey } from './okrFe3.js'

const sid = v => (v == null ? '' : String(v))
const DAY = 86400000

// ---------------------------------------------------------------- 一、导出

/** 团队 / 项目导出只给 ADMIN / MANAGER(后端 exportAudience 同口径: 其余 403 8181) */
export const mayExportTeam = (user) => user?.role === 'ADMIN' || user?.role === 'MANAGER'

/**
 * 导出下拉的选项。
 * page='mine': Excel 明细 / Word 汇报 —— 导当前看的人(默认自己)这一周, scope=person
 * page='team': 上面两项导自己; ADMIN / MANAGER 多一项「团队 Excel」(scope=team); 按项目视图且选了项目时改成该项目(scope=project)
 * @returns {{ key, label, params: { week, scope, format, userId?, projectId? } }[]}
 */
export function exportItems({ page = 'mine', user, week, userId, project = null } = {}) {
  const self = sid(userId || user?.id)
  const person = format => ({ week, scope: 'person', format, userId: self })
  const items = [
    { key: 'xlsx', label: 'okr.fe5.export_xlsx', params: person('xlsx') },
    { key: 'docx', label: 'okr.fe5.export_docx', params: person('docx') }
  ]
  if (page === 'team' && mayExportTeam(user)) {
    if (project?.id != null) {
      items.push({ key: 'project', label: 'okr.fe5.export_project', labelArgs: { p0: project.name || project.id }, params: { week, scope: 'project', format: 'xlsx', projectId: sid(project.id) }, divided: true })
    } else {
      items.push({ key: 'team', label: 'okr.fe5.export_team', params: { week, scope: 'team', format: 'xlsx' }, divided: true })
    }
  }
  return items
}

/** 按项目视图里某个项目块的导出(ADMIN / MANAGER): Excel 明细 / Word 汇报, scope=project; 「未挂项目」块没有 */
export function projectExportItems({ user, week, project } = {}) {
  if (!mayExportTeam(user) || project?.id == null || project.id === 'none') return []
  const params = format => ({ week, scope: 'project', format, projectId: sid(project.id) })
  return [
    { key: 'xlsx', label: 'okr.fe5.export_xlsx', params: params('xlsx') },
    { key: 'docx', label: 'okr.fe5.export_docx', params: params('docx') }
  ]
}

/** /api/okr/export?...(空值不带) */
export function exportUrl(params = {}) {
  const q = new URLSearchParams()
  for (const k of ['week', 'scope', 'format', 'userId', 'projectId']) {
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

// ---------------------------------------------------------------- 二、决策记录

/** 默认时间范围: 最近 8 周(含今天, 上海日期) → { from, to } YYYY-MM-DD */
export function defaultDecisionRange(weeks = 8, now = new Date()) {
  const to = todayKey(now)
  const from = todayKey(new Date(now.getTime() - (weeks * 7 - 1) * DAY))
  return { from, to }
}

/** 标题 / 正文搜索(时间线接口不带 q, 在已取回的范围里筛; 大小写不敏感) */
export function filterDecisions(list = [], q = '') {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return list
  return list.filter(d => String(d.title || '').toLowerCase().includes(s) || String(d.detail || '').toLowerCase().includes(s))
}

/** 每条决策在时间线上的样子: 状态样式 + 「已被 X 取代」里 X 的标题(列表里有就直接取, 没有用 cache, 再没有给 null 由页面去补) */
export function decisionRow(d, byId = new Map(), cache = new Map()) {
  const sup = d.supersededBy ? (byId.get(sid(d.supersededBy)) || cache.get(sid(d.supersededBy)) || null) : null
  return {
    ...d,
    superseded: d.status === 'SUPERSEDED',
    reverted: d.status === 'REVERTED',
    supersededTitle: sup?.title ?? null,
    supersededInList: !!(d.supersededBy && byId.has(sid(d.supersededBy))),
    tags: [
      ...(d.project ? [{ kind: 'project', text: d.project.name, id: d.project.id }] : []),
      ...(d.objective ? [{ kind: 'objective', text: d.objective.title, id: d.objective.id, owner: d.objective.ownerName }] : [])
    ]
  }
}

/** 取代链上要补查标题的 id(列表里没有、cache 里也没有) */
export function missingSupersederIds(list = [], cache = new Map()) {
  const ids = new Set(list.map(d => sid(d.id)))
  return [...new Set(list.filter(d => d.supersededBy).map(d => sid(d.supersededBy)))].filter(id => !ids.has(id) && !cache.has(id))
}

/** 卡片菜单: 撤销(能改且生效中) / 取代(后端 can.supersede, 只 ADMIN / MANAGER 且 ACTIVE) */
export function decisionMenu(d) {
  const acts = []
  if (d?.status === 'ACTIVE' && d?.can?.edit) acts.push('revert')
  if (d?.can?.supersede) acts.push('supersede')
  return acts
}

/**
 * 撤销请求体。后端契约: PATCH status=REVERTED 必须带 rationale(否则 400 8193), 而 rationale 字段同时是「为什么这么定」。
 * 为了不把原来的理由冲掉: 有原因时写成「撤销原因: X」+ 原理由; 没填原因就原样发空, 让后端的 400 文案透出来(前端不拦)
 */
export function revertPayload(reason, original, t = k => k) {
  const r = String(reason || '').trim()
  if (!r) return { status: 'REVERTED', rationale: '' }
  const head = t('okr.fe5.dec_revert_prefix', { p0: r })
  const orig = String(original || '').trim()
  return { status: 'REVERTED', rationale: orig ? `${head}\n\n${t('okr.fe5.dec_orig_rationale', { p0: orig })}` : head }
}

/** 新建请求体(空的可选字段不带) */
export function decisionPayload(form = {}) {
  const out = { title: String(form.title || '').trim(), detail: String(form.detail || '').trim() }
  for (const k of ['rationale', 'impact']) {
    const v = String(form[k] || '').trim()
    if (v) out[k] = v
  }
  if (form.objectiveId) out.objectiveId = sid(form.objectiveId)
  if (form.projectId) out.projectId = sid(form.projectId)
  if (form.decidedAt) out.decidedAt = form.decidedAt instanceof Date ? form.decidedAt.toISOString() : String(form.decidedAt)
  return out
}

/** 右栏: 本周决策数(按上海日期落在本周的) + 按项目分布(时间线范围内, 多的在前, 「未挂项目」垫底) */
export function decisionStats(list = [], now = new Date()) {
  const wk = weekKey(isoWeekOf(now))
  const s = weekStart(parseKey(wk))
  const from = todayKey(s)
  const to = todayKey(new Date(s.getTime() + 6 * DAY))
  const thisWeek = list.filter(d => d.date >= from && d.date <= to).length
  const by = new Map()
  for (const d of list) {
    const k = d.project ? sid(d.project.id) : ''
    if (!by.has(k)) by.set(k, { id: k || null, name: d.project?.name || '', count: 0 })
    by.get(k).count++
  }
  const projects = [...by.values()].sort((a, b) => (!a.id) - (!b.id) || b.count - a.count || a.name.localeCompare(b.name, 'zh'))
  const max = projects.reduce((m, p) => Math.max(m, p.count), 0)
  return { week: wk, thisWeek, projects: projects.map(p => ({ ...p, ratio: max ? p.count / max : 0 })) }
}

/** 「挂到 O」的选项: 团队视图的行(主管)或自己这一周的 O(工程师); 去掉 DROPPED, 标签带负责人 */
export function objectiveOptions({ rows = null, objectives = null, owner = null } = {}) {
  const out = []
  if (rows) {
    for (const r of rows) {
      for (const o of r.objectives || []) {
        if (o.status === 'DROPPED') continue
        out.push({ id: sid(o.id), label: `${o.title} · ${r.user?.name || ''}`.trim() })
      }
    }
  } else {
    for (const o of objectives || []) {
      if (o.status === 'DROPPED') continue
      out.push({ id: sid(o.id), label: owner?.name ? `${o.title} · ${owner.name}` : o.title })
    }
  }
  return out
}

/** O 卡片底部「决策 N 条」(O 视图带的是最近 3 条) */
export function decisionBriefs(obj) {
  return (obj?.decisions || []).map(d => ({ ...d, date: d.decidedAt ? todayKey(new Date(d.decidedAt)) : '' }))
}

// ---------------------------------------------------------------- 三、连续未达成预警

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

/** 团队页一行字: 用后端 summary(critical + warn), 不自己数 */
export function riskSummaryCounts(summary = {}) {
  const critical = Number(summary?.critical) || 0
  const warn = Number(summary?.warn) || 0
  return { total: critical + warn, critical, warn }
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
