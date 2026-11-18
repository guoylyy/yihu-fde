import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortByLoad, skillName } from '../../src/views/admin/team/teamUtils.js'
import { strList, bodyMessages, convTime } from '../../src/views/admin/conversations/conversationUtils.js'

test('sortByLoad: 档位重的在前, 同档逾期多/活多的在前, 不改原数组', () => {
  const rows = [
    { name: 'a', load: 'IDLE', open: 0 },
    { name: 'b', load: 'BUSY', open: 7, overdue: 0 },
    { name: 'c', load: 'BUSY', open: 3, overdue: 1 },
    { name: 'd', load: 'OVERLOAD', open: 12 }
  ]
  assert.deepEqual(sortByLoad(rows).map(r => r.name), ['d', 'c', 'b', 'a'])
  assert.equal(rows[0].name, 'a')
})

test('skillName 兼容字符串和对象', () => {
  assert.equal(skillName('Vue'), 'Vue')
  assert.equal(skillName({ name: 'Go', level: 3 }), 'Go')
  assert.equal(skillName(null), '')
})

test('strList / bodyMessages 容错', () => {
  assert.deepEqual(strList(['a', { text: 'b' }, '']), ['a', 'b'])
  assert.deepEqual(strList(' x '), ['x'])
  assert.deepEqual(strList(null), [])
  assert.deepEqual(bodyMessages([{ role: 'user', content: 'hi' }, { speaker: 'assistant', text: 'yo' }, { role: 'user', content: '' }]),
    [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }])
  assert.deepEqual(bodyMessages('nope'), [])
})

test('convTime 优先开始时间', () => {
  const d = new Date(2026, 10, 18, 9, 5)
  assert.equal(convTime({ startedAt: d.toISOString(), createdAt: '2020-01-01T00:00:00Z' }), '11-18 09:05')
  assert.equal(convTime({}), '')
})
