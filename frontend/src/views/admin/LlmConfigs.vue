<template>
  <div class="llm-page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 v-if="!embedded" class="page-title">{{ $t('common.llm_settings') }}</h2>
        <p class="hint">{{ yihuOne ? $t('llmConfigs.platform_models_hint', { p0: yihuOne.name }) : $t('llmConfigs.not_connected') }}</p>
      </div>
      <el-button v-if="yihuOne" type="primary" :loading="syncing" @click="syncYihuOne">
        <el-icon><Refresh /></el-icon>{{ $t('llmConfigs.sync_from', { p0: yihuOne.name }) }}
      </el-button>
    </div>

    <el-card shadow="never" class="block-card">
      <el-table :data="list" stripe>
        <el-table-column :label="$t('common.model')" min-width="220">
          <template #default="{ row }">
            <span style="font-weight: 600;">{{ row.name }}</span>
            <el-tag v-if="row.isDefault" type="success" size="small" effect="dark" style="margin-left: 6px;">{{ $t('llmConfigs.default') }}</el-tag>
            <div><code class="mono">{{ row.model }}</code></div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('llmConfigs.parameters')" width="200">
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
        <el-table-column :label="$t('common.notes')" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
            <el-button v-if="!row.isDefault && row.enabled" link size="small" @click="setDefault(row)">{{ $t('llmConfigs.set_as_default') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" :description="yihuOne ? $t('llmConfigs.no_models_yet', { p0: yihuOne.name }) : $t('llmConfigs.not_connected')" :image-size="90" />
    </el-card>

    <!-- 调参数: 模型本身来自平台, 这里只调本系统调用时的参数 -->
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
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'

// embedded: 放在系统设置的标签页里, 不重复页面标题
defineProps({ embedded: { type: Boolean, default: false } })

const list = ref([])
const loading = ref(false)
// 已接入以虎 One 时为 { name }
const yihuOne = ref(null)
const syncing = ref(false)

const formVisible = ref(false)
const submitting = ref(false)
const form = reactive({ id: null, name: '', useTemperature: false, temperatureVal: 0.7, maxTokens: null, systemPrompt: '', remark: '' })

async function loadList() {
  loading.value = true
  try {
    const data = await fde.llmConfigs.list()
    list.value = data.list
    yihuOne.value = data.yihuOne || null
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
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
.page-header { display: flex; align-items: flex-end; gap: 12px; }
.page-header > div:first-child { margin-right: auto; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.block-card { border-radius: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f5f5f4; padding: 1px 6px; border-radius: 4px; color: #44403c; }
.param-text { font-size: 12px; color: #78716c; }
.field-hint { font-size: 12px; color: #a8a29e; margin-left: 10px; }
</style>
