// OKR 前端第三批(对接后端 4.0): 周状态与催交、每日总结的公共小函数。
// 精简第二轮删掉了项目周 OKR / 按项目分组 / O 选项目 / 独立每日总结页的那部分。
// 纯函数放这里, 页面只管取数和渲染, 方便单测。

const LEAD_ROLES = new Set(['ADMIN', 'MANAGER'])

/** ADMIN / MANAGER: 看周状态、催交(与后端 leadOnly 同口径) */
export const isLead = (user) => LEAD_ROLES.has(user?.role)

const sid = (v) => (v == null ? '' : String(v))

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

// ---------------------------------------------------------------- 每日总结(精简第二轮起在「我的今日」卡片里)

/** 今天(上海时区)的 YYYY-MM-DD, 与后端 todayShanghai 同口径 */
export function todayKey(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 输入框初值: 写过就是原文, 没写就空 */
export const summaryText = (row) => row?.summary?.summaryMd || ''
