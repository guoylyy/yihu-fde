// OKR 前端第五批: 导出 / 决策记录 / 连续未达成预警。
// 纯函数直接测; 组件用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  mayExportTeam, exportItems, projectExportItems, exportUrl, fileNameFromDisposition, downloadExport, fileSizeText,
  defaultDecisionRange, filterDecisions, decisionRow, missingSupersederIds, decisionMenu, revertPayload, decisionPayload,
  decisionStats, objectiveOptions, decisionBriefs,
  levelOf, riskByObjective, streakOf, myRiskBars, riskSummaryCounts, recentRates, findRiskTarget
} from '../../src/views/okr/okrFe5.js'
import { OBJ_TAG, pct, krValueText } from '../../src/views/okr/okrUtils.js'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)
const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length
const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')

const ADMIN = { id: '1', role: 'ADMIN' }
const MGR = { id: '2', role: 'MANAGER' }
const ENG = { id: '7', role: 'FDE_ENGINEER' }
const LEAD = { id: '8', role: 'TEAM_LEAD' }

// 下拉: 把 #dropdown 插槽也画出来
const dropdown = { setup: (_, { slots }) => () => Vue.h('div', [slots.default?.(), slots.dropdown?.()]) }
const pass = true

// ---------------------------------------------------------------- 一、导出

describe('导出: 选项 / 地址 / 文件名', () => {
  test('我的 OKR: 两项, 导当前看的人(默认自己)这一周, scope=person', () => {
    const items = exportItems({ page: 'mine', user: ENG, week: '2026-W47' })
    assert.deepEqual(items.map(i => i.key), ['xlsx', 'docx'])
    assert.deepEqual(items.map(i => i.label), ['okr.fe5.export_xlsx', 'okr.fe5.export_docx'])
    assert.deepEqual(items[0].params, { week: '2026-W47', scope: 'person', format: 'xlsx', userId: '7' })
    assert.equal(items[1].params.format, 'docx')
    assert.equal(exportItems({ page: 'mine', user: ADMIN, week: '2026-W47', userId: '38' })[0].params.userId, '38', '看别人时导他')
    assert.equal(t('okr.fe5.export_xlsx'), 'Excel details')
  })
  test('团队 OKR: ADMIN / MANAGER 多「团队 Excel」(scope=team); 工程师 / 组长看不到「团队」项', () => {
    for (const u of [ADMIN, MGR]) {
      const items = exportItems({ page: 'team', user: u, week: '2026-W47' })
      assert.deepEqual(items.map(i => i.key), ['xlsx', 'docx', 'team'], u.role)
      assert.deepEqual(items[2].params, { week: '2026-W47', scope: 'team', format: 'xlsx' })
      assert.equal(items[0].params.userId, u.id, '前两项导自己')
    }
    for (const u of [ENG, LEAD]) {
      assert.deepEqual(exportItems({ page: 'team', user: u, week: '2026-W47' }).map(i => i.key), ['xlsx', 'docx'], u.role)
    }
    assert.equal(mayExportTeam(ENG), false)
    assert.equal(mayExportTeam(MGR), true)
  })
  test('团队页带项目时: 团队项换成该项目(scope=project&projectId)', () => {
    const items = exportItems({ page: 'team', user: ADMIN, week: '2026-W47', project: { id: 12, name: '园区巡检' } })
    assert.deepEqual(items[2].params, { week: '2026-W47', scope: 'project', format: 'xlsx', projectId: '12' })
    assert.equal(t(items[2].label, items[2].labelArgs), 'Project Excel: 园区巡检')
  })
  test('按项目视图的项目块导出: 只给 ADMIN / MANAGER, 「未挂项目」没有', () => {
    const items = projectExportItems({ user: MGR, week: '2026-W47', project: { id: '12' } })
    assert.deepEqual(items.map(i => [i.params.scope, i.params.format, i.params.projectId]), [['project', 'xlsx', '12'], ['project', 'docx', '12']])
    assert.deepEqual(projectExportItems({ user: ENG, week: '2026-W47', project: { id: '12' } }), [])
    assert.deepEqual(projectExportItems({ user: ADMIN, week: '2026-W47', project: null }), [])
    assert.deepEqual(projectExportItems({ user: ADMIN, week: '2026-W47', project: { id: 'none' } }), [])
  })
  test('地址: 空值不带', () => {
    assert.equal(exportUrl({ week: '2026-W47', scope: 'person', format: 'xlsx', userId: '7', projectId: '' }), '/api/okr/export?week=2026-W47&scope=person&format=xlsx&userId=7')
    assert.equal(exportUrl({ week: '2026-W47', scope: 'team', format: 'docx' }), '/api/okr/export?week=2026-W47&scope=team&format=docx')
  })
  test('文件名: filename*=UTF-8 优先(中文), 退回 filename=, 都没有用兜底', () => {
    const h = `attachment; filename="OKR-2026-W47-person-7.xlsx"; filename*=UTF-8''OKR-2026-W47-${encodeURIComponent('林晓')}.xlsx`
    assert.equal(fileNameFromDisposition(h), 'OKR-2026-W47-林晓.xlsx')
    assert.equal(fileNameFromDisposition('attachment; filename="OKR-2026-W47-team.xlsx"'), 'OKR-2026-W47-team.xlsx')
    assert.equal(fileNameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A; filename=\"a.docx\""), 'a.docx', '坏编码退回 ASCII')
    assert.equal(fileNameFromDisposition(null, 'x.xlsx'), 'x.xlsx')
    assert.equal(fileSizeText(512), '512 B')
    assert.equal(fileSizeText(12800), '12.5 KB')
    assert.equal(fileSizeText(3 * 1024 * 1024), '3.0 MB')
  })
})

/** 假的浏览器: 记下 <a> 的 href / download / click */
function fakeBrowser() {
  const clicks = []
  const doc = {
    body: { appendChild() {} },
    createElement: () => {
      const a = { style: {}, click() { clicks.push({ href: a.href, download: a.download }) }, remove() {} }
      return a
    }
  }
  const urlApi = { createObjectURL: () => 'blob:1', revokeObjectURL() {} }
  return { doc, urlApi, clicks }
}

describe('导出: 下载(fetch blob + <a download>)', () => {
  test('成功: 带 token、按 Content-Disposition 命名、触发一次下载, 返回文件名与大小', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push([url, opts.headers.Authorization])
      return {
        ok: true, status: 200,
        headers: new Map([['Content-Disposition', `attachment; filename="OKR-2026-W47-team.xlsx"; filename*=UTF-8''OKR-2026-W47-${encodeURIComponent('团队')}.xlsx`]]),
        blob: async () => ({ size: 6789 })
      }
    }
    const b = fakeBrowser()
    const r = await downloadExport({ week: '2026-W47', scope: 'team', format: 'xlsx' }, { fetchImpl, token: 'tk', doc: b.doc, urlApi: b.urlApi })
    assert.deepEqual(calls, [['/api/okr/export?week=2026-W47&scope=team&format=xlsx', 'Bearer tk']])
    assert.deepEqual(r, { name: 'OKR-2026-W47-团队.xlsx', size: 6789 })
    assert.deepEqual(b.clicks, [{ href: 'blob:1', download: 'OKR-2026-W47-团队.xlsx' }])
  })
  test('失败: 后端 JSON 文案原样抛出(403 8181), 不触发下载', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ code: 8181, message: '只有管理员或经理能导出团队 OKR' }) })
    const b = fakeBrowser()
    await assert.rejects(downloadExport({ week: '2026-W47', scope: 'team', format: 'xlsx' }, { fetchImpl, token: '', doc: b.doc, urlApi: b.urlApi }), (e) => {
      assert.equal(e.message, '只有管理员或经理能导出团队 OKR')
      assert.equal(e.status, 403)
      return true
    })
    assert.equal(b.clicks.length, 0)
    const html = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json') } })
    await assert.rejects(downloadExport({ week: '2026-W47' }, { fetchImpl: html, token: '', doc: b.doc, urlApi: b.urlApi }), /HTTP 502/)
  })
  test('不开新标签页: 代码里没有 window.open; 下拉组件用的是 downloadExport', () => {
    assert.doesNotMatch(src('views/okr/okrFe5.js') + src('components/okr/OkrExportMenu.vue'), /window\.open/)
    assert.match(src('components/okr/OkrExportMenu.vue'), /downloadExport\(it\.params\)/)
  })
  test('下拉组件: 每项一个菜单项, 第三项前有分隔', async () => {
    const render = compileView('components/okr/OkrExportMenu.vue')
    const items = exportItems({ page: 'team', user: ADMIN, week: '2026-W47' })
    const html = await renderView(render, { items, busy: false, run() {} }, { 'el-dropdown': dropdown, 'el-dropdown-menu': pass, 'el-dropdown-item': pass })
    has(html, t('okr.fe5.export'))
    for (const k of ['xlsx', 'docx', 'team']) assert.ok(html.includes(`data-test="okr-export-${k}"`), k)
    has(html, 'Team Excel')
  })
})

// ---------------------------------------------------------------- 二、决策记录

const dec = (over = {}) => ({
  id: '1', title: '巡检改两周一次', detail: '客户同意把巡检频率改成两周一次', rationale: '人手不够', impact: null,
  decidedByName: '老板', date: '2026-11-20', decidedAt: '2026-11-20T02:00:00Z', status: 'ACTIVE', supersededBy: null,
  project: { id: '12', name: '园区巡检' }, objective: { id: '90', title: 'O-巡检上线', ownerName: '林晓' },
  can: { edit: true, delete: true, supersede: true }, ...over
})

describe('决策记录: 纯函数', () => {
  test('默认时间范围: 最近 8 周(含今天, 上海日期)', () => {
    assert.deepEqual(defaultDecisionRange(8, new Date('2026-11-22T04:00:00Z')), { from: '2026-09-28', to: '2026-11-22' })
    assert.deepEqual(defaultDecisionRange(1, new Date('2026-11-22T20:00:00Z')), { from: '2026-11-17', to: '2026-11-23' }, '上海已是 23 号')
  })
  test('搜索: 标题 / 正文, 大小写不敏感; 空词原样', () => {
    const list = [dec(), dec({ id: '2', title: 'API 走 GraphQL', detail: '前端统一' }), dec({ id: '3', title: '别的', detail: '和 graphql 无关吗' })]
    assert.deepEqual(filterDecisions(list, 'graphql').map(d => d.id), ['2', '3'])
    assert.deepEqual(filterDecisions(list, '  巡检 ').map(d => d.id), ['1'])
    assert.equal(filterDecisions(list, '').length, 3)
  })
  test('时间线一行: 被取代取新决策标题(列表里 / 补查缓存), 撤销标红; 项目与 O 标签', () => {
    const neo = dec({ id: '5', title: '巡检改每周一次' })
    const old = dec({ id: '1', status: 'SUPERSEDED', supersededBy: '5' })
    const r = decisionRow(old, new Map([['5', neo]]))
    assert.equal(r.superseded, true)
    assert.equal(r.supersededTitle, '巡检改每周一次')
    assert.equal(r.supersededInList, true)
    assert.deepEqual(r.tags.map(x => [x.kind, x.text]), [['project', '园区巡检'], ['objective', 'O-巡检上线']])
    const far = decisionRow(dec({ status: 'SUPERSEDED', supersededBy: '77' }), new Map(), new Map([['77', { title: '更早范围外的新决策' }]]))
    assert.equal(far.supersededTitle, '更早范围外的新决策')
    assert.equal(far.supersededInList, false)
    assert.equal(decisionRow(dec({ status: 'REVERTED' })).reverted, true)
    assert.deepEqual(decisionRow(dec({ project: null, objective: null })).tags, [])
    assert.deepEqual(missingSupersederIds([old, neo, dec({ id: '9', status: 'SUPERSEDED', supersededBy: '77' })], new Map()), ['77'])
    assert.deepEqual(missingSupersederIds([dec({ supersededBy: '77' })], new Map([['77', {}]])), [], '补查过的不再查')
  })
  test('卡片菜单: 撤销要能改且生效中; 取代看后端 can.supersede', () => {
    assert.deepEqual(decisionMenu(dec()), ['revert', 'supersede'])
    assert.deepEqual(decisionMenu(dec({ can: { edit: false, supersede: false } })), [])
    assert.deepEqual(decisionMenu(dec({ status: 'REVERTED', can: { edit: true, supersede: false } })), [])
    assert.deepEqual(decisionMenu(dec({ can: { edit: true, supersede: false } })), ['revert'], '工程师作者 7 天内能撤销, 不能取代')
  })
  test('撤销请求体: 空原因原样发空(让后端 400 文案透出); 有原因时保留原理由', () => {
    assert.deepEqual(revertPayload('  ', '人手不够', t), { status: 'REVERTED', rationale: '' })
    assert.deepEqual(revertPayload('客户改主意', '', t), { status: 'REVERTED', rationale: 'Revert reason: 客户改主意' })
    assert.equal(revertPayload('客户改主意', '人手不够', t).rationale, 'Revert reason: 客户改主意\n\nOriginal rationale: 人手不够')
  })
  test('新建请求体: 必填 trim, 可选空的不带, 决策时间转 ISO', () => {
    const at = new Date('2026-11-20T02:00:00Z')
    assert.deepEqual(decisionPayload({ title: ' A ', detail: ' B ', rationale: '', impact: ' C ', objectiveId: 90, projectId: '', decidedAt: at }),
      { title: 'A', detail: 'B', impact: 'C', objectiveId: '90', decidedAt: '2026-11-20T02:00:00.000Z' })
  })
  test('右栏: 本周决策数(按上海日期) + 按项目分布(多的在前, 未挂项目垫底)', () => {
    const now = new Date('2026-11-20T04:00:00Z') // 2026-W47: 11-16 ~ 11-22
    const list = [
      dec({ id: '1', date: '2026-11-16' }), dec({ id: '2', date: '2026-11-22', project: { id: '13', name: '告警平台' } }),
      dec({ id: '3', date: '2026-11-15', project: null }), dec({ id: '4', date: '2026-11-10', project: { id: '13', name: '告警平台' } }),
      dec({ id: '5', date: '2026-11-01', project: null }), dec({ id: '6', date: '2026-11-02', project: null }), dec({ id: '7', date: '2026-11-03', project: null })
    ]
    const s = decisionStats(list, now)
    assert.equal(s.week, '2026-W47')
    assert.equal(s.thisWeek, 2, '11-15 是上周日, 不算')
    assert.deepEqual(s.projects.map(p => [p.id, p.count]), [['13', 2], ['12', 1], [null, 4]])
    assert.equal(s.projects[0].ratio, 0.5)
  })
  test('「挂到 O」选项: 主管用团队行(带负责人), 工程师用自己这周的 O; 去掉已放弃', () => {
    const rows = [{ user: { name: '林晓' }, objectives: [{ id: 1, title: 'O-甲', status: 'ON_TRACK' }, { id: 2, title: 'O-弃', status: 'DROPPED' }] }]
    assert.deepEqual(objectiveOptions({ rows }), [{ id: '1', label: 'O-甲 · 林晓' }])
    assert.deepEqual(objectiveOptions({ objectives: [{ id: 3, title: 'O-乙', status: 'AT_RISK' }], owner: { name: '周舟' } }), [{ id: '3', label: 'O-乙 · 周舟' }])
  })
  test('O 卡片的决策条目: 日期按上海', () => {
    assert.deepEqual(decisionBriefs({ decisions: [{ id: '1', title: 'A', decidedAt: '2026-11-19T17:00:00Z' }] }).map(d => d.date), ['2026-11-20'])
    assert.deepEqual(decisionBriefs({}), [])
  })
})

describe('决策记录页: 时间线渲染', () => {
  const render = compileView('views/okr/OkrDecisions.vue')
  const EXTRA = { 'el-dropdown': dropdown, 'el-dropdown-menu': pass, 'el-dropdown-item': pass, OkrDecisionDialog: pass }
  const neo = dec({ id: '5', title: '巡检改每周一次', date: '2026-11-21' })
  const list = [neo, dec({ id: '1', status: 'SUPERSEDED', supersededBy: '5', can: { edit: true, supersede: false } }), dec({ id: '2', title: '暂停告警平台二期', status: 'REVERTED', project: null, objective: null, can: { edit: true, supersede: false } })]
  const state = (over = {}) => {
    const all = over.list || list
    const byId = new Map(all.map(d => [d.id, d]))
    return {
      loading: false, busy: false, q: '', projectId: '', range: ['2026-09-28', '2026-11-22'], projects: [], oOptions: [], writer: true, isMobile: false,
      timeline: { list: all, truncated: false }, rows: all.map(d => decisionRow(d, byId)), stats: decisionStats(all, new Date('2026-11-20T04:00:00Z')),
      focusId: '', isOpen: id => (over.open || []).includes(id), toggle() {}, jump() {}, onMenu() {}, openCreate() {}, onSubmit() {}, submitRevert() {},
      decisionMenu, supText: d => (d.supersededTitle ? t('okr.fe5.dec_superseded_by', { p0: d.supersededTitle }) : t('okr.fe5.dec_superseded_by_id', { p0: d.supersededBy })),
      dlg: { visible: false, mode: 'create', old: null }, rev: { visible: false, d: null, reason: '', error: '' },
      ...over
    }
  }
  test('每条一个点: 日期 · 决策人 · 标题 · 项目 / O 标签; 被取代的灰删除线 +「已被 X 取代」; 撤销红标签', async () => {
    const html = await renderView(render, state(), EXTRA)
    assert.equal(count(html, 'class="dec-dot"'), 3)
    has(html, '2026-11-21 · 老板')
    has(html, '巡检改每周一次')
    assert.match(html, /class="dec-item sup"[^>]*data-test="dec-item-1"/)
    has(html, t('okr.fe5.dec_superseded_by', { p0: '巡检改每周一次' }))
    assert.match(html, /class="dec-item rev"[^>]*data-test="dec-item-2"/)
    assert.equal(count(html, 'data-test="dec-reverted"'), 1)
    has(html, 'Reverted')
    has(html, '园区巡检')
    has(html, 'O O-巡检上线')
  })
  test('卡片菜单: 生效中的有「撤销 / 取代」; 已被取代 / 已撤销的没有菜单', async () => {
    const html = await renderView(render, state(), EXTRA)
    assert.equal(count(html, 'data-test="dec-menu"'), 1)
    has(html, t('okr.fe5.dec_revert'))
    has(html, t('okr.fe5.dec_supersede'))
  })
  test('展开看背景 / 理由 / 影响(没有的段不出)', async () => {
    const html = await renderView(render, state({ open: ['5'] }), EXTRA)
    assert.equal(count(html, 'data-test="dec-expanded"'), 1)
    has(html, t('okr.fe5.dec_detail'))
    has(html, '客户同意把巡检频率改成两周一次')
    has(html, t('okr.fe5.dec_rationale'))
    lacks(html, t('okr.fe5.dec_impact'))
  })
  test('右栏: 本周决策数 + 按项目分布(CSS 只在 ≥1280 显示); 空时间线出空态', async () => {
    const html = await renderView(render, state(), EXTRA)
    assert.match(html, /data-test="dec-side-week">3</)
    has(html, t('okr.fe5.dec_side_unassigned'))
    assert.match(src('views/okr/OkrDecisions.vue'), /\.dec-side \{ display: none; \}[\s\S]*@media \(min-width: 1280px\)[\s\S]*\.dec-side \{ display: flex;/)
    const empty = await renderView(render, state({ list: [] }), EXTRA)
    has(empty, t('okr.fe5.dec_empty'))
  })
  test('撤销弹窗: 后端文案原样显示, 确认按钮不因空原因置灰(让后端 400 透出)', async () => {
    const html = await renderView(render, state({ rev: { visible: true, d: list[0], reason: '', error: '撤销决策必须写明原因' } }), EXTRA)
    assert.match(html, /data-test="dec-revert-error">撤销决策必须写明原因</)
    assert.doesNotMatch(src('views/okr/OkrDecisions.vue'), /data-test="dec-revert-go"[^>]*:disabled/)
  })
})

describe('「记一条决策」弹窗', () => {
  const render = compileView('components/okr/OkrDecisionDialog.vue')
  const base = (over = {}) => ({
    modelValue: true, mode: 'create', old: null, objectives: [{ id: '90', label: 'O-巡检上线 · 林晓' }], projects: [{ id: '12', name: '园区巡检' }],
    writer: true, mobile: false, busy: false, supersede: false, form: { title: '', detail: '', rationale: '', impact: '', objectiveId: '', projectId: '', decidedAt: new Date() }, error: '', submit() {}, reset() {},
    ...over
  })
  test('记: 标题 / 背景(必填) / 理由 / 影响 / 挂到 O / 项目 / 决策时间', async () => {
    const html = await renderView(render, base())
    for (const k of ['dec-title', 'dec-detail', 'dec-rationale', 'dec-impact', 'dec-objective', 'dec-project', 'dec-decided-at']) assert.ok(html.includes(`data-test="${k}"`), k)
    assert.equal(count(html, 'class="req"'), 2)
    has(html, 'O-巡检上线 · 林晓')
    lacks(html, t('okr.fe5.dec_f_objective_engineer'))
    const eng = await renderView(render, base({ writer: false }))
    has(eng, t('okr.fe5.dec_f_objective_engineer'))
  })
  test('取代: 显示被取代的老标题, 不出 O / 项目(后端继承); 错误文案显示在框里', async () => {
    const html = await renderView(render, base({ mode: 'supersede', supersede: true, old: dec(), error: '只有管理员 / 主管能取代决策' }))
    has(html, t('okr.fe5.dec_supersede_old', { p0: '巡检改两周一次' }))
    assert.ok(!html.includes('data-test="dec-objective"'))
    assert.match(html, /data-test="dec-error">只有管理员 \/ 主管能取代决策</)
  })
})

// ---------------------------------------------------------------- 三、连续未达成预警

const risk = (over = {}) => ({
  objectiveId: '101', currentObjectiveId: '201', week: '2026-W46', title: 'O-巡检上线', ownerId: '7', ownerName: '林晓',
  consecutiveMissedWeeks: 3, level: 'CRITICAL', lastWeekRate: 0.3, hasOverdueBlocker: false,
  weeklyRates: [
    { week: '2026-W43', rate: 0.9, missed: false }, { week: '2026-W44', rate: 0.4, missed: true },
    { week: '2026-W45', rate: null, missed: true }, { week: '2026-W46', rate: 0.3, missed: true }
  ],
  ...over
})

describe('连续未达成: 纯函数', () => {
  test('O id → 预警: 当前周和已结束周的 O 都挂上; 卡片点只在 ≥2 周出', () => {
    const m = riskByObjective([risk(), risk({ objectiveId: '102', currentObjectiveId: null, consecutiveMissedWeeks: 2, level: 'WARN' })])
    assert.deepEqual(streakOf(m, { id: 201 }), { n: 3, level: 'CRITICAL' })
    assert.deepEqual(streakOf(m, { id: '101' }), { n: 3, level: 'CRITICAL' })
    assert.deepEqual(streakOf(m, { id: '102' }), { n: 2, level: 'WARN' })
    assert.equal(streakOf(m, { id: '999' }), null)
    assert.equal(streakOf(riskByObjective([risk({ consecutiveMissedWeeks: 1, level: 'WARN' })]), { id: '101' }), null)
    assert.equal(streakOf(null, { id: '1' }), null)
    assert.equal(levelOf('NONE'), '')
  })
  test('我的 OKR 红 / 黄条: 只要这个人的, CRITICAL 在前', () => {
    const items = [risk({ objectiveId: 'w', level: 'WARN', consecutiveMissedWeeks: 2 }), risk({ objectiveId: 'x', ownerId: '8' }), risk({ objectiveId: 'c' })]
    assert.deepEqual(myRiskBars(items, '7').map(i => i.objectiveId), ['c', 'w'])
    assert.deepEqual(myRiskBars(items, 7).length, 2)
    assert.deepEqual(myRiskBars(items, '9'), [])
  })
  test('团队页一行字直接用后端 summary', () => {
    assert.deepEqual(riskSummaryCounts({ critical: 1, warn: 1 }), { total: 2, critical: 1, warn: 1 })
    assert.deepEqual(riskSummaryCounts(undefined), { total: 0, critical: 0, warn: 0 })
    assert.equal(t('okr.fe5.risk_team', { p0: 2, p1: 1 }), '2 O missed in a row (1 red line)')
  })
  test('最近三周小条形: 老 → 新, 没 O 的周为 null', () => {
    assert.deepEqual(recentRates(risk()).map(r => [r.week, r.pct, r.missed]), [['2026-W44', 40, true], ['2026-W45', null, true], ['2026-W46', 30, true]])
    assert.deepEqual(recentRates({}), [])
  })
  test('「看看」目标: 先认 id(当前周 / 已结束周), 再认同标题(后端串线口径)', () => {
    assert.equal(findRiskTarget([{ id: '5', title: 'x' }, { id: '201', title: 'y' }], risk()), '201')
    assert.equal(findRiskTarget([{ id: '101', title: 'y' }], risk()), '101')
    assert.equal(findRiskTarget([{ id: '9', title: '  o-巡检上线 ' }], risk()), '9')
    assert.equal(findRiskTarget([{ id: '9', title: '别的' }], risk()), null)
    assert.equal(findRiskTarget([], null), null)
  })
})

describe('连续未达成: 组件', () => {
  test('我的 OKR 红条: CRITICAL 红 / WARN 黄, 文案「X」已连续 N 周未达成 +「看看」; 最多 3 条', async () => {
    const render = compileView('components/okr/OkrRiskBars.vue')
    const bars = [risk(), risk({ objectiveId: '2', title: 'O-文档', level: 'WARN', consecutiveMissedWeeks: 2 })]
    const st = (over = {}) => ({ bars, compact: false, max: 3, sheet: null, shown: (over.bars || bars).slice(0, 3), barText: b => t('okr.fe5.risk_bar', { p0: b.title, p1: b.consecutiveMissedWeeks }), rates: b => recentRates(b, 4), lookFromSheet() {}, ...over })
    const html = await renderView(render, st(), { 'el-drawer': pass })
    assert.equal(count(html, 'data-test="okr-risk-bar-CRITICAL"'), 1)
    assert.equal(count(html, 'data-test="okr-risk-bar-WARN"'), 1)
    has(html, t('okr.fe5.risk_bar', { p0: 'O-巡检上线', p1: 3 }))
    assert.equal(t('okr.fe5.risk_bar', { p0: 'A', p1: 3 }), '"A" missed 3 weeks in a row')
    assert.equal(count(html, 'data-test="okr-risk-look"'), 2)
    assert.ok(!html.includes('data-test="okr-risk-detail"'))
    const five = Array.from({ length: 5 }, (_, i) => risk({ objectiveId: String(i) }))
    const many = await renderView(render, st({ bars: five, shown: five.slice(0, 3) }), { 'el-drawer': pass })
    assert.equal(count(many, 'class="okr-rbar lv-'), 3)
    has(many, t('okr.fe5.risk_more', { p0: 2 }))
  })
  test('手机: 标题一行省略号 + 右侧「详情」进弹层(不挤成三行)', async () => {
    const render = compileView('components/okr/OkrRiskBars.vue')
    const bars = [risk()]
    const html = await renderView(render, { bars, compact: true, max: 3, sheet: bars[0], shown: bars, barText: b => b.title, rates: b => recentRates(b, 4), lookFromSheet() {} }, { 'el-drawer': pass })
    assert.equal(count(html, 'data-test="okr-risk-detail"'), 1)
    assert.ok(!html.includes('data-test="okr-risk-look"'))
    assert.ok(html.includes('data-test="okr-risk-sheet"'), '详情弹层')
    has(html, '2026-W46')
    const css = src('components/okr/OkrRiskBars.vue')
    assert.match(css, /\.okr-rbar-text \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
    assert.match(css, /\.okr-rbar-btn \{[^}]*flex: none;[^}]*white-space: nowrap;/)
  })
  test('团队页面板: 「N 个 O 连续未达成(M 红线)」用 summary; 展开列 O / 负责人 / 连续周数 / 三周小条形; 没有就不出', async () => {
    const render = compileView('components/okr/OkrRiskPanel.vue')
    const data = { summary: { critical: 1, warn: 1 }, items: [risk(), risk({ objectiveId: '2', title: 'O-文档', ownerName: '周舟', level: 'WARN', consecutiveMissedWeeks: 2 })] }
    const st = (over = {}) => ({ risk: data, open: true, counts: riskSummaryCounts(data.summary), items: data.items, recentRates, rateLabel: it => recentRates(it, 3).map(r => (r.pct == null ? '-' : r.pct + '%')).join(' → '), ...over })
    const html = await renderView(render, st())
    assert.match(html, /data-test="okr-risk-summary">2 O missed in a row \(1 red line\)</)
    assert.equal(count(html, 'data-test="okr-risk-row-'), 2)
    has(html, '林晓')
    has(html, t('okr.fe5.risk_weeks_n', { p0: 3 }))
    assert.equal(count(html, 'class="okr-rbar3"'), 6)
    has(html, '40% → - → 30%')
    const closed = await renderView(render, st({ open: false }))
    assert.ok(!closed.includes('data-test="okr-risk-row-'))
    const none = await renderView(render, st({ counts: riskSummaryCounts({ critical: 0, warn: 0 }), items: [] }))
    assert.ok(!none.includes('data-test="okr-risk-panel"'))
  })
})

// ---------------------------------------------------------------- 页面 / 卡片接线

const card = compileView('components/okr/OkrObjectiveCard.vue')
const cardState = (obj, over = {}) => ({
  obj, canEdit: false, canMiss: false, canManagerScore: false, canComplete: false, closed: false, krBusy: '', busy: false,
  open: false, form: { krId: '' }, mScore: null, mComment: '', hasPanel: false, toggleText: '', pickedKr: null, showActs: false, actsDisabled: true,
  OBJ_TAG, pct, krValueText, round: n => n, shDate: s => s, toggle() {}, send() {}, complete() {},
  today: '2026-11-21', milestoneRows: () => [], overdueDays: () => 0, msClickable: false, clickMilestone() {},
  blkOpen: false, blkEditing: false, blkBusy: false, blk: {}, blkState: 'empty', canEditBlocker: false, people: [], compact: false, startBlk() {}, saveBlk() {}, RISK_LEVELS: [],
  streak: null, decisions: decisionBriefs(obj), decOpen: false,
  ...over
})
const cobj = (over = {}) => ({ id: '201', seq: 1, title: 'O-巡检上线', weight: 100, status: 'AT_RISK', progress: 0.3, submittedAt: 'x', keyResults: [], ...over })

describe('O 卡片: 连续未达成点 + 决策折叠区', () => {
  test('右上红 / 黄点 + 悬浮「连续 N 周未达成」; 没有就不出', async () => {
    const red = await renderView(card, cardState(cobj(), { streak: { n: 3, level: 'CRITICAL' } }), { 'el-tooltip': true })
    assert.ok(red.includes('data-test="okr-streak-CRITICAL"'))
    has(red, t('okr.fe5.risk_dot', { p0: 3 }))
    assert.equal(t('okr.fe5.risk_dot', { p0: 2 }), 'Missed 2 weeks in a row')
    const yellow = await renderView(card, cardState(cobj(), { streak: { n: 2, level: 'WARN' } }), { 'el-tooltip': true })
    assert.ok(yellow.includes('data-test="okr-streak-WARN"'))
    const none = await renderView(card, cardState(cobj()), { 'el-tooltip': true })
    assert.ok(!none.includes('data-test="okr-streak-'))
  })
  test('有决策: 底部「决策 N 条」折叠, 展开是标题 + 日期 + 决策人; 没决策不出', async () => {
    const o = cobj({ decisions: [{ id: '5', title: '巡检改每周一次', decidedAt: '2026-11-21T02:00:00Z', decidedByName: '老板', status: 'ACTIVE' }, { id: '1', title: '巡检改两周一次', decidedAt: '2026-11-20T02:00:00Z', decidedByName: '老板', status: 'SUPERSEDED' }] })
    const closed = await renderView(card, cardState(o), { 'el-tooltip': true })
    has(closed, t('okr.fe5.dec_card_n', { p0: 2 }))
    lacks(closed, '巡检改每周一次')
    const open = await renderView(card, cardState(o, { decOpen: true }), { 'el-tooltip': true })
    has(open, '巡检改每周一次')
    has(open, '2026-11-21 · 老板')
    assert.match(open, /<li class="off">/, '被取代的灰掉')
    const none = await renderView(card, cardState(cobj()), { 'el-tooltip': true })
    assert.ok(!none.includes('data-test="okr-card-decisions"'))
  })
})

describe('页面接线: 我的 OKR / 团队 OKR', () => {
  test('我的 OKR: 页头右侧导出 + 顶部红条组件 + O 卡带 id 与 streak', () => {
    const s = src('views/okr/MyOkr.vue')
    assert.match(s, /<span class="okr-top-right">[\s\S]*<OkrExportMenu :items="exportMenu" \/>/)
    assert.match(s, /<OkrRiskBars :bars="riskBars" :compact="isMobile" @look="lookRisk" \/>/)
    assert.match(s, /:id="'okr-obj-' \+ o\.id"/)
    assert.match(s, /:streak="streakOf\(riskMap, o\)"/)
    assert.match(s, /exportItems\(\{ page: 'mine', user: me, week: weekKeyNow\.value, userId: ownerId\.value \|\| meId \}\)/)
    assert.ok(s.indexOf('<OkrRiskBars') < s.indexOf('<OkrWeekBar'), '在页面顶部')
  })
  test('团队 OKR: 风险面板只给 ADMIN / MANAGER, 在周进度条上方; 导出含团队项; 按项目块头导出', () => {
    const s = src('views/okr/TeamOkr.vue')
    assert.match(s, /<OkrRiskPanel v-if="lead" :risk="risk" @open="openRisk" \/>/)
    assert.ok(s.indexOf('<OkrRiskPanel') < s.indexOf('<OkrWeekStatus'), '在周进度条上方')
    assert.match(s, /exportItems\(\{ page: 'team'/)
    assert.match(s, /<OkrExportMenu v-if="projectExport\(g\.head\)\.length"/)
    assert.match(s, /async function loadRisk\(\) \{\s*if \(!lead\) return/, '工程师不拉团队预警')
  })
  test('API: 预警 / 决策接口路径与后端一致', () => {
    const s = src('api/index.js')
    for (const p of ["'/api/okr/risk/objectives?'", "'/api/okr/decisions/timeline?'", "`/api/okr/decisions/${encodeURIComponent(id)}/supersede`", "method: 'PATCH'"]) assert.ok(s.includes(p), p)
  })
  test('中英文 key 一致(fe5 段)', () => {
    const zh = JSON.parse(src('locales/zh-CN.json')).okr.fe5
    const en = JSON.parse(src('locales/en.json')).okr.fe5
    const keys = o => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v).map(x => k + '.' + x) : [k])).sort()
    assert.deepEqual(keys(zh), keys(en))
    assert.equal(zh.risk_bar, '「{p0}」已连续 {p1} 周未达成')
    assert.equal(zh.risk_team, '{p0} 个 O 连续未达成（{p1} 红线）')
  })
})
