// 0.6.7 OKR 进展录不进去(老板报的 bug)
// 「我的角色是 yihufde 的系统管理员，我无法录入我的 OKR 的进展？只能看进展，和完成 OKR。」
// 根因一: 进展表单绑在 can.edit(计划可编辑)上, 复盘周 can.edit=false → 进展框消失; 改绑后端独立给的 can.progress。
// 根因二: 本周一条 O 都没有时页面上没有任何提示; 改成空态卡「本周(2026-W48)还没写 OKR」+「写本周 OKR」。
// 页面用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { emptyState, pct, OBJ_TAG, krValueText } from '../../src/views/okr/okrUtils.js'

const NOW = new Date('2026-11-25T04:00:00Z') // 2026-W48 周三(上海)
const WIN = { from: '2026-W01', to: '2026-W49' }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)
const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')

const kr = { id: '11', seq: 1, title: 'KR-周报覆盖率', metricType: 'NUMBER', targetValue: 10, currentValue: 3, weight: 100, status: 'ON_TRACK' }
const objOf = (over = {}) => ({
  id: '1', seq: 1, title: 'O-复盘周补进展', status: 'ON_TRACK', progress: 0.3, weight: 100, submittedAt: '2026-11-16T02:00:00Z',
  keyResults: [kr], updates: [], misses: [], updatedKey: '0::', ...over
})

// ---------------------------------------------------------------- MyOkr 页面: 把 can.progress 传给 O 卡

const myOkr = compileView('views/okr/MyOkr.vue')
/** O 卡替身: 把收到的两个开关写在属性上, 看页面到底传了什么 */
const CardProbe = {
  props: ['obj', 'canEdit', 'canProgress'],
  setup: p => () => Vue.h('div', { class: 'card-probe', 'data-can-edit': String(!!p.canEdit), 'data-can-progress': String(!!p.canProgress) }, p.obj.title)
}
const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrObjectiveCard: CardProbe, OkrPlanEditor: true, OkrReportDraftDialog: true, 'el-checkbox': true, 'el-input-number': true }
const pageState = (over = {}) => ({
  loading: false, isMobile: false, busy: '', editing: false, draftInit: [], editorRef: null, reportOpen: false, reportSource: 'text',
  self: { visible: false, rows: [] }, handling: { total: 0, handled: 0, missing: [] }, scoresComplete: () => false, mgr: { visible: false },
  miss: { visible: false, reason: '' }, copy: { visible: false, from: '' }, imp: { visible: false, text: '' }, tpl: { visible: false, md: '' }, copyWeeks: [], copyWeekLabel: w => w, selfObj: null, scorable: [], selfDone: 0,
  blockerPeople: () => [], blkUsers: [], krBusy: '', isClosed: false, canCloseWeek: false,
  pickedId: '3', people: [], meId: '3', meName: 'Me', ownerId: '', ownerName: '',
  viewingOther: false, proxyMode: false, canAct: true, canEditPlan: false, canScoreManager: false, canTeam: true,
  showSelfBtn: false, selfAllDone: false, selfBtnText: '',
  submittedOnce: true, tagText: '', tagType: 'info', weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 },
  nav: { prev: true, next: true }, weekDates: {}, backfillTag: '', isPastWeek: true, deadlinePassed: true, weekLabel: '26/W47', editorOpen: false,
  pct, shift() {}, pickPerson() {}, openDraft() {}, startEdit() {}, startBackfill() {}, savePlan() {}, addUpdate() {}, managerScore() {}, openMiss() {},
  completeKr() {}, clickMilestone() {}, saveBlocker() {}, fillFromReport() {}, openSelf() {},
  empty: null,
  ...over
})
const weekData = (status, can, objectives = [objOf()]) => ({
  cycle: { key: '2026-W47', status, backfilled: true }, window: WIN, owner: { id: '3', name: 'Me' }, objectives, can: { proxy: false, ...can }
})

// ---------------------------------------------------------------- O 卡本身: 进展表单只看 canProgress

const card = compileView('components/okr/OkrObjectiveCard.vue')
const cardState = (over = {}) => ({
  obj: objOf(), canEdit: false, canProgress: false, canMiss: false, canManagerScore: false, canComplete: false, closed: false, krBusy: '', busy: false,
  canEditBlocker: false, people: [], compact: false, streak: null,
  open: true, form: { krId: '11', content: '', value: 3, done: false }, mScore: null, mComment: '', hasPanel: true, toggleText: '', pickedKr: kr,
  showActs: false, actsDisabled: true, blkOpen: false, blkEditing: false, blk: {}, blkState: 'empty', blkBusy: false, msClickable: false, today: '2026-11-25',
  OBJ_TAG, pct, krValueText, round: n => n, shDate: s => s, toggle() {}, send() {}, complete() {}, pick() {}, startBlk() {}, saveBlk() {}, clickMilestone() {},
  ...over
})

describe('0.6.7 进展录入改看 can.progress', () => {
  test('3. 复盘周 can.progress=true & can.edit=false → 进展框可见、能提交', async () => {
    // 页面: 计划只读(can.edit=false), 但传给 O 卡的 canProgress=true
    const html = await renderView(myOkr, pageState({ data: weekData('REVIEW', { edit: false, progress: true }) }), EXTRA)
    assert.match(html, /data-can-edit="false" data-can-progress="true"/, html)

    // O 卡: canEdit=false 也照样出进展表单, 里面有选 KR / 写内容 / 提交按钮
    const c = await renderView(card, cardState({ canEdit: false, canProgress: true }), { 'el-tooltip': true, 'el-input-number': true })
    assert.ok(c.includes('data-test="okr-progress-form"'), c)
    has(c, t('okr.send'))
    assert.ok(c.includes(`placeholder="${esc(t('okr.progress_placeholder'))}"`) || c.includes(esc(t('okr.progress_placeholder'))), '有进展输入框')
    assert.ok(!c.includes('data-test="okr-progress-none"'))

    // 源码约束: 表单 / 面板 / 展开默认挑 KR 都只看 canProgress, 不再看 canEdit; 提交走 send → add-update
    const s = src('components/okr/OkrObjectiveCard.vue')
    assert.match(s, /<form v-if="canProgress" class="okr-add"[^>]*@submit\.prevent="send"/)
    assert.match(s, /hasPanel = computed\(\(\) => props\.canProgress \|\|/)
    assert.match(s, /if \(open\.value && props\.canProgress\)/)
    assert.doesNotMatch(s, /props\.canEdit\b|v-if="canEdit"|!canEdit\b/)
    assert.match(s, /emit\('add-update'/)
    assert.match(src('views/okr/MyOkr.vue'), /:can-progress="!!data\.can\.progress && !!o\.submittedAt && o\.status !== 'DROPPED'"/)
  })

  test('4. 已归档 can.progress=false → 进展框不可见, 显示只读「暂无进展」', async () => {
    const html = await renderView(myOkr, pageState({ isClosed: true, data: weekData('CLOSED', { edit: false, progress: false }) }), EXTRA)
    assert.match(html, /data-can-progress="false"/)
    assert.doesNotMatch(html, /data-can-progress="true"/)

    const c = await renderView(card, cardState({ canProgress: false, closed: true }), { 'el-tooltip': true, 'el-input-number': true })
    assert.ok(!c.includes('data-test="okr-progress-form"'))
    assert.ok(c.includes('data-test="okr-progress-none"'))
    has(c, t('okr.no_updates'))

    // 放弃的 O 即使 can.progress=true 也不给录(和后端 assertWritable 同口径)
    const dropped = await renderView(myOkr, pageState({ data: weekData('REVIEW', { edit: false, progress: true }, [objOf({ status: 'DROPPED' })]) }), EXTRA)
    assert.match(dropped, /data-can-progress="false"/)
  })
})

describe('0.6.7 本周没有计划: 空态卡', () => {
  const thisWeek = (can = {}, over = {}) => ({
    cycle: { key: '2026-W48', status: 'IN_PROGRESS', backfilled: false }, window: WIN, owner: { id: '3', name: 'Me' }, objectives: [], can: { edit: true, proxy: false, ...can }, ...over
  })

  test('5. 本周无计划 + 本人 + can.edit=true → 「本周(2026-W48)还没写 OKR」+「写本周 OKR」按钮', async () => {
    const d = thisWeek()
    const e = emptyState(d, { now: NOW })
    assert.deepEqual(e.text, ['okr.backfill.empty_this', { p0: '2026-W48' }])
    assert.equal(e.action, 'create')
    assert.deepEqual(e.label, ['okr.backfill.create_this'])

    const html = await renderView(myOkr, pageState({ data: d, empty: e, submittedOnce: false, isPastWeek: false, weekKeyNow: '2026-W48' }), EXTRA)
    assert.ok(html.includes('data-test="okr-empty"'))
    has(html, t('okr.backfill.empty_this', { p0: '2026-W48' }))
    assert.ok(html.includes('data-test="okr-empty-create"'))
    has(html, t('okr.backfill.create_this'))

    // can.edit=false(如已归档)就不给按钮
    const closed = emptyState(thisWeek({ edit: false }, { cycle: { key: '2026-W48', status: 'CLOSED', backfilled: false } }), { now: NOW })
    assert.equal(closed.action, null)

    // 源码约束: 空着的周不再自动弹编辑器(否则空态卡永远看不到), 点「写本周 OKR」才进
    const s = src('views/okr/MyOkr.vue')
    assert.match(s, /const noObjs = !\(d\.objectives \|\| \[\]\)\.length/)
    assert.match(s, /&& !noObjs\n/)
    assert.match(s, /:data-test="'okr-empty-' \+ empty\.action" @click="startBackfill"/)
  })

  test('6. 本周无计划 + 看别人 → 「<姓名> 本周还没提交 OKR」, 没有按钮', async () => {
    const d = thisWeek({ edit: false }, { owner: { id: '5', name: '林晓' } })
    const e = emptyState(d, { viewingOther: true, ownerName: '林晓', now: NOW })
    assert.deepEqual(e.text, ['okr.backfill.other_none_this', { p0: '林晓' }])
    assert.equal(e.action, null)
    // 拿不到名字时用「TA」
    assert.deepEqual(emptyState({ ...d, owner: { id: '5' } }, { viewingOther: true, now: NOW }).text, ['okr.backfill.other_none_this_anon'])

    const html = await renderView(myOkr, pageState({ data: d, empty: e, viewingOther: true, canAct: false, ownerId: '5', ownerName: '林晓', weekKeyNow: '2026-W48' }), EXTRA)
    has(html, t('okr.backfill.other_none_this', { p0: '林晓' }))
    assert.ok(!/data-test="okr-empty-(backfill|create|proxy)"/.test(html))
    lacks(html, t('okr.backfill.create_this'))
  })
})
