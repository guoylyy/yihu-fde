// OKR 数量上限(0.6.5): 每周最多几个 O、每个 O 最多几条 KR, 在系统设置里配。
// 存在 app_settings 键值表(与免提交名单 okr.exemptUserIds 同一张), 一项一个键, 值是整数字符串:
//   okr.maxObjectives        默认 3, 范围 1–10
//   okr.maxKrsPerObjective   默认 10, 范围 1–20
// 没设过 / 值坏了 / 越界 / 表不可用 → 一律回默认值。只管数量上限, 不碰权重、每 O 至少 1 个 KR 等其它规则。
import prisma from '../lib/prisma.js'
import { OkrRuleError, MAX_OBJECTIVES, MAX_KRS } from './okrRules.js'

export const LIMIT_DEFAULTS = Object.freeze({ maxObjectives: MAX_OBJECTIVES, maxKrsPerObjective: MAX_KRS })
export const LIMIT_RANGES = Object.freeze({ maxObjectives: Object.freeze([1, 10]), maxKrsPerObjective: Object.freeze([1, 20]) })
export const LIMIT_KEYS = Object.freeze({ maxObjectives: 'okr.maxObjectives', maxKrsPerObjective: 'okr.maxKrsPerObjective' })
const LABELS = { maxObjectives: '每周 O 的上限', maxKrsPerObjective: '每个 O 的 KR 上限' }
const FIELDS = Object.keys(LIMIT_KEYS)

function inRange(field, n) {
  const [lo, hi] = LIMIT_RANGES[field]
  return Number.isInteger(n) && n >= lo && n <= hi
}

/** 存库的字符串 → 合法整数, 否则 null(调用方回默认) */
function parseStored(field, raw) {
  if (raw == null || !/^\s*\d+\s*$/.test(String(raw))) return null
  const n = Number(raw)
  return inRange(field, n) ? n : null
}

/** 当前生效的上限 { maxObjectives, maxKrsPerObjective }; db 可传事务 */
export async function okrLimits(db = prisma) {
  const rows = await db.appSetting.findMany({ where: { key: { in: Object.values(LIMIT_KEYS) } } }).catch(() => [])
  const byKey = new Map(rows.map(r => [r.key, r.value]))
  const out = {}
  for (const f of FIELDS) out[f] = parseStored(f, byKey.get(LIMIT_KEYS[f])) ?? LIMIT_DEFAULTS[f]
  return out
}

/** 给设置页: 当前值 + 默认值 + 范围 */
export async function describeLimits() {
  return {
    ...(await okrLimits()),
    defaults: { ...LIMIT_DEFAULTS },
    ranges: { maxObjectives: [...LIMIT_RANGES.maxObjectives], maxKrsPerObjective: [...LIMIT_RANGES.maxKrsPerObjective] }
  }
}

/** 入参 → 整数; 不是整数或越界 → 400(8103), 文案写清范围 */
function checkInput(field, v) {
  const [lo, hi] = LIMIT_RANGES[field]
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  const n = /^-?\d+$/.test(s) ? Number(s) : NaN
  if (!inRange(field, n)) {
    throw new OkrRuleError(`${LABELS[field]}(${field})要是 ${lo}–${hi} 的整数, 收到的是 ${JSON.stringify(v ?? null)}`, { code: 8103 })
  }
  return n
}

/**
 * 改上限。两个字段可只传一个(没传的不动); 一个都没传 → 400。先全部校验再写, 不会只写一半。
 * 返回 { before, after }(都是完整的生效值)
 */
export async function setLimits(input = {}, { by } = {}) {
  const body = input && typeof input === 'object' ? input : {}
  const given = FIELDS.filter(f => body[f] !== undefined)
  if (!given.length) throw new OkrRuleError('至少要传 maxObjectives 或 maxKrsPerObjective 中的一个', { code: 8103 })
  const next = Object.fromEntries(given.map(f => [f, checkInput(f, body[f])]))
  const updatedBy = by != null ? BigInt(by) : null
  return prisma.$transaction(async (tx) => {
    const before = await okrLimits(tx)
    for (const f of given) {
      const value = String(next[f])
      await tx.appSetting.upsert({
        where: { key: LIMIT_KEYS[f] },
        update: { value, updatedBy },
        create: { key: LIMIT_KEYS[f], value, updatedBy }
      })
    }
    return { before, after: { ...before, ...next } }
  })
}
