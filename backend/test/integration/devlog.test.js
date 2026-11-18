// 集成测试 - 0.5.0 开发会话回流(/api/devlog、/api/dev、/api/projects/:id/timeline、/api/experience)
// 覆盖: uid 幂等 upsert、正文脱敏、列表默认不带正文、link → LINKED + 审计、时间线按阶段分组、
//       经验沉淀、数据范围(工程师只看自己的)、API Key 上报、单条失败不影响其它条、规则摘要降级、粘贴通道、平台助手落库。
// 平台助手那条要求后端以 FDE_LLM_STUB=1 启动(与 assistant.test.js 一致)。账号 / 项目现建现删
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { generateApiKey } from '../../src/lib/apiKey.js'
import { login, api, request, uniqName, createTestUser } from './helpers.js'

describe('开发会话回流 devlog', () => {
  let admin, E, e, O, o, customerId, projectId, engineerId
  const RUN = `ut${Date.now().toString(36)}`
  const uidOf = (s) => `${RUN}-${s}`
  const extraConvIds = []
  let keyId

  const report = (who, conversations) => who.post('/api/devlog/conversations', { conversations })
  const rowsOf = (uid) => prisma.devConversation.findMany({ where: { uid } })

  before(async () => {
    admin = api(await login('admin'))
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-会话工程师' })
    O = await createTestUser('FDE_ENGINEER', { name: 'unit-test-会话旁人' })
    e = api(E.token); o = api(O.token)
    engineerId = String((await prisma.engineer.findUnique({ where: { userId: BigInt(E.id) } })).id)
    const c = await admin.post('/api/fde/customers', { name: uniqName('会话客户'), industry: 'X' })
    assert.equal(c.code, 0, c.message)
    customerId = c.data.id
    const p = await admin.post('/api/fde/projects', { name: uniqName('会话项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    const m = await admin.post(`/api/fde/projects/${projectId}/members`, { userId: E.id, roleInProject: 'DEV' })
    assert.equal(m.code, 0, m.message)
  })

  after(async () => {
    const convs = await prisma.devConversation.findMany({
      where: { OR: [{ uid: { startsWith: RUN } }, { id: { in: extraConvIds } }, { createdBy: { in: [BigInt(E?.id || 0), BigInt(O?.id || 0)] } }] },
      select: { id: true, uid: true }
    })
    const ids = convs.map((c) => c.id)
    await prisma.devExperience.deleteMany({ where: { conversationId: { in: ids } } })
    await prisma.devConversation.deleteMany({ where: { id: { in: ids } } })   // 事件随级联删
    const paConv = convs.filter((c) => c.uid.startsWith('pa_')).map((c) => BigInt(c.uid.slice(3)))
    if (paConv.length) {
      await prisma.assistantDraft.deleteMany({ where: { conversationId: { in: paConv } } })
      await prisma.agentMessage.deleteMany({ where: { conversationId: { in: paConv } } })
      await prisma.agentConversation.deleteMany({ where: { id: { in: paConv } } })
    }
    if (keyId) await prisma.apiKey.delete({ where: { id: keyId } }).catch(() => {})
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await E?.cleanup(); await O?.cleanup()
  })

  test('上报按 uid 幂等: 重复上报不新增行, 只更新非空字段', async () => {
    const uid = uidOf('idem')
    const r1 = await report(e, [{
      uid, source: 'CLAUDE_CODE', stage: 'CODING', model: 'opus', title: '第一次标题', branch: 'feat/x', turns: 3,
      body: [{ role: 'user', content: '帮我改 src/a.js' }],
      events: [{ seq: 1, kind: 'DECISION', text: '用 upsert' }]
    }])
    assert.equal(r1.status, 201, r1.message)
    assert.deepEqual([r1.data.created, r1.data.updated, r1.data.errors.length], [1, 0, 0])
    assert.equal((await rowsOf(uid)).length, 1)

    const r2 = await report(e, [{ uid, title: '第二次标题', summary: '补了摘要', branch: null, events: [{ seq: 1, kind: 'DECISION', text: '改成 upsert by uid' }, { seq: 2, kind: 'PITFALL', text: 'json 限额 100kb' }] }])
    assert.equal(r2.status, 200, r2.message)
    assert.deepEqual([r2.data.created, r2.data.updated], [0, 1])
    assert.equal(r2.data.items[0].id, r1.data.items[0].id)
    const rows = await rowsOf(uid)
    assert.equal(rows.length, 1, '同 uid 再上报行数仍为 1')
    assert.equal(rows[0].title, '第二次标题')
    assert.equal(rows[0].summary, '补了摘要')
    assert.equal(rows[0].branch, 'feat/x', '空字段不覆盖')
    assert.equal(rows[0].model, 'opus')
    assert.equal(rows[0].turns, 3)
    assert.equal(String(rows[0].engineerId), engineerId, '工程师上报自动记成本人')
    const ev = await prisma.devConversationEvent.findMany({ where: { conversationId: rows[0].id }, orderBy: { seq: 'asc' } })
    assert.deepEqual(ev.map((x) => [x.seq, x.text]), [[1, '改成 upsert by uid'], [2, 'json 限额 100kb']])
  })

  test('正文脱敏: sk-/password= 入库前替换为 [REDACTED], 其余原文保留', async () => {
    const uid = uidOf('redact')
    const long = '很长的正文'.repeat(5000)
    const r = await report(e, [{
      uid, source: 'CODEX',
      body: [
        { role: 'user', content: '我的 key 是 sk-abc123，数据库 password=hunter2 别外传' },
        { role: 'assistant', content: long }
      ]
    }])
    assert.equal(r.code, 0, r.message)
    const raw = await prisma.$queryRaw`SELECT body, body_redacted FROM dev_conversations WHERE uid = ${uid}`
    const text = typeof raw[0].body === 'string' ? raw[0].body : JSON.stringify(raw[0].body)
    assert.ok(!text.includes('sk-abc123') && !text.includes('hunter2'), text.slice(0, 200))
    assert.ok(text.includes('[REDACTED]'))
    assert.ok(text.includes('我的 key 是') && text.includes('别外传'), '其余原文保留')
    assert.equal(Number(raw[0].body_redacted), 1)
    const body = (await rowsOf(uid))[0].body
    assert.equal(body[1].content.length, long.length, '正文不截断')
    assert.equal(body[0].content, '我的 key 是 [REDACTED]，数据库 password=[REDACTED] 别外传')
    assert.equal((await rowsOf(uid))[0].turns, 1, '没传 turns 时按 user 消息数算')
  })

  test('列表默认不带 body, withBody=1 才带; 详情带 events 与 body', async () => {
    const uid = uidOf('list')
    const r = await report(e, [{ uid, source: 'HERMES', title: `${RUN} 列表`, body: [{ role: 'user', content: 'hi' }], events: [{ seq: 1, kind: 'NOTE', text: 'n' }] }])
    const id = r.data.items[0].id
    const l1 = await e.get(`/api/dev/conversations?keyword=${encodeURIComponent(RUN + ' 列表')}`)
    assert.equal(l1.code, 0, l1.message)
    assert.equal(l1.data.total, 1)
    assert.equal(l1.data.list[0].id, id)
    assert.ok(!('body' in l1.data.list[0]), '默认不返回 body')
    assert.equal(l1.data.list[0].engineerName, E.name)
    const l2 = await e.get(`/api/dev/conversations?keyword=${encodeURIComponent(RUN + ' 列表')}&withBody=1`)
    assert.deepEqual(l2.data.list[0].body, [{ role: 'user', content: 'hi' }])
    const d = await e.get(`/api/dev/conversations/${id}`)
    assert.equal(d.code, 0, d.message)
    assert.equal(d.data.events.length, 1)
    assert.ok(Array.isArray(d.data.body))
    const bad = await e.get('/api/dev/conversations?stage=NOPE')
    assert.equal(bad.status, 400)
  })

  test('数据范围: 工程师只看自己的, 管理员看全部; 不能借 uid 改别人的会话', async () => {
    const uid = uidOf('scope')
    const r = await report(e, [{ uid, source: 'PASTE', title: `${RUN} 范围` }])
    const id = r.data.items[0].id
    const kw = `?keyword=${encodeURIComponent(RUN + ' 范围')}`
    assert.equal((await o.get(`/api/dev/conversations${kw}`)).data.total, 0)
    assert.equal((await o.get(`/api/dev/conversations/${id}`)).status, 404)
    assert.equal((await admin.get(`/api/dev/conversations${kw}`)).data.total, 1)
    const hijack = await report(o, [{ uid, title: '被改了' }])
    assert.equal(hijack.data.errors.length, 1)
    assert.equal((await rowsOf(uid))[0].title, `${RUN} 范围`)
  })

  test('批量: 单条失败不影响其它条, 返回 errors', async () => {
    const r = await report(e, [
      { uid: uidOf('b1'), source: 'CODEX' },
      { uid: uidOf('b2'), source: 'NOT_A_SOURCE' },
      { source: 'CODEX' },
      { uid: uidOf('b3'), source: 'CODEX', projectId: '999999999999' }
    ])
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.created, 1)
    assert.deepEqual(r.data.items.map((x) => x.uid), [uidOf('b1')])
    assert.equal(r.data.errors.length, 3)
    assert.match(r.data.errors.find((x) => x.uid === uidOf('b2')).message, /source/)
    assert.equal((await rowsOf(uidOf('b2'))).length, 0)
  })

  test('API Key 可上报(采集器), 未登录被拒', async () => {
    const k = generateApiKey()
    keyId = (await prisma.apiKey.create({ data: { userId: BigInt(E.id), name: 'unit-test-采集器', keyHash: k.hash, prefix: k.prefix } })).id
    const r = await request('POST', '/api/devlog/conversations', { conversations: [{ uid: uidOf('key'), source: 'CLAUDE_CODE' }] }, k.raw)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.created, 1)
    assert.equal(String((await rowsOf(uidOf('key')))[0].engineerId), engineerId)
    const anon = await request('POST', '/api/devlog/conversations', { conversations: [{ uid: uidOf('anon'), source: 'CODEX' }] })
    assert.equal(anon.status, 401)
  })

  test('link: 关联项目后 status 变 LINKED 并写审计; 没变化不改状态', async () => {
    const r = await report(e, [{ uid: uidOf('link'), source: 'CLAUDE_CODE' }])
    const id = r.data.items[0].id
    assert.equal((await rowsOf(uidOf('link')))[0].status, 'PENDING_LINK')
    const l = await e.post(`/api/dev/conversations/${id}/link`, { projectId, stage: 'design' })
    assert.equal(l.code, 0, l.message)
    assert.equal(l.data.status, 'LINKED')
    assert.deepEqual(l.data.changed.sort(), ['projectId', 'stage'])
    const row = (await rowsOf(uidOf('link')))[0]
    assert.equal(String(row.projectId), String(projectId))
    assert.equal(row.stage, 'DESIGN')
    const logs = await prisma.auditLog.findMany({ where: { action: 'devlog.conversation.link', resourceId: BigInt(id) } })
    assert.equal(logs.length, 1)
    assert.deepEqual(logs[0].details.changed.sort(), ['projectId', 'stage'])
    const again = await e.post(`/api/dev/conversations/${id}/link`, { projectId })
    assert.deepEqual(again.data.changed, [])
    // 旁人看不到这条, 也就关联不了
    assert.equal((await o.post(`/api/dev/conversations/${id}/link`, { stage: 'TEST' })).status, 404)
  })

  test('timeline 按 stage 分组且条数正确', async () => {
    const mk = (s, stage, startedAt) => ({ uid: uidOf(`tl-${s}`), source: 'CLAUDE_CODE', stage, projectId, title: `tl ${s}`, startedAt, commitShas: [`sha${s}`] })
    const r = await report(e, [
      mk('r1', 'REQUIREMENT', '2026-11-01T01:00:00Z'),
      mk('c1', 'CODING', '2026-11-03T01:00:00Z'),
      mk('c2', 'CODING', '2026-11-02T01:00:00Z'),
      mk('t1', 'TEST', '2026-11-04T01:00:00Z'),
      { ...mk('x', 'RETRO'), projectId: undefined }
    ])
    assert.equal(r.data.created, 5, JSON.stringify(r.data.errors))
    const t = await e.get(`/api/projects/${projectId}/timeline`)
    assert.equal(t.code, 0, t.message)
    assert.deepEqual(Object.keys(t.data).sort(), ['CODING', 'DESIGN', 'GENERAL', 'REQUIREMENT', 'RETRO', 'TEST'])
    assert.equal(t.data.REQUIREMENT.length, 1)
    assert.deepEqual(t.data.CODING.map((x) => x.title), ['tl c2', 'tl c1'], '组内按开始时间排')
    assert.equal(t.data.TEST.length, 1)
    assert.equal(t.data.RETRO.length, 0, '没关联项目的不进时间线')
    assert.equal(t.data.DESIGN.length, 1, '上一条 link 进来的 DESIGN 会话')
    const item = t.data.CODING[0]
    for (const k of ['id', 'title', 'summary', 'startedAt', 'engineerName', 'turns', 'commitShas']) assert.ok(k in item, k)
    assert.equal(item.engineerName, E.name)
    assert.deepEqual(item.commitShas, ['shac2'])
    // 上报时带了 projectId 的直接 LINKED
    assert.equal((await rowsOf(uidOf('tl-r1')))[0].status, 'LINKED')
    // 非项目成员看不到
    assert.equal((await o.get(`/api/projects/${projectId}/timeline`)).status, 403)
  })

  test('summarize: 没有模型时降级规则(前 3 条 user 首句 + 文件路径)', async () => {
    const r = await report(e, [{
      uid: uidOf('sum'), source: 'CLAUDE_CODE',
      body: [
        { role: 'user', content: '给 backend/src/routes/fde/devlog.js 加上报接口。要幂等。' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: [{ type: 'text', text: '再改 prisma/schema.prisma\n其余不动' }] },
        { role: 'user', content: '跑一下测试吧' },
        { role: 'user', content: '第四条不该出现' }
      ],
      events: [{ seq: 1, kind: 'PITFALL', text: '全局 json 限额 100kb' }]
    }])
    const id = r.data.items[0].id
    const s = await e.post(`/api/dev/conversations/${id}/summarize`)
    assert.equal(s.code, 0, s.message)
    assert.equal(s.data.mode, 'rules')
    assert.match(s.data.summary, /给 backend\/src\/routes\/fde\/devlog\.js 加上报接口。/)
    assert.match(s.data.summary, /再改 prisma\/schema\.prisma/)
    assert.match(s.data.summary, /跑一下测试吧/)
    assert.ok(!s.data.summary.includes('第四条'))
    assert.ok(s.data.files.includes('backend/src/routes/fde/devlog.js') && s.data.files.includes('prisma/schema.prisma'), s.data.files.join(','))
    assert.deepEqual(s.data.pitfalls, ['全局 json 限额 100kb'])
    assert.equal((await rowsOf(uidOf('sum')))[0].summary, s.data.summary, '摘要写回会话')
  })

  test('experience: 从会话沉淀后能按 projectId / tag 查到, 写审计', async () => {
    const conv = (await rowsOf(uidOf('link')))[0]
    const c = await e.post('/api/experience/from-conversation', {
      conversationId: String(conv.id), title: `${RUN} 上报要幂等`, kind: 'pitfall', body: '按 uid upsert', tags: ['devlog', RUN], reusableLevel: 3
    })
    assert.equal(c.status, 201, c.message)
    assert.equal(c.data.kind, 'PITFALL')
    assert.equal(String(c.data.projectId), String(projectId), '项目取自会话')
    const l = await e.get(`/api/experience?projectId=${projectId}`)
    assert.equal(l.code, 0, l.message)
    assert.equal(l.data.total, 1)
    assert.equal(l.data.list[0].title, `${RUN} 上报要幂等`)
    assert.equal((await e.get(`/api/experience?tag=${RUN}`)).data.total, 1)
    assert.equal((await e.get(`/api/experience?tag=${RUN}&kind=HOWTO`)).data.total, 0)
    const logs = await prisma.auditLog.findMany({ where: { action: 'devlog.experience.create', resourceId: BigInt(c.data.id) } })
    assert.equal(logs.length, 1)
    // 看不到的会话不能拿来沉淀
    assert.equal((await o.post('/api/experience/from-conversation', { conversationId: String(conv.id), title: 'x', body: 'y' })).status, 404)
  })

  test('paste: 识别角色分块; 同一段文本粘贴两次只有 1 条会话; 自动出规则摘要', async () => {
    const text = [
      `用户：${RUN} 对一下需求口径，导出范围包含哪些字段？`,
      '助手: 结论：只导出已验收的工单。',
      'Human: 那历史数据呢',
      'Assistant: 决定历史数据走一次性脚本，因为口径不同。\n踩坑：旧表 created_at 是字符串。'
    ].join('\n')
    const p1 = await e.post('/api/dev/conversations/paste', { text })
    assert.equal(p1.status, 201, p1.message)
    assert.equal(p1.data.created, true)
    assert.match(p1.data.uid, /^paste_[0-9a-f]{24}$/)
    assert.equal(p1.data.messages, 4)
    assert.equal(p1.data.mode, 'rules')
    assert.ok(p1.data.summary.includes('对一下需求口径'))
    assert.deepEqual(p1.data.decisions, ['结论：只导出已验收的工单。', '决定历史数据走一次性脚本，因为口径不同。'])
    assert.deepEqual(p1.data.pitfalls, ['踩坑：旧表 created_at 是字符串。'])
    assert.equal(p1.data.stageSuggestion, 'REQUIREMENT')
    const p2 = await e.post('/api/dev/conversations/paste', { text: text + '\n\n' })
    assert.equal(p2.status, 200, p2.message)
    assert.equal(p2.data.created, false)
    assert.equal(p2.data.id, p1.data.id)
    const rows = await rowsOf(p1.data.uid)
    assert.equal(rows.length, 1, '同一段文本重复粘贴不产生重复会话')
    const row = rows[0]
    assert.equal(row.source, 'PASTE')
    assert.equal(row.stage, 'REQUIREMENT', 'GENERAL 按建议回填')
    assert.equal(String(row.engineerId), engineerId)
    assert.deepEqual(row.body.map((m) => m.role), ['user', 'assistant', 'user', 'assistant'])
    assert.equal(row.title, `${RUN} 对一下需求口径，导出范围包含哪些字段？`)
    assert.equal(row.summary, p1.data.summary)
    // 别人粘贴同一段 → 409, 不串到别人的会话上
    assert.equal((await o.post('/api/dev/conversations/paste', { text })).status, 409)
  })

  test('paste: 带 stage/projectId/title 时按传入的; 没有角色标记整段算一条; 不能挂到无权的项目', async () => {
    const text = `${RUN} 一段没有标记的笔记：报错 测试 用例 报错`
    const p = await e.post('/api/dev/conversations/paste', { text, stage: 'design', projectId, title: '手填标题' })
    assert.equal(p.status, 201, p.message)
    assert.equal(p.data.stageSuggestion, 'TEST')
    assert.equal(p.data.stageApplied, false)
    const row = (await rowsOf(p.data.uid))[0]
    assert.equal(row.stage, 'DESIGN', '不覆盖用户选的阶段')
    assert.equal(String(row.projectId), String(projectId))
    assert.equal(row.status, 'LINKED')
    assert.equal(row.title, '手填标题')
    assert.deepEqual(row.body, [{ role: 'user', content: text }])
    const again = await e.post('/api/dev/conversations/paste', { text })
    assert.equal(again.data.created, false)
    assert.equal((await rowsOf(p.data.uid))[0].title, '手填标题', '重复粘贴不带 title 不覆盖原标题')
    assert.equal((await o.post('/api/dev/conversations/paste', { text: `${RUN} x`, projectId })).status, 403)
    assert.equal((await e.post('/api/dev/conversations/paste', { text: '  ' })).status, 400)
    assert.equal((await e.post('/api/dev/conversations/paste', { text: 'x', stage: 'NOPE' })).status, 400)
  })

  test('平台助手: 每轮对话 upsert 成一条 PLATFORM_ASSISTANT 会话, 多轮累加不新增行', async () => {
    const st = await e.get('/api/fde/assistant/status')
    assert.equal(st.data.stub, true, '要求后端以 FDE_LLM_STUB=1 启动')
    const c1 = await e.post('/api/fde/assistant/chat', { message: '我这周有哪些任务要交', stage: 'coding' })
    assert.equal(c1.code, 0, c1.message)
    const uid = `pa_${c1.data.conversationId}`
    assert.equal(c1.data.devlogUid, uid)
    extraConvIds.push(...(await rowsOf(uid)).map((x) => x.id))
    const c2 = await e.post('/api/fde/assistant/chat', { message: '我的密码 password=hunter2 帮我记一下', conversationId: c1.data.conversationId })
    assert.equal(c2.code, 0, c2.message)
    const rows = await rowsOf(uid)
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.equal(row.source, 'PLATFORM_ASSISTANT')
    assert.equal(row.stage, 'CODING', '第二轮没传 stage, 保留第一轮的')
    assert.equal(String(row.engineerId), engineerId)
    assert.equal(row.turns, 2)
    assert.equal(row.bodyRedacted, true)
    const roles = row.body.map((m) => m.role)
    assert.deepEqual(roles.filter((r) => r !== 'tool'), ['user', 'assistant', 'user', 'assistant'])
    const tool = row.body.find((m) => m.role === 'tool')
    assert.equal(tool.tool, 'list_my_tasks')
    assert.equal(typeof tool.args, 'string')
    assert.ok(!JSON.stringify(row.body).includes('hunter2'))
    assert.equal(row.body[0].content, '我这周有哪些任务要交')
  })
})
