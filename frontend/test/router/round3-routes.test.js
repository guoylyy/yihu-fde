import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveGuard } from '../../src/router/guards.js'

// 0.5.0 R3 路由: 新页面在, 工时路由保留(旧链接不 404); 团队页只给 ADMIN
const src = readFileSync(new URL('../../src/router/index.js', import.meta.url), 'utf8')
const routeLine = (path) => src.split('\n').find(l => l.includes(`path: '${path}'`))

test('新页面路由都已注册, 工时路由保留', () => {
  for (const p of ['team/members', 'team/skills', 'experience', 'conversations', 'timesheets', 'assets', 'workbench']) {
    assert.ok(routeLine(p), `缺少路由 ${p}`)
  }
  assert.match(src, /path: 'conversations\/:id\(\\\\d\+\)'/)
})

test('团队页按 team.view 拦(组长+老板): 工程师直达弹回今日; 负载 / 承诺 vs 交付已下线(旧地址落兜底 → 我的今日)', () => {
  for (const p of ['team/members']) {
    const idx = src.indexOf(`path: '${p}'`)
    assert.match(src.slice(idx, idx + 260), /requiredPerm: 'team\.view'/, p)
  }
  assert.ok(!routeLine('team/load') && !routeLine('team/promise'))
  assert.match(src, /\{ path: ':pathMatch\(\.\*\)\*', redirect: '\/admin\/workbench' \}/)
  assert.ok(src.includes("path: 'team/members/:engineerId(\\\\d+)'"), '个人页路由')

  const matched = [{ meta: { requiresInternalAuth: true } }, { meta: { requiredPerm: 'team.view', requiredRoles: ['ADMIN', 'TEAM_LEAD'] } }]
  const perms = { FDE_ENGINEER: [], TEAM_LEAD: ['team.view'], ADMIN: ['team.view', 'team.view.all'] }
  const canAs = (role) => (p) => perms[role].includes(p)
  assert.deepEqual(resolveGuard(matched, { internalToken: 't', role: 'FDE_ENGINEER' }, canAs('FDE_ENGINEER')), { name: 'AdminWorkbench' })
  assert.equal(resolveGuard(matched, { internalToken: 't', role: 'TEAM_LEAD' }, canAs('TEAM_LEAD')), true)
  const promise = [{ meta: { requiresInternalAuth: true } }, { meta: { requiredPerm: 'team.view.all', requiredRoles: ['ADMIN'] } }]
  assert.deepEqual(resolveGuard(promise, { internalToken: 't', role: 'TEAM_LEAD' }, canAs('TEAM_LEAD')), { name: 'AdminWorkbench' })
  assert.equal(resolveGuard(promise, { internalToken: 't', role: 'ADMIN' }, canAs('ADMIN')), true)
})

test('0.6.4 能力矩阵路由只要登录: 没有 requiredPerm / requiredRoles, 工程师直达放行', () => {
  const line = routeLine('team/skills')
  assert.ok(line && !/requiredPerm|requiredRoles/.test(line), line)
  const idx = src.indexOf("path: 'team/skills'")
  assert.ok(!/meta:/.test(src.slice(idx, src.indexOf('\n', idx))), '同一行不带 meta')
  assert.ok(!/^\s*meta: \{ requiredPerm/.test(src.slice(idx).split('\n')[1]), '下一行也不带权限 meta')
  const matched = [{ meta: { requiresInternalAuth: true } }, { meta: {} }]
  assert.equal(resolveGuard(matched, { internalToken: 't', role: 'FDE_ENGINEER' }, () => false), true)
})
