<template>
  <!-- v2.8.0(#1144) 「规划」Tab 容器: 里程碑轨 + 路径图/列表 + 侧栏 -->
  <div class="rm-view">
    <div class="rm-toolbar">
      <el-radio-group v-model="view" size="small">
        <el-radio-button value="graph">{{ $t('roadmapView.roadmap') }}</el-radio-button>
        <el-radio-button value="list">{{ $t('roadmapView.list') }}</el-radio-button>
        <el-radio-button value="board">{{ $t('roadmapView.board') }}</el-radio-button>
      </el-radio-group>
      <template v-if="view === 'graph'">
        <el-checkbox v-model="highlightCritical" size="small">{{ $t('roadmapView.highlight_critical_path') }}</el-checkbox>
        <el-checkbox v-model="hideDone" size="small">{{ $t('roadmapView.unfinished_only') }}</el-checkbox>
        <!-- v2.12.0(#1261) 只看可开工节点 -->
        <el-checkbox v-model="onlyReady" size="small">{{ $t('roadmapView.ready_only') }}</el-checkbox>
        <span v-if="canEdit" class="rm-edge-switch">
          {{ $t('roadmapView.draw_links') }}
          <el-radio-group v-model="edgeType" size="small">
            <el-radio-button value="BLOCKS">{{ $t('common.hard_dependency') }}</el-radio-button>
            <el-radio-button value="FEEDBACK">{{ $t('common.loop') }}</el-radio-button>
          </el-radio-group>
        </span>
      </template>
      <div class="rm-toolbar-right">
        <el-button size="small" text @click="mermaidVisible = true" :disabled="!data">Mermaid</el-button>
        <el-button size="small" :icon="Refresh" :loading="loading" @click="load">{{ $t('common.refresh') }}</el-button>
        <el-button v-if="canAi" size="small" type="warning" plain @click="aiVisible = true">{{ $t('roadmapView.ai_assistant') }}</el-button>
        <el-badge :value="runningCount" :hidden="!runningCount" type="primary">
          <el-button size="small" plain @click="robotsVisible = true">{{ $t('roadmapView.robots') }}</el-button>
        </el-badge>
        <el-button v-if="canEdit" size="small" type="success" @click="dispatchVisible = true">{{ $t('roadmapView.dispatch') }}</el-button>
        <el-button v-if="canEdit" size="small" type="primary" plain @click="$emit('create-task', { milestoneId: milestoneId && milestoneId !== 'none' ? milestoneId : '' })">{{ $t('roadmapView.task') }}</el-button>
      </div>
    </div>

    <div class="rm-body" v-loading="loading && !data">
      <div class="rm-rail-col">
        <MilestoneRail v-model="milestoneId" :milestones="data?.milestones || []" :orphan-stats="data?.orphanStats" :can-edit="canEdit" @edit="m => $emit('edit-milestone', m)" @create="$emit('create-milestone')" />
      </div>
      <div class="rm-main">
        <div v-if="data?.milestone" class="rm-ms-bar">
          <span class="rm-ms-bar-name">🏁 {{ data.milestone.name }}</span>
          <span class="rm-ms-bar-goal">{{ $t('common.p0', { p0: data.milestone.goal || $t('roadmapView.no_definition_done') }) }}</span>
          <span class="rm-ms-bar-stats">{{ $t('roadmapView.done_ready_blocked', { p0: data.stats.done, p1: data.stats.total, p2: data.stats.ready, p3: data.stats.blocked }) }}<template v-if="data.criticalPath?.totalDays"> {{ $t('roadmapView.critical_path_about_days', { p0: data.criticalPath.totalDays }) }}</template></span>
        </div>
        <RoadmapCanvas v-if="view === 'graph'" ref="canvasRef" :data="graphData" :ghost="ghost" :can-edit="canEdit" :edge-type="edgeType" :highlight-critical="highlightCritical" @connect="onConnect" @select="s => selection = s" @open-task="id => $emit('open-task', id)" />
        <el-table v-else-if="view === 'list'" :data="listRows" size="small" border max-height="560" highlight-current-row @row-click="row => selection = { kind: 'task', data: row }" @selection-change="rows => selectedTaskIds = rows.map(r => r.id)">
          <el-table-column v-if="canEdit" type="selection" width="40" />
          <el-table-column label="#" width="64"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
          <el-table-column prop="title" :label="$t('common.task')" min-width="220" show-overflow-tooltip />
          <el-table-column :label="$t('common.status')" width="96"><template #default="{ row }"><el-tag size="small" :type="STATUS_TYPES[row.status]" effect="plain">{{ STATUS_LABELS[row.status] || row.status }}</el-tag></template></el-table-column>
          <el-table-column :label="$t('common.owner')" width="90"><template #default="{ row }">{{ row.assignee?.name || '—' }}</template></el-table-column>
          <el-table-column :label="$t('roadmapView.prerequisite')" min-width="120"><template #default="{ row }"><span v-if="row.predecessors.length">{{ row.predecessors.map(x => '#' + x).join(' ') }}</span><span v-else class="muted">—</span></template></el-table-column>
          <el-table-column :label="$t('roadmapView.next')" min-width="120"><template #default="{ row }"><span v-if="row.successors.length">{{ row.successors.map(x => '#' + x).join(' ') }}</span><span v-else class="muted">—</span></template></el-table-column>
          <el-table-column :label="$t('roadmapView.path_status')" width="96"><template #default="{ row }"><span v-if="row.blocked" class="bad">{{ $t('roadmapView.blocked') }}</span><span v-else-if="row.ready" class="ok">{{ $t('common.ready') }}</span><span v-else-if="isDone(row.status)" class="muted">{{ $t('common.done_2') }}</span><span v-else class="muted">—</span></template></el-table-column>
          <el-table-column :label="$t('common.robot')" width="150"><template #default="{ row }"><template v-if="data?.runs?.[row.id]"><el-tag size="small" :type="RUN_STATUS_TYPES[data.runs[row.id].status]" effect="plain">{{ RUN_STATUS_LABELS[data.runs[row.id].status] }}{{ data.runs[row.id].status === 'RUNNING' ? ` ${data.runs[row.id].progress}%` : '' }}</el-tag></template><span v-else class="muted">—</span></template></el-table-column>
          <el-table-column :label="$t('common.due')" width="96"><template #default="{ row }">{{ row.dueDate ? String(row.dueDate).slice(0, 10) : '—' }}</template></el-table-column>
          <el-table-column label="" width="70"><template #default="{ row }"><el-button link type="primary" size="small" @click.stop="$emit('open-task', row.id)">{{ $t('common.details') }}</el-button></template></el-table-column>
        </el-table>
        <div v-else class="rm-board-hint">
          <p>{{ $t('roadmapView.board_shows_five_state_lanes_shares') }}</p>
          <el-button type="primary" plain @click="$emit('go-board', milestoneId)">{{ $t('roadmapView.open_board_filtered_current_milestone') }}</el-button>
        </div>
      </div>
      <div class="rm-side-col">
        <RoadmapSidebar :selection="selection" :data="data" :can-edit="canEdit" :can-change-status="canChangeStatus"
          @open-task="id => $emit('open-task', id)" @focus="focusNode" @remove-edge="removeEdge" @update-edge="updateEdge"
          @change-status="(t, s) => $emit('change-status', t, s)" @create-successor="t => $emit('create-task', { milestoneId: t.milestoneId || '', dependsOn: [t.id], hint: `#${t.id} ${t.title}` })"
          @edit-milestone="m => $emit('edit-milestone', m)" @cancel-run="cancelRun" @redispatch-run="redispatchRun" />
      </div>
    </div>

    <!-- v2.9.0(#1163) 派工弹窗 + 机器人抽屉 -->
    <DispatchDialog v-if="canEdit" v-model="dispatchVisible" :project-id="projectId" :milestone-id="milestoneId" :milestone-name="data?.milestone?.name || ''" :data="data" :selected-task-ids="selectedTaskIds" @created="onDispatched" />
    <RobotsDrawer ref="robotsRef" v-model="robotsVisible" :project-id="projectId" @dispatch="robotsVisible = false; dispatchVisible = true" @changed="load" @open-task="id => $emit('open-task', id)" />
    <!-- v2.8.0(#1145) AI 面板: 草案预览叠在画布上(ghost), 应用后刷新 -->
    <RoadmapAiPanel v-if="canAi" v-model="aiVisible" :project-id="projectId" :milestone-id="milestoneId" :milestones="data?.milestones || []" @preview="d => setGhost(d)" @applied="onAiApplied" />

    <el-dialog v-model="mermaidVisible" :title="$t('roadmapView.mermaid_text_for_ai_or_docs')" width="640px">
      <el-input :model-value="data?.mermaid || ''" type="textarea" :rows="16" readonly style="font-family: ui-monospace, Menlo, monospace; font-size: 12px;" />
      <template #footer><el-button @click="copyMermaid">{{ $t('common.copy') }}</el-button><el-button type="primary" @click="mermaidVisible = false">{{ $t('common.close') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import MilestoneRail from './MilestoneRail.vue'
import RoadmapCanvas from './RoadmapCanvas.vue'
import RoadmapSidebar from './RoadmapSidebar.vue'
import RoadmapAiPanel from './RoadmapAiPanel.vue'
import DispatchDialog from './DispatchDialog.vue'
import RobotsDrawer from './RobotsDrawer.vue'
import { STATUS_LABELS, STATUS_TYPES, RUN_STATUS_LABELS, RUN_STATUS_TYPES, isDone, draftToGhost } from './roadmapUtils.js'

const props = defineProps({
  projectId: { type: [Number, String], required: true },
  canEdit: { type: Boolean, default: false },          // task.edit: 建/删依赖
  canChangeStatus: { type: Boolean, default: false },
  canAi: { type: Boolean, default: false },
  initialMilestoneId: { type: String, default: '' }
})
const emit = defineEmits(['open-task', 'create-task', 'edit-milestone', 'create-milestone', 'go-board', 'change-status', 'loaded', 'applied'])

const VIEW_KEY = 'fde_roadmap_view'
const view = ref(localStorage.getItem(VIEW_KEY) || 'graph')
watch(view, v => localStorage.setItem(VIEW_KEY, v))
const milestoneId = ref(props.initialMilestoneId)
const data = ref(null)
const loading = ref(false)
const selection = ref(null)
const edgeType = ref('BLOCKS')
const highlightCritical = ref(false)
const hideDone = ref(false)
const onlyReady = ref(false)
const mermaidVisible = ref(false)
const canvasRef = ref(null)
// v2.9.0(#1163) 派工: 弹窗/抽屉/勾选/轮询(有进行中派工单时每 8 秒静默刷新)
const dispatchVisible = ref(false)
const robotsVisible = ref(false)
const robotsRef = ref(null)
const selectedTaskIds = ref([])
const runningCount = computed(() => Object.values(data.value?.runs || {}).filter(r => r.status === 'RUNNING').length)
let pollTimer = null
function schedulePoll() {
  clearTimeout(pollTimer)
  const active = (data.value?.activeDispatchCount || 0) > 0 || runningCount.value > 0
  if (!active) return
  pollTimer = setTimeout(async () => { if (!loading.value) await load({ silent: true }); schedulePoll() }, 8000)
}
onUnmounted(() => clearTimeout(pollTimer))
async function onDispatched() { await load(); robotsRef.value?.load?.() }
async function cancelRun(r) {
  try { await ElMessageBox.confirm($t('roadmapView.cancel_robot_run_for', { p0: r.taskId }), $t('common.cancel_run'), { type: 'warning' }) } catch { return }
  try { await fde.devDispatches.cancelRun(r.id); ElMessage.success($t('common.cancelled')); await load() } catch (e) { ElMessage.error(e.message) }
}
async function redispatchRun(r) {
  try { await fde.devDispatches.redispatchRun(r.id); ElMessage.success($t('common.requeued')); await load() } catch (e) { ElMessage.error(e.message) }
}
// v2.8.0(#1145) AI 面板与幽灵预览
const aiVisible = ref(false)
const ghost = ref(null)
function setGhost(draft) { ghost.value = draftToGhost(draft, data.value); if (ghost.value) view.value = 'graph' }
async function onAiApplied() { ghost.value = null; await load(); emit('applied') }

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  const askedFor = String(props.projectId)
  try {
    const params = {}
    if (milestoneId.value) params.milestoneId = milestoneId.value
    const d = await fde.projects.roadmap(props.projectId, params)
    if (askedFor !== String(props.projectId)) return
    data.value = d
    // 默认聚焦: 首次进来没选里程碑时, 自动落到第一个进行中的里程碑(有则), 主人每天排任务先看它
    if (!milestoneId.value && !touched.value) {
      const first = d.milestones.find(m => m.status === 'IN_PROGRESS') || d.milestones.find(m => m.status !== 'COMPLETED')
      if (first) { touched.value = true; milestoneId.value = String(first.id); return }
    }
    touched.value = true
    // 选中项刷新后同步最新数据
    if (selection.value?.kind === 'task') {
      const n = d.nodes.find(x => x.id === selection.value.data.id)
      selection.value = n ? { kind: 'task', data: n } : null
    } else if (selection.value?.kind === 'edge') {
      const e = d.edges.find(x => x.id === selection.value.data.dependencyId)
      selection.value = e ? { kind: 'edge', data: { dependencyId: e.id, type: e.type, note: e.note, source: e.source, target: e.target } } : null
    }
    emit('loaded', d)
    schedulePoll()
  } catch (e) {
    if (!silent) ElMessage.error(e.message || $t('roadmapView.failed_load_roadmap'))
  } finally { if (!silent) loading.value = false }
}
const touched = ref(false)
watch(milestoneId, () => { selection.value = null; load() })
onMounted(load)

const graphData = computed(() => {
  if (!data.value) return data.value
  let nodes = data.value.nodes
  let edges = data.value.edges
  // 只看未完成
  if (hideDone.value) {
    nodes = nodes.filter(n => !isDone(n.status))
    const keep = new Set(nodes.map(n => n.id))
    edges = edges.filter(e => keep.has(e.source) && keep.has(e.target))
  }
  // 只看可开工: 保留 ready 节点（其前置可能已被滤掉, 故只过滤节点, 不再按边收缩）
  if (onlyReady.value) {
    nodes = nodes.filter(n => n.ready)
  }
  if (nodes === data.value.nodes && edges === data.value.edges) return data.value
  return { ...data.value, nodes, edges: onlyReady.value ? edges : edges }
})
const listRows = computed(() => (data.value?.nodes || []).filter(n => !n.external))

async function onConnect({ predecessorId, successorId, type }) {
  try {
    await fde.taskDependencies.add({ predecessorId, successorId, type })
    ElMessage.success(type === 'FEEDBACK' ? $t('roadmapView.loop_created') : $t('roadmapView.dependency_created'))
    await load()
  } catch (e) {
    // 成环: 后端 9006 带环路, 直接把原话展示(含 #id 标题)
    ElMessage({ type: 'error', message: e.message || $t('roadmapView.failed_create_dependency'), duration: 5000, showClose: true })
  }
}
async function removeEdge(e) {
  const id = e.dependencyId || e.id
  try {
    await ElMessageBox.confirm($t('roadmapView.remove_dependency', { p0: e.source, p1: e.target }), $t('common.remove_dependency'), { type: 'warning' })
  } catch { return }
  try { await fde.taskDependencies.remove(id); ElMessage.success($t('roadmapView.removed')); selection.value = null; await load() }
  catch (err) { ElMessage.error(err.message) }
}
async function updateEdge(e, patch) {
  try { await fde.taskDependencies.update(e.dependencyId || e.id, patch); await load() }
  catch (err) { ElMessage({ type: 'error', message: err.message, duration: 5000, showClose: true }) }
}
function focusNode(id) {
  const n = data.value?.nodes.find(x => x.id === String(id))
  if (n) selection.value = { kind: 'task', data: n }
}
async function copyMermaid() {
  try { await navigator.clipboard.writeText(data.value?.mermaid || ''); ElMessage.success($t('common.copied')) } catch { ElMessage.warning($t('common.copy_failed_please_select_manually')) }
}

defineExpose({ reload: load, refit: () => canvasRef.value?.refit?.(), currentMilestoneId: () => milestoneId.value, setMilestone: (id) => { milestoneId.value = id } })
</script>

<style scoped>
.rm-view { display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }
.rm-toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.rm-toolbar-right { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.rm-edge-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #78716c; }
.rm-body { display: grid; grid-template-columns: 184px minmax(0, 1fr) 244px; gap: 12px; align-items: start; }
.rm-rail-col { background: #fafaf9; border-radius: 10px; padding: 8px; max-height: 620px; overflow-y: auto; }
.rm-side-col { background: #fafaf9; border-radius: 10px; padding: 12px; min-height: 200px; max-height: 620px; overflow-y: auto; }
.rm-ms-bar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; margin-bottom: 8px; background: #fff7ed; border: 1px dashed #f5c9b3; border-radius: 8px; font-size: 12px; }
.rm-ms-bar-name { font-weight: 600; color: #1c1917; white-space: nowrap; }
.rm-ms-bar-goal { color: #78716c; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rm-ms-bar-stats { color: #57534e; white-space: nowrap; }
.rm-board-hint { height: 300px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #78716c; font-size: 13px; border: 1px dashed #eae7e2; border-radius: 10px; }
.muted { color: #c0c4cc; } .ok { color: #2e7d4f; font-weight: 600; } .bad { color: #b91c1c; font-weight: 600; }
/* v2.8.1(#1148) 三栏布局下内容栏可能只有 800~1000px: 按容器宽自适应 —— 窄时里程碑轨横排成 chips 放到画布上方, 侧栏收窄 */
@container (max-width: 1040px) {
  .rm-body { grid-template-columns: minmax(0, 1fr) 232px; }
  .rm-rail-col { grid-column: 1 / -1; max-height: none; padding: 6px 8px; }
  .rm-rail-col :deep(.rm-rail) { flex-direction: row; flex-wrap: wrap; gap: 6px; align-items: stretch; }
  .rm-rail-col :deep(.rm-rail-item) { min-width: 150px; max-width: 220px; flex: 1 1 150px; padding: 6px 8px; }
  .rm-rail-col :deep(.rm-rail-item .el-progress) { display: none; }
  .rm-rail-col :deep(.rm-rail > .el-button) { width: auto; margin: 0; align-self: center; }
  .rm-rail-col :deep(.rm-rail > .el-link) { align-self: center; margin: 0 4px; }
}
@container (max-width: 720px) {
  .rm-body { grid-template-columns: 1fr; }
}
</style>
