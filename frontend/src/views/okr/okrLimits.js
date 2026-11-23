// 0.6.5 OKR 数量上限(系统设置可配) —— 纯函数, 有单测。
// 后端契约(不改): GET /api/okr/settings/limits → { maxObjectives, maxKrsPerObjective, defaults, ranges }
//   ranges: { maxObjectives: [1, 10], maxKrsPerObjective: [1, 20] }; PUT 仅 ADMIN, 越界 400(8103)。
// 拿不到 / 字段坏了 → 回退 3 / 10(只是兜底, 正常值一律以接口为准)。

export const LIMIT_FIELDS = ['maxObjectives', 'maxKrsPerObjective']
export const FALLBACK_LIMITS = Object.freeze({ maxObjectives: 3, maxKrsPerObjective: 10 })
export const FALLBACK_RANGES = Object.freeze({ maxObjectives: Object.freeze([1, 10]), maxKrsPerObjective: Object.freeze([1, 20]) })

const posInt = v => (Number.isInteger(v) && v > 0 ? v : null)
function rangeOf(raw) {
  return Array.isArray(raw) && raw.length === 2 && raw.every(Number.isInteger) && raw[0] <= raw[1] ? [raw[0], raw[1]] : null
}

/** 接口返回 → { maxObjectives, maxKrsPerObjective, defaults, ranges }; 缺字段 / 坏值逐项回退 */
export function normalizeLimits(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const out = { defaults: {}, ranges: {} }
  for (const f of LIMIT_FIELDS) {
    out[f] = posInt(r[f]) ?? FALLBACK_LIMITS[f]
    out.defaults[f] = posInt(r.defaults?.[f]) ?? FALLBACK_LIMITS[f]
    out.ranges[f] = rangeOf(r.ranges?.[f]) ?? [...FALLBACK_RANGES[f]]
  }
  return out
}

/** 页面 bootstrap 读一次; 失败不报错, 回退默认 */
export async function loadLimits(api) {
  try {
    return normalizeLimits(await api())
  } catch {
    return normalizeLimits(null)
  }
}

/** 设置页输入校验: 整数且在范围内 → ''; 否则返回 i18n 参数 { key, p } 给页面出文案 */
export function limitError(value, range) {
  const [lo, hi] = range
  const s = typeof value === 'number' ? String(value) : String(value ?? '').trim()
  if (!/^-?\d+$/.test(s)) return { key: 'okr.limits.err_int', p: { p0: lo, p1: hi } }
  const n = Number(s)
  if (n < lo || n > hi) return { key: 'okr.limits.err_range', p: { p0: lo, p1: hi } }
  return null
}

/** 表单值和已保存值比, 有变才让保存; 只把变了的字段 PUT 上去 */
export function limitsPatch(form, saved) {
  const out = {}
  for (const f of LIMIT_FIELDS) {
    if (String(form[f] ?? '').trim() !== String(saved[f] ?? '')) out[f] = Number(String(form[f]).trim())
  }
  return out
}

/** 活着的 O(不算 DROPPED)数量, 与后端 normalizePlan 同口径 */
export const liveObjectiveCount = list => (list || []).filter(o => o.status !== 'DROPPED').length
