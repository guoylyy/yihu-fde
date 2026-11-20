// 周 OKR 补录: 任意周(本年第 1 周 ~ 下周)都能新建 / 补录; 空态不再是死路; 周切换到边界箭头置灰。
// 纯函数直接测; 页面用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  weekWindow, weekNav, inWindow, isPastKey, shortWeekLabel, emptyState, isBackfilledPlan, compareKey, pct
} from '../../src/views/okr/okrUtils.js'

const NOW = new Date('2026-11-20T04:00:00Z') // 2026-W47 周五(上海)
const WIN = { from: '2026-W01', to: '2026-W48' }
const esc = s => s.replace(/'/g, '&#39;')
const tt = arr => t(...arr)

describe('补录窗口 / 周切换边界', () => {
  test('窗口: 后端给了用后端的; 没给按本机时间算本年 W01 ~ 下周', () => {
    assert.deepEqual(weekWindow(null, NOW), WIN)
    assert.deepEqual(weekWindow({ from: '2026-W01', to: '2026-W49' }, NOW), { from: '2026-W01', to: '2026-W49' })
    // 跨年: 2026-12-31 是 2026-W53, 下周 = 2027-W01
    assert.deepEqual(weekWindow(null, new Date('2026-12-31T04:00:00Z')), { from: '2026-W01', to: '2027-W01' })
    assert.ok(inWindow('2026-W44', WIN))
    assert.ok(!inWindow('2026-W49', WIN))
    assert.ok(!inWindow('2025-W52', WIN))
    assert.ok(compareKey('2027-W01', '2026-W53') > 0)
  })

  test('第 1 周的 ‹(第 0 周)、窗口最后一周的 ›(再往后)置灰', () => {
    assert.deepEqual(weekNav('2026-W01', WIN), { prev: false, next: true })
    assert.deepEqual(weekNav('2026-W48', WIN), { prev: true, next: false })
    assert.deepEqual(weekNav('2026-W47', WIN), { prev: true, next: true })
    // 年末: 窗口到 2027-W01 时, 2026-W53 → 可以翻到下一年第 1 周, 2027-W01 不能再往后(不会出现第 54 周)
    const yearEnd = { from: '2026-W01', to: '2027-W01' }
    assert.deepEqual(weekNav('2026-W53', yearEnd), { prev: true, next: true })
    assert.deepEqual(weekNav('2027-W01', yearEnd), { prev: true, next: false })
  })

  test('从链接进了窗口外的周: 只有朝窗口方向的箭头可点', () => {
    assert.deepEqual(weekNav('2025-W30', WIN), { prev: false, next: true })
    assert.deepEqual(weekNav('2026-W52', WIN), { prev: true, next: false })
  })

  test('过去周判断 + 「26/第44周」标签', () => {
    assert.equal(isPastKey('2026-W46', NOW), true)
    assert.equal(isPastKey('2026-W47', NOW), false)
    assert.equal(shortWeekLabel('2026-W44'), '26/W44')
    assert.equal(shortWeekLabel('2026-W44', t), t('okr.backfill.week_label', { p0: '26', p1: 44 }))
  })
})

describe('空态 emptyState: 不再是死路', () => {
  const nullCycle = (over = {}) => ({ cycle: null, week: '2026-W44', backfill: true, window: WIN, owner: { id: '5', name: '林晓' }, objectives: [], can: { create: true, proxy: false }, ...over })
  const cycle = (over = {}, can = {}) => ({ cycle: { key: '2026-W47', status: 'IN_PROGRESS', backfilled: false, ...over }, window: WIN, owner: { id: '5', name: '林晓' }, objectives: [], can: { edit: true, proxy: false, ...can } })

  test('本人 · 过去周(没有周期) → 「补录这一周」', () => {
    const e = emptyState(nullCycle(), { now: NOW })
    assert.equal(e.action, 'backfill')
    assert.deepEqual(e.label, ['okr.backfill.action'])
  })

  test('本人 · 本周 / 下周 → 「新建本周 OKR」/「新建下周 OKR」', () => {
    assert.deepEqual(emptyState(cycle(), { now: NOW }).label, ['okr.backfill.create_this'])
    assert.deepEqual(emptyState(cycle({ key: '2026-W48' }), { now: NOW }).label, ['okr.backfill.create_next'])
    // 周五复盘里没交过: 后端 can.edit = true → 仍给「新建本周 OKR」
    assert.equal(emptyState(cycle({ status: 'REVIEW' }), { now: NOW }).action, 'create')
  })

  test('本人 · 已归档 / 超出窗口: 只给说明, 不给按钮', () => {
    const closed = emptyState(cycle({ key: '2026-W40', status: 'CLOSED', backfilled: true }, { edit: false }), { now: NOW })
    assert.equal(closed.action, null)
    assert.deepEqual(closed.text, ['okr.backfill.archived'])
    const old = emptyState(nullCycle({ week: '2025-W10', can: { create: false } }), { now: NOW })
    assert.equal(old.action, null)
    assert.deepEqual(old.text, ['okr.backfill.out_of_window', { p0: '2026-W01', p1: '2026-W48' }])
  })

  test('看别人没数据: 「<姓名> 这一周没有提交 OKR」, 无代管权不给按钮', () => {
    const e = emptyState(nullCycle({ can: { create: false, proxy: false } }), { viewingOther: true, ownerName: '林晓', now: NOW })
    assert.equal(e.action, null)
    assert.deepEqual(e.text, ['okr.backfill.other_none', { p0: '林晓' }])
    // 后端说能建但我没代管权(不该发生), 前端也不放宽
    assert.equal(emptyState(nullCycle({ can: { create: true, proxy: false } }), { viewingOther: true, now: NOW }).action, null)
  })

  test('看别人 + 代管权: 「代 <姓名> 补录」', () => {
    const e = emptyState(nullCycle({ can: { create: true, proxy: true } }), { viewingOther: true, ownerName: '林晓', now: NOW })
    assert.equal(e.action, 'proxy')
    assert.deepEqual(e.label, ['okr.backfill.proxy_backfill', { p0: '林晓' }])
  })

  test('有 O 就不是空态; 老后端没给 can.create 时不显示按钮(不在前端放宽)', () => {
    assert.equal(emptyState({ ...nullCycle(), objectives: [{ id: '1' }] }, { now: NOW }), null)
    assert.equal(emptyState({ cycle: null, week: '2026-W44', objectives: [] }, { now: NOW }).action, null)
  })

  test('补录标签: 有 O 在那周过完后才提交', () => {
    const d = { cycle: { endDate: '2026-11-08T15:59:59.999Z' }, objectives: [{ status: 'ON_TRACK', submittedAt: '2026-11-20T03:00:00Z' }] }
    assert.equal(isBackfilledPlan(d), true)
    assert.equal(isBackfilledPlan({ ...d, objectives: [{ status: 'ON_TRACK', submittedAt: '2026-11-03T03:00:00Z' }] }), false)
    assert.equal(isBackfilledPlan({ ...d, objectives: [{ status: 'DROPPED', submittedAt: '2026-11-20T03:00:00Z' }] }), false)
  })
})

describe('MyOkr 页面渲染: 空态按钮 / 补录提示条', () => {
  const render = compileView('views/okr/MyOkr.vue')
  const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrObjectiveCard: true, OkrPlanEditor: { setup: () => () => Vue.h('div', { class: 'editor-stub' }) }, OkrReportDraftDialog: true, 'el-checkbox': true, 'el-input-number': true }
  const state = (over = {}) => ({
    loading: false, isMobile: false, busy: '', editing: false, draftInit: [], editorRef: null, reportOpen: false, reportSource: 'text',
    self: { visible: false }, miss: { visible: false, reason: '' }, selfObj: null, scorable: [], selfDone: 0,
    pickedId: '3', people: [], meId: '3', meName: 'Me', ownerId: '', ownerName: '',
    viewingOther: false, proxyMode: false, proxyTarget: '', canAct: true, canEditPlan: false, canScoreManager: false, showSelfScore: false,
    submittedOnce: false, canTeam: true, tagText: '', tagType: 'info', weekKeyNow: '2026-W44', weekParts: { year: 2026, weekNo: 44 },
    nav: { prev: true, next: true }, weekDates: {}, backfillTag: '', isPastWeek: true, deadlinePassed: true, weekLabel: '26/W44', editorOpen: false,
    pct, shift() {}, pickPerson() {}, openDraft() {}, startEdit() {}, startBackfill() {}, savePlan() {}, addUpdate() {}, managerScore() {}, openMiss() {}, fillFromReport() {},
    data: { cycle: null, week: '2026-W44', backfill: true, objectives: [], owner: { id: '3', name: 'Me' }, can: { create: true, proxy: false } },
    empty: null,
    ...over
  })

  test('过去周空态: 渲染「补录这一周」按钮, 没有旧的「这一周没有 OKR 记录」', async () => {
    const st = state()
    st.empty = emptyState(st.data, { now: NOW })
    const html = await renderView(render, st, EXTRA)
    assert.ok(html.includes('data-test="okr-empty-backfill"'), html)
    assert.ok(html.includes(esc(t('okr.backfill.action'))))
    assert.ok(html.includes(esc(t('okr.backfill.empty_past'))))
    assert.ok(!html.includes(esc(t('okr.no_cycle'))))
  })

  test('本周空态: 渲染「新建本周 OKR」', async () => {
    const data = { cycle: { key: '2026-W47', status: 'REVIEW', backfilled: false, editable: false }, objectives: [], owner: { id: '3' }, can: { edit: true } }
    const html = await renderView(render, state({ data, isPastWeek: false, weekKeyNow: '2026-W47', empty: emptyState(data, { now: NOW }) }), EXTRA)
    assert.ok(html.includes('data-test="okr-empty-create"'))
    assert.ok(html.includes(esc(t('okr.backfill.create_this'))))
  })

  test('看别人无数据: 「<姓名> 这一周没有提交 OKR」, 没有任何创建按钮', async () => {
    const data = { cycle: null, week: '2026-W44', backfill: true, objectives: [], owner: { id: '5', name: '林晓' }, can: { create: false, proxy: false } }
    const html = await renderView(render, state({ data, viewingOther: true, canAct: false, ownerId: '5', ownerName: '林晓', empty: emptyState(data, { viewingOther: true, ownerName: '林晓', now: NOW }) }), EXTRA)
    assert.ok(html.includes(esc(t('okr.backfill.other_none', { p0: '林晓' }))), html)
    assert.ok(!/data-test="okr-empty-(backfill|create|proxy)"/.test(html))
    assert.ok(!html.includes(esc(t('okr.other_not_submitted'))))
  })

  test('看别人 + 代管权: 渲染「代 <姓名> 补录」', async () => {
    const data = { cycle: null, week: '2026-W44', backfill: true, objectives: [], owner: { id: '5', name: '林晓' }, can: { create: true, proxy: true } }
    const html = await renderView(render, state({ data, viewingOther: true, proxyMode: true, proxyTarget: '5', ownerId: '5', ownerName: '林晓', empty: emptyState(data, { viewingOther: true, ownerName: '林晓', now: NOW }) }), EXTRA)
    assert.ok(html.includes('data-test="okr-empty-proxy"'))
    assert.ok(html.includes(esc(t('okr.backfill.proxy_backfill', { p0: '林晓' }))))
  })

  test('点了补录进编辑器: 顶部提示条「补录 26/第44周(原截止已过, 记为迟交)」, 空态收起', async () => {
    const st = state({ editing: true, editorOpen: true })
    st.empty = emptyState(st.data, { now: NOW })
    const html = await renderView(render, st, EXTRA)
    assert.ok(html.includes('data-test="okr-backfill-bar"'))
    assert.ok(html.includes(esc(t('okr.backfill.banner', { p0: '26/W44' }))))
    assert.ok(html.includes('editor-stub'))
    assert.ok(!html.includes('data-test="okr-empty"'))
  })

  test('本周编辑不显示补录提示条', async () => {
    const data = { cycle: { key: '2026-W47', status: 'PLANNING', backfilled: false, deadlinePassed: false }, objectives: [], owner: { id: '3' }, can: { edit: true } }
    const html = await renderView(render, state({ data, editing: true, editorOpen: true, isPastWeek: false, weekKeyNow: '2026-W47' }), EXTRA)
    assert.ok(!html.includes('data-test="okr-backfill-bar"'))
  })
})

describe('OkrWeekBar: 一行居中成组, 边界箭头置灰, 状态标签贴着周次', () => {
  const render = compileView('components/okr/OkrWeekBar.vue')
  const base = (over = {}) => ({ year: 2026, weekNo: 1, start: '', end: '', tagText: 'Pending', tagType: 'danger', extraTag: '', active: 'mine', showTeam: true, hideLinks: false, weekKey: '2026-W01', prevDisabled: true, nextDisabled: false, range: '', weekQuery: {}, ...over })
  const btn = (html, which) => html.match(new RegExp(`<button[^>]*data-test="okr-week-${which}"[^>]*>`))[0]

  test('第 1 周: ‹ 禁用, › 可点', async () => {
    const html = await renderView(render, base())
    assert.match(btn(html, 'prev'), /disabled/)
    assert.doesNotMatch(btn(html, 'next'), /disabled/)
  })

  test('窗口最后一周: › 禁用', async () => {
    const html = await renderView(render, base({ weekNo: 48, weekKey: '2026-W48', prevDisabled: false, nextDisabled: true }))
    assert.doesNotMatch(btn(html, 'prev'), /disabled/)
    assert.match(btn(html, 'next'), /disabled/)
  })

  test('状态标签在周次组里(两个箭头之间), 不在箭头下面单独一行', async () => {
    const html = await renderView(render, base({ extraTag: 'Backfill' }))
    const group = html.split('data-test="okr-weekbar-group"')[1].split('<nav')[0]
    const iPrev = group.indexOf('okr-week-prev'); const iTag = group.indexOf('Pending'); const iNext = group.indexOf('okr-week-next')
    assert.ok(iPrev < iTag && iTag < iNext, group)
    assert.ok(group.includes('Backfill'))
  })
})
