// 集成测试 - v1.6.0 Agent 协作
//   · Agent 注册即发专属 Key(一体一 Key), 停用/换 Key 即旧凭证失效
//   · 专属 Key 走 /api/mcp 回传对话 → source=EXTERNAL + agentProfileId 归属 + 活动审计留痕
//   · add_research_note / add_project_record(CHAT) 沉淀带 Agent 来源
//   · 会话挂项目后进项目维度列表, 项目内他人可看详情
// 测试数据一律自建自清(含审计流水), 不碰库里已有记录。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

const BASE = process.env.TEST_API_BASE || 'http://localhost:3005'

/** 用 Agent 专属 Key 直调 MCP 端点(无状态模式, tools/call 单发即可) */
async function mcpCall(key, name, args) {
  const r = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  const body = await r.json().catch(() => null)
  const text = body?.result?.content?.[0]?.text
  let inner = null
  try { inner = JSON.parse(text) } catch { /* 鉴权失败等场景没有工具结果 */ }
  return { httpStatus: r.status, rpc: body, inner, isError: body?.result?.isError }
}

describe('v1.6.0 Agent 协作', () => {
  let a, agentId, agentKey, projectId, convId, customerId
  const cleanup = { convIds: [], recordIds: [] }

  before(async () => {
    a = api(await login('admin'))
    // 自建专属客户+项目, 不取列表第一条 —— 并行跑时 list[0] 可能命中其他套件
    // 正在创建/清理的 unit-test 客户, 导致中途「客户不存在」(2026-09-10 #855, 同 chat-import)
    const c = await a.post('/api/fde/customers', { name: uniqName('Agent协作客户'), industry: '互联网', scale: 'A' })
    assert.equal(c.code, 0, `建测试客户失败: ${c.message}`)
    customerId = c.data.id
    const p = await a.post('/api/fde/projects', { name: uniqName('Agent协作项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
  })

  after(async () => {
    // 零容忍清理: 会话/消息/记录/审计流水/Key/档案 全部物理删除
    if (cleanup.convIds.length) {
      await prisma.agentMessage.deleteMany({ where: { conversationId: { in: cleanup.convIds.map(BigInt) } } })
      await prisma.agentConversation.deleteMany({ where: { id: { in: cleanup.convIds.map(BigInt) } } })
    }
    if (cleanup.recordIds.length) {
      await prisma.projectRecord.deleteMany({ where: { id: { in: cleanup.recordIds.map(BigInt) } } })
    }
    if (agentId) {
      await prisma.agentActivityLog.deleteMany({ where: { agentProfileId: BigInt(agentId) } })
      await prisma.apiKey.deleteMany({ where: { agentProfileId: BigInt(agentId) } })
      await prisma.agentProfile.deleteMany({ where: { id: BigInt(agentId) } })
    }
    if (projectId) await a.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await a.del(`/api/fde/customers/${customerId}`).catch(() => {})
  })

  // ---------- 注册与 Key 生命周期 ----------

  test('注册 Agent 即发专属 Key, 明文只回一次', async () => {
    const r = await a.post('/api/fde/agent-profiles', {
      name: uniqName('测试Agent'), platform: 'CLAUDE_CODE', capabilities: '调研,纪要'
    })
    assert.equal(r.code, 0, r.message)
    agentId = r.data.id
    agentKey = r.data.apiKey
    assert.ok(agentKey?.startsWith('fde_'), '专属 Key 应是 fde_ 前缀')
    assert.ok(r.data.keyPrefix, '应返回前缀供列表辨识')
  })

  test('列表能看到 Agent, 带沉淀计数字段', async () => {
    const r = await a.get('/api/fde/agent-profiles')
    assert.equal(r.code, 0)
    const mine = r.data.list.find(x => String(x.id) === String(agentId))
    assert.ok(mine, '列表里应有刚注册的 Agent')
    assert.equal(mine.recordCount, 0)
    assert.equal(mine.conversationCount, 0)
  })

  test('停用后专属 Key 立即被 MCP 拒绝, 启用即恢复', async () => {
    await a.patch(`/api/fde/agent-profiles/${agentId}`, { status: 0 })
    const denied = await mcpCall(agentKey, 'get_my_workbench', {})
    assert.equal(denied.httpStatus, 401, '停用的 Agent Key 应 401')
    await a.patch(`/api/fde/agent-profiles/${agentId}`, { status: 1 })
    const ok = await mcpCall(agentKey, 'get_my_workbench', {})
    assert.equal(ok.httpStatus, 200)
    assert.ok(!ok.isError, '启用后应恢复调用')
  })

  test('换 Key 后旧 Key 失效、新 Key 可用', async () => {
    const r = await a.post(`/api/fde/agent-profiles/${agentId}/rotate-key`)
    assert.equal(r.code, 0)
    const newKey = r.data.apiKey
    assert.notEqual(newKey, agentKey)
    const oldDenied = await mcpCall(agentKey, 'get_my_workbench', {})
    assert.equal(oldDenied.httpStatus, 401, '旧 Key 应已吊销')
    agentKey = newKey
    const ok = await mcpCall(agentKey, 'get_my_workbench', {})
    assert.equal(ok.httpStatus, 200)
  })

  // ---------- 对话回传(MCP) ----------

  test('log_agent_conversation 回传落库: EXTERNAL 来源 + Agent 归属 + 审计留痕', async () => {
    const r = await mcpCall(agentKey, 'log_agent_conversation', {
      title: uniqName('对话'),
      projectId: String(projectId),
      messages: [
        { role: 'USER', text: '帮我查一下报表导出为什么超时' },
        { role: 'ASSISTANT', text: '查了慢查询日志, 缺联合索引, 建议加 (project_id, created_at)' }
      ]
    })
    assert.ok(!r.isError, JSON.stringify(r.inner))
    assert.equal(r.inner.code, 0)
    convId = r.inner.data.id
    cleanup.convIds.push(convId)
    assert.equal(r.inner.data.appended, 2)

    const conv = await a.get(`/api/fde/agent-conversations/${convId}`)
    assert.equal(conv.data.source, 'EXTERNAL')
    assert.equal(String(conv.data.agentProfileId), String(agentId), '会话应归属该 Agent')
    assert.equal(String(conv.data.projectId), String(projectId))
    assert.ok(conv.data.customerId, '挂项目时客户应自动带出')
    assert.equal(conv.data.messages.length, 2)

    const acts = await a.get(`/api/fde/agent-profiles/${agentId}/activities`)
    assert.ok(acts.data.list.some(x => x.action === 'log_agent_conversation'), '审计流水应有本次调用')
  })

  test('带 conversationId 续写同一会话', async () => {
    const r = await mcpCall(agentKey, 'log_agent_conversation', {
      conversationId: String(convId),
      messages: [{ role: 'USER', text: '加完索引了, 再帮我确认下' }]
    })
    assert.equal(r.inner.code, 0)
    assert.equal(String(r.inner.data.id), String(convId), '应续写而非新建')
    const conv = await a.get(`/api/fde/agent-conversations/${convId}`)
    assert.equal(conv.data.messages.length, 3)
  })

  test('项目维度会话列表(时间线数据源)带归属人与 Agent 名', async () => {
    const r = await a.get(`/api/fde/agent-conversations/project/${projectId}`)
    assert.equal(r.code, 0)
    const c = r.data.find(x => String(x.id) === String(convId))
    assert.ok(c, '项目下应能查到回传的会话')
    assert.ok(c.ownerName, '应带归属人姓名')
    assert.ok(c.agentName, '应带 Agent 名')
    assert.equal(c.messageCount, 3)
  })

  test('role 非法时拒绝', async () => {
    const r = await mcpCall(agentKey, 'log_agent_conversation', {
      messages: [{ role: 'SYSTEM', text: 'x' }]
    })
    // zod 在 MCP 层就拦下(enum 校验), 或后端 400 —— 两种都算拒绝
    assert.ok(r.isError || r.rpc?.error || r.inner?.code !== 0, '非法 role 不应入库')
  })

  // ---------- 研究记录 / 聊天记录沉淀(MCP) ----------

  test('add_research_note 落 RESEARCH 记录并带 Agent 来源', async () => {
    const r = await mcpCall(agentKey, 'add_research_note', {
      projectId: String(projectId),
      title: uniqName('调研'),
      content: '## 课题\n消息推送选型\n## 结论\n用长连接'
    })
    assert.ok(!r.isError, JSON.stringify(r.inner))
    cleanup.recordIds.push(r.inner.data.id)

    const list = await a.get(`/api/fde/project-records/${projectId}/records?type=RESEARCH`)
    assert.equal(list.data.total, 1)
    assert.equal(list.data.list[0].type, 'RESEARCH')
    assert.ok(list.data.list[0].agentName, '记录应标注 Agent 来源名')
    assert.equal(String(list.data.list[0].createdByAgentId), String(agentId))
  })

  test('add_project_record 支持 CHAT 类型', async () => {
    const r = await mcpCall(agentKey, 'add_project_record', {
      projectId: String(projectId),
      type: 'CHAT',
      title: uniqName('微信聊天'),
      content: '客户: 下周能上线吗\n我方: 可以, 周三发版'
    })
    assert.ok(!r.isError, JSON.stringify(r.inner))
    cleanup.recordIds.push(r.inner.data.id)
    const list = await a.get(`/api/fde/project-records/${projectId}/records?type=CHAT`)
    assert.equal(list.data.total, 1)
    assert.equal(list.data.typeLabels.CHAT, '聊天记录')
  })

  test('沉淀计数随资源增长', async () => {
    const r = await a.get('/api/fde/agent-profiles')
    const mine = r.data.list.find(x => String(x.id) === String(agentId))
    assert.equal(mine.recordCount, 2, '研究+聊天 两条记录')
    assert.equal(mine.conversationCount, 1)
    assert.ok(mine.lastActiveAt, 'Key 使用应刷新活跃时间(自动心跳)')
  })

  // ---------- 人工侧(REST) ----------

  test('人工登录态也能调 /log(不记 Agent 归属), 并可挂/摘项目', async () => {
    const r = await a.post('/api/fde/agent-conversations/log', {
      title: uniqName('人工回传'),
      messages: [{ role: 'user', text: '小写 role 也应被归一化' }]
    })
    assert.equal(r.code, 0, r.message)
    cleanup.convIds.push(r.data.id)
    const conv = await a.get(`/api/fde/agent-conversations/${r.data.id}`)
    assert.equal(conv.data.agentProfileId, null, '人工调用不该记 Agent 归属')
    assert.equal(conv.data.messages[0].role, 'USER')

    const linked = await a.patch(`/api/fde/agent-conversations/${r.data.id}`, { projectId })
    assert.equal(linked.code, 0)
    const unlinked = await a.patch(`/api/fde/agent-conversations/${r.data.id}`, { projectId: null })
    assert.equal(unlinked.code, 0)
    assert.equal(unlinked.data.projectId, null)
  })

  test('挂到无权访问的项目被拒', async () => {
    const r = await a.post('/api/fde/agent-conversations/log', {
      projectId: 99999999,
      messages: [{ role: 'USER', text: 'x' }]
    })
    assert.equal(r.status, 400)
  })

  test('删除 Agent 连带吊销 Key, 已沉淀资源保留', async () => {
    const del = await a.del(`/api/fde/agent-profiles/${agentId}`)
    assert.equal(del.code, 0)
    const denied = await mcpCall(agentKey, 'get_my_workbench', {})
    assert.equal(denied.httpStatus, 401, '删除后 Key 应失效')
    // 资源仍在(归属标记保留)
    const list = await a.get(`/api/fde/project-records/${projectId}/records?type=RESEARCH`)
    assert.equal(list.data.total, 1, '删除 Agent 不应连带删资源')
  })
})
