// OKR 前端第四批: 阶段型 KR、卡点与风险、复制上周 / 批量导入 / 模板(纯函数, 有单测)
//
// 后端口径(6.0 / 7.0, 不改契约):
//  - 阶段型 KR: targetValue = 阶段数, currentValue = 已完成阶段数; 阶段按顺序推进, 前 currentValue 个 done(服务器回写)
//  - 卡点: 说明 / 卡在谁 / 截止日 要么都空要么都填, 填一半后端 400(8120「填了卡点就要写清卡在谁、什么时候要」)
//  - copy-from-week / bulk-import 只往目标周追加草稿; 目标周已提交 → 8171
import { todayKey } from './okrFe3.js'
import { toDraft } from './okrUtils.js'

export const MAX_MILESTONES = 20
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH']
export const BLOCKER_MAX = 2000

// ---------------------------------------------------------------- 一、阶段型 KR

/** KR 的阶段列表(展示用): 补 overdue = 有计划日期、早于今天(上海)、还没完成 */
export function milestoneRows(kr, today = todayKey()) {
  return (kr?.milestones || []).map((m, i) => ({
    index: i,
    name: m.name,
    dueDate: m.dueDate || null,
    done: !!m.done,
    overdue: !m.done && !!m.dueDate && m.dueDate < today
  }))
}

/** 已完成 / 总阶段数(明细为准, 没明细用数值) */
export function milestoneCount(kr) {
  const list = kr?.milestones || []
  if (list.length) return { done: list.filter(m => m.done).length, total: list.length }
  return { done: Number(kr?.currentValue) || 0, total: Number(kr?.targetValue) || 0 }
}

/**
 * 点第 i 个阶段: 阶段按顺序推进 —— 点未完成的 = 它和它之前的都完成; 点已完成的 = 它和它之后的都取消。
 * 返回 { kind: 'complete' }(全部完成, 走 /complete done=true) | { kind: 'patch', value } | null(没变化)
 */
export function milestoneClick(kr, i) {
  const { done, total } = milestoneCount(kr)
  if (!(i >= 0 && i < total)) return null
  const row = (kr.milestones || [])[i]
  const isDone = row ? !!row.done : i < done
  const value = isDone ? i : i + 1
  if (value === done) return null
  if (value === total) return { kind: 'complete' }
  return { kind: 'patch', value }
}

/** 已完成 value 个阶段后的明细(与后端 milestonesWithDone 同口径) */
export function milestonesWithDone(list, value) {
  return (list || []).map((m, i) => ({ name: m.name, dueDate: m.dueDate ?? null, done: i < value }))
}

/** 单条 KR 进度 0–1(同后端 krProgress) */
export function krProgress(kr) {
  if (kr.status === 'DONE') return 1
  if (kr.metricType === 'BINARY') return 0
  const target = Number(kr.targetValue)
  if (!(target > 0)) return 0
  return Math.max(0, Math.min(1, Number(kr.currentValue || 0) / target))
}

/** O 完成度: KR 进度按 KR 权重加权(同后端 objectiveProgress) */
export function objectiveProgress(o) {
  const krs = o.keyResults || []
  if (!krs.length) return 0
  const wsum = krs.reduce((s, k) => s + Number(k.weight || 0), 0)
  if (wsum <= 0) return krs.reduce((s, k) => s + krProgress(k), 0) / krs.length
  return krs.reduce((s, k) => s + krProgress(k) * Number(k.weight || 0), 0) / wsum
}

/** 一个人一周的完成度: O 完成度按 O 权重加权, DROPPED 不计(同后端 personProgress) */
export function personProgress(objectives) {
  const live = (objectives || []).filter(o => o.status !== 'DROPPED')
  if (!live.length) return null
  const wsum = live.reduce((s, o) => s + Number(o.weight || 0), 0)
  if (wsum <= 0) return live.reduce((s, o) => s + objectiveProgress(o), 0) / live.length
  return live.reduce((s, o) => s + objectiveProgress(o) * Number(o.weight || 0), 0) / wsum
}

const r4 = n => (n == null ? null : Math.round(n * 10000) / 10000)

/**
 * PATCH /krs/:id 成功后就地更新: 这条 KR 的已完成数 / 阶段 done / 状态 / 进度, 以及所在 O 和整周的完成度。
 * res = PATCH 的返回 { valueAfter, statusAfter }。返回被改的 O(找不到 null)
 */
export function applyMilestonePatch(data, krId, res) {
  if (!data || !res) return null
  for (const o of data.objectives || []) {
    const kr = (o.keyResults || []).find(k => String(k.id) === String(krId))
    if (!kr) continue
    const value = Number(res.valueAfter)
    kr.currentValue = value
    if (res.statusAfter !== undefined) kr.status = res.statusAfter
    if (kr.milestones?.length) kr.milestones = milestonesWithDone(kr.milestones, value)
    kr.progress = r4(krProgress(kr))
    o.progress = r4(objectiveProgress(o))
    data.completion = r4(personProgress(data.objectives))
    return o
  }
  return null
}

/** 编辑器里的空阶段 */
export const blankMilestone = () => ({ name: '', dueDate: null, done: false })

/** 编辑器里勾 / 取消第 i 个阶段: 同样按顺序(勾它 = 之前都勾; 取消它 = 之后都取消); 原地改并返回 */
export function setMilestoneDone(list, i, done) {
  list.forEach((m, j) => {
    if (done && j <= i) m.done = true
    if (!done && j >= i) m.done = false
  })
  return list
}

/** 编辑器里阶段型 KR 的问题(planProblems 里用): 至少 1 个阶段; 每个阶段要有名字 */
export function milestoneProblems(k, t = (key, p) => key) {
  if (k.metricType !== 'MILESTONE') return []
  const list = k.milestones || []
  if (!list.length) return [t('okr.ms.need_one', { p0: k.title || '?' })]
  if (list.length > MAX_MILESTONES) return [t('okr.ms.too_many', { p0: k.title || '?', p1: MAX_MILESTONES })]
  if (list.some(m => !String(m.name || '').trim())) return [t('okr.ms.need_name', { p0: k.title || '?' })]
  return []
}

/** 提交给 /plan 的阶段明细: 去空白; 目标值 = 阶段数 */
export function milestonePayload(list) {
  return (list || []).map(m => ({ name: String(m.name || '').trim(), dueDate: m.dueDate || null, done: !!m.done }))
}

/**
 * 编辑器里的一条 KR → /plan 的 KR: 去掉内部字段; 卡点说明空 = null(清空);
 * 阶段型带阶段明细、目标值 = 阶段数、没有单位; 其他类型不带 milestones
 */
export function editorKrPayload({ _k, _blk, milestones, ...k }) {
  const out = { ...k, unit: k.unit || null, blockers: String(k.blockers || '').trim() || null }
  if (k.metricType === 'MILESTONE') {
    out.milestones = milestonePayload(milestones)
    out.targetValue = out.milestones.length
    out.unit = null
  }
  return out
}

// ---------------------------------------------------------------- 二、卡点与风险

/** 卡点表单的状态: empty(三项都空) / complete(都填) / partial(填了一半, 禁止保存) */
export function blockerFormState(f) {
  const filled = [String(f?.blockers || '').trim(), f?.blockerOwnerId ? String(f.blockerOwnerId) : '', f?.blockerDueDate || ''].map(Boolean)
  if (filled.every(Boolean)) return 'complete'
  if (!filled.some(Boolean)) return 'empty'
  return 'partial'
}

/** 从 O 的 blocker 摘要 + riskLevel 生成卡点表单初值 */
export function blockerForm(o) {
  const b = o?.blocker
  return {
    blockers: b?.text || '',
    blockerOwnerId: b?.ownerId ? String(b.ownerId) : '',
    blockerDueDate: b?.dueDate || '',
    riskLevel: RISK_LEVELS.includes(o?.riskLevel) ? o.riskLevel : 'LOW'
  }
}

/** 卡点表单 → /plan 里这个 O 要带的字段(空 = 清空三件套) */
export function blockerPatch(f) {
  const empty = blockerFormState(f) === 'empty'
  return {
    blockers: empty ? '' : String(f.blockers).trim(),
    blockerOwnerId: empty ? null : String(f.blockerOwnerId),
    blockerDueDate: empty ? null : f.blockerDueDate,
    riskLevel: RISK_LEVELS.includes(f.riskLevel) ? f.riskLevel : 'LOW'
  }
}

/** 卡点人候选: 在职用户 + 当前卡点人(可能已停用 / 不在列表里), 按 id 去重 → [{ id, name, username }] */
export function blockerPeople(list = [], blocker = null) {
  const out = new Map()
  for (const u of list || []) {
    const id = String(u.id)
    if (!out.has(id)) out.set(id, { id, name: u.name || '', username: u.username || '' })
  }
  if (blocker?.ownerId && !out.has(String(blocker.ownerId))) {
    out.set(String(blocker.ownerId), { id: String(blocker.ownerId), name: blocker.ownerName || '', username: '' })
  }
  return [...out.values()]
}

/** 卡点逾期天数: 截止日早于今天几天(没逾期 0) */
export function overdueDays(dueDate, today = todayKey()) {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0
  const d = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(dueDate).slice(0, 10)}T00:00:00Z`)) / 86400000
  return d > 0 ? Math.round(d) : 0
}

/**
 * 只改某个 O 的卡点 / 风险时提交给 /plan 的整份计划(/plan 是整份覆盖)。
 * 其他 O 不带卡点字段(= 后端不动已有的); KR 带上阶段明细和卡点说明, 免得被清掉
 */
export function planWithPatch(objectives, objectiveId, patch) {
  return toDraft(objectives).map(({ projects: _p, ...o }) => ({
    ...o,
    ...(String(o.id) === String(objectiveId) ? patch : {}),
    keyResults: o.keyResults.map(k => ({ ...k, unit: k.unit || null, milestones: k.metricType === 'MILESTONE' ? milestonePayload(k.milestones) : undefined }))
  }))
}

/** 编辑器里有没有没保存的改动: 当前计划和打开时的快照比(只看计划字段) */
export function planSnapshot(objectives) {
  return JSON.stringify((objectives || []).map(o => ({
    id: o.id || null, title: String(o.title || '').trim(), description: String(o.description || '').trim(), weight: Number(o.weight) || 0, status: o.status || 'ON_TRACK',
    projectIds: [...(o.projectIds || [])].map(String).sort(),
    keyResults: (o.keyResults || []).map(k => ({
      id: k.id || null, title: String(k.title || '').trim(), metricType: k.metricType, unit: k.unit || '', targetValue: k.targetValue ?? null, weight: Number(k.weight) || 0,
      blockers: String(k.blockers || '').trim(), milestones: k.metricType === 'MILESTONE' ? milestonePayload(k.milestones) : null
    }))
  })))
}
