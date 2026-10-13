<template>
  <div class="timesheets-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('common.hours') }}</h2>
      <p class="hint">{{ $t('timesheets.entries_hours_matching_filters', { p0: pagination.total, p1: totalHours }) }}</p>
      <el-button v-if="can('timesheet.create')" type="primary" @click="openCreate"><el-icon><Plus /></el-icon>{{ $t('timesheets.log_hours') }}</el-button>
      <el-button type="success" @click="exportExcel"><el-icon><Download /></el-icon>{{ $t('timesheets.export_monthly_report') }}</el-button>
      <!-- v2.1.7(#495): 报工任务关联覆盖率观察(审批人/管理员) -->
      <el-button v-if="can('timesheet.approve')" @click="openCoverage">{{ $t('timesheets.link_coverage') }}</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item :label="$t('timesheets.date_range')">
          <el-date-picker v-model="dateRange" type="daterange" range-separator="~" :start-placeholder="$t('common.start')" :end-placeholder="$t('common.end')" value-format="YYYY-MM-DD" @change="onDateChange" />
        </el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="filters.status" :placeholder="$t('common.all')" clearable style="width: 130px;">
            <el-option :label="$t('common.draft')" value="DRAFT" />
            <el-option :label="$t('timesheets.submitted')" value="SUBMITTED" />
            <el-option :label="$t('common.approved')" value="APPROVED" />
            <el-option :label="$t('common.rejected')" value="REJECTED" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="canViewEngineers" :label="$t('common.engineers')">
          <el-select v-model="filters.engineer_id" :placeholder="$t('common.all')" clearable filterable style="width: 160px;">
            <el-option v-for="e in engineerOptions" :key="e.id" :label="e.name" :value="String(e.id)" />
          </el-select>
        </el-form-item>
        <!-- v1.9.3: 项目 + 里程碑筛选; 里程碑跨项目无意义, 只在选中项目后出现 -->
        <el-form-item :label="$t('common.project')">
          <el-select v-model="filters.project_id" :placeholder="$t('common.all')" clearable filterable style="width: 200px;" @change="onFilterProjectChange">
            <el-option v-for="p in projectOptions" :key="p.id" :label="`${p.code} ${p.name}`" :value="String(p.id)" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="filters.project_id" :label="$t('common.milestone_2')">
          <el-select v-model="filters.milestone_id" :placeholder="$t('common.all')" clearable style="width: 180px;">
            <el-option :label="$t('common.no_milestone')" value="none" />
            <el-option v-for="m in filterMilestones" :key="m.id" :label="m.name" :value="String(m.id)" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">{{ $t('common.search_2') }}</el-button>
          <el-button @click="resetFilters">{{ $t('common.reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <div v-if="can('timesheet.approve')" class="batch-bar">
        <el-button type="success" size="small" :disabled="!selectedRows.length" :loading="batchApproving" @click="handleBatchApprove">
          {{ $t('timesheets.approve_selected', { p0: selectedRows.length ? ` (${selectedRows.length})` : '' }) }}
        </el-button>
        <span class="batch-hint">{{ $t('timesheets.check_submitted_entries_approve_them_in') }}</span>
      </div>
      <el-table :data="list" v-loading="loading" stripe @selection-change="onSelectionChange">
        <el-table-column v-if="can('timesheet.approve')" type="selection" width="44" :selectable="row => row.status === 'SUBMITTED'" />
        <el-table-column :label="$t('common.date')" width="110">
          <template #default="{ row }">{{ formatDate(row.workDate) }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.engineers')" width="120">
          <template #default="{ row }">{{ row.engineer?.user?.name }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.project')" min-width="200">
          <template #default="{ row }">
            <code style="font-size: 11px; opacity: 0.6;">{{ row.project?.code }}</code>
            <span style="margin-left: 6px;">{{ row.project?.name }}</span>
          </template>
        </el-table-column>
        <!-- v1.9.3: 工时关联的里程碑 -->
        <el-table-column :label="$t('common.milestone_2')" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.milestone?.name || '—' }}</template>
        </el-table-column>
        <!-- v2.1.7(#493): 关联任务(审批人一眼看到工时挂哪个任务) / 无任务时显示分类 -->
        <el-table-column :label="$t('common.related_task')" width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="row.task">#{{ row.task.id }} {{ row.task.title }}</template>
            <el-tag v-else-if="row.workCategory" size="small" type="info" effect="plain">{{ WORK_CATEGORY_LABELS[row.workCategory] || row.workCategory }}</el-tag>
            <span v-else style="color:#bbb;">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.hours')" width="80" align="right">
          <template #default="{ row }"><strong>{{ row.hours }}</strong> h</template>
        </el-table-column>
        <el-table-column prop="location" :label="$t('timesheets.location')" width="120" />
        <el-table-column :label="$t('common.status')" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="light" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="workContent" :label="$t('common.work_done')" show-overflow-tooltip min-width="240" />
        <!-- v1.2.8: 操作 >3 个统一只留一个「更多」下拉 -->
        <el-table-column :label="$t('common.actions')" width="90" fixed="right" align="center">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="cmd => onRowCmd(cmd, row)">
              <el-button size="small" link type="primary">{{ $t('timesheets.more') }}<el-icon><ArrowDown /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="can('timesheet.submit') && row.status === 'DRAFT'" command="submit">{{ $t('common.submit') }}</el-dropdown-item>
                  <el-dropdown-item v-if="can('timesheet.approve') && row.status === 'SUBMITTED'" command="approve">{{ $t('timesheets.approve') }}</el-dropdown-item>
                  <el-dropdown-item v-if="can('timesheet.approve') && row.status === 'SUBMITTED'" command="reject">{{ $t('common.reject') }}</el-dropdown-item>
                  <el-dropdown-item v-if="can('timesheet.edit')" command="edit">{{ $t('common.edit') }}</el-dropdown-item>
                  <el-dropdown-item v-if="can('timesheet.delete')" command="delete" style="color: #c2362b;">{{ $t('common.delete_2') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.page_size"
        :total="pagination.total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @current-change="loadList"
        @size-change="loadList"
        style="margin-top: 16px; justify-content: flex-end;"
      />
    </el-card>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="formVisible" :title="formMode === 'create' ? $t('timesheets.log_hours') : $t('timesheets.edit_hours')" width="560px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item :label="$t('common.project')" prop="projectId">
          <el-select v-model="form.projectId" filterable :placeholder="$t('common.choose_project')" style="width: 100%;" @change="onFormProjectChange">
            <el-option v-for="p in projectOptions" :key="p.id" :label="`${p.code} ${p.name}`" :value="Number(p.id)" />
          </el-select>
        </el-form-item>
        <!-- v2.1.7(#493) 报工强引导: 默认关联任务; 确无任务勾选并选原因; 可随手建任务 -->
        <el-form-item :label="$t('common.related_task')">
          <div style="display:flex; gap:8px; width:100%; align-items:center;">
            <el-select v-model="form.taskId" clearable filterable :disabled="!form.projectId || form.noTask"
              :loading="myTasksLoading"
              :placeholder="!form.projectId ? $t('common.choose_project_first') : form.noTask ? $t('timesheets.no_linked_task_checked') : myTaskOptions.length ? $t('timesheets.choose_one_my_unfinished_tasks') : $t('timesheets.no_tasks_assigned_you_in_this')"
              style="flex:1;">
              <el-option v-for="t in myTaskOptions" :key="t.id" :label="`#${t.id} ${t.title}`" :value="Number(t.id)" />
            </el-select>
            <el-button v-if="!form.noTask" :disabled="!form.projectId" @click="quickTask.visible = true">{{ $t('timesheets.quick_task') }}</el-button>
          </div>
          <div v-if="!linkCfg.requireTask || isAdmin" style="width:100%;">
            <el-checkbox v-model="form.noTask" @change="onNoTaskChange">{{ $t('timesheets.no_task_for_this_work') }}</el-checkbox>
            <el-tag v-if="linkCfg.requireTask" size="small" type="warning" style="margin-left:6px;">{{ $t('timesheets.required_period_administrator_exemption_recorded') }}</el-tag>
            <span style="font-size:12px; color:#909399; margin-left:8px;">{{ $t('timesheets.if_day_spans_several_tasks_log') }}</span>
          </div>
          <el-radio-group v-if="form.noTask" v-model="form.workCategory" style="width:100%;">
            <el-radio v-for="(label, key) in WORK_CATEGORY_LABELS" :key="key" :value="key">{{ label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <!-- v1.9.3: 可选关联里程碑, 工时按里程碑归集 -->
        <el-form-item :label="$t('timesheets.linked_milestone')">
          <el-select v-model="form.milestoneId" clearable filterable :disabled="!form.projectId"
            :placeholder="form.projectId ? $t('common.optional') : $t('common.choose_project_first')" style="width: 100%;">
            <el-option v-for="m in formMilestones" :key="m.id" :label="m.name" :value="Number(m.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.recorded_by')" prop="engineerId">
          <!-- FDE 工程师默认填自己，禁用下拉 -->
          <template v-if="isFdeEngineer">
            <el-input :value="myEngineerName" disabled placeholder="" />
            <div style="font-size: 12px; color: #909399; margin-top: 4px;">
              {{ $t('timesheets.fde_engineers_can_only_log_their') }}
            </div>
          </template>
          <!-- 其他角色(项目经理等): 我自己 + 所选项目的在职成员 -->
          <el-select v-else v-model="form.engineerId" filterable :loading="membersLoading"
            :placeholder="form.projectId ? $t('common.choose_recorder') : $t('common.choose_project_first')" style="width: 100%;">
            <el-option v-for="o in recordTargetOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.date')" prop="workDate">
          <el-date-picker v-model="form.workDate" type="date" value-format="YYYY-MM-DD" :placeholder="$t('timesheets.choose_date')" style="width: 100%;" />
        </el-form-item>
        <el-form-item :label="$t('common.hours_h')" prop="hours">
          <el-input-number v-model="form.hours" :min="0.5" :max="24" :step="0.5" :precision="1" style="width: 100%;" />
        </el-form-item>
        <el-form-item :label="$t('timesheets.location')">
          <el-input v-model="form.location" :placeholder="$t('timesheets.e_g_shanghai_remote')" />
        </el-form-item>
        <el-form-item :label="$t('common.work_done')" prop="workContent">
          <el-input v-model="form.workContent" type="textarea" :rows="4" :placeholder="$t('timesheets.describe_work_done_today_in_detail')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.ok') }}</el-button>
      </template>
    </el-dialog>

    <!-- v2.1.7(#493) 快速建任务: 不跳离填报页, 建完直接选中 -->
    <el-dialog v-model="quickTask.visible" :title="$t('timesheets.quick_task')" width="420px" append-to-body>
      <el-input v-model="quickTask.title" :placeholder="$t('timesheets.task_title_added_current_project_assigned')" maxlength="200" @keyup.enter="createQuickTask" />
      <template #footer>
        <el-button @click="quickTask.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="quickTask.creating" :disabled="!quickTask.title.trim()" @click="createQuickTask">{{ $t('timesheets.create_select') }}</el-button>
      </template>
    </el-dialog>

    <!-- v2.1.7(#495) 关联覆盖率观察 + 强制开关(仅管理员可切) -->
    <el-dialog v-model="coverage.visible" :title="$t('timesheets.task_link_coverage_for_hours')" width="640px">
      <div v-loading="coverage.loading">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
          <span style="font-size:13px; color:#666;">{{ $t('timesheets.window_last_4_weeks_starting_monday') }}</span>
          <template v-if="isAdmin">
            <el-switch v-model="coverage.requireTask" :active-text="$t('timesheets.hours_must_link_task')" @change="toggleRequireTask" />
          </template>
          <el-tag v-else-if="coverage.requireTask" size="small" type="danger">{{ $t('timesheets.required_linking_on') }}</el-tag>
        </div>
        <el-table :data="coverage.weeks" size="small">
          <el-table-column :label="$t('timesheets.week_mon')" prop="weekStart" width="120" />
          <el-table-column :label="$t('timesheets.entries')" prop="total" width="90" align="center" />
          <el-table-column :label="$t('common.linked')" prop="linked" width="80" align="center" />
          <el-table-column :label="$t('timesheets.coverage')" align="center">
            <template #default="{ row }">
              <el-progress :percentage="row.rate" :status="row.rate >= 90 ? 'success' : row.rate >= 70 ? 'warning' : 'exception'" />
            </template>
          </el-table-column>
        </el-table>
        <el-divider style="margin:12px 0;">{{ $t('timesheets.by_project_lowest_coverage_first') }}</el-divider>
        <el-table :data="coverage.byProject.slice(0, 8)" size="small">
          <el-table-column :label="$t('common.project')" prop="name" min-width="180" show-overflow-tooltip />
          <el-table-column :label="$t('timesheets.entries_2')" prop="total" width="70" align="center" />
          <el-table-column :label="$t('timesheets.coverage')" width="90" align="center">
            <template #default="{ row }">{{ row.rate }}%</template>
          </el-table-column>
        </el-table>
        <el-divider style="margin:12px 0;">{{ $t('timesheets.by_person_lowest_coverage_first') }}</el-divider>
        <el-table :data="coverage.byEngineer.slice(0, 8)" size="small">
          <el-table-column :label="$t('common.engineers')" prop="name" min-width="140" />
          <el-table-column :label="$t('timesheets.entries_2')" prop="total" width="70" align="center" />
          <el-table-column :label="$t('timesheets.coverage')" width="90" align="center">
            <template #default="{ row }">{{ row.rate }}%</template>
          </el-table-column>
        </el-table>
        <p style="font-size:12px; color:#98897e; margin-top:10px;">{{ $t('timesheets.recommended_switch_overall_coverage_90_for') }}</p>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Plus, Download, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde, formatDate } from '@/api/index.js'
import { can } from '@/api/permissions.js'

const route = useRoute()

// 2026-07-05 修复: 获取当前登录用户 + 角色判断
// FDE_ENGINEER 工程师字段预填且禁用
function readUser() {
  try { return JSON.parse(localStorage.getItem('fde_internal_user') || '{}') } catch { return {} }
}
const me = ref(readUser())
const isFdeEngineer = computed(() => me.value?.role === 'FDE_ENGINEER')
const myEngineerName = computed(() => me.value?.name || $t('timesheets.myself'))
const canViewEngineers = computed(() => can('engineer.view'))

const list = ref([])
const loading = ref(false)
// v1.9.3: 新增 project_id/milestone_id 筛选(milestone_id 支持 'none'=未挂里程碑)
const filters = reactive({ status: '', from: '', to: '', engineer_id: '', project_id: '', milestone_id: '' })
const dateRange = ref([])
const pagination = reactive({ page: 1, page_size: 20, total: 0 })
const totalHours = ref(0)
const projectOptions = ref([])
const engineerOptions = ref([])

const formVisible = ref(false)
const formMode = ref('create')
const submitting = ref(false)
const formRef = ref()
const form = reactive({
  id: null, projectId: null, engineerId: null, milestoneId: null, workDate: '', hours: 8, location: '', workContent: '',
  taskId: null, noTask: false, workCategory: null   // v2.1.7(#493) 报工关联任务
})
const rules = {
  projectId: [{ required: true, message: $t('timesheets.project_required'), trigger: 'change' }],
  engineerId: [{ required: true, message: $t('timesheets.recorder_required'), trigger: 'change' }],
  workDate: [{ required: true, message: $t('timesheets.date_required'), trigger: 'change' }],
  hours: [{ required: true, message: $t('timesheets.hours_required'), trigger: 'blur' }],
  workContent: [{ required: true, message: $t('timesheets.work_done_required'), trigger: 'blur' }]
}

// 记录人候选 = 「我自己」+ 所选项目的在职成员 (2026-07-29: 经理给自己/项目成员报工;
// 与项目详情页同款套路: 有档案 e:<engineerId>, 无档案 u:<userId>, 后端 engineerUserId 懒建档)
const membersLoading = ref(false)
const memberOptionsCache = new Map()
const memberOptions = ref([])
// 编辑带出的原记录人不在成员表时兜底回显
const engineerFallback = ref(null)
const recordTargetOptions = computed(() => {
  const others = memberOptions.value.filter(o => String(o.userId || '') !== String(me.value?.id || ''))
  const opts = [{ value: '__SELF__', label: $t('common.myself', { p0: me.value?.name || me.value?.username || $t('common.me') }) }, ...others]
  if (engineerFallback.value && !opts.some(o => o.value === engineerFallback.value.value)) {
    return [engineerFallback.value, ...opts]
  }
  return opts
})
async function loadMemberOptions(projectId) {
  memberOptions.value = []
  if (!projectId) return
  const key = String(projectId)
  if (memberOptionsCache.has(key)) {
    memberOptions.value = memberOptionsCache.get(key)
    return
  }
  membersLoading.value = true
  try {
    const p = await fde.projects.detail(projectId)
    const opts = (p.members || [])
      .filter(m => !m.leaveDate)
      .map(m => {
        const label = m.engineer?.user?.name || m.user?.name || $t('common.members')
        const userId = m.engineer?.user?.id ?? m.user?.id ?? m.userId
        if (m.engineer) return { value: 'e:' + m.engineer.id, label, userId }
        return userId ? { value: 'u:' + userId, label, userId } : null
      })
      .filter(Boolean)
    memberOptionsCache.set(key, opts)
    memberOptions.value = opts
  } catch (e) { /* 无权限等静默 */ }
  finally { membersLoading.value = false }
}
watch(() => form.projectId, v => loadMemberOptions(v))
// 用户手动切项目时记录人回到「我自己」(编辑回填不触发)
function onFormProjectChange() {
  if (!isFdeEngineer.value) form.engineerId = '__SELF__'
  engineerFallback.value = null
  // v1.9.3: 里程碑属于项目, 切项目必清
  form.milestoneId = null
}

// v1.9.3: 里程碑选项(筛选/表单各一份, 都拉全量 —— 工时是历史数据, 已完成里程碑也要能选/能筛)
const filterMilestones = ref([])
const formMilestones = ref([])
async function fetchMilestones(projectId) {
  try {
    const data = await fde.projects.milestones(projectId)
    return data.list || []
  } catch (e) { return [] /* 无权限等静默 */ }
}
// 筛选项目切换: 清空里程碑值并按新项目重拉选项
async function onFilterProjectChange() {
  filters.milestone_id = ''
  filterMilestones.value = []
  if (filters.project_id) filterMilestones.value = await fetchMilestones(filters.project_id)
}
watch(() => form.projectId, async v => {
  formMilestones.value = v ? await fetchMilestones(v) : []
})

function onDateChange(val) {
  if (val && val.length === 2) {
    filters.from = val[0]
    filters.to = val[1]
  } else {
    filters.from = ''
    filters.to = ''
  }
  pagination.page = 1
  loadList()
}

async function loadList() {
  loading.value = true
  try {
    const params = { ...filters, page: pagination.page, page_size: pagination.page_size }
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
    const data = await fde.timesheets.list(params)
    list.value = data.list
    pagination.total = data.total
    totalHours.value = data.totalHours
  } finally { loading.value = false }
}

async function loadOptions() {
  try {
    // 项目下拉：所有角色都能看
    const p = await fde.projects.list({ page_size: 100 })
    projectOptions.value = p.list || []
  } catch (e) { console.warn('loadOptions projects:', e) }
  // 工程师下拉：仅 ADMIN/PLATFORM/MANAGER 可见（FDE 工程师只能给自己报工）
  if (canViewEngineers.value) {
    try {
      const e = await fde.engineers.list({ page_size: 100 })
      // 过滤掉没有工程师档案的用户(id 为空, 工时表按 engineer.id 关联)
      engineerOptions.value = (e.list || []).filter(x => x.id)
    } catch (e) { console.warn('loadOptions engineers:', e) }
  } else {
    engineerOptions.value = []
  }
}

function resetFilters() {
  filters.status = ''
  filters.from = ''
  filters.to = ''
  filters.engineer_id = ''
  // v1.9.3: 项目/里程碑一并清空
  filters.project_id = ''
  filters.milestone_id = ''
  filterMilestones.value = []
  dateRange.value = []
  pagination.page = 1
  loadList()
}

function resetForm() {
  Object.assign(form, {
    id: null, projectId: null, engineerId: null, milestoneId: null, workDate: '', hours: 8, location: '', workContent: '',
    taskId: null, noTask: false, workCategory: null
  })
  formRef.value?.clearValidate()
}

function openCreate() {
  formMode.value = 'create'
  resetForm()
  engineerFallback.value = null
  // 默认记自己(含 FDE 工程师和项目经理), __SELF__ 提交时不传 engineerId, 后端按登录人记账
  form.engineerId = '__SELF__'
  formVisible.value = true
  if (!projectOptions.value.length) loadOptions()
}

function openEdit(row) {
  formMode.value = 'create'
  resetForm()
  form.id = row.id
  form.projectId = Number(row.projectId)
  // 记录人存的是 engineer.id, 选项值带 e: 前缀; 原记录人可能不在成员表, 用姓名兜底回显
  form.engineerId = 'e:' + row.engineerId
  engineerFallback.value = { value: 'e:' + row.engineerId, label: row.engineer?.user?.name || $t('timesheets.current_recorder') }
  // v1.9.3: 编辑回填里程碑(选项由 projectId watch 异步拉取)
  form.milestoneId = row.milestoneId ? Number(row.milestoneId) : null
  // v2.1.7(#493): 回填关联任务/无任务分类
  form.taskId = row.taskId ? Number(row.taskId) : null
  form.noTask = !row.taskId && !!row.workCategory
  form.workCategory = row.workCategory || null
  form.workDate = formatDate(row.workDate)
  form.hours = Number(row.hours)
  form.location = row.location || ''
  form.workContent = row.workContent
  formVisible.value = true
  if (!projectOptions.value.length) loadOptions()
}



// ============ v2.1.7(#495) 覆盖率观察与强制开关 ============
const isAdmin = computed(() => me.value?.role === 'ADMIN')
const linkCfg = reactive({ requireTask: false })
const coverage = reactive({ visible: false, loading: false, requireTask: false, weeks: [], byProject: [], byEngineer: [] })
async function loadLinkCfg() {
  try { linkCfg.requireTask = (await fde.timesheets.taskLinkConfig()).requireTask } catch (e) { /* 静默 */ }
}
async function openCoverage() {
  coverage.visible = true
  coverage.loading = true
  try {
    const d = await fde.timesheets.taskLinkCoverage({ weeks: 4 })
    coverage.weeks = d.weeks; coverage.byProject = d.byProject; coverage.byEngineer = d.byEngineer
    coverage.requireTask = d.requireTask
  } catch (e) { ElMessage.error(e.message) } finally { coverage.loading = false }
}
async function toggleRequireTask(val) {
  try {
    await ElMessageBox.confirm(
      val ? $t('timesheets.once_on_everyone_must_link_task') : $t('timesheets.turning_it_off_goes_back_guided'),
      val ? $t('timesheets.turn_on_required_linking') : $t('timesheets.turn_off_required_linking'), { type: 'warning' })
  } catch { coverage.requireTask = !val; return }
  try {
    await fde.timesheets.setTaskLinkConfig(val)
    linkCfg.requireTask = val
    ElMessage.success(val ? $t('timesheets.required_linking_turned_on_switch_recorded') : $t('timesheets.turned_off_back_guided_mode'))
  } catch (e) { ElMessage.error(e.message); coverage.requireTask = !val }
}

// ============ v2.1.7(#493) 报工关联任务(强引导) ============
const WORK_CATEGORY_LABELS = { ROUTINE: $t('common.routine_work'), MEETING: $t('common.meetings'), OPS_SUPPORT: $t('common.ops_support'), TRAINING: $t('common.learning') }
const myTaskOptions = ref([])
const myTasksLoading = ref(false)
const quickTask = reactive({ visible: false, title: '', creating: false })
const OPEN_TASK_STATUSES = ['TODO', 'QUEUED', 'IN_PROGRESS']
async function loadMyTasks(projectId) {
  myTaskOptions.value = []
  if (!projectId) return
  myTasksLoading.value = true
  try {
    const data = await fde.tasks.list({ projectId, mine: 'true', page_size: 100 })
    myTaskOptions.value = (data.list || []).filter(t => OPEN_TASK_STATUSES.includes(t.status))
  } catch (e) { /* 无权限等静默 */ }
  finally { myTasksLoading.value = false }
}
watch(() => form.projectId, v => { form.taskId = null; loadMyTasks(v) })
function onNoTaskChange(checked) {
  if (checked) form.taskId = null
  else form.workCategory = null
}
async function createQuickTask() {
  if (!quickTask.title.trim() || quickTask.creating) return
  quickTask.creating = true
  try {
    const t = await fde.tasks.create({ projectId: form.projectId, title: quickTask.title.trim(), assigneeUserId: me.value?.id })
    ElMessage.success($t('timesheets.task_created_selected'))
    quickTask.visible = false
    quickTask.title = ''
    await loadMyTasks(form.projectId)
    form.taskId = Number(t.id)
    form.noTask = false
  } catch (e) { ElMessage.error(e.message) } finally { quickTask.creating = false }
}

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  // v2.1.7(#493) 强引导: 要么关联任务, 要么勾无任务并选原因(不留第三条路)
  if (!form.noTask && !form.taskId) {
    ElMessage.warning($t('timesheets.link_task_this_work_belongs_if'))
    return
  }
  if (form.noTask && !form.workCategory) {
    ElMessage.warning($t('timesheets.choose_why_theres_no_linked_task'))
    return
  }
  submitting.value = true
  try {
    // e: 传 engineerId, u: 传 engineerUserId(后端懒建档);
    // __SELF__ 创建时不传(后端记当前登录人), 编辑时按本人 userId 传(PUT 不传则不变更)
    const v = String(form.engineerId || '')
    const payload = {
      projectId: form.projectId,
      engineerId: v.startsWith('e:') ? v.slice(2) : undefined,
      engineerUserId: v.startsWith('u:') ? v.slice(2) : (v === '__SELF__' && form.id ? me.value?.id : undefined),
      workDate: form.workDate, hours: form.hours,
      // v1.9.3: 可选关联里程碑(须属所选项目, 后端校验); 传 null 表示清除关联
      milestoneId: form.milestoneId || null,
      // v2.1.7(#493): 关联任务与无任务分类互斥, 后端二次校验
      taskId: form.noTask ? null : (form.taskId || null),
      workCategory: form.noTask ? form.workCategory : null,
      location: form.location || null, workContent: form.workContent
    }
    if (form.id) {
      await fde.timesheets.update(form.id, payload)
      ElMessage.success($t('timesheets.hours_updated'))
    } else {
      await fde.timesheets.create(payload)
      ElMessage.success($t('timesheets.hours_created_submitted_waiting_for_approval'))
    }
    formVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally { submitting.value = false }
}

async function handleApprove(row) {
  try {
    await fde.timesheets.approve(row.id, true)
    ElMessage.success($t('timesheets.hours_approved'))
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.action_failed')) }
}

// 批量批准(勾选 SUBMITTED 的行)
const selectedRows = ref([])
const batchApproving = ref(false)
function onSelectionChange(rows) { selectedRows.value = rows }
async function handleBatchApprove() {
  if (!selectedRows.value.length) return
  batchApproving.value = true
  try {
    const results = await Promise.allSettled(selectedRows.value.map(r => fde.timesheets.approve(r.id, true)))
    const ok = results.filter(r => r.status === 'fulfilled').length
    const fail = results.length - ok
    if (fail) ElMessage.warning($t('timesheets.approved_failed', { p0: ok, p1: fail }))
    else ElMessage.success($t('timesheets.approved_entries', { p0: ok }))
    loadList()
  } finally { batchApproving.value = false }
}

async function handleSubmitTimesheet(row) {
  try {
    await fde.timesheets.submit(row.id)
    ElMessage.success($t('timesheets.hours_submitted_awaiting_approval'))
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.submit_failed')) }
}

async function handleReject(row) {
  try {
    await fde.timesheets.approve(row.id, false)
    ElMessage.success($t('timesheets.hours_rejected'))
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.action_failed')) }
}

// v1.2.8: 操作下拉分发; 删除挪进下拉后用确认框替代原 popconfirm
async function onRowCmd(cmd, row) {
  if (cmd === 'submit') return handleSubmitTimesheet(row)
  if (cmd === 'approve') return handleApprove(row)
  if (cmd === 'reject') return handleReject(row)
  if (cmd === 'edit') return openEdit(row)
  if (cmd === 'delete') {
    try { await ElMessageBox.confirm($t('timesheets.delete_these_hours'), $t('common.confirm'), { type: 'warning' }) } catch { return }
    handleDelete(row)
  }
}

async function handleDelete(row) {
  try {
    await fde.timesheets.remove(row.id)
    ElMessage.success($t('timesheets.hours_deleted'))
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.delete_failed')) }
}

function statusType(s) { return { DRAFT: 'info', SUBMITTED: 'warning', APPROVED: 'success', REJECTED: 'danger' }[s] || 'info' }
function statusLabel(s) { return { DRAFT: $t('common.draft'), SUBMITTED: $t('timesheets.submitted'), APPROVED: $t('common.approved'), REJECTED: $t('common.rejected') }[s] || s }

import { downloadExcel } from '@/api/excel.js'
function exportExcel() {
  const params = { ...filters }
  Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
  const month = (filters.from || filters.to) ? `${filters.from || ''}_${filters.to || ''}` : new Date().toISOString().slice(0, 7)
  downloadExcel(fde.reports.timesheets(params), $t('timesheets.timesheets_xlsx', { p0: month }))
}

onMounted(() => {
  loadLinkCfg()   // v2.1.7(#495) 强制开关状态
  // 从 URL ?status= 读取初始过滤
  if (route.query.status) {
    filters.status = String(route.query.status)
  }
  loadList()
  loadOptions()
})
</script>

<style scoped>
.page-header { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
/* v1.2.9: hint 占满左侧, 按钮统一靠最右 */
.page-header .hint { margin-right: auto; }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.hint { font-size: 13px; color: rgba(28, 25, 23, 0.6); }
.filter-card, .table-card { background: white; border: 1px solid rgba(28, 25, 23, 0.1); margin-bottom: 16px; }
.batch-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.batch-hint { font-size: 12px; color: #909399; }
</style>
