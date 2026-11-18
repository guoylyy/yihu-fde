// 客户端脱敏: 规则与后端 backend/src/services/devlog/redact.js 一致(双保险, 服务端还会再跑一遍),
// 另外多盖一类: 平台自己签发的 API Key(fde_ / yhk_ 前缀, 24 位以上且带数字, 避开 fde_internal_token 这类变量名), 防止把采集器自己的 Key 报上去。
// 改后端规则时请同步这里。
export const MASK = '[REDACTED]'

// 每条: [正则, 替换]; 替换为函数时拿到分组, 保留键名只换值
const RULES = [
  // PEM 私钥整块(含 RSA/EC/OPENSSH 等), 没有结尾就一直盖到字符串末尾
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, () => MASK],
  // 连接串里的账号密码: mysql://user:pass@host → mysql://[REDACTED]@host
  [/\b((?:mysql|mariadb|postgres(?:ql)?|mongodb(?:\+srv)?|redis|amqp)s?:\/\/)[^\s:/@"'`]+:[^\s@"'`]*@/gi, (_, scheme) => `${scheme}${MASK}@`],
  // OpenAI / Anthropic 一类的 sk- 密钥
  [/\bsk-[A-Za-z0-9_-]{4,}/g, () => MASK],
  // 平台 API Key(仅客户端多盖的一条)
  [/\b(?:fde|yhk)_(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}/g, () => MASK],
  // AWS Access Key
  [/\b(?:AKIA|ASIA)[0-9A-Z]{12,}\b/g, () => MASK],
  // Authorization: Bearer xxx
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{4,}/g, (_, kw) => `${kw} ${MASK}`],
  // JSON 写法 "password":"…" / "token":"…"(也认被再转义一层的 \"password\":\"…\")
  [/(\\?"(?:[A-Za-z_]*password|passwd|pwd|[A-Za-z_]*token|secret|api_?key)\\?"\s*:\s*\\?")((?:[^"\\]|\\(?!"))*)(?=\\?")/gi,
    (m, head, val) => (val ? `${head}${MASK}` : m)],
  // 键值写法 password=… / token=…(URL 参数、命令行、.env)
  [/\b([A-Za-z_]*password|passwd|pwd|[A-Za-z_]*token|secret|api_?key)(\s*=\s*)(["']?)[^\s&"',;]+\3/gi,
    (_, key, eq, q) => `${key}${eq}${q}${MASK}${q}`]
]

// 结构化消息里键名本身就说明是秘密的: 值直接盖掉
const SECRET_KEY = /^(password|passwd|pwd|secret|token|access_?token|refresh_?token|api_?key|apikey|private_?key)$/i

/** 脱敏一段字符串: { text, hit } */
export function redactString(s) {
  if (typeof s !== 'string' || !s) return { text: s, hit: false }
  let out = s
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return { text: out, hit: out !== s }
}

/**
 * 递归脱敏任意 JSON 值(对象/数组/字符串), 不改动入参。
 * @returns {{ value: any, redacted: boolean }}
 */
export function redact(input) {
  let hit = false
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (key && SECRET_KEY.test(key) && v && v !== MASK) { hit = true; return MASK }
      const r = redactString(v)
      if (r.hit) hit = true
      return r.text
    }
    if (Array.isArray(v)) return v.map((x) => walk(x))
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = {}
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k)
      return o
    }
    return v
  }
  const value = walk(input)
  return { value, redacted: hit }
}
