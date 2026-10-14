<template>
  <div class="role-permissions">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <div>
            <span class="title">{{ $t('common.role_permissions') }}</span>
            <span class="subtitle">{{ $t('rolePermissions.checked_role_has_this_permission_click') }}</span>
          </div>
          <div class="head-actions">
            <el-badge :value="changes.length" :hidden="!changes.length" type="warning">
              <el-button type="primary" :loading="saving" :disabled="!changes.length" @click="handleSave">{{ $t('common.save_changes') }}</el-button>
            </el-badge>
            <el-button :disabled="saving" @click="load">{{ $t('rolePermissions.discard_changes') }}</el-button>
            <el-popconfirm :title="$t('rolePermissions.restore_every_permission_its_factory_default')" width="260" @confirm="handleResetAll">
              <template #reference>
                <el-button type="danger" plain>{{ $t('rolePermissions.restore_all_defaults') }}</el-button>
              </template>
            </el-popconfirm>
          </div>
        </div>
      </template>

      <el-alert v-if="!loading" type="info" :closable="false" class="tip">
        {{ $t('rolePermissions.default_factory_setting_customized_changed_here') }}
      </el-alert>

      <el-skeleton v-if="loading" :rows="8" animated />

      <template v-else>
        <div v-for="mod in grouped" :key="mod.module" class="module-block">
          <div class="module-title">{{ mod.label }}</div>
          <el-table :data="mod.rows" size="small" border>
            <el-table-column :label="$t('rolePermissions.permission')" min-width="220">
              <template #default="{ row }">
                <div class="perm-cell">
                  <span class="perm-label">{{ row.label }}</span>
                  <span class="perm-key">{{ row.key }}</span>
                  <el-tag v-if="row.locked" size="small" type="info" effect="plain">{{ $t('rolePermissions.locked') }}</el-tag>
                  <el-tag v-else-if="isDirty(row)" size="small" type="warning" effect="plain">{{ $t('rolePermissions.unsaved') }}</el-tag>
                  <el-tag v-else-if="row.overridden" size="small" type="success" effect="plain">{{ $t('rolePermissions.customized') }}</el-tag>
                </div>
              </template>
            </el-table-column>
            <!-- v1.3.2: 矩阵列动态渲染 roles 表启用角色 -->
            <el-table-column v-for="role in roles" :key="role.code" :label="roleDisplayName(role)" align="center" width="96">
              <template #default="{ row }">
                <el-checkbox
                  :model-value="row.current.includes(role.code)"
                  :disabled="row.locked"
                  @update:model-value="v => toggle(row, role.code, v)"
                />
              </template>
            </el-table-column>
            <el-table-column :label="$t('common.actions')" width="110" align="center">
              <template #default="{ row }">
                <el-button
                  v-if="!row.locked && (row.overridden || isDirty(row))"
                  link type="primary" size="small"
                  @click="resetRow(row)"
                >{{ $t('common.restore_default') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { roleDisplayName } from '@/api/roles.js'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { refreshMyPermissions } from '@/api/permissions.js'

const loading = ref(true)
const saving = ref(false)
const roles = ref([])
const rows = ref([])   // { key, label, module, defaultRoles, serverRoles, current, overridden, locked }

const MODULE_LABELS = {
  customer: $t('common.customer'), project: $t('common.project'), task: $t('common.task'),
  subtask: $t('common.subtasks'), milestone: $t('common.milestone_2'), issue: $t('common.issues'), risk: $t('common.risks'), engineer: $t('common.engineers'),
  engineer_stats: $t('rolePermissions.engineer_stats'), timesheet: $t('common.hours'),
  report: $t('rolePermissions.reports'), knowledge: $t('common.knowledge_base'), skill: $t('common.skills_3'),
  user: $t('common.users'),
  apiKey: 'API Key',
  audit: $t('rolePermissions.audit_log'), idea: $t('common.ideas'), me: $t('common.my_workbench'), rolePermission: $t('common.role_permissions'),
  team: $t('common.teams'),
  notification: $t('rolePermissions.notifications'), asset: $t('common.asset_library')
}

const ACTION_LABELS = {
  access: $t('rolePermissions.module_access'), view: $t('common.view'), create: $t('common.new'), edit: $t('common.edit'), delete: $t('common.delete_2'),
  approve: $t('common.approvals'),
  submit: $t('common.submit'), issue: $t('rolePermissions.issue_publish'), export: $t('rolePermissions.export'),
  manage: $t('rolePermissions.manage'), manageAll: $t('rolePermissions.manage_all'),
  changeStatus: $t('rolePermissions.change_status'), manageMembers: $t('rolePermissions.member_management'),
  grant: $t('rolePermissions.grant'), batch: $t('rolePermissions.bulk_actions'), import: $t('rolePermissions.import'), convert: $t('rolePermissions.convert'), assign: $t('rolePermissions.assign'),
  list: $t('common.list'), generate: $t('common.generate'), withdraw: $t('rolePermissions.withdraw'), reject: $t('common.reject'),
  disable: $t('common.disable'), pay: $t('rolePermissions.pay')
}

function labelOf(key) {
  const dot = key.indexOf('.')
  const action = key.slice(dot + 1)
  return ACTION_LABELS[action] || action
}

const grouped = computed(() => {
  const map = new Map()
  for (const row of rows.value) {
    if (!map.has(row.module)) map.set(row.module, [])
    map.get(row.module).push(row)
  }
  return [...map.entries()].map(([module, list]) => ({
    module,
    label: MODULE_LABELS[module] || module,
    rows: list
  }))
})

const sameRoles = (a, b) => [...a].sort().join(',') === [...b].sort().join(',')
const isDirty = (row) => !sameRoles(row.current, row.serverRoles)
const changes = computed(() => rows.value.filter(isDirty).map(r => ({ permission: r.key, roles: r.current })))

function toggle(row, role, checked) {
  if (checked) {
    if (!row.current.includes(role)) row.current = [...row.current, role]
  } else {
    row.current = row.current.filter(r => r !== role)
  }
}

function resetRow(row) {
  row.current = [...row.defaultRoles]
}

async function load() {
  loading.value = true
  try {
    const data = await fde.rolePermissions.get()
    roles.value = data.roles
    rows.value = data.permissions.map(p => ({
      key: p.key,
      label: labelOf(p.key),
      module: p.key.slice(0, p.key.indexOf('.')),
      defaultRoles: p.defaultRoles,
      serverRoles: p.roles,
      current: [...p.roles],
      overridden: p.overridden,
      locked: p.locked
    }))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!changes.value.length) return
  saving.value = true
  try {
    await fde.rolePermissions.update(changes.value)
    ElMessage.success($t('rolePermissions.saved_permission_changes_effective_immediately', { p0: changes.value.length }))
    await load()
    await refreshMyPermissions()  // 自己的菜单也可能受影响
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function handleResetAll() {
  saving.value = true
  try {
    await fde.rolePermissions.reset()
    ElMessage.success($t('rolePermissions.all_restored_factory_defaults'))
    await load()
    await refreshMyPermissions()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.role-permissions { max-width: 1100px; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.title { font-size: 16px; font-weight: 600; margin-right: 12px; }
.subtitle { font-size: 12px; color: var(--el-text-color-secondary); }
.head-actions { display: flex; gap: 10px; align-items: center; }
.tip { margin-bottom: 16px; }
.module-block { margin-bottom: 22px; }
.module-title { font-weight: 600; margin: 0 0 8px 2px; font-size: 14px; }
.perm-cell { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.perm-label { font-weight: 500; }
.perm-key { font-family: monospace; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
