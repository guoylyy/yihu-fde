// 单元测试 - lib/oidc.js 统一登录(用本地假身份提供方, 不连数据库)
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import {
  oidcConfig, discover, buildAuthorizeRequest, exchangeCode, fetchUserinfo,
  usernameCandidates, roleFor, resetOidcCaches
} from '../../src/lib/oidc.js'

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const fakeJwt = (payload) => `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`

// 假身份提供方: 记录收到的 token 请求, 返回可配置的结果
let server, issuer
const idp = { tokenRequests: [], idToken: null, tokenStatus: 200, claims: null, issuerOverride: null }

before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.url === '/.well-known/openid-configuration') {
      return send(200, {
        issuer: idp.issuerOverride || issuer,
        authorization_endpoint: `${issuer}/sso/authorize`,
        token_endpoint: `${issuer}/api/oidc/token`,
        userinfo_endpoint: `${issuer}/api/oidc/userinfo`
      })
    }
    if (req.url === '/api/oidc/token' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        idp.tokenRequests.push({ auth: req.headers.authorization, form: Object.fromEntries(new URLSearchParams(body)) })
        if (idp.tokenStatus !== 200) return send(idp.tokenStatus, { error: 'invalid_grant', error_description: 'code expired' })
        send(200, { access_token: 'at-123', token_type: 'Bearer', id_token: idp.idToken })
      })
      return
    }
    if (req.url === '/api/oidc/userinfo') {
      if (req.headers.authorization !== 'Bearer at-123' || !idp.claims) return send(401, { error: 'invalid_token' })
      return send(200, idp.claims)
    }
    send(404, {})
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  issuer = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

beforeEach(() => {
  resetOidcCaches()
  Object.assign(idp, { tokenRequests: [], idToken: null, tokenStatus: 200, claims: null, issuerOverride: null })
})

const cfg = () => oidcConfig({ OIDC_ISSUER: issuer + '/', OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's3cret' })

describe('oidcConfig', () => {
  test('缺 issuer / client id / secret 任一项即关闭', () => {
    assert.equal(oidcConfig({}).enabled, false)
    assert.equal(oidcConfig({ OIDC_ISSUER: 'https://one', OIDC_CLIENT_ID: 'a' }).enabled, false)
    assert.equal(oidcConfig({ OIDC_ISSUER: 'https://one', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b' }).enabled, true)
  })

  test('默认值: 回调地址取 PUBLIC_BASE_URL, 去掉末尾斜杠', () => {
    const c = oidcConfig({ OIDC_ISSUER: 'https://one.example.com/', PUBLIC_BASE_URL: 'https://fde.example.com/' })
    assert.equal(c.issuer, 'https://one.example.com')
    assert.equal(c.redirectUri, 'https://fde.example.com/api/auth/oidc/callback')
    assert.equal(c.name, '以虎 One')
    assert.equal(c.autoCreate, true)
    assert.equal(c.defaultRole, 'FDE_ENGINEER')
    assert.deepEqual(c.adminRoles, ['ADMIN'])
  })

  test('布尔开关与空的管理员角色', () => {
    const c = oidcConfig({ OIDC_AUTO_CREATE: 'false', OIDC_LINK_BY_EMAIL: '0', OIDC_ADMIN_ROLES: '' })
    assert.equal(c.autoCreate, false)
    assert.equal(c.linkByEmail, false)
    assert.deepEqual(c.adminRoles, [])
  })
})

describe('roleFor / usernameCandidates', () => {
  const c = oidcConfig({})
  test('身份提供方的 ADMIN 映射为 ADMIN, 其余用默认角色', () => {
    assert.equal(roleFor({ roles: ['MEMBER', 'ADMIN'] }, c), 'ADMIN')
    assert.equal(roleFor({ roles: ['DEVELOPER'] }, c), 'FDE_ENGINEER')
    assert.equal(roleFor({}, c), 'FDE_ENGINEER')
    assert.equal(roleFor({ roles: 'ADMIN' }, c), 'ADMIN')
  })

  test('OIDC_ADMIN_ROLES 置空则不映射管理员', () => {
    assert.equal(roleFor({ roles: ['ADMIN'] }, oidcConfig({ OIDC_ADMIN_ROLES: '' })), 'FDE_ENGINEER')
  })

  test('用户名只含合法字符, 依次退到邮箱前缀', () => {
    const [a, b] = usernameCandidates({ sub: 'u_ABCDEF123456', preferred_username: 'Zhang San!' })
    assert.equal(a, 'zhangsan')
    assert.match(b, /^zhangsan-[a-z0-9._-]{1,8}$/)
    assert.equal(usernameCandidates({ sub: '1', email: 'Li.Si@corp.com' })[0], 'li.si')
    assert.equal(usernameCandidates({ sub: '1', preferred_username: '张三' })[0], 'user')
  })
})

describe('discover', () => {
  test('issuer 与配置不一致时拒绝', async () => {
    idp.issuerOverride = 'https://evil.example.com'
    await assert.rejects(discover(cfg()), /issuer/)
  })

  test('OIDC_INTERNAL_URL 只替换服务端请求的主机', async () => {
    const c = oidcConfig({ OIDC_ISSUER: 'http://one.public:9', OIDC_CLIENT_ID: 'fde', OIDC_CLIENT_SECRET: 's', OIDC_INTERNAL_URL: issuer })
    idp.issuerOverride = 'http://one.public:9'
    const { url } = await buildAuthorizeRequest(c, 'http://fde/cb')
    assert.ok(url.startsWith(`${issuer}/sso/authorize?`), '授权地址来自发现文档')
  })
})

describe('授权码流程', () => {
  test('授权地址带 state / nonce / PKCE S256', async () => {
    const { url, state, nonce, verifier } = await buildAuthorizeRequest(cfg(), 'http://fde/cb')
    const u = new URL(url)
    assert.equal(u.searchParams.get('response_type'), 'code')
    assert.equal(u.searchParams.get('client_id'), 'fde')
    assert.equal(u.searchParams.get('redirect_uri'), 'http://fde/cb')
    assert.equal(u.searchParams.get('scope'), 'openid profile email')
    assert.equal(u.searchParams.get('state'), state)
    assert.equal(u.searchParams.get('nonce'), nonce)
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
    assert.equal(u.searchParams.get('code_challenge'), expected)
  })

  test('换 token 用 Basic 认证并带 code_verifier, 返回 userinfo', async () => {
    idp.idToken = fakeJwt({ iss: issuer, aud: 'fde', nonce: 'n1', sub: 'u1' })
    idp.claims = { sub: 'u1', name: 'Alice', email: 'alice@example.com' }
    const { claims, accessToken } = await exchangeCode(cfg(), { code: 'c1', redirectUri: 'http://fde/cb', verifier: 'v1', nonce: 'n1' })
    assert.equal(accessToken, 'at-123')
    assert.equal(claims.sub, 'u1')
    const [req] = idp.tokenRequests
    assert.equal(req.auth, 'Basic ' + Buffer.from('fde:s3cret').toString('base64'))
    assert.deepEqual(req.form, { grant_type: 'authorization_code', code: 'c1', redirect_uri: 'http://fde/cb', code_verifier: 'v1' })
  })

  test('nonce 不符时拒绝', async () => {
    idp.idToken = fakeJwt({ iss: issuer, aud: 'fde', nonce: 'other' })
    idp.claims = { sub: 'u1' }
    await assert.rejects(exchangeCode(cfg(), { code: 'c', redirectUri: 'r', verifier: 'v', nonce: 'n1' }), /nonce/)
  })

  test('aud 是别的应用时拒绝', async () => {
    idp.idToken = fakeJwt({ iss: issuer, aud: ['another-app'], nonce: 'n1' })
    idp.claims = { sub: 'u1' }
    await assert.rejects(exchangeCode(cfg(), { code: 'c', redirectUri: 'r', verifier: 'v', nonce: 'n1' }), /aud/)
  })

  test('token 端点报错时带出错误说明', async () => {
    idp.tokenStatus = 400
    await assert.rejects(exchangeCode(cfg(), { code: 'c', redirectUri: 'r', verifier: 'v' }), /code expired/)
  })

  test('无效 access_token 的 userinfo 返回 null', async () => {
    assert.equal(await fetchUserinfo(cfg(), 'bad'), null)
  })
})
