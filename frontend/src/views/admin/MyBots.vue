<template>
  <!-- v2.13.0(#1281) 我的开发助手: 名下全部机器人一页管理
       只读列表页(注册/编辑/禁用等操作流在 #1282 落地), 本页先解决「看得见」 -->
  <div class="mybots-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.my_dev_assistants') }}</h2>
        <p class="hint">{{ $t('myBots.all_robots_you_own_total', { p0: list.length }) }}
          <template v-if="zombieCount"> · <span class="zombie-hint">{{ $t('myBots.possible_zombies', { p0: zombieCount }) }}</span></template>
        </p>
      </div>
      <el-button type="primary" @click="openForm()">{{ $t('myBots.register_new_robot') }}</el-button>
    </div>

    <!-- 骨架屏 -->
    <el-skeleton v-if="loading" :rows="6" animated />

    <!-- 空态 -->
    <el-empty v-else-if="!list.length" :description="$t('myBots.you_havent_registered_any_robots_yet')">
      <el-button type="primary" @click="openForm()">{{ $t('myBots.register_your_first_one') }}</el-button>
    </el-empty>

    <!-- 卡片列表(桌面表格体验弱化, 卡片在 H5 更稳) -->
    <div v-else class="bot-list">
      <div v-for="b in list" :key="b.id" class="bot-card" :class="{ disabled: b.status === 0, zombie: b.isZombie }">
        <div class="bot-head">
          <span class="bot-name">{{ b.name }}</span>
          <!-- 档案状态(生命周期) -->
          <el-tag size="small" :type="statusTag(b.status)" effect="plain">{{ b.statusLabel }}</el-tag>
          <el-tag v-if="b.isZombie" size="small" type="danger" effect="dark">{{ $t('myBots.possibly_zombie') }}</el-tag>
          <!-- 在线状态(presence, 失联≠开发中) -->
          <el-tag size="small" :type="onlineTag(b)" effect="light" class="online-tag">
            {{ onlineText(b) }}
          </el-tag>
        </div>
        <div class="bot-grid">
          <div class="bot-field"><span class="k">{{ $t('common.platform') }}</span><span class="v">{{ platformLabel(b.platform) }}</span></div>
          <div class="bot-field"><span class="k">{{ $t('myBots.machine') }}</span><span class="v">{{ b.machineName || '—' }}</span></div>
          <div class="bot-field"><span class="k">{{ $t('common.purpose') }}</span><span class="v">{{ purposeLabel(b.purpose) }}</span></div>
          <div class="bot-field"><span class="k">{{ $t('common.model') }}</span><span class="v">{{ b.model || '—' }}</span></div>
          <div class="bot-field wide"><span class="k">{{ $t('myBots.scope') }}</span><span class="v">{{ projectNames(b.projectIds) }}</span></div>
          <div class="bot-field"><span class="k">{{ $t('common.last_active') }}</span><span class="v">{{ $t('common.p0', { p0: b.lastActiveDaysAgo == null ? $t('common.never') : $t('common.days_ago_2', { p0: b.lastActiveDaysAgo }) }) }}</span></div>
          <div class="bot-field wide" v-if="online(b)?.activity"><span class="k">{{ $t('myBots.working_on') }}</span><span class="v online-activity">{{ online(b).activity }}</span></div>
        </div>
        <!-- v2.13.0(#1282) 操作流: 编辑 / 禁用⇄启用 / 注销 -->
        <div class="bot-actions">
          <el-button size="small" @click="openForm(b)">{{ $t('common.edit') }}</el-button>
          <el-popconfirm v-if="b.status === 1" :title="$t('myBots.its_key_stops_working_immediately_once')" width="240" @confirm="lifecycle(b, 'disable')">
            <template #reference><el-button size="small" type="warning" plain>{{ $t('common.disable_2') }}</el-button></template>
          </el-popconfirm>
          <el-button v-if="b.status === 0" size="small" type="success" plain @click="lifecycle(b, 'enable')">{{ $t('common.enabled') }}</el-button>
          <el-button v-if="b.status !== -1" size="small" type="danger" plain @click="openDeregister(b)">{{ $t('myBots.deregister') }}</el-button>
        </div>
      </div>
    </div>

    <!-- 新建/编辑表单(#1282, 注册字段想法#7) -->
    <el-dialog v-model="formVisible" :title="formMode === 'create' ? $t('myBots.register_robot') : $t('myBots.edit', { p0: form.name || '' })" width="560px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="92px">
        <el-alert v-if="formMode === 'create'" type="info" :closable="false" class="form-note">
          {{ $t('myBots.created_by') }}<b>{{ meName }}</b>{{ $t('myBots.current_user_used_automatically_purpose_statemen') }}
        </el-alert>
        <el-form-item :label="$t('myBots.robot_name')" prop="name">
          <el-input v-model="form.name" maxlength="50" :placeholder="$t('myBots.e_g_sams_dev_assistant_2')" />
        </el-form-item>
        <el-form-item :label="$t('common.platform')" prop="platform">
          <el-select v-model="form.platform">
            <el-option v-for="(l, v) in PLATFORM_LABELS" :key="v" :label="l" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('myBots.machine')">
          <el-input v-model="form.machineName" maxlength="100" :placeholder="$t('myBots.which_machine_it_runs_on_e')" />
        </el-form-item>
        <el-form-item :label="$t('common.purpose')" prop="purpose">
          <el-radio-group v-model="form.purpose">
            <el-radio value="PATROL">{{ $t('common.patrol') }}</el-radio>
            <el-radio value="DISPATCH">{{ $t('common.dispatch') }}</el-radio>
            <el-radio value="BOTH">{{ $t('common.both') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="$t('myBots.scope')" prop="projectIds">
          <el-select v-model="form.projectIds" multiple filterable :placeholder="$t('myBots.pick_at_least_one_project_no')" style="width: 100%;">
            <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="String(p.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.model')">
          <el-input v-model="form.model" maxlength="100" :placeholder="$t('myBots.e_g_claude_opus_5')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveForm">{{ $t('common.p0', { p0: formMode === 'create' ? $t('myBots.register') : $t('common.save') }) }}</el-button>
      </template>
    </el-dialog>

    <!-- 注销二次确认(输入名字, #1282) -->
    <el-dialog v-model="deregVisible" :title="$t('myBots.deregister_robot_irreversible')" width="440px">
      <el-alert type="warning" :closable="false" class="form-note">
        {{ $t('myBots.deregistering_final_profile_disappears_from_all') }}
      </el-alert>
      <p class="dereg-name">{{ $t('myBots.robot_name_2') }}<b>{{ deregTarget?.name }}</b></p>
      <el-input v-model="deregConfirmName" :placeholder="$t('myBots.type_full_name_above_confirm')" />
      <template #footer>
        <el-button @click="deregVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="danger" :disabled="deregConfirmName.trim() !== deregTarget?.name" :loading="saving" @click="lifecycle(deregTarget, 'deregister')">{{ $t('myBots.confirm_deregistration') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'

const loading = ref(true)
const list = ref([])
const presences = ref([])     // agentProfileId → presence 行(在线态/失联判定)
const projectNameMap = ref({})

const zombieCount = computed(() => list.value.filter(b => b.isZombie).length)

async function load() {
  loading.value = true
  try {
    const [mine, pres, projects] = await Promise.all([
      fde.agentProfiles.mine(),
      // 全量含历史: 失联(>30min 无心跳)也要显示, 不能只取活跃
      fde.agentPresence.list({ activeOnly: 'false' }).catch(() => ({ list: [] })),
      fde.projects.list({ page: 1, page_size: 200 }).catch(() => ({ list: [] }))
    ])
    list.value = mine.list || []
    presences.value = pres.list || []
    projectNameMap.value = Object.fromEntries((projects.list || []).map(p => [String(p.id), p.name]))
  } finally {
    loading.value = false
  }
}
onMounted(load)

// presence 按 agentProfileId 索引(可能没有行 = 离线)
function online(b) {
  return presences.value.find(p => String(p.agentProfileId) === String(b.id)) || null
}

// 在线四态: 巡检中(新鲜心跳, 无任务) / 开发中(新鲜心跳, 带 taskId) / 失联(有心跳但 stale>30min) / 离线(无心跳或 OFFLINE)
// 红线: stale 永远不显示为「开发中」—— 假装在干活比没有状态更糟
function onlineText(b) {
  const p = online(b)
  if (!p || p.status === 'OFFLINE') return $t('common.offline')
  if (p.stale) return $t('common.lost_contact_for_min', { p0: minsAgo(p.heartbeatAt) })
  return p.taskId ? $t('common.developing') : $t('common.patrolling')
}
function onlineTag(b) {
  const p = online(b)
  if (!p || p.status === 'OFFLINE') return 'info'
  if (p.stale) return 'danger'
  return p.taskId ? 'success' : 'warning'
}
function minsAgo(t) {
  return Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60000))
}

function statusTag(s) {
  return s === 1 ? 'success' : s === 0 ? 'info' : 'danger'
}
const PLATFORM_LABELS = { CLAUDE_CODE: 'Claude Code', OPENHEX: 'OpenHex', COZE: 'Coze', CUSTOM: $t('common.custom'), OTHER: $t('common.other') }
function platformLabel(p) { return PLATFORM_LABELS[p] || p || '—' }
const PURPOSE_LABELS = { PATROL: $t('common.patrol'), DISPATCH: $t('common.dispatch'), BOTH: $t('common.both') }
function purposeLabel(p) { return p ? (PURPOSE_LABELS[p] || p) : $t('common.not_registered') }
function projectNames(ids) {
  if (!ids || !ids.length) return $t('myBots.not_set')
  return ids.map(id => projectNameMap.value[String(id)] || `#${id}`).join($t('common.list_sep'))
}

// ============ v2.13.0(#1282) 表单与操作流 ============
const projectOptions = computed(() => Object.entries(projectNameMap.value).map(([id, name]) => ({ id, name })))
const meName = JSON.parse(localStorage.getItem('fde_internal_user') || '{}')?.name || $t('myBots.current_user')

const formRef = ref()
const formVisible = ref(false)
const formMode = ref('create')
const saving = ref(false)
const editingId = ref(null)
const form = reactive({ name: '', platform: 'CLAUDE_CODE', machineName: '', purpose: 'PATROL', projectIds: [], model: '' })
// 名字规范: 2-50 字, 中英文/数字/空格/-_·
const NAME_RE = /^[一-龥A-Za-z0-9\-_· ]{2,50}$/
const formRules = {
  name: [
    { required: true, message: $t('myBots.give_robot_name'), trigger: 'blur' },
    { trigger: 'blur', validator: (_, v, cb) => NAME_RE.test(String(v || '').trim()) ? cb() : cb(new Error($t('myBots.2_50_characters_letters_numbers_spaces'))) }
  ],
  purpose: [{ required: true, message: $t('myBots.choose_purpose'), trigger: 'change' }],
  projectIds: [{ required: true, type: 'array', min: 1, message: $t('myBots.pick_at_least_one_project_for'), trigger: 'change' }]
}

function openForm(b = null) {
  formMode.value = b ? 'edit' : 'create'
  editingId.value = b?.id || null
  Object.assign(form, {
    name: b?.name || '',
    platform: b?.platform || 'CLAUDE_CODE',
    machineName: b?.machineName || '',
    purpose: b?.purpose || 'PATROL',
    projectIds: (b?.projectIds || []).map(String),
    model: b?.model || ''
  })
  formVisible.value = true
}

async function saveForm() {
  try { await formRef.value.validate() } catch { return }
  saving.value = true
  const payload = {
    name: form.name.trim(), platform: form.platform,
    machineName: form.machineName.trim() || null,
    purpose: form.purpose, projectIds: form.projectIds, model: form.model.trim() || null
  }
  try {
    if (formMode.value === 'create') {
      const r = await fde.agentProfiles.create(payload)
      formVisible.value = false
      ElMessage.success($t('myBots.registered_dedicated_key_was_generated_copy'))
      if (r?.apiKey) ElMessage({ type: 'info', message: $t('myBots.key_full_key_shown_only_this', { p0: String(r.apiKey).slice(0, 8) }), duration: 8000 })
    } else {
      await fde.agentProfiles.update(editingId.value, payload)
      formVisible.value = false
      ElMessage.success($t('common.saved'))
    }
    load()
  } catch (e) { ElMessage.error(e.message || $t('common.save_failed')) } finally { saving.value = false }
}

// 生命周期操作: disable/enable/deregister; 失败展示接口原因(如「有进行中的运行」)
const deregVisible = ref(false)
const deregTarget = ref(null)
const deregConfirmName = ref('')
function openDeregister(b) {
  deregTarget.value = b
  deregConfirmName.value = ''
  deregVisible.value = true
}
async function lifecycle(b, action) {
  if (!b) return
  saving.value = true
  try {
    if (action === 'disable') await fde.agentProfiles.disable(b.id)
    else if (action === 'enable') await fde.agentProfiles.enable(b.id)
    else if (action === 'deregister') {
      await fde.agentProfiles.deregister(b.id, deregConfirmName.value.trim())
      deregVisible.value = false
    }
    ElMessage.success(action === 'disable' ? $t('common.disabled') : action === 'enable' ? $t('common.enabled_2') : $t('common.deregistered'))
    load()
  } catch (e) {
    // 阻断原因原样呈现(409 运行中/9021 名字不符等), 不静默
    ElMessage({ type: 'error', message: e.message || $t('common.action_failed'), duration: 6000, showClose: true })
  } finally { saving.value = false }
}

</script>

<style scoped>
.mybots-page { display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.page-title { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
.hint { font-size: 13px; color: #868580; margin: 0; }
.zombie-hint { color: #c2362b; }
.bot-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
.bot-card { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 14px 16px; }
.bot-card.disabled { opacity: .65; background: #faf9f7; }
.bot-card.zombie { border-color: #f3c1b5; }
.bot-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.bot-name { font-size: 15px; font-weight: 700; margin-right: auto; }
.online-tag { margin-left: auto; }
.bot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; }
.bot-field { display: flex; gap: 8px; font-size: 13px; line-height: 1.7; min-width: 0; }
.bot-field.wide { grid-column: 1 / -1; }
.bot-field .k { color: #a8a29e; flex: none; }
.bot-field .v { color: #1c1917; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-field.wide .v { white-space: normal; }
.online-activity { color: #57534e; }
.bot-actions { display: flex; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #f0ede8; flex-wrap: wrap; }
.form-note { margin-bottom: 14px; }
.dereg-name { font-size: 14px; margin: 12px 0 8px; }
/* H5: 单列卡片, 字段纵向自适应 */
@media (max-width: 767px) {
  .bot-list { grid-template-columns: 1fr; }
  .bot-grid { grid-template-columns: 1fr; }
  .bot-field { flex-direction: column; gap: 0; }
}
</style>
