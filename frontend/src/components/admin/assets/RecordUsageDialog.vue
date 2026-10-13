<!-- 登记复用：资产库的生命线 —— 没有这个数就说不清资产库到底省了多少 -->
<template>
  <el-dialog :model-value="modelValue" :title="$t('recordUsageDialog.record_reuse', { p0: asset?.name || '' })" width="520px" append-to-body
    @update:model-value="v => emit('update:modelValue', v)" @open="init">
    <el-form :model="form" label-width="90px">
      <el-form-item :label="$t('recordUsageDialog.used_in_project')" required>
        <el-select v-model="form.projectId" filterable remote :remote-method="searchProjects" :loading="loadingProjects"
          style="width: 100%" :placeholder="$t('common.search_project_name_or_code')" @change="onProjectChange">
          <el-option v-for="p in projects" :key="p.id" :label="`${p.name} (${p.code})`" :value="String(p.id)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('common.related_task')">
        <el-select v-model="form.taskId" filterable clearable :disabled="!form.projectId" style="width: 100%" :placeholder="$t('common.optional')">
          <el-option v-for="t in tasks" :key="t.id" :label="`#${t.id} ${t.title}`" :value="String(t.id)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('recordUsageDialog.how_did_you_use_it')">
        <el-radio-group v-model="form.mode">
          <el-radio value="REFERENCE">{{ $t('common.adapt') }}</el-radio>
          <el-radio value="COPY">{{ $t('common.copy_directory') }}</el-radio>
          <el-radio value="INSTALL">{{ $t('recordUsageDialog.installed') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="$t('recordUsageDialog.how_much_it_saved')">
        <el-input-number v-model="form.savedDays" :min="0" :max="999" :step="0.5" :precision="1" style="width: 140px" />
        <span class="muted">{{ $t('recordUsageDialog.person_days_vs_building_from_scratch') }}</span>
      </el-form-item>
      <el-form-item :label="$t('common.feedback')">
        <el-input v-model="form.feedback" type="textarea" :rows="3" :placeholder="$t('recordUsageDialog.did_it_work_well_what_should')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ $t('common.register') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'

const props = defineProps({
  modelValue: Boolean,
  asset: { type: Object, default: null },
  presetProject: { type: Object, default: null },   // 从项目页/任务里打开时预填
  presetTaskId: { type: [String, Number], default: '' }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const form = reactive({ projectId: '', taskId: '', mode: 'REFERENCE', savedDays: null, feedback: '' })
const projects = ref([])
const tasks = ref([])
const loadingProjects = ref(false)
const saving = ref(false)

async function init() {
  Object.assign(form, {
    projectId: props.presetProject ? String(props.presetProject.id) : '',
    taskId: props.presetTaskId ? String(props.presetTaskId) : '',
    mode: 'REFERENCE', savedDays: props.asset?.estSavedDays != null ? Number(props.asset.estSavedDays) : null, feedback: ''
  })
  projects.value = props.presetProject ? [props.presetProject] : []
  tasks.value = []
  if (props.presetProject) await loadTasks()
  else await searchProjects('')
}
async function searchProjects(kw) {
  loadingProjects.value = true
  try {
    const data = await fde.projects.list({ keyword: kw || '', page_size: 30 })
    projects.value = data?.list || []
  } finally { loadingProjects.value = false }
}
async function loadTasks() {
  if (!form.projectId) return
  const data = await fde.tasks.list({ projectId: form.projectId, page_size: 100 })
  tasks.value = data?.list || []
}
function onProjectChange() { form.taskId = ''; loadTasks() }

async function save() {
  if (!form.projectId) return ElMessage.warning($t('common.choose_project_2'))
  saving.value = true
  try {
    await fde.assets.addUsage(props.asset.id, {
      projectId: form.projectId, taskId: form.taskId || undefined, mode: form.mode,
      savedDays: form.savedDays ?? undefined, feedback: form.feedback || undefined
    })
    ElMessage.success($t('recordUsageDialog.reuse_recorded_thanks'))
    emit('update:modelValue', false)
    emit('saved')
  } catch (e) {
    ElMessage.error(e.message || $t('recordUsageDialog.failed_record'))
  } finally { saving.value = false }
}
</script>

<style scoped>
.muted { color: var(--el-text-color-secondary); font-size: 12px; margin-left: 8px; }
</style>
