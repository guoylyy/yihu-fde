// 大模型调用层: 用以虎 One 托管的模型(OpenAI 兼容接口, 本应用的平台凭证, 密钥不出平台)
// 「系统设置 → 大模型」里同步平台的模型、选默认; 一个都没选时用平台的默认模型。功能接入大模型统一走这里
import prisma from './prisma.js'
import { YIHU_ONE, yihuOneEndpoint } from './yihuOneLlm.js'

// 思考模型(reasoning)重试用的输出预算: 各处调用传的 1000~2000 只够思考, 正文会被截没
const REASONING_MAX_TOKENS = 16000

export class LlmNotConfiguredError extends Error {
  constructor(msg = '还没有接入以虎 One，无法使用大模型') {
    super(msg)
    this.code = 'LLM_NOT_CONFIGURED'
  }
}

/** 平台默认模型(不指定 model, 由以虎 One 选) */
const PLATFORM_DEFAULT = { name: '以虎 One 默认模型', provider: YIHU_ONE, model: '', temperature: null, maxTokens: null }

/** 取默认(优先)或任一启用的模型配置; 都没有时用平台默认模型。没接平台抛 LlmNotConfiguredError */
export async function getActiveLlmConfig() {
  if (!yihuOneEndpoint()) throw new LlmNotConfiguredError()
  const config = await prisma.llmConfig.findFirst({
    where: { deletedAt: null, enabled: true, provider: YIHU_ONE },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
  })
  return config || PLATFORM_DEFAULT
}

/**
 * 对话补全, 返回纯文本
 * @param {{ system?: string, user: string, maxTokens?: number, config?: object }} opts
 */
export async function chatComplete({ system, user, maxTokens, config }) {
  const cfg = config || await getActiveLlmConfig()
  const ep = yihuOneEndpoint()
  if (!ep) throw new LlmNotConfiguredError()
  const max = maxTokens || cfg.maxTokens || 4096
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: user }
  ]
  const callOnce = async (budget) => {
    const body = { max_tokens: budget, messages }
    if (cfg.model) body.model = cfg.model
    if (cfg.temperature !== null && cfg.temperature !== undefined) body.temperature = Number(cfg.temperature)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120000)
    let resp
    try {
      resp = await fetch(`${ep.baseUrl}/chat/completions`, {
        method: 'POST',
        // 平台的应用凭证: Basic base64(client_id:client_secret)
        headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(ep.apiKey).toString('base64') },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } finally { clearTimeout(timer) }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`大模型接口返回 ${resp.status}: ${text.slice(0, 300)}`)
    }
    const data = await resp.json()
    const choice = data?.choices?.[0] || {}
    return {
      content: choice.message?.content || '',
      // 思考模型(DeepSeek V4/Qwen3 思考版等)把过程放 reasoning_content, 同样吃 max_tokens 预算
      reasoningLen: (choice.message?.reasoning_content || '').length,
      finish: choice.finish_reason,
      reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens || 0
    }
  }

  let r = await callOnce(max)
  // 思考模型预算被思考吃光(finish_reason=length 且正文为空): 抬高预算重试一次, 否则功能整条链路白跑
  if (!r.content && r.finish === 'length' && r.reasoningLen > 0 && max < REASONING_MAX_TOKENS) {
    console.warn(`[llm] ${cfg.name}/${cfg.model || 'default'} 思考占满 ${max} tokens 无正文, 以 ${REASONING_MAX_TOKENS} 重试`)
    r = await callOnce(REASONING_MAX_TOKENS)
  }
  if (!r.content) {
    throw new Error(`大模型返回内容为空(模型 ${cfg.model || '平台默认'}, finish_reason=${r.finish || '未知'}, 思考 ${r.reasoningTokens} tokens)` +
      (r.finish === 'length' ? ': 输出预算被思考过程占满, 请在「系统设置 → 大模型」调大 maxTokens 或换用非思考模型' : ''))
  }
  return r.content
}

/**
 * 对话补全并解析为 JSON 对象(容忍 ```json 围栏/前后废话)
 */
export async function chatJSON({ system, user, maxTokens, config }) {
  const text = await chatComplete({ system, user, maxTokens, config })
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    // 兜底: 从文本里抠第一个 {...} 块
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      try { return JSON.parse(m[0]) } catch { /* fallthrough */ }
    }
    throw new Error('大模型返回的不是有效 JSON: ' + cleaned.slice(0, 200))
  }
}
