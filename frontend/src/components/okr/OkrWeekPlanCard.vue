<template>
  <!-- 精简第二轮: 周 OKR 页头周切换下面的「本周项目计划」(一周一份, 整体, 不分项目)。
       全员可读; ADMIN / MANAGER 能写(以后端 editable 为准, 已结束的周后端给 false)。
       上传 .md/.docx 走 /week-plan/import, 只把正文填进文本框, 点保存才 PUT。渲染复用 utils/safeMarkdown, 不引新依赖 -->
  <section class="wplan" :class="{ collapsed: !open }" data-test="wplan" v-loading="loading">
    <header class="wplan-head">
      <button type="button" class="wplan-toggle" :aria-expanded="open" data-test="wplan-toggle" @click="open = !open">
        <span class="wplan-caret" aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
        <span class="wplan-title" data-test="wplan-title">{{ $t('okr.slim.plan_title', { p0: weekNo }) }}</span>
      </button>
      <span v-if="meta" class="wplan-meta" data-test="wplan-meta">{{ meta }}</span>
      <el-button v-if="open && plan?.editable && filled && !editing" size="small" data-test="wplan-edit" @click="startEdit">{{ $t('okr.slim.plan_edit') }}</el-button>
    </header>

    <div v-if="open" class="wplan-body">
      <!-- 编辑态 -->
      <template v-if="editing">
        <el-input
          v-model="draft" type="textarea" :autosize="{ minRows: 8, maxRows: 24 }" :placeholder="$t('okr.slim.plan_ph')"
          class="wplan-md" data-test="wplan-input"
        />
        <div class="wplan-acts">
          <el-button :loading="uploading" data-test="wplan-upload" @click="fileInput?.click()">{{ $t('okr.slim.plan_upload') }}</el-button>
          <input ref="fileInput" type="file" :accept="DRAFT_FILE_ACCEPT" class="wplan-file" data-test="wplan-file" @change="onFile">
          <span class="wplan-gap" />
          <el-button data-test="wplan-cancel" @click="cancel">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="saving" :disabled="!dirty" data-test="wplan-save" @click="save">{{ $t('common.save') }}</el-button>
        </div>
      </template>
      <!-- 只读 -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-else-if="filled" class="md-body" data-test="wplan-md" v-html="html" />
      <!-- 空态 -->
      <div v-else-if="plan" class="wplan-empty" data-test="wplan-empty">
        <span>{{ $t('okr.slim.plan_empty') }}</span>
        <el-button v-if="plan.editable" type="primary" plain size="small" data-test="wplan-start" @click="startEdit">{{ $t('okr.slim.plan_start') }}</el-button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'
import { parseKey } from '@/views/okr/okrUtils.js'
import { DRAFT_FILE_ACCEPT, draftFileProblem } from '@/views/okr/okrPeople.js'
import { weekPlanMeta, hasPlan, planDirty, planTitleOf } from '@/views/okr/okrSlim.js'

const props = defineProps({
  /** YYYY-Www, 跟着页头周切换 */
  week: { type: String, required: true }
})

const plan = ref(null)
const loading = ref(false)
const open = ref(true)
const editing = ref(false)
const draft = ref('')
const draftTitle = ref('')
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref(null)

const weekNo = computed(() => parseKey(props.week)?.weekNo ?? '')
const filled = computed(() => hasPlan(plan.value))
const html = computed(() => (filled.value ? renderSafeMarkdown(plan.value.contentMd) : ''))
const meta = computed(() => weekPlanMeta(plan.value, $t))
const dirty = computed(() => planDirty(plan.value, draft.value))

let seq = 0
async function load() {
  const my = ++seq
  editing.value = false
  loading.value = true
  try {
    const r = await fde.okr.weekPlan(props.week)
    if (my === seq) plan.value = r
  } catch (e) {
    if (my === seq) plan.value = null
    ElMessage.error(e.message)
  } finally {
    if (my === seq) loading.value = false
  }
}
watch(() => props.week, load, { immediate: true })

function startEdit() {
  draft.value = plan.value?.contentMd || ''
  draftTitle.value = plan.value?.title || ''
  editing.value = true
  open.value = true
}

async function cancel() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm($t('okr.slim.plan_discard'), { type: 'warning', confirmButtonText: $t('common.confirm'), cancelButtonText: $t('common.cancel') })
    } catch { return }
  }
  editing.value = false
}

async function save() {
  saving.value = true
  try {
    plan.value = await fde.okr.saveWeekPlan(props.week, { title: draftTitle.value || undefined, contentMd: draft.value })
    editing.value = false
    ElMessage.success($t('okr.slim.plan_saved'))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

/** 上传只解析出正文填进文本框(不落库), 文本框里有字先确认覆盖 */
async function onFile(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  const bad = draftFileProblem(file)
  if (bad) { ElMessage.warning($t(bad)); return }
  if (draft.value.trim()) {
    try {
      await ElMessageBox.confirm($t('okr.slim.plan_overwrite'), { type: 'warning', confirmButtonText: $t('common.confirm'), cancelButtonText: $t('common.cancel') })
    } catch { return }
  }
  uploading.value = true
  try {
    const r = await fde.okr.importWeekPlan(file)
    draft.value = r.contentMd || ''
    draftTitle.value = planTitleOf(r.contentMd, r.title)
    ElMessage.success($t('okr.slim.plan_imported', { p0: r.fileName || file.name }))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.wplan { margin: 0 0 12px; background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px 14px; }
.wplan-head { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.wplan-toggle { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding: 0; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; color: var(--el-text-color-primary); }
.wplan-caret { flex: none; width: 12px; font-size: 12px; color: var(--el-text-color-secondary); }
.wplan-title { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.wplan-meta { flex: none; font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; }
.wplan-body { margin-top: 8px; }
.wplan-empty { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border-radius: 8px; background: var(--el-fill-color-lighter); font-size: 13px; color: var(--el-text-color-secondary); }
.wplan-md :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.wplan-acts { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.wplan-acts .el-button + .el-button { margin-left: 0; }
.wplan-gap { flex: 1; }
.wplan-file { display: none; }
.md-body { line-height: 1.7; overflow-wrap: anywhere; font-size: 14px; }
.md-body :deep(h1), .md-body :deep(h2), .md-body :deep(h3), .md-body :deep(h4) { margin: 12px 0 6px; font-weight: 700; line-height: 1.4; }
.md-body :deep(h1) { font-size: 18px; }
.md-body :deep(h2) { font-size: 16px; }
.md-body :deep(h3) { font-size: 15px; }
.md-body :deep(> :first-child) { margin-top: 0; }
.md-body :deep(p) { margin: 6px 0; }
.md-body :deep(ul), .md-body :deep(ol) { padding-left: 22px; margin: 6px 0; }
.md-body :deep(li) { margin: 2px 0; }
.md-body :deep(code) { background: var(--el-fill-color); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.md-body :deep(pre) { background: #1c1917; color: #faf9f7; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.md-body :deep(pre code) { background: transparent; color: inherit; padding: 0; }
.md-body :deep(blockquote) { border-left: 3px solid var(--el-border-color); margin: 8px 0; padding: 2px 12px; color: var(--el-text-color-secondary); }
.md-body :deep(.md-table-wrap) { overflow-x: auto; }
.md-body :deep(table) { border-collapse: collapse; margin: 8px 0; }
.md-body :deep(th), .md-body :deep(td) { border: 1px solid var(--el-border-color-lighter); padding: 4px 10px; }
@media (max-width: 768px) {
  .wplan { padding: 10px 12px; }
  .wplan-head { flex-wrap: wrap; }
  .wplan-toggle { min-height: 44px; flex-basis: 100%; }
  .wplan-meta { white-space: normal; }
  .wplan-acts .el-button, .wplan-empty .el-button { min-height: 44px; }
}
</style>
