// OKR 前端第三批(对接后端 4.0 / 5.0): 项目周 OKR、每日总结、周状态与催交、按项目分组、O 选项目。
// 纯函数放这里, 页面只管取数和渲染, 方便单测。

import { weekKey, isoWeekOf } from './okrUtils.js'

const LEAD_ROLES = new Set(['ADMIN', 'MANAGER'])

/** ADMIN / MANAGER: 看周状态、催交、看「今天几人未写」(与后端 leadOnly 同口径) */
export const isLead = (user) => LEAD_ROLES.has(user?.role)

const sid = (v) => (v == null ? '' : String(v))

/**
 * 能否编辑某项目的周 OKR 文档(与后端 canWriteProjectDoc 同口径):
 * ADMIN / MANAGER / 项目经理 / 项目成员(user 直挂, 或老数据挂 engineer.user)。
 * detail: GET /api/fde/projects/:id 的返回(取不到 → null, 只有 ADMIN/MANAGER 能编辑)
 */
export function canEditProjectDoc(user, detail) {
  if (isLead(user)) return true
  const me = sid(user?.id)
  if (!me || !detail) return false
  if (sid(detail.managerId ?? detail.manager?.id) === me) return true
  return (detail.members || []).some(m => sid(m.userId ?? m.user?.id) === me || sid(m.engineer?.userId ?? m.engineer?.user?.id) === me)
}

/** 项目显示名: 「名称 · 编号」, 没编号只出名称 */
export function projectLabel(p) {
  if (!p) return ''
  return p.code ? `${p.name} · ${p.code}` : String(p.name ?? '')
}

/** 上传的项目文档只认 .md / .txt / .docx(≤ 2MB, 与后端 receiveOkrFile 一致); 合法返回 '' */
export const PROJECT_DOC_MAX = 2 * 1024 * 1024
export function projectDocFileProblem(file) {
  if (!file) return 'empty'
  if (!/\.(md|markdown|txt|docx)$/i.test(file.name || '')) return 'type'
  if (file.size > PROJECT_DOC_MAX) return 'size'
  return ''
}

/** Markdown 第一个标题(# xxx), 上传 .md/.txt 时当标题传给后端(不传后端会用文件名); 没有返回 '' */
export function firstHeading(text) {
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(String(text || ''))
  return m ? m[1].slice(0, 200) : ''
}

// ---------------------------------------------------------------- 周状态与催交

/** 进度条三个数: 已提交 / 已自评 / 已打分, 分母都是应交人数(免提交不算) */
export function weekProgress(status) {
  const s = status?.summary || {}
  const total = s.expected || 0
  return {
    total,
    plan: s.planSubmitted || 0,
    self: s.selfScoredAll || 0,
    mgr: s.managerScoredAll || 0,
    exempt: s.exempt || 0,
    incomplete: s.incomplete || 0
  }
}

/**
 * 状态表一行的四格: 计划 / 自评 / 主管分 / 本周总结篇数。
 * bad = 未完成(标红); 免提交那行一律不标红
 */
export function statusCells(row) {
  const ex = !!row.exempt
  const frac = (x) => (x && x.total ? `${x.done}/${x.total}` : '-')
  const unfinished = (x) => !row.planSubmitted || !x || !x.total || x.done < x.total
  return {
    plan: { ok: !!row.planSubmitted, bad: !ex && !row.planSubmitted, late: !!row.lateSubmit },
    self: { text: frac(row.selfScored), bad: !ex && unfinished(row.selfScored) },
    mgr: { text: frac(row.managerScored), bad: !ex && unfinished(row.managerScored) },
    daily: { text: String(row.dailySummaries ?? 0), bad: !ex && !row.dailySummaries }
  }
}

/** 催交返回 → 刚提醒到的人 id 集合(并到之前提醒过的里) */
export function mergeReminded(prev, res) {
  const out = new Set(prev || [])
  for (const r of res?.reminded || []) if (r?.user?.id != null) out.add(String(r.user.id))
  return out
}

/** 催交返回里被跳过的人按原因计数: { RECENTLY_REMINDED: 2, ... } */
export function skippedByReason(res) {
  const out = {}
  for (const s of res?.skipped || []) out[s.reason] = (out[s.reason] || 0) + 1
  return out
}

// ---------------------------------------------------------------- 每日总结

/** 今天(上海时区)的 YYYY-MM-DD, 与后端 todayShanghai 同口径 */
export function todayKey(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 某天(上海)是哪个 ISO 周(YYYY-Www), 每日总结页跳回团队页用 */
export function weekKeyOfDate(dateKey) {
  const d = new Date(`${dateKey}T12:00:00+08:00`)
  return Number.isNaN(d.getTime()) ? '' : weekKey(isoWeekOf(d))
}

/** 有 OKR(本周交了计划)但没写的人, 与后端 dailyMissing 同口径 */
export function dailyMissingRows(view) {
  return (view?.rows || []).filter(r => r.hasOkr && !r.hasWritten)
}

/** 给群里 @ 的提醒文案(后端没有每日总结的催交接口, 先复制出去) */
export function dailyRemindText(rows, date, t) {
  const names = rows.map(r => '@' + (r.user?.name || r.user?.username || r.user?.id)).join(' ')
  return t('okr.daily.remind_text', { p0: names, p1: date })
}

/** 卡片上的输入框初值: 写过就是原文, 没写就空 */
export const summaryText = (row) => row?.summary?.summaryMd || ''

// ---------------------------------------------------------------- 按项目分组

/** 分组块头: O 数(不含放弃的)、有 O 的人数、平均完成度(后端 groupSummary 加权) */
export function groupHead(g) {
  const live = (g.objectives || []).filter(o => o.status !== 'DROPPED')
  return {
    key: g.project?.id ?? 'none',
    name: g.project?.name ?? '',
    code: g.project?.code ?? null,
    unassigned: g.project?.id == null,
    objectiveCount: live.length,
    ownerCount: g.ownerCount ?? new Set((g.objectives || []).map(o => o.owner?.id)).size,
    completion: g.completion ?? null
  }
}

/** 「未挂项目」组放最后(后端已经这么排, 这里再兜一道) */
export function orderGroups(groups = []) {
  return [...groups].sort((a, b) => Number(a.project?.id == null) - Number(b.project?.id == null))
}

/** 块内按人分段: [{ owner, objectives }], 保持后端顺序(负责人名 → seq) */
export function byOwner(objectives = []) {
  const map = new Map()
  for (const o of objectives) {
    const k = sid(o.owner?.id)
    if (!map.has(k)) map.set(k, { owner: o.owner || { id: k }, objectives: [] })
    map.get(k).objectives.push(o)
  }
  return [...map.values()]
}

// ---------------------------------------------------------------- O 选项目

/**
 * 编辑器「所属项目」下拉的选项: 项目列表 + 这份计划里已挂但列表里没有的(如不在我数据范围内的项目),
 * 免得已挂的项目显示成光秃秃的 id
 */
export function projectOptions(list = [], objectives = []) {
  const map = new Map()
  for (const p of list) map.set(sid(p.id), { id: sid(p.id), name: p.name, code: p.code || null })
  for (const o of objectives) for (const p of o.projects || []) if (!map.has(sid(p.id))) map.set(sid(p.id), { id: sid(p.id), name: p.name, code: p.code || null })
  return [...map.values()]
}
