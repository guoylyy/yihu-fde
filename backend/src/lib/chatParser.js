// v1.6.1 聊天记录规则解析器
// 微信/飞书导出的文本 → 结构化轮次(说话人/时间/内容), 只为「看得清」服务, 不做摘要提炼
// 策略: 多个格式模式各跑一遍, 取命中消息数最多的; 都认不出 → 降级纯文本(ok=false)
// 决策②: 先支持微信 txt 与飞书; 决策⑤: 规则优先, 不走大模型

// 完整日期时间(2026-08-01 10:23[:45], 兼容 / 与 年月日) | 月日+时间 | 纯时间
const FULL_DT = /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?/
const SHORT_DT = /\d{1,2}[-/月]\d{1,2}日?\s+\d{1,2}:\d{2}(?::\d{2})?/
const TIME_ONLY = /\d{1,2}:\d{2}(?::\d{2})?/
const ANY_DT = new RegExp(`(?:${FULL_DT.source}|${SHORT_DT.source}|${TIME_ONLY.source})`)

const exact = (re) => new RegExp(`^${re.source}$`)
// 说话人: 不超过 30 字, 不含冒号(避免把正文行当header); 允许微信昵称的括号后缀
const SPEAKER = /[^:：\s][^:：]{0,29}/

/** 各模式: headRe 命中一行即开新消息, pick 从 match 里取 {speaker, time} */
const PATTERNS = [
  {
    // 微信常见: "2026-08-01 10:23:45 张三"(时间在前)
    name: 'wechat-time-first',
    headRe: new RegExp(`^(${FULL_DT.source})\\s+(${SPEAKER.source})$`),
    pick: (m) => ({ time: m[1].trim(), speaker: m[2].trim() })
  },
  {
    // 微信/留痕风格: "张三 2026-08-01 10:23:45"(说话人在前)
    name: 'wechat-speaker-first',
    headRe: new RegExp(`^(${SPEAKER.source}?)\\s+(${FULL_DT.source})$`),
    pick: (m) => ({ speaker: m[1].trim(), time: m[2].trim() })
  },
  {
    // 飞书复制常见: "张三 08-11 10:23"(短日期)或 "张三 10:23"
    name: 'feishu-inline',
    headRe: new RegExp(`^(${SPEAKER.source}?)\\s+((?:${SHORT_DT.source})|(?:${TIME_ONLY.source}))$`),
    pick: (m) => ({ speaker: m[1].trim(), time: m[2].trim() })
  },
  {
    // 冒号风格(人工誊抄/部分工具): "张三: 内容" / "张三：内容", 内容跟在同一行
    name: 'colon-style',
    headRe: new RegExp(`^(${SPEAKER.source})[：:]\\s?(.*)$`),
    pick: (m) => ({ speaker: m[1].trim(), time: '', inline: m[2] })
  }
]

/** 三行式(飞书导出/合并转发常见): 说话人 \n 时间 \n 内容... 单独处理 */
function tryThreeLine(lines) {
  const messages = []
  let i = 0
  let cur = null
  while (i < lines.length) {
    const line = lines[i].trim()
    const next = (lines[i + 1] || '').trim()
    const isSpeaker = line && line.length <= 30 && !exact(ANY_DT).test(line) && !/[：:]/.test(line)
    if (isSpeaker && exact(ANY_DT).test(next)) {
      if (cur) messages.push(cur)
      cur = { speaker: line, time: next, text: '' }
      i += 2
      continue
    }
    if (cur && line) cur.text += (cur.text ? '\n' : '') + line
    i += 1
  }
  if (cur) messages.push(cur)
  return messages
}

// 说话人不能长得像日期/纯数字(否则 "2026-08-11 10:00:00" 会被拆成 说话人=日期+时间)
const DATEISH = /^\d{1,4}([-/年.]\d{1,2}){1,2}日?(\s.*)?$/
const validSpeaker = (s) => !!s && !DATEISH.test(s) && !/^\d+$/.test(s)

function tryPattern(pattern, lines) {
  const messages = []
  let cur = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const m = pattern.headRe.exec(line)
    if (m) {
      const { speaker, time, inline } = pattern.pick(m)
      if (validSpeaker(speaker)) {
        if (cur) messages.push(cur)
        cur = { speaker, time, text: inline ? inline.trim() : '' }
        continue
      }
    }
    if (cur) cur.text += (cur.text ? '\n' : '') + line
  }
  if (cur) messages.push(cur)
  return messages
}

/** 解析质量评估: 消息数够多 + 说话人像人名(种类别爆炸) 才算认出 */
function usable(messages, lines) {
  if (messages.length < 2) return false
  const speakers = new Set(messages.map(m => m.speaker))
  // 说话人种类占消息数比例过高(几乎每条一个新名字) → 多半是把正文行误当 header
  if (speakers.size > Math.max(6, messages.length * 0.6)) return false
  // header 至少覆盖 1/4 的非空行, 避免 500 行文本只认出 2 条
  const nonEmpty = lines.filter(l => l.trim()).length
  return messages.length >= Math.max(2, nonEmpty / 20)
}

/** 从消息里捞第一个完整日期时间, 给 occurredAt 用 */
function firstOccurredAt(messages) {
  for (const m of messages) {
    const dt = new RegExp(FULL_DT.source).exec(m.time || '')
    if (dt) {
      const norm = dt[0].replace(/[年月]/g, '-').replace(/日/g, '').replace(/\//g, '-')
      const d = new Date(norm)
      if (!isNaN(d.getTime())) return d
    }
  }
  return null
}

function toMarkdown(messages) {
  return messages.map(m => {
    const time = m.time ? ` \`${m.time}\`` : ''
    return `**${m.speaker}**${time}：\n${m.text || '(空)'}`
  }).join('\n\n')
}

/**
 * 解析聊天文本。返回:
 * { ok, pattern, messages: [{speaker,time,text}], speakers: [], occurredAt: Date|null, markdown }
 * ok=false 时 markdown 即原文(降级纯文本保存)
 */
export function parseChat(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n')
  const lines = clean.split('\n')

  const candidates = PATTERNS.map(p => ({ name: p.name, messages: tryPattern(p, lines) }))
  candidates.push({ name: 'three-line', messages: tryThreeLine(lines) })

  let best = null
  for (const c of candidates) {
    if (!usable(c.messages, lines)) continue
    if (!best || c.messages.length > best.messages.length) best = c
  }

  if (!best) {
    return { ok: false, pattern: null, messages: [], speakers: [], occurredAt: null, markdown: clean.trim() }
  }
  const messages = best.messages.filter(m => m.text || m.time) // 丢掉完全空壳
  return {
    ok: true,
    pattern: best.name,
    messages,
    speakers: [...new Set(messages.map(m => m.speaker))],
    occurredAt: firstOccurredAt(messages),
    markdown: toMarkdown(messages)
  }
}
