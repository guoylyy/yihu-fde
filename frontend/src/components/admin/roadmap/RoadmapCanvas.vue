<template>
  <!-- v2.8.0(#1144) 路径图画布: Vue Flow + dagre 自动布局; 拖把手连线建依赖, 点边/点节点选中交给侧栏 -->
  <div class="rm-canvas" :class="{ empty: !flow.nodes.length }">
    <VueFlow
      :id="flowId"
      v-model:nodes="flow.nodes"
      v-model:edges="flow.edges"
      :nodes-connectable="canEdit"
      :edges-updatable="false"
      :delete-key-code="null"
      :min-zoom="0.3"
      :max-zoom="1.6"
      :default-edge-options="{ type: 'smoothstep' }"
      :connection-line-style="{ stroke: edgeType === 'FEEDBACK' ? '#7c3aed' : '#d2521e', strokeWidth: 2, strokeDasharray: edgeType === 'FEEDBACK' ? '6 4' : '' }"
      fit-view-on-init
      @connect="onConnect"
      @node-click="onNodeClick"
      @node-double-click="onNodeDblClick"
      @edge-click="onEdgeClick"
      @pane-click="$emit('select', null)"
    >
      <template #node-task="props"><TaskNode :data="props.data" :selected="props.selected" /></template>
      <template #node-milestone="props"><MilestoneNode :data="props.data" /></template>
      <Background pattern-color="#e7e5e4" :gap="18" />
      <Controls position="bottom-right" :show-interactive="false" />
    </VueFlow>
    <div v-if="ghost" class="rm-ghost-banner">{{ $t('roadmapCanvas.previewing_ai_draft_purple_dashed_nodes') }}</div>
    <div v-if="!flow.nodes.length" class="rm-empty">
      <slot name="empty">{{ $t('roadmapCanvas.this_milestone_has_no_tasks_yet') }}</slot>
    </div>
    <div class="rm-legend">
      <span><i class="lg done"></i>{{ $t('common.done_2') }}</span><span><i class="lg active"></i>{{ $t('common.in_progress_2') }}</span><span><i class="lg ready"></i>{{ $t('common.ready') }}</span><span><i class="lg blocked"></i>{{ $t('common.blocked') }}</span><span><i class="lg idle"></i>{{ $t('roadmapCanvas.waiting_on_prerequisites') }}</span>
      <span><i class="lg-line"></i>{{ $t('common.hard_dependency') }}</span><span><i class="lg-line dash"></i>{{ $t('common.loop') }}</span>
    </div>
  </div>
</template>

<script setup>
import { reactive, watch, nextTick } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import TaskNode from './TaskNode.vue'
import MilestoneNode from './MilestoneNode.vue'
import { toFlow } from './roadmapUtils.js'

const props = defineProps({
  data: { type: Object, default: null },          // 接口返回的 roadmap
  canEdit: { type: Boolean, default: false },
  edgeType: { type: String, default: 'BLOCKS' },  // 连线默认类型(工具栏切换)
  highlightCritical: { type: Boolean, default: false },
  ghost: { type: Object, default: null }           // v2.8.0(#1145) AI 草案幽灵节点 { nodes, edges }
})
const emit = defineEmits(['connect', 'select', 'open-task'])

const flowId = `roadmap-${Math.random().toString(36).slice(2, 8)}`
const { fitView } = useVueFlow(flowId)
const flow = reactive({ nodes: [], edges: [] })

function rebuild() {
  const f = toFlow(props.data, { highlightCritical: props.highlightCritical, ghost: props.ghost })
  flow.nodes = f.nodes
  flow.edges = f.edges
  nextTick(() => setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 30))
}
watch(() => [props.data, props.highlightCritical, props.ghost], rebuild, { immediate: true, deep: false })

function onConnect({ source, target }) {
  if (!source || !target || source === target) return
  if (String(target).startsWith('m-') || String(source).startsWith('m-')) return   // 终点节点不是任务
  emit('connect', { predecessorId: source, successorId: target, type: props.edgeType })
}
function onNodeClick({ node }) {
  if (node.type !== 'task') return emit('select', { kind: 'milestone', data: node.data })
  emit('select', { kind: 'task', data: node.data })
}
function onNodeDblClick({ node }) { if (node.type === 'task' && !node.data.external) emit('open-task', node.data.id) }
function onEdgeClick({ edge }) { if (!edge.data?.terminal) emit('select', { kind: 'edge', data: edge.data }) }

defineExpose({ refit: () => nextTick(() => fitView({ padding: 0.2, duration: 200 })), rebuild })
</script>

<style scoped>
.rm-canvas { position: relative; height: 600px; border: 1px solid #eae7e2; border-radius: 10px; background: #fafaf9; overflow: hidden; }
.rm-ghost-banner { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); background: #f5f3ff; border: 1px dashed #a78bfa; color: #5b21b6; font-size: 12px; padding: 4px 12px; border-radius: 999px; z-index: 5; pointer-events: none; white-space: nowrap; }
.rm-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #a8a29e; font-size: 13px; pointer-events: none; padding: 0 40px; text-align: center; }
.rm-legend { position: absolute; left: 10px; bottom: 8px; display: flex; gap: 12px; font-size: 11px; color: #78716c; background: rgba(255,255,255,.9); padding: 4px 8px; border-radius: 6px; pointer-events: none; }
.rm-legend span { display: inline-flex; align-items: center; gap: 4px; }
.lg { width: 10px; height: 10px; border-radius: 3px; border: 1.5px solid #d6d3d1; background: #fff; display: inline-block; }
.lg.done { background: #f0f9f1; border-color: #7bc496; }
.lg.active { background: #fff7ed; border-color: #d2521e; }
.lg.ready { border-color: #a8a29e; }
.lg.blocked { border-color: #e24b4a; border-width: 2px; }
.lg.idle { border-style: dashed; }
.lg-line { width: 16px; height: 0; border-top: 2px solid #78716c; display: inline-block; }
.lg-line.dash { border-top-style: dashed; border-color: #7c3aed; }
/* 边样式(全局 class, 不能 scoped 到 svg 内部, 用 :deep) */
.rm-canvas :deep(.vue-flow__edge-path) { stroke: #78716c; stroke-width: 1.8; }
.rm-canvas :deep(.dep-feedback .vue-flow__edge-path) { stroke: #7c3aed; stroke-dasharray: 6 4; }
.rm-canvas :deep(.dep-terminal .vue-flow__edge-path) { stroke: #1c1917; stroke-dasharray: 2 3; opacity: .6; }
.rm-canvas :deep(.dep-critical .vue-flow__edge-path) { stroke: #f59e0b; stroke-width: 2.6; }
.rm-canvas :deep(.dep-ghost .vue-flow__edge-path) { stroke: #a78bfa; stroke-dasharray: 4 4; }
.rm-canvas :deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke: #d2521e; stroke-width: 2.6; }
.rm-canvas :deep(.vue-flow__edge.animated .vue-flow__edge-path) { stroke: #e24b4a; }
.rm-canvas :deep(.vue-flow__node) { cursor: pointer; }
.rm-canvas :deep(.vue-flow__controls) { box-shadow: none; border: 1px solid #eae7e2; border-radius: 6px; overflow: hidden; }
</style>
