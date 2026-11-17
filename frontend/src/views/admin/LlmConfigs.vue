<template>
  <div class="llm-page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 v-if="!embedded" class="page-title">{{ $t('common.llm_settings') }}</h2>
        <p class="hint">{{ yihuOne ? $t('llmConfigs.platform_models_hint', { p0: yihuOne.name }) : $t('llmConfigs.not_connected_manual') }}</p>
        <p class="hint">{{ $t('llmConfigs.everyone_uses_default') }}</p>
      </div>
      <el-button @click="openManual()">
        <el-icon><Plus /></el-icon>{{ $t('llmConfigs.add_manual') }}
      </el-button>
      <el-button v-if="yihuOne" type="primary" :loading="syncing" @click="syncYihuOne">
        <el-icon><Refresh /></el-icon>{{ $t('llmConfigs.sync_from', { p0: yihuOne.name }) }}
      </el-button>
    </div>

    <!-- 没接平台: 明确告诉管理员该怎么办, 不静默失败 -->
    <el-alert v-if="!yihuOne && !loading" type="warning" show-icon :closable="false" :title="$t('llmConfigs.not_connected_manual')" />

    <!-- 当前实际在用的模型 + 试连 -->
    <el-card shadow="never" class="block-card current-card">
      <div class="current-row">
        <span class="current-label">{{ $t('llmConfigs.current_model') }}</span>
        <template v-if="active?.source">
          <span class="current-name">{{ active.name }}</span>
          <code v-if="active.model" class="mono">{{ active.model }}</code>
          <el-tag size="small" :type="active.source === 'manual' ? 'warning' : 'success'" effect="plain">
            {{ active.source === 'manual' ? $t('llmConfigs.source_manual') : $t('llmConfigs.source_platform') }}
          </el-tag>
        </template>
        <span v-else class="current-none">{{ $t('llmConfigs.none_active', { p0: active?.reason || '—' }) }}</span>
        <el-button class="current-test" size="small" :loading="testing.current" :disabled="!active?.source" @click="runTest('current', {})">
          {{ $t('llmConfigs.test') }}
        </el-button>
      </div>
      <TestResult :result="results.current" />
    </el-card>

    <!-- 平台上可用的模型(只读预览, 可逐个试连; 同步后才进下面的配置表) -->
    <el-card v-if="yihuOne" shadow="never" class="block-card">
      <template #header>
        <span class="card-title">{{ $t('llmConfigs.platform_models', { p0: yihuOne.name }) }}</span>
      </template>
      <div v-if="platformError" class="err-text">{{ $t('llmConfigs.models_load_failed', { p0: platformError }) }}</div>
      <div v-for="m in platformModels" :key="m.id" class="pm-row">
        <div class="pm-main">
          <span class="pm-name">{{ m.name }}</span>
          <code class="mono">{{ m.id }}</code>
          <el-tag v-if="m.default" size="small" effect="plain">{{ $t('llmConfigs.platform_default') }}</el-tag>
          <el-tag size="small" :type="syncedModels.has(m.id) ? 'success' : 'info'" effect="plain">
            {{ syncedModels.has(m.id) ? $t('llmConfigs.synced') : $t('llmConfigs.not_synced') }}
          </el-tag>
        </div>
        <el-button size="small" :loading="testing['pm:' + m.id]" @click="runTest('pm:' + m.id, { model: m.id })">{{ $t('llmConfigs.test') }}</el-button>
        <TestResult class="pm-result" :result="results['pm:' + m.id]" />
      </div>
    </el-card>

    <el-card shadow="never" class="block-card">
      <el-table :data="list" stripe>
        <el-table-column :label="$t('common.model')" min-width="220">
          <template #default="{ row }">
            <span style="font-weight: 600;">{{ row.name }}</span>
            <el-tag v-if="row.isDefault" type="success" size="small" effect="dark" style="margin-left: 6px;">{{ $t('llmConfigs.default') }}</el-tag>
            <div><code class="mono">{{ row.model }}</code></div>
            <TestResult :result="results['row:' + row.id]" />
          </template>
        </el-table-column>
        <el-table-column :label="$t('llmConfigs.source')" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.source === 'manual' ? 'warning' : 'success'" effect="plain">
              {{ row.source === 'manual' ? $t('llmConfigs.source_manual') : $t('llmConfigs.source_platform') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('llmConfigs.parameters')" width="190">
          <template #default="{ row }">
            <span class="param-text">
              {{ $t('llmConfigs.temp_maxtokens', { p0: row.temperature ?? $t('llmConfigs.default'), p1: row.maxTokens ?? $t('llmConfigs.default') }) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="80" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="v => toggleEnabled(row, v)" />
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" type="primary" :loading="testing['row:' + row.id]" @click="runTest('row:' + row.id, { id: row.id })">{{ $t('llmConfigs.test') }}</el-button>
            <el-button link size="small" type="primary" @click="row.source === 'manual' ? openManual(row) : openEdit(row)">{{ $t('common.edit') }}</el-button>
            <el-button v-if="!row.isDefault && row.enabled" link size="small" @click="setDefault(row)">{{ $t('llmConfigs.set_as_default') }}</el-button>
            <el-button v-if="row.source === 'manual' && !row.isDefault" link size="small" type="danger" @click="remove(row)">{{ $t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" :description="yihuOne ? $t('llmConfigs.no_models_yet', { p0: yihuOne.name }) : $t('llmConfigs.not_connected_manual')" :image-size="90" />
    </el-card>

    <!-- 调参数: 平台同步的模型本身来自平台, 这里只调本系统调用时的参数 -->
    <el-dialog v-model="formVisible" :title="form.name" width="600px">
      <el-form :model="form" label-width="110px">
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
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 手填模型(OpenAI 兼容接口): 密钥写后只显示掩码 -->
    <el-dialog v-model="manualVisible" :title="$t('llmConfigs.manual_title')" width="560px">
      <el-form :model="manual" label-width="90px">
        <el-form-item :label="$t('llmConfigs.manual_name')" required><el-input v-model="manual.name" maxlength="100" /></el-form-item>
        <el-form-item :label="$t('llmConfigs.manual_model')" required><el-input v-model="manual.model" placeholder="deepseek-chat" maxlength="100" /></el-form-item>
        <el-form-item :label="$t('llmConfigs.manual_base_url')" required><el-input v-model="manual.baseUrl" :placeholder="$t('llmConfigs.manual_base_url_ph')" maxlength="300" /></el-form-item>
        <el-form-item :label="$t('llmConfigs.manual_api_key')" :required="!manual.id">
          <el-input v-model="manual.apiKey" type="password" show-password autocomplete="off"
            :placeholder="manual.id ? $t('llmConfigs.manual_api_key_keep', { p0: manual.apiKeyMasked || '****' }) : 'sk-…'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="saveManual">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'

// embedded: 放在系统设置的标签页里, 不重复页面标题
defineProps({ embedded: { type: Boolean, default: false } })

// 试连结果: 延迟 + 返回样例 / 失败原因
const TestResult = (props) => {
  const r = props.result
  if (!r) return null
  return h('div', { class: ['test-result', r.ok ? 'ok' : 'fail'] }, [
    h('span', { class: 'tr-head' }, r.ok ? $t('llmConfigs.test_ok', { p0: r.latencyMs }) : $t('llmConfigs.test_fail', { p0: r.latencyMs })),
    h('span', { class: 'tr-body' }, r.ok ? `${$t('llmConfigs.test_sample')}：${r.sample}` : r.error)
  ])
}
TestResult.props = ['result']

const list = ref([])
const loading = ref(false)
// 已接入以虎 One 时为 { name }
const yihuOne = ref(null)
const active = ref(null)
const syncing = ref(false)
const platformModels = ref([])
const platformError = ref('')
const syncedModels = computed(() => new Set(list.value.filter((c) => c.source === 'platform' && c.enabled).map((c) => c.model)))
const testing = reactive({})
const results = reactive({})

const formVisible = ref(false)
const submitting = ref(false)
const form = reactive({ id: null, name: '', useTemperature: false, temperatureVal: 0.7, maxTokens: null, systemPrompt: '', remark: '' })
const manualVisible = ref(false)
const manual = reactive({ id: null, name: '', model: '', baseUrl: '', apiKey: '', apiKeyMasked: '' })

async function loadList() {
  loading.value = true
  try {
    const data = await fde.llmConfigs.list()
    list.value = data.list
    yihuOne.value = data.yihuOne || null
    active.value = data.active || null
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
  if (yihuOne.value) loadPlatformModels()
}

async function loadPlatformModels() {
  platformError.value = ''
  try { platformModels.value = (await fde.llmConfigs.platformModels()).list } catch (e) { platformError.value = e.message; platformModels.value = [] }
}

async function runTest(key, body) {
  testing[key] = true
  results[key] = null
  try { results[key] = await fde.llmConfigs.test(body) } catch (e) { results[key] = { ok: false, latencyMs: 0, error: e.message } }
  finally { testing[key] = false }
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

function openEdit(row) {
  const hasTemp = row.temperature !== null && row.temperature !== undefined
  Object.assign(form, {
    id: row.id, name: row.name, useTemperature: hasTemp, temperatureVal: hasTemp ? Number(row.temperature) : 0.7,
    maxTokens: row.maxTokens || null, systemPrompt: row.systemPrompt || '', remark: row.remark || ''
  })
  formVisible.value = true
}

async function handleSubmit() {
  submitting.value = true
  try {
    await fde.llmConfigs.update(form.id, {
      temperature: form.useTemperature ? form.temperatureVal : null,
      maxTokens: form.maxTokens || null,
      systemPrompt: form.systemPrompt || null,
      remark: form.remark || null
    })
    ElMessage.success($t('common.updated'))
    formVisible.value = false
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.save_failed')) }
  finally { submitting.value = false }
}

function openManual(row) {
  Object.assign(manual, row
    ? { id: row.id, name: row.name, model: row.model, baseUrl: row.baseUrl || '', apiKey: '', apiKeyMasked: row.apiKeyMasked }
    : { id: null, name: '', model: '', baseUrl: '', apiKey: '', apiKeyMasked: '' })
  manualVisible.value = true
}

async function saveManual() {
  submitting.value = true
  try {
    const body = { name: manual.name, model: manual.model, baseUrl: manual.baseUrl, ...(manual.apiKey ? { apiKey: manual.apiKey } : {}) }
    if (manual.id) await fde.llmConfigs.update(manual.id, body)
    else await fde.llmConfigs.create(body)
    ElMessage.success($t('common.saved'))
    manualVisible.value = false
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.save_failed')) }
  finally { submitting.value = false }
}

async function remove(row) {
  try { await ElMessageBox.confirm($t('llmConfigs.delete_confirm', { p0: row.name }), $t('common.delete'), { type: 'warning' }) } catch { return }
  try { await fde.llmConfigs.remove(row.id); loadList() } catch (e) { ElMessage.error(e.message) }
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

onMounted(loadList)
</script>

<style scoped>
.llm-page { display: flex; flex-direction: column; gap: 12px; }
.page-header { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.page-header > div:first-child { margin-right: auto; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.block-card { border-radius: 12px; }
.card-title { font-weight: 600; font-size: 14px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f5f5f4; padding: 1px 6px; border-radius: 4px; color: #44403c; }
.param-text { font-size: 12px; color: #78716c; }
.field-hint { font-size: 12px; color: #a8a29e; margin-left: 10px; }
.current-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.current-label { font-size: 13px; color: #78716c; }
.current-name { font-weight: 700; color: #1c1917; }
.current-none { color: #b91c1c; font-size: 13px; }
.current-test { margin-left: auto; }
.pm-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f5f5f4; }
.pm-row:last-child { border-bottom: none; }
.pm-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; flex-wrap: wrap; }
.pm-name { font-weight: 600; }
.pm-result { flex-basis: 100%; }
.err-text { color: #b91c1c; font-size: 13px; }
:deep(.test-result) { margin-top: 6px; font-size: 12px; line-height: 1.6; display: flex; flex-direction: column; }
:deep(.test-result.ok .tr-head) { color: #15803d; font-weight: 600; }
:deep(.test-result.fail .tr-head) { color: #b91c1c; font-weight: 600; }
:deep(.test-result .tr-body) { color: #57534e; word-break: break-all; }
</style>
