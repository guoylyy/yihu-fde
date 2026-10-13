import express from 'express'
import { z } from 'zod'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { parseChecklist } from '../../lib/trainingChecklist.js'

const id = z.string().refine(v => /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n)
const body = z.object({ checked: z.boolean() }).strict()

// 知识库文章行动检查单 (v2.12: 以太学院检查单随训练线删除, 只留知识库这一侧;
// parseChecklist 是通用 Markdown 行动清单解析, 留在 lib/trainingChecklist.js)
export function createChecklistRouter({ db }) {
  const router = express.Router()
  router.use(internalAuth, requirePermission('knowledge.access'), requirePermission('knowledge.view'))
  router.use((req, res, next) => {
    if (!id.safeParse(String(req.user.userId)).success) return res.status(401).json({ code: 1002, message: '用户身份无效' })
    if (Object.keys(req.query).length) return res.status(400).json({ code: 9002, message: '不支持查询其他用户检查单' })
    next()
  })
  async function resource(req, res) {
    if (!id.safeParse(req.params.resourceId).success) { res.status(400).json({ code: 9002, message: '资源ID无效' }); return null }
    const item = await db.knowledgeArticle.findFirst({ where: { id: BigInt(req.params.resourceId), deletedAt: null } })
    if (!item) { res.status(404).json({ code: 9004, message: '内容不存在' }); return null }
    return item
  }
  function failure(res, error) {
    if (error instanceof RangeError) return res.status(400).json({ code: 9002, message: '检查单内容超出支持范围，请联系维护者' })
    console.error('[checklist]', error.name); return res.status(500).json({ code: 9001, message: '检查单读取或保存失败，请稍后重试' })
  }
  router.get('/:resourceId', async (req, res) => {
    try {
      const item = await resource(req, res); if (!item) return
      const items = parseChecklist(item.content)
      const saved = items.length ? await db.knowledgeChecklistProgress.findMany({ where: { userId: BigInt(req.user.userId), articleId: item.id, itemKey: { in: items.map(i => i.itemKey) } }, select: { itemKey: true, checked: true } }) : []
      const byKey = new Map(saved.map(row => [row.itemKey, row.checked]))
      res.json({ code: 0, data: { articleId: String(item.id), items: items.map(row => ({ ...row, checked: byKey.get(row.itemKey) ?? false })) } })
    } catch (error) { failure(res, error) }
  })
  router.put('/:resourceId/:itemKey', async (req, res) => {
    const parsed = body.safeParse(req.body)
    if (!parsed.success || !/^[a-f0-9]{32}$/.test(req.params.itemKey)) return res.status(400).json({ code: 9002, message: '检查项或checked参数无效' })
    try {
      const item = await resource(req, res); if (!item) return
      if (!parseChecklist(item.content).some(row => row.itemKey === req.params.itemKey)) return res.status(409).json({ code: 9004, message: '检查项已变更，请刷新后重试' })
      const identity = { userId: BigInt(req.user.userId), articleId: item.id, itemKey: req.params.itemKey }
      const row = await db.knowledgeChecklistProgress.upsert({ where: { userId_articleId_itemKey: identity }, create: { ...identity, checked: parsed.data.checked }, update: { checked: parsed.data.checked } })
      res.json({ code: 0, data: { itemKey: row.itemKey, checked: row.checked } })
    } catch (error) { failure(res, error) }
  })
  return router
}
