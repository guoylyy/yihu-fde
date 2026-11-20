// 单元测试 - 周 OKR 纯规则(周期计算 / 计划校验 / 完成度), 不连数据库
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  isoWeekOf, weekRange, parseWeek, shiftWeek, weekKey, weeksInYear, timeStatus, nextStatus, isReopened,
  isLate, isEditable, isScorable, equalWeights, weightsSumOk, normalizePlan, OkrRuleError,
  krProgress, objectiveProgress, personProgress, weightedScore, derivedObjectiveStatus, validScore,
  personalStatus, checkKrStatus
} from '../../src/services/okrRules.js'

const at = s => new Date(s)

describe('周期: 自然周 + ISO 周号(上海时区)', () => {
  test('2026-11-17 是 2026 第 47 周, 周一 11-16 00:00 到周日 11-22 23:59(上海)', () => {
    const w = isoWeekOf(at('2026-11-17T11:00:00Z'))
    assert.deepEqual(w, { year: 2026, weekNo: 47 })
    const { start, end } = weekRange(2026, 47)
    assert.equal(start.toISOString(), '2026-11-15T16:00:00.000Z')
    assert.equal(end.toISOString(), '2026-11-22T15:59:59.999Z')
  })

  test('跨午夜按上海日期算: UTC 周日 16:00 已是上海周一', () => {
    assert.deepEqual(isoWeekOf(at('2026-11-15T16:00:00Z')), { year: 2026, weekNo: 47 })
    assert.deepEqual(isoWeekOf(at('2026-11-15T15:59:59Z')), { year: 2026, weekNo: 46 })
  })

  test('跨年: 2026 有 53 周, 2026-W53 的下一周是 2027-W01; 2021-01-01 属于 2020-W53', () => {
    assert.equal(weeksInYear(2026), 53)
    assert.equal(weeksInYear(2025), 52)
    assert.deepEqual(shiftWeek({ year: 2026, weekNo: 53 }, 1), { year: 2027, weekNo: 1 })
    assert.deepEqual(shiftWeek({ year: 2027, weekNo: 1 }, -1), { year: 2026, weekNo: 53 })
    assert.deepEqual(isoWeekOf(at('2021-01-01T04:00:00Z')), { year: 2020, weekNo: 53 })
  })

  test('week 参数解析', () => {
    const now = at('2026-11-17T03:00:00Z')
    assert.deepEqual(parseWeek(undefined, now), { year: 2026, weekNo: 47 })
    assert.deepEqual(parseWeek('current', now), { year: 2026, weekNo: 47 })
    assert.deepEqual(parseWeek('next', now), { year: 2026, weekNo: 48 })
    assert.deepEqual(parseWeek('prev', now), { year: 2026, weekNo: 46 })
    assert.deepEqual(parseWeek('2026-W05', now), { year: 2026, weekNo: 5 })
    assert.equal(parseWeek('2025-W53', now), null) // 2025 只有 52 周
    assert.equal(parseWeek('abc', now), null)
    assert.equal(weekKey({ year: 2026, weekNo: 5 }), '2026-W05')
  })

  test('节奏: 周一 PLANNING → 周二 IN_PROGRESS → 周五 REVIEW → 过完周日 CLOSED', () => {
    const { start, end } = weekRange(2026, 47)
    const c = { startDate: start, endDate: end, status: 'PLANNING' }
    assert.equal(timeStatus(c, at('2026-11-16T02:00:00Z')), 'PLANNING') // 周一 10:00
    assert.equal(timeStatus(c, at('2026-11-17T02:00:00Z')), 'IN_PROGRESS') // 周二
    assert.equal(timeStatus(c, at('2026-11-20T02:00:00Z')), 'REVIEW') // 周五
    assert.equal(timeStatus(c, at('2026-11-23T02:00:00Z')), 'CLOSED') // 下周一
  })

  test('状态只进不退; 重开过的周不随时间自动推进', () => {
    const { start, end } = weekRange(2026, 47)
    const friday = at('2026-11-20T02:00:00Z')
    assert.equal(nextStatus({ startDate: start, endDate: end, status: 'IN_PROGRESS' }, friday), 'REVIEW')
    assert.equal(nextStatus({ startDate: start, endDate: end, status: 'REVIEW' }, at('2026-11-17T02:00:00Z')), null)
    const reopened = { startDate: start, endDate: end, status: 'IN_PROGRESS', closedAt: at('2026-11-23T00:00:00Z'), reopenedAt: at('2026-11-24T00:00:00Z') }
    assert.equal(isReopened(reopened), true)
    assert.equal(nextStatus(reopened, at('2026-11-25T00:00:00Z')), null)
    assert.equal(isReopened({ ...reopened, closedAt: at('2026-11-25T00:00:00Z') }), false)
  })

  test('周一 24:00(上海)之后提交算迟交', () => {
    const { start } = weekRange(2026, 47)
    assert.equal(isLate(start, at('2026-11-16T15:59:59Z')), false) // 周一 23:59:59
    assert.equal(isLate(start, at('2026-11-16T16:00:00Z')), true) // 周二 00:00
  })

  test('哪些状态可改、可评分', () => {
    assert.equal(isEditable('PLANNING'), true)
    assert.equal(isEditable('IN_PROGRESS'), true)
    assert.equal(isEditable('REVIEW'), false)
    assert.equal(isEditable('CLOSED'), false)
    assert.equal(isScorable('REVIEW'), true)
    assert.equal(isScorable('CLOSED'), false)
    assert.equal(isScorable('PLANNING'), false)
  })
})

describe('权重', () => {
  test('均分到 100, 余数给最后一个', () => {
    assert.deepEqual(equalWeights(1), [100])
    assert.deepEqual(equalWeights(3), [33.33, 33.33, 33.34])
    assert.ok(weightsSumOk(equalWeights(7)))
  })
  test('合计允许 ±0.01 误差', () => {
    assert.equal(weightsSumOk([33.33, 33.33, 33.33]), true) // 99.99
    assert.equal(weightsSumOk([33.33, 33.33, 33.32]), false) // 99.98
    assert.equal(weightsSumOk([50, 49]), false)
  })
})

describe('计划校验(提交时的硬约束)', () => {
  const kr = (title, extra = {}) => ({ title, ...extra })

  test('O 没有 KR → 拒绝(8102)', () => {
    assert.throws(() => normalizePlan([{ title: 'A', keyResults: [] }], { strict: true }), e => e instanceof OkrRuleError && e.code === 8102 && e.status === 400)
  })
  test('草稿允许 O 暂时没有 KR', () => {
    const p = normalizePlan([{ title: 'A' }])
    assert.equal(p[0].keyResults.length, 0)
  })
  test('O 权重合计 ≠ 100 → 拒绝(8103)', () => {
    assert.throws(() => normalizePlan([
      { title: 'A', weight: 50, keyResults: [kr('a')] },
      { title: 'B', weight: 40, keyResults: [kr('b')] }
    ], { strict: true }), e => e.code === 8103)
  })
  test('KR 权重合计 ≠ 100 → 拒绝(8103)', () => {
    assert.throws(() => normalizePlan([
      { title: 'A', keyResults: [kr('a', { weight: 60 }), kr('b', { weight: 30 })] }
    ], { strict: true }), e => e.code === 8103 && /KR 权重/.test(e.message))
  })
  test('都不填权重 → 自动均分, 能提交', () => {
    const p = normalizePlan([
      { title: 'A', keyResults: [kr('a1'), kr('a2'), kr('a3')] },
      { title: 'B', keyResults: [kr('b1')] },
      { title: 'C', keyResults: [kr('c1')] }
    ], { strict: true })
    assert.deepEqual(p.map(o => o.weight), [33.33, 33.33, 33.34])
    assert.deepEqual(p[0].keyResults.map(k => k.weight), [33.33, 33.33, 33.34])
  })
  test('最多 3 个 O; DROPPED 不计数也不计权重', () => {
    const four = ['A', 'B', 'C', 'D'].map(t => ({ title: t, keyResults: [kr('x')] }))
    assert.throws(() => normalizePlan(four, { strict: true }), e => e.code === 8101)
    four[3].status = 'DROPPED'
    const p = normalizePlan(four, { strict: true })
    assert.equal(p[3].weight, 0)
    assert.ok(weightsSumOk(p.slice(0, 3).map(o => o.weight)))
  })
  test('至少 1 个 O 才能提交', () => {
    assert.throws(() => normalizePlan([], { strict: true }), e => e.code === 8101)
  })
  test('BINARY 的 KR 状态只允许 DONE/MISSED, 目标值恒为 1', () => {
    assert.throws(() => checkKrStatus('BINARY', 'ON_TRACK'), e => e.code === 8104)
    assert.throws(() => normalizePlan([{ title: 'A', keyResults: [kr('a', { metricType: 'BINARY', status: 'AT_RISK' })] }]), e => e.code === 8104)
    const p = normalizePlan([{ title: 'A', keyResults: [kr('a', { metricType: 'BINARY', targetValue: 9 })] }])
    assert.equal(p[0].keyResults[0].targetValue, 1)
    assert.equal(p[0].keyResults[0].status, null)
  })
  test('数值型 KR 提交时目标值要 > 0; PERCENT 缺省目标 100', () => {
    assert.throws(() => normalizePlan([{ title: 'A', keyResults: [kr('a', { metricType: 'NUMBER' })] }], { strict: true }), e => e.code === 8102)
    const p = normalizePlan([{ title: 'A', keyResults: [kr('a', { metricType: 'PERCENT' })] }], { strict: true })
    assert.equal(p[0].keyResults[0].targetValue, 100)
  })
})

describe('完成度与评分', () => {
  const O = (weight, krs, extra = {}) => ({ weight, status: 'ON_TRACK', keyResults: krs, ...extra })
  const K = (metricType, currentValue, targetValue, weight, status = null) => ({ metricType, currentValue, targetValue, weight, status })

  test('KR 进度: BINARY 看 DONE, 数值型按当前/目标封顶 1', () => {
    assert.equal(krProgress(K('BINARY', 0, 1, 100)), 0)
    assert.equal(krProgress(K('BINARY', 1, 1, 100, 'DONE')), 1)
    assert.equal(krProgress(K('NUMBER', 3, 4, 100, 'ON_TRACK')), 0.75)
    assert.equal(krProgress(K('NUMBER', 9, 4, 100, 'ON_TRACK')), 1)
    assert.equal(krProgress(K('PERCENT', 10, 100, 100, 'DONE')), 1)
  })
  test('O/个人完成度按权重加权, DROPPED 不计', () => {
    const o1 = O(60, [K('NUMBER', 5, 10, 50, 'ON_TRACK'), K('BINARY', 1, 1, 50, 'DONE')]) // 0.75
    const o2 = O(40, [K('BINARY', 0, 1, 100)]) // 0
    assert.equal(objectiveProgress(o1), 0.75)
    assert.equal(personProgress([o1, o2]), 0.45)
    assert.equal(personProgress([o1, { ...o2, status: 'DROPPED' }]), 0.75)
    assert.equal(personProgress([]), null)
  })
  test('加权分数', () => {
    assert.equal(weightedScore([{ weight: 60, selfScore: 80, status: 'ON_TRACK' }, { weight: 40, selfScore: 50, status: 'ON_TRACK' }], 'selfScore'), 68)
    assert.equal(weightedScore([{ weight: 100, selfScore: null, status: 'ON_TRACK' }], 'selfScore'), null)
  })
  test('KR 全 DONE → O 自动 DONE; 手工 MISSED 不被覆盖', () => {
    assert.equal(derivedObjectiveStatus(O(100, [K('BINARY', 1, 1, 100, 'DONE')])), 'DONE')
    assert.equal(derivedObjectiveStatus(O(100, [K('BINARY', 1, 1, 100, 'DONE')], { status: 'MISSED' })), 'MISSED')
    assert.equal(derivedObjectiveStatus(O(100, [K('NUMBER', 1, 2, 100, 'ON_TRACK')], { status: 'DONE' })), 'ON_TRACK')
  })
  test('分数只收 0–100 整数', () => {
    assert.equal(validScore(0), 0)
    assert.equal(validScore('100'), 100)
    for (const bad of [-1, 101, 50.5, '', null, 'x']) assert.throws(() => validScore(bad), e => e.code === 8106)
  })
  test('个人状态标签', () => {
    const sub = { status: 'ON_TRACK', submittedAt: new Date(), selfScore: null }
    assert.equal(personalStatus('IN_PROGRESS', []), 'NOT_SUBMITTED')
    assert.equal(personalStatus('IN_PROGRESS', [{ ...sub, submittedAt: null }]), 'NOT_SUBMITTED')
    assert.equal(personalStatus('IN_PROGRESS', [sub]), 'IN_PROGRESS')
    assert.equal(personalStatus('REVIEW', [sub]), 'NEED_SELF_SCORE')
    assert.equal(personalStatus('REVIEW', [{ ...sub, selfScore: 80 }]), 'REVIEW')
    assert.equal(personalStatus('CLOSED', [sub]), 'CLOSED')
  })
})

describe('补录窗口: 本年第 1 周 ~ 下周', async () => {
  const { creatableRange, isCreatableWeek, isPastWeek, planWritable } = await import('../../src/services/okrRules.js')

  test('2026-W47 时: W01…W48 可建, W49 及以后、去年的周都不行', () => {
    const now = at('2026-11-20T04:00:00Z') // 周五(上海)
    assert.deepEqual(creatableRange(now), { from: { year: 2026, weekNo: 1 }, to: { year: 2026, weekNo: 48 } })
    for (const n of [1, 2, 44, 45, 46, 47, 48]) assert.equal(isCreatableWeek({ year: 2026, weekNo: n }, now), true, `W${n}`)
    assert.equal(isCreatableWeek({ year: 2026, weekNo: 49 }, now), false)
    assert.equal(isCreatableWeek({ year: 2026, weekNo: 50 }, now), false)
    assert.equal(isCreatableWeek({ year: 2025, weekNo: 52 }, now), false)
    assert.equal(isCreatableWeek({ year: 2099, weekNo: 1 }, now), false)
  })

  test('跨年: 2026-12-31 属 2026-W53, 下周是 2027-W01 —— 两者都可建, 2027-W02 不行', () => {
    const now = at('2026-12-31T04:00:00Z')
    assert.deepEqual(isoWeekOf(now), { year: 2026, weekNo: 53 })
    assert.deepEqual(creatableRange(now).to, { year: 2027, weekNo: 1 })
    assert.equal(isCreatableWeek({ year: 2026, weekNo: 1 }, now), true)
    assert.equal(isCreatableWeek({ year: 2027, weekNo: 1 }, now), true)
    assert.equal(isCreatableWeek({ year: 2027, weekNo: 2 }, now), false)
  })

  test('新年第一周: 只能补本年 W01, 去年的周不再能新建', () => {
    const now = at('2027-01-06T04:00:00Z') // 2027-W01 周三
    assert.deepEqual(isoWeekOf(now), { year: 2027, weekNo: 1 })
    assert.equal(isCreatableWeek({ year: 2026, weekNo: 53 }, now), false)
    assert.equal(isCreatableWeek({ year: 2027, weekNo: 2 }, now), true)
  })

  test('isPastWeek: 周日 24:00(上海)之后才算过去', () => {
    const { end } = weekRange(2026, 46)
    assert.equal(isPastWeek({ year: 2026, weekNo: 46 }, new Date(end.getTime())), false)
    assert.equal(isPastWeek({ year: 2026, weekNo: 46 }, new Date(end.getTime() + 1)), true)
    assert.equal(isPastWeek({ year: 2026, weekNo: 47 }, at('2026-11-20T04:00:00Z')), false)
  })

  test('planWritable: 进行中可写; 复盘里没交过的人可补; 交过的、已归档的只读', () => {
    assert.equal(planWritable('IN_PROGRESS', true), true)
    assert.equal(planWritable('REVIEW', false), true)
    assert.equal(planWritable('REVIEW', true), false)
    assert.equal(planWritable('CLOSED', false), false)
  })
})
