import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelState } from '../../src/utils/assistant-ui.js'

test('modelState: 状态未到时不能发送', () => {
  assert.deepEqual(modelState(null), { kind: 'loading', canSend: false })
})

test('modelState: 未配置模型 → not_configured 且禁用', () => {
  const s = modelState({ available: false, reason: '未配置大模型' })
  assert.equal(s.kind, 'not_configured')
  assert.equal(s.canSend, false)
})

test('modelState: 拉状态失败 → error 且禁用', () => {
  const s = modelState({ available: false, fetchError: true, reason: 'Network Error' })
  assert.equal(s.kind, 'error')
  assert.equal(s.canSend, false)
  assert.equal(s.reason, 'Network Error')
})

test('modelState: 可用时显示模型 id, 退回到配置名', () => {
  assert.equal(modelState({ available: true, model: { name: '以虎 One', model: 'qwen-max' } }).name, 'qwen-max')
  assert.equal(modelState({ available: true, model: { name: '以虎 One', model: null } }).name, '以虎 One')
  assert.equal(modelState({ available: true, model: null }).name, '—')
  assert.equal(modelState({ available: true, model: { name: 'x' } }).canSend, true)
})

test('modelState: stub 模式可发送', () => {
  const s = modelState({ available: true, stub: true, model: { name: 'STUB（本地测试）' } })
  assert.equal(s.kind, 'stub')
  assert.equal(s.canSend, true)
})
