// OKR 2.0 第二轮前端: 人员筛选 / 团队点进详情 / 个人按周按年 / 主管代操作 / 导入文档。
// 纯函数直接测; 页面用真实模板 + 手给状态 SSR 渲染, 看画出来的字(尤其: 非 ADMIN 看别人时一个「主管分」都不能有)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  viewedUserId, queryForPerson, initialOf, pickerPeople, canSeeManagerScore, hasField, mayProxyRow,
  draftFileProblem, mergeDraft, trendGeometry, yearOptions, currentUser, DRAFT_FILE_MAX, krDoneRate, skippedWeeks
} from '../../src/views/okr/okrPeople.js'
import { pct } from '../../src/views/okr/okrUtils.js'

describe('人员筛选: 地址与列表', () => {
  test('userId 优先, 兼容老链接 ownerId, 没有 = 自己', () => {
    assert.equal(viewedUserId({ userId: '7', ownerId: '9' }), '7')
    assert.equal(viewedUserId({ ownerId: '9' }), '9')
    assert.equal(viewedUserId({}), '')
  })

  test('切人写 userId 并去掉 ownerId; 选回自己去掉 userId; 周保留', () => {
    assert.deepEqual(queryForPerson({ week: '2026-W47', ownerId: '3' }, '8', '1'), { week: '2026-W47', userId: '8' })
    assert.deepEqual(queryForPerson({ week: '2026-W47', userId: '8' }, '1', '1'), { week: '2026-W47' })
    assert.deepEqual(queryForPerson({ userId: '8' }, '', '1'), {})
  })

  test('头像占位取首字, 英文大写', () => {
    assert.equal(initialOf('林晓'), '林')
    assert.equal(initialOf('sam'), 'S')
    assert.equal(initialOf(''), '?')
  })

  test('列表来自 /okr/team rows: 自己排第一、去重; 列表里没有自己也补上', () => {
    const rows = [{ user: { id: '5', name: 'B', avatarUrl: '/a.png' } }, { user: { id: '1', name: 'Me' } }, { user: { id: '5', name: 'B' } }]
    assert.deepEqual(pickerPeople(rows, { id: 1, name: 'Me' }).map(p => p.id), ['1', '5'])
    assert.equal(pickerPeople(rows, { id: 1 })[1].avatarUrl, '/a.png')
    assert.deepEqual(pickerPeople([{ user: { id: '5', name: 'B' } }], { id: 9, name: 'Z' }).map(p => p.id), ['9', '5'])
  })

  test('currentUser 读 localStorage, 坏数据返回 {}', () => {
    assert.deepEqual(currentUser({ getItem: () => '{"id":3}' }), { id: 3 })
    assert.deepEqual(currentUser({ getItem: () => '{bad' }), {})
    assert.deepEqual(currentUser(undefined), {})
  })
})

describe('权限: 主管评分与代操作只是界面提示, 以后端为准', () => {
  test('主管分: 本人或有 okr.score.manager 才画', () => {
    assert.equal(canSeeManagerScore({ ownerId: '2', meId: '2', canScore: false }), true)
    assert.equal(canSeeManagerScore({ ownerId: '2', meId: '3', canScore: false }), false)
    assert.equal(canSeeManagerScore({ ownerId: '2', meId: '3', canScore: true }), true)
  })

  test('hasField: 后端剔除是删键, null 也算有', () => {
    assert.equal(hasField({ managerScore: null }, 'managerScore'), true)
    assert.equal(hasField({}, 'managerScore'), false)
    assert.equal(hasField(null, 'managerScore'), false)
  })

  test('团队行「代操作」: ADMIN 除自己外都给; MANAGER 不给自己和 ADMIN; 工程师都不给', () => {
    const admin = { id: '1', role: 'ADMIN' }
    const mgr = { id: '2', role: 'MANAGER' }
    const eng = { id: '3', role: 'FDE_ENGINEER' }
    assert.equal(mayProxyRow(admin, { id: '3', role: 'FDE_ENGINEER' }), true)
    assert.equal(mayProxyRow(admin, { id: '1', role: 'ADMIN' }), false)
    assert.equal(mayProxyRow(mgr, { id: '3', role: 'FDE_ENGINEER' }), true)
    assert.equal(mayProxyRow(mgr, { id: '1', role: 'ADMIN' }), false)
    assert.equal(mayProxyRow(mgr, { id: '2', role: 'MANAGER' }), false)
    assert.equal(mayProxyRow(eng, { id: '4', role: 'FDE_ENGINEER' }), false)
  })
})

describe('导入文档: 本地校验与填入方式', () => {
  test('类型 / 大小 / 空文件 / 没选', () => {
    assert.equal(draftFileProblem(null), 'okr.import.need_file')
    assert.equal(draftFileProblem({ name: 'a.doc', size: 10 }), 'okr.import.bad_type')
    assert.equal(draftFileProblem({ name: 'a.pdf', size: 10 }), 'okr.import.bad_type')
    assert.equal(draftFileProblem({ name: 'a.md', size: DRAFT_FILE_MAX + 1 }), 'okr.import.too_big')
    assert.equal(draftFileProblem({ name: 'a.txt', size: 0 }), 'okr.import.empty')
    for (const n of ['周报.md', 'plan.TXT', 'x.docx', 'y.markdown']) assert.equal(draftFileProblem({ name: n, size: DRAFT_FILE_MAX }), '')
  })

  const o = (title, n) => ({ title, status: 'ON_TRACK', weight: 0, keyResults: Array.from({ length: n }, (_, i) => ({ title: `${title}-kr${i}` })) })

  test('覆盖: 原样用新草稿', () => {
    const inc = [o('新', 2)]
    assert.deepEqual(mergeDraft([o('旧', 1)], inc, 'replace'), { objectives: inc, dropped: 0 })
  })

  test('追加: 接在已有后面, 空占位 O 不算, O 权重按 KR 条数合计 100', () => {
    const blank = { title: '', status: 'ON_TRACK', weight: 100, keyResults: [{ title: '' }] }
    const r = mergeDraft([o('旧', 1), blank], [o('新', 3)], 'append')
    assert.deepEqual(r.objectives.map(x => x.title), ['旧', '新'])
    assert.deepEqual(r.objectives.map(x => x.weight), [25, 75])
    assert.equal(r.dropped, 0)
  })

  test('追加: 最多 3 个 O, 多出来的计数', () => {
    const r = mergeDraft([o('a', 1), o('b', 1)], [o('c', 1), o('d', 1), o('e', 1)], 'append')
    assert.deepEqual(r.objectives.map(x => x.title), ['a', 'b', 'c'])
    assert.equal(r.dropped, 2)
    assert.equal(r.objectives.reduce((s, x) => s + x.weight, 0), 100)
  })
})

describe('按年: 手写 SVG 折线', () => {
  test('没分的周断开折线, 点数 = 有分的周', () => {
    const g = trendGeometry([{ label: 'W1', value: 80 }, { label: 'W2', value: null }, { label: 'W3', value: 60 }, { label: 'W4', value: 100 }], { width: 100, height: 100, pad: 0 })
    assert.equal(g.segments.length, 2)
    assert.equal(g.dots.length, 3)
    assert.deepEqual(g.dots[0], { x: 0, y: 20, value: 80, label: 'W1' })
    assert.equal(g.segments[1], '66.7,40 100,0')
    assert.deepEqual(g.ticks.map(x => x.value), [0, 50, 100])
  })

  test('单点居中; 超范围夹到 0–100', () => {
    const g = trendGeometry([{ label: 'W9', value: 130 }], { width: 100, height: 100, pad: 10 })
    assert.deepEqual([g.dots[0].x, g.dots[0].y], [50, 10])
    assert.deepEqual(trendGeometry([]), { segments: [], dots: [], ticks: trendGeometry([]).ticks })
  })

  test('年份下拉: 今年 + 出现过的年, 倒序去重', () => {
    assert.deepEqual(yearOptions([{ year: 2025 }, { year: 2026 }], 2026), [2026, 2025])
    assert.deepEqual(yearOptions([], 2026), [2026])
  })
})

test('新增文案中英 key 一致', () => {
  const load = f => JSON.parse(readFileSync(new URL(`../../src/locales/${f}`, import.meta.url), 'utf8'))
  const zh = load('zh-CN.json').okr
  const en = load('en.json').okr
  const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`])).sort()
  for (const sec of ['people', 'proxy', 'import', 'person']) assert.deepEqual(keys(zh[sec]), keys(en[sec]), sec)
  assert.match(zh.proxy.banner, /正在编辑 \{p0\} 的 OKR · 由 \{p1\} 代填/)
  assert.match(zh.proxy.submit_for, /代 \{p0\} 提交/)
  assert.match(zh.proxy.confirm_submit, /按 \{p0\} 的时间算迟交/)
})

// ---------------------------------------------------------------- 页面渲染

const MGR = t('okr.manager_score')
const MGR_SHORT = t('okr.manager_short')
const MGR_LABEL = t('okr.person.manager_label')
const cardStub = { props: ['obj'], setup: p => () => Vue.h('section', { class: 'card' }, [p.obj.title, p.obj.managerScore != null ? ` ${MGR_SHORT} ${p.obj.managerScore}` : '']) }
const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, 'el-tabs': true, 'el-tab-pane': true, OkrObjectiveCard: cardStub, OkrPlanEditor: true, OkrReportDraftDialog: true, 'el-checkbox': true, 'el-input-number': true }

describe('个人详情 OkrPerson', () => {
  const render = compileView('views/okr/OkrPerson.vue')
  const base = (over = {}) => ({
    loading: false, isMobile: false, userId: '5', meId: '3', people: [], canProxy: false, tab: 'year',
    weekQuery: {}, okrQuery: { userId: '5' }, weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 },
    year: 2026, years: [2026], CW: 640, CH: 180, PAD: 28, xLabels: [{ x: 28, label: 'W46' }],
    geo: trendGeometry([{ label: 'W46', value: 70 }, { label: 'W47', value: 80 }], { width: 640, height: 166, pad: 28 }),
    pct, krDoneRate, skipped: [], isZh: true, initialOf, roleLabel: r => r, pickPerson() {}, goProxy() {}, setTab() {}, setYear() {}, shift() {}, openWeek() {},
    showMgr: () => false,
    ov: {
      user: { id: '5', name: '林晓', role: 'FDE_ENGINEER', teams: [{ id: '1', name: '交付一组' }] },
      current: { week: '2026-W47', objectiveCount: 2, krCount: 5, avgSelfScore: 78, lateCount: 1, updateCount: 6 },
      years: []
    },
    ws: {
      week: '2026-W47', cycle: null,
      summary: { completion: 0.5, selfScore: 78, updateCount: 6, late: false, submitted: true },
      objectives: [{ id: '1', seq: 1, title: 'O-交付', weight: 60, status: 'ON_TRACK', progress: 0.5, keyResults: [] }]
    },
    ys: {
      summary: { weeksParticipated: 2, avgSelfScore: 75, completionRate: 0.6, committed: 5, done: 3 },
      weeks: [
        { key: '2026-W46', weekNo: 46, submitted: true, late: true, selfScore: 70, committed: 2, done: 1, completion: 0.5 },
        { key: '2026-W47', weekNo: 47, submitted: true, late: false, selfScore: 80, committed: 3, done: 2, completion: 0.67 }
      ]
    },
    ...over
  })

  test('工程师看别人: 头部五项、按周 O 卡、按年汇总与折线都在; 没有主管分, 也没有代操作', async () => {
    const html = await renderView(render, base(), EXTRA)
    for (const s of ['林晓', '交付一组', t('okr.person.o_count'), t('okr.person.kr_count'), t('okr.person.avg_self'), t('okr.person.late_count'), t('okr.person.update_count'),
      'O-交付', t('okr.person.weeks_participated'), t('okr.person.completion_rate_kr'), '60', '<polyline', t('okr.person.done_of', { p0: 1, p1: 2 })]) {
      assert.ok(html.includes(s), `缺 ${s}`)
    }
    assert.ok(!html.includes(MGR), '不能出现主管分')
    assert.ok(!html.includes(t('okr.person.avg_manager')))
    assert.ok(!html.includes(`${MGR_LABEL} `), '每周列表不能有「主管」分')
    assert.ok(!html.includes('data-test="op-proxy"'))
    // 头部 5 格, 不多一格占位
    const stats = html.split('data-test="op-stats"')[1].split('op-tabs')[0]
    assert.equal((stats.match(/<b/g) || []).length, 5)
  })

  test('ADMIN 看别人: 多出主管分(本周 / 本周汇总 / 年均 / 每周), 有代操作', async () => {
    const st = base({ canProxy: true, showMgr: (obj, key = 'managerScore') => key in obj })
    st.ov.current.managerScore = 85
    st.ws.summary.managerScore = 85
    st.ys.summary.avgManagerScore = 82
    st.ys.weeks.forEach(w => { w.managerScore = 80 })
    const html = await renderView(render, st, EXTRA)
    assert.ok(html.includes(MGR))
    assert.ok(html.includes(t('okr.person.avg_manager')))
    assert.ok(html.includes(`${MGR_LABEL} 80`))
    assert.ok(html.includes('data-test="op-proxy"'))
  })
})

describe('按年每周条形: 完成口径 = KR 条数比', () => {
  const render = compileView('views/okr/OkrPerson.vue')
  const W38 = { key: '2026-W38', weekNo: 38, submitted: true, late: false, selfScore: 65.2, managerScore: 66.2, committed: 5, done: 2, completion: 0.75 }
  const W39 = { key: '2026-W39', weekNo: 39, submitted: true, late: false, selfScore: 57, managerScore: 58, committed: 5, done: 3, completion: 0.95 }
  const W41 = { key: '2026-W41', weekNo: 41, submitted: true, late: false, selfScore: 75.2, committed: 5, done: 3, completion: 0.95 }
  const state = (over = {}) => ({
    loading: false, isMobile: false, userId: '38', meId: '1', people: [], canProxy: false, tab: 'year',
    weekQuery: {}, okrQuery: {}, weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 },
    year: 2026, years: [2026], CW: 640, CH: 180, PAD: 28, xLabels: [], geo: trendGeometry([], {}),
    pct, krDoneRate, isZh: true, skipped: [40], initialOf, roleLabel: r => r,
    pickPerson() {}, goProxy() {}, setTab() {}, setYear() {}, shift() {}, openWeek() {},
    showMgr: (obj, key = 'managerScore') => key in obj,
    ov: { user: { id: '38', name: '林晓', role: 'FDE_ENGINEER' }, current: { week: '2026-W47', objectiveCount: 2, krCount: 5, lateCount: 0, updateCount: 0 }, years: [] },
    ws: null,
    ys: { summary: { weeksParticipated: 3, avgSelfScore: 66, completionRate: 8 / 15 }, weeks: [W38, W39, W41] },
    ...over
  })
  const row = (html, no) => html.split(`data-week="${no}"`)[1].split('</li>')[0]
  const plain = s => s.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  test('krDoneRate: done / committed; 没承诺就是 null', () => {
    assert.equal(krDoneRate(W38), 0.4)
    assert.equal(krDoneRate(W39), 0.6)
    assert.equal(krDoneRate({ committed: 0, done: 0 }), null)
    assert.equal(krDoneRate({}), null)
  })

  test('skippedWeeks: 列出中间跳过的周号', () => {
    assert.deepEqual(skippedWeeks([W38, W39, W41]), [40])
    assert.deepEqual(skippedWeeks([{ weekNo: 41 }, { weekNo: 38 }, { weekNo: 45 }]), [39, 40, 42, 43, 44])
    assert.deepEqual(skippedWeeks([W38, W39]), [])
    assert.deepEqual(skippedWeeks([]), [])
  })

  test('第 38 周: 完成 2/5 与条形 40% 一致; 加权完成度 75% 单独一行写明', async () => {
    const html = await renderView(render, state(), EXTRA)
    const r = row(html, 38)
    assert.match(r, /width:\s*40%/)
    assert.match(r, /class="op-wpct">40%</)
    assert.ok(plain(r).includes(`${t('okr.person.done_of', { p0: 2, p1: 5 })} · ${t('okr.person.self_label')} 65.2 · ${MGR_LABEL} 66.2`), plain(r))
    assert.match(r, new RegExp(`class="op-wweighted">${t('okr.person.weighted', { p0: 75 })}<`))
    assert.ok(!plain(r.split('op-wweighted')[0]).includes('75%'), '75% 不能挤在「完成 2/5」那一行')
    const r39 = row(html, 39)
    assert.match(r39, /width:\s*60%/)
    assert.match(r39, /class="op-wpct">60%</)
    assert.ok(plain(r39).includes(t('okr.person.done_of', { p0: 3, p1: 5 })))
  })

  test('年度汇总的完成率与加权完成度各自标清口径; 不再用「自 / 主」缩写', async () => {
    const html = await renderView(render, state(), EXTRA)
    assert.ok(html.includes(t('okr.person.completion_rate_kr')))
    const weeks = html.split('class="op-weeks"')[1]
    assert.ok(!weeks.includes(`${MGR_SHORT} `))
    assert.ok(!weeks.includes(`${t('okr.self_short')} 65.2`))
  })

  test('跳号的周: 有空缺才提示「未提交的周不显示」', async () => {
    const html = await renderView(render, state(), EXTRA)
    assert.ok(html.includes(t('okr.person.skipped', { p0: '40' })))
    const none = await renderView(render, state({ skipped: [] }), EXTRA)
    assert.ok(!none.includes('data-test="op-skipped"'))
  })
})

describe('周 OKR 页 MyOkr: 看别人 / 代管', () => {
  const render = compileView('views/okr/MyOkr.vue')
  const obj = { id: '1', seq: 1, title: 'O-上线', weight: 100, status: 'ON_TRACK', progress: 0.4, submittedAt: '2026-11-16T02:00:00Z', keyResults: [], updatedKey: '0' }
  const base = (over = {}) => ({
    loading: false, isMobile: false, busy: '', editing: false, draftInit: [], editorRef: null, reportOpen: false, reportSource: 'text',
    self: { visible: false }, miss: { visible: false, reason: '' }, selfObj: null, scorable: [obj], selfDone: 0,
    pickedId: '5', people: [], meId: '3', meName: 'Boss', ownerId: '5', ownerName: '林晓',
    viewingOther: true, proxyMode: false, proxyTarget: '', canAct: false, canEditPlan: false, canScoreManager: false, showSelfScore: false,
    submittedOnce: true, canTeam: true, tagText: '', tagType: 'info', weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 },
    pct, shift() {}, pickPerson() {}, openDraft() {}, startEdit() {}, savePlan() {}, addUpdate() {}, managerScore() {}, openMiss() {}, fillFromReport() {},
    data: {
      owner: { id: '5', name: '林晓' }, completion: 0.4, selfScore: 70,
      cycle: { status: 'IN_PROGRESS', deadlinePassed: false }, can: { edit: false, selfScore: false, proxy: false, managerScore: false },
      objectives: [obj]
    },
    ...over
  })

  test('工程师看别人: 能看到 O, 没有改计划 / 导入文档 / 提示条 / 主管分', async () => {
    const html = await renderView(render, base(), EXTRA)
    assert.ok(html.includes('O-上线'))
    assert.ok(html.includes('data-test="okr-person-detail"'))
    for (const bad of [t('okr.edit_plan'), 'data-test="import-open"', 'data-test="report-open"', 'data-test="okr-proxy-bar"', MGR]) {
      assert.ok(!html.includes(bad), `不该有 ${bad}`)
    }
  })

  test('代管(编辑中): 常驻提示条写明替谁、谁代填; 贴周报 + 导入文档两个入口', async () => {
    const html = await renderView(render, base({
      proxyMode: true, proxyTarget: '5', canAct: true, canEditPlan: true, editing: true,
      data: { ...base().data, can: { edit: true, selfScore: false, proxy: true, managerScore: false } }
    }), EXTRA)
    assert.ok(html.includes(t('okr.proxy.banner', { p0: '林晓', p1: 'Boss' }).replace(/'/g, '&#39;')))
    assert.ok(html.includes('data-test="import-open"'))
    assert.ok(html.includes('data-test="report-open"'))
    assert.ok(html.includes(t('okr.import.entry_hint', { p0: '林晓' }).replace(/'/g, '&#39;')))
  })

  test('看别人 / 代管: 子导航只留「团队」「历史」两端, 不再重复人名(人名在顶部筛选器里)', async () => {
    for (const st of [base(), base({ proxyMode: true, proxyTarget: '5', canAct: true, canEditPlan: true, editing: true })]) {
      const html = await renderView(render, st, EXTRA)
      const nav = html.split('class="okr-owner"')[1].split(/class="okr-(?!owner)/)[0]
      assert.ok(!nav.includes('林晓'), nav)
      assert.ok(nav.includes(t('okr.people.owner_okr').replace(/'/g, '&#39;')), nav + ' / ' + t('okr.people.owner_okr'))
      assert.ok(nav.includes(t('okr.tab_team')) && nav.includes(t('okr.tab_history')))
    }
  })

  test('源码约束: 写接口都带代管目标; 代提交先二次确认; 主管评分入口挂在 okr.score.manager 上', () => {
    const src = readFileSync(new URL('../../src/views/okr/MyOkr.vue', import.meta.url), 'utf8')
    for (const call of ['submitPlan(week, objectives, t)', 'savePlan(week, objectives, t)', 'addUpdate(objectiveId, payload, proxyTarget.value', 'proxyTarget.value || undefined)']) {
      assert.ok(src.includes(call), call)
    }
    assert.match(src, /submit && proxyMode\.value[\s\S]{0,200}ElMessageBox\.confirm\(\$t\('okr\.proxy\.confirm_submit'/)
    assert.match(src, /:can-manager-score="canScoreManager && data\.can\.managerScore/)
    assert.match(src, /canScoreManager = can\('okr\.score\.manager'\)/)
  })
})

describe('团队页 TeamOkr', () => {
  const render = compileView('views/okr/TeamOkr.vue')
  const rows = [
    { user: { id: '3', name: '我自己', role: 'FDE_ENGINEER' }, submission: 'ON_TIME', submitted: true, objectiveCount: 1, completion: 0.5, krDone: 1, krTotal: 2, selfScore: 70 },
    { user: { id: '5', name: '林晓', role: 'FDE_ENGINEER' }, submission: 'NONE', submitted: false, objectiveCount: 0, completion: null, krDone: 0, krTotal: 0, selfScore: null }
  ]
  const base = (over = {}) => ({
    loading: false, isMobile: false, meId: '3', me: { id: '3', role: 'FDE_ENGINEER' }, people: [], canScore: false, anyProxy: false, canManage: false,
    weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 }, cycleTag: 'info', canClose: false, canReopen: false,
    pct, initialOf, mayProxyRow, subText: r => r.submission, subClass: () => 'okr-sub', openPerson() {}, openProxy() {}, shift() {},
    data: { cycle: { status: 'IN_PROGRESS' }, summary: { expected: 2, submitted: 1, late: 0, avgCompletion: 0.5 }, rows, lowStreak: { people: [], weeks: [] } },
    ...over
  })

  test('工程师: 列出本团队, 没有主管分列, 没有代操作', async () => {
    const html = await renderView(render, base(), EXTRA)
    assert.ok(html.includes('林晓') && html.includes('我自己'))
    assert.ok(!html.includes(MGR))
    assert.ok(!html.includes('data-test="okr-row-proxy"'))
  })

  test('ADMIN: 有主管分列, 除自己外每行有代操作', async () => {
    const me = { id: '1', role: 'ADMIN' }
    const html = await renderView(render, base({ me, meId: '1', canScore: true, anyProxy: true }), EXTRA)
    assert.ok(html.includes(MGR))
    assert.equal((html.match(/data-test="okr-row-proxy"/g) || []).length, 2)
  })

  test('源码约束: 点行进 /admin/okr/person/:id 并带周', () => {
    const src = readFileSync(new URL('../../src/views/okr/TeamOkr.vue', import.meta.url), 'utf8')
    assert.match(src, /@row-click="row => openPerson\(row\.user\.id\)"/)
    assert.match(src, /path: `\/admin\/okr\/person\/\$\{id\}`, query: \{ week: weekKeyNow\.value \}/)
  })
})

test('路由: 个人详情页存在, 团队页不再只给 ADMIN', () => {
  const src = readFileSync(new URL('../../src/router/index.js', import.meta.url), 'utf8')
  assert.match(src, /path: 'okr\/person\/:userId\(\\\\d\+\)', name: 'AdminOkrPerson'/)
  assert.doesNotMatch(src, /okr\/team'[^\n]*\n[^\n]*requiredRoles/)
})

