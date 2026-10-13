// 版本开关(多实例) —— 模块白名单/黑名单、权限过滤、接口 404 守卫
// 这层决定"裁剪版实例看得到什么", 配错了要么泄漏功能要么把全量实例关掉, 所以逐条钉死。
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_MODULES, CORE_MODULES, PERM_PREFIX_MODULE,
  reloadEdition, isModuleEnabled, enabledModuleList, editionName,
  moduleOfPermission, filterEnabledPermissions, moduleOfPath, editionGuard
} from '../../src/config/edition.js'
import { PERMISSIONS } from '../../src/lib/auth.js'
import { MODULE_PREFIXES, MODULE_NAMES } from '../../src/config/modules.js'

// 裁剪版口径: 只保留生产交付链
const MINIMAL = 'projects,project_records,tasks,timesheets,engineers,knowledge,onboarding'

afterEach(() => reloadEdition({}))   // 每个用例后回到全量, 免得互相污染

describe('v2.7.0 版本模块开关', () => {
  test('不配环境变量 = 全量', () => {
    reloadEdition({})
    assert.equal(editionName(), 'full')
    assert.equal(enabledModuleList().length, ALL_MODULES.length)
    for (const m of ALL_MODULES) assert.ok(isModuleEnabled(m), `${m} 应默认启用`)
  })

  test('白名单只开列出的模块, 核心模块永远在', () => {
    reloadEdition({ ENABLED_MODULES: MINIMAL })
    assert.equal(editionName(), 'tenant')
    assert.ok(isModuleEnabled('projects'))
    assert.ok(isModuleEnabled('knowledge'))
    assert.equal(isModuleEnabled('assets'), false)
    assert.equal(isModuleEnabled('ideas'), false)
    for (const core of CORE_MODULES) assert.ok(isModuleEnabled(core), `核心模块 ${core} 不该被关掉`)
  })

  test('黑名单开全量再减, 且关不掉核心模块', () => {
    reloadEdition({ DISABLED_MODULES: 'onboarding,knowledge,admin' })
    assert.equal(isModuleEnabled('onboarding'), false)
    assert.equal(isModuleEnabled('knowledge'), false)
    assert.ok(isModuleEnabled('admin'), 'admin 是核心模块, 黑名单也关不掉')
    assert.ok(isModuleEnabled('ideas'), '没列进黑名单的照常开')
  })

  test('白名单优先于黑名单, 且忽略拼错的模块码', () => {
    reloadEdition({ ENABLED_MODULES: 'projects,不存在的模块', DISABLED_MODULES: 'projects' })
    assert.ok(isModuleEnabled('projects'))
    assert.equal(enabledModuleList().includes('不存在的模块'), false)
  })

  test('每个权限前缀都要有模块归属 —— 新增权限点忘了登记会被这条拦下', () => {
    const prefixes = [...new Set(Object.keys(PERMISSIONS).map(k => k.split('.')[0]))]
    const missing = prefixes.filter(p => !PERM_PREFIX_MODULE[p])
    assert.deepEqual(missing, [], `这些权限前缀没有归属模块: ${missing.join(', ')}`)
    const badTarget = [...new Set(Object.values(PERM_PREFIX_MODULE))].filter(c => !ALL_MODULES.includes(c))
    assert.deepEqual(badTarget, [], `映射到了不存在的模块码: ${badTarget.join(', ')}`)
  })

  // 这条守的是「菜单点进去报 4041」那类 bug:
  // 路径表里的模块码必须在 MODULE_NAMES 登记, 否则 edition 当成未知模块误关。
  test('路径表里的每个模块码都要在 MODULE_NAMES 登记, 否则会被当成未知模块误关', () => {
    const prefixCodes = [...new Set(MODULE_PREFIXES.map(([, code]) => code))]
    const unregistered = prefixCodes.filter(c => !MODULE_NAMES[c])
    assert.deepEqual(unregistered, [], `这些模块码没在 MODULE_NAMES 登记: ${unregistered.join(', ')}`)
    for (const c of prefixCodes) {
      assert.ok(ALL_MODULES.includes(c), `${c} 不在可开关模块清单里`)
    }
  })

  test('权限归属与路径归属必须指向同一模块 —— 否则菜单显示着点进去 404', () => {
    reloadEdition({})
    const pairs = [
      ['team.manage', '/api/fde/teams'],
      ['asset.view', '/api/fde/assets'],
      ['knowledge.view', '/api/fde/knowledge'],
      ['idea.view', '/api/fde/ideas/topics'],
      ['engineer.view', '/api/fde/engineers']
    ]
    for (const [perm, path] of pairs) {
      assert.equal(moduleOfPermission(perm), moduleOfPath(path), `${perm} 与 ${path} 的模块归属不一致`)
    }
  })

  test('权限按模块过滤: 关掉的模块权限不下发给前端', () => {
    reloadEdition({ ENABLED_MODULES: MINIMAL })
    const out = filterEnabledPermissions(['project.view', 'task.create', 'asset.view', 'idea.create', 'user.view'])
    assert.deepEqual(out, ['project.view', 'task.create', 'user.view'])
    assert.equal(moduleOfPermission('asset.view'), 'assets')
  })

  test('viewFinance 归属 projects', () => {
    reloadEdition({ DISABLED_MODULES: 'projects' })
    assert.equal(moduleOfPermission('project.viewFinance'), 'projects')
    const out = filterEnabledPermissions(['project.view', 'project.viewFinance', 'timesheet.approve'])
    assert.deepEqual(out, ['timesheet.approve'])
  })

  test('hasPermission 与前端下发口径一致: 关掉的模块权限在服务端也不成立', async () => {
    const { hasPermission } = await import('../../src/lib/auth.js')
    const admin = { role: 'ADMIN' }
    reloadEdition({})
    assert.equal(hasPermission(admin, 'project.viewFinance'), true, '全量版照常')
    reloadEdition({ DISABLED_MODULES: 'projects' })
    // 关 projects 后项目详情不该再吐字段(界面隐藏不等于接口不发)
    assert.equal(hasPermission(admin, 'project.viewFinance'), false)
    assert.equal(hasPermission(admin, 'idea.view'), true, '创意中心不受牵连')
  })

  test('路径归属沿用使用分析的前缀表', () => {
    assert.equal(moduleOfPath('/api/fde/ideas'), 'ideas')
    assert.equal(moduleOfPath('/api/fde/projects/1'), 'projects')
    assert.equal(moduleOfPath('/api/fde/assets/123'), 'assets')
  })

  test('守卫: 关掉的模块接口 404, 开着的放行', () => {
    reloadEdition({ ENABLED_MODULES: MINIMAL })
    const call = (path) => {
      let status = null, body = null, passed = false
      editionGuard(
        { path },
        { status(s) { status = s; return this }, json(b) { body = b } },
        () => { passed = true }
      )
      return { status, body, passed }
    }
    const blocked = call('/api/fde/ideas')
    assert.equal(blocked.passed, false)
    assert.equal(blocked.status, 404)
    assert.equal(blocked.body.code, 4041)
    assert.equal(call('/api/fde/projects').passed, true)
    assert.equal(call('/api/auth/login').passed, true, '登录永远不能被关')
    assert.equal(call('/health').passed, true, '健康检查永远不能被关')
    assert.equal(call('/api/fde/me').passed, true, '个人中心是核心')
  })

  test('全量实例下守卫不拦任何东西', () => {
    reloadEdition({})
    for (const path of ['/api/fde/assets', '/api/fde/knowledge', '/api/fde/ideas']) {
      let passed = false
      editionGuard({ path }, { status() { return this }, json() {} }, () => { passed = true })
      assert.ok(passed, `${path} 在全量版不该被拦`)
    }
  })
})
