// OKR 前端第三批: 项目周 OKR / 每日总结 / 周状态与催交 / 按项目分组 / O 选项目。
// 纯函数直接测; 页面用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  isLead, canEditProjectDoc, projectLabel, projectDocFileProblem, PROJECT_DOC_MAX,
  todayKey, weekKeyOfDate, dailyMissingRows, dailyRemindText, summaryText
} from '../../src/views/okr/okrFe3.js'

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
