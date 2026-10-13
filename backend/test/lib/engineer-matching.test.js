import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankEngineerProfiles } from '../../src/services/engineerMatching.js'
const profile = (name, score, extra = {}) => ({ name, score, available: true, projectTypes: [], roles: [], skills: [], ...extra })
test('ranks available profiles by task fit then base score', () => {
  const result = rankEngineerProfiles([profile('低分匹配', 20, { projectTypes: ['MES'], roles: ['DEV'] }), profile('高分不匹配', 60, { projectTypes: ['WEB'] }), profile('不可派工', 99, { available: false })], { projectType: 'MES', role: 'DEV' })
  assert.deepEqual(result.map(item => item.name), ['高分不匹配', '低分匹配'])
  assert.equal(result[1].matchScore, 45)
})
