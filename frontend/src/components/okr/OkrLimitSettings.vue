<template>
  <!-- 0.6.5 OKR 计划上限: 每人每周最多几个 O、每个 O 最多几条 KR。GET/PUT /api/okr/settings/limits。
       只有 ADMIN 能改(后端 PUT 也只认 ADMIN); 其他人整块只读显示当前值, 不出保存按钮。
       前端按接口给的 ranges 拦整数 / 范围; 后端 400 的文案原样显示 -->
  <div class="okr-limits" v-loading="loading" data-test="okr-limits">
    <h3 class="okr-lm-title">{{ $t('okr.limits.title') }}</h3>
    <p class="okr-lm-desc">{{ $t('okr.limits.desc') }}</p>

    <div class="okr-lm-fields">
      <label v-for="f in fields" :key="f.key" class="okr-lm-field" :data-test="`okr-limits-field-${f.key}`">
        <span class="okr-lm-label">{{ $t(f.label) }}</span>
        <el-input
          v-if="editable" v-model="form[f.key]" inputmode="numeric" class="okr-lm-input" :class="{ 'is-bad': !!errors[f.key] }"
          :aria-label="$t(f.label)" :data-test="`okr-limits-${f.key}`"
        />
        <b v-else class="okr-lm-value" :data-test="`okr-limits-${f.key}`">{{ saved[f.key] }}</b>
        <span class="okr-lm-hint">{{ $t('okr.limits.range_hint', { p0: ranges[f.key][0], p1: ranges[f.key][1], p2: defaults[f.key] }) }}</span>
        <span v-if="editable && errors[f.key]" class="okr-lm-err" role="alert" :data-test="`okr-limits-err-${f.key}`">{{ errors[f.key] }}</span>
      </label>
    </div>

    <el-button
      v-if="editable" type="primary" class="okr-lm-save" :loading="saving" :disabled="!dirty || hasError"
      data-test="okr-limits-save" @click="save"
    >{{ $t('common.save') }}</el-button>
    <p v-else class="okr-lm-ro" data-test="okr-limits-readonly">{{ $t('okr.limits.readonly') }}</p>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { currentUser } from '@/views/okr/okrPeople.js'
import { normalizeLimits, limitError, limitsPatch, LIMIT_FIELDS } from '@/views/okr/okrLimits.js'

const fields = [
  { key: 'maxObjectives', label: 'okr.limits.max_o' },
  { key: 'maxKrsPerObjective', label: 'okr.limits.max_kr' }
]
const editable = currentUser().role === 'ADMIN'

const loading = ref(false)
const saving = ref(false)
const init = normalizeLimits(null)
const saved = ref({ maxObjectives: init.maxObjectives, maxKrsPerObjective: init.maxKrsPerObjective })
const ranges = ref(init.ranges)
const defaults = ref(init.defaults)
const form = reactive({ maxObjectives: '', maxKrsPerObjective: '' })

const errors = computed(() => Object.fromEntries(LIMIT_FIELDS.map(f => {
  const e = limitError(form[f], ranges.value[f])
  return [f, e ? $t(e.key, e.p) : '']
})))
const hasError = computed(() => LIMIT_FIELDS.some(f => errors.value[f]))
const dirty = computed(() => Object.keys(limitsPatch(form, saved.value)).length > 0)

/** 后端返回 → 已保存值 + 输入框都刷成后端的值 */
function fill(raw) {
  const l = normalizeLimits(raw)
  saved.value = { maxObjectives: l.maxObjectives, maxKrsPerObjective: l.maxKrsPerObjective }
  ranges.value = l.ranges
  defaults.value = l.defaults
  for (const f of LIMIT_FIELDS) form[f] = String(l[f])
}

async function load() {
  loading.value = true
  try {
    fill(await fde.okr.limits())
  } catch (e) {
    fill(null)
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function save() {
  if (hasError.value) return
  const patch = limitsPatch(form, saved.value)
  if (!Object.keys(patch).length) return
  saving.value = true
  try {
    fill(await fde.okr.saveLimits(patch))
    ElMessage.success($t('okr.limits.saved'))
  } catch (e) {
    // 400 8103 / 403 8143: 后端文案原样显示
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.okr-limits { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; max-width: 760px; }
.okr-lm-title { margin: 0; font-size: 16px; }
.okr-lm-desc { margin: 0; font-size: 13px; color: var(--el-text-color-regular); }
.okr-lm-fields { display: flex; flex-wrap: wrap; gap: 12px 24px; }
.okr-lm-field { display: flex; flex-direction: column; gap: 4px; min-width: 200px; }
.okr-lm-label { font-size: 13px; font-weight: 600; color: var(--el-text-color-primary); }
.okr-lm-input { width: 160px; }
.okr-lm-input.is-bad :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.okr-lm-value { font-size: 20px; line-height: 32px; }
.okr-lm-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-lm-err { font-size: 12px; color: var(--el-color-danger); }
.okr-lm-ro { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); }
@media (max-width: 640px) {
  .okr-limits { align-items: stretch; }
  .okr-lm-fields { flex-direction: column; flex-wrap: nowrap; }
  .okr-lm-field { min-width: 0; }
  .okr-lm-input { width: 100%; }
  .okr-lm-input :deep(.el-input__wrapper) { min-height: 44px; }
  .okr-lm-save { min-height: 44px; width: 100%; }
}
</style>
