// AI 助手入口与抽屉顶部的纯逻辑(无 Vue 依赖, 便于单测)

/** 首次提示(药丸上的小圆点)是否已看过: 点开过一次助手就记下, 之后不再出现 */
export const SEEN_KEY = 'fde_assistant_seen'

export function hasSeen(storage) {
  try { return storage?.getItem(SEEN_KEY) === '1' } catch { return true }
}

export function markSeen(storage) {
  try { storage?.setItem(SEEN_KEY, '1') } catch { /* 隐私模式写不进就算了 */ }
}

/**
 * 抽屉顶部模型区的状态。
 *   loading         还没拿到 /assistant/status
 *   ready / stub    可用(显示模型名)
 *   not_configured  后端明确说没配模型 → 提示管理员配置, 禁用输入
 *   error           拉状态本身失败(网络等) → 显示原因, 同样禁用输入
 */
export function modelState(status) {
  if (!status) return { kind: 'loading', canSend: false }
  if (status.fetchError) return { kind: 'error', canSend: false, reason: status.reason || '' }
  if (!status.available) return { kind: 'not_configured', canSend: false, reason: status.reason || '' }
  if (status.stub) return { kind: 'stub', canSend: true, name: status.model?.name || '' }
  return { kind: 'ready', canSend: true, name: status.model?.model || status.model?.name || '—', title: status.model?.name || '' }
}
