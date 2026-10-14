// 集成测试 - /api/fde/system-settings 系统设置(本系统开关) + 开发上手页的 MCP 地址
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api } from './helpers.js'

describe('API: /api/fde/system-settings', () => {
  let admin, fde, original

  before(async () => {
    admin = api(await login('admin'))
    fde = api(await login('fde001'))
    original = (await admin.get('/api/fde/system-settings')).data.settings
  })

  after(async () => {
    await admin.put('/api/fde/system-settings', { values: Object.fromEntries(original.map(s => [s.key, s.value])) })
  })

  test('只有管理员能看和改', async () => {
    assert.equal((await fde.get('/api/fde/system-settings')).status, 403)
    assert.equal((await fde.put('/api/fde/system-settings', { values: { 'auth.leaderIsManager': true } })).status, 403)
  })

  test('列出开关; 没接以虎 One 时 platform 为 null', async () => {
    const r = await admin.get('/api/fde/system-settings')
    assert.equal(r.code, 0)
    const keys = r.data.settings.map(s => s.key)
    assert.deepEqual(keys.sort(), ['auth.leaderIsManager', 'notify.platform'])
    assert.equal(r.data.platform, null)
  })

  test('保存后立即生效, null 恢复默认', async () => {
    let r = await admin.put('/api/fde/system-settings', { values: { 'auth.leaderIsManager': true, 'notify.platform': false } })
    assert.equal(r.code, 0, r.message)
    const v = (k) => r.data.settings.find(s => s.key === k).value
    assert.equal(v('auth.leaderIsManager'), true)
    assert.equal(v('notify.platform'), false)
    r = await admin.put('/api/fde/system-settings', { values: { 'auth.leaderIsManager': null, 'notify.platform': null } })
    assert.equal(v('auth.leaderIsManager'), false)
    assert.equal(v('notify.platform'), true)
  })

  test('非法值整体拒绝', async () => {
    const r = await admin.put('/api/fde/system-settings', { values: { 'auth.leaderIsManager': 'yes' } })
    assert.equal(r.status, 400)
    assert.equal((await admin.put('/api/fde/system-settings', { values: { 'brand.name': 'x' } })).status, 400)
  })

  test('没接平台时开发上手页给本系统自己的 MCP 地址', async () => {
    const r = await fde.get('/api/fde/onboarding/steps')
    assert.equal(r.code, 0, r.message)
    assert.match(r.data.mcpUrl, /\/api\/mcp$/)
  })
})
