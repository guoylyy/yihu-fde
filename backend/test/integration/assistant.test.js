// 集成测试 - AI 助手(/api/fde/assistant)
// 后端要以 FDE_LLM_STUB=1 启动(stub 大模型按关键词出确定的工具调用, 工具 / 草稿 / 确认走的都是真实链路); 不是 stub 后端时整组 skip。
// 覆盖: 工具按权限收敛(工程师不能用经理工具)、草稿不落库、确认后经正常业务接口落库、重复确认幂等、
//       丢弃留记录、人改过的字段生效、8 轮上限、会话只能看自己的。账号 / 项目现建现删
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { login, api, uniqName, createTestUser, probeStub, stubTest } from './helpers.js'

describe('AI 助手', () => {
  let admin, E, e, O, o, customerId, projectId, projectName
  let stub = false
  const convIds = []
  const test = stubTest(() => stub)   // 本组全部依赖 stub 大模型: 非 stub 后端上 t.skip, 不算失败

  const chat = async (who, message, conversationId) => {
    const r = await who.post('/api/fde/assistant/chat', { message, ...(conversationId ? { conversationId } : {}) })
    assert.equal(r.code, 0, r.message)
    convIds.push(BigInt(r.data.conversationId))
    return r.data
  }
  const auditOf = (action, resourceId) => prisma.auditLog.findMany({ where: { action, ...(resourceId ? { resourceId: BigInt(resourceId) } : {}) } })

  before(async () => {
    admin = api(await login('admin'))
    stub = await probeStub(admin, 'AI 助手')
    if (!stub) return
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-助手工程师' })
    O = await createTestUser('FDE_ENGINEER', { name: 'unit-test-助手旁人' })
    e = api(E.token); o = api(O.token)
    const c = await admin.post('/api/fde/customers', { name: uniqName('助手客户'), industry: 'X' })
    assert.equal(c.code, 0, c.message)
    customerId = c.data.id
    projectName = uniqName('助手导轨')
    const p = await admin.post('/api/fde/projects', { name: projectName, customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    const m = await admin.post(`/api/fde/projects/${projectId}/members`, { userId: E.id, roleInProject: 'DEV' })
    assert.equal(m.code, 0, m.message)
  })

  after(async () => {
    const pid = projectId ? BigInt(projectId) : -1n
    await prisma.assistantDraft.deleteMany({ where: { conversationId: { in: convIds } } })
    await prisma.agentMessage.deleteMany({ where: { conversationId: { in: convIds } } })
    await prisma.agentConversation.deleteMany({ where: { id: { in: convIds } } })
    await prisma.comment.deleteMany({ where: { entity: 'project', entityId: pid } })
    await prisma.timesheet.deleteMany({ where: { projectId: pid } })
    await prisma.projectRequirement.deleteMany({ where: { projectId: pid } })
    const tasks = await prisma.task.findMany({ where: { projectId: pid }, select: { id: true } })
    await prisma.comment.deleteMany({ where: { entity: 'task', entityId: { in: tasks.map((t) => t.id) } } })
    await prisma.task.deleteMany({ where: { projectId: pid } })
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await E?.cleanup(); await O?.cleanup()
  })

  test('工具按权限收敛: 工程师看不到经理工具, 模型硬调也被拒并留痕', async () => {
    const st = await e.get('/api/fde/assistant/status')
    const names = st.data.tools.map((t) => t.name)
    assert.ok(names.includes('list_my_tasks') && names.includes('draft_task'))
    assert.ok(!names.includes('list_pending_approvals'), '工程师不该拿到审批类工具')
    const adminTools = (await admin.get('/api/fde/assistant/status')).data.tools.map((t) => t.name)
    assert.ok(adminTools.includes('list_pending_approvals'))

    const d = await chat(e, '有哪些工时等我审批')   // stub 会硬调 list_pending_approvals
    assert.deepEqual(d.toolCalls.map((c) => [c.name, c.ok]), [['list_pending_approvals', false]])
    assert.match(d.message.text, /没有使用「list_pending_approvals」的权限/)
    const denied = await auditOf('ai.tool.denied', d.conversationId)
    assert.equal(denied.length, 1)
    assert.equal(denied[0].details.tool, 'list_pending_approvals')
  })

  test('查: 我这周的任务 → list_my_tasks, 每次工具调用写审计', async () => {
    const due = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)   // 北京时间今天
    const t = await admin.post('/api/fde/tasks', { projectId, title: uniqName('本周要交'), dueDate: due, assigneeUserId: E.id })
    assert.equal(t.code, 0, t.message)
    const d = await chat(e, '我这周有哪些任务要交')
    assert.deepEqual(d.toolCalls.map((c) => c.name), ['list_my_tasks'])
    assert.ok(d.message.text.includes(t.data.title), d.message.text)
    const logs = await auditOf('ai.tool', d.conversationId)
    assert.equal(logs[0].details.tool, 'list_my_tasks')
    assert.equal((await auditOf('ai.chat', d.conversationId)).length, 1)
  })

  test('写: 草稿不落库; 确认后经正常接口落库; 再点确认不重复建', async () => {
    const before = await prisma.task.count({ where: { projectId: BigInt(projectId) } })
    const d = await chat(e, `帮我给${projectName}项目建个任务：周五前把图纸确认单发给客户`)
    assert.equal(d.message.drafts.length, 1)
    const draft = d.message.drafts[0]
    assert.equal(draft.kind, 'task')
    assert.equal(draft.status, 'PENDING')
    assert.equal(draft.payload.projectId, String(projectId))
    assert.equal(draft.payload.title, '把图纸确认单发给客户')
    assert.equal(draft.payload.assigneeUserId, E.id, '没说负责人默认是自己')
    assert.match(draft.payload.dueDate, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(new Date(draft.payload.dueDate + 'T00:00:00Z').getUTCDay(), 5, '「周五前」应解析成周五')
    assert.deepEqual(draft.missing, [])
    assert.equal(await prisma.task.count({ where: { projectId: BigInt(projectId) } }), before, '出草稿不能写库')

    const c = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.equal(c.code, 0, c.message)
    assert.equal(c.data.status, 'SUBMITTED')
    assert.ok(c.data.resultId)
    assert.equal(c.data.link, `/admin/tasks?open=${c.data.resultId}`)
    const task = await prisma.task.findUnique({ where: { id: BigInt(c.data.resultId) } })
    assert.equal(task.title, '把图纸确认单发给客户')
    assert.equal(String(task.createdBy), E.id, '以确认人的身份创建')
    // 走的是任务接口: 只有 POST /tasks 会记这条「创建任务」活动
    const act = await prisma.activity.findFirst({ where: { entity: 'task', entityId: task.id, action: 'created' } })
    assert.ok(act, '应走正常的建任务接口(有活动流)')
    assert.equal((await auditOf('ai.draft.confirm', draft.id)).length, 1)

    const again = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.equal(again.code, 0)
    assert.equal(again.data.duplicate, true)
    assert.equal(await prisma.task.count({ where: { projectId: BigInt(projectId) } }), before + 1)
  })

  test('改一改: 确认时带上人改过的字段, 以人改的为准', async () => {
    const d = await chat(e, `给${projectName}项目建个任务：明天前整理验收清单`)
    const draft = d.message.drafts[0]
    const c = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, { payload: { title: '整理现场验收清单（人改过）', priority: 'HIGH', dueDate: '2099-01-02' } })
    assert.equal(c.code, 0, c.message)
    const task = await prisma.task.findUnique({ where: { id: BigInt(c.data.resultId) } })
    assert.equal(task.title, '整理现场验收清单（人改过）')
    assert.equal(task.priority, 'HIGH')
    assert.equal(task.dueDate.toISOString().slice(0, 10), '2099-01-02')
  })

  test('业务错误原文透传, 不吞掉; 改好后还能再确认', async () => {
    const d = await chat(e, `给${projectName}项目建个任务：周五前补交材料`)
    const draft = d.message.drafts[0]
    await prisma.project.update({ where: { id: BigInt(projectId) }, data: { status: 'CLOSED' } })
    try {
      const c = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
      assert.notEqual(c.code, 0)
      assert.equal(c.message, '项目已关闭，不能再建任务', '应是建任务接口自己的报错原文')
      const row = await prisma.assistantDraft.findUnique({ where: { id: BigInt(draft.id) } })
      assert.equal(row.status, 'PENDING')
      assert.equal(row.lastError, '项目已关闭，不能再建任务')
      assert.equal((await auditOf('ai.draft.confirm_failed', draft.id)).length, 1)
    } finally {
      await prisma.project.update({ where: { id: BigInt(projectId) }, data: { status: 'IN_PROGRESS' } })
    }
    const ok = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.equal(ok.code, 0, ok.message)
  })

  test('丢弃: 不落库, 留记录; 丢弃后不能再确认', async () => {
    const before = await prisma.task.count({ where: { projectId: BigInt(projectId) } })
    const d = await chat(e, `给${projectName}项目建个任务：周五前不要了的事`)
    const draft = d.message.drafts[0]
    const r = await e.post(`/api/fde/assistant/drafts/${draft.id}/discard`, { reason: '不需要' })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.status, 'DISCARDED')
    const row = await prisma.assistantDraft.findUnique({ where: { id: BigInt(draft.id) } })
    assert.ok(row.discardedAt, '丢弃的草稿保留在库里')
    const log = await auditOf('ai.draft.discard', draft.id)
    assert.equal(log.length, 1)
    assert.equal(log[0].details.reason, '不需要')
    const c = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.notEqual(c.code, 0)
    assert.equal(await prisma.task.count({ where: { projectId: BigInt(projectId) } }), before)
  })

  test('缺必填: 草稿标出缺什么, 补齐前不能确认', async () => {
    const d = await chat(e, '帮我建个任务：周五前写周报')   // 没说项目
    const draft = d.message.drafts[0]
    assert.ok(draft.missing.includes('projectId'))
    const c = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.equal(c.code, 9002)
    assert.match(c.message, /还缺：项目/)
    const ok = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, { payload: { projectId } })
    assert.equal(ok.code, 0, ok.message)
  })

  test('需求 / 工时 / 评论草稿: 确认后分别落到各自的表', async () => {
    const rq = (await chat(e, `在${projectName}项目记一个需求：导轨扭曲度要能导出报表`)).message.drafts[0]
    assert.equal(rq.kind, 'requirement')
    assert.equal(await prisma.projectRequirement.count({ where: { projectId: BigInt(projectId) } }), 0)
    const rc = await e.post(`/api/fde/assistant/drafts/${rq.id}/confirm`, {})
    assert.equal(rc.code, 0, rc.message)
    const req = await prisma.projectRequirement.findUnique({ where: { id: BigInt(rc.data.resultId) } })
    assert.equal(req.status, 'DRAFT')
    assert.equal(req.source, 'AI', '经助手落库的需求标 source=AI')

    const ts = (await chat(e, `在${projectName}项目报工时 3小时：样机调试`)).message.drafts[0]
    assert.equal(ts.kind, 'timesheet')
    assert.equal(ts.payload.hours, 3)
    const tc = await e.post(`/api/fde/assistant/drafts/${ts.id}/confirm`, {})
    assert.equal(tc.code, 0, tc.message)
    const sheet = await prisma.timesheet.findUnique({ where: { id: BigInt(tc.data.resultId) } })
    assert.equal(Number(sheet.hours), 3)
    assert.equal(sheet.status, 'SUBMITTED')

    const cm = (await chat(e, `在${projectName}项目留言：@${E.name} 图纸已发客户`)).message.drafts[0]
    assert.equal(cm.kind, 'comment')
    assert.equal(cm.payload.entity, 'project')
    assert.deepEqual(cm.mentions.map((m) => m.userId), [E.id])
    const cc = await e.post(`/api/fde/assistant/drafts/${cm.id}/confirm`, {})
    assert.equal(cc.code, 0, cc.message)
    const comment = await prisma.comment.findUnique({ where: { id: BigInt(cc.data.resultId) } })
    assert.equal(comment.entity, 'project')
    assert.equal(String(comment.authorId), E.id)
  })

  test('草稿只能自己确认; 卡片上不能把项目改成自己看不到的', async () => {
    const d = await chat(e, `给${projectName}项目建个任务：周五前交接文档`)
    const draft = d.message.drafts[0]
    const other = await o.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, {})
    assert.equal(other.code, 9004)
    const out = await e.post(`/api/fde/assistant/drafts/${draft.id}/confirm`, { payload: { projectId: '999999999' } })
    assert.equal(out.code, 9002)
    assert.match(out.message, /无权访问/)
  })

  test('超过 8 轮工具调用就停, 并如实告诉用户', async () => {
    const d = await chat(e, '一直查')
    assert.equal(d.rounds, 8)
    assert.equal(d.stopped, 'max_rounds')
    assert.equal(d.toolCalls.length, 8)
    assert.match(d.message.text, /8 轮/)
  })

  test('总结: weekly_report 不改数据', async () => {
    const before = await prisma.task.count({ where: { projectId: BigInt(projectId) } })
    const d = await chat(e, '把我这周的工作总结一下')
    assert.deepEqual(d.toolCalls.map((c) => c.name), ['weekly_report'])
    assert.match(d.message.text, /完成了什么[\s\S]*卡在哪[\s\S]*下周建议/)
    assert.equal(await prisma.task.count({ where: { projectId: BigInt(projectId) } }), before)
  })

  test('会话: 续聊、翻历史带草稿状态、只能看和删自己的', async () => {
    const d1 = await chat(e, `给${projectName}项目建个任务：周五前历史测试`)
    const d2 = await chat(e, '我这周有哪些任务要交', d1.conversationId)
    assert.equal(d2.conversationId, d1.conversationId)
    const list = await e.get('/api/fde/assistant/conversations')
    assert.ok(list.data.list.some((c) => c.id === d1.conversationId))
    const detail = await e.get(`/api/fde/assistant/conversations/${d1.conversationId}`)
    assert.equal(detail.data.messages.length, 4)
    assert.equal(detail.data.messages[1].drafts[0].status, 'PENDING')
    assert.equal((await o.get(`/api/fde/assistant/conversations/${d1.conversationId}`)).code, 9004)
    assert.equal((await o.del(`/api/fde/assistant/conversations/${d1.conversationId}`)).code, 9004)
    assert.equal((await e.del(`/api/fde/assistant/conversations/${d1.conversationId}`)).code, 0)
    assert.equal((await e.get(`/api/fde/assistant/conversations/${d1.conversationId}`)).code, 9004)
  })
})

describe('大模型配置: 只有管理员能改, 手填模型密钥只出掩码, 可试连', () => {
  let admin, E, fake, port
  const created = []

  before(async () => {
    admin = api(await login('admin'))
    E = await createTestUser('FDE_ENGINEER')
    // 一个假的 OpenAI 兼容接口, 给「试连」用
    const http = await import('node:http')
    fake = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        const ok = req.headers.authorization === 'Bearer sk-test-1234567890'
        res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(ok ? { choices: [{ message: { content: '你好，连通正常' }, finish_reason: 'stop' }] } : { error: 'bad key' }))
      })
    })
    await new Promise((r) => fake.listen(0, '127.0.0.1', r))
    port = fake.address().port
  })

  after(async () => {
    if (created.length) await prisma.llmConfig.deleteMany({ where: { id: { in: created.map(BigInt) } } })
    fake?.close()
    await E?.cleanup()
  })

  test('工程师不能看也不能改模型配置', async () => {
    const e = api(E.token)
    assert.equal((await e.get('/api/fde/llm-configs')).status, 403)
    assert.equal((await e.post('/api/fde/llm-configs', { name: 'x', model: 'm', baseUrl: 'http://x', apiKey: 'k' })).status, 403)
  })

  test('手填模型: 必填校验、密钥掩码、试连返回延迟与样例', async () => {
    const bad = await admin.post('/api/fde/llm-configs', { name: 'x' })
    assert.equal(bad.code, 1001)
    assert.match(bad.message, /模型名必填/)
    const r = await admin.post('/api/fde/llm-configs', { name: uniqName('手填模型'), model: 'fake-model', baseUrl: `http://127.0.0.1:${port}/v1/`, apiKey: 'sk-test-1234567890' })
    assert.equal(r.code, 0, r.message)
    created.push(r.data.id)
    assert.equal(r.data.source, 'manual')
    assert.equal(r.data.apiKeyMasked, 'sk-t…7890')
    assert.equal(JSON.stringify(r.data).includes('sk-test-1234567890'), false, '接口不能吐出密钥原文')
    const t = await admin.post('/api/fde/llm-configs/test', { id: r.data.id })
    assert.equal(t.code, 0, t.message)
    assert.equal(t.data.ok, true, t.data.error)
    assert.equal(t.data.sample, '你好，连通正常')
    assert.ok(t.data.latencyMs >= 0)

    const wrong = await admin.put(`/api/fde/llm-configs/${r.data.id}`, { apiKey: 'sk-wrong' })
    assert.equal(wrong.code, 0)
    const t2 = await admin.post('/api/fde/llm-configs/test', { id: r.data.id })
    assert.equal(t2.data.ok, false)
    assert.match(t2.data.error, /401/)
    const list = await admin.get('/api/fde/llm-configs')
    assert.ok(list.data.list.some((c) => c.id === r.data.id && c.source === 'manual'))
    assert.ok(list.data.active, '列表要带上当前实际在用的模型')
  })
})
