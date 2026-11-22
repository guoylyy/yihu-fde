// 单元测试 - OKR 5.0 O 挂项目: projectIds 解析与按项目完成度(纯函数, 不连库)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProjectIds, groupCompletion, MAX_PROJECTS_PER_OBJECTIVE } from '../../src/services/okrObjectiveProjects.js'

test('normalizeProjectIds: 不传 → null(不动关联); [] → []; 去重、数字转字符串', () => {
  assert.equal(normalizeProjectIds(undefined), null)
  assert.equal(normalizeProjectIds(null), null)
  assert.deepEqual(normalizeProjectIds([]), [])
  assert.deepEqual(normalizeProjectIds(['3', 3, ' 5 ', '3']), ['3', '5'])
})

test('normalizeProjectIds: 非数组 / 非法 id / 超过上限 → 400 8170', () => {
  for (const bad of ['1', 1, {}, ['a'], [null], [true], [1.5], [-1], [{}]]) {
    assert.throws(() => normalizeProjectIds(bad), e => e.status === 400 && e.code === 8170, JSON.stringify(bad))
  }
  const max = Array.from({ length: MAX_PROJECTS_PER_OBJECTIVE }, (_, i) => String(i + 1))
  assert.equal(normalizeProjectIds(max).length, MAX_PROJECTS_PER_OBJECTIVE)
  assert.throws(() => normalizeProjectIds([...max, '999']), e => e.code === 8170)
  // 重复的不算数
  assert.equal(normalizeProjectIds([...max, '1']).length, MAX_PROJECTS_PER_OBJECTIVE)
})

test('groupCompletion: 按 O 权重加权; DROPPED 不计; 权重全 0 取平均; 没有 O → null', () => {
  assert.equal(groupCompletion([]), null)
  assert.equal(groupCompletion([{ weight: 60, progress: 0.4 }, { weight: 100, progress: 1 }]), Math.round((24 + 100) / 160 * 10000) / 10000)
  assert.equal(groupCompletion([{ weight: 50, progress: 1 }, { weight: 50, progress: 0, status: 'DROPPED' }]), 1)
  assert.equal(groupCompletion([{ weight: 0, progress: 1 }, { weight: 0, progress: 0 }]), 0.5)
  assert.equal(groupCompletion([{ weight: 10, progress: 1, status: 'DROPPED' }]), null)
})
