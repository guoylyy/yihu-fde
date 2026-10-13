import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { i18n } from '../../src/i18n/index.js'

// Execute the real SFC template with the API's flat response contract.
const source = readFileSync(new URL('../../src/views/admin/EngineerProfiles.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const result = compileTemplate({ source: descriptor.template.content, filename: 'EngineerProfiles.vue', id: 'profile-test' })
assert.deepEqual(result.errors, [])
const code = result.code.replace(/import \{([^}]+)\} from "vue"/g, (_, imports) =>
  `const {${imports.replace(/\s+as\s+/g, ':')}} = Vue`)
  .replace('export function render', 'return function render')
const render = new Function('Vue', code)(Vue)
async function renderRows(rows) {
  const app = Vue.createSSRApp({ render, setup: () => ({ profiles: rows, loading: false, load() {}, levelType: () => 'info' }) })
  app.use(i18n)   // 测试环境语言为 en (Node 无 zh 浏览器语言)
  const passthrough = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }
  for (const name of ['el-card', 'el-button', 'el-tag', 'el-progress']) app.component(name, passthrough)
  app.component('el-table', { props: ['data'], setup(props, { slots }) { Vue.provide('rows', props.data); return () => Vue.h('div', slots.default?.()) } })
  app.component('el-table-column', { setup(_, { slots }) { const rows = Vue.inject('rows'); return () => Vue.h('div', rows.map(row => slots.default?.({ row }))) } })
  app.directive('loading', { getSSRProps: () => ({}) })
  return renderToString(app)
}
test('matrix renders the flat API response without missing nested objects', async () => {
  const html = await renderRows([{ engineerId: '1', name: '测试工程师', level: 'MIDDLE', score: 42, dimensions: { delivery: 50, quality: 60, capacity: 25 }, approvedHours3m: 132, tasks: 4, acceptance: { firstPassRate: 60, firstTotal: 5, firstPass: 3 }, projectTypes: ['MES'], roles: ['DEV'] }])
  assert.match(html, /测试工程师/)
  assert.match(html, /132h/)
  assert.match(html, /4 tasks \(all time\)/)
})
test('missing evidence is shown as insufficient data, not a zero pass rate', async () => {
  const html = await renderRows([{ engineerId: '2', name: '新同事', level: 'JUNIOR', score: 0, dimensions: { delivery: null, quality: null, capacity: 0 }, approvedHours3m: 0, tasks: 0, acceptance: { firstPassRate: null, firstTotal: 0, firstPass: 0 }, projectTypes: [], roles: [] }])
  assert.match(html, /No task records/)
})
