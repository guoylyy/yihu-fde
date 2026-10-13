// 全局群通知 —— 把重要事件推到团队群(飞书 / 钉钉 / 企业微信 / Slack / 通用 Webhook)
//
// 配置(管理员在环境变量里配, 不经界面):
//   CHAT_WEBHOOK_URL       群机器人地址; 不配 = 关闭
//   CHAT_WEBHOOK_CHANNEL   FEISHU | DINGTALK | WECOM | SLACK | WEBHOOK, 不填按域名猜
//   CHAT_WEBHOOK_SECRET    加签密钥(飞书/钉钉), 可选
// 兼容旧配置: FEISHU_NOTIFY_ENABLED=true + FEISHU_WEBHOOK_URL (+ FEISHU_SECRET)
// MOCK_MODE=true 时只打日志不发请求。
import { sendBotMessage, guessChannel } from './webhookBot.js'

export function resolveChatBot(env = process.env) {
  if (env.CHAT_WEBHOOK_URL) {
    const url = env.CHAT_WEBHOOK_URL
    return { channel: (env.CHAT_WEBHOOK_CHANNEL || guessChannel(url)).toUpperCase(), url, secret: env.CHAT_WEBHOOK_SECRET || null }
  }
  if (env.FEISHU_NOTIFY_ENABLED === 'true' && env.FEISHU_WEBHOOK_URL) {
    return { channel: 'FEISHU', url: env.FEISHU_WEBHOOK_URL, secret: env.FEISHU_SECRET || null }
  }
  return null
}

/** 事件 → { title, fields: [[label, value]], body? }; 未登记的事件用事件名当标题 */
function template(event, data) {
  const T = {
    'ops.incident_open': {
      title: '🔴 运维告警：服务疑似不可用',
      fields: [['项目', data.project], ['端点', data.endpoint], ['详情', data.detail]]
    },
    'ops.incident_resolved': {
      title: '🟢 运维告警解除：服务已恢复',
      fields: [['项目', data.project], ['端点', data.endpoint], ['故障时长', data.duration]]
    },
    'project.created': {
      title: '📋 新项目立项',
      fields: [['项目', data.name], ['客户', data.customer], ['负责人', data.manager], ['预算', data.budget]]
    },
    'project.status_changed': {
      title: '🔄 项目状态变更',
      fields: [['项目', data.name], ['变更', `${data.oldStatus} → ${data.newStatus}`]]
    },
    'project.status': {
      title: '🔄 项目状态变更',
      fields: [['项目', data.name], ['变更', `${data.oldStatus} → ${data.newStatus}`]]
    },
    'project.accepted': {
      title: '🎉 客户验收项目',
      fields: [['项目', data.name], ['客户', data.customer]]
    },
    'task.assigned': {
      title: '📝 新工单',
      fields: [['标题', data.title], ['项目', data.project], ['截止', data.dueDate]]
    },
    'timesheet.approved': {
      title: '✅ 工时审批通过',
      fields: [['日期', data.date], ['工时', data.hours]]
    },
    'timesheet.pending': {
      title: '⏰ 工时待审批',
      fields: [['工程师', data.engineer], ['项目', data.project], ['日期', data.date], ['工时', data.hours]]
    },
    'issue.created': {
      title: '🐛 客户提交问题',
      fields: [['项目', data.project], ['严重度', data.severity], ['标题', data.title]],
      body: data.description ? `**问题描述**：${data.description.slice(0, 300)}${data.description.length > 300 ? '...' : ''}` : null
    },
    // 群消息不带密码等凭证, 只告知有人加入
    'user.invited': {
      title: '🎉 新成员加入',
      fields: [['姓名', data.name], ['账号', data.username], ['角色', data.role]]
    },
    'customer.created': {
      title: '🏢 新客户创建',
      fields: [['客户名', data.name], ['行业', data.industry || '未设'], ['规模', data.scale || '未设']]
    },
    'engineer.profile_updated': {
      title: '👷 工程师档案更新',
      fields: [['姓名', data.name], ['变更', data.changes], ['可派工', data.available]]
    }
  }
  return T[event] || { title: event, fields: [] }
}

/** 组装成 webhookBot 的统一消息 { title, lines, level, link } */
export function buildChatMessage(event, data = {}) {
  const t = template(event, data)
  const lines = (t.fields || []).map(([k, v]) => `**${k}**：${v ?? '-'}`)
  if (t.body) lines.push(t.body)
  const level = event === 'ops.incident_open' ? 'danger' : event === 'ops.incident_resolved' ? 'success' : 'info'
  return { title: t.title, lines, level, link: data.link || null }
}

let disabledLogged = false

/**
 * 推一条群通知。从不抛错: 未配置返回 { success: false, disabled: true }
 * @param {{ event: string, data: object }} options
 */
export async function notifyChat({ event, data }) {
  const bot = resolveChatBot()
  if (!bot) {
    if (!disabledLogged) { console.log('[chat] 群通知未配置 (CHAT_WEBHOOK_URL 为空), 跳过'); disabledLogged = true }
    return { success: false, disabled: true }
  }
  const msg = buildChatMessage(event, data)
  if (process.env.MOCK_MODE === 'true') {
    console.log(`💬 [chat MOCK ${bot.channel}] ${msg.title}\n  ${msg.lines.join('\n  ')}`)
    return { success: true, mock: true }
  }
  const r = await sendBotMessage(bot, msg)
  if (!r.ok) console.error(`[chat] ${bot.channel} 发送失败:`, r.error)
  return { success: r.ok, error: r.error }
}
