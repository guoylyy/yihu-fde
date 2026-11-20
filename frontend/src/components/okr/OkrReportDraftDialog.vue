<template>
  <!-- 贴周报 / 导入文档(.md/.txt/.docx) → O/KR 草稿: 模型优先, 规则兜底。结果可改、可删、可加; 「填入编辑器」只填不提交。
       targetUserId: 主管替员工生成(后端校验代管权限), 草稿仍不落库 -->
  <el-dialog
    :model-value="modelValue" :title="isFile ? $t('okr.import.title') : $t('okr.report.title')" width="min(94vw, 640px)" append-to-body
    :close-on-click-modal="false" class="okr-report-dialog"
    @update:model-value="close" @closed="onClosed"
  >
    <!-- 原文: 生成前、生成中都留着; 出结果后收起, 可点「修改原文」回来 -->
    <p v-if="targetName" class="okr-rp-target" data-test="draft-target">{{ $t('okr.import.for_person', { p0: targetName }) }}</p>
    <template v-if="step !== 'result' && isFile">
      <p class="okr-rp-hint">{{ $t('okr.import.hint') }}</p>
      <label class="okr-rp-file" :class="{ 'is-disabled': step === 'loading' }" data-test="import-file-label">
        <input
          ref="fileEl" type="file" :accept="DRAFT_FILE_ACCEPT" :disabled="step === 'loading'" class="okr-rp-file-input"
          data-test="import-file" @change="onFile"
        >
        <span class="okr-rp-file-btn">{{ file ? $t('okr.import.change_file') : $t('okr.import.choose_file') }}</span>
        <span class="okr-rp-file-name">{{ file ? `${file.name} · ${kb(file.size)}` : $t('okr.import.file_rule') }}</span>
      </label>
      <div class="okr-rp-mode">
        <span>{{ $t('okr.import.mode_label') }}</span>
        <el-radio-group v-model="fillMode" size="small" :disabled="step === 'loading'">
          <el-radio-button value="replace">{{ $t('okr.import.mode_replace') }}</el-radio-button>
          <el-radio-button value="append">{{ $t('okr.import.mode_append') }}</el-radio-button>
        </el-radio-group>
      </div>
      <p class="okr-rp-mode-sub">{{ fillMode === 'append' ? $t('okr.import.mode_append_sub') : $t('okr.import.mode_replace_sub') }}</p>
      <el-alert v-if="error" type="error" :closable="false" show-icon class="okr-rp-alert" :title="error" data-test="report-error" />
      <div v-if="step === 'loading'" class="okr-rp-loading" data-test="report-loading">
        <span class="okr-rp-spin" aria-hidden="true" />
        <span>{{ $t('okr.report.generating', { p0: elapsed }) }}</span>
      </div>
    </template>
    <template v-else-if="step !== 'result'">
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
      <p v-if="result.fileName" class="okr-rp-from">{{ $t('okr.import.from_file', { p0: result.fileName }) }}</p>
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
        <el-button type="primary" :disabled="isFile ? !file : !text.trim()" data-test="report-generate" @click="generate">{{ $t('okr.report.generate') }}</el-button>
      </template>
      <template v-else-if="step === 'loading'">
        <el-button data-test="report-cancel" @click="cancel">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" loading>{{ $t('okr.report.generate') }}</el-button>
      </template>
      <div v-else class="okr-rp-foot">
        <button type="button" class="okr-rp-link" @click="step = 'input'">{{ isFile ? $t('okr.import.change_file') : $t('okr.report.edit_source') }}</button>
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
import { DRAFT_FILE_ACCEPT, draftFileProblem } from '@/views/okr/okrPeople.js'

const MIN = 50

const props = defineProps({
  modelValue: Boolean,
  // text = 贴周报; file = 导入文档
  source: { type: String, default: 'text' },
  targetUserId: { type: String, default: '' },
  targetName: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'fill'])
const isFile = computed(() => props.source === 'file')
const file = ref(null)
const fileEl = ref(null)
const fillMode = ref('replace')
const kb = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function onFile(e) {
  const f = e.target.files?.[0] || null
  error.value = ''
  const bad = draftFileProblem(f)
  if (f && bad) {
    error.value = $t(bad)
    file.value = null
    e.target.value = ''
    return
  }
  file.value = f
}

const step = ref('input') // input → loading → result
const text = ref('')
const error = ref('')
const result = ref({ mode: 'model', fallbackReason: null, truncated: false, fileName: '' })
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
  if (isFile.value) {
    const bad = draftFileProblem(file.value)
    if (bad) {
      error.value = $t(bad)
      step.value = 'input'
      return
    }
  } else if (len.value < MIN) {
    // 太短直接提示, 不调接口(后端同口径再挡一次)
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
    const opts = { signal: ctrl.signal, targetUserId: props.targetUserId || undefined }
    const r = isFile.value ? await fde.okr.draftFromFile(file.value, opts) : await fde.okr.draftFromReport(text.value, opts)
    result.value = { mode: r.mode, fallbackReason: r.fallbackReason, truncated: r.truncated, fileName: r.fileName || '' }
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
  emit('fill', fillable.value, { mode: isFile.value ? fillMode.value : 'replace' })
}

function close() {
  cancel()
  emit('update:modelValue', false)
}

/** 关掉后清结果; 贴的原文留着(万一要回来重来), 选的文件清掉 */
function onClosed() {
  step.value = 'input'
  error.value = ''
  objs.value = []
  file.value = null
  if (fileEl.value) fileEl.value.value = ''
}

onBeforeUnmount(() => { cancel(); stopTimer() })
</script>

<style scoped>
.okr-rp-hint { margin: 0 0 8px; font-size: 13px; color: var(--el-text-color-regular); }
.okr-rp-target { margin: 0 0 8px; padding: 6px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); }
.okr-rp-file { position: relative; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 10px; border: 1px dashed var(--el-border-color); border-radius: 8px; cursor: pointer; }
.okr-rp-file.is-disabled { cursor: not-allowed; opacity: .6; }
.okr-rp-file-input { position: absolute; inset: 0; opacity: 0; cursor: inherit; width: 100%; }
.okr-rp-file-btn { flex: none; padding: 4px 10px; border-radius: 6px; font-size: 13px; color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.okr-rp-file-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--el-text-color-secondary); }
.okr-rp-mode { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; flex-wrap: wrap; }
.okr-rp-mode-sub { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-rp-from { margin: 0 0 6px; font-size: 12px; color: var(--el-text-color-secondary); }
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
