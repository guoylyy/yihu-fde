import { isZh } from '../i18n/index.js'
import { $t } from '../i18n/index.js'
// 前端通用格式化工具（纯函数）
// 从 api/index.js 和 AdminDashboard.vue 抽出，便于单测

/**
 * 格式化金额（带 ¥ 符号、千分位）
 * @param {number|string} v
 * @returns {string}
 */
export function formatMoney(v) {
  if (v === null || v === undefined) return '—'
  return '¥' + Number(v).toLocaleString('zh-CN')
}

/**
 * 短格式金额：中文 ≥1 万显示 X.X万；其他语言 ≥1000 显示 X.XK / X.XM
 * @param {number} v
 * @returns {string}
 */
export function formatMoneyShort(v) {
  if (!v) return '¥0'
  if (isZh) {
    if (v >= 10000) return '¥' + (v / 10000).toFixed(1) + $t('formatters.0k')
    return '¥' + Number(v).toLocaleString('zh-CN')
  }
  if (v >= 1e6) return '¥' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1000) return '¥' + (v / 1000).toFixed(1) + 'K'
  return '¥' + Number(v).toLocaleString('en-US')
}

/**
 * 格式化日期（YYYY-MM-DD）
 * @param {Date|string|number} d
 * @returns {string}
 */
export function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toISOString().slice(0, 10)
}

/**
 * 格式化日期为 MM-DD（短）
 */
export function formatDay(d) {
  return d.slice(5)
}

/**
 * 相对时间（如"5 分钟前"）
 * @param {string|Date} iso
 * @returns {string}
 */
export function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return $t('common.just_now')
  if (m < 60) return $t('common.min_ago', { p0: m })
  const h = Math.floor(m / 60)
  if (h < 24) return $t('common.hours_ago', { p0: h })
  const d = Math.floor(h / 24)
  if (d < 30) return $t('common.days_ago', { p0: d })
  return iso.slice(0, 10)
}

/**
 * 状态颜色映射（项目状态）
 */
export const STATUS_COLORS = {
  DRAFT: '#909399',
  PROPOSAL: '#b3450f',
  APPROVED: '#1c1917',
  IN_PROGRESS: '#2e7d4f',
  ACCEPTED: '#2e7d4f',
  CLOSED: '#909399',
  CANCELLED: '#c2362b'
}

export const STATUS_LABELS = {
  DRAFT: $t('common.draft'),
  PROPOSAL: $t('common.proposal'),
  APPROVED: $t('common.approved'),
  IN_PROGRESS: $t('common.in_progress'),
  ACCEPTED: $t('common.accepted'),
  CLOSED: $t('common.closed'),
  CANCELLED: $t('common.cancelled')
}

export function statusColor(s) {
  return STATUS_COLORS[s] || '#909399'
}

export function statusLabel(s) {
  return STATUS_LABELS[s] || s
}

/**
 * 严重度
 */
export const SEVERITY_TYPES = { LOW: 'info', MEDIUM: 'warning', HIGH: 'danger' }
export const SEVERITY_LABELS = { LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high') }

export function severityType(s) { return SEVERITY_TYPES[s] || 'info' }
export function severityLabel(s) { return SEVERITY_LABELS[s] || s }
