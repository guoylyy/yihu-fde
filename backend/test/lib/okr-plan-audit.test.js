// 单元测试 - 0.6.2 修改记录 diffPlans 的前后对齐(id → 标题 → seq 回退), 不连数据库
//
// 快照是库里读出来的形状(O 带 keyResults, 都有 id / seq)。
// 「payload 无 id」= 变更申请套用: 落库整份重建, after 里的 id 全是新的(这里用 100+ / 1000+ 模拟)。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { diffPlans, matchRows } from '../../src/services/okrPlanAudit.js'

const kr = (id, seq, title, extra = {}) => ({ id, seq, title, metricType: 'NUMBER', targetValue: 10, unit: '个', weight: 50, ...extra })
const obj = (id, seq, title, keyResults, extra = {}) => ({ id, seq, title, weight: 50, status: 'ACTIVE', keyResults, ...extra })

const BEFORE = [
  obj(1, 1, '确认链路验证', [kr(11, 1, '跑通确认'), kr(12, 2, '跑通变更')]),
  obj(2, 2, '门店扩容', [kr(21, 1, '新开门店', { weight: 100 })])
]
const brief = rows => rows.map(r => [r.action, r.field, r.targetRef])

describe('diffPlans: 变更申请套用(payload 无 id)按 标题 / seq 对齐', () => {
  test('只改 O 标题(payload 无 id)→ 恰好 1 行 OBJECTIVE_EDIT title, 0 行增删', () => {
    const after = [
      obj(101, 1, '确认链路验证(变更)', [kr(1011, 1, '跑通确认'), kr(1012, 2, '跑通变更')]),
      obj(102, 2, '门店扩容', [kr(1021, 1, '新开门店', { weight: 100 })])
    ]
    const rows = diffPlans(BEFORE, after)
    assert.deepEqual(brief(rows), [['OBJECTIVE_EDIT', 'title', 'O1 确认链路验证(变更)']])
    assert.equal(rows[0].beforeText, '确认链路验证')
    assert.equal(rows[0].afterText, '确认链路验证(变更)')
    assert.ok(!rows.some(r => /_(ADD|DEL)$/.test(r.action)))
  })

  test('O 标题 + KR 标题一起改(payload 无 id)→ 1 行 O title + 1 行 KR title, targetRef 用变更后的序号与标题', () => {
    const after = [
      obj(101, 1, '确认链路验证(变更)', [kr(1011, 1, '跑通确认流程'), kr(1012, 2, '跑通变更')]),
      obj(102, 2, '门店扩容', [kr(1021, 1, '新开门店', { weight: 100 })])
    ]
    assert.deepEqual(brief(diffPlans(BEFORE, after)), [
      ['OBJECTIVE_EDIT', 'title', 'O1 确认链路验证(变更)'],
      ['KR_EDIT', 'title', 'O1.KR1 跑通确认流程']
    ])
  })

  test('加一个 KR(payload 无 id)→ 1 行 KR_ADD, 其它 O / KR 不产生行', () => {
    const after = [
      obj(101, 1, '确认链路验证', [kr(1011, 1, '跑通确认'), kr(1012, 2, '跑通变更'), kr(1013, 3, '回访纪要', { metricType: 'BINARY', weight: 0 })]),
      obj(102, 2, '门店扩容', [kr(1021, 1, '新开门店', { weight: 100 })])
    ]
    const rows = diffPlans(BEFORE, after)
    assert.deepEqual(brief(rows), [['KR_ADD', null, 'O1.KR3 回访纪要']])
    assert.match(rows[0].afterText, /回访纪要/)
  })

  test('权重 / 目标值改动(payload 无 id)仍走 WEIGHT_EDIT / TARGET_EDIT', () => {
    const after = [
      obj(101, 1, '确认链路验证', [kr(1011, 1, '跑通确认', { targetValue: 20 }), kr(1012, 2, '跑通变更')]),
      obj(102, 2, '门店扩容', [kr(1021, 1, '新开门店', { weight: 100 })], { weight: 50 })
    ]
    after[1].keyResults[0].weight = 60
    after[1].keyResults.push(kr(1022, 2, '门店验收', { weight: 40 }))
    assert.deepEqual(brief(diffPlans(BEFORE, after)), [
      ['TARGET_EDIT', 'targetValue', 'O1.KR1 跑通确认'],
      ['WEIGHT_EDIT', 'weight', 'O2.KR1 新开门店'],
      ['KR_ADD', null, 'O2.KR2 门店验收']
    ])
  })

  test('删一个 O + 加一个全新 O(payload 无 id)→ 1 行 DEL + 1 行 ADD, 不错配', () => {
    // 删 O1, 原 O2 顺位成 O1, 新 O 排 O2: 按 seq 配会把 O1/O2 都记成「改标题」
    const after = [
      obj(101, 1, '门店扩容', [kr(1011, 1, '新开门店', { weight: 100 })]),
      obj(102, 2, '客户回访', [kr(1021, 1, '回访 10 家', { weight: 100 })])
    ]
    const rows = diffPlans(BEFORE, after)
    assert.deepEqual(brief(rows), [
      ['OBJECTIVE_DEL', null, 'O1 确认链路验证'],
      ['OBJECTIVE_ADD', null, 'O2 客户回访']
    ])
  })

  test('删一个 O + 加一个全新 O(带 id 直接保存)→ 1 行 DEL + 1 行 ADD, 新 O 不按 seq 认成旧 O2', () => {
    const after = [
      obj(1, 1, '确认链路验证', [kr(11, 1, '跑通确认'), kr(12, 2, '跑通变更')]),
      obj(102, 2, '客户回访', [kr(1021, 1, '回访 10 家', { weight: 100 })])
    ]
    assert.deepEqual(brief(diffPlans(BEFORE, after)), [
      ['OBJECTIVE_DEL', null, 'O2 门店扩容'],
      ['OBJECTIVE_ADD', null, 'O2 客户回访']
    ])
  })

  test('删 O1 + 改原 O2 标题(payload 无 id, 有净删除)→ 不按 seq 错配, 老实报增删', () => {
    const after = [obj(101, 1, '门店扩容(二期)', [kr(1011, 1, '新开门店', { weight: 100 })])]
    assert.deepEqual(brief(diffPlans(BEFORE, after)).map(r => r[0]), ['OBJECTIVE_DEL', 'OBJECTIVE_DEL', 'OBJECTIVE_ADD'])
  })

  test('一模一样重建(payload 无 id)→ 0 行', () => {
    const after = BEFORE.map((o, i) => ({ ...o, id: 100 + i, keyResults: o.keyResults.map((k, j) => ({ ...k, id: 1000 + 10 * i + j })) }))
    assert.deepEqual(diffPlans(BEFORE, after), [])
  })
})

describe('matchRows', () => {
  test('rebuilt=false 只按 id 配', () => {
    const r = matchRows([{ id: 1, seq: 1, title: 'a' }], [{ id: 2, seq: 1, title: 'a' }])
    assert.equal(r.removed.length, 1)
    assert.deepEqual(r.rows.map(([o]) => o), [null])
  })
  test('rebuilt=true: id → 标题 → seq', () => {
    const olds = [{ id: 1, seq: 1, title: 'a' }, { id: 2, seq: 2, title: 'b' }, { id: 3, seq: 3, title: 'c' }]
    const news = [{ id: 1, seq: 1, title: 'a2' }, { id: 9, seq: 2, title: 'c' }, { id: 8, seq: 3, title: 'x' }]
    const r = matchRows(olds, news, { rebuilt: true })
    assert.deepEqual(r.rows.map(([o, n]) => [o?.id ?? null, n.id]), [[1, 1], [3, 9], [null, 8]])
    assert.deepEqual(r.removed.map(o => o.id), [2], 'b(seq2) 与 x(seq3) 序号不同, 不配')
  })
})
