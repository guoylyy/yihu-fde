<template>
  <div class="llm-page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.llm_settings') }}</h2>
        <p class="hint">{{ $t('llmConfigs.configure_llms_parameters_platform_can_call') }}</p>
      </div>
      <!-- 已接入以虎 One: 平台托管的模型一键同步, 不用填密钥 -->
      <el-button v-if="yihuOne" :loading="syncing" @click="syncYihuOne">
        <el-icon><Refresh /></el-icon>{{ $t('llmConfigs.sync_from', { p0: yihuOne.name }) }}
      </el-button>
      <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>{{ $t('llmConfigs.new_configuration') }}</el-button>
    </div>

    <el-card shadow="never" class="block-card">
      <el-table :data="list" stripe>
        <el-table-column :label="$t('llmConfigs.configuration_name')" min-width="160">
          <template #default="{ row }">
            <span style="font-weight: 600;">{{ row.name }}</span>
            <el-tag v-if="row.isDefault" type="success" size="small" effect="dark" style="margin-left: 6px;">{{ $t('llmConfigs.default') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('llmConfigs.provider')" width="150">
          <template #default="{ row }">{{ providerLabel(row.provider) }}</template>
        </el-table-column>
        <el-table-column prop="model" :label="$t('common.model')" min-width="180">
          <template #default="{ row }"><code class="mono">{{ row.model }}</code></template>
        </el-table-column>
        <el-table-column :label="$t('llmConfigs.api_key')" width="170">
          <template #default="{ row }">
            <span v-if="row.provider === 'YIHU_ONE'" class="param-text">{{ $t('llmConfigs.platform_credentials') }}</span>
            <code v-else-if="row.hasApiKey" class="mono">{{ row.apiKeyMasked }}</code>
            <el-tag v-else size="small" type="warning" effect="plain">{{ $t('common.not_configured') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('llmConfigs.parameters')" width="180">
          <template #default="{ row }">
            <span class="param-text">
              {{ $t('llmConfigs.temp_maxtokens', { p0: row.temperature ?? $t('llmConfigs.default'), p1: row.maxTokens ?? $t('llmConfigs.default') }) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="v => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.notes')" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
            <el-button v-if="!row.isDefault && row.enabled" link size="small" @click="setDefault(row)">{{ $t('llmConfigs.set_as_default') }}</el-button>
            <el-popconfirm v-if="!row.isDefault" :title="$t('llmConfigs.delete_this_configuration')" @confirm="handleDelete(row)">
              <template #reference>
                <el-button link size="small" type="danger">{{ $t('common.delete_2') }}</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" :description="$t('llmConfigs.no_llm_configurations_yet_click_new')" :image-size="90" />
    </el-card>

    <!-- 新增/编辑 -->
    <el-dialog v-model="formVisible" :title="editing ? $t('llmConfigs.edit_configuration') : $t('llmConfigs.new_configuration')" width="640px" @closed="formRef?.clearValidate()">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item :label="$t('llmConfigs.configuration_name')" prop="name">
          <el-input v-model="form.name" :placeholder="$t('llmConfigs.e_g_main_model_claude')" />
        </el-form-item>
        <el-form-item :label="$t('llmConfigs.provider')" prop="provider">
          <el-select v-model="form.provider" style="width: 100%;" @change="onProviderChange">
            <el-option v-for="p in providerOptions" :key="p.value" :label="p.label" :value="p.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.model')" prop="model">
          <!-- 预设可选也可手输(供应商发新模型不用等系统更新) -->
          <el-select v-model="form.model" filterable allow-create default-first-option :placeholder="$t('llmConfigs.choose_or_enter_model_id')" style="width: 100%;">
            <el-option v-for="m in currentModels" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-alert v-if="isYihuOne" type="info" :closable="false" show-icon style="margin: 0 0 18px 110px; width: auto;"
          :title="$t('llmConfigs.yihu_one_hint', { p0: yihuOne?.name || 'Yihu One' })" />
        <el-form-item v-if="!isYihuOne" :label="$t('llmConfigs.endpoint')">
          <el-input v-model="form.baseUrl" :placeholder="currentProviderDef?.baseUrl ? $t('llmConfigs.leave_empty_for_official_default', { p0: currentProviderDef.baseUrl }) : $t('llmConfigs.custom_gateway_url_openai_compatible')" />
        </el-form-item>
        <el-form-item v-if="!isYihuOne" :label="$t('llmConfigs.api_key')">
          <el-input v-model="form.apiKey" type="password" show-password
            :placeholder="editing && editingHasKey ? $t('llmConfigs.configured_leave_empty_keep') : $t('llmConfigs.api_key_only_mask_shown_after')" />
        </el-form-item>
        <el-form-item label="temperature">
          <div style="width: 100%;">
            <el-slider v-model="form.temperatureVal" :min="0" :max="2" :step="0.1" :disabled="!form.useTemperature" show-input :show-input-controls="false" style="margin-right: 8px;" />
            <el-checkbox v-model="form.useTemperature">{{ $t('llmConfigs.set_temperature_unchecked_model_default_note') }}</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="maxTokens">
          <el-input-number v-model="form.maxTokens" :min="1" :step="1024" :placeholder="$t('llmConfigs.leave_empty_for_default')" style="width: 200px;" />
          <span class="field-hint">{{ $t('llmConfigs.max_output_tokens_per_call_leave') }}</span>
        </el-form-item>
        <el-form-item :label="$t('llmConfigs.system_prompt')">
          <el-input v-model="form.systemPrompt" type="textarea" :rows="3" :placeholder="$t('llmConfigs.optional_default_system_prompt_for_this')" />
        </el-form-item>
        <el-form-item :label="$t('common.notes')">
          <el-input v-model="form.remark" :placeholder="$t('llmConfigs.optional_e_g_what_its_used')" />
        </el-form-item>
        <el-form-item v-if="!editing" :label="$t('llmConfigs.set_as_default')">
          <el-switch v-model="form.isDefault" />
          <span class="field-hint">{{ $t('llmConfigs.first_configuration_becomes_default_automaticall') }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'

// 供应商预设: Claude 模型清单以官方为准, 其余为常见型号(可手输覆盖)
const PROVIDERS = [
  { value: 'ANTHROPIC', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5'] },
  { value: 'DEEPSEEK', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { value: 'QWEN', label: $t('llmConfigs.qwen_alibaba_cloud'), baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'] },
  { value: 'ZHIPU', label: $t('llmConfigs.zhipu_glm'), baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'] },
  { value: 'MOONSHOT', label: $t('llmConfigs.moonshot_kimi'), baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-auto', 'kimi-latest'] },
  { value: 'OPENAI', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
  { value: 'CUSTOM', label: $t('llmConfigs.custom_openai_compatible_api'), baseUrl: '', models: [] }
]

const list = ref([])
const loading = ref(false)
// 已接入以虎 One 时为 { name }
const yihuOne = ref(null)
const syncing = ref(false)
const yihuOneProvider = computed(() => ({ value: 'YIHU_ONE', label: yihuOne.value?.name || 'Yihu One', baseUrl: '', models: [] }))
const providerOptions = computed(() => (yihuOne.value || form.provider === 'YIHU_ONE') ? [yihuOneProvider.value, ...PROVIDERS] : PROVIDERS)
function providerLabel(v) { return providerOptions.value.find(p => p.value === v)?.label || v }

const formVisible = ref(false)
const editing = ref(false)
const editingHasKey = ref(false)
const submitting = ref(false)
const formRef = ref()
const form = reactive({
  id: null, name: '', provider: 'ANTHROPIC', model: '', baseUrl: '', apiKey: '',
  useTemperature: false, temperatureVal: 0.7, maxTokens: null, systemPrompt: '', remark: '', isDefault: false
})
const rules = {
  name: [{ required: true, message: $t('llmConfigs.configuration_name_required'), trigger: 'blur' }],
  provider: [{ required: true, message: $t('llmConfigs.choose_provider'), trigger: 'change' }],
  model: [{ required: true, message: $t('llmConfigs.choose_or_enter_model_id_2'), trigger: 'change' }]
}
const currentProviderDef = computed(() => providerOptions.value.find(p => p.value === form.provider))
const isYihuOne = computed(() => form.provider === 'YIHU_ONE')
const currentModels = computed(() => currentProviderDef.value?.models || [])

function onProviderChange() {
  form.model = currentModels.value[0] || ''
  form.baseUrl = ''
}

async function loadList() {
  loading.value = true
  try {
    const data = await fde.llmConfigs.list()
    list.value = data.list
    yihuOne.value = data.yihuOne || null
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

function openCreate() {
  editing.value = false
  editingHasKey.value = false
  Object.assign(form, {
    id: null, name: '', provider: 'ANTHROPIC', model: 'claude-opus-4-8', baseUrl: '', apiKey: '',
    useTemperature: false, temperatureVal: 0.7, maxTokens: null, systemPrompt: '', remark: '', isDefault: false
  })
  formVisible.value = true
}

function openEdit(row) {
  editing.value = true
  editingHasKey.value = row.hasApiKey
  Object.assign(form, {
    id: row.id, name: row.name, provider: row.provider, model: row.model,
    baseUrl: row.baseUrl || '', apiKey: '',
    useTemperature: row.temperature !== null && row.temperature !== undefined,
    temperatureVal: row.temperature !== null && row.temperature !== undefined ? Number(row.temperature) : 0.7,
    maxTokens: row.maxTokens || null, systemPrompt: row.systemPrompt || '', remark: row.remark || '', isDefault: row.isDefault
  })
  formVisible.value = true
}

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    const payload = {
      name: form.name, provider: form.provider, model: form.model,
      baseUrl: form.baseUrl || null,
      temperature: form.useTemperature ? form.temperatureVal : null,
      maxTokens: form.maxTokens || null,
      systemPrompt: form.systemPrompt || null,
      remark: form.remark || null
    }
    if (isYihuOne.value) payload.baseUrl = null
    else if (form.apiKey) payload.apiKey = form.apiKey
    if (editing.value) {
      await fde.llmConfigs.update(form.id, payload)
      ElMessage.success($t('common.updated'))
    } else {
      await fde.llmConfigs.create({ ...payload, isDefault: form.isDefault })
      ElMessage.success($t('common.created_2'))
    }
    formVisible.value = false
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.save_failed')) }
  finally { submitting.value = false }
}

async function syncYihuOne() {
  syncing.value = true
  try {
    const r = await fde.llmConfigs.syncYihuOne()
    ElMessage.success($t('llmConfigs.sync_result', { p0: r.models, p1: r.created, p2: r.updated, p3: r.disabled }))
    loadList()
  } catch (e) { ElMessage.error(e.message) }
  finally { syncing.value = false }
}

async function toggleEnabled(row, v) {
  try {
    await fde.llmConfigs.update(row.id, { enabled: v })
    ElMessage.success(v ? $t('common.enabled_2') : $t('common.disabled_2'))
    loadList()
  } catch (e) { ElMessage.error(e.message) }
}

async function setDefault(row) {
  try {
    await fde.llmConfigs.setDefault(row.id)
    ElMessage.success($t('llmConfigs.now_default', { p0: row.name }))
    loadList()
  } catch (e) { ElMessage.error(e.message) }
}

async function handleDelete(row) {
  try {
    await fde.llmConfigs.remove(row.id)
    ElMessage.success($t('common.deleted'))
    loadList()
  } catch (e) { ElMessage.error(e.message) }
}

onMounted(loadList)
</script>

<style scoped>
.llm-page { display: flex; flex-direction: column; gap: 12px; }
.page-header { display: flex; align-items: flex-end; gap: 12px; }
.page-header > div:first-child { margin-right: auto; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.block-card { border-radius: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f5f5f4; padding: 1px 6px; border-radius: 4px; color: #44403c; }
.param-text { font-size: 12px; color: #78716c; }
.field-hint { font-size: 12px; color: #a8a29e; margin-left: 10px; }
</style>
