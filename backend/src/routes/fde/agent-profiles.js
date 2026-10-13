// FDE 平台 - Agent 注册与目录 (v1.6.0 Agent 协作)
// 每个员工可注册多个 Agent, 注册即发专属 API Key(一体一 Key, 明文只回一次)
// Agent 权限=主人权限(代理用户模式, 不加权限面); 停用/删除即 Key 失效
// 本人管自己的; ADMIN 可看全员目录/代管
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, hasRole } from '../../lib/auth.js'
import { generateApiKey } from '../../lib/apiKey.js'
import { AGENT_STATUS, AGENT_STATUS_LABELS, getZombieThresholdDays, isZombie, writeAgentAudit } from '../../services/agentProfiles.js'

const router = express.Router()
router.use(internalAuth)

const PLATFORMS = ['OPENHEX', 'CLAUDE_CODE', 'COZE', 'CUSTOM', 'OTHER']

const PURPOSES = ['PATROL', 'DISPATCH', 'BOTH']

/** #1282 注册字段清洗: machineName/purpose/projectIds/model → data 片段(非法即拒) */
function cleanRegistryFields(b) {
  const out = {}
  if (b.machineName !== undefined) out.machineName = b.machineName ? String(b.machineName).trim().slice(0, 100) || null : null
  if (b.purpose !== undefined) {
    if (b.purpose === null || b.purpose === '') out.purpose = null
    else if (!PURPOSES.includes(b.purpose)) throw Object.assign(new Error('purpose 必须为 PATROL/DISPATCH/BOTH'), { status: 400, code: 1001 })
    else out.purpose = b.purpose
  }
  if (b.projectIds !== undefined) {
    if (b.projectIds === null) out.projectIds = null
    else if (Array.isArray(b.projectIds)) {
      const ids = [...new Set(b.projectIds.map(String).filter(Boolean))]
      if (b.projectIds.length && !ids.length) throw Object.assign(new Error('projectIds 格式不合法(应为项目 id 数组)'), { status: 400, code: 1001 })
      out.projectIds = ids
    } else throw Object.assign(new Error('projectIds 格式不合法(应为数组)'), { status: 400, code: 1001 })
  }
  if (b.model !== undefined) out.model = b.model ? String(b.model).trim().slice(0, 100) || null : null
  return out
}



function serialize(p, extra = {}, thresholdDays = 30) {
  // v2.13.0(#1278): 注册信息 + 生命周期派生字段(zombie 阈值按档案逐个判)
  const daysAgo = p.lastActiveAt
    ? Math.floor((Date.now() - new Date(p.lastActiveAt).getTime()) / 86400000)
    : null
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    platform: p.platform,
    capabilities: p.capabilities,
    machineName: p.machineName ?? null,
    purpose: p.purpose ?? null,           // PATROL 巡检 / DISPATCH 派工 / BOTH 两用
    projectIds: p.projectIds ?? null,     // 职责范围(字符串数组, null=未指定)
    model: p.model ?? null,
    status: p.status,
    statusLabel: AGENT_STATUS_LABELS[p.status] || String(p.status),
    lastActiveAt: p.lastActiveAt,
    lastActiveDaysAgo: daysAgo,
    isZombie: isZombie(p, thresholdDays),
    createdAt: p.createdAt,
    userId: p.userId,
    owner: p.user ? { id: p.user.id, username: p.user.username, name: p.user.name } : undefined,
    // 当前有效 Key 的前缀(辨识用, 无明文)
    keyPrefix: (p.apiKeys || []).find(k => k.status === 1)?.prefix,
    ...extra
  }
}

function canManage(user, profile) {
  return String(profile.userId) === String(user.userId) || hasRole(user, 'ADMIN')
}

async function findProfile(id) {
  return prisma.agentProfile.findFirst({
    where: { id: BigInt(id), deletedAt: null },
    include: { apiKeys: true, user: { select: { id: true, username: true, name: true } } }
  })
}

/** 给一批 Agent 补沉淀计数(记录数/会话数, 只算未退回删除的) */
async function attachCounts(list) {
  if (!list.length) return new Map()
  const ids = list.map(p => p.id)
  const [recs, convs] = await Promise.all([
    prisma.projectRecord.groupBy({
      by: ['createdByAgentId'],
      where: { createdByAgentId: { in: ids }, deletedAt: null },
      _count: true
    }),
    prisma.agentConversation.groupBy({
      by: ['agentProfileId'],
      where: { agentProfileId: { in: ids }, deletedAt: null },
      _count: true
    })
  ])
  const m = new Map(ids.map(id => [String(id), { recordCount: 0, conversationCount: 0 }]))
  for (const r of recs) m.get(String(r.createdByAgentId)).recordCount = r._count
  for (const c of convs) m.get(String(c.agentProfileId)).conversationCount = c._count
  return m
}

// 列表: 默认自己的; ADMIN 可 all=true 看全员目录
router.get('/', async (req, res) => {
  try {
    const thresholdDays = await getZombieThresholdDays()
    const where = { deletedAt: null }
    if (!(hasRole(req.user, 'ADMIN') && req.query.all === 'true')) {
      where.userId = BigInt(req.user.userId)
    }
    const list = await prisma.agentProfile.findMany({
      where,
      include: { apiKeys: true, user: { select: { id: true, username: true, name: true } } },
      orderBy: [{ status: 'desc' }, { lastActiveAt: 'desc' }] // MySQL desc 时 NULL 自然排最后
    })
    const counts = await attachCounts(list)
    res.json({ code: 0, data: { list: list.map(p => serialize(p, counts.get(String(p.id)), thresholdDays)) } })
  } catch (e) {
    console.error('[agent-profiles:list]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /mine — v2.13.0(#1278) 我的全部机器人(MCP list_my_agent_profiles 数据源)
 * 含已禁用(管理页要能再启用); 注销(-1)是终态不再出现(历史记录仍在库)。
 */
router.get('/mine', async (req, res) => {
  try {
    const thresholdDays = await getZombieThresholdDays()
    const list = await prisma.agentProfile.findMany({
      where: { userId: BigInt(req.user.userId), deletedAt: null, status: { not: AGENT_STATUS.DEREGISTERED } },
      include: { apiKeys: true },
      orderBy: [{ status: 'desc' }, { lastActiveAt: 'desc' }]
    })
    res.json({ code: 0, data: { list: list.map(p => serialize(p, {}, thresholdDays)), zombieThresholdDays: thresholdDays } })
  } catch (e) {
    console.error('[agent-profiles:mine]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /all — v2.13.0(#1278) 全平台档案目录(仅 ADMIN; MCP list_agent_profiles 数据源)
 * Query: status(可逗号多选 1,0,-1) / ownerUserId / lastActiveFrom / lastActiveTo(ISO)
 *        / zombie=true(只看僵尸) / page / page_size; 默认最近活跃最旧的在前(≈僵尸优先)
 */
router.get('/all', async (req, res) => {
  try {
    if (!hasRole(req.user, 'ADMIN')) {
      return res.status(403).json({ code: 1003, message: '仅管理员可查看全平台机器人档案' })
    }
    const thresholdDays = await getZombieThresholdDays()
    const { status = '', ownerUserId = '', lastActiveFrom = '', lastActiveTo = '', zombie = '' } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const size = Math.min(100, Math.max(1, Number(req.query.page_size) || 20))

    const where = { deletedAt: null }
    if (status) {
      const st = String(status).split(',').map(s => parseInt(s, 10)).filter(Number.isFinite)
      if (st.length) where.status = st.length === 1 ? st[0] : { in: st }
    }
    if (ownerUserId) {
      try { where.userId = BigInt(ownerUserId) } catch { return res.status(400).json({ code: 1001, message: 'ownerUserId 不合法' }) }
    }
    if (lastActiveFrom || lastActiveTo) {
      where.lastActiveAt = {}
      if (lastActiveFrom) {
        const d = new Date(lastActiveFrom)
        if (isNaN(d)) return res.status(400).json({ code: 1001, message: 'lastActiveFrom 不是合法时间' })
        where.lastActiveAt.gte = d
      }
      if (lastActiveTo) {
        const d = new Date(lastActiveTo)
        if (isNaN(d)) return res.status(400).json({ code: 1001, message: 'lastActiveTo 不是合法时间' })
        where.lastActiveAt.lte = d
      }
    }

    // 僵尸筛选在内存里判(lastActiveAt 为 NULL 的从未活跃档案按 createdAt 起算, SQL 不好表达),
    // 先取全量 id 分页后过滤会导致页码漂移 —— 僵尸态数据量级小, 全量取回再分页
    const all = await prisma.agentProfile.findMany({
      where,
      include: { apiKeys: true, user: { select: { id: true, username: true, name: true } } },
      orderBy: [{ lastActiveAt: 'asc' }] // 最久没动的在前(僵尸优先); NULL(从未活跃)ASC 时自然排最前
    })
    let rows = all
    if (zombie === 'true') rows = rows.filter(p => isZombie(p, thresholdDays))
    const total = rows.length
    const list = rows.slice((page - 1) * size, page * size).map(p => serialize(p, {}, thresholdDays))
    res.json({ code: 0, data: { list, total, page, page_size: size, zombieThresholdDays: thresholdDays } })
  } catch (e) {
    console.error('[agent-profiles:all]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 注册: 建档 + 发专属 Key, 明文只返回这一次
router.post('/', async (req, res) => {
  try {
    const { name, description, platform, capabilities } = req.body || {}
    if (!name || !String(name).trim()) {
      return res.status(400).json({ code: 1001, message: 'name 必填（给 Agent 起个名, 如「调研助手」）' })
    }
    const profile = await prisma.agentProfile.create({
      data: {
        userId: BigInt(req.user.userId),
        name: String(name).trim().slice(0, 100),
        description: description ? String(description).slice(0, 500) : null,
        platform: PLATFORMS.includes(platform) ? platform : 'OTHER',
        capabilities: capabilities ? String(capabilities).slice(0, 500) : null,
        ...cleanRegistryFields(req.body || {})
      }
    })
    const { raw, hash, prefix } = generateApiKey()
    await prisma.apiKey.create({
      data: {
        userId: BigInt(req.user.userId),
        name: `Agent「${profile.name}」专属`,
        keyHash: hash,
        prefix,
        agentProfileId: profile.id
      }
    })
    res.json({
      code: 0,
      message: 'Agent 注册成功。专属 API Key 明文仅此一次返回，请配置到 Agent 侧妥善保存',
      data: { ...serialize({ ...profile, apiKeys: [] }), keyPrefix: prefix + '...', apiKey: raw }
    })
  } catch (e) {
    console.error('[agent-profiles:create]', e)
    res.status(e.status || 500).json({ code: e.code || 9001, message: e.message })
  }
})

// 编辑: 基本信息 + 启停(status 0/1); 本人或 ADMIN
router.patch('/:id', async (req, res) => {
  try {
    const profile = await findProfile(req.params.id)
    if (!profile) return res.status(404).json({ code: 2004, message: 'Agent 不存在' })
    if (!canManage(req.user, profile)) {
      return res.status(403).json({ code: 1003, message: '只能管理自己的 Agent' })
    }
    const { name, description, platform, capabilities, status } = req.body || {}
    const data = {}
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ code: 1001, message: 'name 不能为空' })
      data.name = String(name).trim().slice(0, 100)
    }
    if (description !== undefined) data.description = description ? String(description).slice(0, 500) : null
    if (platform !== undefined) data.platform = PLATFORMS.includes(platform) ? platform : 'OTHER'
    if (capabilities !== undefined) data.capabilities = capabilities ? String(capabilities).slice(0, 500) : null
    if (status !== undefined) data.status = status === 0 ? 0 : 1 // 停用即 Key 失效(resolveApiKey 拦截)
    Object.assign(data, cleanRegistryFields(req.body || {})) // #1282 注册字段
    const updated = await prisma.agentProfile.update({ where: { id: profile.id }, data })
    res.json({ code: 0, message: '已更新', data: serialize({ ...updated, apiKeys: profile.apiKeys, user: profile.user }) })
  } catch (e) {
    console.error('[agent-profiles:update]', e)
    res.status(e.status || 500).json({ code: e.code || 9001, message: e.message })
  }
})

// 换 Key: 旧 Key 全部吊销, 发新 Key(泄露应急/例行轮换)
router.post('/:id/rotate-key', async (req, res) => {
  try {
    const profile = await findProfile(req.params.id)
    if (!profile) return res.status(404).json({ code: 2004, message: 'Agent 不存在' })
    if (!canManage(req.user, profile)) {
      return res.status(403).json({ code: 1003, message: '只能管理自己的 Agent' })
    }
    await prisma.apiKey.updateMany({
      where: { agentProfileId: profile.id, status: 1 },
      data: { status: 0, revokedAt: new Date() }
    })
    const { raw, hash, prefix } = generateApiKey()
    await prisma.apiKey.create({
      data: {
        userId: profile.userId,
        name: `Agent「${profile.name}」专属`,
        keyHash: hash,
        prefix,
        agentProfileId: profile.id
      }
    })
    res.json({
      code: 0,
      message: '已换发新 Key，旧 Key 即刻失效。明文仅此一次返回',
      data: { id: profile.id, keyPrefix: prefix + '...', apiKey: raw }
    })
  } catch (e) {
    console.error('[agent-profiles:rotate]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 活动流水: 该 Agent 经 MCP 干了什么(审计); 本人或 ADMIN
router.get('/:id/activities', async (req, res) => {
  try {
    const profile = await findProfile(req.params.id)
    if (!profile) return res.status(404).json({ code: 2004, message: 'Agent 不存在' })
    if (!canManage(req.user, profile)) {
      return res.status(403).json({ code: 1003, message: '只能查看自己的 Agent' })
    }
    const { page = 1, page_size = 20 } = req.query
    const skip = (Number(page) - 1) * Number(page_size)
    const [list, total] = await Promise.all([
      prisma.agentActivityLog.findMany({
        where: { agentProfileId: profile.id },
        orderBy: { ts: 'desc' },
        skip,
        take: Number(page_size)
      }),
      prisma.agentActivityLog.count({ where: { agentProfileId: profile.id } })
    ])
    res.json({ code: 0, data: { list, total, page: Number(page), page_size: Number(page_size) } })
  } catch (e) {
    console.error('[agent-profiles:activities]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ============ v2.13.0(#1279) 生命周期写接口 ============
// 禁用/启用/注销。Key 即时失效原理: resolveApiKey 对 agent.status!==1 直接拒(401),
// 不需要物理吊销 Key —— enable 恢复 status=1 后原 Key 立即可用。

/** 运行中阻断检查: 进行中的派工运行 / 30 分钟内有巡检心跳 → 返回阻断原因文案, 可操作返回 null */
async function runningBlockReason(profileId) {
  const [running, beat] = await Promise.all([
    prisma.devRun.findFirst({
      where: { agentProfileId: profileId, status: 'RUNNING' },
      select: { id: true, taskId: true }
    }),
    prisma.agentPresence.findFirst({
      where: { agentProfileId: profileId, status: { not: 'OFFLINE' }, lastBeatAt: { gte: new Date(Date.now() - 30 * 60000) } },
      select: { lastBeatAt: true }
    })
  ])
  if (running) return `该机器人有进行中的运行(devRun #${running.id}), 先等它完成或取消运行再禁用`
  if (beat) return '该机器人 30 分钟内有巡检心跳(可能正在巡检), 确认它已停下再操作'
  return null
}

/** POST /:id/disable — 禁用(status→0): 可逆; 运行中阻断; owner 或 ADMIN */
router.post('/:id/disable', async (req, res) => {
  try {
    const profile = await findProfile(req.params.id)
    if (!profile) return res.status(404).json({ code: 2004, message: '档案不存在' })
    if (!canManage(req.user, profile)) return res.status(403).json({ code: 1003, message: '只有档案主人或管理员可以禁用' })
    if (profile.status === AGENT_STATUS.DISABLED) return res.status(400).json({ code: 9003, message: '该档案已是禁用状态' })
    if (profile.status === AGENT_STATUS.DEREGISTERED) return res.status(400).json({ code: 9003, message: '已注销的档案不能操作' })
    const block = await runningBlockReason(profile.id)
    if (block) return res.status(409).json({ code: 9020, message: block })
    const updated = await prisma.agentProfile.update({
      where: { id: profile.id },
      data: { status: AGENT_STATUS.DISABLED, disabledAt: new Date(), disabledBy: BigInt(req.user.userId) }
    })
    // #1280 审计留痕(fire-and-forget)
    await writeAgentAudit({ agentProfileId: profile.id, profileName: profile.name, action: 'DISABLE',
      operatorId: req.user.userId, operatorName: req.user.username || req.user.name || `用户${req.user.userId}`, reason: req.body?.reason }).catch(() => {})
    res.json({ code: 0, message: '已禁用，其 API Key 即时失效(下次调用即 401)', data: { id: String(updated.id), status: updated.status } })
  } catch (e) {
    console.error('[agent-profiles:disable]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/** POST /:id/enable — 启用(status→1): 仅禁用态可启用; owner 或 ADMIN */
router.post('/:id/enable', async (req, res) => {
  try {
    const profile = await findProfile(req.params.id)
    if (!profile) return res.status(404).json({ code: 2004, message: '档案不存在' })
    if (!canManage(req.user, profile)) return res.status(403).json({ code: 1003, message: '只有档案主人或管理员可以启用' })
    if (profile.status !== AGENT_STATUS.DISABLED) {
      return res.status(400).json({ code: 9003, message: `只有已禁用的档案能启用(当前 ${AGENT_STATUS_LABELS[profile.status] || profile.status})` })
    }
    const updated = await prisma.agentProfile.update({
      where: { id: profile.id },
      data: { status: AGENT_STATUS.ACTIVE, disabledAt: null, disabledBy: null }
    })
    await writeAgentAudit({ agentProfileId: profile.id, profileName: profile.name, action: 'ENABLE',
      operatorId: req.user.userId, operatorName: req.user.username || req.user.name || `用户${req.user.userId}`, reason: req.body?.reason }).catch(() => {})
    res.json({ code: 0, message: '已启用，原 API Key 立即恢复可用', data: { id: String(updated.id), status: updated.status } })
  } catch (e) {
    console.error('[agent-profiles:enable]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/** POST /:id/deregister — 注销(status→-1): 终态; 二次确认 confirmName 须与档案名一致; owner 或 ADMIN */
router.post('/:id/deregister', async (req, res) => {
  try {
    const profile = await findProfile(req.params.id)
    if (!profile) return res.status(404).json({ code: 2004, message: '档案不存在' })
    if (!canManage(req.user, profile)) return res.status(403).json({ code: 1003, message: '只有档案主人或管理员可以注销' })
    if (profile.status === AGENT_STATUS.DEREGISTERED) return res.status(400).json({ code: 9003, message: '该档案已注销' })
    const confirmName = String(req.body?.confirmName || '').trim()
    if (confirmName !== profile.name) {
      return res.status(400).json({ code: 9021, message: `二次确认失败: confirmName 必须与档案名完全一致(「${profile.name}」), 档案状态未变` })
    }
    const block = await runningBlockReason(profile.id)
    if (block) return res.status(409).json({ code: 9020, message: block })
    const updated = await prisma.agentProfile.update({
      where: { id: profile.id },
      data: { status: AGENT_STATUS.DEREGISTERED, deregisteredAt: new Date() }
    })
    // 注销是终态: 物理吊销名下全部 Key(干净); 历史记录(运行/心跳/沉淀)原样保留
    await prisma.apiKey.updateMany({
      where: { agentProfileId: profile.id, status: 1 },
      data: { status: 0, revokedAt: new Date() }
    })
    await writeAgentAudit({ agentProfileId: profile.id, profileName: profile.name, action: 'DEREGISTER',
      operatorId: req.user.userId, operatorName: req.user.username || req.user.name || `用户${req.user.userId}`, reason: req.body?.reason }).catch(() => {})
    res.json({ code: 0, message: '已注销(终态)：档案不再出现在任何列表, 历史记录保留', data: { id: String(updated.id), status: updated.status } })
  } catch (e) {
    console.error('[agent-profiles:deregister]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

/**
 * GET /audits — v2.13.0(#1280) 生命周期审计查询(仅 ADMIN)
 * Query: agentProfileId / operatorId / from / to(ISO) + 分页, 时间倒序
 */
router.get('/audits', async (req, res) => {
  try {
    if (!hasRole(req.user, 'ADMIN')) {
      return res.status(403).json({ code: 1003, message: '仅管理员可查看生命周期审计日志' })
    }
    const { agentProfileId = '', operatorId = '', from = '', to = '' } = req.query
    const page = Math.max(1, Number(req.query.page) || 1)
    const size = Math.min(100, Math.max(1, Number(req.query.page_size) || 20))
    const where = {}
    if (agentProfileId) {
      try { where.agentProfileId = BigInt(agentProfileId) } catch { return res.status(400).json({ code: 1001, message: 'agentProfileId 不合法' }) }
    }
    if (operatorId) {
      try { where.operatorId = BigInt(operatorId) } catch { return res.status(400).json({ code: 1001, message: 'operatorId 不合法' }) }
    }
    if (from || to) {
      where.createdAt = {}
      if (from) { const d = new Date(from); if (isNaN(d)) return res.status(400).json({ code: 1001, message: 'from 不是合法时间' }); where.createdAt.gte = d }
      if (to) { const d = new Date(to); if (isNaN(d)) return res.status(400).json({ code: 1001, message: 'to 不是合法时间' }); where.createdAt.lte = d }
    }
    const [rows, total] = await Promise.all([
      prisma.agentProfileAudit.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * size, take: size }),
      prisma.agentProfileAudit.count({ where })
    ])
    res.json({
      code: 0, data: {
        list: rows.map(r => ({ ...r, id: String(r.id), agentProfileId: String(r.agentProfileId), operatorId: String(r.operatorId) })),
        total, page, page_size: size
      }
    })
  } catch (e) {
    console.error('[agent-profiles:audits]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})


/**
 * POST /batch-disable { agentProfileIds: [..], reason? } — v2.13.0(#1283) 批量禁用
 * 仅 ADMIN; 只做禁用(注销必须逐个); 逐条运行阻断校验并逐条给结果; 逐条审计。
 */
router.post('/batch-disable', async (req, res) => {
  try {
    if (!hasRole(req.user, 'ADMIN')) return res.status(403).json({ code: 1003, message: '仅管理员可批量禁用' })
    const raw = req.body?.agentProfileIds
    if (!Array.isArray(raw) || !raw.length) return res.status(400).json({ code: 9002, message: 'agentProfileIds 不能为空' })
    const ids = [...new Set(raw.map(v => { try { return BigInt(v) } catch { return null } }).filter(Boolean))].slice(0, 100)
    let disabled = 0
    const failed = []
    for (const id of ids) {
      const profile = await prisma.agentProfile.findFirst({ where: { id, deletedAt: null } })
      if (!profile) { failed.push({ id: String(id), name: null, reason: '档案不存在' }); continue }
      if (profile.status === AGENT_STATUS.DISABLED) { failed.push({ id: String(id), name: profile.name, reason: '已是禁用状态' }); continue }
      if (profile.status === AGENT_STATUS.DEREGISTERED) { failed.push({ id: String(id), name: profile.name, reason: '已注销' }); continue }
      const block = await runningBlockReason(profile.id)
      if (block) { failed.push({ id: String(id), name: profile.name, reason: block }); continue }
      await prisma.agentProfile.update({
        where: { id: profile.id },
        data: { status: AGENT_STATUS.DISABLED, disabledAt: new Date(), disabledBy: BigInt(req.user.userId) }
      })
      await writeAgentAudit({ agentProfileId: profile.id, profileName: profile.name, action: 'BATCH_DISABLE',
        operatorId: req.user.userId, operatorName: req.user.username || `用户${req.user.userId}`, reason: req.body?.reason || '批量清理' }).catch(() => {})
      disabled++
    }
    res.json({ code: 0, data: { disabled, failed, total: ids.length } })
  } catch (e) {
    console.error('[agent-profiles:batch-disable]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// 删除(软删): 连带吊销 Key; 本人或 ADMIN
router.delete('/:id', async (req, res) => {
  try {
    const profile = await findProfile(req.params.id)
    if (!profile) return res.status(404).json({ code: 2004, message: 'Agent 不存在' })
    if (!canManage(req.user, profile)) {
      return res.status(403).json({ code: 1003, message: '只能删除自己的 Agent' })
    }
    await prisma.apiKey.updateMany({
      where: { agentProfileId: profile.id, status: 1 },
      data: { status: 0, revokedAt: new Date() }
    })
    await prisma.agentProfile.update({ where: { id: profile.id }, data: { deletedAt: new Date(), status: 0 } })
    res.json({ code: 0, message: '已删除，专属 Key 已一并吊销' })
  } catch (e) {
    console.error('[agent-profiles:delete]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
