// 0.6.3 前端: 「完成本周」不再被没交自评的人卡住。纯函数放这里, 组件只管取数和渲染, 方便单测。
// 后端口径(close-by-score):
//   - 已交自评、没有主管分的 O → 8116 + data.missing[] 拦住(主管该干的活); allowUnscoredSelfScored=true 才放行
//   - 没交自评的 O → 不拦, 按未评归档; 按人汇总在 pendingSelfScore[{ userId, name, objectiveCount }]

/** 缺项错误码(已交自评未打分 / 这周没人提交) */
export const CLOSE_MISSING_CODE = 8116

/** 名单最多点几个名字, 多了写「等 N 人」 */
export const NAME_LIMIT = 5

/** 2026-W47 → W47; 不认识的原样返回 */
export function shortWeek(key) {
  const m = /W(\d{1,2})$/.exec(String(key || ''))
  return m ? `W${Number(m[1])}` : String(key || '')
}

/** 名字串: 张三、李四; 超过 limit 截断(调用方再拼「等 N 人」) */
export function nameList(people, limit = NAME_LIMIT) {
  const names = (people || []).map(p => p?.name || p?.username || String(p?.userId ?? '')).filter(Boolean)
  return { text: names.slice(0, limit).join('、'), more: Math.max(0, names.length - limit), total: names.length }
}

/**
 * 8116 的错误 → { missing, pendingSelfScore } ; 别的错误(或 8116 但没 missing, 如「这周还没人提交」)返回 null,
 * 调用方照旧把 message 原样展示。request() 把整个响应体挂在 err.data 上, 业务数据在 err.data.data
 */
export function parseCloseError(e) {
  if (!e || Number(e.code) !== CLOSE_MISSING_CODE) return null
  const d = e.data?.data || e.data || {}
  if (!Array.isArray(d.missing) || !d.missing.length) return null
  return { missing: d.missing, pendingSelfScore: Array.isArray(d.pendingSelfScore) ? d.pendingSelfScore : [] }
}

/** 缺项按人分组: [{ ownerId, ownerName, items: [{ objectiveId, seq, title }] }], 保持后端顺序 */
export function groupMissing(missing) {
  const out = []
  for (const m of missing || []) {
    const id = String(m.ownerId)
    let g = out.find(x => x.ownerId === id)
    if (!g) out.push(g = { ownerId: id, ownerName: m.ownerName, items: [] })
    g.items.push({ objectiveId: String(m.objectiveId), seq: m.seq, title: m.title })
  }
  return out
}

/**
 * 面板里「保存后仍是已交自评、没有主管分」的 O 数(= 归档会被拦的数)。
 * 自己的 O 也算(后端同样拦), 没交自评的不算
 */
export function unscoredSelfCount(groups) {
  let n = 0
  for (const g of groups || []) for (const r of g.rows || []) if (r.selfScore != null && r.score == null) n++
  return n
}

/** 面板里没交自评的人(按人汇总, 与后端 pendingSelfScore 同形状), 二次确认时先点名; 8116 后以后端名单为准 */
export function pendingSelfFromGroups(groups) {
  const out = []
  for (const g of groups || []) {
    const n = (g.rows || []).filter(r => r.selfScore == null).length
    if (n) out.push({ userId: String(g.user.id), name: g.user.name || g.user.username, objectiveCount: n })
  }
  return out
}

/** 归档成功的提示文案: 有没交自评的人 → 「已归档 W47；张三、李四 未交自评，本周按未评归档」, 否则「已归档 W47」 */
export function closedNoticeText(t, week, pending) {
  const n = nameList(pending)
  if (!n.total) return t('okr.close.closed_ok', { p0: shortWeek(week) })
  const names = n.more ? t('okr.close.names_more', { p0: n.text, p1: n.total }) : n.text
  return t('okr.close.closed_with_pending', { p0: shortWeek(week), p1: names })
}

/**
 * 周状态(/week/status) → 没交自评的人, 与后端 pendingSelfScore 同口径:
 * 有已提交的 O 且其中有没自评的(免提交的人交了也算, 后端归档时不区分)
 */
export function pendingSelfFromStatus(status) {
  const out = []
  for (const r of status?.rows || []) {
    const s = r.selfScored
    if (s && s.total > 0 && s.done < s.total) out.push({ userId: String(r.user.id), name: r.user.name || r.user.username, objectiveCount: s.total - s.done })
  }
  return out
}

/** 团队矩阵「自评」列: 有分显示分; 交了计划但没自评 → 灰字「未交」; 没提交 → - */
export function selfCell(row) {
  if (row?.selfScore != null) return { kind: 'score', text: String(row.selfScore) }
  if (row?.submitted || (row?.submission && row.submission !== 'NONE')) return { kind: 'missing' }
  return { kind: 'none' }
}

/** 归档提示条可关闭: 记在 localStorage, 按周 */
const DISMISS_KEY = 'fde_okr_close_notice_dismissed'
export function noticeDismissed(week, store = globalThis.localStorage) {
  try { return JSON.parse(store?.getItem(DISMISS_KEY) || '[]').includes(week) } catch { return false }
}
export function dismissNotice(week, store = globalThis.localStorage) {
  try {
    const list = JSON.parse(store?.getItem(DISMISS_KEY) || '[]').filter(w => w !== week)
    store?.setItem(DISMISS_KEY, JSON.stringify([week, ...list].slice(0, 20)))
  } catch { /* 存不了就只关本次 */ }
}
