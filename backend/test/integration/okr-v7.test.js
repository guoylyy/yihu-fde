// 集成测试 - OKR 7.0: 从某周复制 O/KR(/plan/copy-from-week)+ 粘贴 Markdown 批量建(/plan/bulk-import)+ 个人模板(/templates)
//
// 测试年份(与其他 OKR 用例错开): 2111–2119 年连续的十来周(以后的周, 周期现建为 IN_PROGRESS, 不会被时间推进), 现建现删, 绝不碰真实周。
// 人物: 工程师 A(主角) / B(同为工程师, 只用来验 403) / M(MANAGER, 和 A 同一团队, 代管); 账号、团队、项目现建现删(客户借最老的现有客户)。
// 来源周(A, 已提交): O1 权重 60 挂项目 P、卡点在 B 且昨天截止(逾期) —— KR: BINARY / NUMBER 10 家 / MILESTONE 3 阶段
//                    O2 权重 40 —— KR: PERCENT / BINARY;   O3 DROPPED(不该被复制)
//                    之后推进进展(数值、阶段、完成), 让「当前值 / 状态被清空」看得出来
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, dropPlanTrail, lockOkrLimits } from './helpers.js'
import { weekRange, weekKey, shanghaiDateKey, MAX_OBJECTIVES } from '../../src/services/okrRules.js'
import { BULK_MAX_OBJECTIVES, BULK_MAX_KRS } from '../../src/services/okrDraft.js'
import { SUBMITTED_MSG } from '../../src/services/okrPlanImport.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2111, 2119)
const BASE = rnd(2, 38)
const wk = i => ({ year: YEAR, weekNo: BASE + i })
const FROM = wk(0)      // 来源周
const TO = wk(1)        // 1 / 4: 复制到空周
const TO_DUP = wk(2)    // 2: 已有同名 O
const TO_SUB = wk(3)    // 3: 目标周已提交(复制 400; 批量 apply 400、preview 可以)
const BULK = wk(4)      // 5 / 6 / 8: preview → apply → 提交
const BULK_CAP = wk(5)  // 6: 超上限截断
const PROXY = wk(6)     // 9: 主管代管
const RACE = wk(7)      // 并发复制
const PARSE = wk(8)     // 7: unparsed
const WEEKS = [FROM, TO, TO_DUP, TO_SUB, BULK, BULK_CAP, PROXY, RACE, PARSE]
const K = w => weekKey(w)

const DAY = 24 * 3600 * 1000
const TODAY = shanghaiDateKey()
const shiftDay = n => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const YESTERDAY = shiftDay(-1)

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const where = { cycleId: c.id }
  const oids = (await prisma.okrObjective.findMany({ where, select: { id: true } })).map(o => o.id)
  await prisma.okrObjectiveProject.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await dropPlanTrail([c.id])
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

async function cycleOf(week) {
  return prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
}

/** 某人某周库里的 O(含 KR) */
async function objsInDb(week, ownerId) {
  const c = await cycleOf(week)
  if (!c) return []
  return prisma.okrObjective.findMany({ where: { cycleId: c.id, ownerId: BigInt(ownerId) }, include: { keyResults: { orderBy: { seq: 'asc' } } }, orderBy: { seq: 'asc' } })
}

const sum = arr => Math.round(arr.reduce((s, x) => s + x, 0) * 100) / 100
const krOf = (objs, title) => objs.flatMap(o => o.keyResults).find(k => k.title === title)

const O1 = 'unit-test-v7 O1 华丰上线'
const O2 = 'unit-test-v7 O2 客户回访'
const O3 = 'unit-test-v7 O3 已放弃'

// 3 个 O / 8 条 KR, 混着三种类型
const MD_3_8 = `# 本周 OKR

## O1 unit-test-v7 订单模块上线
- 周四上线并交试点门店跑一轮
- 培训 ≥3 名 一线用户
- 单测覆盖率 50%

O2：unit-test-v7 客户回访
1. 回访客户 目标：5 家
2. 完成定稿
3. 整理回访纪要

- 【P1】unit-test-v7 文档收口 ｜ 完成标准：手册定稿；FAQ 补齐 10 条以上
`

describe('OKR 7.0 从某周复制 / 粘贴 Markdown 批量建 / 个人模板', () => {
  let A, B, M
  let a, b, m
  let customer, P
  let team
  let src
  let releaseLimits

  before(async () => {
    // 3 个 O 的复制 / 导入、「到上限 8172」都依赖默认上限: 和 okr-limits.test.js 改上限的窗口互斥
    releaseLimits = await lockOkrLimits()
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v7-工程师A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v7-工程师B' })
    M = await createTestUser('MANAGER', { name: 'unit-test-v7-主管M' })
    a = api(A.token); b = api(B.token); m = api(M.token)
    team = await prisma.team.create({ data: { name: uniqName('v7甲').slice(0, 50) } })
    for (const u of [M, A]) await prisma.teamMembership.create({ data: { teamId: team.id, userId: BigInt(u.id) } })
    // 借最老的现有客户挂项目(不现建 / 不删客户, 免得和借「最新客户」的用例撞)
    customer = await prisma.customer.findFirst({ where: { deletedAt: null }, orderBy: { id: 'asc' } })
    assert.ok(customer, '库里至少要有一个客户')
    P = await prisma.project.create({
      data: { code: `UT-V7-${process.pid}-${Date.now()}`.slice(0, 50), name: uniqName('v7项目'), customerId: customer.id, status: 'IN_PROGRESS', createdBy: BigInt(M.id) }
    })
    for (const w of WEEKS) {
      const { start, end } = weekRange(w.year, w.weekNo)
      await prisma.okrCycle.create({ data: { year: w.year, weekNo: w.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS' } })
    }

    // 来源周: A 提交 2 个 O / 5 条 KR(+ 一个 DROPPED), 再推进进展
    const r = await a.post(`/api/okr/plan/submit?week=${K(FROM)}`, {
      objectives: [
        {
          title: O1, weight: 60, projectIds: [String(P.id)],
          blockers: '技术工艺出模板', blockerOwnerId: B.id, blockerDueDate: YESTERDAY, riskLevel: 'HIGH',
          keyResults: [
            { title: 'KR 上线', metricType: 'BINARY', weight: 30 },
            { title: 'KR 客户数', metricType: 'NUMBER', targetValue: 10, unit: '家', weight: 30, blockers: '客户名单等销售给' },
            { title: 'KR 三阶段', metricType: 'MILESTONE', weight: 40, milestones: [
              { name: '出模板', dueDate: shiftDay(3) }, { name: '联调', dueDate: shiftDay(4) }, { name: '上线', dueDate: shiftDay(5) }
            ] }
          ]
        },
        {
          title: O2, weight: 40,
          keyResults: [
            { title: 'KR 覆盖率', metricType: 'PERCENT', targetValue: 80, weight: 50 },
            { title: 'KR 纪要', metricType: 'BINARY', weight: 50 }
          ]
        },
        { title: O3, status: 'DROPPED', keyResults: [{ title: 'KR 放弃的', metricType: 'BINARY' }] }
      ]
    })
    assert.equal(r.code, 0, r.message)
    src = r.data.objectives
    const id = t => krOf(src, t).id
    for (const [kr, body] of [['KR 客户数', { currentValue: 4 }], ['KR 三阶段', { currentValue: 2 }], ['KR 覆盖率', { currentValue: 30 }]]) {
      const p = await a.patch(`/api/okr/krs/${id(kr)}`, body)
      assert.equal(p.code, 0, p.message)
    }
    const c = await a.post(`/api/okr/krs/${id('KR 上线')}/complete`, { done: true })
    assert.equal(c.code, 0, c.message)
  })

  after(async () => {
    for (const w of WEEKS) await dropCycle(w).catch(() => {})
    const uids = [A, B, M].filter(Boolean).map(u => BigInt(u.id))
    if (P) {
      await prisma.okrObjectiveProject.deleteMany({ where: { projectId: P.id } })
      await prisma.project.delete({ where: { id: P.id } }).catch(() => {})
    }
    await prisma.okrTemplate.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
    if (team) {
      await prisma.teamMembership.deleteMany({ where: { teamId: team.id } })
      await prisma.team.delete({ where: { id: team.id } })
    }
    for (const u of [A, B, M]) await u?.cleanup()
    releaseLimits?.()
  })

  // ---------------------------------------------------------------- 复制

  test('1. 复制: 上周 2 个 O / 5 个 KR → 本周 2/5; 当前值归 0、KR 状态空、项目关联保留、DROPPED 不复制、分和进展不带', async () => {
    const r = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(TO) })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.createdObjectives, 2)
    assert.equal(r.data.createdKrs, 5)
    assert.deepEqual(r.data.skipped, [])
    assert.equal(r.data.onBehalfOf, null)
    // 卡点照旧带过来, 截止日保留原值; 已过期在返回里提示
    assert.deepEqual(r.data.overdueBlockers.map(x => [x.title, x.dueDate]), [[O1, YESTERDAY]])
    assert.equal(r.data.objectives.find(o => o.title === O1).blocker.overdue, true)

    const my = await a.get(`/api/okr/cycle?week=${K(TO)}`)
    assert.equal(my.code, 0, my.message)
    const objs = my.data.objectives
    assert.deepEqual(objs.map(o => [o.title, o.weight]), [[O1, 60], [O2, 40]], '标题 / 权重 / 顺序照旧, O3(DROPPED) 不复制')
    assert.equal(my.data.submission, 'NONE', '复制出来的是草稿, 不提交')
    for (const o of objs) {
      assert.equal(o.submittedAt, null)
      assert.equal(o.selfScore, null)
      assert.equal(o.status, 'ON_TRACK')
      assert.equal(o.riskLevel, 'LOW', '风险等级每周重评, 不复制')
      assert.deepEqual(o.updates, [], '进展不复制')
      assert.deepEqual(o.scores, [], '评分不复制')
      for (const k of o.keyResults) {
        assert.equal(k.currentValue, 0, `${k.title} 当前值归 0`)
        assert.equal(k.status, null, `${k.title} 状态清空`)
      }
    }
    const o1 = objs[0]
    assert.deepEqual(o1.projects.map(p => p.id), [String(P.id)], '项目关联保留')
    assert.deepEqual(o1.blocker, { text: '技术工艺出模板', ownerId: B.id, ownerName: B.name, dueDate: YESTERDAY, overdue: true })
    assert.deepEqual(o1.keyResults.map(k => [k.title, k.metricType, k.unit, k.targetValue, k.weight]), [
      ['KR 上线', 'BINARY', null, 1, 30], ['KR 客户数', 'NUMBER', '家', 10, 30], ['KR 三阶段', 'MILESTONE', null, 3, 40]
    ])
    assert.equal(krOf(objs, 'KR 客户数').blockers, '客户名单等销售给', 'KR 卡点说明复制')
    assert.deepEqual(objs[1].keyResults.map(k => [k.title, k.metricType, k.targetValue, k.weight]), [['KR 覆盖率', 'PERCENT', 80, 50], ['KR 纪要', 'BINARY', 1, 50]])

    // 来源周原样不动
    const from = await objsInDb(FROM, A.id)
    assert.equal(from.length, 3)
    assert.equal(krOf(from, 'KR 客户数').currentValue, 4)

    const audit = await prisma.auditLog.findFirst({ where: { userId: BigInt(A.id), action: 'okr.plan.copy' }, orderBy: { id: 'desc' } })
    assert.ok(audit, '写审计 okr.plan.copy')
  })

  test('4. 复制: MILESTONE KR 的阶段明细被复制, done 全部重置为 false', async () => {
    const before = krOf(await objsInDb(FROM, A.id), 'KR 三阶段')
    assert.deepEqual(JSON.parse(before.milestones).map(x => x.done), [true, true, false], '来源周已勾两个阶段')
    const my = await a.get(`/api/okr/my?week=${K(TO)}`)
    const k = krOf(my.data.objectives, 'KR 三阶段')
    assert.deepEqual(k.milestones, [
      { name: '出模板', dueDate: shiftDay(3), done: false },
      { name: '联调', dueDate: shiftDay(4), done: false },
      { name: '上线', dueDate: shiftDay(5), done: false }
    ])
    assert.equal(k.currentValue, 0)
    assert.equal(k.progress, 0)
  })

  test('复制出来的草稿能按现有校验直接提交(不改提交规则)', async () => {
    const my = await a.get(`/api/okr/my?week=${K(TO)}`)
    const body = {
      objectives: my.data.objectives.map(o => ({
        id: o.id, title: o.title, weight: o.weight,
        keyResults: o.keyResults.map(k => ({ id: k.id, title: k.title, metricType: k.metricType, unit: k.unit, targetValue: k.targetValue, weight: k.weight }))
      }))
    }
    const r = await a.post(`/api/okr/plan/submit?week=${K(TO)}`, body)
    assert.equal(r.code, 0, r.message)
    assert.notEqual(r.data.submission, 'NONE')
  })

  test('2. 复制: 本周已有同名 O → 跳过并出现在 skipped, O 数不重复', async () => {
    const pre = await a.post(`/api/okr/plan?week=${K(TO_DUP)}`, { objectives: [{ title: O1, keyResults: [{ title: '自己先写的 KR' }] }] })
    assert.equal(pre.code, 0, pre.message)
    const r = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(TO_DUP) })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.createdObjectives, 1)
    assert.equal(r.data.createdKrs, 2)
    assert.equal(r.data.skipped.length, 1)
    assert.equal(r.data.skipped[0].title, O1)
    assert.match(r.data.skipped[0].reason, /同名/)
    const objs = await objsInDb(TO_DUP, A.id)
    assert.deepEqual(objs.map(o => o.title), [O1, O2], '同名的只有一个')
    assert.deepEqual(objs[0].keyResults.map(k => k.title), ['自己先写的 KR'], '已有的 O 不被动')
    assert.equal(sum(objs.map(o => o.weight)), 100, '追加后权重按比例缩放回 100')
    assert.equal(r.data.weightsRebalanced, true)

    // 再复制一次: 两个都同名, 什么都不建
    const again = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(TO_DUP) })
    assert.equal(again.code, 0, again.message)
    assert.equal(again.data.createdObjectives, 0)
    assert.deepEqual(again.data.skipped.map(s => s.title), [O1, O2])
    assert.equal((await objsInDb(TO_DUP, A.id)).length, 2)
  })

  test('3. 复制: 目标周已提交 → 400「目标周已提交计划，先撤回或由主管修改」, 一个都不建', async () => {
    const sub = await a.post(`/api/okr/plan/submit?week=${K(TO_SUB)}`, { objectives: [{ title: 'unit-test-v7 已提交的 O', keyResults: [{ title: 'KR x' }] }] })
    assert.equal(sub.code, 0, sub.message)
    const r = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(TO_SUB) })
    assert.equal(r.status, 400)
    assert.equal(r.code, 8171)
    assert.equal(r.message, SUBMITTED_MSG)
    assert.equal(r.message, '目标周已提交计划，先撤回或由主管修改')
    assert.equal((await objsInDb(TO_SUB, A.id)).length, 1)
  })

  test('复制: 参数校验 —— 同一周 / 周格式不对 / objectiveIds 不是 id 数组 → 400', async () => {
    const same = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(FROM) })
    assert.equal(same.status, 400)
    assert.equal(same.code, 8170)
    const bad = await a.post('/api/okr/plan/copy-from-week', { fromWeek: 'W47', toWeek: K(TO) })
    assert.equal(bad.status, 400)
    assert.equal(bad.code, 8100)
    const ids = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(RACE), objectiveIds: ['abc'] })
    assert.equal(ids.status, 400)
    assert.equal(ids.code, 8170)
  })

  test('复制: 两个请求同时复制到同一个空周 → 只建一份, 后到的全部进 skipped', async () => {
    const body = { fromWeek: K(FROM), toWeek: K(RACE) }
    const [r1, r2] = await Promise.all([a.post('/api/okr/plan/copy-from-week', body), a.post('/api/okr/plan/copy-from-week', body)])
    assert.equal(r1.code, 0, r1.message)
    assert.equal(r2.code, 0, r2.message)
    assert.deepEqual([r1.data.createdObjectives, r2.data.createdObjectives].sort(), [0, 2])
    const objs = await objsInDb(RACE, A.id)
    assert.deepEqual(objs.map(o => o.title), [O1, O2])
  })

  // ---------------------------------------------------------------- 批量导入

  test('5. 批量导入 preview: 3 O / 8 KR 的 Markdown → 解析出 3/8, 不落库(库里 O 数为 0)', async () => {
    const r = await a.post('/api/okr/plan/bulk-import', { week: K(BULK), text: MD_3_8, mode: 'preview' })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.mode, 'preview')
    assert.deepEqual(r.data.parsed, { objectives: 3, krs: 8 })
    assert.equal(r.data.objectives.length, 3)
    assert.equal(r.data.objectives.reduce((s, o) => s + o.keyResults.length, 0), 8)
    assert.deepEqual(r.data.objectives.map(o => o.title), ['unit-test-v7 订单模块上线', 'unit-test-v7 客户回访', 'unit-test-v7 文档收口'])
    assert.equal(r.data.truncated, false)
    assert.equal(r.data.submitted, false)
    assert.deepEqual(r.data.unparsed, [{ line: 1, text: '# 本周 OKR' }], '一级标题(文档名)不当 O, 进 unparsed')
    assert.equal((await objsInDb(BULK, A.id)).length, 0, 'preview 不落库')
    const audit = await prisma.auditLog.count({ where: { userId: BigInt(A.id), action: 'okr.plan.bulk' } })
    assert.equal(audit, 0, 'preview 不写审计')
  })

  test('8. 批量导入: metricType 自动判定 —— ≥3 名 → NUMBER、50% → PERCENT、完成定稿 → BINARY、目标：5 家 → NUMBER', async () => {
    const r = await a.post('/api/okr/plan/bulk-import', { week: K(BULK), text: MD_3_8, mode: 'preview' })
    const k = t => r.data.objectives.flatMap(o => o.keyResults).find(x => x.title === t)
    assert.deepEqual(k('培训 ≥3 名 一线用户'), { title: '培训 ≥3 名 一线用户', metricType: 'NUMBER', unit: '名', targetValue: 3, weight: 33.33, line: 5 })
    assert.equal(k('单测覆盖率 50%').metricType, 'PERCENT')
    assert.equal(k('单测覆盖率 50%').targetValue, 50)
    assert.equal(k('完成定稿').metricType, 'BINARY')
    assert.equal(k('完成定稿').targetValue, null)
    assert.equal(k('回访客户').metricType, 'NUMBER', '「目标：5 家」从标题里去掉, 抽成目标值')
    assert.equal(k('回访客户').targetValue, 5)
    assert.equal(k('回访客户').unit, '家')
    assert.equal(k('FAQ 补齐 10 条以上').metricType, 'NUMBER')
  })

  test('6. 批量导入 apply: 落库成功, O 权重合计 100、每个 O 的 KR 权重合计 100; 审计 okr.plan.bulk; 导入的草稿能按现有校验提交', async () => {
    const r = await a.post('/api/okr/plan/bulk-import', { week: K(BULK), text: MD_3_8, mode: 'apply' })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.createdObjectives, 3)
    assert.equal(r.data.createdKrs, 8)
    assert.equal(r.data.truncated, false)
    assert.ok(r.data.objectives.every(o => /^\d+$/.test(o.id)), 'apply 返回带新建的 id')
    const objs = await objsInDb(BULK, A.id)
    assert.equal(objs.length, 3)
    assert.equal(objs.flatMap(o => o.keyResults).length, 8)
    assert.equal(sum(objs.map(o => o.weight)), 100, 'O 权重合计 100')
    for (const o of objs) assert.equal(sum(o.keyResults.map(k => k.weight)), 100, `「${o.title}」KR 权重合计 100`)
    assert.deepEqual(objs.map(o => o.weight), [38, 37, 25], '没写权重按 KR 条数(3/3/2)占比分, 取整合计 100')
    // 8. 落库后的类型
    const k = t => objs.flatMap(o => o.keyResults).find(x => x.title === t)
    assert.deepEqual([k('培训 ≥3 名 一线用户').metricType, k('培训 ≥3 名 一线用户').targetValue, k('培训 ≥3 名 一线用户').unit], ['NUMBER', 3, '名'])
    assert.deepEqual([k('单测覆盖率 50%').metricType, k('单测覆盖率 50%').targetValue], ['PERCENT', 50])
    assert.deepEqual([k('完成定稿').metricType, k('完成定稿').targetValue, k('完成定稿').status], ['BINARY', 1, null])
    assert.ok(objs.every(o => !o.submittedAt), '只写草稿, 不提交')

    const audit = await prisma.auditLog.findFirst({ where: { userId: BigInt(A.id), action: 'okr.plan.bulk' }, orderBy: { id: 'desc' } })
    assert.ok(audit, '写审计 okr.plan.bulk')

    const my = await a.get(`/api/okr/my?week=${K(BULK)}`)
    const sub = await a.post(`/api/okr/plan/submit?week=${K(BULK)}`, {
      objectives: my.data.objectives.map(o => ({
        id: o.id, title: o.title, weight: o.weight,
        keyResults: o.keyResults.map(x => ({ id: x.id, title: x.title, metricType: x.metricType, unit: x.unit, targetValue: x.targetValue, weight: x.weight }))
      }))
    })
    assert.equal(sub.code, 0, sub.message)
  })

  test('6. 批量导入: 超过上限 → truncated=true, 实际入库数等于上限(O 不超过计划硬上限, 每 O 的 KR ≤ 6)', async () => {
    const krs = n => Array.from({ length: n }, (_, i) => `- 第 ${i + 1} 条 KR 交付物`).join('\n')
    const text = Array.from({ length: 6 }, (_, i) => `## unit-test-v7 上限 O${i + 1}\n${krs(i === 0 ? 8 : 2)}`).join('\n\n')
    const pv = await a.post('/api/okr/plan/bulk-import', { week: K(BULK_CAP), text, mode: 'preview' })
    assert.equal(pv.code, 0, pv.message)
    assert.deepEqual(pv.data.parsed, { objectives: 6, krs: 18 })
    assert.equal(pv.data.truncated, true, 'preview 就提示会截断')
    assert.deepEqual(pv.data.limits, { maxObjectives: BULK_MAX_OBJECTIVES, maxKrsPerObjective: BULK_MAX_KRS })

    const r = await a.post('/api/okr/plan/bulk-import', { week: K(BULK_CAP), text, mode: 'apply' })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.truncated, true)
    assert.equal(BULK_MAX_OBJECTIVES, Math.min(5, MAX_OBJECTIVES))
    assert.equal(BULK_MAX_KRS, 6)
    const objs = await objsInDb(BULK_CAP, A.id)
    assert.equal(objs.length, BULK_MAX_OBJECTIVES, 'O 入库数 = 上限')
    assert.equal(r.data.createdObjectives, BULK_MAX_OBJECTIVES)
    assert.equal(objs[0].keyResults.length, BULK_MAX_KRS, '8 条 KR 截到 6 条')
    assert.deepEqual(objs[0].keyResults.map(k => k.title).slice(-1), ['第 6 条 KR 交付物'])
    assert.equal(sum(objs.map(o => o.weight)), 100)
    for (const o of objs) assert.equal(sum(o.keyResults.map(k => k.weight)), 100)

    // 周里已满: 再导入一个 O → 400(8172), 不多建
    const full = await a.post('/api/okr/plan/bulk-import', { week: K(BULK_CAP), text: '## unit-test-v7 多出来的\n- 一条 KR', mode: 'apply' })
    if (BULK_MAX_OBJECTIVES >= MAX_OBJECTIVES) {
      assert.equal(full.status, 400)
      assert.equal(full.code, 8172)
      assert.equal((await objsInDb(BULK_CAP, A.id)).length, BULK_MAX_OBJECTIVES)
    }
  })

  test('7. 批量导入: 无法识别的行进 unparsed(带行号), 不影响其它行解析', async () => {
    const text = [
      '随手写的开场白',                       // 1: O 之前的文字
      '- 没有 O 的列表项',                     // 2: O 之前的列表项
      '## unit-test-v7 解析 O1',               // 3
      '- KR 甲',                               // 4
      '这一行是废话',                          // 5: O 里面的非列表文字
      '- KR 乙 目标：3 个',                    // 6
      '',
      '## 本周目标',                           // 8: 没有 KR 的标题(分节) → unparsed
      '',
      '### unit-test-v7 解析 O2（权重 70）',    // 10
      '* [ ] KR 丙',                           // 11
      '- 备注：这一条不是 KR',                  // 12
      'KR2：KR 丁',                            // 13
      '---'                                    // 分隔线忽略
    ].join('\n')
    const r = await a.post('/api/okr/plan/bulk-import', { week: K(PARSE), text, mode: 'preview' })
    assert.equal(r.code, 0, r.message)
    assert.deepEqual(r.data.unparsed, [
      { line: 1, text: '随手写的开场白' },
      { line: 2, text: '- 没有 O 的列表项' },
      { line: 5, text: '这一行是废话' },
      { line: 8, text: '## 本周目标' },
      { line: 12, text: '- 备注：这一条不是 KR' }
    ])
    assert.deepEqual(r.data.objectives.map(o => [o.title, o.keyResults.map(k => k.title)]), [
      ['unit-test-v7 解析 O1', ['KR 甲', 'KR 乙']],
      ['unit-test-v7 解析 O2', ['KR 丙', 'KR 丁']]
    ])
    assert.equal(r.data.objectives[0].keyResults[1].targetValue, 3)
    assert.deepEqual(r.data.objectives.map(o => o.weight), [50, 50], '只给了一个 O 的权重 → 合计不是 100 → 按 KR 条数重算')
    assert.equal((await objsInDb(PARSE, A.id)).length, 0)
  })

  test('批量导入: 已提交的周 apply → 400(8171); preview 仍允许(submitted=true)', async () => {
    const pv = await a.post('/api/okr/plan/bulk-import', { week: K(TO_SUB), text: MD_3_8, mode: 'preview' })
    assert.equal(pv.code, 0, pv.message)
    assert.equal(pv.data.submitted, true)
    assert.equal(pv.data.objectives.length, 2, '已有 1 个 O, 预览按剩余名额截断')
    assert.equal(pv.data.truncated, true)
    const ap = await a.post('/api/okr/plan/bulk-import', { week: K(TO_SUB), text: MD_3_8, mode: 'apply' })
    assert.equal(ap.status, 400)
    assert.equal(ap.code, 8171)
    assert.equal(ap.message, SUBMITTED_MSG)
    assert.equal((await objsInDb(TO_SUB, A.id)).length, 1)
  })

  test('批量导入: 参数校验 —— mode 不对 / text 为空 / 超长 → 400; apply 一个 O 都没识别出 → 400(8172) 并带 unparsed', async () => {
    const mode = await a.post('/api/okr/plan/bulk-import', { week: K(PARSE), text: MD_3_8, mode: 'save' })
    assert.equal(mode.status, 400)
    assert.equal(mode.code, 8170)
    const empty = await a.post('/api/okr/plan/bulk-import', { week: K(PARSE), text: '   ', mode: 'preview' })
    assert.equal(empty.status, 400)
    const long = await a.post('/api/okr/plan/bulk-import', { week: K(PARSE), text: 'x'.repeat(20001), mode: 'preview' })
    assert.equal(long.status, 400)
    const none = await a.post('/api/okr/plan/bulk-import', { week: K(PARSE), text: '今天天气不错\n随便聊聊', mode: 'apply' })
    assert.equal(none.status, 400)
    assert.equal(none.code, 8172)
    assert.equal(none.data.unparsed.length, 2)
    assert.equal((await objsInDb(PARSE, A.id)).length, 0)
  })

  // ---------------------------------------------------------------- 权限

  test('9. 权限: 工程师对别人 targetUserId 复制 / 导入 → 403; 主管(同团队)代管可以, 记操作人', async () => {
    const c = await b.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(PROXY), targetUserId: A.id })
    assert.equal(c.status, 403)
    const pv = await b.post('/api/okr/plan/bulk-import', { week: K(PROXY), text: MD_3_8, mode: 'preview', targetUserId: A.id })
    assert.equal(pv.status, 403)
    const ap = await b.post('/api/okr/plan/bulk-import', { week: K(PROXY), text: MD_3_8, mode: 'apply', targetUserId: A.id })
    assert.equal(ap.status, 403)
    assert.equal((await objsInDb(PROXY, A.id)).length, 0)

    const mc = await m.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(PROXY), targetUserId: A.id, objectiveIds: [src.find(o => o.title === O1).id] })
    assert.equal(mc.code, 0, mc.message)
    assert.equal(mc.data.createdObjectives, 1, 'objectiveIds 只复制指定的')
    assert.deepEqual(mc.data.onBehalfOf, { ownerId: A.id, operatorId: M.id })
    const mi = await m.post('/api/okr/plan/bulk-import', { week: K(PROXY), text: '## unit-test-v7 主管代导入\n- 一条 KR', mode: 'apply', targetUserId: A.id })
    assert.equal(mi.code, 0, mi.message)
    assert.deepEqual(mi.data.onBehalfOf, { ownerId: A.id, operatorId: M.id })
    const objs = await objsInDb(PROXY, A.id)
    assert.deepEqual(objs.map(o => o.title), [O1, 'unit-test-v7 主管代导入'], '建在 A 名下')
    assert.ok(objs.every(o => String(o.operatorId) === M.id), '记代管操作人')
    assert.equal(sum(objs.map(o => o.weight)), 100)
    const audit = await prisma.auditLog.findFirst({ where: { userId: BigInt(M.id), action: 'okr.plan.bulk' }, orderBy: { id: 'desc' } })
    assert.ok(audit, '代管导入记在主管名下')
  })

  // ---------------------------------------------------------------- 模板

  test('模板: 建 / 列 / 删只看自己的; 别人删 → 404; 名字或内容为空 → 400', async () => {
    const c = await a.post('/api/okr/templates', { name: 'unit-test-v7 周模板', contentMd: MD_3_8 })
    assert.equal(c.code, 0, c.message)
    assert.equal(c.data.name, 'unit-test-v7 周模板')
    const list = await a.get('/api/okr/templates')
    assert.deepEqual(list.data.map(t => t.id), [c.data.id])
    assert.equal(list.data[0].contentMd, MD_3_8)
    const other = await b.get('/api/okr/templates')
    assert.deepEqual(other.data, [], '别人看不到')
    const del = await b.del(`/api/okr/templates/${c.data.id}`)
    assert.equal(del.status, 404)
    const bad = await a.post('/api/okr/templates', { name: '', contentMd: 'x' })
    assert.equal(bad.status, 400)
    const ok = await a.del(`/api/okr/templates/${c.data.id}`)
    assert.equal(ok.code, 0, ok.message)
    assert.deepEqual((await a.get('/api/okr/templates')).data, [])
  })
})
