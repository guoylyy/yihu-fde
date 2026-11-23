// OKR 2.0 前端: 看别人 / 代操作 / 个人统计用的纯函数(有单测)。
// 权限判断以后端为准(/cycle 的 can.proxy、响应里有没有 managerScore 字段), 这里只决定界面画不画。
import { weightsByKrCount } from './okrUtils.js'
import { FALLBACK_LIMITS } from './okrLimits.js'

export const DRAFT_FILE_MAX = 2 * 1024 * 1024
export const DRAFT_FILE_ACCEPT = '.md,.markdown,.txt,.docx'
const DRAFT_FILE_EXT = /\.(md|markdown|txt|docx)$/i


/** 当前登录人 { id, name, role }(localStorage); 拿不到返回 {} */
export function currentUser(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem('fde_internal_user') || '{}') || {} } catch { return {} }
}

export const sameId = (a, b) => a != null && b != null && String(a) === String(b)

/** 地址里要看谁: userId 优先, 兼容老链接的 ownerId; 没有 = 自己 */
export function viewedUserId(query = {}) {
  return String(query.userId || query.ownerId || '')
}

/** 切到某人: 写 userId, 去掉老的 ownerId; 选回自己就把 userId 也去掉(地址回到 /admin/okr) */
export function queryForPerson(query = {}, userId, meId) {
  const { ownerId: _o, userId: _u, ...rest } = query
  if (!userId || sameId(userId, meId)) return rest
  return { ...rest, userId: String(userId) }
}

/** 头像占位: 姓名首字(英文名大写) */
export function initialOf(name) {
  const s = String(name || '').trim()
  return s ? Array.from(s)[0].toUpperCase() : '?'
}

/** 筛选器的人: /api/okr/team 的 rows(后端已按 ADMIN 全部 / 其他人本团队过滤), 自己排第一, 去重 */
export function pickerPeople(rows = [], me = {}) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const u = r?.user || r
    if (!u?.id || seen.has(String(u.id))) continue
    seen.add(String(u.id))
    out.push({ id: String(u.id), name: u.name || u.username || String(u.id), avatarUrl: u.avatarUrl || '', role: u.role || '' })
  }
  if (me?.id && !seen.has(String(me.id))) out.unshift({ id: String(me.id), name: me.name || me.username || String(me.id), avatarUrl: me.avatarUrl || '', role: me.role || '' })
  const i = out.findIndex(p => sameId(p.id, me?.id))
  if (i > 0) out.unshift(...out.splice(i, 1))
  return out
}

/** 主管评分画不画: 本人, 或有 okr.score.manager(默认只有 ADMIN)。后端对其他人本来就不返回 */
export function canSeeManagerScore({ ownerId, meId, canScore }) {
  return !!canScore || sameId(ownerId, meId)
}

/** 字段在响应里吗(后端剔除主管评分是删键, 不是置 null) */
export const hasField = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key)

/**
 * 团队列表那一行要不要放「代操作」: 只是界面提示, 真正能不能改由 /cycle 的 can.proxy 决定。
 * ADMIN → 除自己外任何人; MANAGER → 列表里(后端已限本团队)除自己和 ADMIN 外的人; 其余不放
 */
export function mayProxyRow(me = {}, rowUser = {}) {
  if (!me?.id || !rowUser?.id || sameId(me.id, rowUser.id)) return false
  if (me.role === 'ADMIN') return true
  if (me.role === 'MANAGER') return rowUser.role !== 'ADMIN'
  return false
}

/** 导入文档前先在本地挡一下: 返回 i18n key, 没问题返回 '' */
export function draftFileProblem(file) {
  if (!file) return 'okr.import.need_file'
  if (!DRAFT_FILE_EXT.test(file.name || '')) return 'okr.import.bad_type'
  if (file.size > DRAFT_FILE_MAX) return 'okr.import.too_big'
  if (!file.size) return 'okr.import.empty'
  return ''
}

/**
 * 草稿填进编辑器: replace 直接用新的; append 接在已有 O 后面, 最多 max 个 O(0.6.5 来自系统设置, 不传回退 3), O 权重按 KR 条数重分。
 * 返回 { objectives, dropped }(dropped = 因为满了被丢掉的 O 数)
 */
export function mergeDraft(existing = [], incoming = [], mode = 'replace', { max = FALLBACK_LIMITS.maxObjectives } = {}) {
  if (mode !== 'append') return { objectives: incoming, dropped: 0 }
  const kept = existing.filter(o => String(o.title || '').trim() || o.keyResults?.some(k => String(k.title || '').trim()))
  const room = Math.max(0, max - kept.filter(o => o.status !== 'DROPPED').length)
  const take = incoming.slice(0, room)
  const all = [...kept.map(o => ({ ...o })), ...take.map(o => ({ ...o }))]
  const live = all.filter(o => o.status !== 'DROPPED')
  const ws = weightsByKrCount(live.map(o => o.keyResults?.length || 0))
  live.forEach((o, i) => { o.weight = ws[i] })
  return { objectives: all, dropped: incoming.length - take.length }
}

/**
 * 周度趋势折线(手写 SVG, 不引图表库): points = [{ label, value(0–100 或 null) }]
 * 返回 { segments: ['x,y x,y', ...], dots: [{ x, y, value, label }], ticks: [{ y, value }] }
 * 没分的周断开折线, 不补 0
 */
export function trendGeometry(points = [], { width = 600, height = 160, pad = 24, max = 100 } = {}) {
  const n = points.length
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const xOf = i => (n <= 1 ? pad + innerW / 2 : pad + (innerW * i) / (n - 1))
  const yOf = v => pad + innerH * (1 - Math.max(0, Math.min(max, v)) / max)
  const r1 = x => Math.round(x * 10) / 10
  const segments = []
  const dots = []
  let cur = []
  points.forEach((p, i) => {
    if (p.value == null || Number.isNaN(Number(p.value))) {
      if (cur.length) segments.push(cur.join(' '))
      cur = []
      return
    }
    const x = r1(xOf(i))
    const y = r1(yOf(Number(p.value)))
    cur.push(`${x},${y}`)
    dots.push({ x, y, value: p.value, label: p.label })
  })
  if (cur.length) segments.push(cur.join(' '))
  const ticks = [0, 50, 100].filter(v => v <= max).map(v => ({ value: v, y: r1(yOf(v)) }))
  return { segments, dots, ticks }
}

/** 年份下拉: 概览里出现过的年 + 今年, 倒序去重 */
export function yearOptions(overviewYears = [], thisYear) {
  return [...new Set([thisYear, ...overviewYears.map(y => y.year)].filter(Boolean))].sort((a, b) => b - a)
}

/** 每周「完成率」= 完成的 KR 条数 / 承诺的 KR 条数, 与文案「完成 2/5」同一口径(不是按权重加权的 completion) */
export function krDoneRate(w = {}) {
  const c = Number(w.committed)
  return c > 0 ? (Number(w.done) || 0) / c : null
}

/** 年度周列表里跳过的周号(后端只列有 OKR 的周), 用来提示「未提交的周不显示」 */
export function skippedWeeks(weeks = []) {
  const nos = weeks.map(w => w.weekNo).filter(n => Number.isInteger(n)).sort((a, b) => a - b)
  const out = []
  for (let i = 1; i < nos.length; i++) for (let n = nos[i - 1] + 1; n < nos[i]; n++) out.push(n)
  return out
}

/**
 * 主管评分入口(0.5.8 放开给部门主管): 有 okr.score.manager 且角色是 ADMIN / MANAGER。
 * 组长等其它角色即使在后台被勾了权限也不出入口(老板定「组长能看不能评」); 范围由后端卡
 */
export const MGR_SCORE_ROLES = ['ADMIN', 'MANAGER']
export function mayScoreManager(user, hasPerm) {
  return !!hasPerm && MGR_SCORE_ROLES.includes(user?.role)
}

/** 「保存并完成本周」(归档)只给 ADMIN: 归档锁的是全公司这一周 */
export function mayCloseWeek(user) {
  return user?.role === 'ADMIN'
}

/**
 * 评分面板列不列这个人: 自己(O 显示为锁定)照列; 别人看后端 /cycle 的 can.scoreOwner ——
 * MANAGER 范围外的人为 false, 不列; 老后端没有这个字段时按可评处理(后端仍会拒越界)
 */
export function inScorePanel(cyclePayload, userId, meId) {
  if (sameId(userId, meId)) return true
  return cyclePayload?.can?.scoreOwner !== false
}
