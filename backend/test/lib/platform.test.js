// 单元测试 - lib/platform.js 装在以虎 One 上时的默认配置、路径前缀; mcp 工具注解
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { basePathOf } from '../../src/lib/platform.js'
import { TOOLS } from '../../src/mcp/tools.js'
import { annotationsOf } from '../../src/mcp/index.js'

const platformJs = fileURLToPath(new URL('../../src/lib/platform.js', import.meta.url))
/** 在干净的子进程里加载 platform.js, 返回加载后的 process.env 里的若干项 */
function envAfterLoad(env, keys) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(platformJs)}); console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, process.env[k] ?? null]))))`
  ], { env: { PATH: process.env.PATH, ...env } })
  return JSON.parse(String(out))
}
const KEYS = ['PUBLIC_BASE_URL', 'OIDC_ISSUER', 'OIDC_INTERNAL_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'JWT_SECRET']
const YH = {
  YH_CLIENT_ID: 'fde', YH_CLIENT_SECRET: 's3cret-from-platform',
  YH_APP_URL: 'https://one.example.com/apps/fde/', YH_WEB_URL: 'https://one.example.com', YH_API_URL: 'http://yh-console:3105'
}

describe('lib/platform.js - 装在以虎 One 上', () => {
  test('平台注入的变量换算成统一登录、公网地址、JWT 密钥', () => {
    const e = envAfterLoad(YH, KEYS)
    assert.equal(e.PUBLIC_BASE_URL, 'https://one.example.com/apps/fde')
    assert.equal(e.OIDC_ISSUER, 'https://one.example.com')
    assert.equal(e.OIDC_INTERNAL_URL, 'http://yh-console:3105')
    assert.equal(e.OIDC_CLIENT_ID, 'fde')
    assert.equal(e.OIDC_CLIENT_SECRET, 's3cret-from-platform')
    assert.equal(e.OIDC_REDIRECT_URI, 'https://one.example.com/apps/fde/api/auth/oidc/callback')
    assert.match(e.JWT_SECRET, /^[0-9a-f]{64}$/, 'JWT 密钥由平台凭证派生')
    assert.equal(envAfterLoad(YH, KEYS).JWT_SECRET, e.JWT_SECRET, '重启后不变')
    assert.notEqual(envAfterLoad({ ...YH, YH_CLIENT_SECRET: 'other' }, KEYS).JWT_SECRET, e.JWT_SECRET, '每套安装不同')
  })

  test('显式配置的环境变量优先', () => {
    const e = envAfterLoad({ ...YH, OIDC_ISSUER: 'https://sso.example.org', JWT_SECRET: 'x'.repeat(32) }, KEYS)
    assert.equal(e.OIDC_ISSUER, 'https://sso.example.org')
    assert.equal(e.JWT_SECRET, 'x'.repeat(32))
  })

  test('不在平台上(没有 YH_CLIENT_ID)时什么都不改', () => {
    const e = envAfterLoad({}, KEYS)
    for (const k of KEYS) assert.equal(e[k], null, k)
  })

  test('路径前缀只认 /apps/<code>', () => {
    const req = (p) => ({ headers: p === undefined ? {} : { 'x-forwarded-prefix': p } })
    assert.equal(basePathOf(req('/apps/fde')), '/apps/fde')
    assert.equal(basePathOf(req('/apps/fde/')), '/apps/fde')
    assert.equal(basePathOf(req(undefined)), '')
    assert.equal(basePathOf(req('https://evil.example.com')), '', '伪造的头不能把跳转改到别处')
    assert.equal(basePathOf(req('/apps/fde"><script>')), '')
    assert.equal(basePathOf(req('/other')), '')
  })
})

describe('mcp 工具注解', () => {
  test('GET 只读、DELETE 不可逆; 只出草稿的 POST 标只读', () => {
    const by = (n) => annotationsOf(TOOLS.find(t => t.name === n))
    assert.equal(by('get_my_workbench').readOnlyHint, true)
    assert.equal(by('generate_decomposition_draft').readOnlyHint, true)
    assert.equal(by('apply_decomposition_draft').readOnlyHint, false)
    const del = TOOLS.filter(t => annotationsOf(t).destructiveHint)
    assert.ok(del.length > 0 && del.every(t => !annotationsOf(t).readOnlyHint))
  })
  test('每个工具都算得出注解(build 不会因为占位参数抛错)', () => {
    for (const t of TOOLS) assert.equal(typeof annotationsOf(t).readOnlyHint, 'boolean', t.name)
  })
})
