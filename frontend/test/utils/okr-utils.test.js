// 周 OKR 前端小工具: 周号算法必须与后端 okrRules 一致, 页面上的提交前检查与后端同口径
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isoWeekOf, shiftKey, weekKey, shDate, equalWeights, weightsOk, planProblems, rebalance, krValueText, toDraft } from '../../src/views/okr/okrUtils.js'
import * as backend from '../../../backend/src/services/okrRules.js'

describe('周号与日期', () => {
  test('与后端算法逐日一致(2020–2030 每 13 小时取一个点)', () => {
    for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2030, 11, 31); t += 13 * 3600 * 1000) {
      const d = new Date(t)
      assert.deepEqual(isoWeekOf(d), backend.isoWeekOf(d), d.toISOString())
    }
  })
  test('翻周跨年', () => {
    assert.equal(shiftKey('2026-W53', 1), '2027-W01')
    assert.equal(shiftKey('2027-W01', -1), '2026-W53')
    assert.equal(shiftKey('2026-W47', 1), '2026-W48')
    assert.equal(weekKey({ year: 2026, weekNo: 5 }), '2026-W05')
  })
  test('上海日期', () => {
    assert.equal(shDate('2026-11-15T16:00:00.000Z'), '11-16')
    assert.equal(shDate('2026-11-22T15:59:59.999Z'), '11-22')
  })
})

describe('权重与提交前检查', () => {
  test('均分与后端一致', () => {
    for (let n = 1; n <= 10; n++) assert.deepEqual(equalWeights(n), backend.equalWeights(n))
  })
  test('±0.01 容差', () => {
    assert.equal(weightsOk([{ weight: 33.33 }, { weight: 33.33 }, { weight: 33.33 }]), true)
    assert.equal(weightsOk([{ weight: 50 }, { weight: 40 }]), false)
  })
  test('O 无 KR、权重不对、标题空都会提示', () => {
    const t = (k) => k
    assert.deepEqual(planProblems([], t), ['okr.need_one_objective'])
    const p = planProblems([{ title: 'A', weight: 60, keyResults: [] }, { title: '', weight: 30, keyResults: [{ title: 'x', weight: 100 }] }], t)
    assert.ok(p.includes('okr.objective_needs_kr'))
    assert.ok(p.includes('okr.objective_needs_title'))
    assert.ok(p.includes('okr.objective_weight_sum'))
  })
  test('rebalance 跳过 DROPPED', () => {
    const items = rebalance([{ weight: 0 }, { weight: 0, status: 'DROPPED' }, { weight: 0 }])
    assert.deepEqual(items.map(i => i.weight), [50, 0, 50])
  })
  test('一份合法计划没有问题', () => {
    const draft = toDraft([{ id: '1', title: 'A', weight: 100, status: 'ON_TRACK', keyResults: [{ id: '2', title: 'k', metricType: 'BINARY', weight: 100 }] }])
    assert.deepEqual(planProblems(draft), [])
  })
})

test('KR 值展示', () => {
  const t = (k) => k
  assert.equal(krValueText({ metricType: 'BINARY', status: 'DONE' }, t), 'okr.done')
  assert.equal(krValueText({ metricType: 'BINARY', status: null }, t), 'okr.not_done')
  assert.equal(krValueText({ metricType: 'NUMBER', currentValue: 3, targetValue: 4, unit: '个' }, t), '3/4个')
  assert.equal(krValueText({ metricType: 'PERCENT', currentValue: 50, targetValue: 100 }, t), '50/100%')
})

test('数值型 KR 没有目标值 → 提交前就提示(与后端 8102 同口径)', () => {
  const t = (k) => k
  const draft = [{ title: 'A', weight: 100, keyResults: [{ title: 'k', metricType: 'NUMBER', targetValue: null, weight: 100 }] }]
  assert.deepEqual(planProblems(draft, t), ['okr.kr_needs_target'])
  draft[0].keyResults[0].metricType = 'PERCENT'
  assert.deepEqual(planProblems(draft, t), [])
})
