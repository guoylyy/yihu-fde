// 单元测试 - lib/settings.js 系统设置的校验与地址推导(不连数据库)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSetting, publicBaseUrl, mcpUrl } from '../../src/lib/settings.js'

describe('normalizeSetting', () => {
  test('空值表示清除', () => {
    assert.equal(normalizeSetting('brand.name', ''), null)
    assert.equal(normalizeSetting('brand.name', '   '), null)
    assert.equal(normalizeSetting('brand.name', null), null)
  })
  test('文本去空格并限长', () => {
    assert.equal(normalizeSetting('brand.name', '  Acme Delivery '), 'Acme Delivery')
    assert.throws(() => normalizeSetting('brand.name', 'x'.repeat(51)), /50/)
    assert.throws(() => normalizeSetting('brand.name', 'a\nb'), /不可见/)
  })
  test('主色只收 #RGB / #RRGGBB', () => {
    assert.equal(normalizeSetting('brand.primaryColor', '#1F5D8C'), '#1f5d8c')
    assert.equal(normalizeSetting('brand.primaryColor', '#abc'), '#abc')
    assert.throws(() => normalizeSetting('brand.primaryColor', 'red'), /#RRGGBB/)
    assert.throws(() => normalizeSetting('brand.primaryColor', '#12345'), /#RRGGBB/)
  })
  test('地址只收 http(s), 去掉末尾斜杠', () => {
    assert.equal(normalizeSetting('url.publicBase', 'https://fde.example.com/'), 'https://fde.example.com')
    assert.throws(() => normalizeSetting('url.mcp', 'fde.example.com'), /有效/)
    assert.throws(() => normalizeSetting('url.mcp', 'javascript:alert(1)'), /http/)
  })
  test('Logo 可以是站内路径, 但不能是协议相对地址', () => {
    assert.equal(normalizeSetting('brand.logoUrl', '/uploads/2026/logo.png'), '/uploads/2026/logo.png')
    assert.throws(() => normalizeSetting('brand.logoUrl', '//evil.example.com/x.png'), /有效/)
    assert.throws(() => normalizeSetting('brand.logoUrl', 'data:image/png;base64,xx'), /http/)
  })
  test('未知设置项报错', () => {
    assert.throws(() => normalizeSetting('smtp.password', 'x'), /未知/)
  })
})

describe('publicBaseUrl / mcpUrl', () => {
  const withEnv = (vars, fn) => {
    const saved = { PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL, PUBLIC_MCP_URL: process.env.PUBLIC_MCP_URL }
    for (const k of Object.keys(saved)) delete process.env[k]
    Object.assign(process.env, vars)
    try { fn() } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
  }
  const req = (headers) => ({ protocol: 'http', headers: { host: 'localhost:3005', ...headers } })

  test('显式 MCP 地址优先', () => withEnv({ PUBLIC_BASE_URL: 'https://a.com', PUBLIC_MCP_URL: 'https://mcp.a.com/x' }, () => {
    assert.equal(mcpUrl(req({})), 'https://mcp.a.com/x')
  }))
  test('否则用对外地址 + /api/mcp', () => withEnv({ PUBLIC_BASE_URL: 'https://a.com/' }, () => {
    assert.equal(mcpUrl(req({})), 'https://a.com/api/mcp')
  }))
  test('都没配时按请求推导, 带反向代理头与平台前缀', () => withEnv({}, () => {
    assert.equal(mcpUrl(req({})), 'http://localhost:3005/api/mcp')
    assert.equal(publicBaseUrl(req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'one.example.com', 'x-forwarded-prefix': '/apps/fde' })),
      'https://one.example.com/apps/fde')
  }))
})
