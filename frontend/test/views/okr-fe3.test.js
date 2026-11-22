// OKR 前端第三批: 周状态与催交(团队页顶部)。
// 精简第二轮: 项目周 OKR / 独立每日总结页 / 按项目分组 / O 选项目随页面下线, 对应用例删除; 末尾一组确认这些痕迹都没了。
// 纯函数直接测; 页面用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import * as fe3 from '../../src/views/okr/okrFe3.js'
import { pct, OBJ_TAG, krValueText, toDraft } from '../../src/views/okr/okrUtils.js'

const { weekProgress, statusCells, mergeReminded, skippedByReason } = fe3
const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)
const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------- 三、周状态与催交

const wrow = (id, name, over = {}) => ({
  user: { id, name }, planSubmitted: true, lateSubmit: false, objectiveCount: 2,
  selfScored: { done: 2, total: 2 }, managerScored: { done: 0, total: 2 }, exempt: false, dailySummaries: 3, missing: [], complete: true, ...over
})

describe('周状态: 纯函数', () => {
  test('进度三个数取后端 summary(分母 = 应交人数, 免提交不算)', () => {
    const p = weekProgress({ summary: { expected: 6, planSubmitted: 4, selfScoredAll: 3, managerScoredAll: 1, exempt: 1, incomplete: 2 } })
    assert.deepEqual(p, { total: 6, plan: 4, self: 3, mgr: 1, exempt: 1, incomplete: 2 })
    assert.deepEqual(weekProgress(null), { total: 0, plan: 0, self: 0, mgr: 0, exempt: 0, incomplete: 0 })
  })
  test('每格未完成标红; 计划没交时自评 / 主管分也算没完成; 免提交整行不标红', () => {
    const c = statusCells(wrow('1', 'a'))
    assert.deepEqual([c.plan.bad, c.self.bad, c.mgr.bad, c.daily.bad], [false, false, true, false])
    assert.equal(c.self.text, '2/2')
    assert.equal(c.mgr.text, '0/2')
    const none = statusCells(wrow('2', 'b', { planSubmitted: false, objectiveCount: 0, selfScored: { done: 0, total: 0 }, managerScored: { done: 0, total: 0 }, dailySummaries: 0 }))
    assert.deepEqual([none.plan.bad, none.self.bad, none.mgr.bad, none.daily.bad], [true, true, true, true])
    assert.equal(none.self.text, '-')
    const ex = statusCells(wrow('3', 'c', { exempt: true, planSubmitted: false, dailySummaries: 0 }))
    assert.deepEqual([ex.plan.bad, ex.self.bad, ex.mgr.bad, ex.daily.bad], [false, false, false, false])
    assert.equal(statusCells(wrow('4', 'd', { lateSubmit: true })).plan.late, true)
  })
  test('催交返回: 催到的人并进已提醒集合; 跳过的按原因计数', () => {
    const res = { reminded: [{ user: { id: '1' } }, { user: { id: '2' } }], skipped: [{ user: { id: '3' }, reason: 'RECENTLY_REMINDED' }, { id: '9', reason: 'OUT_OF_SCOPE' }, { user: { id: '4' }, reason: 'RECENTLY_REMINDED' }] }
    assert.deepEqual([...mergeReminded(new Set(['7']), res)].sort(), ['1', '2', '7'])
    assert.deepEqual(skippedByReason(res), { RECENTLY_REMINDED: 2, OUT_OF_SCOPE: 1 })
    assert.deepEqual([...mergeReminded(null, {})], [])
  })
})

describe('周状态条(团队页顶部)', () => {
  const render = compileView('components/okr/OkrWeekStatus.vue')
  const status = {
    cycle: { status: 'IN_PROGRESS' },
    summary: { expected: 2, planSubmitted: 1, selfScoredAll: 1, managerScoredAll: 0, exempt: 1, incomplete: 1 },
    rows: [wrow('1', '林晓', { planSubmitted: false, selfScored: { done: 0, total: 0 }, managerScored: { done: 0, total: 0 }, complete: false }), wrow('2', '周舟'), wrow('3', '老板', { exempt: true })]
  }
  const base = (over = {}) => ({ status, open: false, reminding: false, reminded: new Set(), prog: weekProgress(status), closed: false, cells: statusCells, remind: () => {}, ...over })

  test('收起: 一条「已提交 1/2 · 已自评 1/2 · 已打分 0/2」+ 免提交人数 + 催交(带未完成人数)', async () => {
    const html = await renderView(render, base())
    has(html, `${t('okr.wstatus.plan', { p0: 1, p1: 2 })} · ${t('okr.wstatus.self', { p0: 1, p1: 2 })} · ${t('okr.wstatus.mgr', { p0: 0, p1: 2 })}`)
    has(html, t('okr.wstatus.exempt_n', { p0: 1 }))
    assert.match(html.replace(/<!--[^>]*-->/g, ''), new RegExp(`${t('okr.wstatus.remind')} \\(1\\)`))
    lacks(html, 'data-test="wst-table"')
  })

  test('展开: 每人一行, 未完成格标红, 免提交行出灰标签不出数, 刚催过的行标「已提醒」', async () => {
    const html = await renderView(render, base({ open: true, reminded: new Set(['1']) }))
    assert.ok(html.includes('data-test="wst-table"'))
    assert.ok(/data-test="wst-row-1"[^>]*/.test(html))
    assert.match(html, /class="wst-row reminded"[^>]*data-test="wst-row-1"/)
    assert.match(html, /class="wst-row exempt"[^>]*data-test="wst-row-3"/)
    assert.equal((html.match(/data-test="wst-exempt"/g) || []).length, 1)
    assert.equal((html.match(/data-test="wst-reminded"/g) || []).length, 1)
    has(html, t('okr.wstatus.exempt_hint'))
    assert.ok((html.match(/class="bad"/g) || []).length >= 3, '林晓的计划 / 自评 / 主管分标红')
  })
})

// ---------------------------------------------------------------- 精简第二轮: 子项目维度的痕迹都没了

describe('精简第二轮: 去掉子项目维度', () => {
  test('O 卡: 挂了项目也不出项目标签行; 不出决策折叠区', async () => {
    const render = compileView('components/okr/OkrObjectiveCard.vue')
    const obj = {
      id: '1', seq: 1, title: 'O-巡检上线', status: 'ON_TRACK', progress: 0.5, weight: 100, submittedAt: '2026-11-16T02:00:00Z',
      projects: [{ id: '7', name: '园区巡检', code: 'P-7' }], decisions: [{ id: '3', title: '巡检两周一次', status: 'ACTIVE' }],
      keyResults: [{ id: '11', seq: 1, title: '二期验收', metricType: 'BINARY', weight: 100, status: 'TODO' }]
    }
    const html = await renderView(render, {
      obj, canEdit: false, canMiss: false, canManagerScore: false, canComplete: false, closed: false, krBusy: '', busy: false,
      open: false, form: { krId: '' }, mScore: null, mComment: '', hasPanel: false, toggleText: '', pickedKr: null, showActs: false, actsDisabled: true,
      OBJ_TAG, pct, krValueText, round: n => n, shDate: s => s, toggle() {}, send() {}, complete() {}
    }, { 'el-tooltip': true })
    has(html, 'O-巡检上线')
    has(html, '二期验收')
    assert.ok(!html.includes('园区巡检'), '不出项目名')
    assert.ok(!html.includes('okr-card-projects') && !html.includes('okr-card-decisions'))
    assert.doesNotMatch(src('components/okr/OkrObjectiveCard.vue'), /obj\.projects|decisionBriefs|\/admin\/okr\/decisions/)
  })
  test('我的 OKR 编辑器: 没有「所属项目」多选, 提交不带 projectIds(后端没收到 = 不动已有关联), 也不再拉项目列表', () => {
    const ed = src('components/okr/OkrPlanEditor.vue')
    assert.doesNotMatch(ed, /projectIds:|o\.projectIds|okr-ed-projects|pick_projects|fde\.projects\.list/)
    const d = toDraft([{ id: '1', title: 'A', weight: 100, status: 'ON_TRACK', projects: [{ id: 7, name: '园区' }], keyResults: [] }])
    assert.ok(!('projectIds' in d[0]) && !('projects' in d[0]))
  })
  test('团队 OKR 页: 没有「按人 / 按项目」切换和项目块, 只按人; 不再取 /by-project', () => {
    const team = src('views/okr/TeamOkr.vue')
    assert.doesNotMatch(team, /okr-team-mode|by_project|okr-by-project|byProject|OkrRiskPanel|projectExport/)
    assert.match(team, /data-test="okr-team-table"/)
  })
  test('okrFe3 只剩周状态 + 两个每日总结小函数; 项目 / 分组 / 每日总结页的函数已删', () => {
    for (const k of ['canEditProjectDoc', 'projectLabel', 'projectDocFileProblem', 'firstHeading', 'weekKeyOfDate', 'dailyMissingRows', 'dailyRemindText', 'groupHead', 'orderGroups', 'byOwner', 'projectOptions']) {
      assert.equal(fe3[k], undefined, k)
    }
    assert.equal(typeof fe3.todayKey, 'function')
    assert.equal(fe3.summaryText({ summary: { summaryMd: 'x' } }), 'x')
  })
  test('API 与文案: 项目文档 / 按项目 / 决策接口方法已删, 中英文对应段也删了', async () => {
    const api = src('api/index.js')
    for (const m of ['projectDocs', 'projectDoc', 'saveProjectDoc', 'importProjectDoc', 'byProject: (week)', 'decisions:', 'decisionTimeline', 'createDecision', 'patchDecision', 'supersedeDecision', 'projectObjectives', 'dailyMissing']) {
      assert.ok(!api.includes(m), m)
    }
    for (const loc of ['zh-CN', 'en']) {
      const j = JSON.parse(src(`locales/${loc}.json`))
      for (const k of ['proj', 'daily', 'byproj']) assert.equal(j.okr[k], undefined, `${loc} okr.${k}`)
      assert.ok(!Object.keys(j.okr.fe5).some(k => k.startsWith('dec_') || k.startsWith('export_project')), `${loc} okr.fe5 决策 / 项目导出`)
      for (const k of ['project_okr', 'daily_summary', 'decisions', 'team_load', 'team_promise']) assert.equal(j.nav[k], undefined, `${loc} nav.${k}`)
    }
  })
})
