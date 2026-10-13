// 集成测试 - /api/fde/system-settings 系统设置 + 开发上手页的 MCP 地址
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, request } from './helpers.js'

describe('API: /api/fde/system-settings', () => {
  let admin, fde, original

  before(async () => {
    admin = api(await login('admin'))
    fde = api(await login('fde001'))
    original = (await admin.get('/api/fde/system-settings')).data.settings
  })

  after(async () => {
    // 恢复测试前保存的值
    const values = Object.fromEntries(original.map(s => [s.key, s.value]))
    await admin.put('/api/fde/system-settings', { values })
  })

  test('只有管理员能看和改', async () => {
    assert.equal((await fde.get('/api/fde/system-settings')).status, 403)
    assert.equal((await fde.put('/api/fde/system-settings', { values: { 'brand.name': 'x' } })).status, 403)
  })

  test('列出每一项及其来源', async () => {
    const r = await admin.get('/api/fde/system-settings')
    assert.equal(r.code, 0)
    const keys = r.data.settings.map(s => s.key)
    for (const k of ['brand.name', 'brand.logoUrl', 'brand.primaryColor', 'url.publicBase', 'url.mcp']) assert.ok(keys.includes(k), k)
    assert.ok(r.data.effective.mcpUrl.endsWith('/api/mcp'))
    assert.equal(typeof r.data.login.password, 'boolean')
  })

  test('保存后立即生效: 品牌接口与上手页的 MCP 地址', async () => {
    const r = await admin.put('/api/fde/system-settings', {
      values: { 'brand.name': 'Unit Test Brand', 'brand.primaryColor': '#123ABC', 'url.mcp': 'https://mcp.example.com/api/mcp' }
    })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.settings.find(s => s.key === 'brand.name').source, 'settings')

    const edition = await request('GET', '/api/public/edition')
    assert.equal(edition.data.brand.name, 'Unit Test Brand')
    assert.equal(edition.data.brand.primaryColor, '#123abc')

    const onboarding = await fde.get('/api/fde/onboarding/steps')
    assert.equal(onboarding.code, 0, onboarding.message)
    assert.equal(onboarding.data.mcpUrl, 'https://mcp.example.com/api/mcp')
  })

  test('清空即恢复为环境变量或默认值', async () => {
    const r = await admin.put('/api/fde/system-settings', { values: { 'brand.name': null, 'url.mcp': '' } })
    assert.equal(r.code, 0)
    assert.notEqual(r.data.settings.find(s => s.key === 'brand.name').source, 'settings')
    assert.notEqual(r.data.effective.mcpUrl, 'https://mcp.example.com/api/mcp')
  })

  test('非法值整体拒绝, 不写入任何一项', async () => {
    const r = await admin.put('/api/fde/system-settings', { values: { 'brand.name': 'Should Not Save', 'brand.primaryColor': 'orange' } })
    assert.equal(r.status, 400)
    const now = await admin.get('/api/fde/system-settings')
    assert.notEqual(now.data.settings.find(s => s.key === 'brand.name').value, 'Should Not Save')
  })
})
