import { $t } from '../i18n/index.js'
// v2.13.0(#1283) 机器人状态字典 —— 「我的开发助手」与管理端清理视图共用
// 后端权威定义在 services/agentProfiles.js, 这里是前端展示层副本(保持同口径)

export const BOT_STATUS = {
  ACTIVE: 1,
  DISABLED: 0,
  DEREGISTERED: -1
}

export const BOT_STATUS_LABELS = {
  1: $t('common.active'),
  0: $t('common.disabled'),
  [-1]: $t('common.deregistered')
}

export function botStatusTag(s) {
  return s === 1 ? 'success' : s === 0 ? 'info' : 'danger'
}

export const PLATFORM_LABELS = {
  CLAUDE_CODE: 'Claude Code',
  OPENHEX: 'OpenHex',
  COZE: 'Coze',
  CUSTOM: $t('common.custom'),
  OTHER: $t('common.other')
}

export const PURPOSE_LABELS = {
  PATROL: $t('common.patrol'),
  DISPATCH: $t('common.dispatch'),
  BOTH: $t('common.both')
}

export function purposeLabel(p) { return p ? (PURPOSE_LABELS[p] || p) : $t('common.not_registered') }

/**
 * 在线四态(与后端 stale 口径一致): 巡检中/开发中/失联 N 分钟/离线
 * 红线: stale(>30min 无心跳)绝不显示为「开发中」
 */
export function onlineState(presence) {
  if (!presence || presence.status === 'OFFLINE') return { text: $t('common.offline'), tag: 'info' }
  if (presence.stale) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(presence.heartbeatAt).getTime()) / 60000))
    return { text: $t('common.lost_contact_for_min', { p0: mins }), tag: 'danger' }
  }
  return presence.taskId
    ? { text: $t('common.developing'), tag: 'success' }
    : { text: $t('common.patrolling'), tag: 'warning' }
}
