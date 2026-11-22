// OKR 前端小收口: 人名筛选器「头像 + 姓名 +（我）」不拼接(项目 OKR 页那部分随页面在精简第二轮下线)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { textWidth, pickerWidth } from '../../src/views/okr/okrPolish.js'
import { initialOf, sameId } from '../../src/views/okr/okrPeople.js'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)

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
