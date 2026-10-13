<template>
  <!-- v2.8.0(#1145) 规划 Tab 里的 AI 面板(不是通用聊天): 生成草案→幽灵预览→应用 / 补依赖 / 解释路径 -->
  <el-drawer :model-value="modelValue" :title="$t('roadmapAiPanel.ai_roadmap_assistant')" size="520px" :close-on-click-modal="false" append-to-body @update:model-value="v => $emit('update:modelValue', v)" @closed="onClosed">
    <el-alert v-if="llmMissing" type="warning" :closable="false" show-icon style="margin-bottom: 12px;">
      <template #title>{{ $t('roadmapAiPanel.no_llm_available_yet') }}</template>
      {{ $t('roadmapAiPanel.ask_admin_add_enable_llm_under') }}
    </el-alert>
    <el-tabs v-model="tab">
      <!-- ================= 生成 ================= -->
      <el-tab-pane :label="$t('roadmapAiPanel.generate_roadmap')" name="generate">
        <div class="ai-field">
          <label>{{ $t('roadmapAiPanel.target_milestone') }}</label>
          <el-select v-model="targetMilestoneId" clearable :placeholder="$t('roadmapAiPanel.none_selected_let_ai_organize_milestones')" style="width: 100%;">
            <el-option v-for="m in milestones.filter(x => x.status !== 'COMPLETED')" :key="m.id" :value="String(m.id)" :label="m.name" />
          </el-select>
        </div>
        <div class="ai-field">
          <label>{{ $t('roadmapAiPanel.goal_requirements_existing_milestones_tasks_incl') }}</label>
          <el-input v-model="requirement" type="textarea" :rows="7" maxlength="30000" show-word-limit :placeholder="$t('roadmapAiPanel.e_g_this_milestone_ships_customer')" />
        </div>
        <div class="ai-actions">
          <el-button type="primary" :loading="generating" :disabled="requirement.trim().length < 20" @click="generate">{{ $t('common.p0', { p0: draft ? $t('roadmapAiPanel.regenerate') : $t('roadmapAiPanel.generate_draft') }) }}</el-button>
          <span v-if="requirement.trim().length && requirement.trim().length < 20" class="ai-hint">{{ $t('roadmapAiPanel.at_least_20_characters') }}</span>
        </div>

        <template v-if="draft">
          <el-divider content-position="left">{{ $t('roadmapAiPanel.draft_editable_not_saved_yet') }}</el-divider>
          <p class="ai-summary">{{ draft.summary }}</p>
          <el-alert v-if="draft.openQuestions?.length" type="info" :closable="false" style="margin-bottom: 10px;">
            <template #title>{{ $t('roadmapAiPanel.where_ai_unsure') }}</template>
            <ul class="ai-q"><li v-for="q in draft.openQuestions" :key="q">{{ q }}</li></ul>
          </el-alert>
          <div v-for="(m, mi) in draft.milestones" :key="mi" class="ai-ms">
            <div class="ai-ms-head">
              <span v-if="targetMilestoneId">{{ $t('roadmapAiPanel.attach', { p0: milestoneName(targetMilestoneId) }) }}</span>
              <template v-else>🏁 <el-input v-model="m.name" size="small" style="width: 220px;" /> <span class="ai-hint">{{ $t('roadmapAiPanel.reuse_milestone_with_same_name_if') }}</span></template>
            </div>
            <div v-for="(t, ti) in m.tasks" :key="ti" class="ai-task">
              <div class="ai-task-row">
                <el-input v-model="t.title" size="small" @change="renameDeps(m, ti, $event)" />
                <el-select v-model="t.role" size="small" style="width: 110px;"><el-option v-for="r in ROLES" :key="r" :value="r" :label="r" /></el-select>
                <el-select v-model="t.priority" size="small" style="width: 84px;" :placeholder="$t('common.medium')"><el-option v-for="p in ['LOW','MEDIUM','HIGH','URGENT']" :key="p" :value="p" :label="PRIORITY_LABELS[p]" /></el-select>
                <el-button link type="danger" size="small" @click="removeTask(m, ti)">{{ $t('common.delete') }}</el-button>
              </div>
              <div class="ai-task-sub">
                <span v-if="t.dependencies?.length">← {{ t.dependencies.join($t('common.list_sep')) }}</span>
                <span v-else class="ai-hint">{{ $t('roadmapAiPanel.entry_tasks') }}</span>
                <span v-if="t.estimateDays" class="ai-hint"> {{ $t('roadmapAiPanel.about_days', { p0: t.estimateDays }) }}</span>
              </div>
            </div>
            <el-empty v-if="!m.tasks.length" :description="$t('roadmapAiPanel.all_tasks_were_removed')" :image-size="40" />
          </div>
          <div class="ai-actions">
            <el-checkbox v-model="previewOn" @change="emitPreview">{{ $t('roadmapAiPanel.overlay_on_canvas') }}</el-checkbox>
            <el-button type="primary" :loading="applying" :disabled="!taskCount" @click="apply">{{ $t('roadmapAiPanel.apply_project_tasks', { p0: taskCount }) }}</el-button>
            <el-button @click="discard">{{ $t('roadmapAiPanel.discard') }}</el-button>
          </div>
        </template>
      </el-tab-pane>

      <!-- ================= 补依赖 ================= -->
      <el-tab-pane :label="$t('roadmapAiPanel.add_dependencies')" name="suggest">
        <p class="ai-desc">{{ $t('roadmapAiPanel.let_ai_review_tasks_in_suggest', { p0: milestoneId && milestoneId !== 'none' ? `"${milestoneName(milestoneId)}"` : $t('roadmapAiPanel.current_view') }) }}</p>
        <el-button type="primary" :loading="suggesting" @click="suggest">{{ $t('roadmapAiPanel.find_missing_dependencies') }}</el-button>
        <template v-if="suggestions">
          <el-empty v-if="!suggestions.length" :description="$t('roadmapAiPanel.ai_found_no_missing_dependencies')" :image-size="60" />
          <div v-for="s in suggestions" :key="s.predecessorId + '>' + s.successorId" class="ai-sug">
            <el-checkbox v-model="s.checked">
              <b>#{{ s.predecessorId }} {{ s.predecessorTitle }}</b> → <b>#{{ s.successorId }} {{ s.successorTitle }}</b>
            </el-checkbox>
            <div class="ai-sug-reason">{{ s.reason }}</div>
          </div>
          <div v-if="suggestions.length" class="ai-actions">
            <el-button type="primary" :loading="applying" :disabled="!suggestions.some(s => s.checked)" @click="applySuggestions">{{ $t('roadmapAiPanel.create_selected_dependencies', { p0: suggestions.filter(s => s.checked).length }) }}</el-button>
          </div>
          <details v-if="rejected.length" class="ai-rejected"><summary>{{ $t('roadmapAiPanel.suggestions_filtered_out', { p0: rejected.length }) }}</summary><div v-for="r in rejected" :key="r.predecessorId + r.successorId">#{{ r.predecessorId }} → #{{ r.successorId }}: {{ r.why }}</div></details>
        </template>
      </el-tab-pane>

      <!-- ================= 解释 ================= -->
      <el-tab-pane :label="$t('roadmapAiPanel.explain_path')" name="explain">
        <p class="ai-desc">{{ $t('roadmapAiPanel.in_plain_words_what_can_start') }}</p>
        <el-button type="primary" :loading="explaining" @click="explain">{{ $t('common.p0', { p0: explanation ? $t('roadmapAiPanel.explain_again') : $t('roadmapAiPanel.explain_current_path') }) }}</el-button>
        <div v-if="explanation" class="ai-explain">{{ explanation }}</div>
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde } from '@/api/index.js'
import { PRIORITY_LABELS } from './roadmapUtils.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  projectId: { type: [Number, String], required: true },
  milestoneId: { type: String, default: '' },       // 当前视图选中的里程碑('' 全部 / 'none' / id)
  milestones: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'preview', 'applied'])

const ROLES = ['PM', 'ARCHITECT', 'DEV', 'QA', 'FDE']
const tab = ref('generate')
const targetMilestoneId = ref('')
watch(() => [props.modelValue, props.milestoneId], ([open]) => { if (open) targetMilestoneId.value = props.milestoneId && props.milestoneId !== 'none' ? String(props.milestoneId) : '' }, { immediate: true })
const requirement = ref('')
const draft = ref(null)
const generating = ref(false), applying = ref(false), suggesting = ref(false), explaining = ref(false)
const llmMissing = ref(false)
const previewOn = ref(true)
const suggestions = ref(null), rejected = ref([])
const explanation = ref('')

const taskCount = computed(() => (draft.value?.milestones || []).reduce((n, m) => n + m.tasks.length, 0))
function milestoneName(id) { return props.milestones.find(m => String(m.id) === String(id))?.name || '' }

function handleErr(e, fallback) {
  if (e?.status === 503 || /尚未配置可用的大模型/.test(e?.message || '')) { llmMissing.value = true; return }
  ElMessage({ type: 'error', message: e?.message || fallback, duration: 6000, showClose: true })
}

async function generate() {
  generating.value = true; llmMissing.value = false
  try {
    const d = await fde.decomposition.generate({ requirement: requirement.value.trim(), projectId: props.projectId, milestoneId: targetMilestoneId.value || undefined })
    // 目标里程碑模式: 草案只保留一个里程碑容器(名字无所谓, 落库时全部挂到目标)
    if (targetMilestoneId.value && d.milestones.length > 1) d.milestones = [{ name: d.milestones[0].name, tasks: d.milestones.flatMap(m => m.tasks) }]
    for (const m of d.milestones) for (const t of m.tasks) { t.dependencies ||= []; t.priority ||= 'MEDIUM' }
    draft.value = d
    previewOn.value = true
    emitPreview()
    ElMessage.success($t('roadmapAiPanel.drafted_tasks_please_review', { p0: d.taskCount }))
  } catch (e) { handleErr(e, $t('common.generation_failed')) }
  finally { generating.value = false }
}
function cleanDraft() {
  const d = draft.value
  return {
    summary: d.summary, openQuestions: d.openQuestions || [],
    milestones: d.milestones.filter(m => m.tasks.length).map(m => ({
      name: m.name, ...(m.goal ? { goal: m.goal } : {}),
      tasks: m.tasks.map(t => ({
        title: t.title.trim(), role: t.role, acceptanceCriteria: t.acceptanceCriteria || [], dependencies: (t.dependencies || []).filter(Boolean),
        ...(t.description ? { description: t.description } : {}), ...(t.priority ? { priority: t.priority } : {}), ...(t.estimateDays ? { estimateDays: t.estimateDays } : {})
      }))
    }))
  }
}
function emitPreview() { emit('preview', previewOn.value && draft.value ? cleanDraft() : null) }
function removeTask(m, ti) {
  const title = m.tasks[ti].title
  m.tasks.splice(ti, 1)
  for (const mm of draft.value.milestones) for (const t of mm.tasks) t.dependencies = (t.dependencies || []).filter(d => d !== title)
  emitPreview()
}
function renameDeps(m, ti, newTitle) {
  // el-input @change 拿到的是新值; 旧值从依赖里找不到就算了(标题唯一性由后端校验)
  emitPreview()
}
async function apply() {
  try {
    await ElMessageBox.confirm($t('roadmapAiPanel.write_tasks_into_project_their_source', { p0: taskCount.value, p1: targetMilestoneId.value ? $t('roadmapAiPanel.attach_2', { p0: milestoneName(targetMilestoneId.value) }) : $t('roadmapAiPanel.with_milestones') }), $t('roadmapAiPanel.apply_draft'), { type: 'warning', confirmButtonText: $t('roadmapAiPanel.apply') })
  } catch { return }
  applying.value = true
  try {
    const r = await fde.decomposition.apply({ projectId: props.projectId, milestoneId: targetMilestoneId.value || undefined, draft: cleanDraft() })
    ElMessage.success($t('roadmapAiPanel.created_tasks_dependencies', { p0: r.tasks.length, p1: r.edgeCount, p2: r.milestones.length ? $t('roadmapAiPanel.milestones', { p0: r.milestones.length }) : '' }))
    if (r.skippedDependencies?.length) ElMessage.warning($t('roadmapAiPanel.dependencies_not_created_prerequisite_not_found', { p0: r.skippedDependencies.length, p1: r.skippedDependencies.join($t('common.list_sep_semi')) }))
    draft.value = null; requirement.value = ''
    emit('preview', null)
    emit('applied', r)
    emit('update:modelValue', false)
  } catch (e) { handleErr(e, $t('roadmapAiPanel.apply_failed')) }
  finally { applying.value = false }
}
function discard() { draft.value = null; emit('preview', null) }
function onClosed() { emit('preview', null) }

async function suggest() {
  suggesting.value = true; llmMissing.value = false
  try {
    const r = await fde.decomposition.suggestDependencies({ projectId: props.projectId, milestoneId: props.milestoneId && props.milestoneId !== '' ? props.milestoneId : undefined })
    suggestions.value = (r.suggestions || []).map(s => ({ ...s, checked: true }))
    rejected.value = r.rejected || []
  } catch (e) { handleErr(e, $t('roadmapAiPanel.analysis_failed')) }
  finally { suggesting.value = false }
}
async function applySuggestions() {
  applying.value = true
  let ok = 0, fail = 0
  for (const s of suggestions.value.filter(x => x.checked)) {
    try { await fde.taskDependencies.add({ predecessorId: s.predecessorId, successorId: s.successorId, note: s.reason?.slice(0, 200) }); ok++ }
    catch (e) { fail++; ElMessage({ type: 'error', message: `#${s.predecessorId}→#${s.successorId}: ${e.message}`, duration: 5000, showClose: true }) }
  }
  applying.value = false
  if (ok) ElMessage.success($t('roadmapAiPanel.created_dependencies', { p0: ok, p1: fail ? $t('common.failed', { p0: fail }) : '' }))
  suggestions.value = null
  emit('applied')
}
async function explain() {
  explaining.value = true; llmMissing.value = false
  try {
    const r = await fde.decomposition.explain({ projectId: props.projectId, milestoneId: props.milestoneId && props.milestoneId !== '' ? props.milestoneId : undefined })
    explanation.value = r.text
  } catch (e) { handleErr(e, $t('roadmapAiPanel.explanation_failed')) }
  finally { explaining.value = false }
}
</script>

<style scoped>
.ai-field { margin-bottom: 12px; }
.ai-field label { display: block; font-size: 12px; color: #78716c; margin-bottom: 4px; }
.ai-actions { display: flex; align-items: center; gap: 10px; margin: 12px 0; flex-wrap: wrap; }
.ai-hint { font-size: 12px; color: #a8a29e; }
.ai-desc { font-size: 13px; color: #57534e; line-height: 1.6; margin: 0 0 12px; }
.ai-summary { font-size: 13px; color: #1c1917; line-height: 1.6; background: #fafaf9; border-radius: 8px; padding: 8px 10px; margin: 0 0 10px; }
.ai-q { margin: 4px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.6; }
.ai-ms { border: 1px solid #eae7e2; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
.ai-ms-head { font-size: 13px; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ai-task { padding: 6px 0; border-top: 1px dashed #f5f5f4; }
.ai-task-row { display: flex; gap: 6px; align-items: center; }
.ai-task-sub { font-size: 12px; color: #78716c; margin-top: 3px; padding-left: 2px; }
.ai-sug { padding: 8px 0; border-bottom: 1px dashed #eae7e2; font-size: 13px; }
.ai-sug-reason { font-size: 12px; color: #78716c; padding-left: 24px; margin-top: 2px; }
.ai-rejected { font-size: 12px; color: #a8a29e; margin-top: 10px; line-height: 1.7; }
.ai-explain { margin-top: 14px; font-size: 14px; line-height: 1.8; color: #1c1917; background: #fffbeb; border: 1px dashed #f5deb3; border-radius: 10px; padding: 12px 14px; white-space: pre-wrap; }
</style>
