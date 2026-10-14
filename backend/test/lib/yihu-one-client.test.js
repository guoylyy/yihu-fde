// 单元测试 - lib/yihuOne.js 平台客户端(本地假平台, 不连数据库)
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { oidcConfig } from '../../src/lib/oidc.js'
import { platformUser, appInfo, listDirectory, notifyPlatformUsers, resetPlatformCaches, cachedAppInfo } from '../../src/lib/yihuOne.js'
import { getBrand } from '../../src/config/brand.js'

let server, base
const platform = { requests: [], appStatus: 200 }
const APP = { code: 'fde', name: 'FDE 交付管理', space: { id: 1, code: 'default', name: '默认空间' }, platformUrl: 'https://one.example.com',
  brand: { name: '以虎 One', logo: 'https://one.example.com/logo.svg', theme: { preset: 'yihu', tokens: { highlight: '#d2521e' } } } }

before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      platform.requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
      const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.url === '/api/sso/userinfo') {
        return req.headers.authorization === 'Bearer good' ? send(200, { code: 0, data: { id: 36, name: '于长成', roles: ['MEMBER'], leaderOf: [24], space: APP.space } }) : send(401, { code: 1002, message: 'access_token 无效或已过期' })
      }
      if (req.url === '/api/open/app') return platform.appStatus === 200 ? send(200, { code: 0, data: APP }) : send(500, { code: 9001, message: 'boom' })
      if (req.url.startsWith('/api/open/users')) return send(200, { code: 0, data: { list: [{ id: 36, active: true }] } })
      if (req.url === '/api/open/notify') return send(200, { code: 0, data: { sent: [{ userId: 36, channel: 'dingtalk' }], skipped: [] } })
      send(404, { code: 404 })
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())
beforeEach(() => { resetPlatformCaches(); Object.assign(platform, { requests: [], appStatus: 200 }) })

const cfg = () => oidcConfig({ OIDC_ISSUER: 'https://one.example.com', OIDC_INTERNAL_URL: base, OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's3cret' })
const basic = 'Basic ' + Buffer.from('fde:s3cret').toString('base64')

describe('platformUser', () => {
  test('用 access_token 换平台用户(含角色、负责的部门、空间), 5 分钟内走缓存', async () => {
    const u = await platformUser('good', cfg())
    assert.deepEqual([u.id, u.leaderOf, u.space.code], [36, [24], 'default'])
    await platformUser('good', cfg())
    assert.equal(platform.requests.filter(r => r.url === '/api/sso/userinfo').length, 1)
    assert.equal(platform.requests[0].auth, 'Bearer good')
  })
  test('无效 token 返回 null', async () => {
    assert.equal(await platformUser('bad', cfg()), null)
  })
  test('没接平台时返回 null, 不发请求', async () => {
    assert.equal(await platformUser('good', oidcConfig({})), null)
    assert.equal(platform.requests.length, 0)
  })
})

describe('appInfo + 品牌', () => {
  test('应用凭证取应用信息; 品牌跟随平台(应用名 / 平台 LOGO / 强调色)', async () => {
    const app = await appInfo({ cfg: cfg() })
    assert.equal(app.space.code, 'default')
    assert.equal(platform.requests[0].auth, basic)
    const b = getBrand(cachedAppInfo())
    assert.deepEqual([b.name, b.logoUrl, b.primaryColor, b.platformName], ['FDE 交付管理', 'https://one.example.com/logo.svg', '#d2521e', '以虎 One'])
  })
  test('平台暂时取不到时用上次的结果', async () => {
    await appInfo({ cfg: cfg() })
    platform.appStatus = 500
    const app = await appInfo({ cfg: cfg(), force: true })
    assert.equal(app.name, 'FDE 交付管理')
  })
  test('没接平台时品牌用默认值', () => {
    assert.equal(getBrand(null).name, 'FDE Platform')
  })
})

test('通讯录带上已停用的人和增量时间; 发消息带应用凭证', async () => {
  await listDirectory({ updatedSince: '2026-10-01T00:00:00Z' }, cfg())
  assert.match(platform.requests[0].url, /includeInactive=true/)
  assert.match(platform.requests[0].url, /updatedSince=2026-10-01T00%3A00%3A00.000Z/)
  const r = await notifyPlatformUsers({ userIds: [36], title: '新任务', content: '修复登录' }, cfg())
  assert.equal(r.sent[0].channel, 'dingtalk')
  assert.equal(platform.requests[1].auth, basic)
  assert.deepEqual(JSON.parse(platform.requests[1].body).userIds, [36])
})
