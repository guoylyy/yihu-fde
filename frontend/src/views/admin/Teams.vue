<template>
  <div class="teams-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.team_management') }}</h2>
        <p class="hint">{{ $t('teams.team_company_or_business_unit_sub') }}</p>
      </div>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>{{ $t('teams.new_team') }}</el-button>
    </div>

    <el-card shadow="never" class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" :label="$t('teams.team_name')" width="180" show-overflow-tooltip />
        <el-table-column :label="$t('common.owner')" width="120">
          <template #default="{ row }">
            <span v-if="row.leader">{{ row.leader.name }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.members_2')" width="80" align="center">
          <template #default="{ row }">{{ row.memberCount }}</template>
        </el-table-column>
        <el-table-column :label="$t('teams.notification_group')" width="90" align="center">
          <template #default="{ row }">
            <el-tooltip v-if="row.chatWebhookUrl" :content="$t('teams.team_group_webhook_configured')" placement="top">
              <el-tag size="small" type="success" effect="plain">{{ $t('teams.configured') }}</el-tag>
            </el-tooltip>
            <el-tag v-else size="small" type="info" effect="plain">{{ $t('common.not_configured') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" :label="$t('common.notes_2')" min-width="200" show-overflow-tooltip />
        <el-table-column :label="$t('common.status')" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="light">{{ $t('common.p0', { p0: row.status === 1 ? $t('common.enabled') : $t('common.disable') }) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="230" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
            <el-button size="small" link type="primary" @click="openMembers(row)">{{ $t('common.members') }}</el-button>
            <el-button v-if="row.status === 1" size="small" link type="info" @click="toggleStatus(row)">{{ $t('common.disable') }}</el-button>
            <el-button v-else size="small" link type="success" @click="toggleStatus(row)">{{ $t('common.enabled') }}</el-button>
            <el-popconfirm :title="$t('teams.delete_this_team_member_assignments_cleared')" @confirm="handleDelete(row)">
              <template #reference>
                <el-button size="small" link type="danger">{{ $t('common.delete_2') }}</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-alert type="info" :closable="false" style="margin-top: 4px;">
      <template #title>
        {{ $t('teams.administrators_set_team_membership_adjust_whole') }}
      </template>
    </el-alert>

    <!-- 新建/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editing ? $t('teams.edit_team', { p0: form.name }) : $t('teams.new_team')" width="560px">
      <el-form :model="form" :rules="rules" ref="formRef" label-width="110px">
        <el-form-item :label="$t('teams.team_name')" prop="name">
          <el-input v-model="form.name" maxlength="50" show-word-limit :placeholder="$t('teams.e_g_delivery_team_1_east')" />
        </el-form-item>
        <el-form-item :label="$t('common.owner')">
          <el-select v-model="form.leaderId" filterable clearable :placeholder="$t('common.optional')" style="width: 100%;">
            <el-option v-for="u in userOptions" :key="String(u.id)" :value="String(u.id)" :label="`${u.name} (${u.username})`" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('teams.group_webhook')">
          <el-input v-model="form.chatWebhookUrl" :placeholder="$t('teams.optional_teams_group_bot_url_feishu')" />
          <div class="muted-hint">{{ $t('teams.used_when_instant_messages_routed_by') }}</div>
        </el-form-item>
        <el-form-item :label="$t('common.order')">
          <el-input-number v-model="form.sortOrder" :min="0" :max="999" />
        </el-form-item>
        <el-form-item :label="$t('common.notes_2')">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 成员管理 -->
    <el-dialog v-model="membersVisible" :title="$t('common.members_3', { p0: currentTeam?.name || '' })" width="640px">
      <el-transfer
        v-model="memberIds"
        v-loading="membersLoading"
        :data="transferData"
        filterable
        :filter-placeholder="$t('common.search_name_username')"
        :titles="[$t('teams.not_joined'), $t('teams.team_members')]"
      />
      <template #footer>
        <el-button @click="membersVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSaveMembers">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { roleLabel } from '@/api/roles.js'

const list = ref([])
const loading = ref(false)
const userOptions = ref([])

async function load() {
  loading.value = true
  try {
    const d = await fde.teams.list({ all: '1' })
    list.value = d.list
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

async function loadUsers() {
  try {
    const d = await fde.users.mentionable()
    userOptions.value = d.list
  } catch (e) { ElMessage.error(e.message) }
}

// ---- 新建/编辑 ----
const dialogVisible = ref(false)
const editing = ref(false)
const submitting = ref(false)
const formRef = ref(null)
const form = reactive({ id: null, name: '', description: '', leaderId: '', chatWebhookUrl: '', sortOrder: 0 })
const rules = {
  name: [{ required: true, message: $t('teams.enter_team_name'), trigger: 'blur' }]
}

function openCreate() {
  editing.value = false
  Object.assign(form, { id: null, name: '', description: '', leaderId: '', chatWebhookUrl: '', sortOrder: 0 })
  dialogVisible.value = true
}
function openEdit(row) {
  editing.value = true
  Object.assign(form, {
    id: row.id,
    name: row.name,
    description: row.description || '',
    leaderId: row.leader ? String(row.leader.id) : '',
    chatWebhookUrl: row.chatWebhookUrl || '',
    sortOrder: row.sortOrder || 0
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    const payload = {
      name: form.name,
      description: form.description,
      leaderId: form.leaderId || null,
      chatWebhookUrl: form.chatWebhookUrl,
      sortOrder: form.sortOrder
    }
    if (editing.value) {
      await fde.teams.update(form.id, payload)
      ElMessage.success($t('common.updated'))
    } else {
      await fde.teams.create(payload)
      ElMessage.success($t('teams.team_created_click_members_add_people'))
    }
    dialogVisible.value = false
    await load()
  } catch (e) { ElMessage.error(e.message) }
  finally { submitting.value = false }
}

async function toggleStatus(row) {
  try {
    await fde.teams.update(row.id, { status: row.status === 1 ? 0 : 1 })
    ElMessage.success(row.status === 1 ? $t('common.disabled_2') : $t('common.enabled_2'))
    await load()
  } catch (e) { ElMessage.error(e.message) }
}

async function handleDelete(row) {
  try {
    await fde.teams.remove(row.id)
    ElMessage.success($t('common.deleted'))
    await load()
  } catch (e) { ElMessage.error(e.message) }
}

// ---- 成员管理 ----
const membersVisible = ref(false)
const membersLoading = ref(false)
const currentTeam = ref(null)
const memberIds = ref([])
const transferData = computed(() => userOptions.value.map(u => ({
  key: String(u.id),
  label: `${u.name} (${roleLabel(u.role)})`
})))

async function openMembers(row) {
  currentTeam.value = row
  memberIds.value = []
  membersVisible.value = true
  membersLoading.value = true
  try {
    const team = await fde.teams.detail(row.id)
    memberIds.value = (team.members || []).map(m => String(m.id))
  } catch (e) { ElMessage.error(e.message) }
  finally { membersLoading.value = false }
}

async function handleSaveMembers() {
  submitting.value = true
  try {
    await fde.teams.setMembers(currentTeam.value.id, memberIds.value)
    ElMessage.success($t('teams.members_updated'))
    membersVisible.value = false
    await load()
  } catch (e) { ElMessage.error(e.message) }
  finally { submitting.value = false }
}

onMounted(() => { load(); loadUsers() })
</script>

<style scoped>
.teams-page { display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.table-card { border-radius: 8px; }
.muted { color: #b0aeaa; }
.muted-hint { font-size: 12px; color: #909399; line-height: 1.5; margin-top: 4px; }
</style>
