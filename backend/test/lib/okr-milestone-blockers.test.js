// 单测 - OKR 6.0 纯规则: 阶段型 KR(MILESTONE)与卡点 / 风险
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePlan, normalizeMilestones, milestonesWithDone, checkMilestoneValue, milestoneStatus, milestoneOverdue,
  normalizeBlocker, normalizeRiskLevel, blockerOverdue, maxRiskLevel, isDateKey, shanghaiDateKey, krProgress,
  BLOCKER_INCOMPLETE_MSG
} from '../../src/services/okrRules.js'

const TODAY = '2026-11-21'
const plan1 = (kr, o = {}) => normalizePlan([{ title: 'o', ...o, keyResults: [kr] }], { today: TODAY })[0]
const throwsCode = (fn, code) => assert.throws(fn, e => e.code === code)

describe('MILESTONE 规则', () => {
  test('阶段数决定 targetValue; done 按已完成数从前往后回写', () => {
    const k = plan1({ title: 'k', metricType: 'MILESTONE', milestones: [{ name: 'a', done: false }, { name: 'b', done: true }, { name: 'c' }] }).keyResults[0]
    assert.equal(k.targetValue, 3)
    assert.equal(k.currentValue, 1)
    assert.deepEqual(k.milestones.map(m => m.done), [true, false, false])
    assert.equal(k.status, 'ON_TRACK')
  })

  test('targetValue 0 / 缺阶段 / 越界 / 阶段数与目标值对不上 → 400', () => {
    throwsCode(() => plan1({ title: 'k', metricType: 'MILESTONE', targetValue: 0 }), 8102)
    throwsCode(() => plan1({ title: 'k', metricType: 'MILESTONE' }), 8102)
    throwsCode(() => plan1({ title: 'k', metricType: 'MILESTONE', milestones: [] }), 8102)
    throwsCode(() => plan1({ title: 'k', metricType: 'MILESTONE', targetValue: 3, currentValue: 4 }), 8104)
    throwsCode(() => plan1({ title: 'k', metricType: 'MILESTONE', targetValue: 2, milestones: [{ name: 'x' }] }), 8102)
    throwsCode(() => normalizeMilestones([{ name: 'x', dueDate: '2026-13-01' }]), 8102)
    throwsCode(() => normalizeMilestones([{ name: ' ' }]), 8102)
  })

  test('checkMilestoneValue 只收 0..target 的整数', () => {
    assert.equal(checkMilestoneValue('2', 3), 2)
    for (const v of [-1, 4, 1.5, '', null, 'x']) throwsCode(() => checkMilestoneValue(v, 3), 8104)
  })

  test('状态: 全完成 DONE; 逾期未完成 AT_RISK; MISSED 粘住直到全部完成或人改; 从 DONE 退回 ON_TRACK', () => {
    const ms = milestonesWithDone([{ name: 'a', dueDate: '2026-11-20' }, { name: 'b', dueDate: '2026-11-30' }], 0)
    assert.equal(milestoneOverdue(ms, TODAY), true)
    assert.equal(milestoneStatus({ done: 0, target: 2, milestones: ms, status: 'ON_TRACK', today: TODAY }), 'AT_RISK')
    const ms1 = milestonesWithDone(ms, 1)
    assert.equal(milestoneStatus({ done: 1, target: 2, milestones: ms1, status: 'AT_RISK', today: TODAY }), 'AT_RISK', '逾期的已勾掉后保留原状态')
    assert.equal(milestoneStatus({ done: 1, target: 2, milestones: ms1, status: 'DONE', today: TODAY }), 'ON_TRACK')
    assert.equal(milestoneStatus({ done: 2, target: 2, milestones: milestonesWithDone(ms, 2), status: 'ON_TRACK', today: TODAY }), 'DONE')
    assert.equal(milestoneStatus({ done: 0, target: 2, milestones: ms, status: 'MISSED', today: TODAY }), 'MISSED', '逾期也不覆盖 MISSED')
    assert.equal(milestoneStatus({ done: 2, target: 2, milestones: ms, status: 'MISSED', explicit: true, today: TODAY }), 'MISSED')
    assert.equal(milestoneStatus({ done: 2, target: 2, milestones: ms, status: 'MISSED', today: TODAY }), 'DONE', '全部完成 → DONE')
  })

  test('建档时就有逾期阶段 → AT_RISK; 完成度 = currentValue / targetValue', () => {
    const k = plan1({ title: 'k', metricType: 'MILESTONE', milestones: [{ name: 'a', dueDate: '2026-11-20' }, { name: 'b' }, { name: 'c' }] }).keyResults[0]
    assert.equal(k.status, 'AT_RISK')
    assert.equal(Math.round(krProgress({ ...k, currentValue: 2 }) * 100) / 100, 0.67)
  })

  test('三种老类型的规整结果不带阶段', () => {
    const o = normalizePlan([{ title: 'o', keyResults: [{ title: 'a' }, { title: 'b', metricType: 'PERCENT' }, { title: 'c', metricType: 'NUMBER', targetValue: 5 }] }])[0]
    assert.deepEqual(o.keyResults.map(k => [k.metricType, k.targetValue, k.milestones]), [['BINARY', 1, null], ['PERCENT', 100, null], ['NUMBER', 5, null]])
  })
})

describe('卡点 / 风险规则', () => {
  test('都没传 → {}(不动); 说明为空 → 三个一起清; 说明非空缺字段 → 8120', () => {
    assert.deepEqual(normalizeBlocker({}), {})
    assert.deepEqual(normalizeBlocker({ blockers: '  ', blockerOwnerId: 3 }), { blockers: null, blockerOwnerId: null, blockerDueDate: null })
    assert.throws(() => normalizeBlocker({ blockers: 'x' }), e => e.code === 8120 && e.message === BLOCKER_INCOMPLETE_MSG)
    throwsCode(() => normalizeBlocker({ blockers: 'x', blockerOwnerId: 3 }), 8120)
    throwsCode(() => normalizeBlocker({ blockers: 'x', blockerDueDate: '2026-11-24' }), 8120)
    throwsCode(() => normalizeBlocker({ blockers: 'x', blockerOwnerId: 'abc', blockerDueDate: '2026-11-24' }), 8120)
    assert.deepEqual(normalizeBlocker({ blockers: ' x ', blockerOwnerId: 3, blockerDueDate: '2026-11-24T00:00:00Z' }), { blockers: 'x', blockerOwnerId: '3', blockerDueDate: '2026-11-24' })
  })

  test('riskLevel 只认 LOW / MEDIUM / HIGH; 没传 = undefined', () => {
    assert.equal(normalizeRiskLevel(undefined), undefined)
    assert.equal(normalizeRiskLevel('HIGH'), 'HIGH')
    throwsCode(() => normalizeRiskLevel('low'), 8101)
    throwsCode(() => normalizeRiskLevel('CRITICAL'), 8101)
  })

  test('逾期: 截止日早于今天且 O 未 DONE / DROPPED', () => {
    const o = { blockers: 'x', blockerDueDate: new Date('2026-11-20T00:00:00Z'), status: 'ON_TRACK' }
    assert.equal(blockerOverdue(o, TODAY), true)
    assert.equal(blockerOverdue({ ...o, blockerDueDate: '2026-11-21' }, TODAY), false, '今天截止还不算过')
    assert.equal(blockerOverdue({ ...o, status: 'DONE' }, TODAY), false)
    assert.equal(blockerOverdue({ ...o, status: 'DROPPED' }, TODAY), false)
    assert.equal(blockerOverdue({ ...o, blockers: null }, TODAY), false)
  })

  test('最高风险: DROPPED 不算; 没有 O 为 null', () => {
    assert.equal(maxRiskLevel([]), null)
    assert.equal(maxRiskLevel([{ riskLevel: 'LOW' }, { riskLevel: 'MEDIUM' }]), 'MEDIUM')
    assert.equal(maxRiskLevel([{ riskLevel: 'LOW' }, { riskLevel: 'HIGH', status: 'DROPPED' }]), 'LOW')
  })

  test('日期工具', () => {
    assert.equal(isDateKey('2026-02-29'), false)
    assert.equal(isDateKey('2028-02-29'), true)
    assert.equal(shanghaiDateKey(new Date('2026-11-20T16:30:00Z')), '2026-11-21', '上海已过零点')
  })
})
