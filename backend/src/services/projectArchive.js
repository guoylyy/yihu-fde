// v2.5.5(#915) 项目关闭/归档口径
// - 关闭 = status 置 CLOSED(枚举里早有, 不新增状态), 同时记 closedAt/closedBy/closeReason/statusBeforeClose
// - 归档态 = CLOSED / CANCELLED 两个终态; 默认列表/看板/工作台/统计一律不含, 显式 archived=true 或按状态筛选才出现
// - 恢复 = 回到 statusBeforeClose(缺省 IN_PROGRESS), 清空关闭字段; 任务/工时/里程碑全程不动, 不物理删除

export const ARCHIVED_STATUSES = ['CLOSED', 'CANCELLED']
export const REOPEN_FALLBACK_STATUS = 'IN_PROGRESS'

export function isArchivedStatus(status) {
  return ARCHIVED_STATUSES.includes(status)
}

/**
 * 项目列表可见性(纯函数): 按 query 决定 where.status
 *   archived=true          → 只看归档(CLOSED/CANCELLED)
 *   status=X               → 明确筛选, 原样(用户点「已关闭」筛选也能看到)
 *   否则                    → 排除 exclude_status(逗号分隔, 前端默认传 ACCEPTED) ∪ 归档态
 */
export function applyProjectVisibility(where, { archived, status, exclude_status } = {}) {
  if (String(archived) === 'true') {
    where.status = { in: ARCHIVED_STATUSES }
    return where
  }
  if (status) {
    where.status = status
    return where
  }
  const excluded = new Set(ARCHIVED_STATUSES)
  for (const s of String(exclude_status || '').split(',').map(s => s.trim()).filter(Boolean)) excluded.add(s)
  where.status = { notIn: [...excluded] }
  return where
}

/** 关闭时写入的字段 */
export function buildCloseData({ fromStatus, actorId, reason, now = new Date() }) {
  return {
    status: 'CLOSED',
    statusBeforeClose: fromStatus && !isArchivedStatus(fromStatus) ? fromStatus : null,
    closedAt: now,
    closedBy: actorId != null ? BigInt(actorId) : null,
    closeReason: reason ? String(reason).trim().slice(0, 500) || null : null
  }
}

/** 恢复时写入的字段 */
export function buildReopenData(project) {
  const back = project?.statusBeforeClose
  return {
    status: back && !isArchivedStatus(back) ? back : REOPEN_FALLBACK_STATUS,
    statusBeforeClose: null,
    closedAt: null,
    closedBy: null,
    closeReason: null
  }
}
