// OKR 3.0 前端: KR 完成 / 未完成开关、自评入口、主管评分入口、免提交白名单。
// 纯函数直接测; 页面 / 卡片用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  pct, OBJ_TAG, krValueText, krHandled, krHandling, progressedKrIds, needsProgressPrompt, progressMax, parseProgress,
  applyKrComplete, scoresComplete, managerScoreChanges, exemptCandidates, idsChanged
} from '../../src/views/okr/okrUtils.js'
import * as Vue from 'vue'

const esc = s => String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')

const kr = (over = {}) => ({ id: '11', seq: 1, title: '上线 3 个接口', metricType: 'NUMBER', unit: '个', targetValue: 3, currentValue: 0, weight: 50, status: 'ON_TRACK', progress: 0, ...over })
const obj = (over = {}) => ({
  id: '1', seq: 1, title: 'O-上线', weight: 100, status: 'ON_TRACK', progress: 0.5, submittedAt: '2026-11-16T02:00:00Z', updates: [],
  keyResults: [kr(), kr({ id: '12', seq: 2, title: '文档', metricType: 'BINARY', targetValue: 1, status: 'DONE', progress: 1 })],
  ...over
})

describe('KR 处理情况(自评前置, 与后端 okrRules.krHandled 同口径)', () => {
  test('DONE / MISSED 算处理完; 是/否型没标不算; 数值型要记过进度', () => {
    assert.equal(krHandled({ status: 'DONE', metricType: 'BINARY' }), true)
    assert.equal(krHandled({ status: 'MISSED', metricType: 'NUMBER' }), true)
    assert.equal(krHandled({ status: null, metricType: 'BINARY' }), false)
    assert.equal(krHandled({ status: 'ON_TRACK', metricType: 'NUMBER' }, false), false)
    assert.equal(krHandled({ status: 'ON_TRACK', metricType: 'NUMBER' }, true), true)
    assert.equal(krHandled({ status: 'ON_TRACK', metricType: 'BINARY' }, true), false)
  })

  test('只认真的改了数值的进展; 纯文字进展不算', () => {
    const ids = progressedKrIds([{ updates: [
      { krId: '11', valueBefore: 0, valueAfter: 2 },
      { krId: '13', valueBefore: 1, valueAfter: 1 },
      { krId: null, valueBefore: null, valueAfter: null }
    ] }])
    assert.deepEqual([...ids], ['11'])
  })

  test('krHandling: 只看已提交、未放弃的 O, 缺项按 O/KR 顺序点名', () => {
    const objs = [
      obj({ id: '2', seq: 2, keyResults: [kr({ id: '21', seq: 1, title: 'B1' })] }),
      obj(),
      obj({ id: '3', seq: 3, status: 'DROPPED', keyResults: [kr({ id: '31' })] }),
      obj({ id: '4', seq: 4, submittedAt: null, keyResults: [kr({ id: '41' })] })
    ]
    const h = krHandling(objs)
    assert.equal(h.total, 3)
    assert.equal(h.handled, 1)
    assert.deepEqual(h.missing.map(m => m.label), ['O1-KR1', 'O2-KR1'])
    assert.equal(h.missing[0].title, '上线 3 个接口')
    // 记过进度后就算处理完
    objs[1].updates = [{ krId: '11', valueBefore: 0, valueAfter: 1 }]
    assert.deepEqual(krHandling(objs).missing.map(m => m.label), ['O2-KR1'])
  })
})

describe('标「未完成」前的进度输入', () => {
  test('数值型进度为空 / 0 才问; 是/否型、已有进度的不问', () => {
    assert.equal(needsProgressPrompt(kr()), true)
    assert.equal(needsProgressPrompt(kr({ currentValue: null })), true)
    assert.equal(needsProgressPrompt(kr({ currentValue: 2 })), false)
    assert.equal(needsProgressPrompt(kr({ metricType: 'BINARY' })), false)
  })

  test('上限: 百分比 100, 数值型 = 目标值; 越界 / 非数字不收', () => {
    assert.equal(progressMax(kr({ metricType: 'PERCENT', targetValue: 100 })), 100)
    assert.equal(progressMax(kr()), 3)
    assert.equal(parseProgress('2', kr()), 2)
    assert.equal(parseProgress('2.5', kr()), 2.5)
    assert.equal(parseProgress('4', kr()), null)
    assert.equal(parseProgress('-1', kr()), null)
    assert.equal(parseProgress('abc', kr()), null)
    assert.equal(parseProgress('', kr()), null)
    assert.equal(parseProgress('80', kr({ metricType: 'PERCENT', targetValue: 100 })), 80)
  })
})

describe('完成开关返回值就地合并(不整页刷新)', () => {
  test('换掉那条 KR, 更新 O 完成度 / 状态和整体完成度', () => {
    const data = { completion: 0.75, objectives: [obj({ progress: 0.75 })] }
    const o = applyKrComplete(data, {
      kr: { id: '11', status: 'MISSED', currentValue: 1, progress: 0.3333 },
      objective: { id: '1', status: 'ON_TRACK', progress: 0.6667 },
      completion: 0.6667
    })
    assert.equal(o.id, '1')
    assert.equal(data.objectives[0].keyResults[0].status, 'MISSED')
    assert.equal(data.objectives[0].keyResults[0].title, '上线 3 个接口', '没返回的字段保留')
    assert.equal(data.objectives[0].progress, 0.6667)
    assert.equal(data.completion, 0.6667)
  })

  test('找不到 KR 不动数据', () => {
    const data = { completion: 0.5, objectives: [obj()] }
    assert.equal(applyKrComplete(data, { kr: { id: '999' }, completion: 0 }), null)
    assert.equal(data.completion, 0.5)
  })
})

describe('卡片 OkrObjectiveCard: 每条 KR 的「完成 / 未完成」', () => {
  const render = compileView('components/okr/OkrObjectiveCard.vue')
  const state = (over = {}) => {
    const st = {
      obj: obj(), canEdit: false, canMiss: false, canManagerScore: false, canComplete: true, closed: false, krBusy: '', busy: false,
      open: false, form: { krId: '' }, mScore: null, mComment: '', hasPanel: false, toggleText: '', pickedKr: null,
      OBJ_TAG, pct, krValueText, round: n => n, shDate: s => s, toggle() {}, send() {}, complete() {},
      ...over
    }
    st.showActs = (st.canComplete || st.closed) && !!st.obj.submittedAt && st.obj.status !== 'DROPPED'
    st.actsDisabled = st.closed || !st.canComplete || !!st.krBusy
    return st
  }
  const btns = html => [...html.matchAll(/<button[^>]*data-test="okr-kr-(done|missed)"[^>]*>/g)].map(m => m[0])

  test('每条 KR 都有两个按钮; 当前状态高亮(DONE 亮完成, MISSED 亮未完成)', async () => {
    const o = obj({ keyResults: [kr({ status: 'MISSED' }), kr({ id: '12', seq: 2, status: 'DONE', metricType: 'BINARY' })] })
    const html = await renderView(render, state({ obj: o }), { 'el-tooltip': true, 'el-input-number': true, 'el-checkbox': true })
    const b = btns(html)
    assert.equal(b.length, 4)
    assert.match(b[0], /okr-kr-btn ok"/)
    assert.match(b[1], /okr-kr-btn no on"/)
    assert.match(b[1], /aria-pressed="true"/)
    assert.match(b[2], /okr-kr-btn ok on"/)
    assert.ok(html.includes(t('okr.v3.kr_done')) && html.includes(t('okr.v3.kr_missed')))
    assert.ok(!b.some(x => x.includes('disabled')))
  })

  test('归档后: 按钮还在但置灰, 带「本周已归档，不能修改」提示', async () => {
    const html = await renderView(render, state({ canComplete: false, closed: true }), { 'el-tooltip': true })
    const b = btns(html)
    assert.equal(b.length, 4)
    assert.ok(b.every(x => /disabled/.test(x)))
    assert.ok(html.includes(esc(t('okr.v3.closed_tip'))))
  })

  test('只读看别人 / 没提交 / 已放弃: 不出开关', async () => {
    assert.equal(btns(await renderView(render, state({ canComplete: false }), { 'el-tooltip': true })).length, 0)
    assert.equal(btns(await renderView(render, state({ obj: obj({ submittedAt: null }) }), { 'el-tooltip': true })).length, 0)
    assert.equal(btns(await renderView(render, state({ obj: obj({ status: 'DROPPED' }) }), { 'el-tooltip': true })).length, 0)
  })

  test('手机: 两个按钮各 ≥44px、不换行(样式约束)', () => {
    const css = src('components/okr/OkrObjectiveCard.vue')
    assert.match(css, /\.okr-kr-btn \{[^}]*min-height: 44px[^}]*white-space: nowrap/)
    assert.match(css, /\.okr-kr-acts \{[^}]*display: flex/)
  })

  test('MyOkr: 点开关调 completeKr 并就地合并, 未完成且进度为 0 先问进度', () => {
    const s = src('views/okr/MyOkr.vue')
    assert.match(s, /fde\.okr\.completeKr\(kr\.id, \{ done \}, t\)/)
    assert.match(s, /applyKrComplete\(data\.value, r\)/)
    assert.match(s, /!done && needsProgressPrompt\(kr\)[\s\S]{0,600}ElMessageBox\.prompt/)
    assert.match(s, /:closed="canAct && isClosed"/)
    // 就地更新: completeKr 里不整页 load()
    const fn = s.split('async function completeKr')[1].split('\n}\n')[0]
    assert.ok(!fn.includes('load()'), fn)
  })
})

// MyOkr 页: 页头「提交自评」/「主管评分」+ 自评面板
const myRender = compileView('views/okr/MyOkr.vue')
// 抽屉 / 对话框: 默认插槽 + footer 都画出来(看提交按钮态)
const withFooter = { setup: (_, { slots }) => () => Vue.h('div', [slots.default?.(), slots.footer?.()]) }
const MY_EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrObjectiveCard: true, OkrPlanEditor: true, OkrReportDraftDialog: true, OkrManagerScorePanel: true, 'el-checkbox': true, 'el-input-number': true, 'el-drawer': withFooter }
function myState(over = {}) {
  const objectives = over.objectives || [obj(), obj({ id: '2', seq: 2, title: 'O-文档', keyResults: [kr({ id: '21', seq: 1, title: '写完手册', status: 'MISSED' })] })]
  const closed = over.closed || false
  const st = {
    loading: false, isMobile: false, busy: '', editing: false, draftInit: [], editorRef: null, reportOpen: false, reportSource: 'text',
    miss: { visible: false, reason: '' }, copy: { visible: false, from: '' }, imp: { visible: false, text: '' }, tpl: { visible: false, md: '' }, copyWeeks: [], copyWeekLabel: w => w, blockerPeople: () => [], blkUsers: [], pickedId: '3', people: [], meId: '3', meName: 'Me', ownerId: '', ownerName: '',
    viewingOther: false, proxyMode: false, proxyTarget: '', canAct: true, canEditPlan: false, canScoreManager: false,
    submittedOnce: true, canTeam: true, tagText: '', tagType: 'info', weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 },
    nav: { prev: true, next: true }, weekDates: {}, backfillTag: '', isPastWeek: false, deadlinePassed: false, weekLabel: '', editorOpen: false, empty: null,
    pct, scoresComplete, shift() {}, pickPerson() {}, openDraft() {}, startEdit() {}, startBackfill() {}, savePlan() {}, addUpdate() {}, managerScore() {},
    openMiss() {}, fillFromReport() {}, openSelf() {}, submitSelf() {}, completeKr() {}, openMgr() {}, onMgrClosed() {},
    isClosed: closed, krBusy: '', mgr: { visible: false },
    data: {
      owner: { id: '3', name: 'Me' }, completion: 0.6, selfScore: over.selfScore ?? null,
      cycle: { status: closed ? 'CLOSED' : 'REVIEW', key: '2026-W47' }, can: { edit: false, progress: !closed, selfScore: !closed, proxy: false, managerScore: false },
      objectives
    },
    ...over
  }
  st.scorable = objectives.filter(o => o.submittedAt && o.status !== 'DROPPED')
  st.handling = krHandling(objectives)
  st.selfAllDone = st.scorable.every(o => o.selfScore != null)
  st.showSelfBtn = st.canAct && st.submittedOnce && st.scorable.length > 0 && (st.data.can.selfScore || closed)
  const score = st.data.selfScore != null ? Math.round(st.data.selfScore) : null
  st.selfBtnText = closed ? (st.selfAllDone && score != null ? t('okr.v3.self_done_closed', { p0: score }) : t('okr.v3.closed_btn'))
    : (st.selfAllDone && score != null ? t('okr.v3.self_done_btn', { p0: score }) : t('okr.v3.self_submit'))
  st.self = over.self || { visible: true, rows: st.scorable.map(o => ({ id: o.id, seq: o.seq, title: o.title, progress: o.progress, original: o.selfScore ?? null, score: o.selfScore ?? null, comment: '' })) }
  return st
}
const btnTag = (html, dt) => (html.match(new RegExp(`<[^>]*data-test="${dt}"[^>]*>`)) || [''])[0]

describe('自评入口: 页头主按钮 + 面板', () => {
  test('计划已提交、未归档: 页头有「提交自评」; 还有 KR 没标时旁边提示条数', async () => {
    const html = await renderView(myRender, myState(), MY_EXTRA)
    assert.ok(html.includes('data-test="okr-self-open"'))
    assert.ok(html.includes(esc(t('okr.v3.self_submit'))))
    assert.ok(html.includes('data-test="okr-self-pending"'))
    assert.ok(html.includes(esc(t('okr.v3.kr_pending', { p0: 1 }))))
    // 页头在 O 列表之前
    assert.ok(html.indexOf('data-test="okr-actions"') < html.indexOf('okr-list'))
  })

  test('面板: 「KR 处理情况 2/3」, 列出缺哪条(O1-KR1 + 标题), 提交按钮置灰', async () => {
    const html = await renderView(myRender, myState(), MY_EXTRA)
    assert.ok(html.includes(esc(t('okr.v3.kr_handling', { p0: 2, p1: 3 }))), html)
    const missing = html.split('data-test="okr-self-missing"')[1].split('</ul>')[0]
    assert.ok(missing.includes('O1-KR1') && missing.includes('上线 3 个接口'), missing)
    assert.ok(!missing.includes('O2-KR1'))
    assert.match(btnTag(html, 'okr-self-submit'), /disabled/)
    // 每个 O 一行分数 + 备注
    assert.ok(html.includes('data-test="okr-self-row-1"') && html.includes('data-test="okr-self-row-2"'))
  })

  test('KR 全部处理完、分数填齐: 提交可点, 不出缺项提示', async () => {
    const objectives = [obj({ keyResults: [kr({ status: 'DONE' })] })]
    const st = myState({ objectives })
    st.self.rows[0].score = 80
    const html = await renderView(myRender, st, MY_EXTRA)
    assert.ok(html.includes(esc(t('okr.v3.kr_handling', { p0: 1, p1: 1 }))))
    assert.ok(!html.includes('data-test="okr-self-missing"'))
    assert.ok(!html.includes('data-test="okr-self-pending"'))
    assert.doesNotMatch(btnTag(html, 'okr-self-submit'), /disabled/)
  })

  test('交过自评: 按钮变「已自评 89 分 · 可修改」; 归档后置灰「已自评 89 分」', async () => {
    const objectives = [obj({ selfScore: 89, keyResults: [kr({ status: 'DONE' })] })]
    let html = await renderView(myRender, myState({ objectives, selfScore: 89 }), MY_EXTRA)
    assert.ok(html.includes(esc(t('okr.v3.self_done_btn', { p0: 89 }))))
    assert.doesNotMatch(btnTag(html, 'okr-self-open'), /disabled/)
    html = await renderView(myRender, myState({ objectives, selfScore: 89, closed: true, self: { visible: false, rows: [] } }), MY_EXTRA)
    assert.ok(html.includes(esc(t('okr.v3.self_done_closed', { p0: 89 }))))
    assert.match(btnTag(html, 'okr-self-open'), /disabled/)
  })

  test('没提交计划 / 看别人(无代管): 没有自评按钮', async () => {
    let html = await renderView(myRender, myState({ submittedOnce: false }), MY_EXTRA)
    assert.ok(!html.includes('data-test="okr-self-open"'))
    html = await renderView(myRender, myState({ canAct: false, viewingOther: true, ownerId: '5' }), MY_EXTRA)
    assert.ok(!html.includes('data-test="okr-self-open"'))
  })

  test('不按时间限制: 自评入口不看 REVIEW / 星期几, 只看 can.selfScore 与是否归档', () => {
    const s = src('views/okr/MyOkr.vue')
    const def = s.split('const showSelfBtn = computed(')[1].split('\n')[0]
    assert.ok(!/REVIEW|getDay|deadline/.test(def), def)
    assert.match(s, /fde\.okr\.selfScore\(\{ objectiveId: r\.id, score: r\.score, comment: r\.comment\.trim\(\) \}, t\)/)
    assert.match(s, /e\.code === 8112/)
  })

  test('scoresComplete: 每个 O 都要 0–100 整数', () => {
    assert.equal(scoresComplete([]), false)
    assert.equal(scoresComplete([{ score: 80 }, { score: 0 }]), true)
    assert.equal(scoresComplete([{ score: 80 }, { score: null }]), false)
    assert.equal(scoresComplete([{ score: 101 }]), false)
    assert.equal(scoresComplete([{ score: 80.5 }]), false)
  })
})

describe('主管评分入口(ADMIN / MANAGER)', () => {
  test('无评分权限: 页头没有「主管评分」, 面板组件都不挂', async () => {
    const html = await renderView(myRender, myState({ canScoreManager: false }), MY_EXTRA)
    assert.ok(!html.includes('data-test="okr-mgr-open"'))
    assert.ok(!html.includes(esc(t('okr.v3.mgr_btn'))))
    const s = src('views/okr/MyOkr.vue')
    assert.match(s, /<OkrManagerScorePanel\s+v-if="canScoreManager && data\?\.cycle"/)
    assert.match(s, /canScoreManager = mayScoreManager\(me, can\('okr\.score\.manager'\)\)/)
  })

  test('ADMIN: 与「提交自评」同一行, 次要按钮(不是 primary); 归档后置灰', async () => {
    let html = await renderView(myRender, myState({ canScoreManager: true }), MY_EXTRA)
    const row = html.split('data-test="okr-actions"')[1].split('okr-summary')[0]
    assert.ok(row.includes('data-test="okr-self-open"') && row.includes('data-test="okr-mgr-open"'))
    assert.doesNotMatch(btnTag(html, 'okr-mgr-open'), /type="primary"/)
    assert.match(btnTag(html, 'okr-self-open'), /type="primary"/)
    html = await renderView(myRender, myState({ canScoreManager: true, closed: true, self: { visible: false, rows: [] } }), MY_EXTRA)
    assert.match(btnTag(html, 'okr-mgr-open'), /disabled/)
  })

  test('团队页: 没有「归档本周 / 重开本周 / 周期管理」入口', () => {
    const s = src('views/okr/TeamOkr.vue')
    for (const bad of ['reopen', 'okr.close_week', 'okr.manage_cycle', 'fde.okr.close(']) assert.ok(!s.includes(bad), bad)
    assert.match(s, /v-if="canScore && data\.cycle\?\.status" class="okr-admin"/)
    for (const f of ['views/okr/MyOkr.vue', 'components/okr/OkrManagerScorePanel.vue']) {
      assert.ok(!/reopen|okr\.close\(/.test(src(f)), f)
    }
  })
})

describe('主管评分面板 OkrManagerScorePanel', () => {
  const render = compileView('components/okr/OkrManagerScorePanel.vue')
  const groups = [
    { user: { id: '38', name: '林晓' }, rows: [
      { id: '1', seq: 1, title: 'O-上线', selfScore: 80, original: null, score: 85, comment: '', locked: null },
      { id: '2', seq: 2, title: 'O-文档', selfScore: null, original: null, score: null, comment: '', locked: 'noself' }
    ] },
    { user: { id: '188', name: 'Boss' }, rows: [{ id: '9', seq: 1, title: 'O-自己', selfScore: 70, original: null, score: null, comment: '', locked: 'own' }] }
  ]
  const state = (over = {}) => {
    const st = { modelValue: true, week: '2026-W47', closed: false, canClose: true, mobile: false, loading: false, busy: '', error: '', groups, load() {}, saveOnly() {}, saveAndClose() {}, ...over }
    st.allRows = st.groups.flatMap(g => g.rows)
    st.scoredCount = st.allRows.filter(r => r.original != null).length
    return st
  }
  const EX = { 'el-drawer': withFooter, 'el-input-number': true }

  test('按人 / 按 O 列出自评分与主管分输入; 底部「保存评分」「保存并完成本周」', async () => {
    const html = await renderView(render, state(), EX)
    assert.ok(html.includes('林晓') && html.includes('O-上线') && html.includes('O-文档'))
    assert.ok(html.includes('>80<'), '自评分')
    assert.ok(html.includes(esc(t('okr.v3.mgr_no_self'))))
    assert.ok(html.includes(esc(t('okr.v3.mgr_own'))))
    assert.ok(html.includes(esc(t('okr.v3.mgr_save'))) && html.includes(esc(t('okr.v3.mgr_save_close'))))
    assert.ok(html.includes(esc(t('okr.v3.mgr_progress', { p0: 0, p1: 3 }))))
  })

  test('close-by-score 400: message 原样展示', async () => {
    const msg = '还有 1 个 O 没有主管评分, 评完才能完成本周：林晓 O2「O-文档」'
    const html = await renderView(render, state({ error: msg }), EX)
    assert.ok(html.split('data-test="okr-mgr-error"')[1].includes(msg))
  })

  test('已归档: 两个按钮都置灰', async () => {
    const html = await renderView(render, state({ closed: true }), EX)
    assert.match(btnTag(html, 'okr-mgr-save'), /disabled/)
    assert.match(btnTag(html, 'okr-mgr-close'), /disabled/)
  })

  test('保存并完成本周: 先逐个 /manager-score, 全部成功才调 close-by-score; 失败把 message 放进面板', () => {
    const s = src('components/okr/OkrManagerScorePanel.vue')
    const fn = s.split('async function saveAndClose(')[1]
    assert.ok(fn.indexOf('saveScores()') < fn.indexOf('fde.okr.closeByScore(props.week'))
    assert.match(fn, /if \(failed\.length\) \{[\s\S]*?return\s*\}/)
    assert.match(fn, /catch \(e\) \{[\s\S]*?error\.value = e\.message/)
    assert.match(s, /fde\.okr\.managerScore\(\{ objectiveId: r\.id, score: r\.score, comment: r\.comment\.trim\(\) \}\)/)
  })

  test('managerScoreChanges: 只发有改动的; 没自评 / 自己的 O 跳过', () => {
    const rows = [
      { id: 'a', score: 80, original: 80, comment: '' },
      { id: 'b', score: 70, original: 80, comment: '' },
      { id: 'c', score: 80, original: 80, comment: '补一句' },
      { id: 'd', score: null, original: null, comment: '' },
      { id: 'e', score: 90, original: null, comment: '', locked: 'noself' },
      { id: 'f', score: 90, original: null, comment: '', locked: 'own' }
    ]
    assert.deepEqual(managerScoreChanges(rows).map(r => r.id), ['b', 'c'])
  })
})

describe('设置 · OKR 免提交名单(仅 ADMIN)', () => {
  const render = compileView('components/okr/OkrExemptSettings.vue')
  const users = [{ id: '38', name: '林晓', username: 'okr_a', role: 'FDE_ENGINEER' }, { id: '39', name: '周舟', username: 'okr_b', role: 'FDE_ENGINEER' }]
  const labelOf = u => (u.name ? `${u.name} (@${u.username})` : `#${u.id}`)
  const state = (over = {}) => ({
    loading: false, saving: false, users, candidates: users, byId: new Map(users.map(u => [u.id, u])), picked: ['39'], saved: [], dirty: true,
    labelOf, remove() {}, save() {}, ...over
  })
  const EX = { 'el-tag': true }

  test('顶部说明 + 已选标签 + 保存', async () => {
    const html = await renderView(render, state(), EX)
    assert.ok(html.includes(esc(t('okr.v3.exempt_desc'))))
    const tags = html.split('data-test="okr-exempt-tags"')[1].split('data-test="okr-exempt-save"')[0]
    assert.ok(tags.includes('周舟 (@okr_b)') && !tags.includes('林晓'), tags)
    assert.doesNotMatch(btnTag(html, 'okr-exempt-save'), /disabled/)
    // 候选从用户列表里选(不是手打用户名的输入框)
    assert.ok(html.includes('data-test="okr-exempt-select"'))
    assert.ok(html.includes('@okr_a'))
  })

  test('名单为空: 提示所有工程师都要交; 没改动时保存置灰', async () => {
    const html = await renderView(render, state({ picked: [], dirty: false }), EX)
    assert.ok(html.includes(esc(t('okr.v3.exempt_empty'))))
    assert.match(btnTag(html, 'okr-exempt-save'), /disabled/)
  })

  test('源码约束: 取平台用户列表, 保存走 PUT /settings/exempt, 失败用后端 message', () => {
    const s = src('components/okr/OkrExemptSettings.vue')
    assert.match(s, /fde\.users\.list\(/)
    assert.match(s, /fde\.okr\.saveExempt\(picked\.value\)/)
    assert.match(s, /catch \(e\) \{\s*ElMessage\.error\(e\.message\)/)
    const api = src('api/index.js')
    assert.match(api, /saveExempt: \(userIds\) => request\('\/api\/okr\/settings\/exempt', \{ method: 'PUT', body: JSON\.stringify\(\{ userIds \}\) \}\)/)
    const page = src('views/admin/SystemSettings.vue')
    assert.match(page, /<el-tab-pane v-if="isAdmin"[^>]*name="okr"/)
    assert.match(page, /const isAdmin = currentUser\(\)\.role === 'ADMIN'/)
  })

  test('exemptCandidates: 已选的人排在前面并去重; idsChanged 顺序无关', () => {
    const c = exemptCandidates(users, [{ id: 39, name: '周舟', username: 'okr_b' }, { id: '99', name: '已停用', username: 'gone' }])
    assert.deepEqual(c.map(u => u.id), ['39', '99', '38'])
    assert.equal(idsChanged(['1', '2'], ['2', '1']), false)
    assert.equal(idsChanged(['1'], ['1', '2']), true)
    assert.equal(idsChanged([], []), false)
  })
})
