import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

// 0.5.0 R3 新增文案中英两份 key 必须一致, 免得切到英文冒出 key 名
const load = (f) => JSON.parse(readFileSync(new URL(`../../src/locales/${f}`, import.meta.url), 'utf8'))
const zh = load('zh-CN.json')
const en = load('en.json')
const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${pre}${k}.`) : [`${pre}${k}`])).sort()

for (const section of ['nav', 'today', 'team', 'experience', 'conversations']) {
  test(`locale 段 ${section} 中英 key 一致`, () => {
    assert.ok(zh[section] && en[section], section)
    assert.deepEqual(keys(zh[section]), keys(en[section]))
  })
}

test('任务实际工时 / 工时页提示文案两种语言都有', () => {
  for (const k of ['tasks.actual_hours', 'tasks.show_actual_hours', 'taskDetailDialog.timesheet_history', 'timesheets.legacy_banner']) {
    const [a, b] = k.split('.')
    assert.ok(zh[a][b] && en[a][b], k)
  }
  assert.match(zh.timesheets.legacy_banner, /工时已并入任务，本页仅保留历史记录/)
})
