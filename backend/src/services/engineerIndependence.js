// 自动画像只给出可核对的建议，不替代经理验收。
export function deriveIndependence({ delivery, firstPassRate, approvedHours3m, tasks }) {
  const reasons = []
  if (tasks < 3) reasons.push('任务样本不足（至少3个已分派任务）')
  if (delivery == null || delivery < 80) reasons.push('累计交付完成度低于80%')
  if (firstPassRate == null || firstPassRate < 80) reasons.push('验收一次通过率低于80%')
  if (approvedHours3m < 16) reasons.push('近三月已审批工时不足16小时')
  return { eligible: reasons.length === 0, reasons }
}
