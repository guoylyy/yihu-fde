<template>
  <!-- v2.6.0(#959) 待办收件箱: 把散落各模块「该我动手的事」抹平成一条流, 每条就地办完 -->
  <el-card shadow="never" class="block-card inbox">
    <template #header>
      <div class="block-title">
        <span>{{ $t('todoInbox.inbox') }}</span>
        <el-tag v-if="urgentCount" type="danger" size="small" effect="dark" style="margin-left: 8px;">{{ $t('todoInbox.urgent', { p0: urgentCount }) }}</el-tag>
        <el-radio-group v-model="tab" size="small" style="margin-left: auto;">
          <el-radio-button value="all">{{ $t('todoInbox.all', { p0: counts.total || 0 }) }}</el-radio-button>
          <el-radio-button value="mine">{{ $t('todoInbox.my_dos', { p0: counts.mine || 0 }) }}</el-radio-button>
          <el-radio-button v-if="counts.approve" value="approve">{{ $t('todoInbox.waiting_for_me', { p0: counts.approve }) }}</el-radio-button>
        </el-radio-group>
        <el-button link type="primary" size="small" style="margin-left: 8px;" @click="$emit('refresh')">{{ $t('common.refresh') }}</el-button>
      </div>
    </template>

    <div v-loading="loading">
      <el-empty v-if="!filtered.length" :image-size="60" :description="$t('todoInbox.nothing_do_all_clear')" />
      <div v-else class="todo-list">
        <div v-for="it in filtered" :key="it.id" class="todo-row" :class="'sev-' + it.severity">
          <span class="sev-bar"></span>
          <el-tag size="small" effect="plain" class="kind-tag">{{ kindLabel(it.kind) }}</el-tag>
          <div class="todo-main" @click="open(it)">
            <div class="todo-title">{{ it.title }}</div>
            <div class="todo-sub">
              <span v-if="it.project" class="proj">{{ it.project.code }} · {{ it.project.name }}</span>
              <span v-if="it.sub" :class="{ danger: it.severity === 'URGENT' }">{{ it.sub }}</span>
              <span v-if="it.dueDate" class="due" :class="{ danger: it.severity === 'URGENT' }">{{ $t('todoInbox.due', { p0: it.dueDate }) }}</span>
            </div>
          </div>
          <el-button
            v-if="it.action"
            :type="it.severity === 'URGENT' ? 'danger' : 'primary'"
            size="small"
            :loading="busy === it.id"
            @click="run(it)"
          >{{ it.action.label }}</el-button>
          <el-button link size="small" @click="open(it)">{{ $t('common.details') }}</el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde } from '@/api/index.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  counts: { type: Object, default: () => ({}) },
  loading: Boolean
})
const emit = defineEmits(['refresh', 'open-task'])

const router = useRouter()
const tab = ref('all')
const busy = ref('')

const filtered = computed(() => {
  if (tab.value === 'mine') return props.items.filter(i => i.kind !== 'APPROVAL')
  if (tab.value === 'approve') return props.items.filter(i => i.kind === 'APPROVAL')
  return props.items
})
const urgentCount = computed(() => props.items.filter(i => i.severity === 'URGENT').length)

const KIND_LABELS = { TASK: $t('common.task'), TIMESHEET: $t('common.hours'), APPROVAL: $t('common.approvals') }
function kindLabel(k) { return KIND_LABELS[k] || k }

function open(it) {
  if (it.kind === 'TASK') return emit('open-task', it.refId)
  if (it.link) router.push(it.link)
}

/** 主操作: 能就地办的就地办, 办不了的跳到对应模块 */
async function run(it) {
  const a = it.action
  if (!a) return
  busy.value = it.id
  try {
    if (a.key === 'task.queue' || a.key === 'task.start' || a.key === 'task.done') {
      if (a.key === 'task.done') {
        await ElMessageBox.confirm($t('todoInbox.mark_as_built', { p0: it.title }), $t('common.complete_task'), { type: 'warning' })
      }
      await fde.tasks.changeStatus(a.taskId, a.next)
      ElMessage.success($t('todoInbox.task_status_updated'))
      emit('refresh')
    } else if (a.key === 'timesheet.submitWeek') {
      await ElMessageBox.confirm($t('todoInbox.submit_draft_entries_from_this_week', { p0: a.ids.length }), $t('common.submit_hours'), { type: 'warning' })
      const r = await fde.timesheets.submitBatch(a.ids)
      ElMessage.success($t('common.submitted_entries_h_total', { p0: r.submitted, p1: r.hours }))
      emit('refresh')
    } else {
      open(it)
    }
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || $t('common.action_failed'))
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }

.todo-list { display: flex; flex-direction: column; }
.todo-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 4px 10px 0;
  border-bottom: 1px solid #f3f1ed;
  position: relative;
}
.todo-row:last-child { border-bottom: none; }
.sev-bar { width: 3px; height: 28px; border-radius: 2px; background: #ddd9d2; flex: none; }
.sev-URGENT .sev-bar { background: #c2362b; }
.sev-HIGH .sev-bar { background: #d2521e; }
.kind-tag { flex: none; width: 52px; text-align: center; }
.todo-main { flex: 1; min-width: 0; cursor: pointer; }
.todo-title { color: #1c1917; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo-sub { font-size: 12px; color: #8f8a82; display: flex; gap: 10px; margin-top: 2px; flex-wrap: wrap; }
.todo-sub .proj { font-family: monospace; }
.todo-sub .danger, .danger { color: #c2362b; }
</style>
