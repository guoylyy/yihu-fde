// 大模型配置: 优先用以虎 One 托管的模型(同步平台的模型清单, 选默认、调参数);
// 没接平台时管理员可手填一个 OpenAI 兼容接口(provider=CUSTOM, 接口地址 + 密钥 + 模型名), 密钥写后不回显。
// 只有管理员(llmConfig.manage)能改; 其他人和 AI 助手一律用默认配置(lib/llm.js)
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { logInternalAction } from '../../lib/audit.js'
import { YIHU_ONE, yihuOneEndpoint, fetchYihuOneModels, syncYihuOneModels } from '../../lib/yihuOneLlm.js'
import { MANUAL, getActiveLlmConfig, sourceOf, testConnection, NOT_CONFIGURED_MESSAGE } from '../../lib/llm.js'

const router = express.Router()
router.use(internalAuth)
router.use(requirePermission('llmConfig.manage'))


// 密钥只出掩码: sk-a…9f3c
function maskKey(key) {
  if (!key) return null
  const k = String(key)
  return k.length <= 8 ? '****' : `${k.slice(0, 4)}…${k.slice(-4)}`
}

function serialize(c) {
  return {
    id: c.id,
    name: c.name,
    provider: c.provider,
    source: sourceOf(c),
    model: c.model,
    baseUrl: c.provider === MANUAL ? c.baseUrl : null,
    apiKeyMasked: c.provider === MANUAL ? maskKey(c.apiKey) : null,
    hasApiKey: !!c.apiKey,
    temperature: c.temperature,
    maxTokens: c.maxTokens,
    systemPrompt: c.systemPrompt,
    enabled: c.enabled,
    isDefault: c.isDefault,
    remark: c.remark,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }
}

function validate(body) {
  const errors = []
  if (body.temperature !== undefined && body.temperature !== null && body.temperature !== '') {
    const t = Number(body.temperature)
    if (Number.isNaN(t) || t < 0 || t > 2) errors.push('temperature 需在 0-2 之间')
  }
  if (body.maxTokens !== undefined && body.maxTokens !== null && body.maxTokens !== '') {
    const n = Number(body.maxTokens)
    if (!Number.isInteger(n) || n <= 0) errors.push('maxTokens 需为正整数')
  }
  return errors
}

// 平台同步的: 只能调调用参数和启停(名称、模型名来自平台); 手填的: 另外可改名称/模型名/接口地址/密钥
function pickData(body, manual = false) {
  const data = {}
  if (manual) {
    if (body.name !== undefined && String(body.name).trim()) data.name = String(body.name).trim().slice(0, 100)
    if (body.model !== undefined && String(body.model).trim()) data.model = String(body.model).trim().slice(0, 100)
    if (body.baseUrl !== undefined && String(body.baseUrl).trim()) data.baseUrl = String(body.baseUrl).trim().replace(/\/+$/, '').slice(0, 300)
    // 密钥留空 = 不修改
    if (body.apiKey !== undefined && String(body.apiKey).trim()) data.apiKey = String(body.apiKey).trim().slice(0, 300)
  }
  if (body.temperature !== undefined) data.temperature = body.temperature === null || body.temperature === '' ? null : Number(body.temperature)
  if (body.maxTokens !== undefined) data.maxTokens = body.maxTokens === null || body.maxTokens === '' ? null : Number(body.maxTokens)
  if (body.systemPrompt !== undefined) data.systemPrompt = body.systemPrompt || null
  if (body.enabled !== undefined) data.enabled = !!body.enabled
  if (body.remark !== undefined) data.remark = body.remark || null
  return data
}

// 列表
router.get('/', async (req, res) => {
  try {
    const list = await prisma.llmConfig.findMany({
      where: { deletedAt: null, provider: { in: [YIHU_ONE, MANUAL] } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    })
    const yh = yihuOneEndpoint()
    // active: AI 功能此刻实际会用的模型(默认配置; 平台上一个都没同步时是平台默认模型); 都没有时给人话原因
    let active = null
    try {
      const a = await getActiveLlmConfig()
      active = { id: a.id ?? null, name: a.name, model: a.model || null, source: sourceOf(a) }
    } catch (e) {
      active = { id: null, name: null, model: null, source: null, reason: e.message || NOT_CONFIGURED_MESSAGE }
    }
    // yihuOne: 已接入以虎 One 时前端显示「从以虎 One 同步」
    res.json({ code: 0, data: { list: list.map(serialize), yihuOne: yh ? { name: yh.name } : null, active } })
  } catch (e) {
    console.error('[llm-configs:list]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 以虎 One 上本应用可用的模型(只读预览)
router.get('/yihu-one/models', async (req, res) => {
  try {
    res.json({ code: 0, data: { list: await fetchYihuOneModels() } })
  } catch (e) {
    res.status(502).json({ code: 9002, message: e.message })
  }
})

// 从以虎 One 同步模型: 新增/更新/停用 provider=YIHU_ONE 的配置
router.post('/yihu-one/sync', async (req, res) => {
  try {
    res.json({ code: 0, data: await syncYihuOneModels({ userId: req.user.userId }) })
  } catch (e) {
    console.error('[llm-configs:yihu-one-sync]', e.message)
    res.status(502).json({ code: 9002, message: e.message })
  }
})

// 手填模型(OpenAI 兼容接口): body { name, model, baseUrl, apiKey, temperature?, maxTokens?, remark? }
// 一个可用配置都没有时, 新建的这个自动成为默认
router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const errors = validate(body)
    for (const [k, label] of [['name', '名称'], ['model', '模型名'], ['baseUrl', '接口地址'], ['apiKey', '密钥']]) {
      if (!String(body[k] || '').trim()) errors.push(`${label}必填`)
    }
    if (body.baseUrl && !/^https?:\/\//i.test(String(body.baseUrl).trim())) errors.push('接口地址要以 http:// 或 https:// 开头')
    if (errors.length) return res.status(400).json({ code: 1001, message: errors.join('; ') })
    const hasDefault = await prisma.llmConfig.count({ where: { deletedAt: null, enabled: true, isDefault: true } })
    const created = await prisma.llmConfig.create({
      data: { ...pickData(body, true), provider: MANUAL, enabled: true, isDefault: !hasDefault, createdBy: req.user.userId ? BigInt(req.user.userId) : null }
    })
    logInternalAction(req, 'llmConfig.create', { resourceType: 'llmConfig', resourceId: created.id, details: { provider: MANUAL, model: created.model } })
    res.json({ code: 0, data: serialize(created) })
  } catch (e) {
    console.error('[llm-configs:create]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 试连: body { id } 测已保存的配置; { model } 测平台上某个模型(同步前先试); 不传测当前默认
// 返回 { ok, latencyMs, sample | error, model }; 连不上也是 code 0, 由 ok 区分(界面要显示原因)
router.post('/test', async (req, res) => {
  try {
    const { id, model } = req.body || {}
    let cfg
    if (id) {
      cfg = await prisma.llmConfig.findFirst({ where: { id: BigInt(id), deletedAt: null } })
      if (!cfg) return res.status(404).json({ code: 4004, message: '配置不存在' })
    } else if (model) {
      if (!yihuOneEndpoint()) return res.json({ code: 0, data: { ok: false, latencyMs: 0, error: NOT_CONFIGURED_MESSAGE, model } })
      cfg = { name: String(model), provider: YIHU_ONE, model: String(model).slice(0, 100), temperature: null, maxTokens: null }
    } else {
      try { cfg = await getActiveLlmConfig() } catch (e) {
        return res.json({ code: 0, data: { ok: false, latencyMs: 0, error: e.message, model: null } })
      }
    }
    const r = await testConnection(cfg)
    logInternalAction(req, 'llmConfig.test', { resourceType: 'llmConfig', resourceId: cfg.id ?? null, details: { model: r.model, ok: r.ok, latencyMs: r.latencyMs } })
    res.json({ code: 0, data: r })
  } catch (e) {
    console.error('[llm-configs:test]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 更新参数 / 启停
router.put('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const body = req.body || {}
    const errors = validate(body)
    if (errors.length) return res.status(400).json({ code: 1001, message: errors.join('; ') })
    const exists = await prisma.llmConfig.findFirst({ where: { id, deletedAt: null } })
    if (!exists) return res.status(404).json({ code: 4004, message: '配置不存在' })
    const data = pickData(body, exists.provider === MANUAL)
    const updated = await prisma.llmConfig.update({ where: { id }, data })
    res.json({ code: 0, data: serialize(updated) })
  } catch (e) {
    console.error('[llm-configs:update]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 设为默认 (全局唯一)
router.post('/:id/set-default', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const exists = await prisma.llmConfig.findFirst({ where: { id, deletedAt: null } })
    if (!exists) return res.status(404).json({ code: 4004, message: '配置不存在' })
    if (!exists.enabled) return res.status(400).json({ code: 1001, message: '已停用的配置不能设为默认' })
    await prisma.$transaction([
      prisma.llmConfig.updateMany({ where: { deletedAt: null }, data: { isDefault: false } }),
      prisma.llmConfig.update({ where: { id }, data: { isDefault: true } })
    ])
    res.json({ code: 0, data: { ok: true } })
  } catch (e) {
    console.error('[llm-configs:set-default]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 删除 (软删; 默认配置不允许直接删, 先转移默认)
router.delete('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const exists = await prisma.llmConfig.findFirst({ where: { id, deletedAt: null } })
    if (!exists) return res.status(404).json({ code: 4004, message: '配置不存在' })
    if (exists.isDefault) return res.status(400).json({ code: 1001, message: '默认配置不能删除, 请先把默认设到其他配置' })
    await prisma.llmConfig.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ code: 0, data: { ok: true } })
  } catch (e) {
    console.error('[llm-configs:delete]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
