<template>
  <div class="api-keys-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.api_keys') }}</h2>
        <p class="hint" v-if="isAdmin">{{ $t('apiKeys.credentials_for_mcp_agent_integrations_key') }}</p>
        <p class="hint" v-else>{{ $t('apiKeys.credentials_for_mcp_agent_integrations_key_2') }}</p>
      </div>
      <el-button @click="$router.push('/admin/agents')">{{ $t('apiKeys.go_agents') }}</el-button>
    </div>

    <!-- 个人 Key 由以虎 One 签发; 这里只保留老的个人 Key 和 Agent 专属 Key 的查看 / 改名 / 吊销 -->
    <el-alert type="info" :closable="false" show-icon :title="$t('apiKeys.personal_keys_from_platform')" />

    <el-card shadow="never" class="list-card" v-loading="loading">
      <el-table :data="list" stripe>
        <el-table-column :label="$t('apiKeys.name_purpose')" prop="name" min-width="160" />
        <el-table-column v-if="isAdmin" :label="$t('common.type')" width="110">
          <template #default="{ row }">
            <el-tag :type="row.scope === 'AGENT' ? 'danger' : ''" size="small" effect="plain">
              {{ $t('common.p0', { p0: row.scope === 'AGENT' ? $t('apiKeys.agent_platform_disabled') : $t('apiKeys.personal') }) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="isAdmin" :label="$t('apiKeys.bound_user')" min-width="140">
          <template #default="{ row }">
            <span v-if="row.scope === 'AGENT'" class="dim">{{ $t('apiKeys.disabled_agent_platforms_now_pass_tokens') }}</span>
            <span v-else-if="row.user">{{ row.user.name }} <span class="dim">({{ row.user.username }})</span></span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.key_prefix')" min-width="130">
          <template #default="{ row }"><code>{{ row.prefix }}</code></template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ $t('common.p0', { p0: row.status === 1 ? $t('common.active_2') : $t('common.revoked') }) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('apiKeys.last_used')" width="160">
          <template #default="{ row }">{{ $t('common.p0', { p0: row.lastUsedAt ? formatDateTime(row.lastUsedAt) : $t('apiKeys.never_used') }) }}</template>
        </el-table-column>
        <el-table-column :label="$t('apiKeys.created_at')" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openRename(row)">{{ $t('apiKeys.rename') }}</el-button>
            <el-popconfirm v-if="row.status === 1" :title="$t('apiKeys.revoked_keys_stop_working_immediately_cant')" @confirm="handleRevoke(row)">
              <template #reference><el-button link type="danger" size="small">{{ $t('apiKeys.revoke') }}</el-button></template>
            </el-popconfirm>
            <el-popconfirm v-else :title="$t('apiKeys.records_cant_be_recovered_after_deletion')" @confirm="handleDelete(row)">
              <template #reference><el-button link type="danger" size="small">{{ $t('common.delete_2') }}</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
        <template #empty><el-empty :description="$t('apiKeys.no_api_keys_yet')" :image-size="90" /></template>
      </el-table>
    </el-card>

    <!-- 改名（仅修改用途备注, Key 本体不可改） -->
    <el-dialog v-model="renameVisible" :title="$t('apiKeys.rename_2')" width="420px">
      <el-form label-width="60px" @submit.prevent>
        <el-form-item :label="$t('common.name')" required>
          <el-input v-model="renameForm.name" :placeholder="$t('apiKeys.purpose')" maxlength="100" @keyup.enter="handleRename" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="renaming" @click="handleRename">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'


// 非管理员（FDE 工程师）只能管理自己的 Key: 列表只查自己, 创建默认绑定本人, 无选人入口
// 2026-07-29: AGENT 级 Key 下线, Agent 平台改为透传用户登录 Token; 存量 AGENT Key 仅展示(标已停用)
const isAdmin = can('apiKey.manageAll')

const list = ref([])
const loading = ref(false)

function formatDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    const d = await fde.apiKeys.list(isAdmin ? { all: 'true' } : {})
    list.value = d.list || []
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}


async function handleRevoke(row) {
  try {
    await fde.apiKeys.revoke(row.id)
    ElMessage.success($t('common.revoked'))
    load()
  } catch (e) { ElMessage.error(e.message) }
}

const renameVisible = ref(false)
const renaming = ref(false)
const renameForm = reactive({ id: null, name: '' })

function openRename(row) {
  Object.assign(renameForm, { id: row.id, name: row.name })
  renameVisible.value = true
}

async function handleRename() {
  if (!renameForm.name.trim()) return ElMessage.warning($t('apiKeys.enter_name_purpose'))
  renaming.value = true
  try {
    await fde.apiKeys.update(renameForm.id, { name: renameForm.name.trim() })
    ElMessage.success($t('common.updated'))
    renameVisible.value = false
    load()
  } catch (e) { ElMessage.error(e.message || $t('common.update_failed')) }
  finally { renaming.value = false }
}

async function handleDelete(row) {
  try {
    await fde.apiKeys.remove(row.id)
    ElMessage.success($t('common.deleted'))
    load()
  } catch (e) { ElMessage.error(e.message) }
}

onMounted(load)
</script>

<style scoped>
.api-keys-page { max-width: 1000px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.hint { font-size: 13px; color: rgba(28, 25, 23, 0.6); }
.list-card { background: white; border: 1px solid rgba(28, 25, 23, 0.1); }
.dim { color: #909399; font-size: 12px; }
.once-alert { margin-bottom: 14px; }
.key-box {
  display: flex; align-items: center; gap: 10px;
  background: #f5f5f2; border: 1px dashed rgba(28, 25, 23, 0.25);
  border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;
}
.key-text { flex: 1; font-size: 14px; font-weight: 600; word-break: break-all; }
.key-usage { font-size: 12px; color: #909399; }
.key-usage pre {
  background: #1c1917; color: #e6e5e0; border-radius: 6px;
  padding: 10px 12px; margin-top: 6px; font-size: 12px; overflow-x: auto;
}
</style>
