import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGuard } from '../../src/router/guards.js'

// 0.5.0 R3 路由: 新页面在, 工时路由保留(旧链接不 404); 团队页只给 ADMIN
const src = readFileSync(new URL('../../src/router/index.js', import.meta.url), 'utf8')
const routeLine = (path) => src.split('\n').find(l => l.includes(`path: '${path}'`))

test('新页面路由都已注册, 工时路由保留', () => {
  for (const p of ['team/members', 'team/load', 'team/skills', 'experience', 'conversations', 'timesheets', 'assets', 'workbench']) {
    assert.ok(routeLine(p), `缺少路由 ${p}`)
  }
  assert.match(src, /path: 'conversations\/:id\(\\\\d\+\)'/)
})

test('团队页 requiredRoles 只有 ADMIN: 工程师直达会被弹回今日', () => {
  const idx = src.indexOf("path: 'team/members'")
  assert.match(src.slice(idx, idx + 220), /requiredRoles: \['ADMIN'\]/)
  const matched = [{ meta: { requiresInternalAuth: true } }, { meta: { requiredRoles: ['ADMIN'] } }]
  const r = resolveGuard(matched, { internalToken: 't', role: 'FDE_ENGINEER' }, () => true)
  assert.notEqual(r, true)
  assert.equal(resolveGuard(matched, { internalToken: 't', role: 'ADMIN' }, () => true), true)
})
