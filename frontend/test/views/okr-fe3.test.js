// OKR 前端第三批: 项目周 OKR / 每日总结 / 周状态与催交 / 按项目分组 / O 选项目。
// 纯函数直接测; 页面用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  isLead, canEditProjectDoc, projectLabel, projectDocFileProblem, PROJECT_DOC_MAX, firstHeading,
  todayKey, weekKeyOfDate, dailyMissingRows, dailyRemindText, summaryText,
  weekProgress, statusCells, mergeReminded, skippedByReason,
  groupHead, orderGroups, byOwner, projectOptions
} from '../../src/views/okr/okrFe3.js'
import { pct, OBJ_TAG, krValueText, toDraft } from '../../src/views/okr/okrUtils.js'
import { readFileSync } from 'node:fs'
import { initialOf, mayProxyRow } from '../../src/views/okr/okrPeople.js'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)

// ---------------------------------------------------------------- 一、项目周 OKR

describe('项目周 OKR: 写权限与后端 canWriteProjectDoc 同口径', () => {
  test('ADMIN / MANAGER 不看项目详情也能写', () => {
    assert.equal(isLead({ role: 'ADMIN' }), true)
    assert.equal(isLead({ role: 'MANAGER' }), true)
    assert.equal(isLead({ role: 'TEAM_LEAD' }), false)
    assert.equal(canEditProjectDoc({ id: 1, role: 'MANAGER' }, null), true)
  })
  test('其他人: 项目经理 / user 直挂成员 / engineer.user 老数据成员可写; 拿不到详情不可写', () => {
    const me = { id: '38', role: 'FDE_ENGINEER' }
    assert.equal(canEditProjectDoc(me, null), false)
    assert.equal(canEditProjectDoc(me, { manager: { id: 38 }, members: [] }), true)
    assert.equal(canEditProjectDoc(me, { managerId: '9', members: [{ user: { id: '38' } }] }), true)
    assert.equal(canEditProjectDoc(me, { managerId: '9', members: [{ user: null, engineer: { user: { id: 38 } } }] }), true)
    assert.equal(canEditProjectDoc(me, { managerId: '9', members: [{ user: { id: '39' } }] }), false)
    assert.equal(canEditProjectDoc({ role: 'FDE_ENGINEER' }, { members: [{ user: { id: '38' } }] }), false, '没登录信息不放行')
  })
  test('项目名 · 编号; 上传只认 md/txt/docx ≤ 2MB', () => {
    assert.equal(projectLabel({ name: '智慧园区', code: 'P-001' }), '智慧园区 · P-001')
    assert.equal(projectLabel({ name: '智慧园区', code: null }), '智慧园区')
    assert.equal(projectDocFileProblem({ name: 'w48.md', size: 10 }), '')
    assert.equal(projectDocFileProblem({ name: 'W48.DOCX', size: 10 }), '')
    assert.equal(projectDocFileProblem({ name: 'a.txt', size: 10 }), '')
    assert.equal(projectDocFileProblem({ name: 'a.pdf', size: 10 }), 'type')
    assert.equal(projectDocFileProblem({ name: 'a.md', size: PROJECT_DOC_MAX + 1 }), 'size')
    assert.equal(projectDocFileProblem(null), 'empty')
  })
  test('上传 .md 取正文第一个标题当标题', () => {
    assert.equal(firstHeading('前言\n\n## 电梯导轨 · W47 ##\n# 第二个'), '电梯导轨 · W47')
    assert.equal(firstHeading('没有标题\n- 列表'), '')
    assert.equal(firstHeading('#不是标题'), '')
  })
})

describe('项目周 OKR 页', () => {
  const render = compileView('views/okr/ProjectOkr.vue')
  const row = (id, name, over = {}) => ({ project: { id, name, code: 'P-' + id }, hasDoc: false, title: null, updatedAt: null, updatedBy: null, ...over })
  const base = (over = {}) => ({
    projectId: '', list: null, detail: null, canEdit: false, uploading: false, saving: false, fileInput: null, isMobile: false,
    week: '2026-W48', weekParts: { year: 2026, weekNo: 48 }, range: { start: null, end: null }, html: '',
    edit: { open: false, title: '', content: '' },
    projectLabel, shift: () => {}, pickProject: () => {}, openEdit: () => {}, save: () => {}, onFile: () => {},
    metaText: d => `${d.updatedBy?.name} @ ${d.updatedAt}`,
    ...over
  })
  const extra = { OkrWeekBar: true }

  test('全部项目: 汇总数 + 每个项目一行, 没文档的标「本周还没有」; 不出编辑按钮', async () => {
    const html = await renderView(render, base({
      list: { week: '2026-W48', total: 2, withDoc: 1, rows: [row('1', '园区', { hasDoc: true, title: 'W48 园区 OKR', updatedAt: 'x', updatedBy: { name: '林晓' } }), row('2', '仓储')] }
    }), extra)
    has(html, t('okr.proj.summary', { p0: 1, p1: 2 }))
    has(html, 'W48 园区 OKR')
    has(html, '林晓 @ x')
    has(html, t('okr.proj.none_short'))
    lacks(html, 'data-test="pokr-edit"')
    lacks(html, 'data-test="pokr-upload"')
  })

  test('单个项目有文档: 标题 + 来源文件 + 渲染后的 HTML; 有写权限才出上传 / 编辑', async () => {
    const detail = { project: { id: '1', name: '园区' }, hasDoc: true, doc: { title: 'W48 园区 OKR', contentMd: '# x', sourceFile: 'w48.md', updatedAt: 'x', updatedBy: { name: '林晓' } } }
    const ro = await renderView(render, base({ projectId: '1', detail, html: '<h1>本周目标</h1><ul><li>O1</li></ul>' }), extra)
    assert.ok(ro.includes('<h1>本周目标</h1><ul><li>O1</li></ul>'), 'v-html 原样出')
    has(ro, t('okr.proj.from_file', { p0: 'w48.md' }))
    assert.ok(!ro.includes('data-test="pokr-edit"'), '只读的人看不到编辑')
    const rw = await renderView(render, base({ projectId: '1', detail, canEdit: true }), extra)
    assert.ok(rw.includes('data-test="pokr-edit"'))
    assert.ok(rw.includes('data-test="pokr-upload"'))
  })

  test('单个项目没文档: 空态文案带项目名; 有权限才出「上传 / 直接粘贴」', async () => {
    const detail = { project: { id: '2', name: '仓储' }, hasDoc: false, doc: null }
    const ro = await renderView(render, base({ projectId: '2', detail }), extra)
    has(ro, t('okr.proj.empty', { p0: '仓储' }))
    lacks(ro, t('okr.proj.paste'))
    const rw = await renderView(render, base({ projectId: '2', detail, canEdit: true }), extra)
    has(rw, t('okr.proj.paste'))
  })
})

// ---------------------------------------------------------------- 二、每日总结

describe('每日总结: 纯函数', () => {
  test('今天按上海时区; 日期 → ISO 周', () => {
    assert.equal(todayKey(new Date('2026-11-21T15:59:00Z')), '2026-11-21')
    assert.equal(todayKey(new Date('2026-11-21T16:01:00Z')), '2026-11-22', '上海已过零点')
    assert.equal(weekKeyOfDate('2026-11-23'), '2026-W48')
    assert.equal(weekKeyOfDate('2026-11-29'), '2026-W48')
    assert.equal(weekKeyOfDate('2027-01-01'), '2026-W53')
    assert.equal(weekKeyOfDate('bad'), '')
  })
  test('「未写」名单与后端 dailyMissing 同口径: 有 OKR 且没写', () => {
    const v = { rows: [
      { user: { id: '1', name: '林晓' }, hasOkr: true, hasWritten: false },
      { user: { id: '2', name: '周舟' }, hasOkr: true, hasWritten: true },
      { user: { id: '3', name: '老王' }, hasOkr: false, hasWritten: false }
    ] }
    assert.deepEqual(dailyMissingRows(v).map(r => r.user.id), ['1'])
    assert.deepEqual(dailyMissingRows(null), [])
    const text = dailyRemindText(dailyMissingRows(v), '2026-11-21', t)
    assert.ok(text.includes('@林晓') && text.includes('2026-11-21'))
    assert.equal(summaryText({ summary: { summaryMd: '写了' } }), '写了')
    assert.equal(summaryText({ summary: null }), '')
  })
})

describe('每日总结页', () => {
  const render = compileView('views/okr/DailySummary.vue')
  const item = (text) => ({ text })
  const mk = (id, name, over = {}) => ({ user: { id, name, role: 'FDE_ENGINEER' }, hasOkr: true, autoItems: [], summary: null, hasWritten: false, ...over })
  const base = (over = {}) => ({
    date: '2026-11-21', scope: 'team', isToday: true, lead: false, loading: false, busy: '', drafts: {},
    view: null, rows: [], missing: [],
    setQuery: () => {}, remind: () => {}, save: () => {}, initialOf: n => n?.[0] || '?',
    editable: () => false, dirty: () => false, timeOf: () => '10:00',
    ...over
  })

  test('团队视图: 每人一张卡; 没写的出「未写」; 没进展的出「今天没有 OKR 进展」; 写了的只读展示原文', async () => {
    const rows = [
      mk('1', '林晓', { autoItems: [item('O1「上线」· KR1「接口」：0 → 2')] }),
      mk('2', '周舟', { hasWritten: true, summary: { summaryMd: '联调完成', updatedAt: 'x' } })
    ]
    const html = await renderView(render, base({ view: { summary: { people: 2, written: 1, withProgress: 1 }, rows }, rows }))
    has(html, '林晓')
    has(html, 'O1「上线」· KR1「接口」：0 → 2')
    assert.equal((html.match(/data-test="dsum-unwritten"/g) || []).length, 1, '只有林晓未写')
    has(html, t('okr.daily.no_progress'))
    has(html, '联调完成')
    has(html, t('okr.daily.summary_line', { p0: 1, p1: 2, p2: 1 }))
    lacks(html, 'data-test="dsum-lead"')
  })

  test('主管 · 团队: 顶部「今天 N 人未写」+ 名单 + 提醒; 都写了换成绿色提示', async () => {
    const rows = [mk('1', '林晓'), mk('3', '老王')]
    const v = { summary: { people: 2, written: 0, withProgress: 0 }, rows }
    const html = await renderView(render, base({ lead: true, view: v, rows, missing: rows }))
    has(html, t('okr.daily.missing_today', { p0: 2 }))
    has(html, '林晓、老王')
    assert.ok(html.includes('data-test="dsum-remind"'))
    const past = await renderView(render, base({ lead: true, view: v, rows, missing: rows, isToday: false, date: '2026-11-20' }))
    has(past, t('okr.daily.missing_day', { p0: 2, p1: '2026-11-20' }))
    const ok = await renderView(render, base({ lead: true, view: { ...v, summary: { ...v.summary, written: 2 } }, rows: [], missing: [] }))
    has(ok, t('okr.daily.all_written'))
    assert.ok(!ok.includes('data-test="dsum-remind"'))
  })

  test('可编辑的卡: 出输入框和保存按钮(没进展也能写)', async () => {
    const rows = [mk('38', '我')]
    const html = await renderView(render, base({ scope: 'me', view: { summary: {}, rows }, rows, editable: () => true, drafts: { 38: '' } }))
    assert.ok(html.includes('data-test="dsum-input-38"'))
    assert.ok(html.includes('data-test="dsum-save-38"'))
    has(html, t('okr.daily.no_progress'))
    lacks(html, t('okr.daily.summary_line', { p0: 0, p1: 0, p2: 0 }).slice(0, 6))
  })
})

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

// ---------------------------------------------------------------- 四、按项目分组

const pobj = (id, owner, over = {}) => ({
  id, seq: 1, title: 'O-' + id, weight: 100, status: 'ON_TRACK', submitted: true, lateSubmit: false, owner,
  progress: 0.5, krTotal: 3, krDone: 1, selfScore: null, projects: [{ id: '7', name: '园区', code: 'P-7' }], ...over
})
const lin = { id: '38', name: '林晓' }
const zhou = { id: '39', name: '周舟' }

describe('按项目分组: 纯函数', () => {
  test('块头: O 数不含放弃的, 人数 / 完成度用后端 groupSummary', () => {
    const g = { project: { id: '7', name: '园区', code: 'P-7' }, objectives: [pobj('1', lin), pobj('2', zhou), pobj('3', zhou, { status: 'DROPPED' })], ownerCount: 2, completion: 0.4567 }
    assert.deepEqual(groupHead(g), { key: '7', name: '园区', code: 'P-7', unassigned: false, objectiveCount: 2, ownerCount: 2, completion: 0.4567 })
    const un = groupHead({ project: { id: null, name: '未挂项目', code: null }, objectives: [pobj('4', lin)], completion: null })
    assert.equal(un.unassigned, true)
    assert.equal(un.key, 'none')
    assert.equal(un.ownerCount, 1, '后端没给 ownerCount 时自己数')
  })
  test('「未挂项目」放最后; 块内按人分段并保持顺序', () => {
    const gs = orderGroups([{ project: { id: null } }, { project: { id: '2' } }, { project: { id: '1' } }])
    assert.deepEqual(gs.map(g => g.project.id), ['2', '1', null])
    const segs = byOwner([pobj('1', lin), pobj('2', lin, { seq: 2 }), pobj('3', zhou)])
    assert.deepEqual(segs.map(s => [s.owner.name, s.objectives.length]), [['林晓', 2], ['周舟', 1]])
  })
})

describe('团队页 · 按项目', () => {
  const render = compileView('views/okr/TeamOkr.vue')
  const raw = [
    { project: { id: '7', name: '园区', code: 'P-7' }, objectives: [pobj('1', lin), pobj('2', zhou)], ownerCount: 2, completion: 0.5 },
    { project: { id: null, name: '未挂项目', code: null }, objectives: [pobj('3', lin, { projects: [] })], ownerCount: 1, completion: null }
  ]
  const groups = orderGroups(raw).map(g => ({ head: groupHead(g), owners: byOwner(g.objectives) }))
  const state = (over = {}) => ({
    loading: false, isMobile: false, meId: '38', me: { id: '38', role: 'FDE_ENGINEER' }, people: [], canScore: false, anyProxy: false, lead: false,
    weekKeyNow: '2026-W48', weekParts: { year: 2026, weekNo: 48 }, cycleTag: 'info', mgrOpen: false, mgrChanged: false, canCloseWeek: false,
    pct, initialOf, mayProxyRow, subText: r => r.submission, subClass: () => 'okr-sub', openPerson() {}, openProxy() {}, shift() {}, setMode() {}, load() {},
    data: { cycle: { status: 'IN_PROGRESS' }, summary: { expected: 2, submitted: 1, late: 0, avgCompletion: 0.5 }, rows: [], lowStreak: { people: [], weeks: [] } },
    mode: 'project', groups,
    ...over
  })
  const cardStub = { props: ['obj'], setup: p => () => Vue.h('div', { class: 'card-stub' }, `${p.obj.owner.name}:${p.obj.title}`) }
  const extra = { OkrWeekBar: true, OkrPersonPicker: true, OkrManagerScorePanel: true, OkrWeekStatus: true, OkrObjectiveCard: cardStub }

  test('每个项目一块: 块头项目名 + 人数 + 平均完成度; 块内各人的 O 卡; 「未挂项目」在最后; 不出按人表格', async () => {
    const html = await renderView(render, state(), extra)
    assert.ok(html.includes('data-test="okr-by-project"'))
    has(html, t('okr.byproj.head', { p0: 2, p1: 2 }))
    has(html, t('okr.byproj.avg', { p0: '50%' }))
    has(html, t('okr.byproj.avg', { p0: '-' }))
    assert.equal((html.match(/class="card-stub"/g) || []).length, 3)
    assert.ok(html.indexOf('data-test="okr-group-7"') < html.indexOf('data-test="okr-group-none"'))
    has(html, t('okr.byproj.unassigned'))
    assert.ok(!html.includes('data-test="okr-team-table"'))
    assert.ok(!html.includes(t('okr.expected')))
  })
  test('按人(默认): 照旧出表格, 不出分组', async () => {
    const html = await renderView(render, state({ mode: 'person' }), extra)
    assert.ok(html.includes('data-test="okr-team-table"'))
    assert.ok(!html.includes('data-test="okr-by-project"'))
  })
})

describe('O 卡: 按项目视图的 O(没有 KR 明细) + 项目标签', () => {
  const render = compileView('components/okr/OkrObjectiveCard.vue')
  const st = (obj) => ({
    obj, canEdit: false, canMiss: false, canManagerScore: false, canComplete: false, closed: false, krBusy: '', busy: false,
    open: false, form: { krId: '' }, mScore: null, mComment: '', hasPanel: false, toggleText: '', pickedKr: null, showActs: false, actsDisabled: true,
    OBJ_TAG, pct, krValueText, round: n => n, shDate: s => s, toggle() {}, send() {}, complete() {}
  })
  test('出「KR 完成 1/3」和项目标签, 不出 KR 列表', async () => {
    const html = await renderView(render, st(pobj('1', lin)), { 'el-tooltip': true })
    has(html, t('okr.byproj.kr_sum', { p0: 1, p1: 3 }))
    assert.ok(html.includes('data-test="okr-card-projects"'))
    has(html, '园区')
    assert.ok(!html.includes('class="okr-krs"'))
  })
  test('没挂项目不出标签行', async () => {
    const html = await renderView(render, st(pobj('1', lin, { projects: [] })), { 'el-tooltip': true })
    assert.ok(!html.includes('data-test="okr-card-projects"'))
  })
})

// ---------------------------------------------------------------- 五、O 编辑里选项目

describe('O 编辑: 所属项目', () => {
  test('toDraft 带上 projectIds(字符串), 老数据没有 projects → []', () => {
    const d = toDraft([
      { id: '1', title: 'A', weight: 50, status: 'ON_TRACK', projects: [{ id: 7, name: '园区', code: 'P-7' }], keyResults: [] },
      { id: '2', title: 'B', weight: 50, status: 'ON_TRACK', keyResults: [] }
    ])
    assert.deepEqual(d.map(o => o.projectIds), [['7'], []])
  })
  test('下拉选项 = 项目列表 + 计划里已挂但列表里没有的(不重复)', () => {
    const opts = projectOptions(
      [{ id: 7, name: '园区', code: 'P-7' }, { id: 8, name: '仓储', code: null }],
      [{ projects: [{ id: '7', name: '园区', code: 'P-7' }, { id: '99', name: '别组项目', code: 'X-9' }] }]
    )
    assert.deepEqual(opts, [
      { id: '7', name: '园区', code: 'P-7' }, { id: '8', name: '仓储', code: null }, { id: '99', name: '别组项目', code: 'X-9' }
    ])
  })
  test('编辑器每个 O 一个多选; 提交时带 projectIds、去掉只读的 projects', async () => {
    const render = compileView('components/okr/OkrPlanEditor.vue')
    const draft = [
      { _k: 1, title: 'A', description: '', weight: 50, projectIds: ['7'], keyResults: [{ _k: 2, title: 'k', metricType: 'BINARY', weight: 100 }] },
      { _k: 3, title: 'B', description: '', weight: 50, projectIds: [], keyResults: [{ _k: 4, title: 'k', metricType: 'BINARY', weight: 100 }] }
    ]
    const html = await renderView(render, {
      draft, manualWeights: false, problems: [], MAX_KRS: 10, busy: '', submitted: false, cancellable: false, lateHint: false, submitLabel: '',
      bulk: { visible: false, obj: null }, roomFor: () => 10, projOptions: [{ id: '7', name: '园区', code: 'P-7' }], projectLabel,
      addObjective() {}, addKr() {}, removeObjective() {}, removeKr() {}, openBulk() {}, insertBulk() {}, emitPlan() {}
    }, { 'el-input-number': true, OkrBulkKrDialog: true })
    assert.ok(html.includes('data-test="okr-ed-projects-0"') && html.includes('data-test="okr-ed-projects-1"'))
    const src = readFileSync(new URL('../../src/components/okr/OkrPlanEditor.vue', import.meta.url), 'utf8')
    assert.match(src, /map\(\(\{ _k, projects: _p, \.\.\.o \}\) => \(\{\s*\.\.\.o,\s*projectIds: \[\.\.\.\(o\.projectIds \|\| \[\]\)\]/)
    assert.match(src, /fde\.projects\.list\(\{ page: 1, page_size: 200 \}\)/)
  })
})
