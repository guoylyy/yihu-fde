<!-- 资产登记 / 编辑弹窗 —— 登记门槛要低：L0 只要名称 + 一句话 + 出处，其余可以之后补 -->
<template>
  <el-dialog :model-value="modelValue" :title="asset ? $t('assetEditDialog.edit_asset', { p0: asset.name }) : $t('common.register_asset')" width="820px" append-to-body
    :close-on-click-modal="false" @update:model-value="v => emit('update:modelValue', v)" @open="init">
    <el-alert v-if="!asset && !can('asset.manage')" type="info" :closable="false" show-icon style="margin-bottom: 12px;"
      :title="$t('assetEditDialog.new_assets_start_as_drafts_manager')" />
    <el-form ref="formRef" :model="form" label-width="96px">
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item :label="$t('common.name')" required>
            <el-input v-model="form.name" maxlength="100" :placeholder="$t('assetEditDialog.e_g_courier_price_comparison')" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$t('assetEditDialog.slug')" required>
            <el-input v-model="form.slug" maxlength="80" :placeholder="$t('assetEditDialog.kebab_case_e_g_express_quote')" :disabled="!!asset && !can('asset.manage')" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item :label="$t('assetEditDialog.one_liner')" required>
        <el-input v-model="form.summary" maxlength="300" show-word-limit :placeholder="$t('assetEditDialog.what_problem_it_solves_why_other')" />
      </el-form-item>
      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item :label="$t('assetEditDialog.layer')" required>
            <el-select v-model="form.layer" style="width: 100%">
              <el-option v-for="(label, k) in meta.layers" :key="k" :label="label" :value="k" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item :label="$t('common.maturity')">
            <el-select v-model="form.maturity" style="width: 100%">
              <el-option v-for="(label, k) in meta.maturities" :key="k" :label="`${k} ${label}`" :value="k" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item :label="$t('common.license')">
            <el-select v-model="form.authorization" style="width: 100%">
              <el-option :label="$t('common.reference_only_customer_code')" value="RESTRICTED" />
              <el-option :label="$t('common.in_house')" value="INTERNAL" />
              <el-option :label="$t('common.customer_approved_reuse')" value="CLIENT_CLEARED" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-alert v-if="['L2', 'L3'].includes(form.maturity) && form.authorization === 'RESTRICTED'" type="error" :closable="false" show-icon
        style="margin: -6px 0 12px 96px; width: auto;" :title="$t('assetEditDialog.reference_only_customer_code_cant_be')" />
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item :label="$t('common.trigger_words')">
            <el-select v-model="form.keywords" multiple filterable allow-create default-first-option style="width: 100%"
              :placeholder="$t('assetEditDialog.recommend_this_asset_when_task_mentions')" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$t('common.tech_stack')">
            <el-select v-model="form.techStack" multiple filterable allow-create default-first-option style="width: 100%" placeholder="vue3 / express / java …">
              <el-option v-for="t in meta.techStacks" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item :label="$t('common.industry')">
            <el-select v-model="form.industries" multiple filterable allow-create default-first-option style="width: 100%" :placeholder="$t('assetEditDialog.manufacturing_education_general')">
              <el-option v-for="i in meta.industries" :key="i" :label="i" :value="i" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$t('assetEditDialog.estimated_savings')">
            <el-input-number v-model="form.estSavedDays" :min="0" :max="999" :step="0.5" :precision="1" style="width: 140px" />
            <span class="muted" style="margin-left: 8px;">{{ $t('assetEditDialog.person_days_per_reuse') }}</span>
          </el-form-item>
        </el-col>
      </el-row>

      <div class="section">{{ $t('assetEditDialog.origin_internal_only_dont_put_customer') }}</div>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item :label="$t('common.source_project')">
            <el-select v-model="form.sourceProjectId" filterable remote clearable :remote-method="searchProjects" :loading="projectLoading"
              style="width: 100%" :placeholder="$t('common.search_project_name_or_code')">
              <el-option v-for="p in projectOptions" :key="p.id" :label="`${p.name} (${p.code})`" :value="String(p.id)" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item :label="$t('common.source_repository')">
            <el-input v-model="form.sourceRepo" :placeholder="$t('assetEditDialog.repository_url_or_local_path')" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item :label="$t('common.key_files')">
        <el-input v-model="form.sourcePathsText" type="textarea" :rows="2" :placeholder="$t('assetEditDialog.one_per_line_e_g_src')" />
      </el-form-item>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item :label="$t('common.asset_directory')">
            <el-input v-model="form.assetRepoPath" :placeholder="$t('assetEditDialog.l2_directory_in_asset_repository_e')" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="Demo">
            <el-input v-model="form.demoUrl" :placeholder="$t('assetEditDialog.https_optional')" />
          </el-form-item>
        </el-col>
      </el-row>

      <div class="section">{{ $t('assetEditDialog.write_up_data') }}</div>
      <el-form-item :label="$t('common.write_up')">
        <el-tabs v-model="readmeTab" class="md-tabs">
          <el-tab-pane :label="$t('common.edit')" name="edit">
            <el-input v-model="form.readme" type="textarea" :rows="12" class="mono"
              :placeholder="$t('assetEditDialog.markdown_problem_when_use_setup_pitfalls')" />
          </el-tab-pane>
          <el-tab-pane :label="$t('common.preview')" name="preview">
            <div class="md-preview markdown-body" v-html="renderSafeMarkdown(form.readme)" />
          </el-tab-pane>
        </el-tabs>
      </el-form-item>
      <el-form-item :label="$t('assetEditDialog.ontology_json')">
        <el-input v-model="form.ontologyText" type="textarea" :rows="6" class="mono"
          :placeholder='$t("assetEditDialog.objects_name_order_label_order_properties")' />
        <div v-if="ontologyError" class="err">{{ ontologyError }}</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ $t('common.p0', { p0: asset ? $t('common.save') : $t('common.register') }) }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'

const props = defineProps({
  modelValue: Boolean,
  asset: { type: Object, default: null },
  preset: { type: Object, default: null },   // 新建时预填（如从项目页登记: { sourceProject }）
  meta: { type: Object, default: () => ({ layers: {}, maturities: {}, industries: [], techStacks: [] }) }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const form = reactive({})
const saving = ref(false)
const readmeTab = ref('edit')
const projectOptions = ref([])
const projectLoading = ref(false)

function init() {
  const a = props.asset || (props.preset?.sourceProject ? { sourceProjectId: props.preset.sourceProject.id, sourceProject: props.preset.sourceProject } : {})
  Object.assign(form, {
    name: a.name || '', slug: a.slug || '', summary: a.summary || '',
    layer: a.layer || 'BIZ', maturity: a.maturity || 'L0', authorization: a.authorization || 'RESTRICTED',
    keywords: [...(a.keywords || [])], techStack: [...(a.techStack || [])], industries: [...(a.industries || [])],
    estSavedDays: a.estSavedDays != null ? Number(a.estSavedDays) : null,
    sourceProjectId: a.sourceProjectId ? String(a.sourceProjectId) : '',
    sourceRepo: a.sourceRepo || '', sourcePathsText: (a.sourcePaths || []).join('\n'),
    assetRepoPath: a.assetRepoPath || '', demoUrl: a.demoUrl || '',
    readme: a.readme || '', ontologyText: a.ontology ? JSON.stringify(stripShared(a.ontology), null, 2) : ''
  })
  projectOptions.value = a.sourceProject ? [a.sourceProject] : []
  readmeTab.value = 'edit'
}
// 同步脚本会把共享对象定义内联进 sharedObjects 方便展示，编辑时不要带回去
function stripShared(o) { const { sharedObjects, ...rest } = o || {}; return rest }

const ontologyError = computed(() => {
  if (!form.ontologyText?.trim()) return ''
  try {
    const o = JSON.parse(form.ontologyText)
    return o && typeof o === 'object' && !Array.isArray(o) ? '' : $t('assetEditDialog.must_be_object_objects_links_actions')
  } catch (e) { return $t('assetEditDialog.invalid_json', { p0: e.message }) }
})

async function searchProjects(kw) {
  projectLoading.value = true
  try {
    const data = await fde.projects.list({ keyword: kw || '', page_size: 20 })
    projectOptions.value = data?.list || []
  } finally { projectLoading.value = false }
}

async function save() {
  if (!form.name.trim() || !form.summary.trim() || !form.slug.trim()) return ElMessage.warning($t('assetEditDialog.name_slug_one_liner_required'))
  if (ontologyError.value) return ElMessage.warning($t('assetEditDialog.ontology_json_invalid'))
  saving.value = true
  try {
    const body = {
      name: form.name, slug: form.slug, summary: form.summary, layer: form.layer, maturity: form.maturity,
      authorization: form.authorization, keywords: form.keywords, techStack: form.techStack, industries: form.industries,
      estSavedDays: form.estSavedDays ?? '', sourceProjectId: form.sourceProjectId || '',
      sourceRepo: form.sourceRepo, sourcePaths: form.sourcePathsText.split('\n').map(s => s.trim()).filter(Boolean),
      assetRepoPath: form.assetRepoPath, demoUrl: form.demoUrl, readme: form.readme,
      ontology: form.ontologyText.trim() ? form.ontologyText : null
    }
    const saved = props.asset ? await fde.assets.update(props.asset.id, body) : await fde.assets.create(body)
    ElMessage.success(props.asset ? $t('common.saved') : $t('assetEditDialog.registered_as_draft_everyone_can_see'))
    emit('update:modelValue', false)
    emit('saved', saved)
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally { saving.value = false }
}
</script>

<style scoped>
.section { font-size: 12px; font-weight: 600; color: var(--el-text-color-secondary); margin: 6px 0 10px; padding-top: 8px; border-top: 1px dashed var(--el-border-color-lighter); }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.mono :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.md-tabs { width: 100%; }
.md-preview { max-height: 320px; overflow: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; padding: 8px 14px; font-size: 13px; }
.err { color: var(--el-color-danger); font-size: 12px; margin-top: 4px; }
</style>
