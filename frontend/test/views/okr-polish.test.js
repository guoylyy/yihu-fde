// OKR 前端小收口: 项目 OKR 页默认只看进行中项目; 人名筛选器「头像 + 姓名 +（我）」不拼接
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  ACTIVE_PROJECT_STATUSES, PROJECT_SCOPES, isActiveProjectRow, projectDocView, textWidth, pickerWidth
} from '../../src/views/okr/okrPolish.js'
import { projectLabel } from '../../src/views/okr/okrFe3.js'
import { initialOf, sameId } from '../../src/views/okr/okrPeople.js'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)

const row = (id, name, status, over = {}) => ({ project: { id, name, code: 'P-' + id, status }, hasDoc: false, title: null, updatedAt: null, updatedBy: null, ...over })
const LIST = {
  week: '2026-W47',
  total: 5,
  withDoc: 2,
  rows: [
    row('1', '园区', 'IN_PROGRESS', { hasDoc: true, title: 'W47 园区' }),
    row('2', 'r4amw-项目', 'PROPOSAL', { hasDoc: true, title: '测试项目也写了' }),
    row('3', '仓储', 'IN_PROGRESS'),
    row('4', 'unit-test-x', 'PROPOSAL'),
    row('5', '安装', 'APPROVED')
  ]
}

describe('项目列表默认只看进行中', () => {
  test('进行中 = 已批准 / 进行中, 本周有文档的不管状态都算', () => {
    assert.deepEqual(ACTIVE_PROJECT_STATUSES, ['APPROVED', 'IN_PROGRESS'])
    assert.deepEqual(PROJECT_SCOPES, ['active', 'all'])
    assert.equal(isActiveProjectRow(row('1', 'a', 'IN_PROGRESS')), true)
    assert.equal(isActiveProjectRow(row('1', 'a', 'APPROVED')), true)
    assert.equal(isActiveProjectRow(row('1', 'a', 'PROPOSAL')), false)
    assert.equal(isActiveProjectRow(row('1', 'a', 'DRAFT')), false)
    assert.equal(isActiveProjectRow(row('1', 'a', 'PROPOSAL', { hasDoc: true })), true)
    assert.equal(isActiveProjectRow(null), false)
  })

  test('active: 过滤掉方案中 / 测试项目, 计数按过滤后算, allTotal 保留总数', () => {
    const v = projectDocView(LIST, 'active')
    assert.deepEqual(v.rows.map(r => r.project.id), ['1', '2', '5', '3'])
    assert.equal(v.total, 4)
    assert.equal(v.withDoc, 2)
    assert.equal(v.allTotal, 5)
    assert.equal(v.scope, 'active')
  })

  test('默认就是 active; all 全部列出; 有文档的在前, 其余按名字', () => {
    assert.equal(projectDocView(LIST).scope, 'active')
    const v = projectDocView(LIST, 'all')
    assert.equal(v.total, 5)
    assert.equal(v.withDoc, 2)
    assert.deepEqual(v.rows.slice(0, 2).map(r => r.hasDoc), [true, true])
    assert.ok(v.rows.slice(2).every(r => !r.hasDoc))
  })

  test('list 还没回来 / 空列表不炸', () => {
    assert.deepEqual(projectDocView(null), { scope: 'active', rows: [], total: 0, withDoc: 0, allTotal: 0 })
    assert.equal(projectDocView({ rows: [] }, 'all').total, 0)
  })
})

describe('项目 OKR 页渲染', () => {
  const render = compileView('views/okr/ProjectOkr.vue')
  const state = (scope, list = LIST) => ({
    projectId: '', list, detail: null, canEdit: false, uploading: false, saving: false, fileInput: null, isMobile: false,
    week: '2026-W47', weekParts: { year: 2026, weekNo: 47 }, range: { start: null, end: null }, html: '',
    edit: { open: false, title: '', content: '' }, projectLabel, PROJECT_SCOPES, scope,
    view: projectDocView(list, scope),
    shift: () => {}, pickProject: () => {}, pickScope: () => {}, openEdit: () => {}, save: () => {}, onFile: () => {},
    metaText: () => ''
  })

  test('默认: 两个范围按钮, 计数「x/进行中数（共 总数 个）」, 测试项目不出现; 没文档的行灰掉但仍可点', async () => {
    const html = await renderView(render, state('active'), { OkrWeekBar: true })
    has(html, t('okr.proj.scope_active'))
    has(html, t('okr.proj.scope_all'))
    has(html, t('okr.proj.summary_active', { p0: 2, p1: 4, p2: 5 }))
    lacks(html, 'unit-test-x')
    has(html, '仓储')
    assert.equal((html.match(/data-test="pokr-row"/g) || []).length, 4)
    assert.equal((html.match(/class="pokr-row empty"/g) || []).length, 2, '仓储 / 安装 没文档 → 灰')
    has(html, t('okr.proj.none_short'))
  })

  test('全部项目: 全列出, 计数是总数', async () => {
    const html = await renderView(render, state('all'), { OkrWeekBar: true })
    has(html, t('okr.proj.summary_all', { p0: 2, p1: 5 }))
    has(html, 'unit-test-x')
  })

  test('进行中一个都没有: 空态提示切到全部项目', async () => {
    const html = await renderView(render, state('active', { rows: [row('4', 'unit-test-x', 'PROPOSAL')] }), { OkrWeekBar: true })
    has(html, t('okr.proj.no_active'))
  })

  test('中文文案: 计数行带「共 37 个，默认只看进行中」', () => {
    const zh = JSON.parse(readZh()).okr.proj
    assert.equal(zh.summary_active.replace('{p0}', 0).replace('{p1}', 12).replace('{p2}', 37), '本周 0/12 个项目有项目 OKR（共 37 个，默认只看进行中）')
    assert.equal(zh.scope_active, '进行中项目')
    assert.equal(zh.scope_all, '全部项目')
  })
})

function readZh() { return readFileSync(new URL('../../src/locales/zh-CN.json', import.meta.url), 'utf8') }

describe('人名筛选器', () => {
  test('宽度跟着姓名走, 夹在 min/max 之间; 自己多算「（我）」', () => {
    assert.equal(textWidth('老板'), 28)
    assert.equal(textWidth('ab'), 16)
    assert.equal(pickerWidth('老板'), 140, '短名用最小宽度')
    const long = '欧阳一二三四五六七八'
    assert.ok(pickerWidth(long) > 140)
    assert.ok(pickerWidth(long, { isMe: true, meText: '（我）' }) > pickerWidth(long))
    assert.equal(pickerWidth('x'.repeat(100)), 360)
    assert.equal(pickerWidth('x'.repeat(100), { min: 96, max: 160 }), 160)
  })

  const render = compileView('components/okr/OkrPersonPicker.vue')
  const people = [{ id: '1', name: '老板', avatarUrl: '' }, { id: '2', name: '林晓', avatarUrl: '/a.png' }]
  const base = (over = {}) => {
    const current = people.find(p => p.id === (over.modelValue ?? '1'))
    return {
      modelValue: '1', meId: '1', compact: false, people, shown: people, current, width: 140, query: '',
      initialOf, isMe: id => sameId(id, over.meId ?? '1'), pick: () => {}, onFilter: () => {}, ...over
    }
  }
  // el-select 的 #label 插槽在 SSR 透传桩里不渲染, 选项和按钮用同一套结构, 看选项即可
  test('选项: 头像首字走 data-initial(不进文字), 姓名后紧跟「（我）」, 不再是「老 老板 我」', async () => {
    const html = await renderView(render, base())
    assert.ok(html.includes('data-initial="老"'), '首字放在属性里给 CSS 画')
    const text = html.replace(/<[^>]+>/g, '')
    assert.ok(text.includes('老板' + t('okr.people.me')), text)
    assert.ok(!/老\s*老板/.test(text), '首字不出现在文字里')
    assert.ok(text.includes('林晓') && !text.includes('林晓' + t('okr.people.me')), '别人不带（我）')
    assert.ok(!html.includes('data-initial="林"'), '有头像图的不画首字')
  })
})
