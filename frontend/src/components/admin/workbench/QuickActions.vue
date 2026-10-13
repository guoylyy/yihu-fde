<template>
  <!-- 工作台快捷操作: 记工时 / 建任务 / 提想法, 常用动作不用离开本页 -->
  <div class="quick-actions">
    <!-- 工作台全员可进, 动作按权限显隐, 别让人点了才吃 403 -->
    <el-button v-if="can('timesheet.create')" type="primary" @click="openLog">{{ $t('quickActions.log_hours') }}</el-button>
    <el-button v-if="can('task.create')" @click="openTask">{{ $t('quickActions.new_task') }}</el-button>
    <el-button v-if="can('idea.create')" @click="$router.push('/admin/ideas?new=1')">{{ $t('quickActions.share_idea') }}</el-button>
  </div>

  <!-- 记工时 -->
  <el-dialog v-model="logVisible" :title="$t('common.log_hours')" width="520px">
    <el-form :model="logForm" label-width="86px">
      <el-form-item :label="$t('common.project')" required>
        <el-select v-model="logForm.projectId" :placeholder="$t('common.choose_project')" filterable style="width: 100%;" @change="logForm.taskId = ''">
          <el-option v-for="p in projects" :key="p.id" :label="`${p.code} ${p.name}`" :value="String(p.id)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('common.date')" required>
        <el-date-picker v-model="logForm.workDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" />
      </el-form-item>
      <el-form-item :label="$t('common.hours')" required>
        <el-input-number v-model="logForm.hours" :min="0.5" :max="24" :step="0.5" />
        <span class="hint">{{ $t('quickActions.hours_one_day_8_hours') }}</span>
      </el-form-item>
      <el-form-item :label="$t('common.related_task')">
        <el-select v-model="logForm.taskId" :placeholder="$t('quickActions.link_task_if_there_one')" clearable filterable style="width: 100%;" @change="logForm.workCategory = ''">
          <el-option v-for="t in tasksOfProject" :key="t.id" :label="t.title" :value="String(t.id)" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="!logForm.taskId" :label="$t('quickActions.category')">
        <el-select v-model="logForm.workCategory" :placeholder="$t('quickActions.pick_category_if_theres_no_task')" clearable style="width: 100%;">
          <el-option :label="$t('common.routine_work')" value="ROUTINE" />
          <el-option :label="$t('common.meetings')" value="MEETING" />
          <el-option :label="$t('common.ops_support')" value="OPS_SUPPORT" />
          <el-option :label="$t('common.learning')" value="TRAINING" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('common.work_done')" required>
        <el-input v-model="logForm.workContent" type="textarea" :rows="3" :placeholder="$t('quickActions.what_did_you_do_today')" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="logVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="submitLog">{{ $t('common.submit') }}</el-button>
    </template>
  </el-dialog>

  <!-- 建任务 -->
  <el-dialog v-model="taskVisible" :title="$t('common.new_task')" width="520px">
    <el-form :model="taskForm" label-width="86px">
      <el-form-item :label="$t('common.project')" required>
        <el-select v-model="taskForm.projectId" :placeholder="$t('common.choose_project')" filterable style="width: 100%;">
          <el-option v-for="p in projects" :key="p.id" :label="`${p.code} ${p.name}`" :value="String(p.id)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('common.title')" required>
        <el-input v-model="taskForm.title" :placeholder="$t('quickActions.sum_up_what_needs_doing_in')" />
      </el-form-item>
      <el-form-item :label="$t('common.priority')">
        <el-select v-model="taskForm.priority" style="width: 100%;">
          <el-option :label="$t('common.low')" value="LOW" />
          <el-option :label="$t('common.medium')" value="MEDIUM" />
          <el-option :label="$t('common.high')" value="HIGH" />
          <el-option :label="$t('common.urgent')" value="URGENT" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('common.due_date')">
        <el-date-picker v-model="taskForm.dueDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" />
      </el-form-item>
      <el-form-item :label="$t('quickActions.assign_me')">
        <el-switch v-model="taskForm.assignSelf" />
      </el-form-item>
      <el-form-item :label="$t('common.notes_2')">
        <el-input v-model="taskForm.description" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="taskVisible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="submitTask">{{ $t('common.created') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'

const props = defineProps({
  projects: { type: Array, default: () => [] },
  tasks: { type: Array, default: () => [] },
  userId: { type: [String, Number], default: null }
})
const emit = defineEmits(['done'])

const saving = ref(false)
const today = new Date().toLocaleDateString('sv')

// ---- 记工时 ----
const logVisible = ref(false)
const logForm = reactive({ projectId: '', workDate: today, hours: 8, taskId: '', workCategory: '', workContent: '' })
const tasksOfProject = computed(() => props.tasks.filter(t => String(t.project?.id) === String(logForm.projectId)))
function openLog() {
  logForm.projectId = props.projects.length === 1 ? String(props.projects[0].id) : logForm.projectId
  logVisible.value = true
}
async function submitLog() {
  if (!logForm.projectId || !logForm.workDate || !logForm.hours || !logForm.workContent) {
    return ElMessage.warning($t('quickActions.project_date_hours_work_done_required'))
  }
  saving.value = true
  try {
    // 空串会被后端当成值, 一律转 undefined 走 JSON body(GET 参数才必须给空串)
    await fde.timesheets.create({
      projectId: logForm.projectId,
      workDate: logForm.workDate,
      hours: logForm.hours,
      workContent: logForm.workContent,
      taskId: logForm.taskId || undefined,
      workCategory: logForm.taskId ? undefined : (logForm.workCategory || undefined)
    })
    ElMessage.success($t('quickActions.hours_submitted'))
    logVisible.value = false
    logForm.workContent = ''
    emit('done')
  } catch (e) {
    ElMessage.error(e.message || $t('common.submit_failed'))
  } finally {
    saving.value = false
  }
}

// ---- 建任务 ----
const taskVisible = ref(false)
const taskForm = reactive({ projectId: '', title: '', priority: 'MEDIUM', dueDate: '', description: '', assignSelf: true })
function openTask() { taskVisible.value = true }
async function submitTask() {
  if (!taskForm.projectId || !taskForm.title) return ElMessage.warning($t('quickActions.project_title_required'))
  saving.value = true
  try {
    await fde.tasks.create({
      projectId: taskForm.projectId,
      title: taskForm.title,
      priority: taskForm.priority,
      dueDate: taskForm.dueDate || undefined,
      description: taskForm.description || undefined,
      assigneeUserId: taskForm.assignSelf && props.userId ? String(props.userId) : undefined,
      source: 'SELF'
    })
    ElMessage.success($t('quickActions.task_created'))
    taskVisible.value = false
    taskForm.title = ''
    taskForm.description = ''
    emit('done')
  } catch (e) {
    ElMessage.error(e.message || $t('common.create_failed'))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.quick-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.hint { font-size: 12px; color: #8f8a82; margin-left: 8px; }
</style>
