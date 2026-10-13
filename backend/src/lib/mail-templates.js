import { getBrand } from '../config/brand.js'
// 邮件模板（5 个关键事件）
// 风格：统一 layout
// 颜色：主橙 #f54e00，文字 #303133，灰底 #f5f5f5

// 名字/主色跟随实例品牌(config/brand.js), 每次取值都读当前的(系统设置里改了立即生效)
const BRAND = {
  get name() { return getBrand().name },
  get url() { return process.env.MAIL_BRAND_URL || getBrand().siteUrl },
  get logo() { return process.env.MAIL_BRAND_LOGO || getBrand().logoUrl || '' },
  get primary() { return getBrand().primaryColor },
  text: '#303133',
  muted: '#909399',
  bg: '#f5f5f5',
  card: '#ffffff',
  border: '#e4e7ed'
}

/**
 * 通用 layout
 */
function layout({ title, body }) {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;">
        <tr><td style="background:${BRAND.primary};padding:20px 24px;color:white;font-size:18px;font-weight:600;">
          🎯 ${BRAND.name}
        </td></tr>
        <tr><td style="padding:28px 24px;">
          <h2 style="margin:0 0 16px;color:${BRAND.text};font-size:18px;">${title}</h2>
          ${body}
        </td></tr>
        <tr><td style="background:${BRAND.bg};padding:14px 24px;color:${BRAND.muted};font-size:12px;text-align:center;">
          本邮件由系统自动发出，请勿直接回复 · <a href="${BRAND.url}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.url}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()
}

const PLAIN_TEXT = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/**
 * 5 个模板
 */
const TEMPLATES = {
  // 1) 用户邀请
  // 5.5) 销售线索营销邮件 (Phase 3)
  LEAD_MARKETING: ({ name, company, product, contactName, ctaUrl, highlights }) => {
    const subject = `🎯 ${company || '您'} 专属 ${product || '解决方案'} 介绍`
    const body = `
      <p style="margin:0 0 12px;color:${BRAND.text};font-size:14px;line-height:1.6;">你好${contactName ? '，<strong>' + contactName + '</strong>' : ''}：</p>
      <p style="margin:0 0 16px;color:${BRAND.text};font-size:14px;line-height:1.6;">
        感谢您关注 ${BRAND.name}。针对 ${company || '贵公司'} 的业务场景, 我们整理了 ${product || '相关方案'} 的核心价值点：
      </p>
      <ul style="margin:0 0 16px;padding-left:20px;color:${BRAND.text};font-size:14px;line-height:1.8;">
        ${(highlights || ['专业 FDE 团队驻场', '7x24 售后响应', '可量化交付指标']).map(h => '<li>' + h + '</li>').join('')}
      </ul>
      <p style="text-align:center;margin:24px 0;">
        <a href="${ctaUrl || BRAND.url}" style="display:inline-block;background:${BRAND.primary};color:white;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:600;">预约 30 分钟方案沟通</a>
      </p>
      <p style="margin:16px 0 0;color:${BRAND.muted};font-size:13px;">📅 您也可以直接回复邮件告诉我们方便的时间, 我们会主动与您联系.</p>
    `
    return { subject, html: layout({ title: '专属方案介绍', body }), text: subject + '\n\n' + (highlights || []).join('\n') + '\n\n' + (ctaUrl || BRAND.url) }
  },

  USER_INVITED: ({ name, role, username, defaultPassword, loginUrl }) => {
    const subject = `🎉 欢迎加入${BRAND.name}`
    const body = `
      <p style="margin:0 0 12px;color:${BRAND.text};font-size:14px;line-height:1.6;">你好，<strong>${name || username}</strong>：</p>
      <p style="margin:0 0 16px;color:${BRAND.text};font-size:14px;line-height:1.6;">
        你已被添加为 <strong style="color:${BRAND.primary};">${role}</strong>，现在可以登录 ${BRAND.name} FDE 平台。
      </p>
      <table cellpadding="8" cellspacing="0" style="background:${BRAND.bg};border-radius:4px;width:100%;margin-bottom:16px;">
        <tr><td style="color:${BRAND.muted};width:80px;">账号</td><td style="color:${BRAND.text};font-weight:600;">${username}</td></tr>
        <tr><td style="color:${BRAND.muted};">默认密码</td><td style="color:${BRAND.primary};font-weight:600;">${defaultPassword || '123456'}</td></tr>
      </table>
      <p style="text-align:center;margin:24px 0;">
        <a href="${loginUrl || (BRAND.url + '/admin')}" style="display:inline-block;background:${BRAND.primary};color:white;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:600;">立即登录</a>
      </p>
      <p style="margin:16px 0 0;color:${BRAND.muted};font-size:13px;">⚠️ 首次登录后请尽快修改密码。</p>
    `
    return { subject, html: layout({ title: '欢迎加入', body }), text: `${subject}\n\n账号: ${username}\n默认密码: ${defaultPassword || '123456'}\n登录: ${loginUrl || BRAND.url}` }
  },

  // 1.5) v1.7.5 FDE 工程师邀请函(免登录链接, 候选人自设密码入驻)
  ENGINEER_INVITE: ({ name, inviteUrl, expiresText, note }) => {
    const subject = `🤝 诚邀你加入${BRAND.name} FDE 工程师网络`
    const body = `
      <p style="margin:0 0 12px;color:${BRAND.text};font-size:14px;line-height:1.6;">${name ? `<strong>${name}</strong>，你好：` : '你好：'}</p>
      <p style="margin:0 0 16px;color:${BRAND.text};font-size:14px;line-height:1.6;">
        我们诚挚邀请你成为 ${BRAND.name} 的 <strong style="color:${BRAND.primary};">FDE（现场交付）工程师</strong>。
        完善资料后即刻入驻，参与项目派工与结算，与我们一起服务企业客户。
      </p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${inviteUrl}" style="display:inline-block;background:${BRAND.primary};color:white;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:600;">完善资料，立即入驻</a>
      </p>
      <p style="margin:0 0 8px;color:${BRAND.muted};font-size:13px;">链接 ${expiresText || '长期有效'}。按钮无法点击时，请复制以下地址到浏览器打开：</p>
      <p style="margin:0 0 16px;color:${BRAND.text};font-size:13px;word-break:break-all;">${inviteUrl}</p>
      <p style="margin:16px 0 0;color:${BRAND.muted};font-size:13px;">如果这不是你期待的邮件，忽略即可。</p>
    `
    return {
      subject,
      html: layout({ title: '邀请你成为 FDE 工程师', body }),
      text: `${subject}\n\n${name ? name + '，你好！' : '你好！'}完善资料后即刻入驻（${expiresText || '长期有效'}）：\n${inviteUrl}`
    }
  },

  // 2) 密码重置
  PASSWORD_RESET: ({ name, loginUrl }) => {
    const subject = `🔑 你的密码已被重置 - ${BRAND.name}`
    const body = `
      <p style="margin:0 0 12px;color:${BRAND.text};font-size:14px;line-height:1.6;">你好，<strong>${name || ''}</strong>：</p>
      <p style="margin:0 0 16px;color:${BRAND.text};font-size:14px;line-height:1.6;">
        你的密码已被管理员重置为默认密码 <strong style="color:${BRAND.primary};">123456</strong>。
      </p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${loginUrl || (BRAND.url + '/admin')}" style="display:inline-block;background:${BRAND.primary};color:white;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:600;">立即登录并修改</a>
      </p>
      <p style="margin:16px 0 0;color:${BRAND.muted};font-size:13px;">⚠️ 如果不是你本人操作，请立即联系管理员。</p>
    `
    return { subject, html: layout({ title: '密码已被重置', body }), text: `${subject}\n\n默认密码: 123456\n登录: ${loginUrl || BRAND.url}` }
  },

  // 4) 工时审批结果
  TIMESHEET_RESULT: ({ engineerName, date, hours, result, reason, viewUrl }) => {
    const isApproved = result === 'APPROVED'
    const subject = `${isApproved ? '✅' : '❌'} ${date} 工时${isApproved ? '已批准' : '被驳回'} - ${BRAND.name}`
    const color = isApproved ? '#67c23a' : '#f56c6c'
    const body = `
      <p style="margin:0 0 12px;color:${BRAND.text};font-size:14px;line-height:1.6;">你好，<strong>${engineerName || '工程师'}</strong>：</p>
      <p style="margin:0 0 16px;color:${BRAND.text};font-size:14px;line-height:1.6;">
        你提交的工时已被 <strong style="color:${color};">${isApproved ? '批准' : '驳回'}</strong>：
      </p>
      <table cellpadding="10" cellspacing="0" style="background:${BRAND.bg};border-radius:4px;width:100%;margin-bottom:16px;">
        <tr><td style="color:${BRAND.muted};width:100px;">日期</td><td>${date}</td></tr>
        <tr><td style="color:${BRAND.muted};">工时</td><td style="font-weight:600;">${hours}h</td></tr>
        <tr><td style="color:${BRAND.muted};">结果</td><td style="color:${color};font-weight:600;">${isApproved ? '✅ 已批准' : '❌ 已驳回'}</td></tr>
        ${reason ? `<tr><td style="color:${BRAND.muted};">备注</td><td>${reason}</td></tr>` : ''}
      </table>
      ${!isApproved ? `<p style="margin:0 0 16px;color:${BRAND.muted};font-size:13px;">如对结果有疑问，请联系项目经理。</p>` : ''}
      <p style="text-align:center;margin:24px 0;">
        <a href="${viewUrl || (BRAND.url + '/admin/timesheets')}" style="display:inline-block;background:${BRAND.primary};color:white;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:600;">查看详情</a>
      </p>
    `
    return { subject, html: layout({ title: '工时审批结果', body }), text: `${subject}\n\n工时: ${hours}h\n结果: ${isApproved ? '已批准' : '被驳回'}\n${reason ? '备注: ' + reason : ''}` }
  },

  // 5) 任务分配
  TASK_ASSIGNED: ({ assigneeName, title, project, priority, dueDate, taskUrl }) => {
    const priorityMap = { HIGH: '🔴 高', MEDIUM: '🟡 中', LOW: '🟢 低' }
    const subject = `📋 新任务分配: ${title} - ${BRAND.name}`
    const body = `
      <p style="margin:0 0 12px;color:${BRAND.text};font-size:14px;line-height:1.6;">你好，<strong>${assigneeName || '工程师'}</strong>：</p>
      <p style="margin:0 0 16px;color:${BRAND.text};font-size:14px;line-height:1.6;">你被分配了一个新任务：</p>
      <table cellpadding="10" cellspacing="0" style="background:${BRAND.bg};border-radius:4px;width:100%;margin-bottom:16px;">
        <tr><td colspan="2" style="font-size:16px;font-weight:600;color:${BRAND.text};">${title}</td></tr>
        <tr><td style="color:${BRAND.muted};width:100px;">所属项目</td><td>${project}</td></tr>
        <tr><td style="color:${BRAND.muted};">优先级</td><td>${priorityMap[priority] || priority}</td></tr>
        <tr><td style="color:${BRAND.muted};">截止日期</td><td>${dueDate || '未设'}</td></tr>
      </table>
      <p style="text-align:center;margin:24px 0;">
        <a href="${taskUrl || (BRAND.url + '/admin/tasks')}" style="display:inline-block;background:${BRAND.primary};color:white;padding:12px 32px;border-radius:4px;text-decoration:none;font-weight:600;">查看任务</a>
      </p>
    `
    return { subject, html: layout({ title: '新任务分配', body }), text: `${subject}\n\n项目: ${project}\n优先级: ${priorityMap[priority] || priority}\n截止: ${dueDate || '未设'}` }
  }
}

/**
 * 构造邮件
 * @param {string} type  模板类型（见 TEMPLATES 的 key）
 * @param {object} data  模板变量
 * @returns {{subject:string, html:string, text:string}}
 */
export function buildMailTemplate(type, data = {}) {
  const fn = TEMPLATES[type]
  if (!fn) {
    return { subject: type, html: `<p>${type}</p>`, text: type }
  }
  return fn(data || {})
}

/**
 * 用变量替换简易模板（占位符 {{var}}）
 * @param {string} tpl
 * @param {object} vars
 */
export function renderTemplate(tpl, vars = {}) {
  if (!tpl) return ''
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] != null ? String(vars[k]) : `{{${k}}}`)
}

export { PLAIN_TEXT }
