<template>
  <!-- 贴周报 → O/KR 草稿: 模型优先, 规则兜底。结果可改、可删、可加; 「填入编辑器」只填不提交 -->
  <el-dialog
    :model-value="modelValue" :title="$t('okr.report.title')" width="min(94vw, 640px)" append-to-body
    :close-on-click-modal="false" class="okr-report-dialog"
    @update:model-value="close" @closed="onClosed"
  >
    <!-- 原文: 生成前、生成中都留着; 出结果后收起, 可点「修改原文」回来 -->
    <template v-if="step !== 'result'">
      <p class="okr-rp-hint">{{ $t('okr.report.hint') }}</p>
      <el-input
        v-model="text" type="textarea" :rows="10" :disabled="step === 'loading'"
        :placeholder="$t('okr.report.placeholder')" class="okr-rp-text" data-test="report-text"
      />
      <div class="okr-rp-meta">
        <span :class="{ 'is-short': len > 0 && len < MIN }">{{ $t('okr.report.length', { p0: len, p1: MIN }) }}</span>
      </div>
      <el-alert v-if="error" type="error" :closable="false" show-icon class="okr-rp-alert" :title="error" data-test="report-error" />
      <div v-if="step === 'loading'" class="okr-rp-loading" data-test="report-loading">
        <span class="okr-rp-spin" aria-hidden="true" />
        <span>{{ $t('okr.report.generating', { p0: elapsed }) }}</span>
      </div>
    </template>

    <template v-else>
      <el-alert
        v-if="result.mode === 'rules'" type="warning" :closable="false" show-icon class="okr-rp-alert" data-test="report-rules-banner"
        :title="$t('okr.report.rules_banner')" :description="fallbackText"
      />
      <el-alert v-if="result.truncated" type="info" :closable="false" show-icon class="okr-rp-alert" :title="$t('okr.report.truncated')" data-test="report-truncated" />
      <el-alert v-if="weightTotal !== 100" type="warning" :closable="false" show-icon class="okr-rp-alert" :title="$t('okr.report.weight_off', { p0: weightTotal })" />

      <section v-for="(o, i) in objs" :key="o.k" class="okr-rp-block">
        <div class="okr-rp-orow">
          <span class="okr-rp-seq">O{{ i + 1 }}</span>
          <el-input v-model="o.title" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" maxlength="200" :placeholder="$t('okr.objective_placeholder')" class="okr-rp-otitle" />
          <el-input-number v-model="o.weight" :min="0" :max="100" :controls="false" class="okr-rp-w" :aria-label="$t('okr.report.weight')" @change="weightsTouched = true" />
          <el-button text :aria-label="$t('okr.delete_objective')" @click="removeObj(i)">✕</el-button>
        </div>
        <div v-for="(k, j) in o.keyResults" :key="k.k" class="okr-rp-kr">
          <span class="okr-rp-krno">KR{{ j + 1 }}</span>
          <el-input v-model="k.title" size="small" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" maxlength="200" :placeholder="$t('okr.kr_placeholder')" />
          <span v-if="k.metricType !== 'BINARY'" class="okr-rp-metric">{{ metricText(k) }}</span>
          <el-button text size="small" :aria-label="$t('okr.delete_kr')" @click="removeKr(o, j)">✕</el-button>
        </div>
        <el-button text size="small" type="primary" :disabled="o.keyResults.length >= 10" @click="addKr(o)">+ KR</el-button>
      </section>
      <el-button v-if="objs.length < 3" class="okr-rp-addo" @click="addObj">+ {{ $t('okr.objective') }}</el-button>
    </template>

    <template #footer>
      <template v-if="step === 'input'">
        <el-button @click="close">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!text.trim()" data-test="report-generate" @click="generate">{{ $t('okr.report.generate') }}</el-button>
      </template>
      <template v-else-if="step === 'loading'">
        <el-button data-test="report-cancel" @click="cancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" loading>{{ $t('okr.report.generate') }}</el-button>
      </template>
      <div v-else class="okr-rp-foot">
        <button type="button" class="okr-rp-link" @click="step = 'input'">{{ $t('okr.report.edit_source') }}</button>
        <span class="okr-rp-foot-btns">
          <el-button data-test="report-regenerate" @click="generate">{{ $t('okr.report.regenerate') }}</el-button>
          <el-button type="primary" :disabled="!fillable.length" data-test="report-fill" @click="fill">{{ $t('okr.report.fill') }}</el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { reportLength, weightsByKrCount, equalWeights, draftToEditor } from '@/views/okr/okrUtils.js'

const MIN = 50

defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'fill'])

const step = ref('input') // input → loading → result
const text = ref('')
const error = ref('')
const result = ref({ mode: 'model', fallbackReason: null, truncated: false })
const objs = ref([])
const weightsTouched = ref(false)
const elapsed = ref(0)
let seq = 0
let ctrl = null
let tick = null

const len = computed(() => reportLength(text.value))
const weightTotal = computed(() => Math.round(objs.value.reduce((s, o) => s + Number(o.weight || 0), 0) * 100) / 100)
const fallbackText = computed(() => {
  const r = result.value.fallbackReason
  return r ? $t('okr.report.fallback.' + r) : ''
})
const fillable = computed(() => draftToEditor(objs.value).filter(o => o.title && o.keyResults.length))

function metricText(k) {
  if (k.metricType === 'PERCENT') return `${k.targetValue ?? 100}%`
  return `${k.targetValue ?? '-'}${k.unit || ''}`
}

function stopTimer() {
  clearInterval(tick)
  tick = null
}

async function generate() {
  error.value = ''
  // 太短直接提示, 不调接口(后端同口径再挡一次)
  if (len.value < MIN) {
    error.value = $t('okr.report.too_short')
    step.value = 'input'
    return
  }
  step.value = 'loading'
  elapsed.value = 0
  stopTimer()
  tick = setInterval(() => { elapsed.value++ }, 1000)
  ctrl = new AbortController()
  try {
    const r = await fde.okr.draftFromReport(text.value, { signal: ctrl.signal })
    result.value = { mode: r.mode, fallbackReason: r.fallbackReason, truncated: r.truncated }
    objs.value = r.objectives.map(o => ({
      k: ++seq, title: o.title, description: o.description || '', weight: o.weight,
      keyResults: o.keyResults.map(kr => ({ ...kr, k: ++seq }))
    }))
    weightsTouched.value = false
    step.value = 'result'
  } catch (e) {
    step.value = 'input'
    if (e.code === 'ABORTED') return
    // 8130 太短 / 8131 没识别出目标: 用本地化的话, 原文保留不动
    error.value = e.code === 8130 ? $t('okr.report.too_short') : e.code === 8131 ? $t('okr.report.no_objective') : e.message
  } finally {
    stopTimer()
    ctrl = null
  }
}

function cancel() {
  ctrl?.abort()
}

/** 增删之后: KR 权重均分; O 权重没手改过就按 KR 条数重算 */
function reweigh(o) {
  if (o) {
    const ws = equalWeights(o.keyResults.length)
    o.keyResults.forEach((k, i) => { k.weight = ws[i] })
  }
  if (!weightsTouched.value) {
    const ws = weightsByKrCount(objs.value.map(x => x.keyResults.length))
    objs.value.forEach((x, i) => { x.weight = ws[i] })
  }
}

function addKr(o) {
  o.keyResults.push({ k: ++seq, title: '', metricType: 'BINARY', unit: null, targetValue: null, weight: 0 })
  reweigh(o)
}
function removeKr(o, j) {
  o.keyResults.splice(j, 1)
  reweigh(o)
}
function addObj() {
  objs.value.push({ k: ++seq, title: '', description: '', weight: 0, keyResults: [{ k: ++seq, title: '', metricType: 'BINARY', unit: null, targetValue: null, weight: 100 }] })
  reweigh()
}
function removeObj(i) {
  objs.value.splice(i, 1)
  reweigh()
}

function fill() {
  emit('fill', fillable.value)
}

function close() {
  cancel()
  emit('update:modelValue', false)
}

/** 关掉后清结果; 原文留着, 万一要回来重来 */
function onClosed() {
  step.value = 'input'
  error.value = ''
  objs.value = []
}

onBeforeUnmount(() => { cancel(); stopTimer() })
</script>

<style scoped>
.okr-rp-hint { margin: 0 0 8px; font-size: 13px; color: var(--el-text-color-regular); }
.okr-rp-meta { display: flex; justify-content: flex-end; margin-top: 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-rp-meta .is-short { color: var(--el-color-warning-dark-2); }
.okr-rp-alert { margin: 8px 0; }
.okr-rp-loading { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; color: var(--el-color-primary); }
.okr-rp-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--el-color-primary-light-7); border-top-color: var(--el-color-primary); animation: okr-rp-spin .8s linear infinite; }
@keyframes okr-rp-spin { to { transform: rotate(360deg); } }
.okr-rp-block { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.okr-rp-orow { display: flex; align-items: flex-start; gap: 6px; }
.okr-rp-otitle :deep(textarea) { font-weight: 600; }
.okr-rp-seq { font-size: 12px; font-weight: 600; color: var(--el-color-primary); flex: none; padding-top: 6px; }
.okr-rp-w { width: 64px; flex: none; }
.okr-rp-kr { display: flex; align-items: flex-start; gap: 6px; padding-left: 4px; }
.okr-rp-krno { width: 30px; flex: none; padding-top: 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-rp-metric { flex: none; padding-top: 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-rp-addo { width: 100%; }
.okr-rp-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.okr-rp-foot-btns { display: flex; gap: 8px; margin-left: auto; }
.okr-rp-link { border: 0; background: none; padding: 4px 0; font-size: 13px; color: var(--el-color-primary); cursor: pointer; }
</style>
