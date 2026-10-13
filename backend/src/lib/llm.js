// 2026-07-31 大模型调用层: 读「大模型配置」模块的默认配置发起对话补全
// 首个消费场景 = 会议纪要导入(project-records)。后续功能接入大模型统一走这里, 不要散落直连
// Provider 分两类:
//   - ANTHROPIC: 官方 @anthropic-ai/sdk (Messages API)。注意最新 Claude 模型(Opus 4.7+)已移除
//     temperature 参数, 传了直接 400, 因此对 Anthropic 一律不透传 temperature
//   - 其余(DeepSeek/Qwen/Zhipu/Moonshot/OpenAI/Custom): OpenAI 兼容 /chat/completions, 原生 fetch
import Anthropic from '@anthropic-ai/sdk'
import prisma from './prisma.js'

// 各 provider 官方接口地址(配置里 baseUrl 留空时兜底)
const DEFAULT_BASE_URLS = {
  ANTHROPIC: 'https://api.anthropic.com',
  DEEPSEEK: 'https://api.deepseek.com',
  QWEN: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ZHIPU: 'https://open.bigmodel.cn/api/paas/v4',
  MOONSHOT: 'https://api.moonshot.cn/v1',
  OPENAI: 'https://api.openai.com/v1'
}

// 思考模型(reasoning)重试用的输出预算: 各处调用传的 1000~2000 只够思考, 正文会被截没
const REASONING_MAX_TOKENS = 16000

export class LlmNotConfiguredError extends Error {
  constructor(msg = '尚未配置可用的大模型：请管理员在「基础配置 → 大模型配置」中添加并启用一个配置') {
    super(msg)
    this.code = 'LLM_NOT_CONFIGURED'
  }
}

/** 取默认(优先)或任一启用的大模型配置; 无可用配置抛 LlmNotConfiguredError */
export async function getActiveLlmConfig() {
  const config = await prisma.llmConfig.findFirst({
    where: { deletedAt: null, enabled: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
  })
  if (!config) throw new LlmNotConfiguredError()
  if (!config.apiKey) throw new LlmNotConfiguredError(`大模型配置「${config.name}」缺少 API 密钥，请管理员补齐`)
  return config
}

/**
 * 对话补全, 返回纯文本
 * @param {{ system?: string, user: string, maxTokens?: number, config?: object }} opts
 */
export async function chatComplete({ system, user, maxTokens, config }) {
  const cfg = config || await getActiveLlmConfig()
  const max = maxTokens || cfg.maxTokens || 4096
  if (cfg.provider === 'ANTHROPIC') {
    const client = new Anthropic({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl || undefined,
      timeout: 120000
    })
    const resp = await client.messages.create({
      model: cfg.model,
      max_tokens: max,
      system: system || undefined,
      messages: [{ role: 'user', content: user }]
    })
    if (resp.stop_reason === 'refusal') throw new Error('大模型拒绝了此请求(安全策略)')
    return resp.content.filter(b => b.type === 'text').map(b => b.text).join('')
  }

  // OpenAI 兼容
  const base = (cfg.baseUrl || DEFAULT_BASE_URLS[cfg.provider] || '').replace(/\/$/, '')
  if (!base) throw new Error(`大模型配置「${cfg.name}」缺少接口地址(baseUrl)`)
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: user }
  ]
  const callOnce = async (budget) => {
    const body = { model: cfg.model, max_tokens: budget, messages }
    if (cfg.temperature !== null && cfg.temperature !== undefined) body.temperature = Number(cfg.temperature)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120000)
    let resp
    try {
      resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
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
    console.warn(`[llm] ${cfg.name}/${cfg.model} 思考占满 ${max} tokens 无正文, 以 ${REASONING_MAX_TOKENS} 重试`)
    r = await callOnce(REASONING_MAX_TOKENS)
  }
  if (!r.content) {
    throw new Error(`大模型返回内容为空(模型 ${cfg.model}, finish_reason=${r.finish || '未知'}, 思考 ${r.reasoningTokens} tokens)` +
      (r.finish === 'length' ? ': 输出预算被思考过程占满, 请在「大模型配置」调大 maxTokens 或换用非思考模型' : ''))
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
