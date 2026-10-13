import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveIndependence } from '../../src/services/engineerIndependence.js'

test('independent delivery is eligible only when all auditable thresholds pass', () => {
  assert.deepEqual(deriveIndependence({ delivery: 80, firstPassRate: 80, approvedHours3m: 16, tasks: 3 }), { eligible: true, reasons: [] })
  const result = deriveIndependence({ delivery: 100, firstPassRate: 90, approvedHours3m: 16, tasks: 2 })
  assert.equal(result.eligible, false)
  assert.match(result.reasons[0], /样本不足/)
})
