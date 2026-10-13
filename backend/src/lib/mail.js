// 邮件服务（开发阶段支持 mock 模式）
// 用法：import { sendMail } from '../../lib/mail.js'
//       await sendMail({ to, subject, html, text, type, data })
//
// 配置（backend/.env）：
//   SMTP_HOST=smtp.qq.com          // 留空 = 强制 mock
//   SMTP_PORT=465
//   SMTP_SECURE=true
//   SMTP_USER=xxx@qq.com
//   SMTP_PASS=授权码
//   SMTP_FROM_NAME=FDE Platform      # 不填用 BRAND_NAME
//   SMTP_FROM_EMAIL=noreply@example.com
//
// 真实环境需安装 nodemailer：npm i nodemailer

import { buildMailTemplate, renderTemplate } from './mail-templates.js'
import { getBrand } from '../config/brand.js'

const MOCK = process.env.MOCK_MODE === 'true' || !process.env.SMTP_HOST

let transporter = null

async function getTransporter() {
  if (MOCK) return null
  if (transporter) return transporter
  // 动态 import nodemailer（避免硬依赖，让 mock 模式无需安装）
  let nodemailer
  try {
    nodemailer = (await import('nodemailer')).default
  } catch (e) {
    console.warn('[mail] nodemailer 未安装，自动降级为 mock 模式')
    return null
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  })
  return transporter
}

/**
 * 发送邮件
 * @param {object} options
 * @param {string|string[]} options.to  收件人
 * @param {string} options.subject      主题
 * @param {string} options.html         HTML 内容（可选）
 * @param {string} options.text         纯文本（可选）
 * @param {string} options.type         模板类型（用于模板渲染）
 * @param {object} options.data         模板变量
 * @returns {Promise<{success: boolean, mock?: boolean, messageId?: string, error?: string}>}
 */
export async function sendMail({ to, subject, html, text, type, data = {} }) {
  if (!to) return { success: false, error: 'no recipient' }

  // 模板优先
  let finalSubject = subject
  let finalHtml = html
  let finalText = text
  if (type) {
    const tpl = buildMailTemplate(type, data)
    finalSubject = tpl.subject
    finalHtml = tpl.html
    finalText = tpl.text
  }

  if (MOCK) {
    console.log(`\n📧 [MAIL MOCK] -> ${Array.isArray(to) ? to.join(',') : to}`)
    console.log(`  主题: ${finalSubject}`)
    console.log(`  模板类型: ${type || '(raw)'}`)
    if (finalText) console.log(`  正文预览: ${finalText.slice(0, 200)}...`)
    return { success: true, mock: true }
  }

  try {
    const t = await getTransporter()
    if (!t) {
      // nodemailer 没装，自动 mock
      console.log(`📧 [MAIL MOCK-FALLBACK] -> ${to} | ${finalSubject}`)
      return { success: true, mock: true }
    }
    const info = await t.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || getBrand().name}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: Array.isArray(to) ? to.join(',') : to,
      subject: finalSubject,
      html: finalHtml,
      text: finalText
    })
    return { success: true, mock: false, messageId: info.messageId }
  } catch (e) {
    console.error('[mail] 发送失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 批量发邮件（多收件人，每人一封，便于个性化）
 * @param {Array<{to: string, subject?: string, html?: string, text?: string, type?: string, data?: object}>} items
 */
export async function sendMailBatch(items) {
  if (!Array.isArray(items) || !items.length) return []
  return Promise.all(items.map(item => sendMail(item)))
}

/**
 * 判断当前是否为 mock 模式（外部判断用）
 */
export function isMailMockMode() {
  return MOCK
}

// 兼容老引用
export const sendEmail = sendMail
