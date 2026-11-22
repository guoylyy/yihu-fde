// OKR 前端第三批: 项目周 OKR / 每日总结 / 周状态与催交 / 按项目分组 / O 选项目。
// 纯函数直接测; 页面用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  isLead, canEditProjectDoc, projectLabel, projectDocFileProblem, PROJECT_DOC_MAX
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
