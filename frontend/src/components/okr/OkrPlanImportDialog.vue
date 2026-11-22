<template>
  <!-- OKR 7.0 批量导入: 粘贴 Markdown → 「预览」(mode=preview, 不落库)看解析出的 O/KR 树 + 未识别行 + 截断提示 →「导入」(mode=apply, 写草稿) -->
  <el-dialog
    :model-value="modelValue" :title="$t('okr.plan.bulk_title')" width="min(96vw, 640px)" append-to-body class="okr-imp-dialog"
    @update:model-value="v => $emit('update:modelValue', v)"
  >
    <div class="okr-imp" data-test="okr-imp">
      <details class="okr-imp-help">
        <summary>{{ $t('okr.plan.bulk_help_title') }}</summary>
        <pre class="okr-imp-sample">{{ $t('okr.plan.bulk_help_sample') }}</pre>
        <p>{{ $t('okr.plan.bulk_help_rules', { p0: limits.maxObjectives, p1: limits.maxKrsPerObjective }) }}</p>
      </details>
      <el-input
        v-model="text" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" :placeholder="$t('okr.plan.bulk_ph')"
        data-test="okr-imp-text" @input="preview = null"
      />

      <section v-if="preview" class="okr-imp-preview" data-test="okr-imp-preview">
        <p class="okr-imp-sum">{{ $t('okr.plan.bulk_summary', { p0: preview.objectives.length, p1: krTotal }) }}</p>
        <p v-if="preview.submitted" class="okr-imp-warn" role="alert" data-test="okr-imp-submitted">{{ $t('okr.plan.bulk_submitted') }}</p>
        <p v-if="preview.truncated" class="okr-imp-warn" data-test="okr-imp-truncated">{{ $t('okr.plan.bulk_truncated', { p0: limits.maxObjectives, p1: limits.maxKrsPerObjective }) }}</p>
        <ol class="okr-imp-tree">
          <li v-for="(o, i) in preview.objectives" :key="i" class="okr-imp-o" :data-test="'okr-imp-o-' + i">
            <div class="okr-imp-o-head"><b>O{{ i + 1 }}</b> {{ o.title }} <span class="okr-imp-w">{{ round(o.weight) }}%</span></div>
            <ul>
              <li v-for="(k, j) in o.keyResults" :key="j" class="okr-imp-kr">
                <span class="okr-imp-kr-no">KR{{ j + 1 }}</span>
                <span class="okr-imp-kr-title">{{ k.title }}</span>
                <span class="okr-imp-kr-meta">{{ previewKrMeta(k, $t) }}</span>
              </li>
            </ul>
          </li>
        </ol>
        <div v-if="preview.skipped?.length" class="okr-imp-skip" data-test="okr-imp-skipped">
          <b>{{ $t('okr.plan.bulk_skipped', { p0: preview.skipped.length }) }}</b>
          <ul><li v-for="(s, i) in preview.skipped" :key="i">{{ s.title }}：{{ s.reason }}</li></ul>
        </div>
        <div v-if="preview.unparsed?.length" class="okr-imp-unparsed" data-test="okr-imp-unparsed">
          <b>{{ $t('okr.plan.bulk_unparsed', { p0: preview.unparsed.length }) }}</b>
          <ul><li v-for="u in preview.unparsed" :key="u.line"><code>L{{ u.line }}</code> {{ u.text }}</li></ul>
        </div>
      </section>
    </div>
    <template #footer>
      <div class="okr-imp-foot">
        <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
        <el-button :disabled="!text.trim()" :loading="busy === 'preview'" data-test="okr-imp-preview-btn" @click="run('preview')">{{ $t('okr.plan.bulk_preview') }}</el-button>
        <el-button
          type="primary" :disabled="!canApply" :loading="busy === 'apply'" data-test="okr-imp-apply" @click="run('apply')"
        >{{ $t('okr.plan.bulk_apply') }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { previewKrMeta } from '@/views/okr/okrFe4.js'

const props = defineProps({
  modelValue: Boolean,
  week: { type: String, required: true },
  targetUserId: { type: String, default: '' },
  /** 打开时预填的文字(模板「使用」带进来) */
  initialText: { type: String, default: '' },
  /** 导入前的确认(编辑器有没保存的改动时由页面问一句); 返回 false 不导入 */
  beforeApply: { type: Function, default: null }
})
const emit = defineEmits(['update:modelValue', 'imported'])

const text = ref('')
const preview = ref(null)
const busy = ref('')
const limits = ref({ maxObjectives: 3, maxKrsPerObjective: 6 })

watch(() => props.modelValue, (v) => {
  if (!v) return
  text.value = props.initialText || ''
  preview.value = null
})

const krTotal = computed(() => (preview.value?.objectives || []).reduce((s, o) => s + o.keyResults.length, 0))
/** 导入: 有字, 且(没预览过, 或预览出了 O 且目标周没提交) */
const canApply = computed(() => !!text.value.trim() && (!preview.value || (preview.value.objectives.length > 0 && !preview.value.submitted)))
const round = n => Math.round(Number(n) * 100) / 100

async function run(mode) {
  if (mode === 'apply' && props.beforeApply && !(await props.beforeApply())) return
  busy.value = mode
  try {
    const r = await fde.okr.bulkImport({ week: props.week, text: text.value, mode }, props.targetUserId || undefined)
    if (r.limits) limits.value = r.limits
    if (mode === 'preview') {
      preview.value = r
      return
    }
    emit('imported', r)
  } catch (e) {
    // 8172 一个 O 都建不了: 后端带回未识别行 / 跳过明细, 直接展示在预览里
    if (e.code === 8172 && e.data?.data) preview.value = { objectives: [], truncated: false, submitted: false, ...e.data.data }
    ElMessage.error({ message: e.message, duration: 6000 })
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.okr-imp { display: flex; flex-direction: column; gap: 10px; }
.okr-imp-help { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-imp-help summary { cursor: pointer; color: var(--el-color-primary); min-height: 32px; display: flex; align-items: center; }
.okr-imp-help p { margin: 4px 0 0; }
.okr-imp-sample { margin: 4px 0 0; padding: 8px 10px; border-radius: 6px; background: var(--el-fill-color-light); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.okr-imp-preview { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.okr-imp-sum { margin: 0; font-weight: 600; font-size: 13px; }
.okr-imp-warn { margin: 0; padding: 6px 10px; border-radius: 6px; font-size: 12px; background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.okr-imp-tree { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.okr-imp-o-head { font-size: 13px; overflow-wrap: anywhere; }
.okr-imp-o-head b { color: var(--el-color-primary); margin-right: 4px; }
.okr-imp-w { color: var(--el-text-color-secondary); font-size: 12px; margin-left: 4px; }
.okr-imp-o ul { list-style: none; margin: 4px 0 0; padding: 0 0 0 14px; display: flex; flex-direction: column; gap: 2px; }
.okr-imp-kr { display: flex; gap: 6px; font-size: 12px; align-items: baseline; }
.okr-imp-kr-no { color: var(--el-text-color-secondary); flex: none; }
.okr-imp-kr-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.okr-imp-kr-meta { flex: none; color: var(--el-text-color-secondary); }
.okr-imp-skip, .okr-imp-unparsed { font-size: 12px; }
.okr-imp-skip ul, .okr-imp-unparsed ul { margin: 4px 0 0; padding-left: 18px; }
.okr-imp-skip { color: var(--el-color-warning-dark-2); }
.okr-imp-unparsed { color: var(--el-color-danger); }
.okr-imp-unparsed li { overflow-wrap: anywhere; }
.okr-imp-unparsed code { font-size: 11px; margin-right: 4px; }
.okr-imp-foot { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.okr-imp-foot .el-button { margin-left: 0; }
@media (max-width: 640px) {
  .okr-imp-foot .el-button { min-height: 44px; flex: 1 1 0; }
}
</style>
