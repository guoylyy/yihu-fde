<template>
  <div class="tasks-page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.tasks') }}</h2>
        <p class="hint">{{ $t('tasks.tasks_assigned_me', { p0: total, p1: myCount }) }}</p>
      </div>
      <div class="header-actions">
        <!-- v1.2.9: 已验收任务一键归档, 归档记录可查可恢复 -->
        <el-checkbox v-model="viewArchived" @change="loadList" style="margin-right: 8px;">{{ $t('common.view_archived') }}</el-checkbox>
        <el-button v-if="can('task.delete') && verifiedCount > 0 && !viewArchived" type="warning" plain @click="archiveVerified">
          {{ $t('common.archive_accepted', { p0: verifiedCount }) }}
        </el-button>
        <!-- v2.12.1(#1275) 批量验收: 勾选生产完成的任务一键 VERIFIED -->
        <el-button v-if="can('task.changeStatus') && !viewArchived" type="success" plain :disabled="!selectedRows.length" @click="batchVerifySelected">
          {{ $t('tasks.accept_selected', { p0: selectedRows.length }) }}
        </el-button>
        <el-button v-if="can('task.create')" type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>{{ $t('common.new_task') }}
        </el-button>
      </div>
    </div>

    <!-- 归档视图: 只读列表 + 恢复 -->
    <el-card v-if="viewArchived" shadow="never" class="block-card">
      <template #header><span class="block-title">{{ $t('tasks.archived', { p0: list.length }) }}</span></template>
      <el-table :data="list" stripe>
        <el-table-column prop="title" :label="$t('common.task')" min-width="200" />
        <el-table-column :label="$t('common.project')" width="220">
          <template #default="{ row }">{{ row.project?.code }} · {{ row.project?.name }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.owner')" width="120">
          <template #default="{ row }">{{ row.assignee?.name || '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.completed_at')" width="120">
          <template #default="{ row }">{{ formatDate(row.completedAt) || '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.archived_at')" width="120">
          <template #default="{ row }">{{ formatDate(row.archivedAt) }}</template>
        </el-table-column>
        <el-table-column v-if="can('task.delete')" :label="$t('common.actions')" width="90" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="unarchive(row)">{{ $t('common.recovered_2') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length" :description="$t('common.no_archived_tasks_yet')" :image-size="80" />
    </el-card>

    <!-- 筛选区: 置于看板之上 (v1.4.x 体验反馈: 「仅我的」要一眼可见) -->
    <el-card v-if="!viewArchived" shadow="never" class="block-card filter-bar" :class="{ 'mobile-filter-collapsed': filterCollapsed }">
      <el-button class="filter-toggle mobile-only" text size="small" @click="filterCollapsed = !filterCollapsed">
        {{ $t('common.p0', { p0: filterCollapsed ? $t('common.show_filters') : $t('common.hide_filters') }) }}
      </el-button>
      <el-form :inline="true" @submit.prevent style="margin-bottom: -14px;">
        <el-form-item>
          <el-checkbox v-model="mineOnly" @change="onMineOnlyChange" border>{{ $t('tasks.my_tasks_only') }}</el-checkbox>
        </el-form-item>
        <el-form-item>
          <!-- v2.0.1(#396): 精简卡片(默认开), 与项目看板共用记忆 -->
          <el-checkbox v-model="boardCompact" @change="onBoardCompactChange" border>{{ $t('common.compact_cards') }}</el-checkbox>
        </el-form-item>
        <!-- v1.9.3: 逾期/今日快捷筛选, 互斥, 再点一次取消 -->
        <el-form-item>
          <el-button type="danger" :plain="quickFilter !== 'overdue'" @click="toggleQuickFilter('overdue')">{{ $t('tasks.overdue_tasks') }}</el-button>
          <el-button type="primary" :plain="quickFilter !== 'due_today'" @click="toggleQuickFilter('due_today')">{{ $t('tasks.todays_tasks') }}</el-button>
        </el-form-item>
        <el-form-item :label="$t('common.project')">
          <el-select v-model="filterProjectId" clearable :placeholder="$t('common.all')" style="width: 200px;" @change="onFilterProjectChange">
            <el-option v-for="p in projects" :key="p.id" :label="`${p.code} ${p.name}`" :value="String(p.id)" />
          </el-select>
        </el-form-item>
        <!-- v1.9.3: 里程碑/成员筛选, 跨项目无意义, 只在选中项目后出现 -->
        <el-form-item v-if="filterProjectId" :label="$t('common.milestone_2')">
          <el-select v-model="filterMilestoneId" clearable :placeholder="$t('common.all')" style="width: 180px;" @change="loadList">
            <el-option :label="$t('common.no_milestone')" value="none" />
            <el-option v-for="m in filterMilestones" :key="m.id" :label="m.name" :value="String(m.id)" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="filterProjectId" :label="$t('common.members')">
          <el-select v-model="filterAssigneeId" clearable filterable :placeholder="$t('common.all')" style="width: 140px;" @change="loadList">
            <el-option v-for="o in filterMembers" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="filterStatus" clearable :placeholder="$t('common.all')" style="width: 140px;" @change="loadList">
            <el-option v-for="c in columns" :key="c.status" :label="c.label" :value="c.status" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.priority')">
          <el-select v-model="filterPriority" clearable :placeholder="$t('common.all')" style="width: 120px;" @change="loadList">
            <el-option :label="$t('common.low')" value="LOW" />
            <el-option :label="$t('common.medium')" value="MEDIUM" />
            <el-option :label="$t('common.high')" value="HIGH" />
            <el-option :label="$t('common.urgent')" value="URGENT" />
          </el-select>
        </el-form-item>
        <!-- v2.1.13(#563) 来源筛选 -->
        <el-form-item :label="$t('common.source')">
          <el-select v-model="filterSource" clearable :placeholder="$t('common.all')" style="width: 130px;" @change="loadList">
            <el-option :label="$t('common.not_set')" value="none" />
            <el-option v-for="(l, v) in SOURCE_LABELS" :key="v" :label="l" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">{{ $t('common.search_2') }}</el-button>
          <!-- v1.9.3: 筛选项变多, 补一个重置(含里程碑/成员/快捷筛选) -->
          <el-button @click="resetFilters">{{ $t('common.reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 看板视图：按状态分列 -->
    <div v-if="!viewArchived" class="kanban">
      <div v-for="col in columns" :key="col.status" class="kanban-col">
        <div class="col-head" :style="{ borderTopColor: col.color }">
          <span class="col-title">{{ col.label }}</span>
          <span class="col-count">{{ groups[col.status]?.length || 0 }}</span>
        </div>
        <div class="col-body">
          <div v-for="t in groups[col.status]" :key="t.id" class="task-card" @click="openDetail(t)">
            <div class="task-head">
              <!-- v1.9.13(#366): 卡片带任务编号, 方便沟通中快速定位 -->
              <div class="head-left">
                <el-tag :type="priorityType(t.priority)" size="small" effect="dark">{{ priorityLabel(t.priority) }}</el-tag>
                <span class="task-no">#{{ t.id }}</span>
              </div>
              <!-- 1.2.7: 带上项目名, 只看编号会疑惑 -->
              <span class="task-project" :title="`${t.project?.code || ''} ${t.project?.name || ''}`">{{ t.project?.name || t.project?.code }}</span>
            </div>
            <div class="task-title-row">
              <div class="task-title">{{ t.title }}</div>
              <!-- v2.12.0(#1255) 谁在做徽标 -->
              <ActiveWorkBadge :active-work="t.activeWork" :task-id="t.id" :task-title="t.title" />
            </div>
            <!-- v2.0.1(#396): 精简模式只留编号+标题 -->
            <div v-if="!boardCompact && t.description" class="task-desc">{{ t.description }}</div>
            <div v-if="!boardCompact" class="task-foot">
              <div class="task-assignee">
                <el-avatar v-if="t.assignee" :size="20" style="background: #d2521e;">{{ t.assignee.name?.slice(0,1) }}</el-avatar>
                <span v-if="t.assignee" class="aname">{{ t.assignee.name }}</span>
                <span v-else class="aname muted">{{ $t('common.unassigned') }}</span>
              </div>
              <span v-if="t.dueDate" class="task-due" :class="dueClass(t.dueDate)">
                {{ formatDate(t.dueDate) }}
              </span>
            </div>
            <!-- v1.9.7(#353): 等候生产卡片显示计划起止 -->
            <div v-if="!boardCompact && t.status === 'QUEUED' && (t.plannedStartAt || t.plannedEndAt)" class="task-planned">📅 {{ plannedRange(t) }}</div>
            <div v-if="!boardCompact && t.subtaskStats && t.subtaskStats.total > 0" class="task-progress">
              <el-progress
                :percentage="Math.round(t.subtaskStats.done / t.subtaskStats.total * 100)"
                :stroke-width="4"
                :show-text="false"
                :color="t.subtaskStats.done === t.subtaskStats.total ? '#2e7d4f' : '#d2521e'"
              />
              <span class="prog-text">✓ {{ t.subtaskStats.done }}/{{ t.subtaskStats.total }}</span>
            </div>
            <div v-if="!boardCompact && t.status !== 'VERIFIED' && can('task.changeStatus')" class="task-actions">
              <el-button v-for="act in nextActions(t.status)" :key="act.to" size="small" link :type="act.type" @click.stop="quickChange(t, act.to)">
                {{ act.label }}
              </el-button>
            </div>
          </div>
          <el-empty v-if="!groups[col.status]?.length" :image-size="60" :description="$t('common.no_tasks')" />
        </div>
      </div>
    </div>

    <!-- 列表视图：可筛选 -->
    <el-card v-if="!viewArchived" shadow="never" class="block-card" style="margin-top: 16px;">
      <template #header>
        <div class="block-title">
          <span>{{ $t('tasks.task_list') }}</span>
          <el-radio-group v-model="viewMode" size="small" style="margin-left: 16px;">
            <el-radio-button value="kanban">{{ $t('common.board') }}</el-radio-button>
            <el-radio-button value="list">{{ $t('common.list') }}</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <el-table v-if="viewMode === 'list'" :data="list" stripe @row-click="openDetail" @selection-change="rows => selectedRows = rows" style="cursor: pointer;">
        <!-- v2.12.1(#1275) 批量验收勾选(仅可验收者见) -->
        <el-table-column v-if="can('task.changeStatus')" type="selection" width="40" :selectable="row => row.status === 'DONE'" />
        <!-- v1.9.13(#366): 列表也带编号 -->
        <el-table-column :label="$t('common.code')" width="80">
          <template #default="{ row }"><span class="task-no">#{{ row.id }}</span></template>
        </el-table-column>
        <el-table-column :label="$t('common.task')" min-width="240">
          <template #default="{ row }">
            <div class="table-title-cell">{{ row.title }}</div>
            <ActiveWorkBadge :active-work="row.activeWork" :task-id="row.id" :task-title="row.title" />
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.project')" width="220">
          <template #default="{ row }">{{ row.project?.code }} · {{ row.project?.name }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.assignee')" width="120">
          <template #default="{ row }">{{ row.assignee?.name || '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small" effect="light">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.priority')" width="80">
          <template #default="{ row }">
            <el-tag :type="priorityType(row.priority)" size="small" effect="dark">{{ priorityLabel(row.priority) }}</el-tag>
          </template>
        </el-table-column>
        <!-- v2.1.13(#563) 来源列 -->
        <el-table-column :label="$t('common.source')" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.source" size="small" effect="plain" :type="SOURCE_TYPES[row.source] || 'info'">{{ SOURCE_LABELS[row.source] || row.source }}</el-tag>
            <span v-else style="color:#bbb;">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.due')" width="100">
          <template #default="{ row }">
            <span :class="dueClass(row.dueDate)">{{ formatDate(row.dueDate) }}</span>
          </template>
        </el-table-column>
        <!-- v2.1.7(#494): 任务实耗(已审批工时之和) -->
        <el-table-column :label="$t('tasks.spent')" width="80" align="right">
          <template #default="{ row }">
            <span v-if="row.actualHours"><b>{{ row.actualHours }}</b> h</span>
            <span v-else style="color:#bbb;">—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建/编辑对话框 -->
    <el-dialog v-model="editVisible" :title="editing ? $t('common.edit_task') : $t('common.new_task')" width="560px" @closed="resetForm">
      <el-form :model="form" :rules="formRules" ref="formRef" label-width="100px">
        <el-form-item :label="$t('common.project')" prop="projectId">
          <el-select v-model="form.projectId" :disabled="editing" filterable :placeholder="$t('common.choose_project')" style="width: 100%;" @change="onFormProjectChange">
            <el-option v-for="p in projects" :key="p.id" :label="`${p.code} ${p.name}`" :value="String(p.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.title')" prop="title">
          <el-input v-model="form.title" :placeholder="$t('tasks.e_g_finish_production_deployment')" />
        </el-form-item>
        <el-form-item :label="$t('common.description')">
          <!-- 1.2.7: 需求常以 Markdown 写在描述里, 加高输入区; 详情弹窗按 MD 渲染 -->
          <el-input v-model="form.description" type="textarea" :rows="8" :placeholder="$t('tasks.markdown_supported_heading_list_code_block')" class="md-input" />
        </el-form-item>
        <el-form-item :label="$t('common.assignee')">
          <el-select v-model="form.assigneeId" filterable clearable
            :placeholder="form.projectId ? $t('tasks.choose_project_members') : $t('common.choose_project_first')" :loading="membersLoading" style="width: 100%;">
            <el-option v-for="o in assigneeSelectOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.priority')" prop="priority">
          <el-radio-group v-model="form.priority">
            <el-radio-button value="LOW">{{ $t('common.low') }}</el-radio-button>
            <el-radio-button value="MEDIUM">{{ $t('common.medium') }}</el-radio-button>
            <el-radio-button value="HIGH">{{ $t('common.high') }}</el-radio-button>
            <el-radio-button value="URGENT">{{ $t('common.urgent') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="$t('common.due_date')">
          <el-date-picker v-model="form.dueDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" />
        </el-form-item>
        <!-- v2.1.13(#563) 来源标注: 支撑商机意识/主动性统计, 可不填(未标注) -->
        <el-form-item :label="$t('common.source')">
          <el-select v-model="form.source" clearable :placeholder="$t('common.not_set')" style="width: 100%;">
            <el-option v-for="(l, v) in SOURCE_LABELS" :key="v" :label="l" :value="v" />
          </el-select>
        </el-form-item>
        <!-- v1.4.x 附件: 需求文档/设计稿等随任务同步给执行方 -->
        <el-form-item :label="$t('common.attachments')">
          <div style="width: 100%;">
            <div v-for="(a, i) in form.attachments" :key="i" class="att-row">
              📎 <el-link :href="a.fileUrl" target="_blank" type="primary">{{ a.filename }}</el-link>
              <span class="att-size">{{ fmtSize(a.fileSize) }}</span>
              <el-button link type="danger" size="small" @click="removeFormAttachment(i)">{{ $t('common.remove') }}</el-button>
            </div>
            <el-upload :http-request="handleFormUpload" :show-file-list="false" multiple>
              <el-button size="small" :loading="attUploading">{{ $t('common.upload_attachment') }}</el-button>
            </el-upload>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="editing && can('task.delete')" type="danger" @click="handleDelete" style="float: left;">{{ $t('common.delete_2') }}</el-button>
        <el-button @click="editVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 详情 dialog (1.2.6 抽成共享组件, 项目详情/个人仪表盘同款) -->
    <!-- v2.1.13(#650): 弹窗内操作后后台刷新, 不闪整页 loading -->
    <TaskDetailDialog v-model="detailVisible" :task-id="detailTaskId" @changed="() => loadList(true)" @edit="openEditFromDetail" />

  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import TaskDetailDialog from '@/components/admin/TaskDetailDialog.vue'
import ActiveWorkBadge from '@/components/common/ActiveWorkBadge.vue'   // v2.12.0(#1255)

// v1.9.7(#353): 任务状态流重构为五态, 新增 QUEUED(等候生产)
const STATUS_LABELS = { TODO: $t('common.inbox'), QUEUED: $t('common.queued'), IN_PROGRESS: $t('common.in_progress_2'), DONE: $t('common.built'), VERIFIED: $t('common.accepted'), REWORK: $t('tasks.rework') }   // v2.1.8(#512)
const STATUS_TYPES = { TODO: 'info', QUEUED: 'warning', IN_PROGRESS: 'primary', DONE: 'success', VERIFIED: 'success', REWORK: 'danger' }
const PRIORITY_LABELS = { LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high'), URGENT: $t('common.urgent') }
const PRIORITY_TYPES = { LOW: 'info', MEDIUM: 'primary', HIGH: 'warning', URGENT: 'danger' }
// v2.1.13(#563) 任务来源: 支撑「商机意识」「主动性」统计, 存量任务未标注
const SOURCE_LABELS = { CUSTOMER: $t('common.customer_request'), REVIEW: $t('common.review'), PATROL: $t('common.patrol'), SELF: $t('common.self_initiated') }
const SOURCE_TYPES = { CUSTOMER: 'danger', REVIEW: 'warning', PATROL: 'info', SELF: 'success' }
const COLUMNS_DEF = [
  { status: 'TODO', label: $t('common.inbox'), color: '#909399' },
  { status: 'QUEUED', label: $t('common.queued'), color: '#b3771e' },
  { status: 'IN_PROGRESS', label: $t('common.in_progress_2'), color: '#1c1917' },
  { status: 'DONE', label: $t('common.built'), color: '#2e7d4f' },
  { status: 'VERIFIED', label: $t('common.accepted'), color: '#85ce61' }
]
function statusLabel(s) { return STATUS_LABELS[s] || s }
function statusType(s) { return STATUS_TYPES[s] || 'info' }
function priorityLabel(p) { return PRIORITY_LABELS[p] || p }
function priorityType(p) { return PRIORITY_TYPES[p] || 'info' }
const columns = COLUMNS_DEF

const user = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')

const list = ref([])
const total = ref(0)
const loading = ref(false)
// H5(#1250): 手机上筛选区默认折叠
const filterCollapsed = ref(true)
// v2.12.1(#1275) 批量验收勾选
const selectedRows = ref([])
const myCount = computed(() => list.value.filter(t => t.assigneeId && String(t.assigneeId) === String(currentUserId.value)).length)
const currentUserId = ref(null)
const groups = computed(() => {
  const g = {}
  for (const c of columns) g[c.status] = list.value.filter(t => t.status === c.status)
  return g
})

const projects = ref([])
const filterProjectId = ref('')
const filterStatus = ref('')
const filterPriority = ref('')
// v1.9.3: 里程碑/成员筛选(选中项目后出现) + 逾期/今日快捷筛选
const filterMilestoneId = ref('')   // 里程碑 id 或 'none'(未挂里程碑)
const filterAssigneeId = ref('')    // 工程师档案 id(接口 assigneeId 语义)
const filterMilestones = ref([])
const filterMembers = ref([])
// v2.1.13(#563): 来源筛选('none'=未标注)
const filterSource = ref('')
const quickFilter = ref('')         // '' | 'overdue' | 'due_today', 两者互斥
function toggleQuickFilter(kind) {
  quickFilter.value = quickFilter.value === kind ? '' : kind
  loadList()
}
// 切换项目: 清空里程碑/成员选择并按新项目重拉选项
function onFilterProjectChange() {
  filterMilestoneId.value = ''
  filterAssigneeId.value = ''
  filterMilestones.value = []
  filterMembers.value = []
  if (filterProjectId.value) {
    loadFilterMilestones(filterProjectId.value)
    loadFilterMembers(filterProjectId.value)
  }
  loadList()
}
async function loadFilterMilestones(projectId) {
  try {
    const data = await fde.projects.milestones(projectId)
    // 只列未完成的 —— 已完成里程碑下的任务基本都已验收, 筛出来意义不大
    filterMilestones.value = (data.list || []).filter(m => m.status !== 'COMPLETED')
  } catch (e) { /* 无权限等静默 */ }
}
async function loadFilterMembers(projectId) {
  // 复用表单的成员缓存; 筛选只认工程师档案 id(u: 前缀的无档案成员筛不了, 不列)
  if (!memberOptionsCache.has(projectId)) await loadAssigneeOptions(projectId)
  filterMembers.value = (memberOptionsCache.get(projectId) || [])
    .filter(o => o.value.startsWith('e:'))
    .map(o => ({ value: o.value.slice(2), label: o.label }))
}
function resetFilters() {
  filterProjectId.value = ''
  filterStatus.value = ''
  filterPriority.value = ''
  filterMilestoneId.value = ''
  filterAssigneeId.value = ''
  filterMilestones.value = []
  filterMembers.value = []
  filterSource.value = ''
  quickFilter.value = ''
  loadList()
}
// v2.0.1(#396): 精简卡片(默认开, 与项目看板共用 key)
const BOARD_COMPACT_KEY = 'fde_board_compact'
const boardCompact = ref(localStorage.getItem(BOARD_COMPACT_KEY) !== '0')
function onBoardCompactChange() { localStorage.setItem(BOARD_COMPACT_KEY, boardCompact.value ? '1' : '0') }

// 「仅我的」勾选状态本地缓存, 常用「只看自己任务」的用户下次进来不用重新勾
const MINE_ONLY_KEY = 'fde_tasks_mine_only'
const mineOnly = ref(localStorage.getItem(MINE_ONLY_KEY) === '1')
function onMineOnlyChange() {
  localStorage.setItem(MINE_ONLY_KEY, mineOnly.value ? '1' : '0')
  loadList()
}
const viewMode = ref('kanban')
// v1.2.9: 归档
const viewArchived = ref(false)
const verifiedCount = computed(() => groups.value.VERIFIED?.length || 0)

async function archiveVerified() {
  try {
    await ElMessageBox.confirm($t('tasks.archive_visible_accepted_tasks_restore_them', { p0: verifiedCount.value }), $t('common.archive_all'), { type: 'info' })
  } catch { return }
  try {
    const r = await fde.tasks.archiveVerified(filterProjectId.value || null)
    ElMessage.success($t('common.archived_tasks', { p0: r.archived }))
    loadList()
  } catch (e) { ElMessage.error(e.message) }
}

// v2.12.1(#1275) 批量验收勾选任务
async function batchVerifySelected() {
  const rows = selectedRows.value.filter(r => r.status === 'DONE')
  if (!rows.length) { ElMessage.warning($t('tasks.select_tasks_with_status_built_first')); return }
  try {
    await ElMessageBox.confirm($t('tasks.accept_selected_built_tasks', { p0: rows.length }), $t('tasks.accept_selected_2'), { type: 'warning' })
  } catch { return }
  try {
    const r = await fde.tasks.batchVerify(rows.map(x => x.id))
    if (r.verified) ElMessage.success($t('tasks.accepted_tasks', { p0: r.verified }))
    if (r.failed?.length) ElMessage.warning($t('tasks.not_allowed', { p0: r.failed.length, p1: r.failed.map(f => `#${f.id} ${f.reason}`).join($t('common.list_sep_semi')).slice(0, 150) }))
    selectedRows.value = []
    loadList()
  } catch (e) { ElMessage.error(e.message) }
}
async function unarchive(row) {
  try {
    await fde.tasks.unarchive(row.id)
    ElMessage.success($t('common.recovered'))
    loadList()
  } catch (e) { ElMessage.error(e.message) }
}

// v2.1.13(#650): silent=true 后台刷新(数据就地替换不闪整页 loading); 模板 @change 会传选中值, 故严格判等
async function loadList(silent) {
  if (silent !== true) { loading.value = true; filterCollapsed.value = true }   // H5: 查询后收起
  try {
    const params = { page_size: 100 }
    if (viewArchived.value) params.archived = 'true'
    if (filterProjectId.value) params.projectId = filterProjectId.value
    if (filterStatus.value) params.status = filterStatus.value
    if (filterPriority.value) params.priority = filterPriority.value
    if (mineOnly.value) params.mine = 'true'
    // v1.9.3: 里程碑/成员筛选只在选中项目时生效; 逾期/今日快捷筛选
    if (filterProjectId.value && filterMilestoneId.value) params.milestone_id = filterMilestoneId.value
    if (filterProjectId.value && filterAssigneeId.value) params.assigneeId = filterAssigneeId.value
    if (quickFilter.value === 'overdue') params.overdue = '1'
    if (quickFilter.value === 'due_today') params.due_today = '1'
    if (filterSource.value) params.source = filterSource.value
    syncFiltersToQuery()   // v2.5.5(#914) 筛选状态写入 URL, 刷新/返回不丢
    const data = await fde.tasks.list(params)
    list.value = data.list
    total.value = data.total
    currentUserId.value = currentUserId.value || (await fetchMeUserId())
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
async function fetchMeUserId() {
  try {
    const me = await fde.me()
    return me?.profile?.id || null
  } catch { return null }
}

async function loadProjects() {
  try {
    const data = await fde.projects.list({ page_size: 100 })
    projects.value = data.list
  } catch (e) { /* ignore */ }
}

// 指派候选 = 所选项目的在职成员 (与项目详情页同款套路):
// 有工程师档案传 e:<engineerId>, 没有传 u:<userId>(后端 assigneeUserId 自动补建档案)
const membersLoading = ref(false)
const memberOptionsCache = new Map()
const assigneeOptions = ref([])
// 编辑带出的原负责人已退出项目/不在成员表时, 兜底注入一个选项保证正常回显
const assigneeFallback = ref(null)
const assigneeSelectOptions = computed(() => {
  if (assigneeFallback.value && !assigneeOptions.value.some(o => o.value === assigneeFallback.value.value)) {
    return [assigneeFallback.value, ...assigneeOptions.value]
  }
  return assigneeOptions.value
})
async function loadAssigneeOptions(projectId) {
  assigneeOptions.value = []
  if (!projectId) return
  if (memberOptionsCache.has(projectId)) {
    assigneeOptions.value = memberOptionsCache.get(projectId)
    return
  }
  membersLoading.value = true
  try {
    const p = await fde.projects.detail(projectId)
    const opts = (p.members || [])
      .filter(m => !m.leaveDate)
      .map(m => {
        const label = m.engineer?.user?.name || m.user?.name || $t('common.members')
        if (m.engineer) return { value: 'e:' + m.engineer.id, label }
        const uid = m.user?.id ?? m.userId
        return uid ? { value: 'u:' + uid, label } : null
      })
      .filter(Boolean)
    memberOptionsCache.set(projectId, opts)
    assigneeOptions.value = opts
  } catch (e) { /* 无权限等静默, 保持空列表 */ }
  finally { membersLoading.value = false }
}
// 用户手动切换项目时清掉已选负责人(编辑回填不触发, 因为走 Object.assign 后 watch 只刷新选项)
function onFormProjectChange() {
  form.assigneeId = ''
  assigneeFallback.value = null
}

// v1.9.7(#353): 五态快捷流转 TODO→QUEUED→IN_PROGRESS→DONE→VERIFIED
function nextActions(s) {
  const map = {
    TODO: [{ to: 'QUEUED', label: $t('common.move_queue'), type: 'warning' }],
    QUEUED: [{ to: 'IN_PROGRESS', label: $t('common.start_work'), type: 'primary' }],
    IN_PROGRESS: [{ to: 'DONE', label: $t('common.built'), type: 'success' }],
    DONE: [{ to: 'VERIFIED', label: $t('common.accept'), type: 'success' }],
    VERIFIED: []
  }
  return map[s] || []
}
// v2.0.1(#391): 转等候生产不再强制填计划起止(主人反馈这步多余), 直接流转
async function quickChange(t, status) {
  try {
    await fde.tasks.changeStatus(t.id, status)
    ElMessage.success($t('common.updated'))
    loadList(true)   // v2.1.13(#650) 后台刷新
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function formatDate(s) { return s ? s.slice(0, 10) : '' }
// v1.9.7(#353): QUEUED 卡片显示计划起止(MM-DD)
function plannedRange(t) {
  const f = (v) => (v ? String(v).slice(5, 10) : '?')
  return `${f(t.plannedStartAt)} ~ ${f(t.plannedEndAt)}`
}
function dueClass(d) {
  if (!d) return ''
  const due = new Date(d)
  const now = new Date()
  if (due < now && STATUS_LABELS_INCOMPLETE.has(currentStatus.value)) return 'overdue'
  return ''
}
const STATUS_LABELS_INCOMPLETE = new Set(['TODO', 'QUEUED', 'IN_PROGRESS'])  // v1.9.7(#353)
const currentStatus = ref(null)
// 详情 dialog (1.2.6 抽成 TaskDetailDialog 组件, 项目详情/个人仪表盘同款)
const detailVisible = ref(false)
const detailTaskId = ref(null)
function openDetail(t) {
  currentStatus.value = t.status
  detailTaskId.value = t.id
  detailVisible.value = true
}

// 从详情点编辑 → 切到 editVisible (组件 @edit 回传完整任务对象)
function openEditFromDetail(t) {
  detailVisible.value = false
  editing.value = true
  // 负责人存的是 engineer.id, 选项值带 e: 前缀; 原负责人可能不在当前成员表, 用 assignee.name 兜底回显
  assigneeFallback.value = t.assigneeId ? { value: 'e:' + t.assigneeId, label: t.assignee?.name || $t('tasks.current_owner') } : null
  Object.assign(form, {
    id: t.id, projectId: String(t.projectId), title: t.title, description: t.description || '',
    assigneeId: t.assigneeId ? 'e:' + t.assigneeId : '', priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.slice(0, 10) : '',
    source: t.source || '',   // v2.1.13(#563)
    // 编辑时带出已有任务级附件 (评论附件不在此管理)
    attachments: (t.attachments || []).filter(a => !a.commentId).map(a => ({ id: a.id, filename: a.filename, fileUrl: a.fileUrl, fileSize: a.fileSize })),
  })
  editVisible.value = true
}

// 新建
const editVisible = ref(false)
const editing = ref(false)
const formRef = ref(null)
const submitting = ref(false)
const form = reactive({ id: null, projectId: '', title: '', description: '', assigneeId: '', priority: 'MEDIUM', dueDate: '', source: '', attachments: [] })

watch(() => form.projectId, v => loadAssigneeOptions(v))

// v1.4.x 附件上传 (走既有七牛上传接口; 新建=暂存提交时一起带, 编辑=对已存在任务即传即存)
const attUploading = ref(false)
function fmtSize(s) { if (!s) return ''; const n = Number(s); return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB' }
async function handleFormUpload({ file }) {
  attUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fde.uploads.upload(fd)
    if (r.code !== 0) throw new Error(r.message || $t('common.upload_failed'))
    const att = { filename: file.name, fileUrl: r.data.url, fileSize: file.size }
    if (editing.value && form.id) {
      await fde.tasks.addAttachment(form.id, att)
      ElMessage.success($t('common.attachment_uploaded'))
    }
    form.attachments.push(att)
  } catch (e) { ElMessage.error(e.message || $t('common.upload_failed')) }
  finally { attUploading.value = false }
}
async function removeFormAttachment(i) {
  const a = form.attachments[i]
  if (editing.value && a.id) {
    try { await fde.tasks.removeAttachment(a.id) } catch (e) { return ElMessage.error(e.message) }
  }
  form.attachments.splice(i, 1)
}
const formRules = {
  projectId: [{ required: true, message: $t('common.choose_project_2'), trigger: 'change' }],
  title: [{ required: true, message: $t('tasks.enter_title'), trigger: 'blur' }],
  priority: [{ required: true, message: $t('tasks.choose_priority'), trigger: 'change' }]
}
function openCreate() {
  editing.value = false
  assigneeFallback.value = null
  Object.assign(form, { id: null, projectId: '', title: '', description: '', assigneeId: '', priority: 'MEDIUM', dueDate: '', source: '', attachments: [] })
  editVisible.value = true
}
// 2026-07-07 P1-4: 只清校验状态、不重置 form 数据,
// 避免点 dialog 外侧关闭 时 (el-dialog 默认 close-on-click-modal=true)
// @closed 触发的 resetFields() 把刚选的项目冲掉
function resetForm() {
  formRef.value?.clearValidate()
}
async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    // e: 前缀传 assigneeId(工程师档案), u: 前缀传 assigneeUserId(后端自动补建档案)
    const a = form.assigneeId || ''
    const assignee = {
      assigneeId: a.startsWith('e:') ? a.slice(2) : (a.startsWith('u:') ? undefined : (editing.value ? null : undefined)),
      assigneeUserId: a.startsWith('u:') ? a.slice(2) : undefined
    }
    if (editing.value) {
      await fde.tasks.update(form.id, {
        title: form.title, description: form.description,
        ...assignee, priority: form.priority, dueDate: form.dueDate,
        source: form.source || null   // v2.1.13(#563) 清空=回未标注
      })
      ElMessage.success($t('common.updated'))
    } else {
      await fde.tasks.create({
        projectId: form.projectId, title: form.title, description: form.description,
        ...assignee, priority: form.priority, dueDate: form.dueDate, attachments: form.attachments,
        source: form.source || undefined   // v2.1.13(#563)
      })
      ElMessage.success($t('common.created_2'))
    }
    editVisible.value = false
    loadList(true)   // v2.1.13(#650) 后台刷新
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally {
    submitting.value = false
  }
}
async function handleDelete() {
  try {
    await ElMessageBox.confirm($t('tasks.delete_this_task'), $t('common.confirm'), { type: 'warning' })
  } catch { return }
  try {
    await fde.tasks.remove(form.id)
    ElMessage.success($t('common.deleted'))
    editVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// v1.4.x: 通知直达 —— /admin/tasks?open=<taskId> 自动打开任务详情; ?projectId= 预置项目筛选
const route = useRoute()
const router = useRouter()
// v2.5.5(#914): 筛选条件 ↔ URL query 双向同步(小组多选用逗号); open 仍是一次性参数
const FILTER_QUERY = {
  projectId: filterProjectId, status: filterStatus, priority: filterPriority, source: filterSource,
  milestone: filterMilestoneId, assignee: filterAssigneeId, quick: quickFilter
}
function syncFiltersToQuery() {
  const q = {}
  for (const [k, r] of Object.entries(FILTER_QUERY)) if (r.value) q[k] = String(r.value)
  if (mineOnly.value) q.mine = '1'
  if (viewArchived.value) q.archived = '1'
  const cur = { ...route.query }; delete cur.open
  if (JSON.stringify(cur) !== JSON.stringify(q)) router.replace({ path: route.path, query: q })
}
function applyQuery() {
  const q = route.query
  for (const [k, r] of Object.entries(FILTER_QUERY)) if (q[k] != null && q[k] !== '') r.value = String(q[k])
  if (q.mine === '1') mineOnly.value = true
  if (q.archived === '1') viewArchived.value = true
  if (filterProjectId.value) {
    // v1.9.3: 预置了项目筛选时, 里程碑/成员下拉的选项也要跟上
    loadFilterMilestones(filterProjectId.value)
    loadFilterMembers(filterProjectId.value)
  }
  if (q.open) {
    detailTaskId.value = q.open
    detailVisible.value = true
    // 清掉 open, 避免刷新重复弹出; 其余筛选参数保留
    const rest = { ...q }; delete rest.open
    router.replace({ path: route.path, query: rest })
  }
}
watch(() => route.query.open, v => { if (v) applyQuery() })

onMounted(async () => {
  await loadProjects()
  applyQuery()
  loadList()
})

// v2.12.0(#1256) 徽标 15s 自动刷新: 只在页面可见时轮询; 切到后台暂停、切回前台立即拉一次
const REFRESH_MS = 15000
let refreshTimer = null
function startRefresh() {
  stopRefresh()
  refreshTimer = setInterval(() => loadList(true), REFRESH_MS)
}
function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
}
function onVisibility() {
  if (document.hidden) { stopRefresh(); return }
  loadList(true)
  startRefresh()
}
onMounted(() => {
  startRefresh()
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  stopRefresh()
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<style scoped>
.tasks-page { display: flex; flex-direction: column; gap: 12px; }
.page-header { display: flex; align-items: center; gap: 12px; }
.page-header > div:first-child { margin-right: auto; }
.header-actions { display: flex; align-items: center; gap: 10px; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }

.filter-bar { padding-bottom: 0; }
.att-row { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 1.8; }
.att-size { font-size: 11px; color: #909399; }
/* v1.9.13(#363): 列最小宽度兜底, 空列/窄屏不再被压瘪, 放不下时横向滚动 */
.kanban { display: grid; grid-template-columns: repeat(6, minmax(180px, 1fr)); gap: 12px; overflow-x: auto; }   /* v2.1.8: +返工列 */
.kanban-col { background: #f8f9fa; border-radius: 10px; padding: 8px; min-height: 400px; }
.col-head {
  background: white;
  padding: 10px 14px;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  border-top: 3px solid #909399;
  font-weight: 600;
}
.col-title { font-size: 14px; }
.col-count {
  background: #f0f0f0;
  color: #606266;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
}
.col-body { display: flex; flex-direction: column; gap: 8px; }
.task-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.task-card:hover { border-color: #d2521e; box-shadow: 0 4px 12px rgba(210, 82, 30,0.1); }
.task-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.head-left { display: flex; align-items: center; gap: 6px; } /* v1.9.13(#366) */
.task-no { font-size: 11px; color: #909399; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.task-project { font-size: 11px; color: #909399; max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.md-input :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.task-title { font-weight: 600; font-size: 14px; color: #1c1917; margin-bottom: 4px; line-height: 1.4; }
/* v2.12.0(#1255): 标题与「谁在做」徽标; 窄屏自动堆叠 */
.task-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.task-title-row .task-title { margin-bottom: 0; min-width: 0; }
.task-title-row { margin-top: 0; }
.task-desc { font-size: 12px; color: #868580; line-height: 1.5; max-height: 36px; overflow: hidden; margin-bottom: 8px; }
.task-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.task-assignee { display: flex; align-items: center; gap: 6px; }
.aname { font-size: 12px; }
.aname.muted { color: #c0c4cc; }
.task-due { font-size: 11px; color: #606266; }
.task-due.overdue { color: #c2362b; font-weight: 600; }
.task-planned { font-size: 11px; color: #b3771e; margin-top: 6px; } /* v1.9.7(#353): 计划起止 */
.task-progress { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #f0f0f0; }
.task-progress :deep(.el-progress) { flex: 1; }
.prog-text { font-size: 10px; color: #909399; }
.task-actions { display: flex; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ebeef5; }

/* 详情 dialog */
.detail-info { padding: 8px 0; }
.info-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
.info-value { font-size: 14px; color: #1c1917; }
.info-value code { background: #f0f0f0; padding: 1px 6px; border-radius: 3px; font-size: 12px; color: #606266; }
.detail-actions { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ebeef5; display: flex; gap: 8px; flex-wrap: wrap; }

.subtask-progress { margin-bottom: 12px; }
.subtask-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px dashed #f0f0f0; }
.subtask-item:last-of-type { border-bottom: none; }
.subtask-item :deep(.el-checkbox) { flex: 1; }
.add-subtask { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #ebeef5; }

.comment-list { max-height: 400px; overflow-y: auto; }
.comment-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px dashed #f0f0f0; }
.comment-item:last-of-type { border-bottom: none; }
.comment-body { flex: 1; }
.comment-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.comment-time { font-size: 11px; color: #909399; }
.comment-content { font-size: 14px; line-height: 1.6; color: #1c1917; }
.comment-content :deep(.at-mention) { color: #d2521e; font-weight: 600; background: #fdf3ee; padding: 1px 4px; border-radius: 3px; }
.add-comment { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #ebeef5; }
.add-comment-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.add-comment-foot .hint { font-size: 11px; color: #909399; }
/* v2.1.8(#510) AC 编辑器 */

/* ===== H5 适配 (#1250) ===== */
@media (max-width: 767px) {
  /* 页头换行: 标题+操作折行 */
  .page-header { flex-wrap: wrap; gap: 8px; }
  .page-header > div:first-child { flex-basis: 100%; margin-right: 0; }
  .header-actions { flex-wrap: wrap; gap: 8px; }
  .page-title { font-size: 19px; }
  /* 筛选区默认折叠, 表单项占满一行 */
  .filter-bar.mobile-filter-collapsed :deep(.el-form) { display: none; }
  .filter-bar :deep(.el-form-item) { margin-right: 0; width: 100%; }
  .filter-bar :deep(.el-form-item .el-select) { width: 100%; }
  .filter-toggle { width: 100%; text-align: left; }
  /* 看板六列保持横向滑动, 触屏加惯性滚动; 列稍窄让两条半露出来提示可滑 */
  .kanban { grid-template-columns: repeat(6, minmax(160px, 72vw)); -webkit-overflow-scrolling: touch; }
  .kanban-col { min-height: 300px; }
}
</style>