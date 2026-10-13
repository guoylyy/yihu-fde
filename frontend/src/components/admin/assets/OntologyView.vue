<!-- 资产的数据产物（本体）展示：对象 / 关系 / 动作 + 引用的共享核心对象 -->
<template>
  <div v-if="hasContent" class="onto">
    <div class="onto-legend">
      <span><i class="dot own" /> {{ $t('ontologyView.objects_defined_by_this_asset') }}</span>
      <span v-if="shared.length"><i class="dot shared" /> {{ $t('ontologyView.shared_core_objects_referenced_defined_once') }}</span>
      <span class="muted">{{ $t('ontologyView.ontology_objects_properties_relations_actions_en') }}</span>
    </div>

    <!-- 关系一览 -->
    <div v-if="links.length" class="block">
      <div class="block-title">{{ $t('ontologyView.relations') }}</div>
      <div class="links">
        <div v-for="(l, i) in links" :key="i" class="link-row">
          <span class="node" :class="isShared(l.from) ? 'shared' : 'own'">{{ labelOf(l.from) }}</span>
          <span class="edge">
            <span class="edge-label">{{ l.label || '' }}</span>
            <span class="edge-line">{{ cardinalityText(l.cardinality) }} →</span>
          </span>
          <span class="node" :class="isShared(l.to) ? 'shared' : 'own'">{{ labelOf(l.to) }}</span>
        </div>
      </div>
    </div>

    <!-- 对象 -->
    <div class="block">
      <div class="block-title">{{ $t('ontologyView.objects', { p0: objects.length }) }}</div>
      <div class="objects">
        <div v-for="o in objects" :key="o.name" class="obj own">
          <div class="obj-head"><b>{{ o.label || o.name }}</b> <code>{{ o.name }}</code></div>
          <div v-if="o.description" class="obj-desc">{{ o.description }}</div>
          <table class="props">
            <tr v-for="(p, k) in (o.properties || {})" :key="k">
              <td class="pk"><code>{{ k }}</code><span v-if="p.required" class="req">*</span></td>
              <td class="pt">{{ typeText(p) }}</td>
              <td class="pl">{{ p.label || '' }}<el-tag v-if="p.pii" size="small" type="warning" effect="plain" class="pii">{{ $t('ontologyView.personal_info') }}</el-tag></td>
            </tr>
          </table>
        </div>
        <div v-for="o in shared" :key="'s-' + o.name" class="obj shared">
          <div class="obj-head"><b>{{ o.label || o.name }}</b> <code>{{ o.name }}</code> <el-tag size="small" effect="plain">{{ $t('ontologyView.shared') }}</el-tag></div>
          <div v-if="o.description" class="obj-desc">{{ o.description }}</div>
          <table class="props">
            <tr v-for="(p, k) in (o.properties || {})" :key="k">
              <td class="pk"><code>{{ k }}</code></td>
              <td class="pt">{{ typeText(p) }}</td>
              <td class="pl">{{ p.label || '' }}</td>
            </tr>
          </table>
        </div>
      </div>
    </div>

    <!-- 动作 -->
    <div v-if="actions.length" class="block">
      <div class="block-title">{{ $t('ontologyView.actions_capabilities_system_or_agents_can') }}</div>
      <div v-for="a in actions" :key="a.name" class="action">
        <code class="action-name">{{ a.name }}</code>
        <span class="action-label">{{ a.label || '' }}</span>
        <span class="io"><span class="muted">{{ $t('ontologyView.input') }}</span> {{ ioText(a.input) }}</span>
        <span v-if="a.output" class="io"><span class="muted">{{ $t('ontologyView.output') }}</span> {{ ioText(a.output) }}</span>
        <el-tag v-if="a.mcpTool" size="small" type="success" effect="plain">MCP · {{ a.mcpTool }}</el-tag>
      </div>
    </div>
  </div>
  <el-empty v-else :description="$t('ontologyView.no_data_artifact_ontology_yet_biz')" :image-size="60" />
</template>

<script setup>
import { $t } from '@/i18n'
import { computed } from 'vue'

const props = defineProps({ ontology: { type: Object, default: null } })

const objects = computed(() => props.ontology?.objects || [])
const links = computed(() => props.ontology?.links || [])
const actions = computed(() => props.ontology?.actions || [])
const shared = computed(() => {
  const defs = props.ontology?.sharedObjects || []
  const names = props.ontology?.shared || []
  // 没有内联定义时（手工录入的资产）也要把名字列出来
  return names.map(n => defs.find(d => d.name === n) || { name: n, properties: {} })
})
const hasContent = computed(() => objects.value.length || shared.value.length || actions.value.length)
const labelMap = computed(() => new Map([...objects.value, ...shared.value].map(o => [o.name, o.label || o.name])))

function isShared(n) { return shared.value.some(o => o.name === n) }
function labelOf(n) { return labelMap.value.get(n) || n }
function cardinalityText(c) {
  return { 'one-to-one': '1 : 1', 'one-to-many': '1 : N', 'many-to-one': 'N : 1', 'many-to-many': 'N : N' }[c] || c || ''
}
function typeText(p) {
  if (!p) return ''
  if (p.type === 'enum' && Array.isArray(p.values)) return `enum(${p.values.slice(0, 5).join('|')}${p.values.length > 5 ? '…' : ''})`
  if (p.type === 'ref') return `→ ${labelOf(p.ref)}`
  return p.type || ''
}
function ioText(v) {
  if (!v) return '—'
  if (typeof v === 'string') return labelOf(v.replace(/\[\]$/, '')) + (v.endsWith('[]') ? $t('ontologyView.list') : '')
  return Object.entries(v).map(([k, t]) => `${k}: ${typeof t === 'string' ? t : 'object'}`).join(', ')
}
</script>

<style scoped>
.onto { display: flex; flex-direction: column; gap: 16px; }
.onto-legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; align-items: center; }
.muted { color: var(--el-text-color-secondary); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.dot.own, .node.own { background: #fff7ed; border: 1px solid #fdba74; }
.dot.shared, .node.shared { background: #eff6ff; border: 1px solid #93c5fd; }
.block-title { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.links { display: flex; flex-direction: column; gap: 6px; }
.link-row { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
.node { padding: 3px 10px; border-radius: 6px; font-weight: 500; }
.edge { display: inline-flex; flex-direction: column; align-items: center; min-width: 90px; }
.edge-label { font-size: 11px; color: var(--el-text-color-secondary); line-height: 1; }
.edge-line { font-size: 12px; color: var(--el-text-color-regular); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.objects { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.obj { border-radius: 8px; padding: 10px 12px; }
.obj.own { border: 1px solid #fed7aa; background: #fffcf8; }
.obj.shared { border: 1px solid #bfdbfe; background: #f8fbff; }
.obj-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.obj-head code { font-size: 12px; color: var(--el-text-color-secondary); }
.obj-desc { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.props { width: 100%; border-collapse: collapse; font-size: 12px; }
.props td { padding: 3px 4px; border-top: 1px dashed var(--el-border-color-lighter); vertical-align: top; }
.pk code { font-size: 12px; }
.req { color: var(--el-color-danger); margin-left: 2px; }
.pt { color: #0e7490; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.pl { color: var(--el-text-color-regular); }
.pii { margin-left: 4px; transform: scale(.9); }
.action { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; padding: 6px 0; border-top: 1px dashed var(--el-border-color-lighter); }
.action-name { font-weight: 600; }
.io { font-size: 12px; }
</style>
