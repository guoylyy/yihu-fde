// OKR 3.0 前端: KR 完成 / 未完成开关、自评入口、主管评分入口、免提交白名单。
// 纯函数直接测; 页面 / 卡片用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  pct, OBJ_TAG, krValueText, krHandled, krHandling, progressedKrIds, needsProgressPrompt, progressMax, parseProgress,
  applyKrComplete
} from '../../src/views/okr/okrUtils.js'

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
