// 0.5.0 R3 纯函数: 任务实际工时解析/输出 + 团队负载档位
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseActualHours, hoursOut, taskOut, INVALID } from '../../src/lib/taskHours.js'
import { loadLevel } from '../../src/lib/teamLoad.js'

test('parseActualHours: 不传不改, 空值清空, 两位小数以内的非负数保留', () => {
  assert.equal(parseActualHours(undefined), undefined)
  assert.equal(parseActualHours(null), null)
  assert.equal(parseActualHours('  '), null)
  assert.equal(parseActualHours(0), 0)
  assert.equal(parseActualHours('2.5'), 2.5)
  assert.equal(parseActualHours(3.25), 3.25)
  assert.equal(parseActualHours('9999.99'), 9999.99)
})

test('parseActualHours: 负数/三位小数/超上限/非数字一律 INVALID', () => {
  for (const v of [-1, '-0.5', '1.234', 10000, 'abc', '1e3', true, {}, [], NaN, Infinity]) {
    assert.equal(parseActualHours(v), INVALID, JSON.stringify(v))
  }
})

test('hoursOut / taskOut: Decimal 字符串转数字, null 保持 null, 没这个字段的对象原样', () => {
  assert.equal(hoursOut('1.50'), 1.5)
  assert.equal(hoursOut({ toString: () => '2.00', valueOf: () => 2 }), 2)
  assert.equal(hoursOut(null), null)
  assert.deepEqual(taskOut({ id: 1, actualHours: '0.75' }), { id: 1, actualHours: 0.75 })
  assert.deepEqual(taskOut({ id: 1 }), { id: 1 })
  assert.equal(taskOut(null), null)
})

test('loadLevel: 空闲/正常/偏满/过载', () => {
  assert.equal(loadLevel({ open: 0 }), 'IDLE')
  assert.equal(loadLevel({ open: 3 }), 'NORMAL')
  assert.equal(loadLevel({ open: 3, overdue: 1 }), 'BUSY')
  assert.equal(loadLevel({ open: 7 }), 'BUSY')
  assert.equal(loadLevel({ open: 4, dueSoon: 4 }), 'BUSY')
  assert.equal(loadLevel({ open: 12 }), 'OVERLOAD')
  assert.equal(loadLevel({ open: 5, overdue: 3 }), 'OVERLOAD')
  assert.equal(loadLevel(), 'IDLE')
})
