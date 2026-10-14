import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chatComplete } from '../../src/lib/llm.js'

// 模型都经以虎 One 调用: 给一套平台凭证(请求被下面的 stubFetch 截走, 不真的发出去)
const PLATFORM_ENV = { OIDC_ISSUER: 'https://one.example.com', OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's' }
const saved = {}
before(() => { for (const k of Object.keys(PLATFORM_ENV)) saved[k] = process.env[k]; Object.assign(process.env, PLATFORM_ENV) })
after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

const CFG = { name: '测试', provider: 'YIHU_ONE', model: 'deepseek-v4-pro', temperature: null }

function stubFetch(responses) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body))
    const body = responses[calls.length - 1]
    return { ok: true, json: async () => body }
  }
  return calls
}

test('思考模型把预算吃光时自动抬高 max_tokens 重试一次', async () => {
  const original = globalThis.fetch
  const calls = stubFetch([
    { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '一通思考'.repeat(50) } }], usage: { completion_tokens_details: { reasoning_tokens: 2000 } } },
    { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}', reasoning_content: '短思考' } }] }
  ])
  try {
    const out = await chatComplete({ user: '梳理需求', maxTokens: 2000, config: CFG })
    assert.equal(out, '{"ok":true}')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].max_tokens, 2000)
    assert.ok(calls[1].max_tokens > 2000, '重试应使用更大的输出预算')
  } finally { globalThis.fetch = original }
})

test('重试后仍无正文时报错要带上 finish_reason 与思考 token 数', async () => {
  const original = globalThis.fetch
  const empty = { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '思考'.repeat(100) } }], usage: { completion_tokens_details: { reasoning_tokens: 16000 } } }
  stubFetch([empty, empty])
  try {
    await assert.rejects(() => chatComplete({ user: '梳理需求', maxTokens: 2000, config: CFG }), /finish_reason=length[\s\S]*16000[\s\S]*预算被思考过程占满/)
  } finally { globalThis.fetch = original }
})

test('正常模型一次返回正文, 不触发重试', async () => {
  const original = globalThis.fetch
  const calls = stubFetch([{ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }])
  try {
    assert.equal(await chatComplete({ user: 'hi', maxTokens: 800, config: CFG }), 'OK')
    assert.equal(calls.length, 1)
  } finally { globalThis.fetch = original }
})
