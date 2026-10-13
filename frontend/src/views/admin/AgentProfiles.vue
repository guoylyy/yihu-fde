<template>
  <div class="agents-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.agents') }}</h2>
        <p class="hint">
          {{ $t('agentProfiles.register_your_agents_openhex_claude_code') }}
        </p>
      </div>
      <div style="display: flex; gap: 10px; align-items: center;">
        <el-radio-group v-if="isAdmin" v-model="viewAll" size="small" @change="load">
          <el-radio-button :value="false">{{ $t('agentProfiles.my_agents') }}</el-radio-button>
          <el-radio-button :value="true">{{ $t('agentProfiles.everyone') }}</el-radio-button>
        </el-radio-group>
        <el-button type="primary" :icon="Plus" @click="createVisible = true">{{ $t('agentProfiles.register_agent') }}</el-button>
      </div>
    </div>

    <el-card shadow="never" class="list-card" v-loading="loading">
      <el-table :data="list" stripe>
        <el-table-column label="Agent" min-width="180">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 18px;">🤖</span>
              <div>
                <div><strong>{{ row.name }}</strong></div>
                <div class="dim">{{ PLATFORMS[row.platform] || row.platform }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="viewAll" :label="$t('agentProfiles.owner')" width="130">
          <template #default="{ row }">
            <span v-if="row.owner">{{ row.owner.name }} <span class="dim">({{ row.owner.username }})</span></span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('agentProfiles.capability_tags')" min-width="150">
          <template #default="{ row }">
            <template v-if="row.capabilities">
              <el-tag v-for="c in row.capabilities.split(/[,，]/).filter(Boolean).slice(0, 4)" :key="c"
                size="small" effect="plain" style="margin-right: 4px;">{{ c.trim() }}</el-tag>
            </template>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.key_prefix')" width="130">
          <template #default="{ row }"><code v-if="row.keyPrefix">{{ row.keyPrefix }}...</code><span v-else class="dim">{{ $t('common.revoked') }}</span></template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ $t('common.p0', { p0: row.status === 1 ? $t('common.enabled') : $t('common.disable') }) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.last_active')" width="150">
          <template #default="{ row }">{{ $t('common.p0', { p0: row.lastActiveAt ? formatDateTime(row.lastActiveAt) : $t('agentProfiles.never_connected') }) }}</template>
        </el-table-column>
        <el-table-column :label="$t('agentProfiles.contributions')" width="150">
          <template #default="{ row }">
            <span class="dim">{{ $t('agentProfiles.records_conversations', { p0: row.recordCount ?? 0, p1: row.conversationCount ?? 0 }) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openActivities(row)">{{ $t('agentProfiles.activity') }}</el-button>
            <template v-if="canManage(row)">
              <el-button link type="primary" size="small" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
              <el-popconfirm :title="$t('agentProfiles.old_key_stops_working_immediately_agent')" @confirm="rotateKey(row)">
                <template #reference><el-button link type="warning" size="small">{{ $t('agentProfiles.new_key') }}</el-button></template>
              </el-popconfirm>
              <el-button v-if="row.status === 1" link type="danger" size="small" @click="toggleStatus(row, 0)">{{ $t('common.disable') }}</el-button>
              <el-button v-else link type="success" size="small" @click="toggleStatus(row, 1)">{{ $t('common.enabled') }}</el-button>
              <el-popconfirm :title="$t('agentProfiles.deleting_also_revokes_its_dedicated_key')" @confirm="remove(row)">
                <template #reference><el-button link type="danger" size="small">{{ $t('common.delete_2') }}</el-button></template>
              </el-popconfirm>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="$t('agentProfiles.no_agents_yet_once_registered_your')" :image-size="90" />
        </template>
      </el-table>
    </el-card>

    <!-- 注册 -->
    <el-dialog v-model="createVisible" :title="$t('agentProfiles.register_agent')" width="500px" @closed="resetForm">
      <el-form :model="form" label-width="90px">
        <el-form-item :label="$t('common.name')" required>
          <el-input v-model="form.name" :placeholder="$t('agentProfiles.e_g_research_assistant_on_call')" maxlength="100" />
        </el-form-item>
        <el-form-item :label="$t('common.platform')">
          <el-select v-model="form.platform" style="width: 100%;">
            <el-option v-for="(label, val) in PLATFORMS" :key="val" :value="val" :label="label" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('agentProfiles.capability_tags')">
          <el-input v-model="form.capabilities" :placeholder="$t('agentProfiles.comma_separated_e_g_research_write')" maxlength="500" />
        </el-form-item>
        <el-form-item :label="$t('common.notes_2')">
          <el-input v-model="form.description" type="textarea" :rows="2" :placeholder="$t('agentProfiles.what_does_this_agent_do_optional')" maxlength="500" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon>
          {{ $t('agentProfiles.registering_issues_dedicated_api_key_shown') }}
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleCreate">{{ $t('agentProfiles.register_issue_key') }}</el-button>
      </template>
    </el-dialog>

    <!-- Key 明文只显示一次（注册 / 换 Key 共用） -->
    <el-dialog v-model="keyVisible" :title="$t('agentProfiles.agent_api_key')" width="580px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon class="once-alert">
        {{ $t('agentProfiles.plaintext_key_shown_only_once_cant') }}
      </el-alert>
      <div class="key-box">
        <code class="key-text">{{ issuedKey }}</code>
        <el-button type="primary" :icon="CopyDocument" @click="copyKey">{{ $t('common.copy') }}</el-button>
      </div>
      <div class="key-usage">
        <p>{{ $t('agentProfiles.agent_configuration_mcp_endpoint') }}</p>
        <pre>POST /api/mcp
Authorization: Bearer {{ issuedKey }}</pre>
        <p style="margin-top: 6px;">{{ $t('agentProfiles.see_user_guide_agent_collaboration_for') }}</p>
      </div>
      <template #footer>
        <el-button type="primary" @click="keyVisible = false">{{ $t('common.ive_saved_it_close') }}</el-button>
      </template>
    </el-dialog>

    <!-- 编辑 -->
    <el-dialog v-model="editVisible" :title="$t('agentProfiles.edit_agent')" width="500px">
      <el-form :model="editForm" label-width="90px">
        <el-form-item :label="$t('common.name')" required>
          <el-input v-model="editForm.name" maxlength="100" />
        </el-form-item>
        <el-form-item :label="$t('common.platform')">
          <el-select v-model="editForm.platform" style="width: 100%;">
            <el-option v-for="(label, val) in PLATFORMS" :key="val" :value="val" :label="label" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('agentProfiles.capability_tags')">
          <el-input v-model="editForm.capabilities" maxlength="500" />
        </el-form-item>
        <el-form-item :label="$t('common.notes_2')">
          <el-input v-model="editForm.description" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleEdit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 活动流水 -->
    <el-drawer v-model="actVisible" :title="$t('agentProfiles.activity_log', { p0: actAgent?.name || '' })" size="440px">
      <div v-loading="actLoading">
        <el-timeline v-if="actList.length">
          <el-timeline-item v-for="a in actList" :key="a.id" :timestamp="formatDateTime(a.ts)" placement="top">
            <code>{{ a.action }}</code>
            <span v-if="a.entityType" class="dim" style="margin-left: 6px;">{{ a.entityType }}<template v-if="a.entityId"> #{{ a.entityId }}</template></span>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else :description="$t('agentProfiles.no_activity_yet_successful_mcp_calls')" :image-size="80" />
        <div v-if="actList.length < actTotal" style="text-align: center;">
          <el-button size="small" text @click="loadActivities(true)">{{ $t('common.load_more', { p0: actList.length, p1: actTotal }) }}</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { Plus, CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'

const PLATFORMS = { OPENHEX: 'OpenHex', CLAUDE_CODE: 'Claude Code', COZE: $t('agentProfiles.coze'), CUSTOM: $t('common.in_house'), OTHER: $t('common.other') }

const me = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')
const isAdmin = me?.role === 'ADMIN'
const viewAll = ref(false)

const list = ref([])
const loading = ref(false)

function formatDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function canManage(row) {
  return isAdmin || String(row.userId) === String(me?.id)
}

async function load() {
  loading.value = true
  try {
    const d = await fde.agentProfiles.list(viewAll.value ? { all: 'true' } : {})
    list.value = d.list || []
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

// ---- 注册 ----
const createVisible = ref(false)
const saving = ref(false)
const form = reactive({ name: '', platform: 'OTHER', capabilities: '', description: '' })
const keyVisible = ref(false)
const issuedKey = ref('')

function resetForm() {
  Object.assign(form, { name: '', platform: 'OTHER', capabilities: '', description: '' })
}

async function handleCreate() {
  if (!form.name.trim()) return ElMessage.warning($t('agentProfiles.give_agent_name'))
  saving.value = true
  try {
    const d = await fde.agentProfiles.create({ ...form, name: form.name.trim() })
    issuedKey.value = d.apiKey
    createVisible.value = false
    keyVisible.value = true
    load()
  } catch (e) { ElMessage.error(e.message || $t('agentProfiles.registration_failed')) }
  finally { saving.value = false }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(issuedKey.value)
    ElMessage.success($t('common.copied_clipboard'))
  } catch {
    ElMessage.warning($t('common.copy_failed_please_select_copy_manually'))
  }
}

// ---- 编辑 / 启停 / 换 Key / 删除 ----
const editVisible = ref(false)
const editForm = reactive({ id: null, name: '', platform: 'OTHER', capabilities: '', description: '' })

function openEdit(row) {
  Object.assign(editForm, {
    id: row.id, name: row.name, platform: row.platform,
    capabilities: row.capabilities || '', description: row.description || ''
  })
  editVisible.value = true
}

async function handleEdit() {
  if (!editForm.name.trim()) return ElMessage.warning($t('agentProfiles.name_required'))
  saving.value = true
  try {
    const { id, ...data } = editForm
    await fde.agentProfiles.update(id, { ...data, name: data.name.trim() })
    ElMessage.success($t('common.updated'))
    editVisible.value = false
    load()
  } catch (e) { ElMessage.error(e.message || $t('common.update_failed')) }
  finally { saving.value = false }
}

async function toggleStatus(row, status) {
  try {
    await fde.agentProfiles.update(row.id, { status })
    ElMessage.success(status === 1 ? $t('common.enabled_2') : $t('agentProfiles.disabled_its_dedicated_key_rejected_immediately'))
    load()
  } catch (e) { ElMessage.error(e.message) }
}

async function rotateKey(row) {
  try {
    const d = await fde.agentProfiles.rotateKey(row.id)
    issuedKey.value = d.apiKey
    keyVisible.value = true
    load()
  } catch (e) { ElMessage.error(e.message) }
}

async function remove(row) {
  try {
    await fde.agentProfiles.remove(row.id)
    ElMessage.success($t('common.deleted'))
    load()
  } catch (e) { ElMessage.error(e.message) }
}

// ---- 活动流水 ----
const actVisible = ref(false)
const actLoading = ref(false)
const actAgent = ref(null)
const actList = ref([])
const actTotal = ref(0)
const actPage = ref(1)

function openActivities(row) {
  actAgent.value = row
  actList.value = []
  actTotal.value = 0
  actPage.value = 1
  actVisible.value = true
  loadActivities()
}

async function loadActivities(more = false) {
  if (more) actPage.value += 1
  actLoading.value = true
  try {
    const d = await fde.agentProfiles.activities(actAgent.value.id, { page: actPage.value, page_size: 30 })
    actList.value = more ? [...actList.value, ...(d.list || [])] : (d.list || [])
    actTotal.value = d.total || 0
  } catch (e) { ElMessage.error(e.message) }
  finally { actLoading.value = false }
}

onMounted(load)
</script>

<style scoped>
.agents-page { max-width: 1100px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; gap: 16px; }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.hint { font-size: 13px; color: rgba(28, 25, 23, 0.6); max-width: 640px; }
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
