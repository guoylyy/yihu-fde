// 大模型配置: 用以虎 One 托管的模型(同步平台的模型清单, 选默认、调参数)
// 不再配其他供应商和密钥: 调用都经平台, 用本应用的平台凭证(lib/llm.js)
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { YIHU_ONE, yihuOneEndpoint, fetchYihuOneModels, syncYihuOneModels } from '../../lib/yihuOneLlm.js'

const router = express.Router()
router.use(internalAuth)
router.use(requirePermission('llmConfig.manage'))


function serialize(c) {
  return {
    id: c.id,
    name: c.name,
    provider: c.provider,
    model: c.model,
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

// 可调的只有调用参数和启停; 名称、模型名来自平台
function pickData(body) {
  const data = {}
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
      where: { deletedAt: null, provider: YIHU_ONE },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    })
    const yh = yihuOneEndpoint()
    // yihuOne: 已接入以虎 One 时前端显示「从以虎 One 同步」
    res.json({ code: 0, data: { list: list.map(serialize), yihuOne: yh ? { name: yh.name } : null } })
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

// 更新参数 / 启停
router.put('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const body = req.body || {}
    const errors = validate(body)
    if (errors.length) return res.status(400).json({ code: 1001, message: errors.join('; ') })
    const exists = await prisma.llmConfig.findFirst({ where: { id, deletedAt: null } })
    if (!exists) return res.status(404).json({ code: 4004, message: '配置不存在' })
    const data = pickData(body)
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
