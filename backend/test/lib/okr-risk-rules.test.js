// 单元测试 - OKR 10.0 连续未达成的纯规则(isObjectiveMissedInWeek / isPersonMissedInWeek / trailingStreak / streakLevel), 不连数据库
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isObjectiveMissedInWeek, isPersonMissedInWeek, trailingStreak, streakLevel } from '../../src/services/okrRules.js'
import { chainKey, parseRiskWeeks, parseAsOf } from '../../src/services/okrRisk.js'

// 2026-W46: 11-09(一) ~ 11-15(日)
const W46 = { year: 2026, weekNo: 46 }
const o = (status, cur, extra = {}) => ({ status, managerScore: null, keyResults: [{ metricType: 'PERCENT', targetValue: 100, currentValue: cur, weight: 100, status: 'ON_TRACK' }], ...extra })

describe('isObjectiveMissedInWeek', () => {
  test('MISSED 一律算未达成(不看完成率 / 评分 / 周是否结束)', () => {
    assert.equal(isObjectiveMissedInWeek(o('MISSED', 100, { managerScore: 90 }), W46, '2026-11-10'), true)
  })
  test('DONE 不算', () => {
    assert.equal(isObjectiveMissedInWeek(o('DONE', 0), W46, '2026-11-22'), false)
  })
  test('周已过 + 完成率 < 60% + 没评分 → 算', () => {
    assert.equal(isObjectiveMissedInWeek(o('ON_TRACK', 30), W46, '2026-11-16'), true)
    assert.equal(isObjectiveMissedInWeek(o('AT_RISK', 59), W46, '2026-11-16'), true)
  })
  test('周日当天还没过完不算; 完成率 = 60% 不算; 有主管分不算', () => {
    assert.equal(isObjectiveMissedInWeek(o('ON_TRACK', 30), W46, '2026-11-15'), false)
    assert.equal(isObjectiveMissedInWeek(o('ON_TRACK', 60), W46, '2026-11-16'), false)
    assert.equal(isObjectiveMissedInWeek(o('ON_TRACK', 30, { managerScore: 40 }), W46, '2026-11-16'), false)
  })
  test('这周没有这个 O → 不算', () => {
    assert.equal(isObjectiveMissedInWeek(null, W46, '2026-11-16'), false)
  })
})

describe('isPersonMissedInWeek', () => {
  test('交了 + 完成率 < 60% + 周已结束才算', () => {
    assert.equal(isPersonMissedInWeek({ submitted: true, completion: 0.3 }), true)
    assert.equal(isPersonMissedInWeek({ submitted: true, completion: 0.6 }), false)
    assert.equal(isPersonMissedInWeek({ submitted: false, completion: null }), false)
    assert.equal(isPersonMissedInWeek({ submitted: true, completion: 0.3 }, { ended: false }), false)
  })
})

describe('连续周数与档位', () => {
  test('从最近一周往前数, 断了就停', () => {
    assert.equal(trailingStreak([true, true, true]), 3)
    assert.equal(trailingStreak([true, false, true]), 1)
    assert.equal(trailingStreak([true, true, false]), 0)
    assert.equal(trailingStreak([]), 0)
  })
  test('≥2 WARN, ≥3 CRITICAL, 逾期卡点 + ≥2 升 CRITICAL, <2 不预警', () => {
    assert.equal(streakLevel(1, true), null)
    assert.equal(streakLevel(2), 'WARN')
    assert.equal(streakLevel(2, true), 'CRITICAL')
    assert.equal(streakLevel(3), 'CRITICAL')
    assert.equal(streakLevel(5, false), 'CRITICAL')
  })
})

describe('参数', () => {
  test('同一个 O: 负责人 + 标题(空白 / 大小写不敏感)', () => {
    assert.equal(chainKey('1', '  HVR   落地 '), chainKey('1', 'hvr 落地'))
    assert.notEqual(chainKey('1', 'HVR'), chainKey('2', 'HVR'))
  })
  test('weeks 缺省 4, 只收 2–26 的整数', () => {
    assert.equal(parseRiskWeeks(undefined), 4)
    assert.equal(parseRiskWeeks('6'), 6)
    for (const bad of ['1', '27', 'x', '2.5']) assert.throws(() => parseRiskWeeks(bad), e => e.code === 8100)
  })
  test('asOf 是上海日期', () => {
    assert.equal(parseAsOf('2026-11-16').toISOString(), '2026-11-16T04:00:00.000Z')
    assert.throws(() => parseAsOf('2026-02-30'), e => e.code === 8100)
  })
})
