<template>
  <div class="roles-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.roles') }}</h2>
        <p class="hint">{{ $t('roles.roles_stored_in_database_new_roles') }}</p>
      </div>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>{{ $t('roles.new_role') }}</el-button>
    </div>

    <el-card shadow="never" class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="Code" width="160">
          <template #default="{ row }">
            <code style="font-size: 12px;">{{ row.code }}</code>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.name')" width="150">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.code)" effect="dark" size="small">{{ roleDisplayName(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('roles.data_scope')" width="200">
          <template #default="{ row }">
            <el-tooltip :content="SCOPE_HINTS[row.dataScope]" placement="top">
              <el-tag size="small" effect="plain" :type="row.dataScope === 'ALL' ? 'danger' : row.dataScope === 'OWN_PROJECTS' ? 'warning' : 'info'">
                {{ scopeLabels[row.dataScope] || row.dataScope }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="description" :label="$t('common.notes_2')" min-width="220" show-overflow-tooltip />
        <el-table-column :label="$t('roles.users')" width="80" align="center">
          <template #default="{ row }">{{ row.userCount }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.type')" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.builtin" size="small" type="info" effect="plain">{{ $t('roles.built_in') }}</el-tag>
            <el-tag v-else size="small" type="primary" effect="plain">{{ $t('common.custom') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="light">{{ $t('common.p0', { p0: row.status === 1 ? $t('common.enabled') : $t('common.disable') }) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
            <template v-if="!row.builtin">
              <el-button v-if="row.status === 1" size="small" link type="info" @click="toggleStatus(row)">{{ $t('common.disable') }}</el-button>
              <el-button v-else size="small" link type="success" @click="toggleStatus(row)">{{ $t('common.enabled') }}</el-button>
              <el-popconfirm :title="$t('roles.delete_this_role_not_allowed_while')" @confirm="handleDelete(row)">
                <template #reference>
                  <el-button size="small" link type="danger">{{ $t('common.delete_2') }}</el-button>
                </template>
              </el-popconfirm>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-alert type="info" :closable="false" style="margin-top: 4px;">
      <template #title>
        {{ $t('roles.new_roles_start_with_no_permissions') }}
      </template>
    </el-alert>

    <!-- 新建/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editing ? $t('roles.edit_role', { p0: form.code }) : $t('roles.new_role')" width="520px">
      <el-form :model="form" :rules="rules" ref="formRef" label-width="90px">
        <el-form-item label="Code" prop="code">
          <el-input v-model="form.code" :disabled="editing" :placeholder="$t('roles.uppercase_letters_numbers_underscores_e_g')" @input="form.code = form.code.toUpperCase()" />
        </el-form-item>
        <el-form-item :label="$t('common.name')" prop="name">
          <el-input v-model="form.name" :placeholder="$t('roles.display_name_e_g_hr_specialist')" />
        </el-form-item>
        <el-form-item :label="$t('roles.data_scope')" prop="dataScope">
          <el-select v-model="form.dataScope" :disabled="editing && form.builtin" style="width: 100%;">
            <el-option v-for="s in scopes" :key="s" :value="s" :label="`${scopeLabels[s] || s} — ${SCOPE_HINTS[s]}`" />
          </el-select>
          <div v-if="editing && form.builtin" class="muted-hint">{{ $t('roles.built_in_roles_have_code_bound') }}</div>
        </el-form-item>
        <el-form-item :label="$t('common.notes_2')">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { roleTagType, refreshRoles, roleDisplayName } from '@/api/roles.js'

const SCOPE_HINTS = {
  ALL: $t('roles.no_data_filtering_sees_all_business'),
  OWN_PROJECTS: $t('roles.manager_projects_they_lead_or_join'),
  OWN_RECORDS: $t('roles.individual_projects_theyre_in_records_they')
}

const list = ref([])
const scopes = ref(['ALL', 'OWN_PROJECTS', 'OWN_RECORDS'])
const scopeLabels = ref({ ALL: $t('roles.all_data'), OWN_PROJECTS: $t('roles.projects_they_lead_or_join'), OWN_RECORDS: $t('roles.own_records_only') })
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const d = await fde.roles.list({ all: '1' })
    list.value = d.list
    if (d.scopes) scopes.value = d.scopes
    if (d.scopeLabels) scopeLabels.value = d.scopeLabels
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

const dialogVisible = ref(false)
const editing = ref(false)
const submitting = ref(false)
const formRef = ref(null)
const form = reactive({ code: '', name: '', dataScope: 'OWN_RECORDS', description: '', builtin: false })
const rules = {
  code: [
    { required: true, message: $t('roles.enter_role_code'), trigger: 'blur' },
    { pattern: /^[A-Z][A-Z0-9_]{1,31}$/, message: $t('roles.starts_with_uppercase_letter_uppercase_letters'), trigger: 'blur' }
  ],
  name: [{ required: true, message: $t('roles.enter_name'), trigger: 'blur' }],
  dataScope: [{ required: true, message: $t('roles.choose_data_scope'), trigger: 'change' }]
}

function openCreate() {
  editing.value = false
  Object.assign(form, { code: '', name: '', dataScope: 'OWN_RECORDS', description: '', builtin: false })
  dialogVisible.value = true
}
function openEdit(row) {
  editing.value = true
  Object.assign(form, { code: row.code, name: row.name, dataScope: row.dataScope, description: row.description || '', builtin: row.builtin })
  dialogVisible.value = true
}

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    if (editing.value) {
      const payload = { name: form.name, description: form.description }
      if (!form.builtin) payload.dataScope = form.dataScope
      await fde.roles.update(form.code, payload)
      ElMessage.success($t('common.updated'))
    } else {
      await fde.roles.create({ code: form.code, name: form.name, dataScope: form.dataScope, description: form.description })
      ElMessage.success($t('roles.role_created_assign_its_permissions_in'))
    }
    dialogVisible.value = false
    await load()
    refreshRoles() // 全站角色缓存同步
  } catch (e) { ElMessage.error(e.message) }
  finally { submitting.value = false }
}

async function toggleStatus(row) {
  try {
    await fde.roles.update(row.code, { status: row.status === 1 ? 0 : 1 })
    ElMessage.success(row.status === 1 ? $t('common.disabled_2') : $t('common.enabled_2'))
    await load()
    refreshRoles()
  } catch (e) { ElMessage.error(e.message) }
}

async function handleDelete(row) {
  try {
    await fde.roles.remove(row.code)
    ElMessage.success($t('common.deleted'))
    await load()
    refreshRoles()
  } catch (e) { ElMessage.error(e.message) }
}

onMounted(load)
</script>

<style scoped>
.roles-page { display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.table-card { border-radius: 8px; }
.muted-hint { font-size: 12px; color: #909399; line-height: 1.5; margin-top: 4px; }
</style>
