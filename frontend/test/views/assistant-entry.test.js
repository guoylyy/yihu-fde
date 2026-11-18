import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '@vue/compiler-sfc'

// AI 助手只有一个入口: 顶栏右上角按钮。右下角药丸已移除, 防止回归出现两个入口。
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const layout = parse(read('../../src/views/admin/AdminLayout.vue')).descriptor
const drawer = parse(read('../../src/components/assistant/AssistantDrawer.vue')).descriptor

test('顶栏有 AI 助手按钮: agent 模块门控, 点击切换抽屉, 带激活态', () => {
  const tpl = layout.template.content
  const btn = tpl.match(/<el-button[^>]*data-test="assistant-entry"[^>]*>/)?.[0]
  assert.ok(btn, '顶栏应有 data-test="assistant-entry" 按钮')
  assert.match(btn, /v-if="moduleEnabled\('agent'\)"/)
  assert.match(btn, /@click="toggleAssistant"/)
  assert.match(btn, /'is-active': assistant\.open/)
  assert.match(tpl, /<AssistantDrawer\b/)
  assert.match(layout.scriptSetup.content, /function toggleAssistant\(\)\s*\{\s*if \(assistant\.open\) assistant\.open = false\s*else openAssistant\(\)/)
})

test('抽屉组件不再渲染右下角悬浮药丸', () => {
  const all = drawer.template.content + drawer.styles.map((s) => s.content).join('\n')
  assert.doesNotMatch(all, /ai-fab|assistant-fab|fab-dot/)
  assert.match(drawer.template.content, /<aside v-if="state\.open" class="ai-panel"/)
})
