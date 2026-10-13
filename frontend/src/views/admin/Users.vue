<template>
  <div class="users-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.users') }}</h2>
        <p class="hint">{{ $t('users.internal_accounts_administrators_only', { p0: pagination.total }) }}</p>
      </div>
      <el-button v-if="can('user.create')" type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>{{ $t('users.new_user') }}
      </el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item :label="$t('common.search')">
          <el-input v-model="filters.keyword" :placeholder="$t('users.username_name_phone')" clearable @keyup.enter="loadList" />
        </el-form-item>
        <el-form-item :label="$t('common.role')">
          <!-- v1.3.2: 角色下拉动态取自 roles 表 -->
          <el-select v-model="filters.role" :placeholder="$t('common.all')" clearable style="width: 150px;">
            <el-option v-for="r in activeRoles" :key="r.code" :label="r.name" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="filters.status" :placeholder="$t('common.all')" clearable style="width: 100px;">
            <el-option :label="$t('common.enabled')" :value="1" />
            <el-option :label="$t('common.disable')" :value="0" />
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
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column :label="$t('common.account')" min-width="200">
          <template #default="{ row }">
            <strong>{{ row.username }}</strong>
            <el-tag v-if="row.username === currentUsername" type="success" size="small" effect="light" style="margin-left: 8px;">{{ $t('common.me') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" :label="$t('common.name_2')" min-width="120" />
        <el-table-column :label="$t('common.role')" width="120">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.role)" effect="dark" size="small">
              {{ roleLabel(row.role) }}
            </el-tag>
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
        <el-table-column prop="phone" :label="$t('common.phone_2')" width="130" />
        <el-table-column prop="email" :label="$t('common.email')" min-width="180" show-overflow-tooltip />
        <el-table-column :label="$t('common.status')" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light" size="small">
              {{ $t('common.p0', { p0: row.status === 1 ? $t('common.enabled') : $t('common.disable') }) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" :label="$t('users.last_sign_in')" width="170">
          <template #default="{ row }">
            {{ row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN') : '-' }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="280" fixed="right">
          <template #default="{ row }">
            <el-button v-if="can('user.edit')" size="small" link type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
            <el-button v-if="can('user.resetPassword')" size="small" link type="warning" @click="confirmReset(row)">{{ $t('common.reset_password') }}</el-button>
            <el-button v-if="can('user.edit') && row.status === 1 && row.username !== currentUsername" size="small" link type="info" @click="toggleStatus(row)">{{ $t('common.disable') }}</el-button>
            <el-button v-if="can('user.edit') && row.status === 0" size="small" link type="success" @click="toggleStatus(row)">{{ $t('common.enabled') }}</el-button>
            <el-popconfirm v-if="can('user.delete') && row.username !== currentUsername" :title="$t('users.delete_this_user')" @confirm="handleDelete(row)">
              <template #reference>
                <el-button size="small" link type="danger">{{ $t('common.delete_2') }}</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.page_size"
        :total="pagination.total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadList"
        @size-change="loadList"
        style="margin-top: 16px; justify-content: flex-end;"
      />
    </el-card>

    <!-- 创建/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="500px" @closed="resetForm">
      <el-form :model="form" :rules="formRules" ref="formRef" label-width="80px">
        <el-form-item :label="$t('common.username')" prop="username">
          <el-input v-model="form.username" :disabled="editing" :placeholder="$t('users.username_lowercase_letters_numbers')" />
        </el-form-item>
        <el-form-item :label="$t('common.name_2')" prop="name">
          <el-input v-model="form.name" :placeholder="$t('users.full_name')" />
        </el-form-item>
        <el-form-item :label="$t('common.role')" prop="role">
          <el-select v-model="form.role" :placeholder="$t('users.choose_role')" style="width: 100%;">
            <el-option v-for="r in activeRoles" :key="r.code" :label="`${r.name} (${r.code})`" :value="r.code" />
          </el-select>
        </el-form-item>
        <!-- v1.5.6 所属团队: 管理员在此设置(本人只读); 即时消息通知按团队定位, 未设置无法精准触达 -->
        <el-form-item :label="$t('common.team')">
          <el-select v-model="form.teamIds" multiple filterable :placeholder="$t('users.multiple_allowed_without_team_user_gets')" style="width: 100%;">
            <el-option v-for="t in teamOptions" :key="String(t.id)" :value="String(t.id)" :label="t.name" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.phone_2')" prop="phone">
          <el-input v-model="form.phone" :placeholder="$t('common.optional')" />
        </el-form-item>
        <el-form-item :label="$t('common.email')" prop="email">
          <el-input v-model="form.email" :placeholder="$t('common.optional')" />
        </el-form-item>
        <el-form-item v-if="!editing" label="">
          <el-alert type="info" :closable="false" show-icon>
            <template #title>{{ $t('users.default_password_123456_remind_user_change') }}</template>
          </el-alert>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.ok') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
// v1.3.2: 角色标签/下拉动态取自 roles 表
import { activeRoles, roleLabel, roleTagType, refreshRoles } from '@/api/roles.js'

const currentUser = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')
const currentUsername = currentUser?.username || ''

const list = ref([])
const loading = ref(false)
const pagination = reactive({ page: 1, page_size: 20, total: 0 })
const filters = reactive({ keyword: '', role: '', status: '' })

async function loadList() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      page_size: pagination.page_size
    }
    if (filters.keyword) params.keyword = filters.keyword
    if (filters.role) params.role = filters.role
    if (filters.status !== '') params.status = filters.status
    const data = await fde.users.list(params)
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
  filters.role = ''
  filters.status = ''
  pagination.page = 1
  loadList()
}

// 创建/编辑对话框
const dialogVisible = ref(false)
const editing = ref(false)
const formRef = ref(null)
const submitting = ref(false)
const form = reactive({
  id: null, username: '', name: '', role: '', phone: '', email: '', teamIds: []
})
// v1.5.6 团队下拉选项
const teamOptions = ref([])
async function loadTeams() {
  try {
    const d = await fde.teams.list()
    teamOptions.value = d.list
  } catch { /* 团队清单加载失败不影响用户管理 */ }
}
const dialogTitle = computed(() => editing.value ? $t('users.edit_user') : $t('users.new_user'))

const formRules = {
  username: [{ required: true, message: $t('common.enter_your_username'), trigger: 'blur' }],
  name: [{ required: true, message: $t('users.enter_name'), trigger: 'blur' }],
  role: [{ required: true, message: $t('users.choose_role'), trigger: 'change' }]
}

function openCreate() {
  editing.value = false
  Object.assign(form, { id: null, username: '', name: '', role: '', phone: '', email: '', teamIds: [] })
  dialogVisible.value = true
}

function openEdit(row) {
  editing.value = true
  Object.assign(form, {
    id: row.id, username: row.username, name: row.name, role: row.role,
    phone: row.phone || '', email: row.email || '',
    teamIds: (row.teams || []).map(t => String(t.id))
  })
  dialogVisible.value = true
}

function resetForm() {
  formRef.value?.resetFields()
}

async function handleSubmit() {
  try {
    await formRef.value.validate()
  } catch { return }
  submitting.value = true
  try {
    if (editing.value) {
      await fde.users.update(form.id, {
        name: form.name, role: form.role, phone: form.phone, email: form.email,
        teamIds: form.teamIds
      })
      ElMessage.success($t('common.updated'))
    } else {
      const r = await fde.users.create({
        username: form.username, name: form.name, role: form.role,
        phone: form.phone, email: form.email, teamIds: form.teamIds
      })
      ElMessage.success($t('users.created', { p0: r._hint || $t('users.default_password_123456') }))
    }
    dialogVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.message || $t('common.action_failed'))
  } finally {
    submitting.value = false
  }
}

async function toggleStatus(row) {
  const newStatus = row.status === 1 ? 0 : 1
  try {
    await fde.users.update(row.id, { status: newStatus })
    ElMessage.success(newStatus === 1 ? $t('common.enabled_2') : $t('common.disabled_2'))
    loadList()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function confirmReset(row) {
  try {
    await ElMessageBox.confirm(
      $t('users.reset_password_123456', { p0: row.name, p1: row.username }),
      $t('common.reset_password'),
      { type: 'warning' }
    )
  } catch { return }
  try {
    const r = await fde.users.resetPassword(row.id)
    ElMessage.success(r._hint || $t('users.reset'))
  } catch (e) {
    ElMessage.error(e.message)
  }
}

async function handleDelete(row) {
  try {
    await fde.users.remove(row.id)
    ElMessage.success($t('common.deleted'))
    loadList()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 2026-07-07 P2-5: 监听 ?edit=userId Query 参数
// 例: 从 Engineers.vue 点'账号信息' -> /admin/users?edit=15 -> 自动打开编辑 dialog
const route = useRoute()
const router = useRouter()
async function tryOpenEditFromQuery() {
  const editId = route.query.edit
  if (!editId) return
  try {
    // 确保列表已加载（可能 onMounted 已调用，但安全起见等下）
    if (!list.value.length) await loadList()
    const target = list.value.find(u => String(u.id) === String(editId))
    if (target) {
      openEdit(target)
    } else {
      ElMessage.warning($t('users.user_id_not_found_it_may', { p0: editId }))
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    // 打开后清掉 query，避免刷新再开
    router.replace({ path: route.path })
  }
}

onMounted(async () => {
  refreshRoles()
  loadTeams()
  await loadList()
  await tryOpenEditFromQuery()
})
</script>

<style scoped>
.users-page { display: flex; flex-direction: column; gap: 16px; }
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}
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
.filter-card { border-radius: 8px; }
.table-card { border-radius: 8px; }
/* v1.2.8: 行 hover 色收编进全局主题(element-vi.css), 半透明覆盖会让 fixed 列透出下层内容 */
</style>
