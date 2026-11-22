// OKR 前端第五批: 导出 / 连续未达成预警(决策记录、按项目导出、团队页风险面板随精简第二轮下线, 对应用例删除)。
// 纯函数直接测; 组件用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import * as fe5 from '../../src/views/okr/okrFe5.js'
import { OBJ_TAG, pct, krValueText } from '../../src/views/okr/okrUtils.js'

const {
  mayExportTeam, exportItems, exportUrl, fileNameFromDisposition, downloadExport, fileSizeText,
  levelOf, riskByObjective, streakOf, myRiskBars, recentRates, findRiskTarget
} = fe5
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
  test('精简第二轮: 导出下拉最多 3 项(Excel 明细 / Word 汇报 / 团队 Excel), 没有项目导出', () => {
    const items = exportItems({ page: 'team', user: ADMIN, week: '2026-W47', project: { id: 12, name: '园区巡检' } })
    assert.deepEqual(items.map(i => i.key), ['xlsx', 'docx', 'team'], '传了 project 也不变')
    assert.ok(items.every(i => i.params.scope !== 'project' && !('projectId' in i.params)))
    assert.equal(fe5.projectExportItems, undefined)
    for (const u of [ADMIN, MGR, ENG, LEAD]) for (const page of ['mine', 'team']) assert.ok(exportItems({ page, user: u, week: '2026-W47' }).length <= 3)
  })
  test('地址: 空值不带', () => {
    assert.equal(exportUrl({ week: '2026-W47', scope: 'person', format: 'xlsx', userId: '7', projectId: '12' }), '/api/okr/export?week=2026-W47&scope=person&format=xlsx&userId=7', 'projectId 不再透传')
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

// ---------------------------------------------------------------- 二、决策记录(已下线)

test('决策记录下线: 纯函数 / 页面 / 弹窗都删了', async () => {
  for (const k of ['defaultDecisionRange', 'filterDecisions', 'decisionRow', 'missingSupersederIds', 'decisionMenu', 'revertPayload', 'decisionPayload', 'decisionStats', 'objectiveOptions', 'decisionBriefs', 'riskSummaryCounts']) {
    assert.equal(fe5[k], undefined, k)
  }
  const { existsSync } = await import('node:fs')
  for (const f of ['views/okr/OkrDecisions.vue', 'components/okr/OkrDecisionDialog.vue', 'components/okr/OkrRiskPanel.vue']) {
    assert.ok(!existsSync(new URL(`../../src/${f}`, import.meta.url)), f)
  }
})

// ---------------------------------------------------------------- 三、连续未达成预警(我的 OKR 顶部红条 + O 卡红黄点保留)

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
})

// ---------------------------------------------------------------- 页面 / 卡片接线

const card = compileView('components/okr/OkrObjectiveCard.vue')
const cardState = (obj, over = {}) => ({
  obj, canEdit: false, canMiss: false, canManagerScore: false, canComplete: false, closed: false, krBusy: '', busy: false,
  open: false, form: { krId: '' }, mScore: null, mComment: '', hasPanel: false, toggleText: '', pickedKr: null, showActs: false, actsDisabled: true,
  OBJ_TAG, pct, krValueText, round: n => n, shDate: s => s, toggle() {}, send() {}, complete() {},
  today: '2026-11-21', milestoneRows: () => [], overdueDays: () => 0, msClickable: false, clickMilestone() {},
  blkOpen: false, blkEditing: false, blkBusy: false, blk: {}, blkState: 'empty', canEditBlocker: false, people: [], compact: false, startBlk() {}, saveBlk() {}, RISK_LEVELS: [],
  streak: null,
  ...over
})
const cobj = (over = {}) => ({ id: '201', seq: 1, title: 'O-巡检上线', weight: 100, status: 'AT_RISK', progress: 0.3, submittedAt: 'x', keyResults: [], ...over })

describe('O 卡片: 连续未达成点', () => {
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
  test('团队 OKR: 导出含团队项; 没有风险面板 / 项目块导出(精简第二轮), 也不再拉团队预警', () => {
    const s = src('views/okr/TeamOkr.vue')
    assert.match(s, /exportItems\(\{ page: 'team'/)
    assert.doesNotMatch(s, /OkrRiskPanel|projectExport|riskObjectives/)
  })
  test('API: 预警接口路径与后端一致; 决策接口已删', () => {
    const s = src('api/index.js')
    assert.ok(s.includes("'/api/okr/risk/objectives?'"))
    assert.ok(!s.includes('/api/okr/decisions'))
  })
  test('中英文 key 一致(fe5 段)', () => {
    const zh = JSON.parse(src('locales/zh-CN.json')).okr.fe5
    const en = JSON.parse(src('locales/en.json')).okr.fe5
    const keys = o => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v).map(x => k + '.' + x) : [k])).sort()
    assert.deepEqual(keys(zh), keys(en))
    assert.equal(zh.risk_bar, '「{p0}」已连续 {p1} 周未达成')
  })
})
