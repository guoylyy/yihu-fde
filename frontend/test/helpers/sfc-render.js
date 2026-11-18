// 用真实 SFC 模板 + 手给的 setup 状态做 SSR 渲染(不跑 <script setup>, 不发请求)。
// Element Plus 组件换成透传 div, 只看模板把数据画成了什么字。
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { i18n } from '../../src/i18n/index.js'

export function compileView(relPath) {
  const file = new URL(`../../src/${relPath}`, import.meta.url)
  const { descriptor } = parse(readFileSync(file, 'utf8'))
  const result = compileTemplate({ source: descriptor.template.content, filename: relPath, id: 'test-' + relPath.replace(/\W/g, '') })
  assert.deepEqual(result.errors, [])
  const code = result.code.replace(/import \{([^}]+)\} from "vue"/g, (_, imports) =>
    `const {${imports.replace(/\s+as\s+/g, ':')}} = Vue`)
    .replace('export function render', 'return function render')
  return new Function('Vue', code)(Vue)
}

const passthrough = { setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) }
const STUBS = ['el-input', 'el-button', 'el-tag', 'el-progress', 'el-avatar', 'el-skeleton', 'el-empty', 'el-tooltip',
  'el-dialog', 'el-radio-group', 'el-radio-button', 'el-select', 'el-option', 'el-form', 'el-form-item', 'el-icon',
  'LoadError', 'router-link', 'TaskDetailDialog']

/** 渲染; el-table 把 data 逐行喂给列的默认插槽, 列头插槽也渲染(看 tooltip 文案) */
export async function renderView(render, state) {
  const app = Vue.createSSRApp({ render, setup: () => state })
  app.use(i18n) // 测试环境语言为 en(Node 没有中文浏览器语言)
  for (const name of STUBS) app.component(name, passthrough)
  app.component('el-table', { props: ['data'], setup(props, { slots }) { Vue.provide('rows', props.data); return () => Vue.h('div', slots.default?.()) } })
  app.component('el-table-column', {
    props: ['label', 'prop'],
    setup(props, { slots }) {
      const rows = Vue.inject('rows')
      return () => Vue.h('div', [slots.header ? slots.header() : props.label,
        ...rows.map(row => slots.default ? slots.default({ row }) : String(row[props.prop] ?? ''))])
    }
  })
  app.directive('loading', { getSSRProps: () => ({}) })
  return renderToString(app)
}

export const t = (key, args) => i18n.global.t(key, args)
