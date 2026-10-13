// 单元测试 - lib/yihuOneLlm.js 以虎 One 托管模型(本地假平台, 不连数据库)
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { oidcConfig } from '../../src/lib/oidc.js'
import { yihuOneEndpoint, fetchYihuOneModels } from '../../src/lib/yihuOneLlm.js'
import { chatComplete } from '../../src/lib/llm.js'

let server, base
const platform = { modelsStatus: 200, models: [], requests: [] }

before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      platform.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
      const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.url === '/api/open/llm/models') {
        if (platform.modelsStatus !== 200) return send(platform.modelsStatus, { error: { message: 'nope' } })
        return send(200, { object: 'list', data: platform.models })
      }
      if (req.url === '/api/open/llm/chat/completions') {
        return send(200, { choices: [{ message: { content: 'hi from platform' }, finish_reason: 'stop' }] })
      }
      send(404, {})
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

beforeEach(() => Object.assign(platform, { modelsStatus: 200, models: [], requests: [] }))

// 浏览器用的公网 issuer 与服务端直连地址不同: 调模型必须走直连地址
const cfg = () => oidcConfig({ OIDC_ISSUER: 'https://one.example.com', OIDC_INTERNAL_URL: base, OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's3cret' })

describe('yihuOneEndpoint', () => {
  test('没配统一登录时为 null', () => {
    assert.equal(yihuOneEndpoint(oidcConfig({})), null)
  })
  test('走服务端直连地址, 凭证为 client_id:client_secret', () => {
    const ep = yihuOneEndpoint(cfg())
    assert.equal(ep.baseUrl, `${base}/api/open/llm`)
    assert.equal(ep.apiKey, 'fde:s3cret')
  })
})

describe('fetchYihuOneModels', () => {
  test('Basic 认证拉清单, 规整字段', async () => {
    platform.models = [
      { id: 'deepseek-chat', name: 'DeepSeek', default: true },
      { id: 'qwen-max', description: '通义' },
      { name: 'no id' }
    ]
    const list = await fetchYihuOneModels(cfg())
    assert.deepEqual(list, [
      { id: 'deepseek-chat', name: 'DeepSeek', description: null, default: true },
      { id: 'qwen-max', name: 'qwen-max', description: '通义', default: false }
    ])
    assert.equal(platform.requests[0].auth, 'Basic ' + Buffer.from('fde:s3cret').toString('base64'))
  })
  test('平台版本过旧(404)给出升级提示', async () => {
    platform.modelsStatus = 404
    await assert.rejects(fetchYihuOneModels(cfg()), /升级/)
  })
  test('凭证错误(401)带出平台的说明', async () => {
    platform.modelsStatus = 401
    await assert.rejects(fetchYihuOneModels(cfg()), /401.*nope/)
  })
  test('没接入时直接报错, 不发请求', async () => {
    await assert.rejects(fetchYihuOneModels(oidcConfig({})), /统一登录/)
    assert.equal(platform.requests.length, 0)
  })
})

describe('chatComplete 用以虎 One 的模型', () => {
  test('请求发到平台, Bearer 带平台凭证, 不需要存密钥', async () => {
    const saved = { ...process.env }
    Object.assign(process.env, { OIDC_ISSUER: 'https://one.example.com', OIDC_INTERNAL_URL: base, OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's3cret' })
    try {
      const text = await chatComplete({
        user: '你好',
        config: { name: 'yh', provider: 'YIHU_ONE', model: 'deepseek-chat', apiKey: null, baseUrl: null }
      })
      assert.equal(text, 'hi from platform')
      const req = platform.requests.find(r => r.url === '/api/open/llm/chat/completions')
      assert.equal(req.auth, 'Bearer fde:s3cret')
      assert.equal(JSON.parse(req.body).model, 'deepseek-chat')
    } finally {
      for (const k of ['OIDC_ISSUER', 'OIDC_INTERNAL_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
      }
    }
  })
})
