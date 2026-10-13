// 集成测试 - v1.6.1 聊天记录导入 + 客户轴交互史聚合
//   · POST /project-records/:id/records/parse-chat  粘贴文本规则解析 / 降级纯文本 / 越权 404
//   · GET  /project-records/customer/:id/interactions  客户名下项目的 对接/聊天/会议 记录 + Agent 对话聚合
// 测试数据自建自清。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'

describe('v1.6.1 聊天导入与客户轴聚合', () => {
  let a, customerId, projectId
  const cleanup = { recordIds: [], convIds: [] }

  before(async () => {
    a = api(await login('admin'))
    // 自建专属客户, 不再取列表第一条 —— 并行跑时 list[0] 可能命中 customers.test.js
    // 正在创建/清理的 unit-test 客户, 导致本套件中途「客户不存在」(2026-09-10 #855)
    const c = await a.post('/api/fde/customers', { name: uniqName('聊天导入客户'), industry: '互联网', scale: 'A' })
    assert.equal(c.code, 0, `建测试客户失败: ${c.message}`)
    customerId = c.data.id
    const p = await a.post('/api/fde/projects', { name: uniqName('聊天导入项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
  })

  after(async () => {
    if (cleanup.recordIds.length) {
      await prisma.projectRecord.deleteMany({ where: { id: { in: cleanup.recordIds.map(BigInt) } } })
    }
    if (cleanup.convIds.length) {
      await prisma.agentMessage.deleteMany({ where: { conversationId: { in: cleanup.convIds.map(BigInt) } } })
      await prisma.agentConversation.deleteMany({ where: { id: { in: cleanup.convIds.map(BigInt) } } })
    }
    if (projectId) await a.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await a.del(`/api/fde/customers/${customerId}`).catch(() => {})
  })

  // ---------- parse-chat ----------

  test('微信导出文本解析成轮次', async () => {
    const text = '2026-08-01 10:23:45 张三\n下周能上线吗\n2026-08-01 10:24:02 李四\n可以, 周三发版'
    const r = await a.post(`/api/fde/project-records/${projectId}/records/parse-chat`, { text })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.parsed, true)
    assert.equal(r.data.messages.length, 2)
    assert.deepEqual(r.data.speakers, ['张三', '李四'])
    assert.ok(r.data.occurredAt, '应从消息里带出发生时间')
    assert.ok(r.data.markdown.includes('**张三**'))
  })

  test('认不出格式时降级纯文本(parsed=false, markdown=原文)', async () => {
    const text = '随手记的一段话\n没有聊天格式'
    const r = await a.post(`/api/fde/project-records/${projectId}/records/parse-chat`, { text })
    assert.equal(r.code, 0)
    assert.equal(r.data.parsed, false)
    assert.equal(r.data.markdown, text)
  })

  test('空内容 400 / 无权项目 404', async () => {
    const empty = await a.post(`/api/fde/project-records/${projectId}/records/parse-chat`, { text: '' })
    assert.equal(empty.status, 400)
    const denied = await a.post('/api/fde/project-records/99999999/records/parse-chat', { text: 'x' })
    assert.equal(denied.status, 404)
  })

  test('解析结果可直接存为 CHAT 记录(前端确认流程的后半段)', async () => {
    const text = '2026-08-01 10:23:45 张三\n下周能上线吗\n2026-08-01 10:24:02 李四\n可以'
    const parsed = (await a.post(`/api/fde/project-records/${projectId}/records/parse-chat`, { text })).data
    const r = await a.post(`/api/fde/project-records/${projectId}/records`, {
      type: 'CHAT',
      title: uniqName('聊天'),
      content: parsed.markdown,
      occurredAt: parsed.occurredAt,
      attendees: parsed.speakers.join('、')
    })
    assert.equal(r.code, 0, r.message)
    cleanup.recordIds.push(r.data.id)
  })

  // ---------- 客户轴交互史 ----------

  test('客户交互史聚合: 默认只含 对接/聊天/会议, 带项目编号', async () => {
    // 再补一条 COMM 和一条 RESEARCH(后者不该出现在默认过滤里)
    const comm = await a.post(`/api/fde/project-records/${projectId}/records`, { type: 'COMM', title: uniqName('对接') })
    const research = await a.post(`/api/fde/project-records/${projectId}/records`, { type: 'RESEARCH', title: uniqName('研究') })
    cleanup.recordIds.push(comm.data.id, research.data.id)

    const r = await a.get(`/api/fde/project-records/customer/${customerId}/interactions?page_size=50`)
    assert.equal(r.code, 0, r.message)
    const mine = r.data.records.list.filter(x => String(x.projectId) === String(projectId))
    assert.equal(mine.length, 2, '本项目应聚合出 CHAT+COMM 两条')
    assert.ok(mine.every(x => ['CHAT', 'COMM'].includes(x.type)), 'RESEARCH 不该进默认交互史')
    assert.ok(mine.every(x => x.projectCode), '每条都应带项目编号')
  })

  test('type=CHAT 过滤生效', async () => {
    const r = await a.get(`/api/fde/project-records/customer/${customerId}/interactions?type=CHAT&page_size=50`)
    const mine = r.data.records.list.filter(x => String(x.projectId) === String(projectId))
    assert.equal(mine.length, 1)
    assert.equal(mine[0].type, 'CHAT')
  })

  test('挂到客户项目的 Agent 对话一并聚合', async () => {
    const conv = await a.post('/api/fde/agent-conversations/log', {
      title: uniqName('客户轴对话'),
      projectId,
      messages: [{ role: 'USER', text: '客户问进度' }, { role: 'ASSISTANT', text: '已回复周三发版' }]
    })
    assert.equal(conv.code, 0)
    cleanup.convIds.push(conv.data.id)

    const r = await a.get(`/api/fde/project-records/customer/${customerId}/interactions`)
    const c = r.data.conversations.find(x => String(x.id) === String(conv.data.id))
    assert.ok(c, '交互史应包含挂到客户项目的会话')
    assert.equal(c.messageCount, 2)
    assert.ok(c.ownerName)
  })

  test('客户不存在 404', async () => {
    const r = await a.get('/api/fde/project-records/customer/99999999/interactions')
    assert.equal(r.status, 404)
  })
})
