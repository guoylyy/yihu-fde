<template>
  <div class="engineers-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('engineers.engineer_pool') }}</h2>
        <p class="hint">
          {{ $t('engineers.assignable_members', { p0: pagination.total }) }}
          <span :class="availableCount === 0 ? 'warn' : ''">
            {{ $t('engineers.assignable', { p0: availableCount }) }}
          </span>
        </p>
      </div>
      <el-button v-if="can('user.create')" type="primary" @click="goCreateUser">
        <el-icon><Plus /></el-icon>{{ $t('engineers.new_internal_member') }}
      </el-button>
    </div>

    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px;">
      <template #title>
        {{ $t('engineers.project_managers_operations_fde_engineers_sales') }}
      </template>
    </el-alert>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item :label="$t('common.search')">
          <el-input v-model="filters.keyword" :placeholder="$t('engineers.name_username_phone')" clearable @keyup.enter="loadList" />
        </el-form-item>
        <el-form-item :label="$t('common.role')">
          <el-select v-model="filters.role" :placeholder="$t('common.all')" clearable style="width: 150px;">
            <el-option :label="$t('common.fde_engineer')" value="FDE_ENGINEER" />
            <el-option :label="$t('common.project_manager')" value="MANAGER" />
            <el-option :label="$t('common.operations')" value="PLATFORM" />
            <el-option :label="$t('common.sales')" value="SALES" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('engineers.level')">
          <el-select v-model="filters.level" :placeholder="$t('common.all')" clearable style="width: 130px;">
            <el-option :label="$t('common.junior')" value="JUNIOR" />
            <el-option :label="$t('common.mid')" value="MIDDLE" />
            <el-option :label="$t('common.senior')" value="SENIOR" />
            <el-option :label="$t('common.expert')" value="EXPERT" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('engineers.assignable_2')">
          <el-select v-model="filters.available" :placeholder="$t('common.all')" clearable style="width: 100px;">
            <el-option :label="$t('engineers.yes')" :value="1" />
            <el-option :label="$t('engineers.no')" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">{{ $t('common.search_2') }}</el-button>
          <el-button @click="resetFilters">{{ $t('common.reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column :label="$t('common.name_2')" min-width="140">
          <template #default="{ row }">
            <strong>{{ row.name }}</strong>
            <div style="font-size: 12px; opacity: 0.6;">{{ row.phone || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.username')" prop="username" width="130" />
        <el-table-column :label="$t('common.role')" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="roleType(row.role)" size="small" effect="light">{{ roleLabel(row.role) }}</el-tag>
          </template>
        </el-table-column>
        <!-- v1.5.6 所属团队 (即时消息通知按团队定位) -->
        <el-table-column :label="$t('common.team')" min-width="140">
          <template #default="{ row }">
            <template v-if="row.teams?.length">
              <el-tag v-for="t in row.teams" :key="t.id" size="small" effect="plain" style="margin-right: 4px;">{{ t.name }}</el-tag>
            </template>
            <span v-else style="opacity: 0.4;">{{ $t('common.not_set_2') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('engineers.account_status')" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="light">
              {{ $t('common.p0', { p0: row.status === 1 ? $t('common.enabled') : $t('common.disable') }) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('engineers.profile')" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.hasProfile" type="success" size="small" effect="light">{{ $t('engineers.created') }}</el-tag>
            <el-tag v-else type="warning" size="small" effect="light">{{ $t('engineers.create') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('engineers.level')" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.level" :type="levelType(row.level)" effect="light" size="small">{{ levelLabel(row.level) }}</el-tag>
            <span v-else style="color: #c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="city" :label="$t('common.city')" width="80">
          <template #default="{ row }">{{ row.city || '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('engineers.daily_rate')" width="100" align="right">
          <template #default="{ row }">{{ row.dailyRate ? formatMoney(row.dailyRate) : '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.skills_3')" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="s in (row.skills || [])" :key="s" size="small" effect="plain" style="margin-right: 4px;">{{ s }}</el-tag>
            <span v-if="!row.skills || row.skills.length === 0" style="color: #c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('engineers.projects_hours')" width="100" align="center">
          <template #default="{ row }">{{ row.projectMembers }} / {{ row.timesheets }}</template>
        </el-table-column>
        <el-table-column :label="$t('engineers.assignable_2')" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.available === 1" type="success" size="small" effect="light">{{ $t('engineers.yes_2') }}</el-tag>
            <el-tag v-else-if="row.available === 0" type="info" size="small" effect="light">{{ $t('engineers.no') }}</el-tag>
            <span v-else style="color: #c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="260" fixed="right">
          <template #default="{ row }">
            <el-button v-if="can('engineer.edit') && row.id" size="small" link type="primary" @click="openEdit(row)">{{ $t('engineers.edit_profile') }}</el-button>
            <el-button v-if="can('engineer.view') && row.id" size="small" link type="success" @click="openStats(row)">{{ $t('engineers.performance') }}</el-button>
            <el-button v-if="can('user.edit')" size="small" link :type="row.status === 1 ? 'info' : 'success'" @click="toggleStatus(row)">
              {{ $t('common.p0', { p0: row.status === 1 ? $t('engineers.disable_account') : $t('engineers.enable_account') }) }}
            </el-button>
            <el-button v-if="can('user.edit')" size="small" link @click="goUserEdit(row)">{{ $t('engineers.account_info') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.page_size"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadList"
        @size-change="loadList"
        style="margin-top: 16px; justify-content: flex-end;"
      />
    </el-card>

    <!-- 档案编辑对话框 -->
    <el-dialog v-model="editVisible" :title="editing ? $t('engineers.edit_engineer_profile') : $t('engineers.new_engineer_profile')" width="600px" @closed="resetEditForm">
      <el-form :model="editForm" :rules="editRules" ref="editFormRef" label-width="100px">
        <el-form-item :label="$t('common.account')">
          <span v-if="currentRow">
            {{ currentRow.name }} ({{ currentRow.username }})
            <el-tag v-if="currentRow && !currentRow.hasProfile" type="warning" size="small" style="margin-left: 8px;">{{ $t('engineers.no_profile_yet') }}</el-tag>
          </span>
        </el-form-item>
        <el-form-item :label="$t('engineers.level')" prop="level">
          <el-select v-model="editForm.level" :placeholder="$t('engineers.choose')" style="width: 200px;">
            <el-option :label="$t('engineers.junior_junior')" value="JUNIOR" />
            <el-option :label="$t('engineers.mid_middle')" value="MIDDLE" />
            <el-option :label="$t('engineers.senior_senior')" value="SENIOR" />
            <el-option :label="$t('engineers.expert_expert')" value="EXPERT" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('engineers.city')" prop="city">
          <el-input v-model="editForm.city" :placeholder="$t('engineers.e_g_shanghai')" style="width: 200px;" />
        </el-form-item>
        <el-form-item :label="$t('engineers.daily_rate')" prop="dailyRate">
          <el-input-number v-model="editForm.dailyRate" :min="0" :precision="2" :step="100" controls-position="right" :placeholder="$t('engineers.day')" />
          <span style="margin-left: 8px; color: #909399;">{{ $t('engineers.day') }}</span>
        </el-form-item>
        <el-form-item :label="$t('common.skills_3')" prop="skills">
          <el-input
            v-model="skillsInput"
            :placeholder="$t('engineers.separate_skills_with_commas_e_g')"
            @blur="parseSkills"
          />
        </el-form-item>
        <el-form-item :label="$t('engineers.bio')" prop="bio">
          <el-input v-model="editForm.bio" type="textarea" :rows="3" :placeholder="$t('engineers.one_line_intro')" />
        </el-form-item>
        <el-form-item :label="$t('engineers.assignable_2')" prop="available">
          <el-switch
            v-model="editForm.available"
            :active-value="1"
            :inactive-value="0"
            :active-text="$t('engineers.yes')"
            :inactive-text="$t('engineers.no')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="editSubmitting" @click="handleEditSubmit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 绩效卡 -->
    <el-dialog v-model="statsVisible" :title="$t('engineers.performance_card', { p0: statsData?.engineer?.name || '' })" width="720px">
      <div v-if="statsData" v-loading="statsLoading">
        <el-row :gutter="16" style="margin-bottom: 16px;">
          <el-col :span="8">
            <div class="stat-card">
              <div class="stat-label">{{ $t('engineers.total_hours') }}</div>
              <div class="stat-value">{{ statsData.summary.totalHours }}<span>h</span></div>
              <div class="stat-sub">{{ $t('engineers.h_approved', { p0: statsData.summary.approvedHours }) }}</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="stat-card">
              <div class="stat-label">{{ $t('engineers.utilization') }}</div>
              <div class="stat-value">{{ statsData.summary.utilization }}<span>%</span></div>
              <el-progress :percentage="statsData.summary.utilization" :stroke-width="6" :show-text="false" :color="utilColor(statsData.summary.utilization)" />
              <div class="stat-sub">{{ $t('engineers.capacity_h', { p0: statsData.summary.capacityHours }) }}</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="stat-card">
              <div class="stat-label">{{ $t('engineers.project_customer') }}</div>
              <div class="stat-value">{{ statsData.projects.total }}<span> {{ $t('engineers.text') }}</span></div>
              <div class="stat-sub">{{ $t('engineers.in_progress_customer', { p0: statsData.projects.active, p1: statsData.customers.uniqueCount }) }}</div>
            </div>
          </el-col>
        </el-row>

        <div class="stat-block">
          <h4>{{ $t('engineers.hours_trend_last_months', { p0: statsData.summary.months }) }}</h4>
          <div class="monthly-bars">
            <div v-for="m in statsData.monthly" :key="m.yearMonth" class="month-bar">
              <div class="mb-label">{{ $t('engineers.p0', { p0: m.yearMonth.slice(5) }) }}</div>
              <div class="mb-track">
                <div class="mb-fill" :style="{ height: (m.total / 22 / 8 * 100) + '%' }" :title="$t('engineers.h_total', { p0: m.total })">
                  <span v-if="m.total">{{ m.total }}</span>
                </div>
              </div>
              <div class="mb-approved" v-if="m.approved">{{ $t('common.h_approved', { p0: m.approved }) }}</div>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { fde, formatMoney } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { useRouter } from 'vue-router'

const router = useRouter()

const LEVEL_LABELS = { JUNIOR: $t('common.junior'), MIDDLE: $t('common.mid'), SENIOR: $t('common.senior'), EXPERT: $t('common.expert') }
const LEVEL_TYPES = { JUNIOR: 'info', MIDDLE: '', SENIOR: 'primary', EXPERT: 'danger' }
function levelLabel(l) { return LEVEL_LABELS[l] || $t('engineers.not_set') }
function levelType(l) { return LEVEL_TYPES[l] || 'info' }

// v1.3.2: 角色名/配色动态取自 roles 表
import { roleLabel as dynRoleLabel, roleTagType } from '@/api/roles.js'
function roleLabel(r) { return r ? dynRoleLabel(r) : '—' }
function roleType(r) { return roleTagType(r) }

const list = ref([])
const loading = ref(false)
const pagination = reactive({ page: 1, page_size: 20, total: 0 })
const filters = reactive({ keyword: '', level: '', available: '', role: '' })

const availableCount = computed(() => list.value.filter(r => r.available === 1).length)

async function loadList() {
  loading.value = true
  try {
    const params = { page: pagination.page, page_size: pagination.page_size }
    if (filters.keyword) params.keyword = filters.keyword
    if (filters.level) params.level = filters.level
    if (filters.available !== '') params.available = filters.available
    if (filters.role) params.role = filters.role
    const data = await fde.engineers.list(params)
    list.value = data.list
    pagination.total = data.total
  } catch (e) {
    ElMessage.error($t('common.failed_load_2') + e.message)
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.keyword = ''
  filters.level = ''
  filters.available = ''
  filters.role = ''
  pagination.page = 1
  loadList()
}

function goCreateUser() {
  router.push({ path: '/admin/users' })
}

function goUserEdit(row) {
  router.push({ path: '/admin/users', query: { edit: row.userId } })
}

// 编辑档案
const editVisible = ref(false)
const editing = ref(false)
const editFormRef = ref(null)
const editSubmitting = ref(false)
const currentRow = ref(null)
const skillsInput = ref('')
const editForm = reactive({
  level: '', city: '', dailyRate: null, bio: '', available: 1
})
const editRules = {
  level: [{ required: true, message: $t('engineers.choose_level'), trigger: 'change' }]
}

function openEdit(row) {
  if (!row.id) {
    ElMessage.warning($t('engineers.this_user_has_no_engineer_profile'))
    return
  }
  editing.value = true
  currentRow.value = row
  Object.assign(editForm, {
    level: row.level || '',
    city: row.city || '',
    dailyRate: row.dailyRate ? Number(row.dailyRate) : null,
    bio: row.bio || '',
    available: row.available ?? 1
  })
  skillsInput.value = (row.skills || []).join(',')
  editVisible.value = true
}

function parseSkills() {
  if (!skillsInput.value.trim()) {
    editForm.skills = []
    return
  }
  editForm.skills = skillsInput.value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
}

function resetEditForm() {
  editFormRef.value?.resetFields()
  currentRow.value = null
  skillsInput.value = ''
}

async function handleEditSubmit() {
  try { await editFormRef.value.validate() } catch { return }
  parseSkills()  // 确保 skills 已 parse
  editSubmitting.value = true
  try {
    await fde.engineers.update(currentRow.value.id, {
      level: editForm.level,
      city: editForm.city || null,
      dailyRate: editForm.dailyRate,
      bio: editForm.bio || null,
      skills: editForm.skills,
      available: editForm.available
    })
    ElMessage.success($t('common.saved'))
    editVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally {
    editSubmitting.value = false
  }
}

async function toggleStatus(row) {
  const newStatus = row.status === 1 ? 0 : 1
  const action = newStatus === 1 ? $t('common.enabled') : $t('common.disable')
  try {
    await ElMessageBox.confirm(
      $t('engineers.account', { p0: action, p1: row.name, p2: newStatus === 0 ? $t('engineers.user_cant_sign_in_once_disabled') : '' }),
      $t('engineers.account_2', { p0: action }),
      { type: 'warning' }
    )
  } catch { return }
  try {
    await fde.users.update(row.userId, { status: newStatus })
    ElMessage.success($t('engineers.p0_2', { p0: action }))
    loadList()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

onMounted(loadList)

// 绩效卡
const statsVisible = ref(false)
const statsLoading = ref(false)
const statsData = ref(null)
async function openStats(row) {
  statsVisible.value = true
  statsLoading.value = true
  statsData.value = null
  try {
    statsData.value = await fde.engineerStats(row.id, 6)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    statsLoading.value = false
  }
}
function utilColor(p) {
  if (p >= 80) return '#c2362b'
  if (p >= 50) return '#b3450f'
  return '#2e7d4f'
}
</script>

<style scoped>
.stat-card { padding: 12px; background: #fafafa; border-radius: 8px; }
.stat-label { font-size: 12px; color: #868580; margin-bottom: 4px; }
.stat-value { font-size: 26px; font-weight: 700; color: #1c1917; }
.stat-value span { font-size: 12px; color: #909399; margin-left: 4px; font-weight: 400; }
.stat-sub { font-size: 11px; color: #909399; margin-top: 6px; }
.stat-block { margin-top: 16px; padding-top: 16px; border-top: 1px solid #ebeef5; }
.stat-block h4 { margin: 0 0 12px 0; font-size: 14px; }
.monthly-bars { display: flex; gap: 8px; align-items: flex-end; height: 200px; }
.month-bar { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mb-label { font-size: 11px; color: #909399; }
.mb-track {
  width: 100%;
  height: 160px;
  background: #f0f0f0;
  border-radius: 4px;
  position: relative;
  display: flex;
  align-items: flex-end;
}
.mb-fill {
  width: 100%;
  background: #1c1917;
  border-radius: 4px;
  text-align: center;
  color: white;
  font-size: 10px;
  padding: 2px 0;
  transition: height 0.3s;
}
.mb-approved { font-size: 10px; color: #909399; }
</style>

<style scoped>
.engineers-page { display: flex; flex-direction: column; gap: 16px; }
.page-header {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
/* v1.2.9: 按钮统一靠最右 */
.page-header > :first-child { margin-right: auto; }
.page-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
  color: #1c1917;
}
.hint {
  font-size: 13px;
  color: #868580;
  margin: 4px 0 0 0;
}
.warn { color: #d2521e; font-weight: 600; }
.filter-card { border-radius: 8px; }
.table-card { border-radius: 8px; }
/* v1.2.8: 行 hover 色收编进全局主题(element-vi.css), 半透明覆盖会让 fixed 列透出下层内容 */
</style>
