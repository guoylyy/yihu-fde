// 单元测试 - v2.5.5(#915) 项目关闭/归档口径纯函数
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { applyProjectVisibility, buildCloseData, buildReopenData, isArchivedStatus, ARCHIVED_STATUSES } from '../../src/services/projectArchive.js'

describe('services/projectArchive.js', () => {
  test('默认列表排除归档态 ∪ exclude_status', () => {
    const w = applyProjectVisibility({ deletedAt: null }, { exclude_status: 'ACCEPTED' })
    assert.deepEqual(new Set(w.status.notIn), new Set(['CLOSED', 'CANCELLED', 'ACCEPTED']))
    const w2 = applyProjectVisibility({}, {})
    assert.deepEqual(new Set(w2.status.notIn), new Set(ARCHIVED_STATUSES))
  })
  test('archived=true 只看归档; 明确 status 原样', () => {
    assert.deepEqual(applyProjectVisibility({}, { archived: 'true', exclude_status: 'ACCEPTED' }).status, { in: ['CLOSED', 'CANCELLED'] })
    assert.equal(applyProjectVisibility({}, { status: 'CLOSED', exclude_status: 'ACCEPTED' }).status, 'CLOSED')
    assert.equal(applyProjectVisibility({}, { archived: 'false', status: 'IN_PROGRESS' }).status, 'IN_PROGRESS')
  })
  test('关闭数据: 记原状态/人/原因(截 500), 归档态不作为回退目标', () => {
    const now = new Date('2026-09-11T00:00:00Z')
    const d = buildCloseData({ fromStatus: 'IN_PROGRESS', actorId: '15', reason: '  客户停摆  ', now })
    assert.deepEqual(d, { status: 'CLOSED', statusBeforeClose: 'IN_PROGRESS', closedAt: now, closedBy: 15n, closeReason: '客户停摆' })
    assert.equal(buildCloseData({ fromStatus: 'CANCELLED', actorId: 1, reason: '' }).statusBeforeClose, null)
    assert.equal(buildCloseData({ fromStatus: 'ACCEPTED', actorId: 1, reason: 'x'.repeat(600) }).closeReason.length, 500)
  })
  test('恢复数据: 回到关闭前状态, 缺省 IN_PROGRESS, 清空关闭字段', () => {
    assert.deepEqual(buildReopenData({ statusBeforeClose: 'ACCEPTED' }), { status: 'ACCEPTED', statusBeforeClose: null, closedAt: null, closedBy: null, closeReason: null })
    assert.equal(buildReopenData({ statusBeforeClose: null }).status, 'IN_PROGRESS')
    assert.equal(buildReopenData({ statusBeforeClose: 'CANCELLED' }).status, 'IN_PROGRESS')
  })
  test('isArchivedStatus', () => {
    assert.ok(isArchivedStatus('CLOSED') && isArchivedStatus('CANCELLED'))
    assert.ok(!isArchivedStatus('ACCEPTED') && !isArchivedStatus(undefined))
  })
})
