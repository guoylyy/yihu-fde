import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@vue/compiler-sfc'
import { buildNav, activeMenuPath, DEFAULT_OPENEDS, NAV_GROUPS } from '../../src/views/admin/navMenu.js'

// 0.5.0 侧栏五组: 今日 / 团队 / 交付 / 经验 / 设置
const allow = () => true
const paths = (g) => g.items.map(i => i.path)
const byKey = (groups) => Object.fromEntries(groups.map(g => [g.key, g]))

test('ADMIN 看到五组, 团队 4 项(工时最后)、交付 5 项(精简第二轮去掉项目 OKR / 每日总结 / 决策记录)、经验 3 项(创意中心排第一)', () => {
  const groups = buildNav({ can: allow, role: 'ADMIN' })
  assert.deepEqual(groups.map(g => g.key), ['today', 'team', 'delivery', 'experience', 'config'])
  const g = byKey(groups)
  assert.deepEqual(paths(g.today), ['/admin/workbench'])
  assert.equal(g.today.index, null, '今日是一级菜单项, 不是分组')
  assert.deepEqual(paths(g.team), ['/admin/team/members', '/admin/okr', '/admin/team/skills', '/admin/timesheets'])
  assert.deepEqual(paths(g.delivery), ['/admin/projects', '/admin/tasks', '/admin/customers', '/admin/knowledge', '/admin/onboarding'])
  assert.deepEqual(paths(g.experience), ['/admin/ideas', '/admin/experience', '/admin/conversations'])
  const second = ['team', 'delivery', 'experience'].reduce((n, k) => n + g[k].items.length, 0)
  assert.equal(second, 12, `业务二级菜单 12 项(精简第二轮 -4: 负载 / 项目 OKR / 每日总结 / 决策记录), 实际 ${second}`)
})

test('0.5.2 工时放回团队组, 排最后(成员/周 OKR/能力矩阵/工时), 按 timesheet.view 显示', () => {
  for (const role of ['ADMIN', 'MANAGER', 'FDE_ENGINEER']) {
    const team = byKey(buildNav({ can: allow, role })).team
    assert.equal(paths(team).at(-1), '/admin/timesheets', role)
    assert.ok(!buildNav({ can: allow, role }).flatMap(paths).includes('/admin/assets'), '资产库并进经验库页内切换, 不单独占菜单')
  }
  const admin = byKey(buildNav({ can: allow, role: 'ADMIN' })).team
  assert.equal(paths(admin).indexOf('/admin/timesheets'), 3)
  const item = admin.items[3]
  assert.equal(item.title, 'common.hours')
  assert.equal(item.icon, 'Timer')
  const noTs = buildNav({ can: p => p !== 'timesheet.view', role: 'ADMIN' }).flatMap(paths)
  assert.ok(!noTs.includes('/admin/timesheets'), '没有 timesheet.view 不显示')
  const layout = readFileSync(new URL('../../src/views/admin/AdminLayout.vue', import.meta.url), 'utf8')
  assert.match(layout, /const NAV_ICONS = \{[^}]*\bTimer\b/, 'Timer 图标已注册')
})

test('没有 team.view 的工程师: 团队组只有能力矩阵(0.6.4), 落地页仍是我的今日', () => {
  const engineerPerms = new Set(['projects', 'project.view', 'knowledge', 'idea.view', 'asset.view'])
  const groups = buildNav({ can: p => engineerPerms.has(p), role: 'FDE_ENGINEER' })
  const keys = groups.map(g => g.key)
  // 0.6.4 能力矩阵人人可见: 团队组只剩这一项(成员 / 周 OKR / 工时仍按权限)
  assert.deepEqual(paths(byKey(groups).team), ['/admin/team/skills'])
  assert.ok(!keys.includes('config'), '没有设置类权限时设置组整组不出现')
  assert.deepEqual(paths(byKey(groups).today), ['/admin/workbench'])
  assert.ok(paths(byKey(groups).delivery).includes('/admin/tasks'), '工程师兜底能看到任务')
  assert.deepEqual(paths(byKey(groups).experience), ['/admin/ideas', '/admin/experience', '/admin/conversations'])
})

test('组长(team.view)看到团队组成员/能力矩阵, 不出现周 OKR; 负载 / 承诺 vs 交付已下线', () => {
  const lead = byKey(buildNav({ can: p => p === 'team.view', role: 'TEAM_LEAD' }))
  assert.deepEqual(paths(lead.team), ['/admin/team/members', '/admin/team/skills'])
  const admin = buildNav({ can: allow, role: 'ADMIN' }).flatMap(paths)
  assert.ok(!admin.includes('/admin/team/load') && !admin.includes('/admin/team/promise'))
  assert.equal(activeMenuPath('/admin/team/promise'), '/admin/team/promise', '不再特判高亮到负载')
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

test('精简第二轮: 项目 OKR / 每日总结 / 决策记录 / 负载 不再出现; 路由和页面文件都删了, 图标不再注册', async () => {
  const { existsSync } = await import('node:fs')
  for (const role of ['ADMIN', 'MANAGER', 'FDE_ENGINEER', 'TEAM_LEAD']) {
    const all = buildNav({ can: allow, role }).flatMap(paths)
    for (const p of ['/admin/okr/projects', '/admin/okr/daily', '/admin/okr/decisions', '/admin/team/load', '/admin/team/promise']) {
      assert.ok(!all.includes(p), `${role} ${p}`)
    }
  }
  // 子页高亮: 只剩通用前缀(/admin/okr/team、/admin/okr/person/3 → 周 OKR)
  assert.equal(activeMenuPath('/admin/okr/person/3'), '/admin/okr')
  assert.equal(activeMenuPath('/admin/okr/history'), '/admin/okr')
  const nav = readFileSync(new URL('../../src/views/admin/navMenu.js', import.meta.url), 'utf8')
  assert.doesNotMatch(nav.slice(nav.indexOf('export function activeMenuPath')), /okr\/projects|okr\/daily|okr\/decisions|team\/promise|team\/load/)
  const router = readFileSync(new URL('../../src/router/index.js', import.meta.url), 'utf8')
  for (const p of ['okr/projects', 'okr/daily', 'okr/decisions', 'team/load', 'team/promise']) {
    assert.ok(!router.includes(`path: '${p}'`), `路由 ${p} 已删`)
  }
  for (const f of ['views/okr/ProjectOkr.vue', 'views/okr/DailySummary.vue', 'views/okr/OkrDecisions.vue', 'components/okr/OkrDecisionDialog.vue',
    'views/admin/team/TeamLoad.vue', 'views/admin/team/TeamPromise.vue', 'components/okr/OkrRiskPanel.vue']) {
    assert.ok(!existsSync(new URL(`../../src/${f}`, import.meta.url)), `${f} 已删`)
  }
  for (const f of ['components/okr/OkrRiskBars.vue', 'components/okr/OkrExportMenu.vue', 'components/okr/OkrWeekBar.vue', 'views/okr/okrUtils.js']) {
    assert.ok(existsSync(new URL(`../../src/${f}`, import.meta.url)), `${f} 保留`)
  }
  const layout = readFileSync(new URL('../../src/views/admin/AdminLayout.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(layout, /\b(TrendCharts|Flag|Notebook|Stamp)\b/, '下线菜单的图标不再引入')
  assert.doesNotMatch(layout, /team\/load|team\/promise/)
})

test('0.6.4 能力矩阵对所有登录角色都显示, 不再要 team.view', () => {
  for (const role of ['FDE_ENGINEER', 'MANAGER', 'TEAM_LEAD', 'ADMIN']) {
    const all = buildNav({ can: () => false, role }).flatMap(paths)
    assert.ok(all.includes('/admin/team/skills'), role)
  }
})
