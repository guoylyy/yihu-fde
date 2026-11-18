// 集成测试 - AI 助手的 0.5.0 会话 / 经验工具(capture_conversation / link_conversation / search_experience / project_timeline / today)
// 后端要以 FDE_LLM_STUB=1 启动(stub 按关键词出确定的工具调用); 不是 stub 后端时整组 skip。
// 覆盖: 记会话只出草稿、确认后才经粘贴接口落库、再确认不重复建; 改关联直接生效并说明改了什么(写审计);
//       经验最多 5 条; 时间线四阶段计数 + 最近 3 条; 今日概览四块。账号 / 项目 / 会话现建现删
import { describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { pasteUid } from '../../src/services/devlog/paste.js'
import { login, api, uniqName, createTestUser, probeStub, stubTest } from './helpers.js'

describe('AI 助手 · 会话与经验工具', () => {
  let admin, E, e, O, o, customerId, projectId, projectName
  let stub = false
  const RUN = `ut${Date.now().toString(36)}`
  const convIds = []
  const test = stubTest(() => stub)

  const chat = async (who, message) => {
    const r = await who.post('/api/fde/assistant/chat', { message })
    assert.equal(r.code, 0, r.message)
    convIds.push(BigInt(r.data.conversationId))
    return r.data
  }
  const auditOf = (action, resourceId) => prisma.auditLog.findMany({ where: { action, ...(resourceId ? { resourceId: BigInt(resourceId) } : {}) } })
  const paste = async (who, text, extra = {}) => {
    const r = await who.post('/api/dev/conversations/paste', { text, ...extra })
    assert.equal(r.code, 0, r.message)
    return r.data
  }

  before(async () => {
    admin = api(await login('admin'))
    stub = await probeStub(admin, 'AI 助手 · 会话与经验工具')
    if (!stub) return
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-会话助手工程师' })
    O = await createTestUser('FDE_ENGINEER', { name: 'unit-test-会话助手旁人' })
    e = api(E.token); o = api(O.token)
    const c = await admin.post('/api/fde/customers', { name: uniqName('会话助手客户'), industry: 'X' })
    assert.equal(c.code, 0, c.message)
    customerId = c.data.id
    projectName = uniqName('会话助手项目')
    const p = await admin.post('/api/fde/projects', { name: projectName, customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    const m = await admin.post(`/api/fde/projects/${projectId}/members`, { userId: E.id, roleInProject: 'DEV' })
    assert.equal(m.code, 0, m.message)
  })

  after(async () => {
    if (!stub) return
    const users = [BigInt(E?.id || 0), BigInt(O?.id || 0)]
    const convs = await prisma.devConversation.findMany({ where: { OR: [{ createdBy: { in: users } }, { uid: { in: convIds.map((id) => `pa_${id}`) } }] }, select: { id: true } })
    const ids = convs.map((c) => c.id)
    await prisma.devExperience.deleteMany({ where: { OR: [{ conversationId: { in: ids } }, { createdBy: { in: users } }] } })
    await prisma.devConversation.deleteMany({ where: { id: { in: ids } } })
    await prisma.assistantDraft.deleteMany({ where: { conversationId: { in: convIds } } })
    await prisma.agentMessage.deleteMany({ where: { conversationId: { in: convIds } } })
    await prisma.agentConversation.deleteMany({ where: { id: { in: convIds } } })
    const pid = projectId ? BigInt(projectId) : -1n
    await prisma.task.deleteMany({ where: { projectId: pid } })
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await E?.cleanup(); await O?.cleanup()
  })

  test('工具表: 五个新工具都在, 描述里写清什么时候用', async () => {
    const st = await e.get('/api/fde/assistant/status')
    const tools = Object.fromEntries(st.data.tools.map((t) => [t.name, t.kind]))
    assert.deepEqual(
      ['capture_conversation', 'link_conversation', 'search_experience', 'project_timeline', 'today'].map((n) => tools[n]),
      ['draft', 'write', 'read', 'read', 'read']
    )
    assert.equal(st.data.maxToolRounds, 8)
    const { TOOLS } = await import('../../src/services/assistant/tools.js')
    for (const n of ['capture_conversation', 'link_conversation', 'search_experience', 'project_timeline', 'today']) {
      assert.match(TOOLS.find((t) => t.name === n).description, /时用/, `${n} 的描述要写清什么时候用`)
    }
  })

  test('capture_conversation: 先出草稿(来源/阶段/项目/摘要首句) → 确认后才落库 → 再确认不重复建', async () => {
    const body = `用户: ${RUN} 跑测试报错了，用例 A 一直失败。\n助手: 测试里 mock 没清，报错原因是缓存没重置。`
    const d = await chat(e, `帮我记一下这段对话，挂到 ${projectName} 项目：${body}`)
    assert.deepEqual(d.toolCalls.map((c) => [c.name, c.ok]), [['capture_conversation', true]])
    const draft = d.message.drafts[0]
    assert.equal(draft.kind, 'conversation')
    assert.equal(draft.status, 'PENDING')
    assert.equal(draft.preview.source, 'AI 助手')
    assert.equal(draft.names.stage, '测试', '按内容识别出测试阶段')
    assert.equal(draft.preview.stageAuto, true)
    assert.equal(draft.names.projectId, projectName)
    assert.equal(draft.preview.summary, `${RUN} 跑测试报错了，用例 A 一直失败。`)
    assert.match(d.message.text, /会话草稿.*阶段：测试/)

    const uid = pasteUid(body)
    assert.equal(await prisma.devConversation.count({ where: { uid } }), 0, '草稿阶段不落库')

    const c = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.equal(c.code, 0, c.message)
    assert.equal(c.data.status, 'SUBMITTED')
    assert.equal(c.data.link, `/admin/conversations/${c.data.resultId}`)
    const row = await prisma.devConversation.findUnique({ where: { uid } })
    assert.equal(String(row.id), c.data.resultId)
    assert.equal(row.source, 'PASTE')
    assert.equal(row.stage, 'TEST')
    assert.equal(String(row.projectId), String(projectId))
    assert.equal(String(row.createdBy), E.id, '以确认人的身份写入')
    assert.equal(row.body.length, 2)
    assert.equal((await auditOf('ai.draft.confirm', draft.id)).length, 1)
    assert.equal((await auditOf('devlog.conversation.paste', row.id)).length, 1, '走的是粘贴接口')

    const again = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.equal(again.code, 0)
    assert.equal(again.data.duplicate, true)
    assert.equal(await prisma.devConversation.count({ where: { uid } }), 1, '再点确认不重复建')
    assert.equal((await auditOf('devlog.conversation.paste', row.id)).length, 1)

    // 同一段对话让助手再出一张草稿并确认: 粘贴接口按文本哈希幂等, 仍只有一条
    const d2 = await chat(e, `帮我记一下这段对话：${body}`)
    const c2 = await e.post(`/api/fde/assistant/drafts/${d2.message.drafts[0].id}/confirm`, {})
    assert.equal(c2.code, 0, c2.message)
    assert.equal(c2.data.resultId, c.data.resultId)
    assert.equal(await prisma.devConversation.count({ where: { uid } }), 1)
  })

  test('capture_conversation: 指定阶段以人说的为准; 人改了阶段/项目以卡片为准; 不能挂到无权项目', async () => {
    const body = `${RUN} 讨论一下导出报表的需求口径和范围`
    const d = await chat(e, `帮我记一下这段对话，设计阶段：${body}`)
    const draft = d.message.drafts[0]
    assert.equal(draft.names.stage, '设计')
    assert.equal(draft.preview.stageAuto, false)
    assert.equal(draft.payload.projectId, undefined, '没说项目就不挂(进待认领)')
    const bad = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, { payload: { stage: '乱填' } })
    assert.equal(bad.code, 9002)
    const c = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, { payload: { stage: 'REQUIREMENT', projectId } })
    assert.equal(c.code, 0, c.message)
    const row = await prisma.devConversation.findUnique({ where: { id: BigInt(c.data.resultId) } })
    assert.equal(row.stage, 'REQUIREMENT')
    assert.equal(String(row.projectId), String(projectId))

    // 旁人不是项目成员: 卡片上硬改成该项目, 确认被拒且不落库
    const d2 = await chat(o, `帮我记一下这段对话：${RUN} 旁人的一段对话`)
    const r = await o.post(`/api/fde/assistant/drafts/${d2.message.drafts[0].id}/confirm`, { payload: { projectId } })
    assert.notEqual(r.code, 0)
    assert.equal(await prisma.devConversation.count({ where: { uid: pasteUid(`${RUN} 旁人的一段对话`) } }), 0)
  })

  test('link_conversation: 不出草稿直接改关联, 回复里说明改前→改后, 写审计; 刚才那段 = latest', async () => {
    const p = await paste(e, `${RUN} 一段待认领的编码对话`)
    const d = await chat(e, `把会话 #${p.id} 关联到 ${projectName} 项目，测试阶段`)
    assert.deepEqual(d.toolCalls.map((c) => [c.name, c.ok]), [['link_conversation', true]])
    assert.equal(d.message.drafts.length, 0, '只改关联, 不需要确认')
    assert.match(d.message.text, new RegExp(`项目 无 → ${projectName}`))
    assert.match(d.message.text, /阶段 通用 → 测试/)
    const row = await prisma.devConversation.findUnique({ where: { id: BigInt(p.id) } })
    assert.equal(String(row.projectId), String(projectId))
    assert.equal(row.stage, 'TEST')
    assert.equal(row.status, 'LINKED')
    const link = await auditOf('devlog.conversation.link', p.id)
    assert.equal(link.length, 1)
    const tool = (await auditOf('ai.tool', d.conversationId)).find((l) => l.details.tool === 'link_conversation')
    assert.equal(tool.details.kind, 'write')

    // 再说一遍: 没变化, 如实说明
    const same = await chat(e, `把会话 #${p.id} 关联到 ${projectName} 项目`)
    assert.match(same.message.text, /关联没有变化/)

    // 「刚才那段」: 取我最近一条(不算平台助手自己这条)
    const p2 = await paste(e, `${RUN} 最新的一段复盘对话`)
    const d2 = await chat(e, '把刚才那段对话归到复盘阶段')
    assert.equal(d2.toolCalls[0].ok, true, d2.message.text)
    assert.equal((await prisma.devConversation.findUnique({ where: { id: BigInt(p2.id) } })).stage, 'RETRO')

    // 看不到的会话改不了
    const other = await chat(o, `把会话 #${p.id} 关联到复盘阶段`)
    assert.deepEqual(other.toolCalls.map((c) => [c.name, c.ok]), [['link_conversation', false]])
    assert.equal((await prisma.devConversation.findUnique({ where: { id: BigInt(p.id) } })).stage, 'TEST')
  })

  test('search_experience: 只读, 最多 5 条(标题 + 摘要首句 + id)', async () => {
    const kw = `${RUN}缓存`
    const conv = await paste(e, `${RUN} 沉淀经验用的对话`)
    const ids = []
    for (let i = 1; i <= 6; i++) {
      const r = await e.post('/api/experience/from-conversation', { conversationId: conv.id, title: `${kw} 第 ${i} 条`, body: `第 ${i} 条的第一句。后面还有细节。`, kind: 'PITFALL' })
      assert.equal(r.code, 0, r.message)
      ids.push(String(r.data.id))
    }
    const before = await prisma.devExperience.count()
    const d = await chat(e, `有没有关于 ${kw} 的经验`)
    assert.deepEqual(d.toolCalls.map((c) => [c.name, c.ok]), [['search_experience', true]])
    assert.match(d.message.text, /找到 6 条经验/)
    const shown = [...d.message.text.matchAll(/\(#(\d+)\)/g)].map((m) => m[1])
    assert.equal(shown.length, 5, '最多返回 5 条')
    assert.ok(shown.every((id) => ids.includes(id)))
    assert.equal(await prisma.devExperience.count(), before, '只读')

    const { TOOLS } = await import('../../src/services/assistant/tools.js')
    const tool = TOOLS.find((t) => t.name === 'search_experience')
    const fakeCtx = { api: async () => ({ code: 0, data: { total: 1, list: [{ id: 9, title: 't', kind: 'PITFALL', body: '第一句。第二句。' }] } }), lookup: { projects: async () => [] } }
    const out = await tool.run({ keyword: 'x', kind: '踩坑' }, fakeCtx)
    assert.deepEqual(out.items[0], { id: '9', title: 't', kind: '踩坑', summary: '第一句。' })
    assert.match((await tool.run({ kind: '乱填' }, fakeCtx)).error, /认不出/)
  })

  test('project_timeline: 按名字找项目, 四阶段各几条 + 最近 3 条标题', async () => {
    // 前面用例已挂到本项目: 测试 1(capture) + 需求 1(人改) + 测试 1(link); 再补一条编码
    await paste(e, `${RUN} 时间线上的编码对话`, { projectId, stage: 'CODING', title: `${RUN} 编码那条` })
    const d = await chat(e, `${projectName} 项目的时间线`)
    assert.deepEqual(d.toolCalls.map((c) => [c.name, c.ok]), [['project_timeline', true]])
    const rows = await prisma.devConversation.groupBy({ by: ['stage'], where: { projectId: BigInt(projectId), deletedAt: null }, _count: true })
    const n = (st) => rows.find((r) => r.stage === st)?._count || 0
    assert.match(d.message.text, new RegExp(`需求 ${n('REQUIREMENT')} 条，设计 ${n('DESIGN')} 条，编码 ${n('CODING')} 条，测试 ${n('TEST')} 条`))
    assert.ok(n('CODING') >= 1 && n('TEST') >= 1)
    const recent = d.message.text.split('最近：')[1].split('、')
    assert.equal(recent.length, 3)

    const no = await chat(o, `${projectName} 项目的时间线`)
    assert.deepEqual(no.toolCalls.map((c) => [c.name, c.ok]), [['project_timeline', false]], '非成员找不到该项目')
  })

  test('today: 进行中任务 ≤5、待我审批数、本周 OKR 交没交、最近 3 条会话', async () => {
    const titles = []
    for (let i = 1; i <= 6; i++) {
      const t = await admin.post('/api/fde/tasks', { projectId, title: `${RUN} 进行中 ${i}`, assigneeUserId: E.id, dueDate: `2099-01-0${i}` })
      assert.equal(t.code, 0, t.message)
      await prisma.task.update({ where: { id: BigInt(t.data.id) }, data: { status: 'IN_PROGRESS' } })
      titles.push(t.data.title)
    }
    const d = await chat(e, '我今天该干啥')
    assert.deepEqual(d.toolCalls.map((c) => [c.name, c.ok]), [['today', true]])
    assert.match(d.message.text, /进行中任务 6 个/)
    assert.match(d.message.text, /待我审批 0 条/, '工程师没有审批职责')
    assert.match(d.message.text, /本周 OKR：(未交|未交（已过截止）)/)
    const recent = d.message.text.split('最近会话：')[1].split('、')
    assert.equal(recent.length, 3)

    // 工具返回结构: 任务最多 5 条、按截止日排
    const { TOOLS } = await import('../../src/services/assistant/tools.js')
    const { makeSelfApi } = await import('../../src/services/assistant/selfApi.js')
    const { makeLookup } = await import('../../src/services/assistant/drafts.js')
    const port = new URL(process.env.TEST_API_BASE || 'http://127.0.0.1:3005').port
    const oldPort = process.env.PORT
    process.env.PORT = port
    try {
      const user = { userId: E.id, username: E.username, role: 'FDE_ENGINEER' }
      const apiFn = makeSelfApi(user)
      const out = await TOOLS.find((t) => t.name === 'today').run({}, { api: apiFn, lookup: makeLookup(apiFn, user), user, today: new Date() })
      assert.equal(out.inProgressTasks.total, 6)
      assert.deepEqual(out.inProgressTasks.list.map((t) => t.title), titles.slice(0, 5))
      assert.equal(out.recentConversations.list.length, 3)
      assert.ok(['PENDING', 'OVERDUE'].includes(out.okrThisWeek.state), JSON.stringify(out.okrThisWeek))
    } finally {
      if (oldPort === undefined) delete process.env.PORT
      else process.env.PORT = oldPort
    }
  })
})
