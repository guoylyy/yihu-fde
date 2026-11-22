// 单元测试 - OKR 4.0 每日总结的纯函数: 日期解析、autoItems 归并与文案、自评到期判断
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDate, todayShanghai, buildAutoItems } from '../../src/services/okrDaily.js'
import { selfScoreDue } from '../../src/services/okrWeekStatus.js'

test('parseDate: 缺省今天(上海); 非法日期 / 格式 → 400', () => {
  const now = new Date('2026-11-20T17:30:00Z') // 上海已是 11-21 01:30
  assert.equal(todayShanghai(now), '2026-11-21')
  assert.equal(parseDate('', now).key, '2026-11-21')
  assert.equal(parseDate('2026-11-21').date.toISOString(), '2026-11-21T00:00:00.000Z')
  for (const bad of ['2026-02-30', '2026/11/21', 'x', '1999-01-01']) {
    assert.throws(() => parseDate(bad), e => e.status === 400, bad)
  }
})

test('buildAutoItems: 同一 KR 当天多次改动归并成一行, 自动生成的文字不进说明; 没挂 KR 的进展只出说明', () => {
  const o = { id: 1n, seq: 2, title: '交付订单模块' }
  const kr = { id: 9n, seq: 1, title: '完成率', metricType: 'PERCENT', unit: null }
  const num = { id: 10n, seq: 3, title: '门店数', metricType: 'NUMBER', unit: '家' }
  const at = s => new Date(`2026-11-21T0${s}:00:00Z`)
  const items = buildAutoItems([
    { objectiveId: 1n, krId: 9n, objective: o, keyResult: kr, valueBefore: 50, valueAfter: 60, statusBefore: null, statusAfter: null, content: '「完成率」当前值 50 → 60', createdAt: at(1) },
    { objectiveId: 1n, krId: null, objective: o, keyResult: null, valueBefore: null, valueAfter: null, content: '和客户对齐了范围', createdAt: at(2) },
    { objectiveId: 1n, krId: 9n, objective: o, keyResult: kr, valueBefore: 60, valueAfter: 70, statusBefore: null, statusAfter: 'AT_RISK', content: '接口有一处没对上', createdAt: at(3) },
    { objectiveId: 1n, krId: 10n, objective: o, keyResult: num, valueBefore: 2, valueAfter: 3, statusBefore: null, statusAfter: null, content: '「门店数」当前值 2家 → 3家', createdAt: at(4) }
  ])
  assert.deepEqual(items.map(i => i.text), [
    'O2「交付订单模块」：和客户对齐了范围',
    'O2「交付订单模块」 · KR1「完成率」：50% → 70%（接口有一处没对上）',
    'O2「交付订单模块」 · KR3「门店数」：2家 → 3家'
  ])
  assert.equal(items[1].updateCount, 2)
  assert.deepEqual(buildAutoItems([]), [])
})

test('selfScoreDue: 复盘中 → 到期; 归档 → 不催; 进行中周五前不到期', () => {
  const start = new Date('2026-11-15T16:00:00Z') // 上海 11-16 周一 00:00
  assert.equal(selfScoreDue({ status: 'REVIEW', startDate: start }, new Date('2026-11-16T03:00:00Z')), true)
  assert.equal(selfScoreDue({ status: 'CLOSED', startDate: start }, new Date('2026-11-25T03:00:00Z')), false)
  assert.equal(selfScoreDue({ status: 'IN_PROGRESS', startDate: start }, new Date('2026-11-18T03:00:00Z')), false)
  assert.equal(selfScoreDue({ status: 'IN_PROGRESS', startDate: start }, new Date('2026-11-20T03:00:00Z')), true)
  assert.equal(selfScoreDue(null), false)
})
