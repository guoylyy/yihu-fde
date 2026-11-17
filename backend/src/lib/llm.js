// 大模型调用层。模型来源两种:
//   - YIHU_ONE: 以虎 One 托管的模型(OpenAI 兼容接口, 本应用的平台凭证, 密钥不出平台)。「系统设置 → 大模型」里同步、选默认
//   - CUSTOM:   没接平台时管理员手填的 OpenAI 兼容接口(接口地址 + 密钥 + 模型名), 密钥只存服务端、接口只出掩码
// 默认配置全局唯一, 由管理员设; 所有人(含 AI 助手)都用默认, 不能自己选。功能接入大模型统一走这里
import prisma from './prisma.js'
import { YIHU_ONE, yihuOneEndpoint } from './yihuOneLlm.js'

export const MANUAL = 'CUSTOM'

// 思考模型(reasoning)重试用的输出预算: 各处调用传的 1000~2000 只够思考, 正文会被截没
const REASONING_MAX_TOKENS = 16000

export const NOT_CONFIGURED_MESSAGE = '未接入以虎 One，请手填模型或联系管理员'

export class LlmNotConfiguredError extends Error {
  constructor(msg = NOT_CONFIGURED_MESSAGE) {
    super(msg)
    this.code = 'LLM_NOT_CONFIGURED'
  }
}

/** 平台默认模型(不指定 model, 由以虎 One 选) */
const PLATFORM_DEFAULT = { name: '以虎 One 默认模型', provider: YIHU_ONE, model: '', temperature: null, maxTokens: null }

/** 模型来源: platform 平台同步 / manual 手动填写 */
export const sourceOf = (cfg) => (cfg?.provider === MANUAL ? 'manual' : 'platform')

/**
 * 取默认(优先)或任一启用的模型配置。
 * 接了平台: 平台同步的和手填的都可用, 都没有时用平台默认模型;
 * 没接平台: 只能用手填的, 没有就抛 LlmNotConfiguredError(给人看的话)
 */
export async function getActiveLlmConfig() {
  const platform = !!yihuOneEndpoint()
  const config = await prisma.llmConfig.findFirst({
    where: { deletedAt: null, enabled: true, provider: platform ? { in: [YIHU_ONE, MANUAL] } : MANUAL },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
  })
  if (config) return config
  if (platform) return PLATFORM_DEFAULT
  throw new LlmNotConfiguredError()
}

/** 某个配置的调用地址与鉴权头 */
export function endpointFor(cfg) {
  if (cfg?.provider === MANUAL) {
    const baseUrl = String(cfg.baseUrl || '').trim().replace(/\/+$/, '')
    if (!baseUrl || !cfg.apiKey) throw new LlmNotConfiguredError(`手填的模型「${cfg.name || cfg.model}」缺少接口地址或密钥，请管理员在「系统设置 → 大模型」补齐`)
    return { baseUrl, auth: `Bearer ${cfg.apiKey}` }
  }
  const ep = yihuOneEndpoint()
  if (!ep) throw new LlmNotConfiguredError()
  // 平台的应用凭证: Basic base64(client_id:client_secret)
  return { baseUrl: ep.baseUrl, auth: 'Basic ' + Buffer.from(ep.apiKey).toString('base64') }
}

/** 发一次 /chat/completions, 返回原始 JSON; 非 2xx 抛错(带返回原文前 300 字) */
async function postCompletion(cfg, body, timeoutMs = 120000) {
  const ep = endpointFor(cfg)
  const payload = { ...body }
  if (cfg.model) payload.model = cfg.model
  if (cfg.temperature !== null && cfg.temperature !== undefined) payload.temperature = Number(cfg.temperature)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let resp
  try {
    resp = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: ep.auth },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `请求大模型超时(${Math.round(timeoutMs / 1000)} 秒)` : `连不上大模型接口: ${e.message}`)
  } finally { clearTimeout(timer) }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`大模型接口返回 ${resp.status}: ${text.slice(0, 300)}`)
  }
  return resp.json()
}

/**
 * 对话补全, 返回纯文本
 * @param {{ system?: string, user: string, maxTokens?: number, config?: object }} opts
 */
export async function chatComplete({ system, user, maxTokens, config }) {
  const cfg = config || await getActiveLlmConfig()
  endpointFor(cfg)   // 没接平台 / 手填配置不全时先抛 LlmNotConfiguredError
  const max = maxTokens || cfg.maxTokens || 4096
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: user }
  ]
  const callOnce = async (budget) => {
    const data = await postCompletion(cfg, { max_tokens: budget, messages })
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
 * 带工具的一轮对话(OpenAI function calling)。返回 assistant 消息 { role, content, tool_calls? }
 * 由调用方(AI 助手)执行工具后把结果作为 role=tool 消息接上再调
 */
export async function chatWithTools({ messages, tools, config, maxTokens, timeoutMs = 60000 }) {
  const cfg = config || await getActiveLlmConfig()
  const body = { messages, max_tokens: maxTokens || cfg.maxTokens || 4096 }
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto' }
  const data = await postCompletion(cfg, body, timeoutMs)
  // 兼容平台用 { code, data } 再包一层的情况
  const payload = data?.choices ? data : data?.data
  const msg = payload?.choices?.[0]?.message
  if (!msg) throw new Error(`大模型返回格式不对: ${JSON.stringify(data).slice(0, 200)}`)
  return {
    role: 'assistant',
    content: msg.content || '',
    tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined,
    finish: payload.choices[0].finish_reason
  }
}

/** 试连: 发一句最短的话, 返回延迟与返回样例(不抛, 失败放 error) */
export async function testConnection(cfg) {
  const started = Date.now()
  try {
    const text = await chatComplete({ system: '你是连通性测试, 只回复一句不超过 20 字的中文问候。', user: '你好', maxTokens: 256, config: cfg })
    return { ok: true, latencyMs: Date.now() - started, sample: text.slice(0, 200), model: cfg.model || '平台默认' }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: e.message, model: cfg.model || '平台默认' }
  }
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
