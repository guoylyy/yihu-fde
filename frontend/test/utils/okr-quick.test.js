// 周 OKR 快速录入: 批量粘贴拆行 / 插入 / 调序, O 权重分配(与后端同口径), 草稿 → 编辑器, 新文案中英齐全
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  splitBulkLines, moveItem, insertKrs, weightsByKrCount, draftToEditor, reportLength, KR_TITLE_MAX
} from '../../src/views/okr/okrUtils.js'
import * as backend from '../../../backend/src/services/okrRules.js'

describe('批量粘贴: 一行一条', () => {
  test('去掉行首 1. - • * 和行尾空格, 跳过空行', () => {
    const r = splitBulkLines('1. 财务模块自测走通  \n\n- 周四上线\n• 周五改一轮\n* 反馈收口成清单\t\n   \n2、客户清单答复\n3) 遗留项清零')
    assert.deepEqual(r.items, ['财务模块自测走通', '周四上线', '周五改一轮', '反馈收口成清单', '客户清单答复', '遗留项清零'])
    assert.equal(r.clipped, 0)
  })

  test('不带空格的「1.」也去掉; 「3.5 人天」「**加粗**」不误删', () => {
    const r = splitBulkLines('1.完成接口\n3.5 人天交付\n**重点**上线\n10. 第十条\n- [ ] 待办一\n(2) 括号编号')
    assert.deepEqual(r.items, ['完成接口', '3.5 人天交付', '**重点**上线', '第十条', '待办一', '括号编号'])
  })

  test('Windows 换行', () => {
    assert.deepEqual(splitBulkLines('- a1\r\n- b2\r\n').items, ['a1', 'b2'])
  })

  test(`超过 ${KR_TITLE_MAX} 字截断并计数`, () => {
    const r = splitBulkLines(`${'长'.repeat(250)}\n短的一条\n${'x'.repeat(201)}`)
    assert.equal(r.items[0].length, KR_TITLE_MAX)
    assert.equal(r.items[2].length, KR_TITLE_MAX)
    assert.equal(r.clipped, 2)
  })

  test('全是空行 → 空', () => {
    assert.deepEqual(splitBulkLines('\n  \n-  \n'), { items: [], clipped: 0 })
  })

  test('预览里上下调序, 越界不动', () => {
    const a = ['a', 'b', 'c']
    assert.deepEqual(moveItem(a, 0, 1), ['b', 'a', 'c'])
    assert.deepEqual(moveItem(a, 2, -1), ['b', 'c', 'a'])
    assert.deepEqual(moveItem(a, 0, -1), ['b', 'c', 'a'])
    assert.deepEqual(moveItem(a, 2, 1), ['b', 'c', 'a'])
  })
})

describe('批量插入到 O', () => {
  const makeKr = (title) => ({ title, metricType: 'BINARY', weight: 0 })

  test('只有一条空占位 KR 时顶替它', () => {
    const o = { keyResults: [{ title: '', weight: 100 }] }
    assert.deepEqual(insertKrs(o, ['k1', 'k2'], { makeKr }), { added: 2, dropped: 0 })
    assert.deepEqual(o.keyResults.map(k => k.title), ['k1', 'k2'])
  })

  test('已有内容就追加在后面', () => {
    const o = { keyResults: [{ title: '已有' }] }
    insertKrs(o, ['新'], { makeKr })
    assert.deepEqual(o.keyResults.map(k => k.title), ['已有', '新'])
  })

  test('已保存过的空 KR(有 id)不顶替', () => {
    const o = { keyResults: [{ id: '9', title: '' }] }
    insertKrs(o, ['新'], { makeKr })
    assert.equal(o.keyResults.length, 2)
  })

  test('超过上限的不插, 返回丢了几条', () => {
    const o = { keyResults: Array.from({ length: 8 }, (_, i) => ({ title: `k${i}` })) }
    assert.deepEqual(insertKrs(o, ['a', 'b', 'c', 'd'], { max: 10, makeKr }), { added: 2, dropped: 2 })
    assert.equal(o.keyResults.length, 10)
  })
})

describe('O 权重按 KR 条数占比', () => {
  test('3/2/1 → 50/33/17', () => assert.deepEqual(weightsByKrCount([3, 2, 1]), [50, 33, 17]))
  test('全 0 按均分', () => assert.deepEqual(weightsByKrCount([0, 0]), [50, 50]))
  test('与后端 okrRules.weightsByKrCount 逐组一致', () => {
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) for (let c = 1; c <= 4; c++) {
      assert.deepEqual(weightsByKrCount([a, b, c]), backend.weightsByKrCount([a, b, c]), `${a}/${b}/${c}`)
    }
  })
})

describe('草稿 → 编辑器', () => {
  test('补状态, 是/否型去掉单位和目标值, 去掉空 KR', () => {
    const out = draftToEditor([{
      title: ' O1 ', weight: 60,
      keyResults: [
        { title: '上线', metricType: 'BINARY', unit: '%', targetValue: 1, weight: 50 },
        { title: '清零', metricType: 'NUMBER', unit: '项', targetValue: 3, weight: 50 },
        { title: '  ', metricType: 'BINARY' }
      ]
    }])
    assert.equal(out[0].title, 'O1')
    assert.equal(out[0].status, 'ON_TRACK')
    assert.deepEqual(out[0].keyResults.map(k => [k.title, k.unit, k.targetValue]), [['上线', '', null], ['清零', '项', 3]])
  })

  test('字数不算空白(与后端 50 字门槛同口径)', () => {
    assert.equal(reportLength(' a b\n c '), 3)
    assert.equal(backend.MIN_REPORT_LENGTH, 50)
  })
})

describe('新文案中英齐全', () => {
  const zh = JSON.parse(readFileSync(new URL('../../src/locales/zh-CN.json', import.meta.url))).okr
  const en = JSON.parse(readFileSync(new URL('../../src/locales/en.json', import.meta.url))).okr
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))
  for (const group of ['bulk', 'report']) {
    test(group, () => assert.deepEqual(keys(en[group]).sort(), keys(zh[group]).sort()))
  }
  test('每个降级原因都有提示文案', () => {
    for (const r of ['not_configured', 'timeout', 'invalid_json', 'model_error', 'model_empty']) assert.ok(zh.report.fallback[r] && en.report.fallback[r], r)
  })
})
