import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickTodayTasks, dueState, okrSubmitState, firstSentence, pct100, ymd } from '../../src/views/admin/today/todayUtils.js'

const TODAY = '2026-11-18'
const t = (id, o) => ({ id, title: `t${id}`, status: 'TODO', priority: 'MEDIUM', dueDate: null, ...o })

test('pickTodayTasks: 未完成且(3 天内到期或高优), 按到期日排, 最多 6 条', () => {
  const list = [
    t(1, { dueDate: '2026-11-21' }),                  // 今天+3, 入选
    t(2, { dueDate: '2026-11-22' }),                  // 今天+4, 不选
    t(3, { dueDate: '2026-11-10', status: 'IN_PROGRESS' }), // 逾期, 入选且排第一
    t(4, { priority: 'HIGH' }),                       // 无到期日的高优, 垫底
    t(5, { dueDate: '2026-11-18', status: 'DONE' }),  // 已完成, 不选
    t(6, { dueDate: '2026-11-18T00:00:00.000Z', status: 'REWORK' }),
    t(7, { priority: 'URGENT', dueDate: '2026-12-30' })
  ]
  assert.deepEqual(pickTodayTasks(list, { today: TODAY }).map(x => x.id), [3, 6, 1, 7, 4])
  const many = Array.from({ length: 10 }, (_, i) => t(100 + i, { dueDate: TODAY }))
  assert.equal(pickTodayTasks(many, { today: TODAY }).length, 6)
  assert.deepEqual(pickTodayTasks(null), [])
})

test('dueState: 逾期 / 今天 / 3 天内 / 无', () => {
  assert.equal(dueState({ dueDate: '2026-11-17' }, TODAY), 'overdue')
  assert.equal(dueState({ dueDate: '2026-11-18T00:00:00Z' }, TODAY), 'today')
  assert.equal(dueState({ dueDate: '2026-11-21' }, TODAY), 'soon')
  assert.equal(dueState({ dueDate: '2026-12-01' }, TODAY), '')
  assert.equal(dueState({}, TODAY), '')
})

test('ymd 用本地日期', () => {
  assert.equal(ymd(new Date(2026, 0, 5, 0, 30)), '2026-01-05')
})

test('okrSubmitState: 已交 / 迟交 / 未交 / 过截止未交 / 无周期', () => {
  const cycle = { deadlinePassed: false }
  assert.equal(okrSubmitState(null), null)
  assert.equal(okrSubmitState({ cycle: null, objectives: [] }), null)
  assert.equal(okrSubmitState({ cycle, objectives: [] }), 'PENDING')
  assert.equal(okrSubmitState({ cycle: { deadlinePassed: true }, objectives: [{ status: 'ON_TRACK' }] }), 'OVERDUE')
  assert.equal(okrSubmitState({ cycle, objectives: [{ submittedAt: 'x' }, { submittedAt: 'y' }] }), 'ON_TIME')
  assert.equal(okrSubmitState({ cycle, objectives: [{ submittedAt: 'x', lateSubmit: true }] }), 'LATE')
  assert.equal(okrSubmitState({ cycle, objectives: [{ submittedAt: 'x' }, { status: 'DROPPED' }] }), 'ON_TIME', '放弃的 O 不算')
})

test('firstSentence: 取摘要首句, 不在版本号/文件名处截断, 过长截断', () => {
  assert.equal(firstSentence('修了登录。还顺手改了样式。'), '修了登录。')
  assert.equal(firstSentence('Fixed v1.2 login in auth.js. Then refactored.'), 'Fixed v1.2 login in auth.js.')
  assert.equal(firstSentence('第一行\n第二行'), '第一行')
  assert.equal(firstSentence('1. 客户现场连不上 MES 服务器。\n2. 已申请白名单'), '客户现场连不上 MES 服务器。', '去掉行首列表序号')
  assert.equal(firstSentence('- 修了登录'), '修了登录')
  assert.equal(firstSentence('1.5 小时搞定'), '1.5 小时搞定', '数字开头但不是序号的不动')
  assert.equal(firstSentence('## 结论：用 upsert'), '结论：用 upsert')
  assert.equal(firstSentence(''), '')
  assert.equal(firstSentence(null), '')
  assert.equal(firstSentence('很'.repeat(100), 10).length, 10)
})

test('pct100: 0–1 与 0–100 都转成 0–100 整数', () => {
  assert.equal(pct100(0.456), 46)
  assert.equal(pct100(1), 100)
  assert.equal(pct100(72), 72)
  assert.equal(pct100(null), 0)
  assert.equal(pct100('x'), 0)
})
