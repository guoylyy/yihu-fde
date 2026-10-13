// 以虎 One 托管的大模型: 平台提供 OpenAI 兼容接口, 用本应用在平台的凭证调用, 密钥不出平台
//
// 凭证与地址都来自统一登录的配置(OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_INTERNAL_URL,
// 装在平台上时由 platform.js 自动补齐), 大模型配置里不存密钥。
//   GET  <平台>/api/open/llm/models             可用模型(id 即调用时的 model)
//   POST <平台>/api/open/llm/chat/completions   对话补全
import prisma from './prisma.js'
import { oidcConfig, serverUrl } from './oidc.js'

export const YIHU_ONE = 'YIHU_ONE'

/** 调用地址与凭证; 没配统一登录时返回 null */
export function yihuOneEndpoint(cfg = oidcConfig()) {
  if (!cfg.enabled) return null
  return { baseUrl: serverUrl('/api/open/llm', cfg), apiKey: `${cfg.clientId}:${cfg.clientSecret}`, name: cfg.name }
}

/** 拉平台上本应用可用的模型清单: [{ id, name, description, default }] */
export async function fetchYihuOneModels(cfg = oidcConfig()) {
  const ep = yihuOneEndpoint(cfg)
  if (!ep) throw new Error('还没有接入以虎 One：请先配置统一登录(OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET)')
  let r
  try {
    r = await fetch(`${ep.baseUrl}/models`, {
      headers: { Authorization: 'Basic ' + Buffer.from(ep.apiKey).toString('base64') },
      signal: AbortSignal.timeout(10000)
    })
  } catch (e) {
    throw new Error(`连不上${ep.name}：${e.message}`)
  }
  if (r.status === 404) throw new Error(`${ep.name} 不提供模型清单：请把平台升级到支持 /api/open/llm/models 的版本`)
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${ep.name} 返回 ${r.status}：${data?.error?.message || ''}`.trim())
  if (!Array.isArray(data?.data)) throw new Error(`${ep.name} 的模型清单格式不对`)
  return data.data
    .filter(m => m && m.id)
    .map(m => ({ id: String(m.id), name: String(m.name || m.id), description: m.description || null, default: !!m.default }))
}

/**
 * 把平台的模型同步成本系统的大模型配置(provider = YIHU_ONE):
 * 新模型新增、已有的更新名称并启用、平台上没有了的停用(不删, 管理员改过的参数保留)。
 * 本系统还没有默认配置时, 把平台的默认模型设为默认。
 */
export async function syncYihuOneModels({ userId, cfg = oidcConfig() } = {}) {
  const models = await fetchYihuOneModels(cfg)
  const prefix = yihuOneEndpoint(cfg).name
  const existing = await prisma.llmConfig.findMany({ where: { provider: YIHU_ONE, deletedAt: null } })
  const byModel = new Map(existing.map(c => [c.model, c]))
  const result = { created: 0, updated: 0, disabled: 0, models: models.length }

  await prisma.$transaction(async (tx) => {
    for (const m of models) {
      const name = `${prefix} · ${m.name}`.slice(0, 100)
      const remark = (m.description ? `${m.description}（同步自${prefix}）` : `同步自${prefix}`).slice(0, 500)
      const hit = byModel.get(m.id)
      if (hit) {
        await tx.llmConfig.update({ where: { id: hit.id }, data: { name, remark, enabled: true } })
        result.updated++
      } else {
        await tx.llmConfig.create({
          data: { name, provider: YIHU_ONE, model: m.id, remark, enabled: true, isDefault: false, createdBy: userId ? BigInt(userId) : null }
        })
        result.created++
      }
    }
    const live = new Set(models.map(m => m.id))
    for (const c of existing) {
      if (!live.has(c.model) && c.enabled) {
        await tx.llmConfig.update({ where: { id: c.id }, data: { enabled: false, isDefault: false } })
        result.disabled++
      }
    }
    // 没有可用的默认配置时, 用平台的默认模型
    const hasDefault = await tx.llmConfig.count({ where: { deletedAt: null, enabled: true, isDefault: true } })
    const platformDefault = models.find(m => m.default) || models[0]
    if (!hasDefault && platformDefault) {
      await tx.llmConfig.updateMany({ where: { deletedAt: null }, data: { isDefault: false } })
      await tx.llmConfig.updateMany({
        where: { provider: YIHU_ONE, model: platformDefault.id, deletedAt: null },
        data: { isDefault: true }
      })
      result.defaultModel = platformDefault.id
    }
  })
  return result
}
