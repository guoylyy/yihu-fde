// 2026-07-31 大模型配置(基础模块): 平台可调用的大模型及参数的 CRUD
// 只做配置管理, 不做实际调用——等具体功能要用大模型时再接调用层
// apiKey 写后不回显: 列表/详情只返回掩码 + hasApiKey; 更新时留空表示不修改
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'

const router = express.Router()
router.use(internalAuth)
router.use(requirePermission('llmConfig.manage'))

const PROVIDERS = ['ANTHROPIC', 'DEEPSEEK', 'QWEN', 'ZHIPU', 'MOONSHOT', 'OPENAI', 'CUSTOM']

function maskKey(key) {
  if (!key) return null
  if (key.length <= 8) return '****'
  return key.slice(0, 6) + '****' + key.slice(-4)
}

function serialize(c) {
  return {
    id: c.id,
    name: c.name,
    provider: c.provider,
    model: c.model,
    baseUrl: c.baseUrl,
    apiKeyMasked: maskKey(c.apiKey),
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

function validate(body, { partial = false } = {}) {
  const errors = []
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) errors.push('name 必填')
  }
  if (!partial || body.provider !== undefined) {
    if (!PROVIDERS.includes(body.provider)) errors.push(`provider 必须是 ${PROVIDERS.join('/')}`)
  }
  if (!partial || body.model !== undefined) {
    if (!body.model || !String(body.model).trim()) errors.push('model 必填')
  }
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

// 从请求体挑出可写字段(不含 apiKey, 密钥单独处理)
function pickData(body) {
  const data = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.provider !== undefined) data.provider = body.provider
  if (body.model !== undefined) data.model = String(body.model).trim()
  if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl ? String(body.baseUrl).trim() : null
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
      where: { deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    })
    res.json({ code: 0, data: { list: list.map(serialize) } })
  } catch (e) {
    console.error('[llm-configs:list]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 创建
router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    const errors = validate(body)
    if (errors.length) return res.status(400).json({ code: 1001, message: errors.join('; ') })
    const created = await prisma.$transaction(async (tx) => {
      // 首个配置自动设为默认; 显式传 isDefault 则先清掉其他默认
      const count = await tx.llmConfig.count({ where: { deletedAt: null } })
      const isDefault = body.isDefault ? true : count === 0
      if (isDefault) await tx.llmConfig.updateMany({ where: { deletedAt: null }, data: { isDefault: false } })
      return tx.llmConfig.create({
        data: {
          ...pickData(body),
          apiKey: body.apiKey ? String(body.apiKey).trim() : null,
          isDefault,
          createdBy: BigInt(req.user.userId)
        }
      })
    })
    res.json({ code: 0, data: serialize(created) })
  } catch (e) {
    console.error('[llm-configs:create]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 更新 (apiKey 传非空字符串才覆盖, 留空/不传保持原值)
router.put('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const body = req.body || {}
    const errors = validate(body, { partial: true })
    if (errors.length) return res.status(400).json({ code: 1001, message: errors.join('; ') })
    const exists = await prisma.llmConfig.findFirst({ where: { id, deletedAt: null } })
    if (!exists) return res.status(404).json({ code: 4004, message: '配置不存在' })
    const data = pickData(body)
    if (body.apiKey !== undefined && String(body.apiKey).trim() !== '') data.apiKey = String(body.apiKey).trim()
    if (body.clearApiKey === true) data.apiKey = null
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
