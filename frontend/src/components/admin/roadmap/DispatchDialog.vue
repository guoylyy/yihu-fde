<template>
  <!-- v2.9.0(#1163) 派工弹窗: 范围 / 机器人 / 备注 → 建即启动 -->
  <el-dialog :model-value="modelValue" :title="$t('dispatchDialog.dispatch_dev_robots')" width="560px" append-to-body @update:model-value="v => $emit('update:modelValue', v)" @open="onOpen">
    <el-form label-width="84px">
      <el-form-item :label="$t('dispatchDialog.scope')">
        <el-radio-group v-model="scope">
          <el-radio-button value="MILESTONE" :disabled="!milestoneId">{{ $t('dispatchDialog.all_unfinished_in_milestone') }}</el-radio-button>
          <el-radio-button value="READY">{{ $t('dispatchDialog.only_ready_ones') }}</el-radio-button>
          <el-radio-button value="TASKS" :disabled="!selectedTaskIds.length">{{ $t('dispatchDialog.selected', { p0: selectedTaskIds.length || '' }) }}</el-radio-button>
        </el-radio-group>
        <div class="dp-hint">
          <template v-if="scope === 'MILESTONE'">{{ $t('dispatchDialog.all_unfinished_tasks_in_milestone_queued', { p0: milestoneName }) }}</template>
          <template v-else-if="scope === 'READY'">{{ $t('dispatchDialog.only_tasks_that_can_start_now', { p0: readyCount }) }}</template>
          <template v-else>{{ $t('dispatchDialog.only_tasks_you_selected_in_list') }}</template>
          <span v-if="previewCount != null"> {{ $t('dispatchDialog.will_queue') }} <b>{{ previewCount }}</b> {{ $t('dispatchDialog.text') }}</span>
        </div>
      </el-form-item>
      <el-form-item :label="$t('common.robot')">
        <el-select v-model="agentProfileId" clearable :placeholder="$t('dispatchDialog.any_online_robot_can_take_it')" style="width: 100%;" :loading="robotsLoading">
          <el-option v-for="r in robots" :key="r.id" :value="r.id" :label="r.name">
            <span :class="['dp-dot', r.online ? 'on' : 'off']"></span>{{ r.name }}
            <span class="dp-robot-sub">{{ $t('common.p0', { p0: r.online ? (r.current ? $t('dispatchDialog.working_on', { p0: r.current.taskId, p1: r.current.progress }) : $t('common.online_idle')) : $t('common.offline') }) }}<template v-if="r.owner"> · {{ r.owner }}</template></span>
          </el-option>
        </el-select>
        <div class="dp-hint">
          {{ $t('dispatchDialog.online_registered', { p0: robots.filter(r => r.online).length, p1: robots.length }) }}
          <template v-if="!robots.length">{{ $t('dispatchDialog.no_robots_yet_on_agents_page') }}</template>
          <template v-else-if="!robots.some(r => r.online)">{{ $t('dispatchDialog.none_online_right_now_dispatch_will') }}</template>
        </div>
      </el-form-item>
      <el-form-item :label="$t('common.notes')">
        <el-input v-model="note" type="textarea" :rows="3" maxlength="5000" :placeholder="$t('dispatchDialog.constraints_or_hints_for_robot_e')" />
      </el-form-item>
      <el-form-item :label="$t('common.title')">
        <el-input v-model="title" maxlength="200" :placeholder="milestoneName ? $t('dispatchDialog.dispatch', { p0: milestoneName }) : $t('common.dispatch')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" :disabled="previewCount === 0" @click="submit">{{ $t('dispatchDialog.start_dispatch') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { isDone } from './roadmapUtils.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  projectId: { type: [Number, String], required: true },
  milestoneId: { type: String, default: '' },
  milestoneName: { type: String, default: '' },
  data: { type: Object, default: null },            // roadmap(算预览数量)
  selectedTaskIds: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'created'])
const scope = ref('MILESTONE')
const agentProfileId = ref('')
const note = ref('')
const title = ref('')
const robots = ref([])
const robotsLoading = ref(false)
const submitting = ref(false)

const busyIds = computed(() => new Set(Object.entries(props.data?.runs || {}).filter(([, r]) => ['PENDING', 'RUNNING'].includes(r.status)).map(([id]) => id)))
const readyCount = computed(() => (props.data?.nodes || []).filter(n => !n.external && n.ready && !busyIds.value.has(n.id)).length)
const previewCount = computed(() => {
  const nodes = (props.data?.nodes || []).filter(n => !n.external && !isDone(n.status) && !busyIds.value.has(n.id))
  if (scope.value === 'READY') return nodes.filter(n => n.ready).length
  if (scope.value === 'TASKS') return props.selectedTaskIds.filter(id => nodes.some(n => n.id === String(id))).length
  return props.milestoneId ? nodes.length : null
})

async function onOpen() {
  scope.value = props.selectedTaskIds.length ? 'TASKS' : (props.milestoneId && props.milestoneId !== 'none' ? 'MILESTONE' : 'READY')
  robotsLoading.value = true
  try { robots.value = (await fde.devDispatches.robots()).list || [] } catch { robots.value = [] } finally { robotsLoading.value = false }
}
async function submit() {
  submitting.value = true
  try {
    const r = await fde.devDispatches.create({
      projectId: props.projectId,
      milestoneId: props.milestoneId && props.milestoneId !== 'none' ? props.milestoneId : undefined,
      scope: scope.value,
      taskIds: scope.value === 'TASKS' ? props.selectedTaskIds : undefined,
      agentProfileId: agentProfileId.value || undefined,
      note: note.value || undefined,
      title: title.value || undefined
    })
    ElMessage.success($t('dispatchDialog.dispatch_started_tasks_queued', { p0: r.runCount, p1: r.skippedBusy?.length ? $t('dispatchDialog.skipped_already_in_another_dispatch', { p0: r.skippedBusy.length }) : '' }))
    note.value = ''; title.value = ''
    emit('created', r)
    emit('update:modelValue', false)
  } catch (e) { ElMessage({ type: 'error', message: e.message || $t('dispatchDialog.failed_start'), duration: 6000, showClose: true }) }
  finally { submitting.value = false }
}
</script>

<style scoped>
.dp-hint { font-size: 12px; color: #78716c; line-height: 1.6; margin-top: 4px; width: 100%; }
.dp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: #c0c4cc; }
.dp-dot.on { background: #22c55e; }
.dp-robot-sub { float: right; font-size: 12px; color: #a8a29e; }
</style>
