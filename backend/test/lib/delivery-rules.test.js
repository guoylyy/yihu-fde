// 单元测试 - 交付流程的纯规则: 工时录入校验、验收权限、机器人运行是否作废、@提及识别(不连数据库)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkEntry, parseWorkDate } from '../../src/services/timesheetRules.js'
import { verifyBlocked } from '../../src/routes/fde/tasks.js'
import { runObsolete } from '../../src/services/devDispatch.js'
import { findMentions } from '../../src/lib/mentions.js'

describe('工时录入', () => {
  const now = new Date('2026-10-14T10:00:00Z')
  test('时长须在 (0, 24]', () => {
    assert.equal(checkEntry({ hours: 8 }, now), null)
    assert.match(checkEntry({ hours: 0 }, now), /大于 0/)
    assert.match(checkEntry({ hours: 26 }, now), /24/)
    assert.match(checkEntry({ hours: 'abc' }, now), /大于 0/)
  })
  test('日期不能晚于明天, 格式要对', () => {
    assert.equal(checkEntry({ workDate: '2026-10-14' }, now), null)
    assert.equal(checkEntry({ workDate: '2026-10-15' }, now), null, '时区差一天放行')
    assert.match(checkEntry({ workDate: '2026-10-17' }, now), /未来/)
    assert.match(checkEntry({ workDate: '14/10/2026' }, now), /格式/)
  })
  test('日期按日历日存成 UTC 0 点', () => {
    assert.equal(parseWorkDate('2026-10-14').toISOString(), '2026-10-14T00:00:00.000Z')
    assert.equal(parseWorkDate(new Date('2026-10-14T23:30:00Z')).toISOString(), '2026-10-14T00:00:00.000Z')
    assert.equal(parseWorkDate('nope'), null)
  })
})

describe('验收(VERIFIED)', () => {
  test('只有经理 / 管理员, 且任务已完成', () => {
    assert.equal(verifyBlocked({ role: 'MANAGER' }, { status: 'DONE' }), null)
    assert.equal(verifyBlocked({ role: 'ADMIN' }, { status: 'DONE' }), null)
    assert.match(verifyBlocked({ role: 'FDE_ENGINEER' }, { status: 'DONE' }), /经理/)
    assert.match(verifyBlocked({ role: 'MANAGER' }, { status: 'IN_PROGRESS' }), /DONE/)
  })
})

describe('机器人运行是否作废', () => {
  const ok = { status: 'QUEUED', deletedAt: null, project: { status: 'IN_PROGRESS', deletedAt: null }, milestone: { status: 'PENDING' } }
  test('正常的任务照常领', () => assert.equal(runObsolete(ok), null))
  test('任务做完 / 删除、项目关闭、里程碑完成的不领', () => {
    assert.match(runObsolete({ ...ok, status: 'VERIFIED' }), /完成/)
    assert.match(runObsolete({ ...ok, deletedAt: new Date() }), /删除/)
    assert.match(runObsolete({ ...ok, project: { status: 'CLOSED' } }), /项目已关闭/)
    assert.match(runObsolete({ ...ok, milestone: { status: 'COMPLETED' } }), /里程碑/)
    assert.match(runObsolete(null), /删除/)
  })
})

describe('@提及', () => {
  const users = [{ id: 1, name: 'Sam Chen', username: 'fde001' }, { id: 2, name: 'Sam', username: 'sam' }, { id: 3, name: '王经理', username: 'pm.wang' }]
  const ids = (t) => findMentions(t, users).map(u => u.id).sort()
  test('姓名带空格也认得, 不会误伤叫 Sam 的人', () => assert.deepEqual(ids('请 @Sam Chen 看一下'), [1]))
  test('用户名、中文名、标点结尾', () => {
    assert.deepEqual(ids('@fde001，还有@王经理。'), [1, 3])
    assert.deepEqual(ids('@Sam 你好'), [2])
  })
  test('邮箱、半截名字不算', () => {
    assert.deepEqual(ids('写信到 a@Sam Chenx.com'), [])
    assert.deepEqual(ids('没有提及'), [])
  })
})
