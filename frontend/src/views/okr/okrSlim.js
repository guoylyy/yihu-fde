// 精简第二轮(老板: 团队小, 不要搞复杂): 周 OKR 页的「本周项目计划」+ 我的今日的「今天的总结」—— 纯函数, 有单测。
// 后端契约不改: GET/PUT /api/okr/week-plan(+ /import 只解析不落库)、GET /api/okr/daily?scope=me、PUT /api/okr/daily
import { todayKey, summaryText } from './okrFe3.js'
import { sameId } from './okrPeople.js'

const pad = n => String(n).padStart(2, '0')
/** 上海时间的 { date: 'YYYY-MM-DD', time: 'HH:mm' } */
function shParts(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
  return { date: d.toISOString().slice(0, 10), time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }
}

/**
 * 「今天 16:20」/「昨天 09:05」/「11-18 16:20」(上海时区)
 * t: i18n(okr.slim.today_at / yesterday_at)
 */
export function whenText(iso, t = (k, p) => `${k} ${p.p0}`, now = new Date()) {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const { date, time } = shParts(at)
  const today = todayKey(now)
  if (date === today) return t('okr.slim.today_at', { p0: time })
  if (date === todayKey(new Date(now.getTime() - 86400000))) return t('okr.slim.yesterday_at', { p0: time })
  return `${date.slice(5)} ${time}`
}

/** 周计划右上的小字「张三 今天 16:20 更新」; 没有计划返回 '' */
export function weekPlanMeta(plan, t = (k, p) => `${p.p0} ${p.p1}`, now = new Date()) {
  if (!plan?.updatedAt) return ''
  return t('okr.slim.plan_updated', { p0: plan.updatedByName || '', p1: whenText(plan.updatedAt, t, now) }).trim()
}

/** 有没有正文(空白不算) */
export const hasPlan = plan => !!String(plan?.contentMd || '').trim()

/** 上传 .md 时正文第一个 # 标题当标题(没有就用后端给的文件名); 保存时跟正文一起 PUT */
export function planTitleOf(text, fallback = '') {
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(String(text || ''))
  return (m ? m[1] : String(fallback || '')).slice(0, 200)
}

/** 保存按钮可点: 有正文且和已存的不一样 */
export function planDirty(plan, draft) {
  const v = String(draft || '')
  return !!v.trim() && v !== String(plan?.contentMd || '')
}

// ---------------------------------------------------------------- 今天的总结

export const DIGEST_LIMIT = 5

/**
 * GET /api/okr/daily?scope=me 的返回 → 卡片要画的东西。
 * 本周没交计划的人后端不列(rows 为空), 照样能写: row = null 时 items 为空、summary 为空
 * @returns {{ items: object[], more: number, total: number, summary: string, savedAt: string|null }}
 */
export function todayDigest(view, meId, { limit = DIGEST_LIMIT, expanded = false } = {}) {
  const row = (view?.rows || []).find(r => sameId(r.user?.id, meId)) || null
  const all = row?.autoItems || []
  const items = expanded ? all : all.slice(0, limit)
  return {
    items,
    more: all.length - items.length,
    total: all.length,
    summary: summaryText(row),
    savedAt: row?.hasWritten ? (row.summary?.updatedAt || null) : null
  }
}

/** 保存按钮可点: 写了字且和已存的那句不一样 */
export function digestDirty(saved, draft) {
  const v = String(draft || '').trim()
  return !!v && v !== String(saved || '').trim()
}

/** 「已保存 16:20」里的时间(上海) */
export const savedTime = iso => (iso ? shParts(iso).time : '')
