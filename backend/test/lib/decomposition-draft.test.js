import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDecompositionDraft } from '../../src/services/decompositionDraft.js'
const ac = { acNo: 'AC-1', text: '接口返回 200', level: 'L1_API' }
test('accepts a safe draft and counts tasks', () => assert.equal(validateDecompositionDraft({ summary: '目标', openQuestions: [], milestones: [{ name: '交付', tasks: [{ title: '接口', role: 'DEV', acceptanceCriteria: [ac], dependencies: [] }] }] }).taskCount, 1))
test('rejects missing dependencies and cycles', () => {
  assert.throws(() => validateDecompositionDraft({ summary: 'x', milestones: [{ name: 'm', tasks: [{ title: 'a', role: 'DEV', acceptanceCriteria: [ac], dependencies: ['missing'] }] }] }))
  assert.throws(() => validateDecompositionDraft({ summary: 'x', milestones: [{ name: 'm', tasks: [{ title: 'a', role: 'DEV', acceptanceCriteria: [ac], dependencies: ['b'] }, { title: 'b', role: 'DEV', acceptanceCriteria: [ac], dependencies: ['a'] }] }] }))
})
test('rejects duplicate titles instead of overwriting dependency edges', () => {
  assert.throws(() => validateDecompositionDraft({ summary: 'x', milestones: [{ name: 'm1', tasks: [{ title: '重复', role: 'DEV', acceptanceCriteria: [ac], dependencies: [] }] }, { name: 'm2', tasks: [{ title: '重复', role: 'QA', acceptanceCriteria: [ac], dependencies: [] }] }] }), /标题必须唯一/)
})

// v2.8.0(#1145) 模型输出容错
import { normalizeDraft } from '../../src/services/decompositionDraft.js'
test('normalizeDraft 把中文枚举/字符串 AC/缺省依赖归一化后能过校验', () => {
  const raw = { summary: '知识库接入', milestones: [{ name: '联调', tasks: [
    { title: '整理 FAQ', role: '产品', priority: '高', acceptanceCriteria: ['FAQ 文档评审通过'] },
    { title: '向量化入库', role: 'dev', priority: 'P2', acceptanceCriteria: [{ text: '召回率 ≥ 0.8', level: 'l1' }], dependencies: '整理 FAQ', estimateDays: '3' }
  ] }] }
  const d = validateDecompositionDraft(normalizeDraft(raw))
  assert.equal(d.taskCount, 2)
  const [a, b] = d.milestones[0].tasks
  assert.equal(a.role, 'PM'); assert.equal(a.priority, 'HIGH'); assert.deepEqual(a.acceptanceCriteria, [{ acNo: 'AC-1', text: 'FAQ 文档评审通过', level: 'L1_API' }])
  assert.equal(b.role, 'DEV'); assert.equal(b.priority, 'MEDIUM'); assert.deepEqual(b.dependencies, ['整理 FAQ']); assert.equal(b.estimateDays, 3)
})
test('validate 的报错是人话不是整段 zod JSON', () => {
  assert.throws(() => validateDecompositionDraft({ summary: 'x', milestones: [{ name: 'm', tasks: [{ title: 't', role: 'NOPE', acceptanceCriteria: [ac] }] }] }), /草案结构不合法: milestones\.0\.tasks\.0\.role/)
})
