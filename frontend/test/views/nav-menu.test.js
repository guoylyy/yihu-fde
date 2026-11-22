import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@vue/compiler-sfc'
import { buildNav, activeMenuPath, DEFAULT_OPENEDS, NAV_GROUPS } from '../../src/views/admin/navMenu.js'

// 0.5.0 侧栏五组: 今日 / 团队 / 交付 / 经验 / 设置
const allow = () => true
const paths = (g) => g.items.map(i => i.path)
const byKey = (groups) => Object.fromEntries(groups.map(g => [g.key, g]))

test('ADMIN 看到五组, 团队 5 项(工时第五)、交付 6 项(OKR 4.0 加项目 OKR)、经验 3 项(创意中心排第一)', () => {
  const groups = buildNav({ can: allow, role: 'ADMIN' })
  assert.deepEqual(groups.map(g => g.key), ['today', 'team', 'delivery', 'experience', 'config'])
  const g = byKey(groups)
  assert.deepEqual(paths(g.today), ['/admin/workbench'])
  assert.equal(g.today.index, null, '今日是一级菜单项, 不是分组')
  assert.deepEqual(paths(g.team), ['/admin/team/members', '/admin/team/load', '/admin/okr', '/admin/team/skills', '/admin/timesheets'])
  assert.deepEqual(paths(g.delivery), ['/admin/projects', '/admin/okr/projects', '/admin/tasks', '/admin/customers', '/admin/knowledge', '/admin/onboarding'])
  assert.deepEqual(paths(g.experience), ['/admin/ideas', '/admin/experience', '/admin/conversations'])
  const second = ['team', 'delivery', 'experience'].reduce((n, k) => n + g[k].items.length, 0)
  assert.ok(second <= 15, `业务二级菜单 ≤15 项(0.5.2 工时放回 +1, OKR 4.0 项目 OKR / 每日总结 +2), 实际 ${second}`)
})

test('0.5.2 工时放回团队组, 顺序第五(成员/负载/周 OKR/能力矩阵/工时), 按 timesheet.view 显示', () => {
  for (const role of ['ADMIN', 'MANAGER', 'FDE_ENGINEER']) {
    const team = byKey(buildNav({ can: allow, role })).team
    assert.equal(paths(team).at(-1), '/admin/timesheets', role)
    assert.ok(!buildNav({ can: allow, role }).flatMap(paths).includes('/admin/assets'), '资产库并进经验库页内切换, 不单独占菜单')
  }
  const admin = byKey(buildNav({ can: allow, role: 'ADMIN' })).team
  assert.equal(paths(admin).indexOf('/admin/timesheets'), 4)
  const item = admin.items[4]
  assert.equal(item.title, 'common.hours')
  assert.equal(item.icon, 'Timer')
  const noTs = buildNav({ can: p => p !== 'timesheet.view', role: 'ADMIN' }).flatMap(paths)
  assert.ok(!noTs.includes('/admin/timesheets'), '没有 timesheet.view 不显示')
  const layout = readFileSync(new URL('../../src/views/admin/AdminLayout.vue', import.meta.url), 'utf8')
  assert.match(layout, /const NAV_ICONS = \{[^}]*\bTimer\b/, 'Timer 图标已注册')
})

test('没有 team.view 的工程师看不到团队组, 落地页仍是我的今日', () => {
  const engineerPerms = new Set(['projects', 'project.view', 'knowledge', 'idea.view', 'asset.view'])
  const groups = buildNav({ can: p => engineerPerms.has(p), role: 'FDE_ENGINEER' })
  const keys = groups.map(g => g.key)
  assert.ok(!keys.includes('team'))
  assert.ok(!keys.includes('config'), '没有设置类权限时设置组整组不出现')
  assert.deepEqual(paths(byKey(groups).today), ['/admin/workbench'])
  assert.ok(paths(byKey(groups).delivery).includes('/admin/tasks'), '工程师兜底能看到任务')
  assert.deepEqual(paths(byKey(groups).experience), ['/admin/ideas', '/admin/experience', '/admin/conversations'])
})

test('组长(team.view)看到团队组成员/负载/能力矩阵, 不出现周 OKR; 承诺 vs 交付不单占菜单', () => {
  const lead = byKey(buildNav({ can: p => p === 'team.view', role: 'TEAM_LEAD' }))
  assert.deepEqual(paths(lead.team), ['/admin/team/members', '/admin/team/load', '/admin/team/skills'])
  const admin = buildNav({ can: allow, role: 'ADMIN' }).flatMap(paths)
  assert.ok(!admin.includes('/admin/team/promise'))
  assert.equal(activeMenuPath('/admin/team/promise'), '/admin/team/load')
  assert.equal(activeMenuPath('/admin/team/members/36'), '/admin/team/members')
})

test('OKR 模块关掉时团队组不出现周 OKR', () => {
  const g = byKey(buildNav({ can: allow, role: 'ADMIN', moduleEnabled: m => m !== 'okr' }))
  assert.ok(!paths(g.team).includes('/admin/okr'))
})

test('默认展开所有分组; 详情/子页高亮所属菜单, 资产库高亮经验库', () => {
  assert.deepEqual(DEFAULT_OPENEDS, Object.values(NAV_GROUPS))
  assert.equal(activeMenuPath('/admin/assets'), '/admin/experience')
  assert.equal(activeMenuPath('/admin/assets/some-slug'), '/admin/experience')
  assert.equal(activeMenuPath('/admin/conversations/12'), '/admin/conversations')
  assert.equal(activeMenuPath('/admin/projects/3'), '/admin/projects')
  assert.equal(activeMenuPath('/admin/okr/team'), '/admin/okr')
  assert.equal(activeMenuPath('/admin/timesheets'), '/admin/timesheets')
  assert.equal(activeMenuPath('/admin/timesheets/12'), '/admin/timesheets')
})

test('AdminLayout: 桌面与手机菜单都从 navGroups 渲染, 保留默认展开与 unique-opened=false, 不再硬编码工时菜单', () => {
  const layout = parse(readFileSync(new URL('../../src/views/admin/AdminLayout.vue', import.meta.url), 'utf8')).descriptor
  const tpl = layout.template.content
  assert.equal((tpl.match(/v-for="g in navGroups"/g) || []).length, 2, '桌面侧栏 + 手机抽屉')
  assert.equal((tpl.match(/:unique-opened="false"/g) || []).length, 2)
  assert.equal((tpl.match(/:default-openeds="DEFAULT_OPENEDS"/g) || []).length, 2)
  assert.doesNotMatch(tpl, /index="\/admin\/timesheets"/)
  assert.match(layout.scriptSetup.content, /buildNav\(\{ can, moduleEnabled, role: user\.value\?\.role \}\)/)
})

test('OKR 4.0 交付组「项目 OKR」: 全员可见(模块开着), 高亮不被周 OKR 前缀吃掉', () => {
  for (const role of ['ADMIN', 'MANAGER', 'FDE_ENGINEER']) {
    const d = byKey(buildNav({ can: allow, role })).delivery
    assert.equal(paths(d)[1], '/admin/okr/projects', role)
    assert.equal(d.items[1].icon, 'Flag')
  }
  const off = buildNav({ can: allow, role: 'ADMIN', moduleEnabled: m => m !== 'okr' }).flatMap(paths)
  assert.ok(!off.includes('/admin/okr/projects'), 'OKR 模块关了不出现')
  assert.equal(activeMenuPath('/admin/okr/projects'), '/admin/okr/projects')
  assert.equal(activeMenuPath('/admin/okr/person/3'), '/admin/okr')
  const layout = readFileSync(new URL('../../src/views/admin/AdminLayout.vue', import.meta.url), 'utf8')
  assert.match(layout, /const NAV_ICONS = \{[^}]*\bFlag\b/, 'Flag 图标已注册')
})
