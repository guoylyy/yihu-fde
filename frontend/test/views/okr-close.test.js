// 0.6.3 前端: 「完成本周」不再被没交自评的人卡住。
// 纯函数直接测; 弹窗 / 面板 / 团队页用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取); 接口封装 stub fetch 看请求体
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  CLOSE_MISSING_CODE, shortWeek, nameList, parseCloseError, groupMissing, unscoredSelfCount,
  pendingSelfFromGroups, closedNoticeText, pendingSelfFromStatus, noticeDismissed, dismissNotice
} from '../../src/views/okr/okrClose.js'

const esc = s => String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const zh = JSON.parse(src('locales/zh-CN.json'))
const en = JSON.parse(src('locales/en.json'))
const zt = (key, p = {}) => {
  const v = key.split('.').reduce((a, k) => (a == null ? a : a[k]), zh)
  return v == null ? key : String(v).replace(/\{(\w+)\}/g, (_, k) => p[k])
}
const has = (html, text) => assert.ok(html.includes(esc(text)), text)
const btnTag = (html, id) => (html.match(new RegExp(`<[^>]*data-test="${id}"[^>]*>`)) || [''])[0]

const MISSING = [
  { objectiveId: '11', ownerId: '39', ownerName: '周舟', seq: 1, title: 'O-上线' },
  { objectiveId: '12', ownerId: '39', ownerName: '周舟', seq: 2, title: 'O-文档' },
  { objectiveId: '21', ownerId: '40', ownerName: '王五', seq: 1, title: 'O-压测' }
]
const PENDING = [{ userId: '38', name: '张三', objectiveCount: 2 }, { userId: '41', name: '李四', objectiveCount: 1 }]

describe('纯函数', () => {
  test('shortWeek: 2026-W47 → W47; W05 → W5; 不认识原样', () => {
    assert.equal(shortWeek('2026-W47'), 'W47')
    assert.equal(shortWeek('2026-W05'), 'W5')
    assert.equal(shortWeek('abc'), 'abc')
    assert.equal(shortWeek(null), '')
  })
  test('nameList: 顿号连接; 超过 5 个截断并给总数', () => {
    assert.deepEqual(nameList(PENDING), { text: '张三、李四', more: 0, total: 2 })
    const many = Array.from({ length: 7 }, (_, i) => ({ name: 'U' + i }))
    assert.deepEqual(nameList(many), { text: 'U0、U1、U2、U3、U4', more: 2, total: 7 })
    assert.deepEqual(nameList(null), { text: '', more: 0, total: 0 })
  })
  test('parseCloseError: 只认 8116 且带 missing; 业务数据在 err.data.data', () => {
    assert.equal(CLOSE_MISSING_CODE, 8116)
    const e = Object.assign(new Error('x'), { code: 8116, data: { code: 8116, message: 'x', data: { missing: MISSING, pendingSelfScore: PENDING, pendingSelfScoreTotal: 2 } } })
    assert.deepEqual(parseCloseError(e), { missing: MISSING, pendingSelfScore: PENDING })
    // 「这周还没人提交」也是 8116, 但没有 missing → null(照旧展示 message)
    assert.equal(parseCloseError(Object.assign(new Error('没人提交'), { code: 8116, data: { code: 8116 } })), null)
    assert.equal(parseCloseError(Object.assign(new Error('403'), { code: 8118 })), null)
    assert.equal(parseCloseError(null), null)
    // 后端没给 pendingSelfScore → 空数组
    assert.deepEqual(parseCloseError({ code: 8116, data: { data: { missing: MISSING } } }).pendingSelfScore, [])
  })
  test('groupMissing: 按人分组、保持顺序', () => {
    const g = groupMissing(MISSING)
    assert.deepEqual(g.map(x => [x.ownerName, x.items.map(i => i.seq)]), [['周舟', [1, 2]], ['王五', [1]]])
  })
  test('unscoredSelfCount: 已交自评且主管分空(含自己的 O); 没交自评的不算', () => {
    const groups = [
      { user: { id: '38' }, rows: [{ selfScore: 80, score: null }, { selfScore: null, score: null }, { selfScore: 70, score: 75 }] },
      { user: { id: '188' }, rows: [{ selfScore: 60, score: null, locked: 'own' }] }
    ]
    assert.equal(unscoredSelfCount(groups), 2)
    assert.equal(unscoredSelfCount([]), 0)
  })
  test('pendingSelfFromGroups: 面板里没交自评的按人汇总', () => {
    const groups = [
      { user: { id: '38', name: '张三' }, rows: [{ selfScore: null }, { selfScore: null }, { selfScore: 90 }] },
      { user: { id: '39', name: '周舟' }, rows: [{ selfScore: 80 }] }
    ]
    assert.deepEqual(pendingSelfFromGroups(groups), [{ userId: '38', name: '张三', objectiveCount: 2 }])
  })
  test('closedNoticeText: 「已归档 W47；张三、李四 未交自评，本周按未评归档」; 没人没交 →「已归档 W47」', () => {
    assert.equal(closedNoticeText(zt, '2026-W47', PENDING), '已归档 W47；张三、李四 未交自评，本周按未评归档')
    assert.equal(closedNoticeText(zt, '2026-W47', []), '已归档 W47')
    const many = Array.from({ length: 6 }, (_, i) => ({ name: 'U' + i }))
    assert.equal(closedNoticeText(zt, '2026-W47', many), '已归档 W47；U0、U1、U2、U3、U4 等 6 人 未交自评，本周按未评归档')
  })
  test('pendingSelfFromStatus: 有已提交的 O 且没全自评(与后端 pendingSelfScore 同口径)', () => {
    const status = { rows: [
      { user: { id: '38', name: '张三' }, selfScored: { done: 0, total: 2 } },
      { user: { id: '39', name: '周舟' }, selfScored: { done: 2, total: 2 } },
      { user: { id: '40', name: '王五' }, selfScored: { done: 0, total: 0 } },
      { user: { id: '41', name: '李四' }, selfScored: { done: 1, total: 3 }, exempt: true }
    ] }
    assert.deepEqual(pendingSelfFromStatus(status), [
      { userId: '38', name: '张三', objectiveCount: 2 },
      { userId: '41', name: '李四', objectiveCount: 2 }
    ])
    assert.deepEqual(pendingSelfFromStatus(null), [])
  })
  test('提示条关闭按周记住(localStorage), 坏数据不抛', () => {
    const m = {}
    const store = { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v } }
    assert.equal(noticeDismissed('2026-W47', store), false)
    dismissNotice('2026-W47', store)
    assert.equal(noticeDismissed('2026-W47', store), true)
    assert.equal(noticeDismissed('2026-W46', store), false)
    m.fde_okr_close_notice_dismissed = '{bad'
    assert.equal(noticeDismissed('2026-W47', store), false)
    assert.equal(noticeDismissed('2026-W47', undefined), false)
  })
})

describe('完成本周弹窗 OkrCloseWeekDialog', () => {
  const render = compileView('components/okr/OkrCloseWeekDialog.vue')
  const EX = { 'el-dialog': { setup: (_, { slots }) => () => [slots.default?.(), slots.footer?.()] } }
  const state = (over = {}) => {
    const st = { modelValue: true, week: '2026-W47', phase: 'confirm', missing: [], pendingSelf: [], unscoredCount: 0, busy: false, mobile: false, force: false, groupMissing, ...over }
    st.forceCount = st.phase === 'missing' ? st.missing.length : st.unscoredCount
    const n = nameList(st.pendingSelf)
    st.names = n.more ? t('okr.close.names_more', { p0: n.text, p1: n.total }) : n.text
    return st
  }

  test('8116: 只列「交了自评还差你打分」的人 + O; 底部灰字点名没交自评的人', async () => {
    const html = await renderView(render, state({ phase: 'missing', missing: MISSING, pendingSelf: PENDING }), EX)
    has(html, t('okr.close.missing_sub', { p0: 3 }))
    const list = html.split('data-test="okr-close-missing"')[1].split('data-test="okr-close-noself"')[0]
    for (const s of ['周舟', 'O-上线', 'O-文档', '王五', 'O-压测']) assert.ok(list.includes(s), s)
    assert.ok(!list.includes('张三'), '没交自评的人不进缺项列表')
    const noself = html.split('data-test="okr-close-noself"')[1].split('</p>')[0]
    assert.ok(noself.includes(esc(t('okr.close.no_self_line', { p0: 2 }))))
    assert.ok(noself.includes('张三、李四'))
    assert.equal(zh.okr.close.missing_title, '这些人交了自评，还差你打分')
    assert.equal(zt('okr.close.no_self_line', { p0: 2 }), '另有 2 人没交自评，不影响本周归档：')
  })
  test('8116: 「仍然归档」默认不勾、按钮置灰; 勾上才可点; 文案写清后果', async () => {
    const off = await renderView(render, state({ phase: 'missing', missing: MISSING }), EX)
    has(off, t('okr.close.force_label', { p0: 3 }))
    has(off, t('okr.close.force_warn'))
    assert.match(btnTag(off, 'okr-close-force-btn'), /disabled/)
    assert.ok(btnTag(off, 'okr-close-go-score'))
    const on = await renderView(render, state({ phase: 'missing', missing: MISSING, force: true }), EX)
    assert.doesNotMatch(btnTag(on, 'okr-close-force-btn'), /disabled/)
    assert.equal(zt('okr.close.force_label', { p0: 1 }), '仍然归档（跳过 1 个已自评但未打分的 O）')
    assert.equal(zh.okr.close.force_warn, '归档后这一周只读，未打分的 O 之后不能再评分')
  })
  test('二次确认: 有已自评未打分的 O 才出勾选; 没有就只有确认文案', async () => {
    const plain = await renderView(render, state(), EX)
    has(plain, t('okr.v3.mgr_confirm_close', { p0: '2026-W47' }))
    assert.ok(!plain.includes('data-test="okr-close-force"'))
    assert.ok(!plain.includes('data-test="okr-close-noself"'))
    const withN = await renderView(render, state({ unscoredCount: 1, pendingSelf: PENDING.slice(0, 1) }), EX)
    has(withN, t('okr.close.force_label', { p0: 1 }))
    assert.ok(withN.includes('data-test="okr-close-noself"'))
    assert.ok(btnTag(withN, 'okr-close-submit'))
  })
  test('勾选状态: 每次打开重置为不勾; submit 只把勾选值传出去', () => {
    const s = src('components/okr/OkrCloseWeekDialog.vue')
    assert.match(s, /const force = ref\(false\)/)
    assert.match(s, /@open="force = false"/)
    assert.match(s, /@click="\$emit\('submit', force\)"/)
    assert.match(s, /:disabled="!force"[^>]*@click="\$emit\('submit', true\)"/)
  })
  test('手机: 弹窗内容可滚动, 按钮与勾选 ≥44px', () => {
    const s = src('components/okr/OkrCloseWeekDialog.vue')
    assert.match(s, /\.ocw-body \{[^}]*max-height:[^}]*overflow-y: auto/)
    assert.match(s, /@media \(max-width: 640px\) \{[\s\S]*\.ocw-foot \.el-button \{ flex: 1 1 0; min-height: 44px; \}/)
    assert.match(s, /\.ocw-force :deep\(\.el-checkbox\) \{ min-height: 44px; \}/)
  })
})

describe('主管评分面板: 完成本周接线', () => {
  const s = src('components/okr/OkrManagerScorePanel.vue')
  test('「保存并完成本周」先开二次确认弹窗, 不再直接 ElMessageBox', () => {
    assert.match(s, /data-test="okr-mgr-close" @click="openClose"/)
    assert.ok(!s.includes('ElMessageBox'))
    assert.match(s, /<OkrCloseWeekDialog[\s\S]*?@submit="saveAndClose"/)
    assert.match(s, /function openClose\(\) \{[\s\S]*?unscored: unscoredSelfCount\(groups\.value\)/)
  })
  test('只有显式勾选才带 allowUnscoredSelfScored=true', () => {
    const fn = s.split('async function saveAndClose(')[1]
    assert.match(fn, /^allow = false\)/)
    assert.match(fn, /fde\.okr\.closeByScore\(props\.week, \{ allowUnscoredSelfScored: allow === true \}\)/)
  })
  test('8116 → 同一个弹窗换成缺项; 没交自评名单以后端为准; 成功 → 提示带未交自评名单', () => {
    const fn = s.split('async function saveAndClose(')[1]
    assert.match(fn, /const miss = parseCloseError\(e\)[\s\S]*?phase: 'missing', missing: miss\.missing, pendingSelf: miss\.pendingSelfScore\.length \? miss\.pendingSelfScore/)
    assert.match(fn, /closedNoticeText\(\$t, props\.week, pending\)/)
    assert.match(fn, /emit\('closed', res\)/)
  })
})

describe('接口封装: close-by-score 请求体', async () => {
  const memStore = { fde_internal_token: 'mock-token' }
  const prevLs = global.localStorage
  global.localStorage = { getItem: k => memStore[k] || null, setItem: (k, v) => { memStore[k] = String(v) }, removeItem: k => { delete memStore[k] } }
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return { status: 200, json: async () => ({ code: 0, data: { week: '2026-W47', pendingSelfScore: PENDING, pendingSelfScoreTotal: 2 } }) }
  }
  const { fde } = await import('../../src/api/index.js')
  after(() => { global.fetch = originalFetch; global.localStorage = prevLs })

  test('默认不带开关; 只有 true 才带 allowUnscoredSelfScored', async () => {
    const res = await fde.okr.closeByScore('2026-W47')
    assert.deepEqual(calls.at(-1).body, { week: '2026-W47' })
    assert.equal(res.pendingSelfScoreTotal, 2)
    await fde.okr.closeByScore('2026-W47', { allowUnscoredSelfScored: 'true' })
    assert.deepEqual(calls.at(-1).body, { week: '2026-W47' }, '非布尔 true 不算勾选')
    await fde.okr.closeByScore('2026-W47', { allowUnscoredSelfScored: true })
    assert.deepEqual(calls.at(-1).body, { week: '2026-W47', allowUnscoredSelfScored: true })
    assert.match(calls.at(-1).url, /\/api\/okr\/cycle\/close-by-score$/)
  })
})

describe('团队页: 归档后未自评提示条', () => {
  const render = compileView('views/okr/TeamOkr.vue')
  const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrWeekStatus: true, OkrExportMenu: true, OkrManagerScorePanel: true, OkrChangeReviewDialog: true }
  const pct = v => (v == null ? null : Math.round(v * 100))
  const base = (over = {}) => ({
    loading: false, isMobile: false, meId: '1', me: { id: '1', role: 'ADMIN' }, people: [], canScore: true, anyProxy: false, lead: true,
    weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 }, cycleTag: 'info', canCloseWeek: true, mgrOpen: false, mgrChanged: false,
    pct, initialOf: n => String(n || '').slice(0, 1), mayProxyRow: () => false, subText: r => r.submission, subClass: () => 'okr-sub', openPerson() {}, openProxy() {}, shift() {}, load() {},
    data: { cycle: { status: 'CLOSED' }, summary: { expected: 2, submitted: 2, late: 0, avgCompletion: 0.5 }, rows: [], lowStreak: { people: [], weeks: [] } },
    ...over
  })
  test('有提示 → 浅黄条 + 文案 + 可关闭(×, aria-label)', async () => {
    const text = closedNoticeText(t, '2026-W47', PENDING)
    const html = await renderView(render, base({ closedNotice: text }), EXTRA)
    const bar = html.split('data-test="okr-close-notice"')[1].split('</div>')[0]
    assert.ok(bar.includes(esc(text)))
    assert.ok(bar.includes('data-test="okr-close-notice-x"') && bar.includes(`aria-label="${esc(t('okr.close.dismiss'))}"`))
    const none = await renderView(render, base(), EXTRA)
    assert.ok(!none.includes('data-test="okr-close-notice"'))
  })
  test('接线: 只在 CLOSED 周、名单非空、没关过时出; 名单来自周状态; 评分面板关掉后周状态也刷新', () => {
    const s = src('views/okr/TeamOkr.vue')
    assert.match(s, /@loaded="s => \(wst = s\)"/)
    assert.match(s, /pendingSelfFromStatus\(wst\.value\)/)
    assert.match(s, /status !== 'CLOSED' \|\| !pendingSelf\.value\.length\) return ''/)
    assert.match(s, /noticeDismissed\(week\)/)
    assert.match(s, /load\(\); wstRef\?\.reload\(\)/)
    assert.match(s, /\.okr-close-notice \{[^}]*background: #fdf6d8/)
    assert.match(src('components/okr/OkrWeekStatus.vue'), /emit\('loaded', status\.value\)/)
  })
})

describe('文案中英齐备', () => {
  test('okr.close 两边键一致, 无空串', () => {
    const zk = Object.keys(zh.okr.close).sort()
    assert.deepEqual(Object.keys(en.okr.close).sort(), zk)
    for (const k of zk) assert.ok(zh.okr.close[k] && en.okr.close[k], k)
  })
})
