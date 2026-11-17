// AI 助手(全局抽屉): 能查、能出草稿、能总结
//   GET    /api/fde/assistant/status                 能不能用、当前用的模型(名称 + 来源)
//   POST   /api/fde/assistant/chat                   { conversationId?, message } → 助手回复 + 本轮草稿
//   GET    /api/fde/assistant/conversations          我的助手会话(复用 agent_conversations, source=ASSISTANT)
//   GET    /api/fde/assistant/conversations/:id      会话消息 + 每条消息产出的草稿(含状态)
//   DELETE /api/fde/assistant/conversations/:id      删除自己的会话(软删)
//   GET    /api/fde/assistant/drafts/:id             草稿当前状态
//   POST   /api/fde/assistant/drafts/:id/confirm     { payload? } 人确认 → 代用户调正常业务接口落库
//   POST   /api/fde/assistant/drafts/:id/discard     丢弃(留记录)
//
// 三条底线(照集团财务的录入助手):
//   1. 助手不直接写库: 写类工具只出草稿, 人点「确认」才落库, 且走的是页面按钮同一个接口(权限与校验一致)
//   2. 工具即接口: 工具以当前用户身份调本系统接口(selfApi), 权限按该用户收敛
//   3. 每次调用都留痕: 对话 / 每个工具调用 / 确认 / 丢弃都写 audit_logs(action 以 ai. 开头); 使用数据带 via: 'ai'
import express from 'express'
import prisma from '../../lib/prisma.js'
import { internalAuth, hasPermission, getRoleName } from '../../lib/auth.js'
import { logInternalAction } from '../../lib/audit.js'
import { track } from '../../lib/usage.js'
import { chatWithTools, getActiveLlmConfig, sourceOf, LlmNotConfiguredError } from '../../lib/llm.js'
import { makeSelfApi } from '../../services/assistant/selfApi.js'
import { TOOLS, TOOL_NAMES, toolsFor, toOpenAI } from '../../services/assistant/tools.js'
import { buildDraft, makeLookup, normalizeForSubmit, submitSpec, draftView, draftToolResult, KIND_PERM, KIND_LABEL, FIELD_LABEL } from '../../services/assistant/drafts.js'
import { runConversation, MAX_TOOL_ROUNDS } from '../../services/assistant/chat.js'
import { stubEnabled, stubLLM } from '../../services/assistant/stub.js'
import { fmt, weekRange, businessDay, weekdayCn } from '../../services/assistant/dates.js'

const router = express.Router()
router.use(internalAuth)

const SOURCE = 'ASSISTANT'
const MAX_DRAFTS_PER_TURN = 10
const HISTORY_LIMIT = 20
const STATUS_LABEL = { PENDING: '待确认', SUBMITTED: '已创建', DISCARDED: '已丢弃' }

const uid = (req) => BigInt(req.user.userId ?? req.user.id)
const isId = (v) => /^[1-9]\d{0,17}$/.test(String(v ?? ''))
const fail = (res, status, code, message) => res.status(status).json({ code, message })

/** 当前可用的模型: { available, model?, reason? } */
async function availability() {
  if (stubEnabled()) return { available: true, stub: true, model: { name: 'STUB（本地测试）', model: 'stub', source: 'stub' } }
  try {
    const cfg = await getActiveLlmConfig()
    return { available: true, config: cfg, model: { name: cfg.name, model: cfg.model || null, source: sourceOf(cfg) } }
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) return { available: false, reason: e.message }
    throw e
  }
}

router.get('/status', async (req, res) => {
  try {
    const a = await availability()
    const tools = toolsFor(req.user)
    res.json({
      code: 0,
      data: {
        available: a.available, reason: a.reason || null, stub: !!a.stub, model: a.model || null,
        tools: tools.map((t) => ({ name: t.name, kind: t.kind })), maxToolRounds: MAX_TOOL_ROUNDS
      }
    })
  } catch (e) {
    console.error('[assistant status]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

function systemPrompt(me, today) {
  const wk = weekRange(today, 0)
  return [
    '你是本系统（工程交付管理：项目、任务、需求、工时、知识库）里的 AI 助手，帮用户查询、录入和总结。',
    `今天是 ${fmt(today)}（周${weekdayCn(today)}），本周是 ${wk.from} ~ ${wk.to}。当前用户：${me.name}（${getRoleName(me.role)}）。`,
    '',
    '规则：',
    '1. 读数据只能通过工具；新建任务、需求、工时、评论只能调 draft_* 生成草稿——草稿要用户在界面上核对并点「确认」才会保存。绝不能说「已创建」「已保存」「已提交」，要说「草稿已生成，请核对后点确认」。',
    '2. 不知道就查，不要编造项目、任务、人名、日期和数字。项目名对不上时先调 list_my_projects，或请用户在候选里选。',
    '3. 必填信息缺了，也先调草稿工具把已知的填上，再用一句话问用户缺什么；不要猜。',
    '4. 日期直接把用户原话（如「周五」「下周三」「11/20」）传给工具，工具会换算；不需要你自己算。',
    '5. 总结类问题（周报、项目健康度）先调对应工具拿事实，再按工具返回的 format 写，只用返回的事实。',
    '6. 一次可以调多个工具；一句话里有几件事就出几张草稿。',
    '7. 你不能审批、删除或修改已有数据；用户要求这些时，告诉他到对应页面操作。',
    '8. 用中文回答，简洁，多用短列表；不要输出 JSON，不要把草稿卡片上的字段再完整复述一遍。'
  ].join('\n')
}

/** 会话历史 → 模型消息(只有 user / assistant 文本); 助手消息后附上它产出的草稿及现状, 让模型知道哪些已确认 */
async function loadHistory(conversationId) {
  const msgs = await prisma.agentMessage.findMany({ where: { conversationId }, orderBy: { id: 'desc' }, take: HISTORY_LIMIT })
  msgs.reverse()
  const drafts = await prisma.assistantDraft.findMany({ where: { conversationId, messageId: { in: msgs.map((m) => m.id) } } })
  return msgs.map((m) => {
    if (m.role === 'USER') return { role: 'user', content: m.text }
    const mine = drafts.filter((d) => d.messageId === m.id)
    const note = mine.length
      ? '\n' + mine.map((d) => `[草稿#${d.id} ${KIND_LABEL[d.kind]}「${d.payload.title || d.payload.workContent || d.payload.content || ''}」：${STATUS_LABEL[d.status]}${d.resultId ? ` #${d.resultId}` : ''}]`).join('\n')
      : ''
    return { role: 'assistant', content: (m.text || '') + note }
  })
}

router.post('/chat', async (req, res) => {
  const text = String(req.body?.message ?? '').trim()
  if (!text) return fail(res, 400, 9002, '请输入要说的话')
  if (text.length > 4000) return fail(res, 400, 9002, '一次最多 4000 字，请分开说')
  try {
    const avail = await availability()
    if (!avail.available) {
      await logInternalAction(req, 'ai.chat.unavailable', { resourceType: 'assistant', details: { reason: avail.reason } })
      return fail(res, 503, 4101, avail.reason)
    }

    // 会话: 续写自己的, 或新建
    let conv
    if (req.body?.conversationId) {
      if (!isId(req.body.conversationId)) return fail(res, 400, 9002, 'conversationId 不合法')
      conv = await prisma.agentConversation.findFirst({ where: { id: BigInt(req.body.conversationId), userId: uid(req), source: SOURCE, deletedAt: null } })
      if (!conv) return fail(res, 404, 9004, '会话不存在或已删除')
    } else {
      conv = await prisma.agentConversation.create({ data: { userId: uid(req), source: SOURCE, title: text.slice(0, 30) } })
    }
    const userMsg = await prisma.agentMessage.create({ data: { conversationId: conv.id, role: 'USER', text } })

    const me = await prisma.user.findUnique({ where: { id: uid(req) }, select: { name: true } })
    const today = businessDay(new Date())   // 北京时间的今天
    const api = makeSelfApi(req.user)
    const lookup = makeLookup(api, req.user)
    const allowed = toolsFor(req.user)
    const allowedNames = new Set(allowed.map((t) => t.name))
    const drafts = []

    const ctx = {
      api, lookup, user: req.user, today,
      async addDraft(kind, args) {
        if (drafts.length >= MAX_DRAFTS_PER_TURN) return { error: `一次最多生成 ${MAX_DRAFTS_PER_TURN} 张草稿，其余请分开说` }
        const d = await buildDraft(kind, args, { api, lookup, today })
        drafts.push(d)
        return draftToolResult(d)
      }
    }

    // 每个工具调用都留痕(只记工具名、是否成功、耗时; 不记参数原文和返回内容)
    async function execTool(name, args) {
      const known = TOOL_NAMES.has(name)
      if (!allowedNames.has(name)) {
        await logInternalAction(req, 'ai.tool.denied', { resourceType: 'assistant', resourceId: conv.id, details: { tool: known ? name : '(unknown)', role: req.user.role } })
        return { error: known ? `当前用户（${getRoleName(req.user.role)}）没有使用「${name}」的权限` : `没有工具 ${String(name).slice(0, 40)}` }
      }
      const tool = TOOLS.find((t) => t.name === name)
      const started = Date.now()
      let out
      try { out = await tool.run(args, ctx) } catch (e) { out = { error: e.message || String(e) } }
      await logInternalAction(req, 'ai.tool', { resourceType: 'assistant', resourceId: conv.id, details: { tool: name, kind: tool.kind, ok: !out?.error, ms: Date.now() - started } })
      return out
    }

    const llm = avail.stub
      ? (r) => stubLLM(r)
      : (r) => chatWithTools({ ...r, config: avail.config, timeoutMs: Math.min(r.timeoutMs, 90_000) })

    let result
    let errorText = null
    try {
      result = await runConversation({
        llm,
        system: systemPrompt({ name: me?.name || req.user.username, role: req.user.role }, today),
        history: await loadHistory(conv.id),
        tools: toOpenAI(allowed),
        execTool
      })
    } catch (e) {
      if (e instanceof LlmNotConfiguredError) {
        await logInternalAction(req, 'ai.chat.unavailable', { resourceType: 'assistant', resourceId: conv.id, details: { reason: e.message } })
        return fail(res, 503, 4101, e.message)
      }
      console.error('[assistant chat]', e.message)
      errorText = String(e.message || e).slice(0, 300)
      result = { reply: `助手这次没能完成：${errorText}${drafts.length ? '\n已生成的草稿仍可使用。' : ''}`, rounds: 0, calls: [], stopped: 'error' }
    }

    const reply = result.reply || (drafts.length ? '草稿已生成，请核对后点「确认」。' : '（没有内容）')
    const botMsg = await prisma.agentMessage.create({ data: { conversationId: conv.id, role: 'ASSISTANT', text: reply } })
    const saved = []
    for (const d of drafts) {
      saved.push(await prisma.assistantDraft.create({
        data: { userId: uid(req), conversationId: conv.id, messageId: botMsg.id, kind: d.kind, payload: d.payload, labels: d.labels, missing: d.missing }
      }))
    }
    await prisma.agentConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } })

    await logInternalAction(req, 'ai.chat', {
      resourceType: 'assistant', resourceId: conv.id,
      details: {
        model: avail.model?.model || avail.model?.name, source: avail.model?.source,
        tools: result.calls.map((c) => c.name), rounds: result.rounds, stopped: result.stopped,
        drafts: saved.map((d) => ({ id: String(d.id), kind: d.kind })), ...(errorText ? { error: errorText } : {})
      }
    })
    track(req.user.userId ?? req.user.id, 'assistant.chat', { via: 'ai', tools: result.calls.length, drafts: saved.length }).catch(() => {})

    res.json({
      code: 0,
      data: {
        conversationId: String(conv.id),
        userMessage: { id: String(userMsg.id), role: 'USER', text, ts: userMsg.ts },
        message: { id: String(botMsg.id), role: 'ASSISTANT', text: reply, ts: botMsg.ts, drafts: saved.map(draftView) },
        toolCalls: result.calls,
        rounds: result.rounds,
        stopped: result.stopped,
        model: avail.model
      }
    })
  } catch (e) {
    console.error('[assistant chat]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ---------- 会话 ----------

router.get('/conversations', async (req, res) => {
  try {
    const list = await prisma.agentConversation.findMany({
      where: { userId: uid(req), source: SOURCE, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 30, 100),
      include: { _count: { select: { messages: true } } }
    })
    res.json({ code: 0, data: { list: list.map((c) => ({ id: String(c.id), title: c.title || '', updatedAt: c.updatedAt, messageCount: c._count.messages })) } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

async function ownConversation(req) {
  if (!isId(req.params.id)) return null
  return prisma.agentConversation.findFirst({ where: { id: BigInt(req.params.id), userId: uid(req), source: SOURCE, deletedAt: null } })
}

router.get('/conversations/:id', async (req, res) => {
  try {
    const conv = await ownConversation(req)
    if (!conv) return fail(res, 404, 9004, '会话不存在或已删除')
    const [messages, drafts] = await Promise.all([
      prisma.agentMessage.findMany({ where: { conversationId: conv.id }, orderBy: { id: 'asc' }, take: 200 }),
      prisma.assistantDraft.findMany({ where: { conversationId: conv.id, userId: uid(req) }, orderBy: { id: 'asc' } })
    ])
    res.json({
      code: 0,
      data: {
        id: String(conv.id), title: conv.title || '',
        messages: messages.map((m) => ({
          id: String(m.id), role: m.role, text: m.text, ts: m.ts,
          drafts: drafts.filter((d) => d.messageId === m.id).map(draftView)
        }))
      }
    })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.delete('/conversations/:id', async (req, res) => {
  try {
    const conv = await ownConversation(req)
    if (!conv) return fail(res, 404, 9004, '会话不存在或已删除')
    await prisma.agentConversation.update({ where: { id: conv.id }, data: { deletedAt: new Date() } })
    await logInternalAction(req, 'ai.conversation.delete', { resourceType: 'assistant', resourceId: conv.id })
    res.json({ code: 0, data: { ok: true } })
  } catch (e) {
    res.status(500).json({ code: 9001, message: e.message })
  }
})

// ---------- 草稿 ----------

async function ownDraft(req) {
  if (!isId(req.params.id)) return null
  return prisma.assistantDraft.findFirst({ where: { id: BigInt(req.params.id), userId: uid(req) } })
}

router.get('/drafts/:id', async (req, res) => {
  const d = await ownDraft(req)
  if (!d) return fail(res, 404, 9004, '草稿不存在')
  res.json({ code: 0, data: draftView(d) })
})

const LOCK_TTL_MS = 60_000

router.post('/drafts/:id/confirm', async (req, res) => {
  try {
    const d = await ownDraft(req)
    if (!d) return fail(res, 404, 9004, '草稿不存在')
    // 已经确认过: 幂等返回第一次的结果, 不会重复落库
    if (d.status === 'SUBMITTED') return res.json({ code: 0, data: { ...draftView(d), duplicate: true } })
    if (d.status === 'DISCARDED') return fail(res, 400, 9002, '这张草稿已丢弃，请让助手重新生成')
    const perm = KIND_PERM[d.kind]
    if (perm && !hasPermission(req.user, perm)) return fail(res, 403, 1003, `缺少权限 ${perm}，不能创建${KIND_LABEL[d.kind]}`)

    // 草稿锁: 同一张草稿并发确认(双击)只放一个过去
    const now = new Date()
    const lock = await prisma.assistantDraft.updateMany({
      where: { id: d.id, status: 'PENDING', OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_TTL_MS) } }] },
      data: { lockedAt: now }
    })
    if (lock.count !== 1) return fail(res, 409, 9002, '这张草稿正在提交，请稍候刷新')
    const unlock = (data = {}) => prisma.assistantDraft.update({ where: { id: d.id }, data: { lockedAt: null, ...data } })

    try {
      const api = makeSelfApi(req.user)
      const lookup = makeLookup(api, req.user)
      const n = await normalizeForSubmit(d.kind, d.payload, req.body?.payload, { lookup })
      if (n.error) { await unlock({ lastError: n.error }); return fail(res, 400, 9002, n.error) }
      if (n.missing.length) {
        const msg = `还缺：${n.missing.map((k) => FIELD_LABEL[k] || k).join('、')}`
        await unlock({ lastError: msg })
        return fail(res, 400, 9002, msg)
      }
      const spec = submitSpec(d.kind, n.payload)
      // 走正常业务接口: 与页面按钮同一个, 权限、校验、通知、活动流都照旧
      const r = await api(spec.method, spec.path, { body: spec.body })
      if (r.code !== 0) {
        const msg = String(r.message || `HTTP ${r.status}`).slice(0, 500)
        await unlock({ payload: n.payload, lastError: msg })
        await logInternalAction(req, 'ai.draft.confirm_failed', { resourceType: 'assistant_draft', resourceId: d.id, details: { kind: d.kind, status: r.status, code: r.code, message: msg } })
        // 业务错误原文透传给界面(如「项目已关闭，不能再建任务」)
        return res.status(r.status >= 400 ? r.status : 400).json({ code: r.code ?? 9002, message: msg })
      }
      const resultId = r.data?.id != null ? String(r.data.id) : null
      const updated = await unlock({ status: 'SUBMITTED', payload: n.payload, resultId, lastError: null, submittedAt: new Date() })
      await logInternalAction(req, 'ai.draft.confirm', { resourceType: 'assistant_draft', resourceId: d.id, details: { kind: d.kind, resultId, edited: !!req.body?.payload } })
      track(req.user.userId ?? req.user.id, 'assistant.draft.confirm', { via: 'ai', kind: d.kind }).catch(() => {})
      res.json({ code: 0, data: { ...draftView(updated), duplicate: false } })
    } catch (e) {
      await unlock().catch(() => {})
      throw e
    }
  } catch (e) {
    console.error('[assistant confirm]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

router.post('/drafts/:id/discard', async (req, res) => {
  try {
    const d = await ownDraft(req)
    if (!d) return fail(res, 404, 9004, '草稿不存在')
    if (d.status === 'SUBMITTED') return fail(res, 400, 9002, '已经创建的草稿不能丢弃，请到对应页面修改或删除')
    if (d.status === 'DISCARDED') return res.json({ code: 0, data: draftView(d) })
    const r = await prisma.assistantDraft.updateMany({ where: { id: d.id, status: 'PENDING', lockedAt: null }, data: { status: 'DISCARDED', discardedAt: new Date() } })
    if (r.count !== 1) return fail(res, 409, 9002, '这张草稿正在提交，不能丢弃')
    const reason = String(req.body?.reason || '').slice(0, 200) || null
    await logInternalAction(req, 'ai.draft.discard', { resourceType: 'assistant_draft', resourceId: d.id, details: { kind: d.kind, reason } })
    track(req.user.userId ?? req.user.id, 'assistant.draft.discard', { via: 'ai', kind: d.kind }).catch(() => {})
    res.json({ code: 0, data: draftView(await prisma.assistantDraft.findUnique({ where: { id: d.id } })) })
  } catch (e) {
    console.error('[assistant discard]', e)
    res.status(500).json({ code: 9001, message: e.message })
  }
})

export default router
