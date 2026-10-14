<template>
  <div class="users-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.users') }}</h2>
        <p class="hint">{{ $t('users.internal_accounts_administrators_only', { p0: pagination.total }) }}</p>
      </div>
      <!-- 人以以虎 One 为准: 首次登录自动开通, 或在这里从平台通讯录选人提前开通并指定角色 -->
      <el-button v-if="can('user.create')" type="primary" @click="openAdd">
        <el-icon><Plus /></el-icon>{{ $t('users.add_from_platform') }}
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
            <div class="sub">{{ row.oidcSubject ? $t('users.linked_platform') : $t('users.not_linked_platform') }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="name" :label="$t('common.name_2')" min-width="120" />
        <el-table-column :label="$t('common.role')" width="120">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.role)" effect="dark" size="small">
              {{ roleLabel(row.role) }}
            </el-tag>
            <div class="sub">{{ roleSourceText(row.roleSource) }}</div>
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
        <el-table-column :label="$t('common.status')" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light" size="small">
              {{ $t('common.p0', { p0: row.status === 1 ? $t('common.enabled') : $t('common.disable') }) }}
            </el-tag>
            <div v-if="row.platformDisabled" class="sub">{{ $t('users.disabled_on_platform') }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" :label="$t('users.last_sign_in')" width="170">
          <template #default="{ row }">
            {{ row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString('zh-CN') : '-' }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="280" fixed="right">
          <template #default="{ row }">
            <el-button v-if="can('user.edit')" size="small" link type="primary" @click="openEdit(row)">{{ $t('users.change_role') }}</el-button>
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

    <!-- 改角色: 姓名 / 邮箱 / 手机 / 团队都来自以虎 One, 这里只读 -->
    <el-dialog v-model="dialogVisible" :title="$t('users.change_role')" width="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item :label="$t('common.name_2')">{{ form.name }} <span class="sub-inline">{{ form.username }}</span></el-form-item>
        <el-form-item :label="$t('common.role')">
          <el-select v-model="form.role" style="width: 100%;">
            <el-option v-for="r in activeRoles" :key="r.code" :label="`${r.name} (${r.code})`" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-alert v-if="form.roleSource === 'PLATFORM_ADMIN'" type="warning" :closable="false" show-icon :title="$t('users.platform_admin_note')" />
        <el-alert v-else type="info" :closable="false" show-icon :title="$t('users.role_manual_note')" />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.ok') }}</el-button>
      </template>
    </el-dialog>

    <!-- 从以虎 One 通讯录添加 -->
    <el-dialog v-model="addDlg.visible" :title="$t('users.add_from_platform')" width="560px">
      <el-input v-model="addDlg.keyword" :placeholder="$t('users.search_platform_directory')" clearable @keyup.enter="searchDirectory" @clear="searchDirectory">
        <template #append><el-button :loading="addDlg.loading" @click="searchDirectory">{{ $t('common.search_2') }}</el-button></template>
      </el-input>
      <div v-if="addDlg.error" class="dlg-error">{{ addDlg.error }}</div>
      <el-table :data="addDlg.list" v-loading="addDlg.loading" highlight-current-row max-height="300" style="margin-top: 12px;" @current-change="r => addDlg.picked = r">
        <el-table-column prop="name" :label="$t('common.name_2')" min-width="100" />
        <el-table-column prop="username" :label="$t('common.account')" min-width="100" />
        <el-table-column :label="$t('common.team')" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ (row.depts || []).join('、') || '—' }}</template>
        </el-table-column>
      </el-table>
      <el-form label-width="80px" style="margin-top: 14px;">
        <el-form-item :label="$t('common.role')">
          <el-select v-model="addDlg.role" style="width: 100%;">
            <el-option v-for="r in activeRoles" :key="r.code" :label="`${r.name} (${r.code})`" :value="r.code" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDlg.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!addDlg.picked" :loading="submitting" @click="addFromDirectory">{{ $t('common.ok') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
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

// 改角色
const dialogVisible = ref(false)
const submitting = ref(false)
const form = reactive({ id: null, username: '', name: '', role: '', roleSource: '' })

const ROLE_SOURCE = {
  PLATFORM_ADMIN: () => $t('users.source_platform_admin'),
  DEPT_LEADER: () => $t('users.source_dept_leader'),
  DEFAULT: () => $t('users.source_default'),
  MANUAL: () => $t('users.source_manual')
}
const roleSourceText = (s) => ROLE_SOURCE[s]?.() || ''

function openEdit(row) {
  Object.assign(form, { id: row.id, username: row.username, name: row.name, role: row.role, roleSource: row.roleSource })
  dialogVisible.value = true
}

async function handleSubmit() {
  submitting.value = true
  try {
    await fde.users.update(form.id, { role: form.role })
    ElMessage.success($t('common.updated'))
    dialogVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.message || $t('common.action_failed'))
  } finally {
    submitting.value = false
  }
}

// 从以虎 One 通讯录添加
const addDlg = reactive({ visible: false, keyword: '', list: [], loading: false, error: '', picked: null, role: 'FDE_ENGINEER' })
function openAdd() {
  Object.assign(addDlg, { visible: true, keyword: '', list: [], error: '', picked: null, role: 'FDE_ENGINEER' })
  searchDirectory()
}
async function searchDirectory() {
  addDlg.loading = true
  addDlg.error = ''
  try {
    addDlg.list = (await fde.users.platformDirectory(addDlg.keyword)).list
  } catch (e) {
    addDlg.error = e.message
    addDlg.list = []
  } finally {
    addDlg.loading = false
  }
}
async function addFromDirectory() {
  submitting.value = true
  try {
    await fde.users.create({ platformUserId: addDlg.picked.id, role: addDlg.role })
    ElMessage.success($t('users.added', { p0: addDlg.picked.name }))
    addDlg.visible = false
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
.sub { font-size: 12px; color: #a8a29e; line-height: 1.4; }
.sub-inline { font-size: 12px; color: #a8a29e; margin-left: 8px; }
.dlg-error { color: var(--el-color-danger); font-size: 13px; margin-top: 8px; }
.table-card { border-radius: 8px; }
/* v1.2.8: 行 hover 色收编进全局主题(element-vi.css), 半透明覆盖会让 fixed 列透出下层内容 */
</style>
