// 0.5.0 工时降级: 任务上的「实际工时」(小时, 两位小数, DECIMAL(6,2))
// 入参宽松(数字或数字字符串), 出参统一成 number|null, 免得 Prisma Decimal 被序列化成字符串

export const INVALID = Symbol('invalid-hours')
export const MAX_ACTUAL_HOURS = 9999.99
export const ACTUAL_HOURS_MSG = `实际工时须为 0–${MAX_ACTUAL_HOURS} 的数字（小时，最多两位小数）`

/** undefined → undefined(不改); null/'' → null(清空); 合法数字 → 保留两位; 其余 → INVALID */
export function parseActualHours(v) {
  if (v === undefined) return undefined
  if (v === null || (typeof v === 'string' && !v.trim())) return null
  if (typeof v !== 'number' && typeof v !== 'string') return INVALID
  const s = String(v).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return INVALID
  const n = Number(s)
  if (!Number.isFinite(n) || n > MAX_ACTUAL_HOURS) return INVALID
  return n
}

/** Prisma Decimal / string / number → number|null */
export function hoursOut(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function taskOut(task) {
  return task && 'actualHours' in task ? { ...task, actualHours: hoursOut(task.actualHours) } : task
}
