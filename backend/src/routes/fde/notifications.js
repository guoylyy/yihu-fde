// FDE 平台 - 站内通知 API
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, requirePermission } from '../../lib/auth.js'
import { pushNotification } from '../../lib/notify.js'
import { listCatalogForSettings, normalizePrefsInput, DAILY_DIGEST_TYPE } from '../../lib/notificationCatalog.js'

const router = express.Router()
router.use(internalAuth)

// 列表（带分页 + 过滤）
router.get('/', async (req, res) => {
  try {
    const { unread, page = 1, page_size = 20, type = '' } = req.query
    const where = { userId: req.user.id }
    if (unread === 'true') where.readAt = null
    if (type) where.type = type

    const skip = (Number(page) - 1) * Number(page_size)
    const [list, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: Number(page_size),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user.id, readAt: null } })
    ])

    // data 是 JSON 字符串，还原
    const data = list.map(n => ({
      ...n,
      data: n.data ? (() => { try { return JSON.parse(n.data) } catch { return null } })() : null
    }))

    res.json({
      code: 0,
      data: {
        list: data,
        total,
        unreadCount,
        page: Number(page),
        page_size: Number(page_size)
      }
    })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * POST /api/fde/notifications  { toUserId, title, content, link? }
 * 主动给同事发一条站内通知（此前只能查不能发）。
 *
 * 两条刻意的收窄, 都是为了智能体代发时不出事:
 *   ① channels 写死 ['site'] —— 只进站内信箱, 不外发飞书/邮件。
 *      与 v1.5.1「不给智能体 send_email」同一条边界: 对外通道一律要人在后台点。
 *   ② body 里带上发送人, 收到的人一眼知道是谁让发的, 不会以为是系统消息。
 */
router.post('/', requirePermission('notification.send'), async (req, res) => {
  try {
    const { toUserId, title, content, link } = req.body || {}
    if (!toUserId) return res.status(400).json({ code: 1001, message: 'toUserId 必填' })
    if (!title || !String(title).trim()) return res.status(400).json({ code: 1002, message: '标题不能为空' })

    const target = await prisma.user.findFirst({
      where: { id: BigInt(toUserId), deletedAt: null },
      select: { id: true, name: true }
    })
    if (!target) return res.status(404).json({ code: 9004, message: '接收人不存在' })

    const sender = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
    const body = `${content ? String(content).trim() : ''}\n\n—— 由 ${sender?.name || '同事'} 发送`.trim()

    const result = await pushNotification({
      userId: target.id,
      type: 'MANUAL',
      title: String(title).trim().slice(0, 200),
      body,
      link: link || null,
      channels: ['site']
    })
    if (!result?.site) return res.status(500).json({ code: 9001, message: '通知发送失败' })

    res.json({ code: 0, data: { id: String(result.site.id), toUserId: String(target.id), toName: target.name } })
  } catch (e) {
    console.error('[fde/notifications POST /]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 未读数（轻量，给铃铛轮询用）
/**
 * v2.5.5(#912) 通知设置: 目录(分档+默认送达) + 我的按类型开关
 * GET  /api/fde/notifications/prefs           → { catalog:[...], prefs:{type:{enabled,...}} }
 * PUT  /api/fde/notifications/prefs {prefs}   → 合并保存(传 null 清除该类型设置); 只接受目录内类型
 */
router.get('/prefs', async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { notificationPrefs: true } })
    const prefs = parsePrefs(me?.notificationPrefs)
    res.json({ code: 0, data: { catalog: listCatalogForSettings(), prefs, digestType: DAILY_DIGEST_TYPE } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.put('/prefs', async (req, res) => {
  try {
    const input = req.body?.prefs
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ code: 1002, message: 'prefs 须为对象 { [type]: { enabled: boolean } }' })
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { notificationPrefs: true } })
    const { prefs, rejected } = normalizePrefsInput(input, parsePrefs(me?.notificationPrefs))
    if (rejected.length && !Object.keys(input).some(k => !rejected.includes(k))) {
      return res.status(400).json({ code: 1002, message: `未知通知类型或非法取值: ${rejected.join(', ')}` })
    }
    await prisma.user.update({ where: { id: req.user.id }, data: { notificationPrefs: prefs } })
    res.json({ code: 0, data: { prefs, rejected } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

function parsePrefs(v) {
  if (!v) return {}
  if (typeof v === 'string') { try { return JSON.parse(v) || {} } catch { return {} } }
  return typeof v === 'object' ? v : {}
}

router.get('/unread-count', async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.id, readAt: null }
    })
    res.json({ code: 0, data: { count } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 归属判定: n.userId 是 BigInt, req.user.id 来自 JWT 是字符串,
// 直接 !== 永远为真 —— 这条曾导致"标记已读"和"删除通知"对所有人 403。统一转字符串比。
const isMine = (n, req) => n && String(n.userId) === String(req.user.id)

// 标记单条已读
router.post('/:id/read', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const n = await prisma.notification.findUnique({ where: { id } })
    if (!isMine(n, req)) return res.status(404).json({ code: 9004, message: '通知不存在' })
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } })
    res.json({ code: 0, data: { id: req.params.id } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 全部标记已读
router.post('/read-all', async (req, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() }
    })
    res.json({ code: 0, data: { updated: result.count } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 删除单条
router.delete('/:id', async (req, res) => {
  try {
    const id = BigInt(req.params.id)
    const n = await prisma.notification.findUnique({ where: { id } })
    if (!isMine(n, req)) return res.status(403).json({ code: 9003, message: '无权删除' })
    await prisma.notification.delete({ where: { id } })
    res.json({ code: 0, data: { id: req.params.id } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
