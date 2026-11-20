// 单元测试 - 0.5.0 R4a 组长层与团队四屏的纯规则
// 负载百分比/档位、承诺 vs 实际的提示标记、会话里推断技能、组长相关权限点默认值
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { loadPct, loadBand, LOAD_THRESHOLD, promiseFlags, skillsMentioned } from '../../src/lib/teamLoad.js'
import { PERMISSIONS, BUILTIN_ROLES, DATA_SCOPES } from '../../src/lib/auth.js'

describe('团队负载 loadPct / loadBand', () => {
  test('阈值 5: 3 个 60% OK, 5 个 100% WARN, 6 个 120% WARN, 8 个 160% OVER', () => {
    assert.equal(LOAD_THRESHOLD, 5)
    assert.equal(loadPct(0), 0)
    assert.equal(loadPct(3), 60); assert.equal(loadBand(60), 'OK')
    assert.equal(loadPct(5), 100); assert.equal(loadBand(100), 'WARN')
    assert.equal(loadPct(6), 120); assert.equal(loadBand(120), 'WARN')
    assert.equal(loadPct(8), 160); assert.equal(loadBand(160), 'OVER')
    assert.equal(loadBand(150), 'OVER', '150 正好算 OVER')
    assert.equal(loadBand(149), 'WARN')
  })
})

describe('承诺 vs 实际 promiseFlags', () => {
  test('三种标记各自成立', () => {
    assert.deepEqual(promiseFlags({ objectiveCount: 2, completedTasks: 0, activeTaskCount: 0, conversationCount: 1 }), ['ONLY_WORDS'])
    assert.deepEqual(promiseFlags({ objectiveCount: 0, completedTasks: 1, activeTaskCount: 2, conversationCount: 0 }), ['ELSEWHERE'])
    assert.deepEqual(promiseFlags({ objectiveCount: 0, completedTasks: 0, activeTaskCount: 0, conversationCount: 3 }), ['DRIFT'])
  })

  test('正常推进不出标记; 同时命中时 DRIFT 排最前', () => {
    assert.deepEqual(promiseFlags({ objectiveCount: 1, completedTasks: 2, activeTaskCount: 3, conversationCount: 4 }), [])
    assert.deepEqual(promiseFlags({}), [], '什么都没有 = 没东西可提示')
    assert.deepEqual(promiseFlags({ objectiveCount: 1, completedTasks: 0, activeTaskCount: 0, conversationCount: 5 }), ['DRIFT', 'ONLY_WORDS'])
    assert.deepEqual(promiseFlags({ objectiveCount: 1, completedTasks: 0, activeTaskCount: 2, conversationCount: 0 }), ['ONLY_WORDS', 'ELSEWHERE'])
  })
})

describe('会话里推断技能 skillsMentioned', () => {
  const skills = [{ id: 1, name: 'Go' }, { id: 2, name: 'Vue' }, { id: 3, name: '小程序' }, { id: 4, name: 'C++' }]

  test('tags 精确命中(不分大小写), 标题按单词边界/中文子串', () => {
    assert.deepEqual([...skillsMentioned({ tags: ['vue'], title: null }, skills)], ['2'])
    assert.deepEqual([...skillsMentioned({ tags: [], title: '修 Go 服务的超时' }, skills)], ['1'])
    assert.deepEqual([...skillsMentioned({ tags: null, title: '微信小程序登录' }, skills)], ['3'])
    assert.deepEqual([...skillsMentioned({ title: '升级 c++ 编译器' }, skills)], ['4'])
  })

  test('不误伤: Go 不命中 Google / gopher', () => {
    assert.equal(skillsMentioned({ tags: ['google'], title: 'Google 登录与 gopher 吉祥物' }, skills).size, 0)
  })
})

describe('组长层权限点与角色', () => {
  test('team.view 给组长和老板, team.view.all 只给老板; 主管分给老板与部门主管, 不给组长(能看不能评)', () => {
    assert.deepEqual([...PERMISSIONS['team.view']].sort(), ['ADMIN', 'TEAM_LEAD'])
    assert.deepEqual(PERMISSIONS['team.view.all'], ['ADMIN'])
    assert.deepEqual(PERMISSIONS['okr.score.manager'], ['ADMIN', 'MANAGER'])
    assert.ok(!PERMISSIONS['okr.score.manager'].includes('TEAM_LEAD'))
  })

  test('内置角色 TEAM_LEAD(dataScope=TEAM) 排在 MANAGER 与 FDE_ENGINEER 之间', () => {
    const codes = BUILTIN_ROLES.map(r => r.code)
    assert.ok(codes.indexOf('MANAGER') < codes.indexOf('TEAM_LEAD'))
    assert.ok(codes.indexOf('TEAM_LEAD') < codes.indexOf('FDE_ENGINEER'))
    assert.equal(BUILTIN_ROLES.find(r => r.code === 'TEAM_LEAD').dataScope, 'TEAM')
    assert.ok(DATA_SCOPES.includes('TEAM'))
  })
})
