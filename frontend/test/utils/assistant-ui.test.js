import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelState, hasSeen, markSeen, SEEN_KEY } from '../../src/utils/assistant-ui.js'

function mem() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

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

test('首次提示: 没看过 → 看过后记住', () => {
  const st = mem()
  assert.equal(hasSeen(st), false)
  markSeen(st)
  assert.equal(st.getItem(SEEN_KEY), '1')
  assert.equal(hasSeen(st), true)
})

test('首次提示: storage 不可用时不报错, 也不再提示', () => {
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(hasSeen(broken), true)
  assert.doesNotThrow(() => markSeen(broken))
})
