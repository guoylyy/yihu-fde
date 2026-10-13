<template>
  <!-- v2.10.0(#1180) 想法 → 项目里程碑: 选项目, 新建里程碑(可让 AI 起草)或并入已有里程碑 -->
  <el-dialog :model-value="modelValue" :title="$t('ideaConvertDialog.convert_milestone')" width="640px" :close-on-click-modal="false" @update:model-value="v => $emit('update:modelValue', v)">
    <p class="lead">{{ $t('ideaConvertDialog.assign_project_as_milestone_then_break', { p0: idea?.title }) }}</p>
    <el-alert v-if="llmMissing" type="warning" :closable="false" show-icon style="margin-bottom: 12px;"
      :title="$t('ideaConvertDialog.no_llm_available_ask_admin_add')" />
    <el-form label-width="96px">
      <el-form-item :label="$t('common.project')" required>
        <el-select v-model="form.projectId" filterable remote :remote-method="searchProjects" :loading="projectLoading"
          :placeholder="$t('ideaConvertDialog.search_project_name_or_code')" style="width: 100%;" @change="onProjectChange">
          <el-option v-for="p in projects" :key="p.id" :label="`${p.code} ${p.name}`" :value="String(p.id)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('ideaConvertDialog.destination')">
        <el-radio-group v-model="mode">
          <el-radio-button value="new">{{ $t('ideaConvertDialog.new_milestone') }}</el-radio-button>
          <el-radio-button value="merge" :disabled="!form.projectId">{{ $t('ideaConvertDialog.merge_into_existing_milestone') }}</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <template v-if="mode === 'new'">
        <el-form-item :label="$t('ideaConvertDialog.milestone_name')" required>
          <div class="row">
            <el-input v-model="form.name" maxlength="200" />
            <el-button :loading="drafting" @click="aiDraft">{{ $t('ideaConvertDialog.ai_draft') }}</el-button>
          </div>
        </el-form-item>
        <el-form-item :label="$t('common.definition_done')">
          <el-input v-model="form.goal" type="textarea" :rows="2" maxlength="2000" :placeholder="$t('ideaConvertDialog.one_sentence_what_counts_as_done')" />
        </el-form-item>
        <el-form-item :label="$t('ideaConvertDialog.scope')">
          <el-input v-model="form.description" type="textarea" :rows="6" :placeholder="$t('ideaConvertDialog.background_scope_out_scope_leave_empty')" />
        </el-form-item>
        <el-form-item :label="$t('ideaConvertDialog.planned_completion')">
          <el-date-picker v-model="form.plannedDate" type="date" value-format="YYYY-MM-DD" :placeholder="$t('ideaConvertDialog.can_be_decided_later')" style="width: 200px;" />
        </el-form-item>
        <el-alert v-if="openQuestions.length" type="info" :closable="false" style="margin-bottom: 4px;">
          <template #title>{{ $t('ideaConvertDialog.ai_reminder_clarify_these_before_starting') }}</template>
          <ul class="q"><li v-for="q in openQuestions" :key="q">{{ q }}</li></ul>
        </el-alert>
      </template>

      <el-form-item v-else :label="$t('common.milestone_2')" required>
        <el-select v-model="form.milestoneId" :placeholder="$t('ideaConvertDialog.choose_existing_milestone')" style="width: 100%;" :loading="milestoneLoading">
          <el-option v-for="m in milestones" :key="m.id" :label="m.name" :value="String(m.id)" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="submit">{{ $t('ideaConvertDialog.convert') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  idea: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'converted'])

const mode = ref('new')
const form = reactive({ projectId: '', milestoneId: '', name: '', goal: '', description: '', plannedDate: '' })
const projects = ref([])
const milestones = ref([])
const openQuestions = ref([])
const projectLoading = ref(false)
const milestoneLoading = ref(false)
const drafting = ref(false)
const saving = ref(false)
const llmMissing = ref(false)

watch(() => props.modelValue, open => {
  if (!open) return
  mode.value = 'new'
  Object.assign(form, { projectId: '', milestoneId: '', name: props.idea?.title || '', goal: '', description: '', plannedDate: '' })
  openQuestions.value = []
  milestones.value = []
  llmMissing.value = false
  searchProjects('')
})

async function searchProjects(keyword) {
  projectLoading.value = true
  try {
    // 空筛选传空串(URLSearchParams 会把 undefined 变成字面量 "undefined")
    const data = await fde.projects.list({ page: 1, page_size: 50, keyword: keyword || '' })
    projects.value = data.list || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    projectLoading.value = false
  }
}

async function onProjectChange() {
  form.milestoneId = ''
  milestones.value = []
  if (!form.projectId) return
  milestoneLoading.value = true
  try {
    const data = await fde.projects.milestones(form.projectId)
    milestones.value = (data.list || data || []).filter(m => m.status !== 'COMPLETED')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    milestoneLoading.value = false
  }
}

async function aiDraft() {
  drafting.value = true
  llmMissing.value = false
  try {
    const d = await fde.ideas.aiMilestoneDraft(props.idea.id, form.projectId ? { projectId: form.projectId } : {})
    form.name = d.name
    form.goal = d.goal
    form.description = d.description
    openQuestions.value = d.openQuestions || []
    ElMessage.success($t('ideaConvertDialog.draft_filled_in_review_it_before'))
  } catch (e) {
    if (e.code === 4101) llmMissing.value = true
    else ElMessage.error(e.message || $t('ideaConvertDialog.ai_drafting_failed'))
  } finally {
    drafting.value = false
  }
}

async function submit() {
  if (!form.projectId) return ElMessage.warning($t('common.choose_project_2'))
  if (mode.value === 'merge' && !form.milestoneId) return ElMessage.warning($t('ideaConvertDialog.choose_milestone_merge_into'))
  if (mode.value === 'new' && !form.name.trim()) return ElMessage.warning($t('ideaConvertDialog.milestone_name_required'))
  saving.value = true
  try {
    const payload = mode.value === 'merge'
      ? { projectId: form.projectId, milestoneId: form.milestoneId }
      : {
          projectId: form.projectId,
          name: form.name.trim(),
          goal: form.goal.trim() || undefined,
          description: form.description.trim() || undefined,
          plannedDate: form.plannedDate || undefined
        }
    const result = await fde.ideas.convert(props.idea.id, payload)
    ElMessage.success(result.created ? $t('ideaConvertDialog.converted_milestone') : $t('ideaConvertDialog.merged_into_milestone'))
    emit('update:modelValue', false)
    emit('converted', result)
  } catch (e) {
    ElMessage.error(e.message || $t('ideaConvertDialog.conversion_failed'))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.lead { margin: 0 0 14px; color: #5c574f; font-size: 13px; line-height: 1.6; }
.row { display: flex; gap: 8px; width: 100%; }
.q { margin: 4px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.7; }
</style>
