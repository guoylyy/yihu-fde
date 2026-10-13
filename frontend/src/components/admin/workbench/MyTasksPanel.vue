<template>
  <!-- v2.6.0(#959) 我的任务: 清单 / 看板(五态) / 按项目 三视图, 就地流转 -->
  <el-card shadow="never" class="block-card">
    <template #header>
      <div class="block-title">
        <span>{{ $t('myTasksPanel.my_tasks', { p0: tasks.length }) }}</span>
        <el-radio-group v-model="view" size="small" style="margin-left: 12px;">
          <el-radio-button value="list">{{ $t('myTasksPanel.list') }}</el-radio-button>
          <el-radio-button value="board">{{ $t('common.board') }}</el-radio-button>
          <el-radio-button value="project">{{ $t('myTasksPanel.by_project') }}</el-radio-button>
        </el-radio-group>
        <div class="filters">
          <el-select v-model="projectFilter" size="small" :placeholder="$t('common.all_projects')" clearable style="width: 150px;">
            <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="String(p.id)" />
          </el-select>
          <el-checkbox v-model="onlyOverdue" size="small" :label="$t('myTasksPanel.overdue_due_today_only')" />
          <el-button link type="primary" size="small" @click="$router.push('/admin/tasks')">{{ $t('myTasksPanel.all_tasks') }}</el-button>
        </div>
      </div>
    </template>

    <el-empty v-if="!filtered.length" :image-size="60" :description="$t('myTasksPanel.no_tasks_in_hand')" />

    <!-- 清单 -->
    <div v-else-if="view === 'list'" class="task-list">
      <div v-for="t in filtered" :key="t.id" class="task-row">
        <el-tag :type="priorityType(t.priority)" size="small" effect="dark">{{ priorityLabel(t.priority) }}</el-tag>
        <div class="task-main" @click="$emit('open-task', String(t.id))">
          <div class="task-title">{{ t.title }}</div>
          <div class="task-meta">{{ t.project?.code }} · {{ t.project?.name }}</div>
        </div>
        <el-tag :type="statusType(t.status)" size="small" effect="light">{{ statusLabel(t.status) }}</el-tag>
        <span v-if="t.dueDate" class="task-due" :class="{ overdue: isOverdue(t) }">{{ String(t.dueDate).slice(0, 10) }}</span>
        <el-button v-if="nextOf(t)" size="small" :loading="busy === String(t.id)" @click="flow(t, nextOf(t).next)">{{ nextOf(t).label }}</el-button>
      </div>
    </div>

    <!-- 看板: 拖到目标列即流转, 卡片上也有「下一步」按钮 -->
    <div v-else-if="view === 'board'" class="board">
      <div
        v-for="col in COLUMNS"
        :key="col.key"
        class="board-col"
        :class="{ over: dragOver === col.key }"
        @dragover.prevent="dragOver = col.key"
        @dragleave="dragOver = dragOver === col.key ? '' : dragOver"
        @drop="onDrop(col.key)"
      >
        <div class="col-head">
          <span>{{ col.label }}</span>
          <span class="col-count">{{ byStatus(col.key).length }}</span>
        </div>
        <div
          v-for="t in byStatus(col.key)"
          :key="t.id"
          class="board-card"
          draggable="true"
          @dragstart="dragging = t"
          @dragend="dragging = null; dragOver = ''"
          @click="$emit('open-task', String(t.id))"
        >
          <div class="card-title">{{ t.title }}</div>
          <div class="card-meta">
            <el-tag :type="priorityType(t.priority)" size="small" effect="plain">{{ priorityLabel(t.priority) }}</el-tag>
            <span v-if="t.dueDate" :class="{ overdue: isOverdue(t) }">{{ String(t.dueDate).slice(5, 10) }}</span>
          </div>
          <div class="card-proj">{{ t.project?.name }}</div>
        </div>
        <div v-if="col.key === 'DONE'" class="col-hint">{{ $t('myTasksPanel.drop_here_built') }}</div>
      </div>
    </div>

    <!-- 按项目 -->
    <div v-else class="by-project">
      <div v-for="g in groupedByProject" :key="g.id" class="proj-group">
        <div class="group-head" @click="$router.push(`/admin/projects/${g.id}`)">
          <strong>{{ g.name }}</strong>
          <span class="code">{{ g.code }}</span>
          <span class="cnt">{{ $t('myTasksPanel.tasks', { p0: g.tasks.length }) }}</span>
        </div>
        <div v-for="t in g.tasks" :key="t.id" class="task-row">
          <el-tag :type="statusType(t.status)" size="small" effect="light">{{ statusLabel(t.status) }}</el-tag>
          <div class="task-main" @click="$emit('open-task', String(t.id))">
            <div class="task-title">{{ t.title }}</div>
          </div>
          <span v-if="t.dueDate" class="task-due" :class="{ overdue: isOverdue(t) }">{{ String(t.dueDate).slice(0, 10) }}</span>
          <el-button v-if="nextOf(t)" size="small" :loading="busy === String(t.id)" @click="flow(t, nextOf(t).next)">{{ nextOf(t).label }}</el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde } from '@/api/index.js'

const props = defineProps({ tasks: { type: Array, default: () => [] } })
const emit = defineEmits(['refresh', 'open-task'])

const view = ref('list')
const projectFilter = ref('')
const onlyOverdue = ref(false)
const busy = ref('')
const dragging = ref(null)
const dragOver = ref('')

// v1.9.7 五态 + v2.1.8 REWORK
const COLUMNS = [
  { key: 'TODO', label: $t('common.inbox') },
  { key: 'QUEUED', label: $t('common.queued') },
  { key: 'IN_PROGRESS', label: $t('common.in_progress_2') },
  { key: 'DONE', label: $t('common.built') }
]
const STATUS_LABELS = { TODO: $t('common.inbox'), QUEUED: $t('common.queued'), IN_PROGRESS: $t('common.in_progress_2'), DONE: $t('common.built'), VERIFIED: $t('common.accepted'), REWORK: $t('common.rework') }
const STATUS_TYPES = { TODO: 'info', QUEUED: 'warning', IN_PROGRESS: 'primary', DONE: 'success', VERIFIED: 'success', REWORK: 'danger' }
const PRIORITY_LABELS = { LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high'), URGENT: $t('common.urgent') }
const PRIORITY_TYPES = { LOW: 'info', MEDIUM: 'primary', HIGH: 'warning', URGENT: 'danger' }
function statusLabel(s) { return STATUS_LABELS[s] || s }
function statusType(s) { return STATUS_TYPES[s] || 'info' }
function priorityLabel(p) { return PRIORITY_LABELS[p] || p }
function priorityType(p) { return PRIORITY_TYPES[p] || 'info' }

const todayKey = new Date().toLocaleDateString('sv')   // sv 本地格式即 YYYY-MM-DD
function isOverdue(t) { return t.dueDate && String(t.dueDate).slice(0, 10) < todayKey }
function isDueToday(t) { return t.dueDate && String(t.dueDate).slice(0, 10) === todayKey }

const filtered = computed(() => props.tasks.filter(t => {
  if (projectFilter.value && String(t.project?.id) !== projectFilter.value) return false
  if (onlyOverdue.value && !isOverdue(t) && !isDueToday(t)) return false
  return true
}))
const projectOptions = computed(() => {
  const m = new Map()
  for (const t of props.tasks) if (t.project) m.set(String(t.project.id), t.project)
  return [...m.values()]
})
const groupedByProject = computed(() => {
  const m = new Map()
  for (const t of filtered.value) {
    const p = t.project || { id: '0', name: $t('myTasksPanel.no_project'), code: '—' }
    const k = String(p.id)
    if (!m.has(k)) m.set(k, { ...p, tasks: [] })
    m.get(k).tasks.push(t)
  }
  return [...m.values()]
})
function byStatus(s) { return filtered.value.filter(t => t.status === s) }

const NEXT = {
  TODO: { next: 'QUEUED', label: $t('myTasksPanel.queue_for_work') },
  QUEUED: { next: 'IN_PROGRESS', label: $t('common.start') },
  IN_PROGRESS: { next: 'DONE', label: $t('common.done_2') }
}
function nextOf(t) { return NEXT[t.status] || null }

async function flow(t, status) {
  busy.value = String(t.id)
  try {
    if (status === 'DONE') {
      await ElMessageBox.confirm($t('myTasksPanel.mark_as_built_your_manager_will', { p0: t.title }), $t('common.complete_task'), { type: 'warning' })
    }
    await fde.tasks.changeStatus(String(t.id), status)
    ElMessage.success($t('myTasksPanel.updated', { p0: statusLabel(status) }))
    emit('refresh')
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || $t('common.action_failed'))
  } finally {
    busy.value = ''
  }
}

function onDrop(status) {
  const t = dragging.value
  dragOver.value = ''
  dragging.value = null
  if (!t || t.status === status) return
  flow(t, status)
}
</script>

<style scoped>
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; gap: 6px; font-weight: 600; flex-wrap: wrap; }
.filters { display: flex; align-items: center; gap: 10px; margin-left: auto; }

.task-list, .by-project { display: flex; flex-direction: column; }
.task-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f3f1ed; }
.task-row:last-child { border-bottom: none; }
.task-main { flex: 1; min-width: 0; cursor: pointer; }
.task-title { color: #1c1917; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-meta { font-size: 12px; color: #8f8a82; }
.task-due { font-size: 12px; color: #8f8a82; font-family: monospace; }
.task-due.overdue, .overdue { color: #c2362b; font-weight: 600; }

.board { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.board-col { background: #faf9f7; border: 1px solid #eae7e2; border-radius: 8px; padding: 8px; min-height: 140px; transition: all .15s; }
.board-col.over { border-color: #d2521e; background: #fdf6f2; }
.col-head { display: flex; justify-content: space-between; font-size: 12px; color: #5c574f; font-weight: 600; margin-bottom: 8px; }
.col-count { color: #8f8a82; }
.board-card { background: #fff; border: 1px solid #eae7e2; border-radius: 6px; padding: 8px; margin-bottom: 8px; cursor: grab; }
.board-card:hover { border-color: #d2521e; }
.card-title { font-size: 13px; color: #1c1917; margin-bottom: 6px; }
.card-meta { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #8f8a82; }
.card-proj { font-size: 11px; color: #a8a29a; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-hint { font-size: 11px; color: #a8a29a; text-align: center; padding: 6px 0; border: 1px dashed #ddd9d2; border-radius: 6px; }

.proj-group { margin-bottom: 10px; }
.group-head { display: flex; align-items: center; gap: 10px; padding: 6px 0; cursor: pointer; }
.group-head .code { font-family: monospace; font-size: 12px; color: #8f8a82; }
.group-head .cnt { font-size: 12px; color: #8f8a82; margin-left: auto; }

@media (max-width: 900px) {
  .board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
