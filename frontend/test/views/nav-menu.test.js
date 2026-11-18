import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@vue/compiler-sfc'
import { buildNav, activeMenuPath, DEFAULT_OPENEDS, NAV_GROUPS } from '../../src/views/admin/navMenu.js'

// 0.5.0 侧栏五组: 今日 / 团队 / 交付 / 经验 / 设置
const allow = () => true
const paths = (g) => g.items.map(i => i.path)
const byKey = (groups) => Object.fromEntries(groups.map(g => [g.key, g]))

test('ADMIN 看到五组, 团队 4 项、交付 5 项、经验 3 项(创意中心排第一)', () => {
  const groups = buildNav({ can: allow, role: 'ADMIN' })
  assert.deepEqual(groups.map(g => g.key), ['today', 'team', 'delivery', 'experience', 'config'])
  const g = byKey(groups)
  assert.deepEqual(paths(g.today), ['/admin/workbench'])
  assert.equal(g.today.index, null, '今日是一级菜单项, 不是分组')
  assert.deepEqual(paths(g.team), ['/admin/team/members', '/admin/team/load', '/admin/okr', '/admin/team/skills'])
  assert.deepEqual(paths(g.delivery), ['/admin/projects', '/admin/tasks', '/admin/customers', '/admin/knowledge', '/admin/onboarding'])
  assert.deepEqual(paths(g.experience), ['/admin/ideas', '/admin/experience', '/admin/conversations'])
  const second = ['team', 'delivery', 'experience'].reduce((n, k) => n + g[k].items.length, 0)
  assert.ok(second <= 12, `业务二级菜单 ≤12 项, 实际 ${second}`)
})

test('工时从菜单移除(任何角色都不出现 /admin/timesheets)', () => {
  for (const role of ['ADMIN', 'MANAGER', 'FDE_ENGINEER']) {
    const all = buildNav({ can: allow, role }).flatMap(paths)
    assert.ok(!all.includes('/admin/timesheets'), role)
    assert.ok(!all.includes('/admin/assets'), '资产库并进经验库页内切换, 不单独占菜单')
  }
})

test('非 ADMIN 看不到团队组(组长可见留到第 4 轮), 落地页仍是我的今日', () => {
  const engineerPerms = new Set(['projects', 'project.view', 'knowledge', 'idea.view', 'asset.view'])
  const groups = buildNav({ can: p => engineerPerms.has(p), role: 'FDE_ENGINEER' })
  const keys = groups.map(g => g.key)
  assert.ok(!keys.includes('team'))
  assert.ok(!keys.includes('config'), '没有设置类权限时设置组整组不出现')
  assert.deepEqual(paths(byKey(groups).today), ['/admin/workbench'])
  assert.ok(paths(byKey(groups).delivery).includes('/admin/tasks'), '工程师兜底能看到任务')
  assert.deepEqual(paths(byKey(groups).experience), ['/admin/ideas', '/admin/experience', '/admin/conversations'])
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
