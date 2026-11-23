// 0.6.2 二级确认 / 变更申请 / 修改记录 —— 纯函数, 有单测。
// 后端契约(不改): /api/okr/cycle 带 confirm{ lockStatus, ownerConfirmedAt/By, managerConfirmedAt/By, pendingChange }
// 与 can.confirmOwner / confirmManager / requestChange / viewAudit; 锁定(CONFIRMED)后 can.edit=false, 写计划回 8201。
// /plan/changes 列表里 PENDING 的带 diffs / diffCount; /plan/audit 按时间倒序。
import { sameId } from './okrPeople.js'

export const LOCKED_CODE = 8201
export const REASON_MIN = 4

const pad = n => String(n).padStart(2, '0')
function sh(iso) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return new Date(t + 8 * 3600 * 1000)
}
/** 上海时间「11-24 10:12」 */
export function shortTime(iso) {
  const d = sh(iso)
  return d ? `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : ''
}
/** 上海时间「10:12」 */
export function clock(iso) {
  const d = sh(iso)
  return d ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : ''
}

export const lockStatusOf = d => d?.confirm?.lockStatus || 'DRAFT'
export const isLocked = d => lockStatusOf(d) === 'CONFIRMED'
export const pendingChangeOf = d => d?.confirm?.pendingChange || null

/** 原因至少 4 个字(去首尾空白, 按字符数) */
export const reasonOk = s => [...String(s ?? '').trim()].length >= REASON_MIN

/**
 * 我的 OKR 页顶部确认区(周切换下面一行)。没周期 / 没提交过且还是 DRAFT → null(不出)。
 *   pending   蓝  变更申请已提交，等主管批准(申请人自己能撤回)
 *   confirmed 绿  已确认并锁定(你 10:12 · 主管 张三 15:20)
 *   awaiting  黄  你已确认(11-24 10:12)，等主管确认(主管看时出「确认」)
 *   draft     灰  计划已提交，等你自己确认 ——「我确认这份 OKR」
 * 0.6.5 管理员自确认: 这份是我自己的(ownerId = meId)、我是 ADMIN、后端 can.confirmManager → awaiting 带 self=true
 *   (按钮「确认并锁定」); 非 ADMIN 看自己那份一律不给按钮(后端也不放)。
 *   已锁定且主管确认人就是本人 → confirmed 带 selfConfirm=true(绿条「管理员自确认 · 时间」)
 * 0.6.6 管理员自审批: 我是 ADMIN 且待批申请是我提的 → pending 带 canApprove=true(蓝条「你是管理员，可以自己批准这条变更」+「批准」)
 */
export function confirmBar(d, { meId, submitted, ownerId, isAdmin = false } = {}) {
  const c = d?.confirm
  if (!d?.cycle || !c) return null
  const status = c.lockStatus || 'DRAFT'
  const pend = c.pendingChange
  if (status === 'CONFIRMED' && pend) {
    const mine = sameId(pend.requestedBy?.id, meId)
    return {
      kind: 'pending', tone: 'blue', changeId: pend.id,
      by: pend.requestedBy?.name || '', at: shortTime(pend.createdAt),
      cancellable: mine,
      // 0.6.6: 管理员自己提的 → 提示条上直接「批准」(后端放开 ADMIN 自审批)
      canApprove: !!isAdmin && mine
    }
  }
  const owner = ownerId ?? d.owner?.id ?? meId
  if (status === 'CONFIRMED') {
    return {
      kind: 'confirmed', tone: 'green',
      ownerAt: clock(c.ownerConfirmedAt), managerAt: clock(c.managerConfirmedAt),
      manager: c.managerConfirmedBy?.name || '',
      selfConfirm: owner != null && sameId(c.managerConfirmedBy?.id, owner)
    }
  }
  if (status === 'AWAITING_MANAGER') {
    const self = owner != null && sameId(owner, meId)
    const canManager = !!d.can?.confirmManager && (!self || !!isAdmin)
    return { kind: 'awaiting', tone: 'yellow', at: shortTime(c.ownerConfirmedAt), canManager, self: self && canManager }
  }
  if (!submitted) return null
  return { kind: 'draft', tone: 'gray', canConfirm: !!d.can?.confirmOwner }
}

/**
 * 团队页「确认」列。status = confirm-status 的返回(还没拉到为 undefined)。
 *   none          未提交(且没确认过) → `-`
 *   await_owner   已提交待员工确认 → 灰字
 *   confirm       待主管确认、我能确认 → 主色按钮(0.6.5: ADMIN 自己那行也是, self=true →「确认（自）」)
 *   await_manager 待主管确认、不归我确认(非 ADMIN 的自己 / 员工确认是我代点的 / 不是主管) → 灰字
 *   done          已确认 → 绿字, 悬浮两个时间
 * ADMIN 可以确认任何人(含自己), 也不受「员工确认是我代点的」限制(与后端 can.confirmManager 同口径)
 */
export function teamConfirmCell(row, status, { meId, canScore, isAdmin = false } = {}) {
  const s = status?.lockStatus
  if (s === 'CONFIRMED') {
    return {
      kind: 'done',
      ownerAt: shortTime(status.ownerConfirmedAt),
      manager: status.managerConfirmedBy?.name || '',
      managerAt: shortTime(status.managerConfirmedAt)
    }
  }
  if (s === 'AWAITING_MANAGER') {
    const selfRow = sameId(row?.user?.id, meId)
    const mine = canScore && (isAdmin || (!selfRow && !sameId(status.ownerConfirmedBy?.id, meId)))
    const cell = { kind: mine ? 'confirm' : 'await_manager', ownerAt: shortTime(status.ownerConfirmedAt) }
    if (mine && selfRow) cell.self = true
    return cell
  }
  if (!row || row.submission === 'NONE' || !status) return { kind: 'none' }
  return { kind: 'await_owner' }
}

/**
 * 这条变更申请我能不能批: 不是我自己的、也不是我提的(后端还会按团队范围再卡一次)。
 * 0.6.6: ADMIN 例外 —— 自己计划上的、自己提的也能批(与后端同口径)
 */
export const decidable = (c, meId, { isAdmin = false } = {}) =>
  c?.status === 'PENDING' && (!!isAdmin || (!sameId(c.owner?.id, meId) && !sameId(c.requestedBy?.id, meId)))

/** 「O2.KR1 客户现场复测」→ { code: 'O2.KR1', title: '客户现场复测' }; 不是 O/KR 引用 → code 为空 */
export function splitRef(ref) {
  const m = /^(O\d+(?:\.KR\d+)?)\s*(.*)$/.exec(String(ref ?? ''))
  return m ? { code: m[1], title: m[2] } : { code: '', title: String(ref ?? '') }
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** 「目标值 3」+「目标值 5」→「目标值 3 → 5」; 前缀不同就两段原样 */
export function compactChange(before, after, n = 40) {
  const b = String(before ?? '—')
  const a = String(after ?? '—')
  const mb = /^(\S+) (.+)$/.exec(b)
  const ma = /^(\S+) (.+)$/.exec(a)
  if (mb && ma && mb[1] === ma[1]) return `${mb[1]} ${clip(mb[2], n)} → ${clip(ma[2], n)}`
  return `${clip(b, n)} → ${clip(a, n)}`
}

const CONFIRM_ACTIONS = ['OWNER_CONFIRM', 'MANAGER_CONFIRM']
const ADD_DEL = ['OBJECTIVE_ADD', 'KR_ADD', 'OBJECTIVE_DEL', 'KR_DEL']

/** i18n 取动作文案, 没有这个 key 就用后端的 actionLabel */
function actionText(item, t) {
  const k = 'okr.confirm.act.' + item.action
  const s = t ? t(k) : k
  return s && s !== k ? s : (item.actionLabel || item.action)
}

/**
 * 修改记录一行: 11-24 09:41  我  改 KR 目标值  O2.KR1  目标值 3 → 5
 * who: 我 / 名字(本人) / 名字（主管）—— 操作人不是这份计划的主人就标主管(代管 / 审批 / 主管确认)
 * 只用计划层字段(后端本来就只记计划层), 不出主管评分等
 */
export function auditRow(item, { meId, ownerId } = {}, t = k => k) {
  const { code, title } = splitRef(item.targetRef)
  const isMe = sameId(item.actorId, meId)
  const manager = !sameId(item.actorId, ownerId)
  let summary = ''
  if (ADD_DEL.includes(item.action)) summary = title ? `「${clip(title, 40)}」` : ''
  else if (CONFIRM_ACTIONS.includes(item.action)) summary = ''
  else if (item.targetType === 'PLAN') summary = item.after ? clip(String(item.after), 60) : ''
  else if (item.before != null || item.after != null) summary = compactChange(item.before, item.after)
  return {
    id: String(item.id),
    when: shortTime(item.createdAt),
    who: isMe ? t('okr.confirm.me') : (item.actorName || `#${item.actorId}`),
    manager: manager && !isMe,
    label: actionText(item, t),
    code: code || (item.targetType === 'PLAN' ? String(item.targetRef || '') : ''),
    summary,
    before: item.before ?? null,
    after: item.after ?? null,
    reason: item.reason ?? null,
    fromChange: item.source === 'CHANGE_APPLY',
    expandable: item.before != null || item.after != null || !!item.reason
  }
}

/** 变更待批列表一行: 申请人、原因、改了几条、差异(before → after) */
export function changeRow(c, t = k => k) {
  const diffs = (c.diffs || []).map((d, i) => {
    const { code, title } = splitRef(d.targetRef)
    return { key: i, label: actionText(d, t), code, title, before: d.before ?? null, after: d.after ?? null }
  })
  return {
    id: String(c.id),
    owner: c.owner || null,
    ownerName: c.owner?.name || '',
    requester: c.requestedBy && !sameId(c.requestedBy.id, c.owner?.id) ? (c.requestedBy.name || '') : '',
    reason: c.reason || '',
    count: c.diffCount ?? diffs.length,
    diffs,
    error: c.previewError || '',
    at: shortTime(c.createdAt)
  }
}

/** 团队页两个计数: 待你确认(行) / 变更待批(我能批的 PENDING) */
export function teamCounts(rows, statusMap, changes, ctx) {
  const toConfirm = (rows || []).filter(r => teamConfirmCell(r, statusMap?.[String(r.user?.id)], ctx).kind === 'confirm')
  const pending = (changes || []).filter(c => decidable(c, ctx?.meId, { isAdmin: !!ctx?.isAdmin }))
  return { toConfirm, pending }
}
