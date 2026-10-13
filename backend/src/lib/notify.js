// 站内通知 - 推送中心
// 支持多通道：site (站内) / chat (团队群机器人, 见 chatNotify.js) / mail (邮件)
// 用法：import { pushNotification } from '../../lib/notify.js'
//       await pushNotification({ userId, type, title, body, link, data, channels: ['site','chat','mail'] })
//
// 通道策略：
//   - channels 不传时，按 DEFAULT_CHANNELS_BY_TYPE[type] 自动选通道
//   - 用户可关闭某些通道（user.notificationPrefs JSON 字段）
//   - 任何通道失败不影响其他通道

import prisma from './prisma.js'
import { notifyChat } from './chatNotify.js'
import { sendMail } from './mail.js'
import { resolveDelivery, getCatalogEntry } from './notificationCatalog.js'

// v2.5.5(#912) 精简通知: 送达前先过「分档 + 用户按类型开关」两道闸, 见 notificationCatalog.js
//   - 分档默认: 必看即时 / 可选默认关 / 噪音进每日摘要(notification_digest_items, cron 合并成一条 DAILY_DIGEST)
//   - actorId: 触发人 == 收件人 时不发(自己给自己派任务/置 DONE 不用提醒自己), MANUAL 例外
const warnedUnknownTypes = new Set()

/**
 * 默认通道矩阵（按事件类型）
 * site  = 站内通知（必带）
 * chat = 团队群机器人（重要事件）
 * mail  = 邮件（重要事件 + 有邮箱时）
 */
export const DEFAULT_CHANNELS_BY_TYPE = {
  // 用户/账号
  USER_INVITED:        ['site', 'chat', 'mail'],
  PASSWORD_RESET:      ['site', 'mail'],
  ROLE_CHANGED:        ['site', 'mail'],
  ACCOUNT_DISABLED:    ['site', 'mail'],
  // 客户
  CUSTOMER_CREATED:    ['site', 'chat'],
  // v1.7.5 工程师招募: 官网新申请(通知 ADMIN) / 邀请对象入驻(通知邀请人)
  ENGINEER_APPLICATION:['site'],
  ENGINEER_JOINED:     ['site'],
  // 项目
  PROJECT_STATUS:      ['site', 'chat'],
  // 任务
  TASK_ASSIGNED:       ['site', 'chat', 'mail'],
  TASK_STATUS_CHANGED: ['site'],
  // 工时
  TIMESHEET_APPROVED:  ['site', 'chat', 'mail'],
  TIMESHEET_REJECTED:  ['site', 'mail'],
  TIMESHEET_PENDING:   ['site', 'chat'],
  // 评论
  COMMENT_MENTION:     ['site', 'mail'],
  COMMENT_REPLY:       ['site'],
  // 系统
  SYSTEM:              ['site']
}

/**
 * 群通知事件名映射
 */
const CHAT_EVENT_BY_TYPE = {
  USER_INVITED: 'user.invited',
  PASSWORD_RESET: null,  // 群里不推密码重置（安全考虑）
  ROLE_CHANGED: null,
  ACCOUNT_DISABLED: null,
  CUSTOMER_CREATED: 'customer.created',
  PROJECT_STATUS: 'project.status',
  TASK_ASSIGNED: 'task.assigned',
  TASK_STATUS_CHANGED: null,
  TIMESHEET_APPROVED: 'timesheet.approved',
  TIMESHEET_REJECTED: 'timesheet.approved',
  TIMESHEET_PENDING: 'timesheet.pending',
  COMMENT_MENTION: null,
  COMMENT_REPLY: null,
  SYSTEM: null
}

/**
 * 邮件模板类型映射
 */
const MAIL_TYPE_BY_TYPE = {
  USER_INVITED: 'USER_INVITED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ROLE_CHANGED: null,
  ACCOUNT_DISABLED: null,
  CUSTOMER_CREATED: null,
  PROJECT_STATUS: null,
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TIMESHEET_APPROVED: 'TIMESHEET_RESULT',
  TIMESHEET_REJECTED: 'TIMESHEET_RESULT',
  TIMESHEET_PENDING: null,
  COMMENT_MENTION: null,
  COMMENT_REPLY: null
}

/**
 * 解析用户的通知偏好
 * 格式: { [type]: { site: bool, chat: bool, mail: bool } } (旧数据的 feishu 键视同 chat)
 * 未设置 = 全部默认
 */
function parseUserPrefs(prefsJson) {
  if (!prefsJson) return null
  try {
    return typeof prefsJson === 'string' ? JSON.parse(prefsJson) : prefsJson
  } catch {
    return null
  }
}

/**
 * 决定实际启用的通道
 */
function resolveChannels(type, userPrefs, requestedChannels) {
  // 1. 基础默认
  const defaults = DEFAULT_CHANNELS_BY_TYPE[type] || ['site']
  // 2. 调用方指定优先
  let channels = requestedChannels?.length ? requestedChannels : defaults
  // 3. 应用用户偏好
  if (userPrefs?.[type]) {
    const p = userPrefs[type]
    channels = channels.filter(ch => (ch === 'chat' ? (p.chat ?? p.feishu) : p[ch]) !== false)
  }
  // 4. site 永远在（不可能完全不要站内通知）
  if (!channels.includes('site')) channels.unshift('site')
  return channels
}

/**
 * 推一条通知给一个用户
 * @param {object} options
 * @param {number|string|BigInt} options.userId
 * @param {string} options.type      事件类型（决定默认通道 + 模板）
 * @param {string} options.title
 * @param {string} options.body
 * @param {string|null} options.link
 * @param {object|null} options.data  模板变量
 * @param {string[]} options.channels 强制指定通道（可选）
 * @returns {Promise<{site: any, chat: any, mail: any}>}
 */
export async function pushNotification({ userId, type, title, body, link = null, data = null, channels = null, actorId = null }) {
  if (!userId || !type || !title) return null
  const result = { site: null, chat: null, mail: null, delivery: 'on' }

  // v2.5.5(#912) 自触发去重: 自己的操作不用通知自己(同事手动发的 MANUAL 除外)
  if (actorId != null && type !== 'MANUAL' && String(actorId) === String(userId)) {
    result.delivery = 'self-skipped'
    return result
  }
  if (!getCatalogEntry(type) && !warnedUnknownTypes.has(type)) {
    warnedUnknownTypes.add(type)
    console.warn(`[notify] 通知类型 ${type} 未登记在 notificationCatalog, 按必看即时送达; 请补登记(#912)`)
  }

  // 诊断：如果 prisma.notification 不可用，降级到 console.log
  if (!prisma.notification || typeof prisma.notification.create !== 'function') {
    console.error('[notify] prisma.notification 不可用，降级为 console 输出')
    console.log(`  [site-MOCK] user=${userId} type=${type} title=${title}`)
    return result
  }

  try {
    // 1) 查用户（含 email 和 prefs）
    const user = await prisma.user.findUnique({
      where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
      select: { id: true, name: true, email: true, notificationPrefs: true, role: true }
    })
    if (!user) return result

    // 2) v2.5.5(#912) 分档 + 用户按类型开关: off 不送; digest 只入摘要队列
    const userPrefs = parseUserPrefs(user.notificationPrefs)
    const delivery = resolveDelivery(type, userPrefs)
    result.delivery = delivery
    if (delivery === 'off') return result
    if (delivery === 'digest') {
      try {
        result.digest = await prisma.notificationDigestItem.create({
          data: { userId: user.id, type, title, body: body || null, link }
        })
      } catch (e) {
        console.error('[notify.digest] 入队失败:', e.message)
      }
      return result
    }

    // 3) 决定通道
    const activeChannels = resolveChannels(type, userPrefs, channels)

    // 3) 站点通知（必发）
    if (activeChannels.includes('site')) {
      try {
        result.site = await prisma.notification.create({
          data: {
            userId: user.id,
            type,
            title,
            body: body || null,
            link,
            data: data ? JSON.stringify(data) : null
          }
        })
      } catch (e) {
        console.error('[notify.site] 失败:', e.message)
      }
    }

    // 4) 团队群
    if (activeChannels.includes('chat')) {
      try {
        const chatEvent = CHAT_EVENT_BY_TYPE[type]
        if (chatEvent) {
          result.chat = await notifyChat({
            event: chatEvent,
            data: buildChatData(type, data, user)
          })
        }
      } catch (e) {
        console.error('[notify.chat] 失败:', e.message)
      }
    }

    // 5) 邮件（必须有 email）
    if (activeChannels.includes('mail') && user.email) {
      try {
        const mailType = MAIL_TYPE_BY_TYPE[type]
        if (mailType) {
          result.mail = await sendMail({
            to: user.email,
            type: mailType,
            data: { ...(data || {}), name: user.name }
          })
        }
      } catch (e) {
        console.error('[notify.mail] 失败:', e.message)
      }
    }

    return result
  } catch (e) {
    console.error('[notify] 推送失败:', e.message)
    return result
  }
}

/**
 * 构造群通知数据
 */
function buildChatData(type, data, user) {
  const d = data || {}
  const base = { name: user.name }
  switch (type) {
    case 'USER_INVITED':
      return { name: d.name || user.name, username: d.username, role: d.role }
    case 'CUSTOMER_CREATED':
      return { name: d.name, industry: d.industry, scale: d.scale }
    case 'PROJECT_STATUS':
      return { name: d.name || d.projectName, oldStatus: d.oldStatus, newStatus: d.newStatus }
    case 'TASK_ASSIGNED':
      return { title: d.title, project: d.project, dueDate: d.dueDate }
    case 'TIMESHEET_APPROVED':
    case 'TIMESHEET_REJECTED':
      return {
        date: d.date,
        hours: d.hours,
        engineer: d.engineer,
        project: d.project,
        result: d.result || (type === 'TIMESHEET_APPROVED' ? '✅ 已批准' : '❌ 已驳回')
      }
    case 'TIMESHEET_PENDING':
      return { engineer: d.engineer, project: d.project, date: d.date, hours: d.hours }
    default:
      return { ...base, ...d }
  }
}

/**
 * 推送给多个用户
 */
export async function pushNotificationBatch(userIds, payload) {
  if (!userIds?.length) return []
  return Promise.all(userIds.map(uid => pushNotification({ userId: uid, ...payload })))
}

/**
 * 推送给某角色全部用户
 */
export async function pushNotificationToRole(role, payload) {
  const users = await prisma.user.findMany({
    where: { role, deletedAt: null },
    select: { id: true }
  })
  return pushNotificationBatch(users.map(u => u.id), payload)
}

// ===== 内部纯函数（供单元测试，不依赖 prisma）=====

/**
 * 导出供测试用：解析用户 prefs JSON
 */
export function _parseUserPrefs(prefsJson) {
  if (!prefsJson) return null
  try {
    return typeof prefsJson === 'string' ? JSON.parse(prefsJson) : prefsJson
  } catch {
    return null
  }
}

/** 导出供测试用 */
export { resolveChannels as _resolveChannels }
