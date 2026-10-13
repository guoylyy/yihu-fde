import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engineerAcceptanceMetrics } from '../../src/services/engineerAcceptanceMetrics.js'
const from = new Date('2026-07-01T00:00:00Z')
const through = new Date('2026-09-09T00:00:00Z')
const record = (id, taskId, conclusion, createdAt = '2026-08-01', shadow = false) => ({ id, taskId, conclusion, createdAt, shadow })
test('FAIL then PASS remains a failed first attempt regardless of input order', () => {
  assert.deepEqual(engineerAcceptanceMetrics([record('2', '1', 'PASS', '2026-08-02'), record('1', '1', 'FAIL'), record('3', '2', 'PASS')], from, through), { total: 3, pass: 2, firstTotal: 2, firstPass: 1, firstPassRate: 50, trend: { earlierRate: 50, recentRate: null, delta: null } })
})
test('a retry in the window does not turn an older first attempt into a new first attempt', () => {
  const metrics = engineerAcceptanceMetrics([record('1', '1', 'FAIL', '2026-06-01'), record('2', '1', 'PASS')], from, through)
  assert.equal(metrics.total, 1)
  assert.equal(metrics.firstTotal, 0)
  assert.equal(metrics.firstPassRate, null)
})
test('ignores shadow/future attempts and resolves timestamp ties by ID', () => {
  const metrics = engineerAcceptanceMetrics([record('3', '1', 'PASS'), record('2', '1', 'FAIL'), record('1', '1', 'PASS', '2026-07-01', true), record('4', '2', 'PASS', '2026-10-01')], from, through)
  assert.equal(metrics.firstTotal, 1)
  assert.equal(metrics.firstPassRate, 0)
})
