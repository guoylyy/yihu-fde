// 群机器人统一发送层: 飞书 / 钉钉 / 企业微信 / Slack 自定义机器人, 外加通用 JSON Webhook
//
// 用法: await sendBotMessage(bot, { title, lines, level, link, mention })
//   bot     = { channel, url, secret?, mentionAll?, mentionMobiles? }
//   level   = 'danger' | 'success' | 'info'   决定飞书卡片颜色
//   lines   = ['**项目**：xxx', ...]           每行一段 markdown
// 返回 { ok, error? } —— 从不抛错, 调用方(探活 cron)不能被出网失败拖垮
//
// 三家坑位:
//   - HTTP 都回 200, 成败看返回体: 飞书 code / 钉钉、企微 errcode, 非 0 即失败
//   - 加签时间戳单位不同: 飞书秒(放 body), 钉钉毫秒(拼 URL)
//   - 飞书自定义机器人不能按手机号 @人(只认 open_id), 只支持 @所有人
//   - 企微 markdown 不支持按手机号 @, 需要 @ 时补发一条 text 消息带 mentioned_mobile_list
import crypto from 'crypto'

// 项目级机器人(经理在界面上配)可选的渠道。WEBHOOK(通用, 任意地址)只给管理员经环境变量配的全局通知用,
// 不对界面开放 —— 否则任何经理都能让平台去请求内网地址(SSRF)
export const BOT_CHANNELS = ['FEISHU', 'DINGTALK', 'WECOM', 'SLACK']
export const BOT_CHANNEL_LABELS = { FEISHU: '飞书', DINGTALK: '钉钉', WECOM: '企业微信', SLACK: 'Slack', WEBHOOK: 'Webhook' }

// 各渠道合法的 webhook 域名 —— 路由层据此校验, 防止把平台当 SSRF 跳板打内网
export const BOT_HOSTS = {
  FEISHU: ['open.feishu.cn', 'open.larksuite.com'],
  DINGTALK: ['oapi.dingtalk.com'],
  WECOM: ['qyapi.weixin.qq.com'],
  SLACK: ['hooks.slack.com']
}

/** 按 webhook 域名猜渠道(全局通知只配了 URL 时用); 认不出就当通用 Webhook */
export function guessChannel(url) {
  let host = ''
  try { host = new URL(String(url)).hostname } catch { return 'WEBHOOK' }
  for (const [ch, hosts] of Object.entries(BOT_HOSTS)) if (hosts.includes(host)) return ch
  return 'WEBHOOK'
}

const TIMEOUT_MS = 5000

/** 校验 webhook 地址: https + 渠道域名白名单; 返回错误文案或 null */
export function validateBotUrl(channel, url) {
  if (!BOT_CHANNELS.includes(channel)) return `channel 必须是 ${BOT_CHANNELS.join('/')}`
  let u
  try { u = new URL(String(url || '')) } catch { return 'Webhook 地址格式不正确' }
  if (u.protocol !== 'https:') return 'Webhook 地址必须是 https'
  if (!BOT_HOSTS[channel].includes(u.hostname)) {
    return `${BOT_CHANNEL_LABELS[channel]}机器人地址应以 https://${BOT_HOSTS[channel][0]}/ 开头`
  }
  return null
}

/** 飞书加签: key = `${ts}\n${secret}`, 对空串做 HmacSHA256 后 base64 */
export function feishuSign(secret, timestampSec) {
  return crypto.createHmac('sha256', `${timestampSec}\n${secret}`).update('').digest('base64')
}

/** 钉钉加签: key = secret, 对 `${ts}\n${secret}` 做 HmacSHA256 后 base64 (拼 URL 前再 urlencode) */
export function dingtalkSign(secret, timestampMs) {
  return crypto.createHmac('sha256', secret).update(`${timestampMs}\n${secret}`).digest('base64')
}

function mobilesOf(bot) {
  return Array.isArray(bot.mentionMobiles) ? bot.mentionMobiles.map(String).filter(Boolean) : []
}

/**
 * 按渠道组装请求; 返回 [{ url, body }] (企微带 @ 时是两条)
 * 独立导出便于单测断言消息体与签名
 */
export function buildBotRequests(bot, msg, now = Date.now()) {
  const { title, lines = [], level = 'info', link } = msg
  const mobiles = mobilesOf(bot)
  const md = lines.join('\n')

  if (bot.channel === 'FEISHU') {
    const template = { danger: 'red', success: 'green', info: 'blue' }[level] || 'blue'
    const elements = [{ tag: 'div', text: { tag: 'lark_md', content: md + (bot.mentionAll ? '\n<at id=all></at>' : '') } }]
    if (link) {
      elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看详情' }, type: 'primary', url: link }] })
    }
    const body = {
      msg_type: 'interactive',
      card: { config: { wide_screen_mode: true }, header: { template, title: { tag: 'plain_text', content: title } }, elements }
    }
    if (bot.secret) {
      const ts = Math.floor(now / 1000)
      body.timestamp = String(ts)
      body.sign = feishuSign(bot.secret, ts)
    }
    return [{ url: bot.url, body }]
  }

  if (bot.channel === 'DINGTALK') {
    let url = bot.url
    if (bot.secret) {
      const sign = encodeURIComponent(dingtalkSign(bot.secret, now))
      url += `${url.includes('?') ? '&' : '?'}timestamp=${now}&sign=${sign}`
    }
    // 钉钉要求被 @ 的手机号出现在正文里才会高亮
    const atLine = mobiles.length ? '\n\n' + mobiles.map(m => `@${m}`).join(' ') : ''
    const text = `### ${title}\n\n${lines.join('\n\n')}${link ? `\n\n[查看详情](${link})` : ''}${atLine}`
    return [{ url, body: { msgtype: 'markdown', markdown: { title, text }, at: { atMobiles: mobiles, isAtAll: !!bot.mentionAll } } }]
  }

  if (bot.channel === 'WECOM') {
    const color = { danger: 'warning', success: 'info', info: 'comment' }[level] || 'comment'
    const content = `**<font color="${color}">${title}</font>**\n${md}${link ? `\n[查看详情](${link})` : ''}`
    const reqs = [{ url: bot.url, body: { msgtype: 'markdown', markdown: { content } } }]
    if (bot.mentionAll || mobiles.length) {
      reqs.push({
        url: bot.url,
        body: { msgtype: 'text', text: { content: `请关注：${title}`, mentioned_mobile_list: bot.mentionAll ? ['@all', ...mobiles] : mobiles } }
      })
    }
    return reqs
  }

  if (bot.channel === 'SLACK') {
    // Slack mrkdwn 的粗体是 *x*, 链接是 <url|text>
    const toMrkdwn = t => t.replace(/\*\*(.+?)\*\*/g, '*$1*')
    const text = [`*${title}*`, ...lines.map(toMrkdwn), link ? `<${link}|查看详情>` : '']
      .filter(Boolean).join('\n') + (bot.mentionAll ? '\n<!channel>' : '')
    return [{ url: bot.url, body: { text } }]
  }

  if (bot.channel === 'WEBHOOK') {
    // 通用 JSON: 结构化字段 + 拼好的纯文本, 接收方自行取用
    const text = [title, ...lines, link || ''].filter(Boolean).join('\n')
    return [{ url: bot.url, body: { title, level, lines, link: link || null, text } }]
  }

  throw new Error(`不支持的渠道 ${bot.channel}`)
}

async function postOnce(url, body) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON 响应按 HTTP 码判断 */ }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}${json?.msg ? ` ${json.msg}` : ''}` }
    if (json) {
      // 飞书 code(老版 StatusCode) / 钉钉、企微 errcode
      const code = json.code ?? json.StatusCode ?? json.errcode ?? 0
      if (code !== 0) return { ok: false, error: `${code} ${json.msg || json.errmsg || json.StatusMessage || ''}`.trim() }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? `超时（${TIMEOUT_MS / 1000}s）` : String(e.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/** 发送一条机器人消息; 网络类失败重试一次, 业务错误码(签名错/关键词不匹配)不重试 */
export async function sendBotMessage(bot, msg) {
  let reqs
  try { reqs = buildBotRequests(bot, msg) } catch (e) { return { ok: false, error: e.message } }
  for (const r of reqs) {
    let res = await postOnce(r.url, r.body)
    if (!res.ok && /超时|HTTP 5|fetch failed|ECONN/.test(res.error)) res = await postOnce(r.url, r.body)
    if (!res.ok) return { ok: false, error: res.error.slice(0, 300) }
  }
  return { ok: true }
}
