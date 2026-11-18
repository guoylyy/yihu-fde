// 0.5.0 团队页共用小工具
export const LOAD_LEVELS = ['OVERLOAD', 'BUSY', 'NORMAL', 'IDLE']
export const LOAD_TAG = { OVERLOAD: 'danger', BUSY: 'warning', NORMAL: 'success', IDLE: 'info' }
const LOAD_RANK = { OVERLOAD: 0, BUSY: 1, NORMAL: 2, IDLE: 3 }

/** engineer.skills 存量里有字符串也有 { name, level } 对象 */
export function skillName(s) {
  if (typeof s === 'string') return s
  return s?.name || s?.skill || ''
}

/** 负载表排序: 档位重的在前, 同档逾期多、手上活多的在前 */
export function sortByLoad(list) {
  return [...(list || [])].sort((a, b) =>
    (LOAD_RANK[a.load] ?? 9) - (LOAD_RANK[b.load] ?? 9) ||
    (b.overdue || 0) - (a.overdue || 0) ||
    (b.open || 0) - (a.open || 0) ||
    String(a.name || '').localeCompare(String(b.name || '')))
}
