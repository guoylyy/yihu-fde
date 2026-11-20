// 0.5.8 主管评分开放给部门主管(MANAGER): 入口门槛、面板只列本团队、归档(保存并完成本周)只给 ADMIN。
// 纯函数直接测; 面板用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { mayScoreManager, mayCloseWeek, inScorePanel } from '../../src/views/okr/okrPeople.js'

const esc = s => String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const btnTag = (html, dt) => (html.match(new RegExp(`<[^>]*data-test="${dt}"[^>]*>`)) || [''])[0]
const withFooter = { setup: (_, { slots }) => () => Vue.h('div', [slots.default?.(), slots.footer?.()]) }

const ADMIN = { id: '1', role: 'ADMIN' }
const MANAGER = { id: '40', role: 'MANAGER' }
const LEAD = { id: '41', role: 'TEAM_LEAD' }
const ENGINEER = { id: '38', role: 'FDE_ENGINEER' }

// 模拟 /cycle?ownerId= 的返回: MANAGER 看本团队 A(38) → scoreOwner=true; 外团队 X(99) → false
const payload = scoreOwner => ({ owner: { id: 'x' }, can: { scoreOwner } })

describe('主管评分入口门槛', () => {
  test('ADMIN / MANAGER 有权限 → 有入口; TEAM_LEAD / 工程师没有; 没权限一律没有', () => {
    assert.equal(mayScoreManager(ADMIN, true), true)
    assert.equal(mayScoreManager(MANAGER, true), true)
    assert.equal(mayScoreManager(LEAD, true), false, '组长即使被勾了权限也不出入口')
    assert.equal(mayScoreManager(ENGINEER, true), false)
    assert.equal(mayScoreManager(ENGINEER, false), false)
    assert.equal(mayScoreManager(MANAGER, false), false)
    assert.equal(mayScoreManager({}, true), false)
  })

  test('归档只给 ADMIN', () => {
    assert.equal(mayCloseWeek(ADMIN), true)
    assert.equal(mayCloseWeek(MANAGER), false)
    assert.equal(mayCloseWeek(LEAD), false)
    assert.equal(mayCloseWeek(ENGINEER), false)
    assert.equal(mayCloseWeek(null), false)
  })

  test('MyOkr / TeamOkr 都按角色 + 权限给入口, 归档开关传给面板', () => {
    for (const f of ['views/okr/MyOkr.vue', 'views/okr/TeamOkr.vue']) {
      const s = src(f)
      assert.match(s, /mayScoreManager\(me, can\('okr\.score\.manager'\)\)/, f)
      assert.match(s, /const canCloseWeek = mayCloseWeek\(me\)/, f)
      assert.match(s, /<OkrManagerScorePanel[^>]*:can-close="canCloseWeek"/, f)
    }
  })
})

describe('评分面板只列本团队', () => {
  test('inScorePanel: 自己照列(锁定); 别人看后端 can.scoreOwner', () => {
    assert.equal(inScorePanel(payload(true), '38', '40'), true, '本团队成员')
    assert.equal(inScorePanel(payload(false), '99', '40'), false, '外团队不列')
    assert.equal(inScorePanel(payload(false), '40', '40'), true, '自己(显示为不能自评)')
    assert.equal(inScorePanel({ can: {} }, '99', '1'), true, '老后端没字段按可评(后端仍拒越界)')
  })

  test('面板 load() 逐人过滤后才放进列表', () => {
    const s = src('components/okr/OkrManagerScorePanel.vue')
    const fn = s.split('async function load()')[1].split('async function saveScores()')[0]
    assert.ok(fn.indexOf('inScorePanel(d, u.id, props.meId)') > 0)
    assert.ok(fn.indexOf('inScorePanel(d, u.id, props.meId)') < fn.indexOf('out.push('))
  })
})

describe('面板按角色渲染', () => {
  const render = compileView('components/okr/OkrManagerScorePanel.vue')
  const groups = [{ user: { id: '38', name: '林晓' }, rows: [{ id: '1', seq: 1, title: 'O-上线', selfScore: 80, original: null, score: 85, comment: '', locked: null }] }]
  const state = (over = {}) => {
    const st = { modelValue: true, week: '2026-W47', closed: false, canClose: false, mobile: false, loading: false, busy: '', error: '', groups, load() {}, saveOnly() {}, saveAndClose() {}, ...over }
    st.allRows = st.groups.flatMap(g => g.rows)
    st.scoredCount = st.allRows.filter(r => r.original != null).length
    return st
  }
  const EX = { 'el-drawer': withFooter, 'el-input-number': true }

  test('MANAGER 登录: 有「保存评分」, 没有「保存并完成本周」, 旁边提示归档由老板完成', async () => {
    const html = await renderView(render, state({ canClose: false }), EX)
    assert.ok(html.includes('data-test="okr-mgr-panel"'))
    assert.ok(html.includes('林晓'))
    assert.ok(btnTag(html, 'okr-mgr-save'))
    assert.ok(!html.includes('data-test="okr-mgr-close"'))
    assert.ok(!html.includes(esc(t('okr.v3.mgr_save_close'))), '提示里也不出现这个按钮名')
    assert.ok(html.split('data-test="okr-mgr-close-by-boss"')[1].includes(esc(t('okr.v3.mgr_close_by_boss'))))
    assert.ok(html.includes(esc(t('okr.v3.mgr_hint_team'))))
  })

  test('ADMIN 登录: 「保存评分」与「保存并完成本周」都在, 没有老板提示', async () => {
    const html = await renderView(render, state({ canClose: true }), EX)
    assert.ok(btnTag(html, 'okr-mgr-save'))
    assert.ok(btnTag(html, 'okr-mgr-close'))
    assert.ok(!html.includes('data-test="okr-mgr-close-by-boss"'))
    assert.ok(html.includes(esc(t('okr.v3.mgr_hint'))))
  })

  test('saveAndClose 没有归档权限时不调 close-by-score', () => {
    const fn = src('components/okr/OkrManagerScorePanel.vue').split('async function saveAndClose()')[1]
    assert.ok(fn.indexOf('if (!props.canClose) return') < fn.indexOf('fde.okr.closeByScore(props.week)'))
  })

  test('页面与面板没有「重开」与应急归档入口', () => {
    for (const f of ['views/okr/MyOkr.vue', 'views/okr/TeamOkr.vue', 'components/okr/OkrManagerScorePanel.vue']) {
      assert.ok(!/reopen|okr\.close\(/.test(src(f)), f)
    }
  })
})

describe('MyOkr 页头: 工程师没有评分入口', () => {
  test('ENGINEER 登录: canScoreManager=false → 没有「主管评分」按钮, 面板不挂', async () => {
    assert.equal(mayScoreManager(ENGINEER, false), false)
    const s = src('views/okr/MyOkr.vue')
    assert.match(s, /v-if="canScoreManager" class="okr-act-btn okr-act-mgr"/)
    assert.match(s, /<OkrManagerScorePanel\s+v-if="canScoreManager && data\?\.cycle"/)
  })
})

describe('文案', () => {
  test('中英文都有新键', () => {
    for (const f of ['locales/zh-CN.json', 'locales/en.json']) {
      const v3 = JSON.parse(src(f)).okr.v3
      assert.ok(v3.mgr_hint_team && v3.mgr_close_by_boss, f)
    }
    assert.equal(JSON.parse(src('locales/zh-CN.json')).okr.v3.mgr_close_by_boss, '本周归档由老板完成')
  })
})
