// AI 助手的纯逻辑: 口语日期 / 工时 / 优先级解析、对话循环的轮数上限、使用数据 via 标记、没配模型时的人话报错
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { parseDate, parseWeek, weekRange, businessDay, dbDay, tsDay } from '../../src/services/assistant/dates.js'
import { parseHours, parsePriority, matchByName, normalizeForSubmit, submitSpec } from '../../src/services/assistant/drafts.js'
import { runConversation } from '../../src/services/assistant/chat.js'
import { toolsFor, TOOLS } from '../../src/services/assistant/tools.js'
import { isAiCall, matchAction } from '../../src/lib/usage.js'
import { getActiveLlmConfig, LlmNotConfiguredError, NOT_CONFIGURED_MESSAGE, sourceOf } from '../../src/lib/llm.js'
import { signToken } from '../../src/lib/auth.js'
import prisma from '../../src/lib/prisma.js'

// 2026-11-17 周二(北京时间); 用 UTC 12:00 表示, 与机器时区无关
const TUE = new Date('2026-11-17T12:00:00Z')

describe('口语日期', () => {
  const cases = {
    今天: '2026-11-17', 明天: '2026-11-18', 后天: '2026-11-19', 昨天: '2026-11-16',
    周五: '2026-11-20', 周五前: '2026-11-20', 这周五: '2026-11-20', 本周五之前: '2026-11-20', 星期日: '2026-11-22',
    下周三: '2026-11-25', 下周一截止: '2026-11-23', 下下周一: '2026-11-30', 上周五: '2026-11-13',
    '11/20': '2026-11-20', '11-20': '2026-11-20', '11月20日': '2026-11-20', '2026-12-01': '2026-12-01', '2027/1/5': '2027-01-05',
    '20号': '2026-11-20', '5号': '2026-12-05', 月底: '2026-11-30', 下月底: '2026-12-31', '3天后': '2026-11-20',
    这周: '2026-11-20', 下周: '2026-11-27', 周末: '2026-11-22', 明天下午: '2026-11-18'
  }
  for (const [input, want] of Object.entries(cases)) {
    test(`「${input}」→ ${want}`, () => assert.equal(parseDate(input, TUE), want))
  }
  test('认不出的返回 null, 不瞎猜', () => {
    for (const s of ['回头', '尽快', '2026-02-30', '13/40', '', null]) assert.equal(parseDate(s, TUE), null, String(s))
  })
  test('年底说「1/5」指明年', () => assert.equal(parseDate('1/5', new Date('2026-12-20T12:00:00Z')), '2027-01-05'))
  test('北京时间跨天: UTC 16:30 已是北京次日', () => {
    assert.equal(parseDate('今天', new Date('2026-11-17T16:30:00Z')), '2026-11-18')
    assert.equal(tsDay('2026-11-17T16:30:00Z'), '2026-11-18')
    assert.equal(dbDay('2026-11-18T00:00:00.000Z'), '2026-11-18')
  })
  test('周区间(周一~周日)', () => {
    assert.deepEqual(weekRange(TUE), { from: '2026-11-16', to: '2026-11-22' })
    assert.deepEqual(parseWeek('上周', TUE), { from: '2026-11-09', to: '2026-11-15' })
    assert.deepEqual(parseWeek('下周', TUE), { from: '2026-11-23', to: '2026-11-29' })
    assert.deepEqual(parseWeek('2026-11-01', TUE), { from: '2026-10-26', to: '2026-11-01' })
    assert.deepEqual(parseWeek('', TUE), weekRange(TUE))
    assert.equal(businessDay(TUE).toISOString(), '2026-11-17T00:00:00.000Z')
  })
})

describe('草稿字段解析', () => {
  test('小时数', () => {
    assert.equal(parseHours('半天'), 4)
    assert.equal(parseHours('一天'), 8)
    assert.equal(parseHours('2小时'), 2)
    assert.equal(parseHours('1.5h'), 1.5)
    assert.equal(parseHours('90分钟'), 1.5)
    assert.equal(parseHours('三个半小时'), 3.5)
    assert.equal(parseHours(3), 3)
    assert.equal(parseHours('25'), null)
    assert.equal(parseHours('0'), null)
    assert.equal(parseHours('好久'), null)
  })
  test('优先级', () => {
    assert.equal(parsePriority('紧急'), 'URGENT')
    assert.equal(parsePriority('高'), 'HIGH')
    assert.equal(parsePriority('high'), 'HIGH')
    assert.equal(parsePriority('不急'), 'LOW')
    assert.equal(parsePriority('普通'), 'MEDIUM')
    assert.equal(parsePriority('随便'), null)
  })
  test('项目名口语匹配: 去掉「项目」后缀, 全等优先, 其次包含', () => {
    const list = [{ name: '电梯导轨精度检测系统' }, { name: '电梯门机改造' }, { name: '导轨' }]
    assert.deepEqual(matchByName(list, '导轨').map((p) => p.name), ['导轨'])
    assert.deepEqual(matchByName(list, '电梯导轨项目').map((p) => p.name), ['电梯导轨精度检测系统'])
    assert.equal(matchByName(list, '电梯').length, 2)
    assert.equal(matchByName(list, '').length, 0)
  })
  test('确认前的规范化: 白名单 + 必填 + 评论挂载点不许改', async () => {
    const lookup = { project: async () => ({ id: 1 }) }
    const n = await normalizeForSubmit('task', { projectId: '1', title: 'A' }, { title: 'B', dueDate: '周五', hacker: 1, priority: '紧急' }, { lookup, today: TUE })
    assert.deepEqual(n.payload, { projectId: '1', title: 'B', dueDate: '2026-11-20', priority: 'URGENT' })
    assert.deepEqual(n.missing, [])
    const m = await normalizeForSubmit('timesheet', { projectId: '1' }, {}, { lookup, today: TUE })
    assert.deepEqual(m.missing, ['workDate', 'hours', 'workContent'])
    const c = await normalizeForSubmit('comment', { entity: 'task', entityId: '5', content: 'x' }, { entityId: '99', content: 'y' }, { lookup, today: TUE })
    assert.deepEqual(c.payload, { entity: 'task', entityId: '5', content: 'y' })
    const bad = await normalizeForSubmit('task', { projectId: '1', title: 'A' }, { dueDate: '回头' }, { lookup, today: TUE })
    assert.match(bad.error, /截止日期/)
    const out = await normalizeForSubmit('task', { projectId: '1', title: 'A' }, {}, { lookup: { project: async () => null }, today: TUE })
    assert.match(out.error, /无权访问/)
  })
  test('草稿对应的正常业务接口', () => {
    assert.equal(submitSpec('task', { projectId: '1' }).path, '/api/fde/tasks')
    assert.equal(submitSpec('requirement', { projectId: '7', title: 't' }).path, '/api/fde/project-records/7/requirements')
    assert.deepEqual(submitSpec('requirement', { projectId: '7', title: 't' }).body, { title: 't' })
    assert.equal(submitSpec('timesheet', {}).path, '/api/fde/timesheets')
    assert.equal(submitSpec('comment', { entity: 'task', entityId: '3' }).link(), '/admin/tasks?open=3')
  })
})

describe('工具按角色收敛', () => {
  test('工程师拿不到审批类工具, 经理/管理员能拿到; 写类工具全是 draft_*', () => {
    const eng = toolsFor({ role: 'FDE_ENGINEER' }).map((t) => t.name)
    assert.ok(!eng.includes('list_pending_approvals'))
    assert.ok(eng.includes('draft_task') && eng.includes('weekly_report'))
    assert.ok(toolsFor({ role: 'MANAGER' }).some((t) => t.name === 'list_pending_approvals'))
    for (const t of TOOLS) {
      if (t.kind === 'draft') assert.match(t.name, /^draft_/)
      assert.ok(t.description.length > 30, `${t.name} 的说明要写清楚什么时候用`)
    }
  })
})

describe('对话循环', () => {
  const loopForever = async ({ tools }) => (tools ? { content: '', tool_calls: [{ id: 'c' + Math.random(), function: { name: 'x', arguments: '{}' } }] } : { content: '根据已有结果……' })
  test('超过 8 轮工具调用就停, 不带工具再问一次, 如实告诉用户', async () => {
    let n = 0
    const r = await runConversation({ llm: loopForever, system: 's', history: [{ role: 'user', content: 'q' }], tools: [{}], execTool: async () => { n++; return { ok: 1 } } })
    assert.equal(n, 8)
    assert.equal(r.rounds, 8)
    assert.equal(r.stopped, 'max_rounds')
    assert.match(r.reply, /已连续调用 8 轮工具/)
    assert.match(r.reply, /根据已有结果/)
  })
  test('工具抛错不打断对话, 错误交还给模型', async () => {
    const seen = []
    const llm = async ({ messages }) => {
      const last = messages[messages.length - 1]
      if (last.role === 'tool') { seen.push(JSON.parse(last.content)); return { content: '好的' } }
      return { content: '', tool_calls: [{ id: '1', function: { name: 'boom', arguments: 'not json' } }] }
    }
    const r = await runConversation({ llm, system: 's', history: [{ role: 'user', content: 'q' }], tools: [{}], execTool: async () => { throw new Error('炸了') } })
    assert.equal(r.reply, '好的')
    assert.deepEqual(seen, [{ error: '炸了' }])
    assert.deepEqual(r.calls.map((c) => [c.name, c.ok]), [['boom', false]])
  })
})

describe('使用数据: AI 发起的调用带 via=ai', () => {
  test('站内助手(via=ai)与 MCP(via=mcp)都算 AI; 人点按钮不算', () => {
    assert.equal(isAiCall({ via: 'ai' }), true)
    assert.equal(isAiCall({ via: 'mcp' }), true)
    assert.equal(isAiCall({}), false)
  })
  test('新增的需求接口计入使用数据', () => {
    assert.deepEqual(matchAction('POST', '/project-records/12/requirements'), { action: 'requirement.create', detail: { projectId: '12' } })
  })
})

describe('没配模型时给人话错误', () => {
  const OIDC = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'FDE_LLM_STUB']
  async function withoutPlatform(fn) {
    const saved = Object.fromEntries(OIDC.map((k) => [k, process.env[k]]))
    for (const k of OIDC) delete process.env[k]
    const orig = prisma.llmConfig.findFirst
    prisma.llmConfig.findFirst = async () => null   // 库里也没有手填的模型
    try { return await fn() } finally {
      prisma.llmConfig.findFirst = orig
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  }

  test('getActiveLlmConfig 抛 LlmNotConfiguredError, 话是给人看的', async () => {
    await withoutPlatform(async () => {
      await assert.rejects(getActiveLlmConfig(), (e) => e instanceof LlmNotConfiguredError && e.message === '未接入以虎 One，请手填模型或联系管理员')
    })
    assert.equal(NOT_CONFIGURED_MESSAGE, '未接入以虎 One，请手填模型或联系管理员')
    assert.equal(sourceOf({ provider: 'CUSTOM' }), 'manual')
    assert.equal(sourceOf({ provider: 'YIHU_ONE' }), 'platform')
  })

  test('助手接口: status 说不可用 + 原因; chat 返回 503 和同一句人话, 不建会话', async () => {
    await withoutPlatform(async () => {
      const { default: router } = await import('../../src/routes/fde/assistant.js')
      const app = express()
      app.use(express.json())
      app.use('/a', router)
      const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
      const token = signToken({ type: 'internal', userId: 1, username: 'x', role: 'FDE_ENGINEER' })
      const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      const base = `http://127.0.0.1:${server.address().port}/a`
      const origCreate = prisma.agentConversation.create
      let created = 0
      prisma.agentConversation.create = async () => { created++; throw new Error('不该建会话') }
      const origAudit = prisma.auditLog.create
      prisma.auditLog.create = async () => ({})
      try {
        const st = await (await fetch(`${base}/status`, { headers: H })).json()
        assert.equal(st.data.available, false)
        assert.equal(st.data.reason, '未接入以虎 One，请手填模型或联系管理员')
        const r = await fetch(`${base}/chat`, { method: 'POST', headers: H, body: JSON.stringify({ message: '我这周有哪些任务' }) })
        assert.equal(r.status, 503)
        const j = await r.json()
        assert.equal(j.code, 4101)
        assert.equal(j.message, '未接入以虎 One，请手填模型或联系管理员')
        assert.equal(created, 0)
      } finally {
        prisma.agentConversation.create = origCreate
        prisma.auditLog.create = origAudit
        server.close()
      }
    })
  })
})
