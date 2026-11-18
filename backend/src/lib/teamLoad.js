// 0.5.0 团队负载口径(纯函数, 便于单测)

/** 「手上的活」: 还没做完的任务状态 */
export const OPEN_TASK_STATUSES = ['TODO', 'QUEUED', 'IN_PROGRESS', 'REWORK']

/**
 * 负载档位: IDLE 空闲 / NORMAL 正常 / BUSY 偏满 / OVERLOAD 过载
 * 规则(简单可解释, 第 4 轮再按组长反馈调):
 *   - 逾期 ≥3 或 未完成 ≥12 → OVERLOAD
 *   - 逾期 ≥1 或 未完成 ≥7 或 7 天内到期 ≥4 → BUSY
 *   - 未完成 = 0 → IDLE
 *   - 其余 NORMAL
 */
export function loadLevel({ open = 0, overdue = 0, dueSoon = 0 } = {}) {
  if (overdue >= 3 || open >= 12) return 'OVERLOAD'
  if (overdue >= 1 || open >= 7 || dueSoon >= 4) return 'BUSY'
  if (open === 0) return 'IDLE'
  return 'NORMAL'
}
