import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skillName } from '../../src/views/admin/team/teamUtils.js'
import { strList, bodyMessages, convTime } from '../../src/views/admin/conversations/conversationUtils.js'

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
