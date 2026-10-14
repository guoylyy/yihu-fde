// 单元测试 - lib/settings.js 系统开关的校验与地址推导(不连数据库)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSetting, publicBaseUrl, mcpUrl, SETTING_DEFS } from '../../src/lib/settings.js'

describe('normalizeSetting', () => {
  test('只有本系统的开关, 品牌 / 地址不在这里配', () => {
    assert.deepEqual(SETTING_DEFS.map(d => d.key).sort(), ['auth.leaderIsManager', 'notify.platform'])
    assert.throws(() => normalizeSetting('brand.name', 'x'), /未知/)
  })
  test('布尔开关只收 true / false, 空值恢复默认', () => {
    assert.equal(normalizeSetting('auth.leaderIsManager', true), true)
    assert.equal(normalizeSetting('notify.platform', false), false)
    assert.equal(normalizeSetting('notify.platform', null), null)
    assert.throws(() => normalizeSetting('auth.leaderIsManager', 'yes'), /true/)
  })
})

describe('publicBaseUrl / mcpUrl', () => {
  const withEnv = (vars, fn) => {
    const saved = process.env.PUBLIC_BASE_URL
    delete process.env.PUBLIC_BASE_URL
    Object.assign(process.env, vars)
    try { fn() } finally { if (saved === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = saved }
  }
  const req = (headers) => ({ protocol: 'http', headers: { host: 'localhost:3005', ...headers } })

  test('平台注入的对外地址 + /api/mcp', () => withEnv({ PUBLIC_BASE_URL: 'https://one.example.com/apps/fde/' }, () => {
    assert.equal(mcpUrl(req({})), 'https://one.example.com/apps/fde/api/mcp')
  }))
  test('没配时按请求推导, 带反向代理头与平台前缀', () => withEnv({}, () => {
    assert.equal(mcpUrl(req({})), 'http://localhost:3005/api/mcp')
    assert.equal(publicBaseUrl(req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'one.example.com', 'x-forwarded-prefix': '/apps/fde' })),
      'https://one.example.com/apps/fde')
  }))
})
