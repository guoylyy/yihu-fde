// OKR 2.0: 主管评分剔除(纯函数)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripManagerScore, canSeeManagerScore, scopeCovers, teamForViewer } from '../../src/services/okrAccess.js'

test('stripManagerScore: 删掉键(不是置空), 去掉主管评分记录, 其余原样', () => {
  const at = new Date('2026-11-20T00:00:00Z')
  const src = {
    selfScore: 80, managerScore: 90,
    can: { edit: false, managerScore: false },
    objectives: [{
      id: '1', selfScore: 80, managerScore: 90, managerComment: '好',
      scores: [{ role: 'SELF', score: 80, at }, { role: 'MANAGER', score: 90, comment: '好', at }],
      keyResults: [{ id: 'k', status: 'MANAGER' }]
    }]
  }
  const out = stripManagerScore(src)
  assert.ok(!JSON.stringify(out).includes('managerScore'))
  assert.ok(!JSON.stringify(out).includes('managerComment'))
  assert.deepEqual(out.objectives[0].scores.map(s => s.role), ['SELF'])
  assert.ok(out.objectives[0].scores[0].at instanceof Date)
  assert.equal(out.objectives[0].keyResults.length, 1, '不是评分记录的不误删')
  assert.equal(src.managerScore, 90, '不改原对象')
})

test('canSeeManagerScore: 不传范围时本人与 ADMIN 可见, 经理/组长/他人不可见', () => {
  assert.equal(canSeeManagerScore({ id: '5', role: 'FDE_ENGINEER' }, '5'), true)
  assert.equal(canSeeManagerScore({ id: '1', role: 'ADMIN' }, '5'), true)
  assert.equal(canSeeManagerScore({ id: '2', role: 'MANAGER' }, '5'), false)
  assert.equal(canSeeManagerScore({ id: '3', role: 'TEAM_LEAD' }, '5'), false)
  assert.equal(canSeeManagerScore({ id: '4', role: 'FDE_ENGINEER' }, '5'), false)
})

test('0.5.8 canSeeManagerScore 传评分范围: null 不限, Set 只看范围内; 本人总能看', () => {
  const team = new Set(['5', '6'])
  assert.equal(canSeeManagerScore({ id: '2', role: 'MANAGER' }, '5', team), true)
  assert.equal(canSeeManagerScore({ id: '2', role: 'MANAGER' }, '9', team), false)
  assert.equal(canSeeManagerScore({ id: '2', role: 'MANAGER' }, '2', team), true, '本人')
  assert.equal(canSeeManagerScore({ id: '1', role: 'ADMIN' }, '9', null), true)
  assert.equal(canSeeManagerScore({ id: '3', role: 'TEAM_LEAD' }, '5', new Set()), false)
  assert.equal(scopeCovers(null, '1'), true)
  assert.equal(scopeCovers(new Set(['1']), 1), true)
  assert.equal(scopeCovers(undefined, '1'), false)
})

test('0.5.8 teamForViewer: 只给范围内的行留主管分, 其余行(含自己)剔除', () => {
  const data = { summary: { expected: 3 }, rows: [
    { user: { id: '2' }, selfScore: 70, managerScore: 60 },
    { user: { id: '5' }, selfScore: 80, managerScore: 90 },
    { user: { id: '9' }, selfScore: 75, managerScore: 85 }
  ] }
  const out = teamForViewer(data, new Set(['5']))
  assert.deepEqual(out.rows.map(r => 'managerScore' in r), [false, true, false])
  assert.equal(out.rows[0].selfScore, 70)
  assert.equal(out.summary.expected, 3)
  assert.equal(teamForViewer(data, null), data, 'ADMIN 原样')
  assert.ok(!JSON.stringify(teamForViewer(data, new Set())).includes('managerScore'), '没范围整份剔除')
})
