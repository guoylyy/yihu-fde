// OKR 免提交白名单: 不需要交 OKR 的人(比如两三个员工)。
// 存在 app_settings 键值表, 键 okr.exemptUserIds, 值是 JSON 数组字符串(如 ["12","15"])。
//
// 生效范围: /team 列表与汇总、个人概览 / 统计、连续低完成率、周一未提交提醒 —— 白名单里的人一律不出现、不计迟交。
// 不影响登录和查看他人; 他要是自己交了 OKR, 照常记录(/my、/cycle 照常能看), 只是不进统计。
import prisma from '../lib/prisma.js'
import { OkrRuleError } from './okrRules.js'

export const EXEMPT_KEY = 'okr.exemptUserIds'
export const MAX_EXEMPT = 50

function parseIds(raw) {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? [...new Set(arr.map(String).filter(v => /^\d+$/.test(v)))] : []
  } catch { return [] }
}

/** 白名单 userId(字符串)集合; 表不可用时当空 */
export async function exemptIds(db = prisma) {
  const row = await db.appSetting.findUnique({ where: { key: EXEMPT_KEY } }).catch(() => null)
  return new Set(parseIds(row?.value))
}

export async function isExempt(userId) {
  return (await exemptIds()).has(String(userId))
}

async function usersOf(ids) {
  if (!ids.length) return []
  const rows = await prisma.user.findMany({
    where: { id: { in: ids.map(BigInt) } },
    select: { id: true, name: true, username: true, role: true, deletedAt: true }
  })
  const byId = new Map(rows.map(u => [String(u.id), u]))
  return ids.filter(id => byId.has(id)).map(id => {
    const u = byId.get(id)
    return { id, name: u.name, username: u.username, role: u.role }
  })
}

/** 给设置页: { userIds, users } */
export async function describeExempt() {
  const userIds = [...(await exemptIds())]
  return { userIds, users: await usersOf(userIds) }
}

/**
 * 整份覆盖白名单。校验: 数组、每项是数字 id、去重后 ≤ 50、都是真实(未删除)用户。
 * 返回 { before, after, added, removed }
 */
export async function setExempt(input, { by }) {
  if (!Array.isArray(input)) throw new OkrRuleError('userIds 要是数组', { code: 8140 })
  const ids = [...new Set(input.map(v => String(v ?? '').trim()))]
  const bad = ids.filter(v => !/^\d+$/.test(v))
  if (bad.length) throw new OkrRuleError(`userId 不合法: ${bad.slice(0, 5).join('、')}`, { code: 8140 })
  if (ids.length > MAX_EXEMPT) throw new OkrRuleError(`免提交名单最多 ${MAX_EXEMPT} 人, 现在是 ${ids.length} 人`, { code: 8140 })
  const found = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids.map(BigInt) }, deletedAt: null }, select: { id: true } })
    : []
  const ok = new Set(found.map(u => String(u.id)))
  const missing = ids.filter(id => !ok.has(id))
  if (missing.length) throw new OkrRuleError(`这些用户不存在: ${missing.join('、')}`, { code: 8141 })

  const before = [...(await exemptIds())]
  const value = JSON.stringify(ids)
  await prisma.appSetting.upsert({
    where: { key: EXEMPT_KEY },
    update: { value, updatedBy: by != null ? BigInt(by) : null },
    create: { key: EXEMPT_KEY, value, updatedBy: by != null ? BigInt(by) : null }
  })
  return {
    before,
    after: ids,
    added: ids.filter(id => !before.includes(id)),
    removed: before.filter(id => !ids.includes(id))
  }
}
