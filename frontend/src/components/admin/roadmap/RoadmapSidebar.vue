<template>
  <!-- v2.8.0(#1144) 路径图侧栏: 选中任务节点 / 边 / 里程碑的摘要与快捷操作 -->
  <div class="rm-side">
    <template v-if="!selection">
      <div class="rm-side-empty">
        <div class="rm-side-title">{{ $t('roadmapSidebar.roadmap') }}</div>
        <p>{{ $t('roadmapSidebar.click_node_for_details_drag_from') }}</p>
        <template v-if="data">
          <div class="rm-kv"><span>{{ $t('common.task') }}</span><b>{{ data.stats.total }}</b></div>
          <div class="rm-kv"><span>{{ $t('common.done_2') }}</span><b>{{ data.stats.done }}</b></div>
          <div class="rm-kv"><span>{{ $t('common.ready') }}</span><b class="ok">{{ data.stats.ready }}</b></div>
          <div class="rm-kv"><span>{{ $t('common.blocked') }}</span><b class="bad">{{ data.stats.blocked }}</b></div>
          <div class="rm-kv" v-if="data.criticalPath?.taskIds?.length"><span>{{ $t('roadmapSidebar.critical_path') }}</span><b>{{ $t('roadmapSidebar.steps_about_days', { p0: data.criticalPath.taskIds.length, p1: data.criticalPath.totalDays }) }}</b></div>
          <div v-if="data.ready.length" class="rm-ready-list">
            <div class="rm-side-sub">{{ $t('roadmapSidebar.can_start_now') }}</div>
            <el-link v-for="id in data.ready.slice(0, 6)" :key="id" type="primary" :underline="false" class="rm-ready-link" @click="$emit('focus', id)">#{{ id }} {{ nodeTitle(id) }}</el-link>
          </div>
        </template>
      </div>
    </template>

    <!-- 任务节点 -->
    <template v-else-if="selection.kind === 'task'">
      <div class="rm-side-title">#{{ t.id }} <el-tag size="small" :type="STATUS_TYPES[t.status]" effect="plain">{{ STATUS_LABELS[t.status] || t.status }}</el-tag></div>
      <div class="rm-side-name">{{ t.title }}</div>
      <div v-if="t.external" class="rm-note">{{ $t('roadmapSidebar.prerequisite_from_another_milestone_read_only', { p0: t.milestoneName || $t('common.no_milestone') }) }}</div>
      <div class="rm-kv"><span>{{ $t('common.owner') }}</span><b>{{ $t('common.p0', { p0: t.assignee?.name || $t('common.unassigned') }) }}</b></div>
      <div class="rm-kv"><span>{{ $t('common.priority') }}</span><el-tag size="small" :type="PRIORITY_TYPES[t.priority]" effect="dark">{{ PRIORITY_LABELS[t.priority] || t.priority }}</el-tag></div>
      <div class="rm-kv" v-if="t.dueDate"><span>{{ $t('common.due') }}</span><b>{{ String(t.dueDate).slice(0, 10) }}</b></div>
      <div class="rm-kv" v-if="t.subtaskStats?.total"><span>{{ $t('common.subtasks') }}</span><b>{{ t.subtaskStats.done }}/{{ t.subtaskStats.total }}</b></div>
      <!-- v2.9.0(#1163) 机器人运行: 状态/进度/事件流/结果 -->
      <div v-if="run" class="rm-run-box" :class="`run-${run.status.toLowerCase()}`">
        <div class="rm-run-head">
          <el-tag size="small" :type="RUN_STATUS_TYPES[run.status]" effect="dark">{{ RUN_STATUS_LABELS[run.status] }}</el-tag>
          <b v-if="run.agentName">🤖 {{ run.agentName }}</b>
          <span v-if="run.stale" class="bad">{{ $t('common.lost_contact_for_min', { p0: staleMin }) }}</span>
          <span v-if="run.attempts > 1" class="muted">{{ $t('roadmapSidebar.run', { p0: run.attempts }) }}</span>
        </div>
        <el-progress v-if="run.status === 'RUNNING'" :percentage="run.progress" :stroke-width="8" :status="run.stale ? 'exception' : undefined" style="margin: 6px 0;" />
        <div v-if="run.phase || run.message" class="rm-run-msg"><b v-if="run.phase">{{ run.phase }}</b> {{ run.message }}</div>
        <div v-if="run.result?.summary" class="rm-run-result">
          <div class="rm-side-sub">{{ $t('roadmapSidebar.result') }}</div>
          <div class="rm-run-summary">{{ run.result.summary }}</div>
          <div v-for="c in run.result.commits || []" :key="c.sha" class="rm-mini">
            <el-link v-if="c.url" :href="c.url" target="_blank" type="primary" :underline="false">{{ (c.sha || '').slice(0, 8) }}</el-link><code v-else>{{ (c.sha || '').slice(0, 8) }}</code> {{ c.message || '' }}
          </div>
          <div v-if="run.result.prUrl" class="rm-mini">PR: <el-link :href="run.result.prUrl" target="_blank" type="primary">{{ run.result.prUrl }}</el-link></div>
          <div v-if="run.result.testResult" class="rm-mini">{{ $t('roadmapSidebar.tests', { p0: run.result.testResult }) }}</div>
        </div>
        <div v-if="run.error" class="rm-run-error">{{ run.error }}</div>
        <div class="rm-side-sub">{{ $t('roadmapSidebar.events') }} <el-button link size="small" @click="loadEvents">{{ $t('common.refresh') }}</el-button></div>
        <div class="rm-events">
          <div v-for="e in events" :key="e.id" class="rm-event" :class="`lv-${e.level.toLowerCase()}`">
            <span class="rm-event-time">{{ fmtTime(e.createdAt) }}</span>
            <span v-if="e.progress != null" class="rm-event-pct">{{ e.progress }}%</span>
            <span class="rm-event-msg">{{ e.message }}</span>
          </div>
          <div v-if="!events.length" class="muted" style="font-size: 12px;">{{ $t('roadmapSidebar.no_events') }}</div>
        </div>
        <div class="rm-actions" v-if="canEdit">
          <el-button v-if="['PENDING', 'RUNNING'].includes(run.status)" size="small" type="danger" plain @click="$emit('cancel-run', run)">{{ $t('common.cancel_run') }}</el-button>
          <el-button v-if="['FAILED', 'CANCELLED'].includes(run.status) && !isDone(t.status)" size="small" type="primary" plain @click="$emit('redispatch-run', run)">{{ $t('common.redispatch') }}</el-button>
        </div>
      </div>
      <div v-if="t.blocked" class="rm-blocked-box">{{ $t('roadmapSidebar.blocked_by_unfinished_prerequisites', { p0: t.blockedBy.length }) }}<div v-for="id in t.blockedBy" :key="id" class="rm-mini">#{{ id }} {{ nodeTitle(id) }}</div></div>
      <div v-else-if="t.ready" class="rm-ready-box">{{ $t('roadmapSidebar.all_prerequisites_done_ready_start') }}</div>

      <div class="rm-side-sub">{{ $t('roadmapSidebar.prerequisites_first', { p0: t.predecessors.length }) }}</div>
      <div v-for="e in edgesOf('in')" :key="e.id" class="rm-edge-row" :class="e.type.toLowerCase()">
        <el-link :underline="false" @click="$emit('focus', e.source)">#{{ e.source }} {{ nodeTitle(e.source) }}</el-link>
        <span class="rm-edge-type">{{ DEP_TYPE_LABELS[e.type] }}</span>
        <el-button v-if="canEdit" link type="danger" size="small" @click="$emit('remove-edge', e)">{{ $t('roadmapSidebar.remove') }}</el-button>
      </div>
      <div class="rm-side-sub">{{ $t('roadmapSidebar.next_after', { p0: t.successors.length }) }}</div>
      <div v-for="e in edgesOf('out')" :key="e.id" class="rm-edge-row" :class="e.type.toLowerCase()">
        <el-link :underline="false" @click="$emit('focus', e.target)">#{{ e.target }} {{ nodeTitle(e.target) }}</el-link>
        <span class="rm-edge-type">{{ DEP_TYPE_LABELS[e.type] }}</span>
        <el-button v-if="canEdit" link type="danger" size="small" @click="$emit('remove-edge', e)">{{ $t('roadmapSidebar.remove') }}</el-button>
      </div>

      <div class="rm-actions" v-if="!t.external">
        <el-button size="small" type="primary" plain @click="$emit('open-task', t.id)">{{ $t('roadmapSidebar.open_details') }}</el-button>
        <el-button v-if="canEdit" size="small" plain @click="$emit('create-successor', t)">{{ $t('roadmapSidebar.next_task') }}</el-button>
        <template v-if="canChangeStatus">
          <el-button v-if="t.status === 'TODO'" size="small" type="warning" plain @click="$emit('change-status', t, 'QUEUED')">{{ $t('common.move_queue') }}</el-button>
          <el-button v-if="t.status === 'QUEUED' || t.status === 'REWORK'" size="small" type="primary" @click="$emit('change-status', t, 'IN_PROGRESS')">{{ $t('common.start_work') }}</el-button>
          <el-button v-if="t.status === 'IN_PROGRESS'" size="small" type="success" @click="$emit('change-status', t, 'DONE')">{{ $t('common.built') }}</el-button>
        </template>
      </div>
    </template>

    <!-- 边 -->
    <template v-else-if="selection.kind === 'edge'">
      <div class="rm-side-title">{{ $t('roadmapSidebar.dependencies') }}</div>
      <div class="rm-edge-pair">
        <div class="rm-mini">{{ $t('roadmapSidebar.prerequisite', { p0: ed.source, p1: nodeTitle(ed.source) }) }}</div>
        <div class="rm-arrow">↓</div>
        <div class="rm-mini">{{ $t('roadmapSidebar.next', { p0: ed.target, p1: nodeTitle(ed.target) }) }}</div>
      </div>
      <div class="rm-kv"><span>{{ $t('common.type') }}</span>
        <el-radio-group :model-value="ed.type" size="small" :disabled="!canEdit" @change="v => $emit('update-edge', ed, { type: v })">
          <el-radio-button value="BLOCKS">{{ $t('common.hard_dependency') }}</el-radio-button>
          <el-radio-button value="FEEDBACK">{{ $t('common.loop') }}</el-radio-button>
        </el-radio-group>
      </div>
      <p class="rm-hint">{{ $t('roadmapSidebar.hard_dependency_until_prerequisite_done_next') }}</p>
      <div class="rm-kv" style="align-items: flex-start;"><span>{{ $t('common.notes_2') }}</span>
        <el-input v-model="noteDraft" size="small" :disabled="!canEdit" :placeholder="$t('roadmapSidebar.e_g_waiting_for_api_doc')" maxlength="200" @blur="saveNote" @keyup.enter="saveNote" />
      </div>
      <div class="rm-actions">
        <el-button v-if="canEdit" size="small" type="danger" plain @click="$emit('remove-edge', ed)">{{ $t('common.remove_dependency') }}</el-button>
      </div>
    </template>

    <!-- 里程碑终点 -->
    <template v-else-if="selection.kind === 'milestone'">
      <div class="rm-side-title">{{ $t('roadmapSidebar.milestone_finish') }}</div>
      <div class="rm-side-name">{{ selection.data.name }}</div>
      <div class="rm-kv"><span>{{ $t('common.status') }}</span><el-tag size="small" :type="MS_STATUS_TYPES[selection.data.status]">{{ MS_STATUS_LABELS[selection.data.status] || selection.data.status }}</el-tag></div>
      <div class="rm-kv" v-if="selection.data.plannedDate"><span>{{ $t('roadmapSidebar.plan') }}</span><b>{{ String(selection.data.plannedDate).slice(0, 10) }}</b></div>
      <div class="rm-side-sub">{{ $t('common.definition_done') }}</div>
      <p class="rm-goal">{{ $t('common.p0', { p0: selection.data.goal || $t('roadmapSidebar.no_definition_done_yet_in_one') }) }}</p>
      <div class="rm-actions">
        <el-button v-if="canEdit" size="small" plain @click="$emit('edit-milestone', selection.data)">{{ $t('common.edit_milestone') }}</el-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { STATUS_LABELS, STATUS_TYPES, PRIORITY_LABELS, PRIORITY_TYPES, MS_STATUS_LABELS, MS_STATUS_TYPES, DEP_TYPE_LABELS, RUN_STATUS_LABELS, RUN_STATUS_TYPES, isDone } from './roadmapUtils.js'
import { fde } from '@/api/index.js'

const props = defineProps({
  selection: { type: Object, default: null },   // { kind: 'task'|'edge'|'milestone', data }
  data: { type: Object, default: null },        // roadmap
  canEdit: { type: Boolean, default: false },
  canChangeStatus: { type: Boolean, default: false }
})
const emit = defineEmits(['open-task', 'focus', 'remove-edge', 'update-edge', 'change-status', 'create-successor', 'edit-milestone', 'cancel-run', 'redispatch-run'])

const t = computed(() => props.selection?.data || {})
const ed = computed(() => props.selection?.data || {})
const nodeMap = computed(() => new Map((props.data?.nodes || []).map(n => [n.id, n])))
function nodeTitle(id) { return nodeMap.value.get(String(id))?.title || '' }
function edgesOf(dir) {
  const id = t.value.id
  return (props.data?.edges || []).filter(e => dir === 'in' ? e.target === id : e.source === id).map(e => ({ ...e, id: e.id }))
}
// v2.9.0(#1163) 选中任务的机器人运行(来自 roadmap.runs) + 事件流(单独拉, 选中/轮询时刷新)
const run = computed(() => props.selection?.kind === 'task' ? (props.data?.runs?.[props.selection.data.id] || null) : null)
const staleMin = computed(() => run.value?.heartbeatAt ? Math.round((Date.now() - new Date(run.value.heartbeatAt).getTime()) / 60000) : 0)
const events = ref([])
async function loadEvents() {
  if (!run.value) { events.value = []; return }
  try { const d = await fde.devDispatches.run(run.value.id, 30); events.value = d.events || [] } catch { events.value = [] }
}
watch(() => [run.value?.id, run.value?.updatedAt, run.value?.progress, run.value?.status], loadEvents, { immediate: true })
function fmtTime(s) { const d = new Date(s); const p = n => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
const noteDraft = ref('')
watch(() => props.selection, s => { noteDraft.value = s?.kind === 'edge' ? (s.data.note || '') : '' }, { immediate: true })
function saveNote() {
  if (props.selection?.kind !== 'edge' || !props.canEdit) return
  if ((noteDraft.value || '') === (ed.value.note || '')) return
  emit('update-edge', ed.value, { note: noteDraft.value })
}
</script>

<style scoped>
.rm-side { font-size: 12px; color: #44403c; }
.rm-side-title { font-size: 13px; font-weight: 600; color: #1c1917; display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.rm-side-name { font-size: 14px; font-weight: 600; color: #1c1917; line-height: 1.4; margin-bottom: 10px; }
.rm-side-sub { font-size: 11px; color: #a8a29e; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: .02em; }
.rm-side-empty p { color: #78716c; line-height: 1.6; margin: 0 0 10px; }
.rm-kv { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
.rm-kv > span { color: #a8a29e; min-width: 44px; }
.rm-kv b { font-weight: 600; color: #1c1917; }
.rm-kv b.ok { color: #2e7d4f; } .rm-kv b.bad { color: #b91c1c; }
.rm-note { background: #fafaf9; border: 1px dashed #e7e5e4; border-radius: 6px; padding: 6px 8px; margin-bottom: 8px; color: #78716c; }
.rm-blocked-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 6px 8px; margin-top: 8px; color: #991b1b; }
.rm-ready-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 6px 8px; margin-top: 8px; color: #166534; }
.rm-mini { font-size: 12px; color: #44403c; line-height: 1.6; }
.rm-edge-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; border-bottom: 1px dashed #f5f5f4; }
.rm-edge-row :deep(.el-link) { font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rm-edge-type { font-size: 10px; padding: 0 5px; border-radius: 4px; background: #f5f5f4; color: #78716c; }
.rm-edge-row.feedback .rm-edge-type { background: #f3e8ff; color: #6d28d9; }
.rm-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.rm-actions .el-button + .el-button { margin-left: 0; }
.rm-edge-pair { background: #fafaf9; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.rm-arrow { color: #a8a29e; text-align: center; }
.rm-hint { color: #a8a29e; line-height: 1.5; margin: 4px 0 8px; }
.rm-goal { line-height: 1.6; color: #44403c; background: #fafaf9; border-radius: 6px; padding: 8px; margin: 0; }
.rm-ready-list { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
/* v2.9.0(#1163) 机器人运行 */
.rm-run-box { border: 1px solid #bfdbfe; background: #f8fbff; border-radius: 8px; padding: 8px; margin-top: 8px; }
.rm-run-box.run-succeeded { border-color: #bbf7d0; background: #f6fef8; }
.rm-run-box.run-failed { border-color: #fecaca; background: #fff7f7; }
.rm-run-box.run-pending, .rm-run-box.run-cancelled { border-color: #e7e5e4; background: #fafaf9; }
.rm-run-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rm-run-msg { font-size: 12px; color: #44403c; margin-top: 4px; }
.rm-run-summary { font-size: 12px; line-height: 1.6; white-space: pre-wrap; color: #1c1917; }
.rm-run-error { font-size: 12px; color: #991b1b; white-space: pre-wrap; margin-top: 6px; max-height: 120px; overflow: auto; }
.rm-events { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.rm-event { display: flex; gap: 6px; font-size: 11px; color: #57534e; line-height: 1.5; }
.rm-event.lv-warn { color: #92400e; } .rm-event.lv-error { color: #991b1b; }
.rm-event-time { color: #a8a29e; font-family: ui-monospace, Menlo, monospace; flex: none; }
.rm-event-pct { color: #1d4ed8; font-weight: 600; flex: none; min-width: 30px; }
.rm-event-msg { flex: 1; word-break: break-all; }
.muted { color: #a8a29e; }
.bad { color: #b91c1c; }
.rm-ready-link { font-size: 12px; justify-content: flex-start; }
</style>
