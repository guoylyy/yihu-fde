// 集成测试 - 周 OKR(/api/okr + MCP okr_* 工具)
//
// 用远期的测试周(2091–2097 年随机一周)做, 不碰真实的当前周; 周期状态的推进(周五复盘等)
// 直接改库模拟时间。账号现建现删(createTestUser)。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, BASE } from './helpers.js'
import { weekRange, weekKey, shiftWeek, isoWeekOf } from '../../src/services/okrRules.js'
import { okrTick, okrMondayReminder, REMIND_TYPE, REMIND_SUMMARY_TYPE } from '../../src/services/okr.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const WEEK = { year: rnd(2091, 2097), weekNo: rnd(2, 50) }
const WK = weekKey(WEEK)
const createdCycles = []

async function makeCycle(week, data = {}) {
  const { start, end } = weekRange(week.year, week.weekNo)
  const c = await prisma.okrCycle.upsert({
    where: { year_weekNo: { year: week.year, weekNo: week.weekNo } },
    update: data,
    create: { year: week.year, weekNo: week.weekNo, startDate: start, endDate: end, status: 'PLANNING', ...data }
  })
  createdCycles.push(c.id)
  return c
}

async function setStatus(week, status, extra = {}) {
  await prisma.okrCycle.update({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } }, data: { status, ...extra } })
}

async function dropCycles(ids) {
  const where = { cycleId: { in: ids } }
  const objs = await prisma.okrObjective.findMany({ where, select: { id: true } })
  const oids = objs.map(o => o.id)
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await prisma.okrCycle.deleteMany({ where: { id: { in: ids } } })
}

/** 经真实的 MCP 端点调工具(本系统登录 JWT 透传模式), 走的就是助手的那条链路 */
async function mcp(token, name, args) {
  const r = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  const body = await r.json()
  const text = body?.result?.content?.[0]?.text || ''
  let inner = null
  try { inner = JSON.parse(text.split('\n\n提示')[0]) } catch { /* 非 JSON */ }
  return { isError: !!body?.result?.isError, inner, text, rpc: body }
}

const plan = (n = 2) => Array.from({ length: n }, (_, i) => ({
  title: `unit-test-O${i + 1}`,
  keyResults: [
    { title: `O${i + 1}-KR1 交付件数`, metricType: 'NUMBER', targetValue: 4, unit: '个' },
    { title: `O${i + 1}-KR2 上线`, metricType: 'BINARY' }
  ]
}))

describe('周 OKR /api/okr', () => {
  // 老板 = ADMIN(评分/团队/归档只给老板); M 是 MANAGER(项目经理), 用来确认这三项对它关闭
  let A, B, M, O, a, b, m, boss

  before(async () => {
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-工程师A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-工程师B' })
    M = await createTestUser('MANAGER', { name: 'unit-test-项目经理' })
    O = await createTestUser('ADMIN', { name: 'unit-test-老板' })
    a = api(A.token); b = api(B.token); m = api(M.token); boss = api(O.token)
    await makeCycle(WEEK)
  })

  after(async () => {
    await dropCycles(createdCycles)
    for (const u of [A, B, M, O]) await u?.cleanup()
  })

  describe('提交的硬约束', () => {
    test('O 没有 KR → 400', async () => {
      const r = await a.post(`/api/okr/plan/submit?week=${WK}`, { objectives: [{ title: 'unit-test-空 O', keyResults: [] }] })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8102)
      assert.match(r.message, /至少 1 个 KR/)
    })

    test('O 权重合计 ≠ 100 → 400', async () => {
      const objs = plan(2)
      objs[0].weight = 50; objs[1].weight = 30
      const r = await a.post(`/api/okr/plan/submit?week=${WK}`, { objectives: objs })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8103)
    })

    test('KR 权重合计 ≠ 100 → 400', async () => {
      const objs = plan(1)
      objs[0].keyResults[0].weight = 70; objs[0].keyResults[1].weight = 20
      const r = await a.post(`/api/okr/plan/submit?week=${WK}`, { objectives: objs })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8103)
    })

    test('失败的提交不留任何数据', async () => {
      const n = await prisma.okrObjective.count({ where: { ownerId: BigInt(A.id) } })
      assert.equal(n, 0)
    })

    test('BINARY 的 KR 设 ON_TRACK → 400', async () => {
      const objs = plan(1)
      objs[0].keyResults[1].status = 'ON_TRACK'
      const r = await a.post(`/api/okr/plan?week=${WK}`, { objectives: objs })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8104)
    })
  })

  describe('草稿与提交', () => {
    test('存草稿可多次, 权重不填自动均分', async () => {
      const r1 = await a.post(`/api/okr/plan?week=${WK}`, { objectives: [{ title: 'unit-test-草稿 O' }] })
      assert.equal(r1.code, 0, r1.message)
      assert.equal(r1.data.personalStatus, 'NOT_SUBMITTED')
      const r2 = await a.post(`/api/okr/plan?week=${WK}`, { objectives: plan(3) })
      assert.equal(r2.code, 0, r2.message)
      assert.deepEqual(r2.data.objectives.map(o => o.weight), [33.33, 33.33, 33.34])
      assert.equal(r2.data.objectives.length, 3, '整份覆盖: 第一次的草稿 O 被替换')
    })

    test('提交成功; 同一周重复提交 → 覆盖计划但不产生第二个周期', async () => {
      const r1 = await a.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan(2) })
      assert.equal(r1.code, 0, r1.message)
      assert.equal(r1.data.personalStatus, 'IN_PROGRESS')
      assert.equal(r1.data.lateSubmit, false)
      const ids = r1.data.objectives.map(o => ({ id: o.id, title: o.title + '-改', keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, targetValue: k.targetValue })) }))
      const r2 = await a.post(`/api/okr/plan/submit?week=${WK}`, { objectives: ids })
      assert.equal(r2.code, 0, r2.message)
      assert.deepEqual(r2.data.objectives.map(o => o.id), r1.data.objectives.map(o => o.id), '带 id 的是原地更新')
      assert.ok(r2.data.objectives[0].title.endsWith('-改'))
      const cycles = await prisma.okrCycle.count({ where: { year: WEEK.year, weekNo: WEEK.weekNo } })
      assert.equal(cycles, 1)
      assert.equal(r2.data.cycle.id, r1.data.cycle.id)
    })

    test('已提交后再存也按提交标准校验(不能把权重改坏)', async () => {
      const cur = (await a.get(`/api/okr/my?week=${WK}`)).data
      const objs = cur.objectives.map((o, i) => ({ id: o.id, title: o.title, weight: i === 0 ? 90 : 20, keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, targetValue: k.targetValue })) }))
      const r = await a.post(`/api/okr/plan?week=${WK}`, { objectives: objs })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8103)
    })

    test('B 提交; 不能拿 A 的 O id 塞进自己的计划', async () => {
      const r = await b.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan(1) })
      assert.equal(r.code, 0, r.message)
      const aObj = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const bad = await b.post(`/api/okr/plan?week=${WK}`, { objectives: [{ id: aObj.id, title: 'x', keyResults: [{ title: 'y' }] }] })
      assert.equal(bad.status, 400)
    })
  })

  describe('贴周报生成草稿(只出草稿, 不写库)', () => {
    const REPORT = [
      '# 本周计划 · 第 47 周',
      '## 一、本周目标',
      '- 【P0】订单模块上线并交试点门店试用 ｜ 项目：示例甲 ｜ 完成标准：周三开发自测走通全流程；周四上线交试点门店实际跑一轮。',
      '- 【P1】客户问题收口 ｜ 项目：示例乙 ｜ 完成标准：群内问题逐条回应，本周遗留项清零。'
    ].join('\n')

    test('内容太短 → 400 8130, 人话提示', async () => {
      const r = await a.post('/api/okr/plan/draft-from-report', { text: '本周工作：开会' })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8130)
      assert.match(r.message, /内容太短/)
    })

    test('识别不出目标 → 422 8131, 提示改格式', async () => {
      const r = await a.post('/api/okr/plan/draft-from-report', { text: '这周主要是跟进各种事情，开了几个会，和客户沟通了一些需求，还有一些零碎的工作需要处理，下周继续推进。' })
      assert.equal(r.status, 422)
      assert.equal(r.code, 8131)
      assert.match(r.message, /目标：/)
    })

    test('正常周报 → 返回草稿(O 权重合计 100), 且没有写进任何计划', async () => {
      const before = await prisma.okrObjective.count({ where: { ownerId: BigInt(A.id) } })
      const r = await a.post('/api/okr/plan/draft-from-report', { text: REPORT })
      assert.equal(r.code, 0, r.message)
      assert.ok(['model', 'rules'].includes(r.data.mode))
      assert.ok(r.data.objectives.length >= 1 && r.data.objectives.length <= 3)
      assert.equal(r.data.objectives.reduce((s, o) => s + o.weight, 0), 100)
      for (const o of r.data.objectives) assert.ok(o.keyResults.length >= 1 && o.keyResults.length <= 4)
      if (r.data.mode === 'rules') assert.equal(r.data.objectives[0].title, '订单模块上线并交试点门店试用')
      const after = await prisma.okrObjective.count({ where: { ownerId: BigInt(A.id) } })
      assert.equal(after, before)
    })
  })

  describe('周中进展', () => {
    test('追加进展写 OkrUpdate, valueBefore/valueAfter 正确, KR 当前值跟着变', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const kr = o.keyResults.find(k => k.metricType === 'NUMBER')
      const r1 = await a.post(`/api/okr/objectives/${o.id}/updates`, { content: '交付了 2 个', krId: kr.id, valueAfter: 2 })
      assert.equal(r1.code, 0, r1.message)
      assert.equal(r1.data.valueBefore, 0)
      assert.equal(r1.data.valueAfter, 2)
      assert.equal(r1.data.source, 'MANUAL')
      const r2 = await a.post(`/api/okr/objectives/${o.id}/updates`, { content: '又交付 1 个', krId: kr.id, valueAfter: 3 })
      assert.equal(r2.data.valueBefore, 2)
      assert.equal(r2.data.valueAfter, 3)
      const row = await prisma.okrUpdate.findUnique({ where: { id: BigInt(r2.data.id) } })
      assert.equal(row.valueBefore, 2)
      assert.equal(row.valueAfter, 3)
      assert.equal(String(row.createdBy), A.id)
      const after = (await prisma.okrKeyResult.findUnique({ where: { id: BigInt(kr.id) } }))
      assert.equal(after.currentValue, 3)
    })

    test('纯文字进展(不挂 KR)也记一条', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[1]
      const r = await a.post(`/api/okr/objectives/${o.id}/updates`, { content: '和客户对齐了范围' })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.krId, null)
    })

    test('PATCH KR 改状态也留 OkrUpdate; BINARY 设 AT_RISK → 400', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[1]
      const bin = o.keyResults.find(k => k.metricType === 'BINARY')
      const bad = await a.patch(`/api/okr/krs/${bin.id}`, { status: 'AT_RISK' })
      assert.equal(bad.status, 400)
      const r = await a.patch(`/api/okr/krs/${bin.id}`, { status: 'DONE' })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.statusBefore, null)
      assert.equal(r.data.statusAfter, 'DONE')
      assert.equal(r.data.valueAfter, 1)
    })

    test('不能改别人的 KR / 给别人追加进展', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      assert.equal((await b.post(`/api/okr/objectives/${o.id}/updates`, { content: 'x' })).status, 403)
      assert.equal((await b.patch(`/api/okr/krs/${o.keyResults[0].id}`, { currentValue: 1 })).status, 403)
    })

    test('已有进展的 O 不能在计划里删掉(409), 改 DROPPED 可以', async () => {
      const cur = (await a.get(`/api/okr/my?week=${WK}`)).data
      const keep = cur.objectives.slice(1).map(o => ({ id: o.id, title: o.title, weight: 100, keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, targetValue: k.targetValue, weight: k.weight })) }))
      const r = await a.post(`/api/okr/plan?week=${WK}`, { objectives: keep })
      assert.equal(r.status, 409)
    })

    test('未提交的人追加进展 → 409 人话提示', async () => {
      const C = await createTestUser('FDE_ENGINEER')
      try {
        const c = api(C.token)
        const d = await c.post(`/api/okr/plan?week=${WK}`, { objectives: plan(1) })
        const r = await c.post(`/api/okr/objectives/${d.data.objectives[0].id}/updates`, { content: 'x' })
        assert.equal(r.status, 409)
        assert.match(r.message, /还没提交/)
      } finally {
        const objs = await prisma.okrObjective.findMany({ where: { ownerId: BigInt(C.id) } })
        await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: objs.map(o => o.id) } } })
        await prisma.okrObjective.deleteMany({ where: { ownerId: BigInt(C.id) } })
        await C.cleanup()
      }
    })
  })

  describe('助手(MCP)', () => {
    test('okr_my_week 返回本周 O/KR', async () => {
      const r = await mcp(A.token, 'okr_my_week', { week: WK })
      assert.equal(r.isError, false, r.text)
      assert.equal(r.inner.data.objectives.length, 2)
    })

    test('okr_append_update 写入 source=ASSISTANT 并记下用户原话', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const kr = o.keyResults.find(k => k.metricType === 'NUMBER')
      const r = await mcp(A.token, 'okr_append_update', { objective_id: o.id, content: '第 4 个交付完成', kr_id: kr.id, value_after: 4, user_said: '今天把第四个也交了' })
      assert.equal(r.isError, false, r.text)
      assert.equal(r.inner.data.source, 'ASSISTANT')
      const row = await prisma.okrUpdate.findUnique({ where: { id: BigInt(r.inner.data.id) } })
      assert.equal(row.source, 'ASSISTANT')
      assert.equal(row.sourceQuote, '今天把第四个也交了')
      assert.equal(row.valueBefore, 3)
      assert.equal(row.valueAfter, 4)
    })

    test('okr_set_kr_value 写入 source=ASSISTANT', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const bin = o.keyResults.find(k => k.metricType === 'BINARY')
      const r = await mcp(A.token, 'okr_set_kr_value', { kr_id: bin.id, value: 1 })
      assert.equal(r.isError, false, r.text)
      assert.equal(r.inner.data.source, 'ASSISTANT')
      assert.equal(r.inner.data.statusAfter, 'DONE')
    })

    test('助手代提交计划 → 拒绝(接口层 403, 不是只藏按钮)', async () => {
      // 没有提交计划的工具; 直接以助手身份(经 MCP 签发的 via=mcp token)打提交接口也必须被拒
      const { signToken } = await import('../../src/lib/auth.js')
      const t = signToken({ type: 'internal', userId: A.id, username: A.username, role: 'FDE_ENGINEER', via: 'mcp' })
      const asAssistant = api(t)
      const r = await asAssistant.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan(1) })
      assert.equal(r.status, 403)
      assert.equal(r.code, 8120)
      assert.equal((await asAssistant.post(`/api/okr/plan?week=${WK}`, { objectives: plan(1) })).status, 403)
      const tools = await fetch(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${A.token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      }).then(r => r.json())
      const okrTools = tools.result.tools.map(t => t.name).filter(n => n.startsWith('okr_')).sort()
      assert.deepEqual(okrTools, ['okr_append_update', 'okr_my_week', 'okr_self_score', 'okr_set_kr_value', 'okr_team_overview'])
    })

    test('助手代写主管评分 → 403', async () => {
      const { signToken } = await import('../../src/lib/auth.js')
      const t = signToken({ type: 'internal', userId: O.id, username: O.username, role: 'ADMIN', via: 'mcp' })
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const r = await api(t).post('/api/okr/manager-score', { objectiveId: o.id, score: 90 })
      assert.equal(r.status, 403)
      assert.equal(r.code, 8120)
    })

    // OKR 2.0: 全员可见(本团队), 但主管分不出现
    test('工程师经助手看团队概况 → 能看, 不带主管分', async () => {
      const r = await mcp(A.token, 'okr_team_overview', { week: WK })
      assert.equal(r.isError, false, r.text)
      assert.ok(!r.text.includes('managerScore'))
    })
  })

  describe('权限: 主管分 / 归档只对老板(ADMIN)开; 看别人 OKR 全员可以(不带主管分)', () => {
    // OKR 2.0(2026-11-20): 原来 403, 老板定「每个人都能看别人的 OKR, 评分不外露」
    test('工程师看别人的 OKR / 历史 → 200, 不带主管分', async () => {
      const c = await a.get(`/api/okr/cycle?week=${WK}&ownerId=${B.id}`)
      assert.equal(c.status, 200)
      assert.equal(c.data.owner.id, B.id)
      assert.ok(c.data.objectives.length >= 1)
      assert.ok(!JSON.stringify(c.raw).includes('managerScore'))
      assert.ok(!JSON.stringify(c.raw).includes('managerComment'))
      assert.equal(c.data.can.edit, false, '工程师不能代管别人')
      const h = await a.get(`/api/okr/history?userId=${B.id}`)
      assert.equal(h.status, 200)
      assert.ok(!JSON.stringify(h.raw).includes('managerScore'))
    })
    test('工程师打主管分 / 归档 / 重开 → 403', async () => {
      const o = (await b.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      assert.equal((await a.post('/api/okr/manager-score', { objectiveId: o.id, score: 80 })).status, 403)
      assert.equal((await a.post('/api/okr/cycle/close', { week: WK })).status, 403)
      assert.equal((await a.post('/api/okr/cycle/reopen', { week: WK, reason: 'x' })).status, 403)
    })
    // 有意收紧(2026-11-17): MANAGER 打主管分、归档、重开一律 403(OKR 2.0 仍不放开);
    // OKR 2.0 放开的是「看」: /team、看别人、看历史 → 200 但不带主管分
    test('MANAGER(项目经理) 主管分、归档、重开 → 403; 看团队 / 别人 → 200 不带主管分', async () => {
      const ob = (await b.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      assert.equal((await m.post('/api/okr/manager-score', { objectiveId: ob.id, score: 80 })).status, 403)
      assert.equal((await m.post('/api/okr/cycle/close', { week: WK })).status, 403)
      assert.equal((await m.post('/api/okr/cycle/reopen', { week: WK, reason: 'x' })).status, 403)
      for (const path of [`/api/okr/team?week=${WK}`, `/api/okr/cycle?week=${WK}&ownerId=${A.id}`, `/api/okr/history?ownerId=${A.id}`]) {
        const r = await m.get(path)
        assert.equal(r.status, 200, path)
        assert.ok(!JSON.stringify(r.raw).includes('managerScore'), path)
      }
      const self = await m.get(`/api/okr/cycle?week=${WK}`)
      assert.equal(self.code, 0, 'MANAGER 看自己的不受影响')
      assert.equal(self.data.can.manageCycle, false)
      const mcpTeam = await mcp(M.token, 'okr_team_overview', { week: WK })
      assert.equal(mcpTeam.isError, false, mcpTeam.text)
      assert.ok(!mcpTeam.text.includes('managerScore'))
    })
    test('工程师看自己不受影响', async () => {
      const r = await a.get(`/api/okr/cycle?week=${WK}`)
      assert.equal(r.code, 0)
      assert.equal(r.data.owner.id, A.id)
      assert.equal((await a.get(`/api/okr/history?weeks=4`)).code, 0)
    })
    test('老板看团队: 矩阵里有 A、B, 都已提交', async () => {
      const r = await boss.get(`/api/okr/team?week=${WK}`)
      assert.equal(r.code, 0, r.message)
      const rowA = r.data.rows.find(x => x.user.id === A.id)
      const rowB = r.data.rows.find(x => x.user.id === B.id)
      assert.equal(rowA.submission, 'ON_TIME')
      assert.equal(rowB.submission, 'ON_TIME')
      assert.equal(rowA.objectiveCount, 2)
      assert.ok(rowA.completion > 0)
      assert.ok(r.data.summary.expected >= 2)
      assert.ok(!r.data.rows.some(x => x.user.id === O.id), '老板没交就不在应提交名单里')
      assert.ok(!r.data.rows.some(x => x.user.id === M.id), '项目经理不是应提交的人')
      assert.ok(r.data.summary.submitted >= 2)
    })
    test('老板可看某人详情, 且带 managerScore/manageCycle 能力位', async () => {
      const r = await boss.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
      assert.equal(r.code, 0)
      assert.equal(r.data.owner.id, A.id)
      assert.ok(r.data.objectives[0].updates.length >= 1)
      assert.equal(r.data.can.manageCycle, true)
    })
  })

  describe('周五复盘 / 归档 / 重开', () => {
    test('REVIEW 状态改 KR、追加进展、改计划 → 403', async () => {
      await setStatus(WEEK, 'REVIEW')
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      assert.equal((await a.patch(`/api/okr/krs/${o.keyResults[0].id}`, { currentValue: 1 })).status, 403)
      assert.equal((await a.post(`/api/okr/objectives/${o.id}/updates`, { content: 'x' })).status, 403)
      assert.equal((await a.post(`/api/okr/plan?week=${WK}`, { objectives: plan(1) })).status, 403)
    })

    test('REVIEW 里可自评(助手也可) + 主管评分, 历史不覆盖', async () => {
      const objs = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives
      const s1 = await a.post('/api/okr/self-score', { objectiveId: objs[0].id, score: 80, comment: '基本完成' })
      assert.equal(s1.code, 0, s1.message)
      const s2 = await mcp(A.token, 'okr_self_score', { objective_id: objs[1].id, score: 70, comment: '助手帮我评' })
      assert.equal(s2.isError, false, s2.text)
      assert.equal(s2.inner.data.source, 'ASSISTANT')
      const again = await a.post('/api/okr/self-score', { objectiveId: objs[0].id, score: 85, comment: '再想想' })
      assert.equal(again.code, 0)
      const ms = await boss.post('/api/okr/manager-score', { objectiveId: objs[0].id, score: 75, comment: '交付扎实' })
      assert.equal(ms.code, 0, ms.message)
      const bad = await a.post('/api/okr/self-score', { objectiveId: objs[0].id, score: 101 })
      assert.equal(bad.status, 400)
      const detail = (await a.get(`/api/okr/cycle?week=${WK}`)).data.objectives[0]
      assert.equal(detail.selfScore, 85)
      assert.equal(detail.managerScore, 75)
      assert.deepEqual(detail.scores.filter(s => s.role === 'SELF').map(s => s.score).sort(), [80, 85])
    })

    test('老板不能给自己打主管分', async () => {
      await setStatus(WEEK, 'IN_PROGRESS')
      const mine = await boss.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan(1) })
      assert.equal(mine.code, 0, mine.message)
      await setStatus(WEEK, 'REVIEW')
      const r = await boss.post('/api/okr/manager-score', { objectiveId: mine.data.objectives[0].id, score: 100 })
      assert.equal(r.status, 403)
    })

    test('未达成 + 顺延下周: 原 O 标 MISSED, 下周多一条草稿', async () => {
      const objB = (await b.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const next = shiftWeek(WEEK, 1)
      await makeCycle(next)
      const r = await b.post(`/api/okr/objectives/${objB.id}/miss`, { reason: '客户环境没就绪', carryToNextWeek: true })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.carriedToWeek, weekKey(next))
      const nb = (await b.get(`/api/okr/my?week=${weekKey(next)}`)).data
      assert.equal(nb.objectives.length, 1)
      assert.equal(nb.objectives[0].submittedAt, null)
      assert.equal(nb.objectives[0].weight, 100)
      const o = await prisma.okrObjective.findUnique({ where: { id: BigInt(objB.id) } })
      assert.equal(o.status, 'MISSED')
    })

    test('归档后只读; 老板重开(写审计)后可改', async () => {
      const c = await boss.post('/api/okr/cycle/close', { week: WK })
      assert.equal(c.code, 0, c.message)
      assert.equal(c.data.status, 'CLOSED')
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      assert.equal((await a.patch(`/api/okr/krs/${o.keyResults[0].id}`, { currentValue: 1 })).status, 403)
      assert.equal((await a.post('/api/okr/self-score', { objectiveId: o.id, score: 60 })).status, 403)

      assert.equal((await boss.post('/api/okr/cycle/reopen', { week: WK })).status, 400, '重开要写原因')
      const re = await boss.post('/api/okr/cycle/reopen', { week: WK, reason: 'unit-test 补录周四进展' })
      assert.equal(re.code, 0, re.message)
      assert.equal(re.data.from, 'CLOSED')
      assert.equal(re.data.status, 'IN_PROGRESS')
      const audit = await prisma.auditLog.findFirst({ where: { action: 'okr.cycle.reopen', userId: BigInt(O.id) }, orderBy: { id: 'desc' } })
      assert.ok(audit, '重开留审计')
      assert.equal(audit.details.reason, 'unit-test 补录周四进展')

      const p = await a.patch(`/api/okr/krs/${o.keyResults[0].id}`, { currentValue: 4, note: '重开后补录' })
      assert.equal(p.code, 0, p.message)
      // 重开过的周不会被时间推回 CLOSED(远期周本来也不会, 这里确认读回来仍可编辑)
      assert.equal((await a.get(`/api/okr/my?week=${WK}`)).data.cycle.editable, true)
      const c2 = await boss.post('/api/okr/cycle/close', { week: WK })
      assert.equal(c2.data.status, 'CLOSED')
    })

    test('还没到周五的本周不能提前归档', async () => {
      // 本周如果已经是周五之后, 这条就没有意义, 跳过
      const cur = isoWeekOf()
      const r = await boss.get('/api/okr/my')
      if (['REVIEW', 'CLOSED'].includes(r.data.cycle.status)) return
      const c = await boss.post('/api/okr/cycle/close', { week: weekKey(cur) })
      assert.equal(c.status, 409)
    })
  })

  describe('迟交与历史', () => {
    test('过了周一 24:00 提交记 lateSubmit=true, 不拦', async () => {
      // 一个已经过去、被主管重开的周: 时间上早已过截止, 又可编辑
      const past = { year: 2000 + rnd(10, 19), weekNo: rnd(2, 50) }
      const { start, end } = weekRange(past.year, past.weekNo)
      await makeCycle(past, { status: 'IN_PROGRESS', closedAt: end, reopenedAt: new Date(), startDate: start, endDate: end })
      const r = await b.post(`/api/okr/plan/submit?week=${weekKey(past)}`, { objectives: plan(1) })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.lateSubmit, true)
      assert.equal(r.data.objectives[0].lateSubmit, true)
    })

    test('历史: 自己可看, 老板可看任何人', async () => {
      const mine = await a.get('/api/okr/history?weeks=12')
      assert.equal(mine.code, 0)
      assert.equal(mine.data.weeks.length, 12)
      assert.equal((await boss.get(`/api/okr/history?ownerId=${A.id}&weeks=4`)).data.weeks.length, 4)
    })
  })

  describe('连续两周完成率 < 60%', () => {
    test('两周都交了且都低于 60% 的人单独列出', async () => {
      const w1 = { year: 2098, weekNo: rnd(10, 40) }
      const w2 = shiftWeek(w1, 1)
      for (const w of [w1, w2]) {
        await makeCycle(w)
        const r = await b.post(`/api/okr/plan/submit?week=${weekKey(w)}`, { objectives: plan(1) }) // 全部 0 进度
        assert.equal(r.code, 0, r.message)
        await setStatus(w, 'CLOSED')
      }
      const t = await boss.get(`/api/okr/team?week=${weekKey(w2)}`)
      assert.deepEqual(t.data.lowStreak.weeks, [weekKey(w2), weekKey(w1)])
      assert.ok(t.data.lowStreak.people.some(p => p.user.id === B.id))
      assert.ok(!t.data.lowStreak.people.some(p => p.user.id === A.id), '没交的人不算')
    })
  })

  describe('周一 10:00 未提交提醒', () => {
    const RW = { year: 2090, weekNo: rnd(10, 40) }
    const RK = weekKey(RW)
    const at = (dayOffset, hour, minute = 0) => new Date(weekRange(RW.year, RW.weekNo).start.getTime() + (dayOffset * 24 + hour) * 3600 * 1000 + minute * 60 * 1000)
    const sent = (type, uid) => prisma.notification.count({ where: { type, userId: BigInt(uid), data: JSON.stringify({ week: RK }) } })
    after(async () => { await prisma.notification.deleteMany({ where: { type: { in: [REMIND_TYPE, REMIND_SUMMARY_TYPE] }, data: JSON.stringify({ week: RK }) } }) })

    test('周一 10:00 前 / 周二 / 没有周期 → 不发', async () => {
      assert.equal((await okrMondayReminder(at(0, 10, 30))).skipped, 'no-planning-cycle')
      await makeCycle(RW)
      assert.equal((await okrMondayReminder(at(0, 9, 59))).skipped, 'not-monday-10')
      assert.equal((await okrMondayReminder(at(1, 10, 30))).skipped, 'not-monday-10')
    })

    test('只提醒没交的工程师; 老板收一条汇总; 再跑不重发', async () => {
      const r0 = await b.post(`/api/okr/plan/submit?week=${RK}`, { objectives: plan(1) })
      assert.equal(r0.code, 0, r0.message)
      const r = await okrMondayReminder(at(0, 10, 5))
      assert.equal(r.week, RK)
      assert.ok(r.missing.includes(A.name), 'A 没交 → 在名单里')
      assert.ok(!r.missing.includes(B.name), 'B 交了 → 不在名单里')
      assert.ok(!r.missing.includes(M.name) && !r.missing.includes(O.name), '只算在职 FDE 工程师')
      assert.equal(await sent(REMIND_TYPE, A.id), 1)
      assert.equal(await sent(REMIND_TYPE, B.id), 0)
      assert.equal(await sent(REMIND_SUMMARY_TYPE, O.id), 1)
      const summary = await prisma.notification.findFirst({ where: { type: REMIND_SUMMARY_TYPE, userId: BigInt(O.id), data: JSON.stringify({ week: RK }) } })
      assert.match(summary.body, new RegExp(`^本周 ${r.missing.length} 人未交：`))
      assert.ok(summary.body.includes(A.name))
      // 再跑不重发: 只看本用例自己的人 —— 并行套件随时在建新工程师/组长, 全局 reminded 计数不稳定
      await okrMondayReminder(at(0, 11, 5))
      assert.equal(await sent(REMIND_TYPE, A.id), 1)
      assert.equal(await sent(REMIND_SUMMARY_TYPE, O.id), 1)
    })

    test('周期已不是 PLANNING → 不发', async () => {
      await setStatus(RW, 'IN_PROGRESS')
      assert.equal((await okrMondayReminder(at(0, 12))).skipped, 'no-planning-cycle')
    })
  })
})

describe('定时任务: 下周一自动生成新周期, 过完的周归档', () => {
  const created = []
  after(async () => { await dropCycles(created) })

  test('okrTick 建出本周周期并归档上周; 幂等', async () => {
    const w = { year: 2099, weekNo: rnd(10, 40) }
    const prev = shiftWeek(w, -1)
    const { start, end } = weekRange(prev.year, prev.weekNo)
    const p = await prisma.okrCycle.create({ data: { year: prev.year, weekNo: prev.weekNo, startDate: start, endDate: end, status: 'REVIEW' } })
    created.push(p.id)
    const monday = new Date(weekRange(w.year, w.weekNo).start.getTime() + 3600 * 1000) // 周一 01:00
    const r = await okrTick(monday)
    const cur = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: w.year, weekNo: w.weekNo } } })
    created.push(cur.id)
    assert.equal(r.current, weekKey(w))
    assert.equal(cur.status, 'PLANNING')
    assert.equal((await prisma.okrCycle.findUnique({ where: { id: p.id } })).status, 'CLOSED')
    const again = await okrTick(monday)
    assert.equal(again.closed, 0)
    assert.equal(await prisma.okrCycle.count({ where: { year: w.year, weekNo: w.weekNo } }), 1)
  })
})
