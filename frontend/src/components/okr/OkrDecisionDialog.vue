<template>
  <!-- OKR 9.0「记一条决策」/「用新决策取代」弹窗。
       记: 标题(必填) / 背景与结论(必填) / 为什么这么定 / 影响与配合 / 挂到 O(本周) / 所属项目 / 决策时间(默认现在, 可回填)
       取代: 新标题 + 背景(O / 项目 / 周期由后端继承老记录) -->
  <el-dialog
    :model-value="modelValue" :title="supersede ? $t('okr.fe5.dec_supersede_title') : $t('okr.fe5.dec_new')"
    :width="mobile ? '100%' : '560px'" :fullscreen="mobile" append-to-body class="okr-decdlg" @update:model-value="v => $emit('update:modelValue', v)"
    @open="reset"
  >
    <p v-if="supersede && old" class="okr-decdlg-old" data-test="dec-supersede-old">{{ $t('okr.fe5.dec_supersede_old', { p0: old.title }) }}</p>
    <form class="okr-decdlg-form" data-test="dec-form" @submit.prevent="submit">
      <label class="okr-decdlg-f">
        <span>{{ $t('okr.fe5.dec_f_title') }} <b class="req">*</b></span>
        <el-input v-model="form.title" maxlength="200" :placeholder="$t('okr.fe5.dec_f_title_ph')" data-test="dec-title" />
      </label>
      <label class="okr-decdlg-f">
        <span>{{ $t('okr.fe5.dec_f_detail') }} <b class="req">*</b></span>
        <el-input v-model="form.detail" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" maxlength="20000" :placeholder="$t('okr.fe5.dec_f_detail_ph')" data-test="dec-detail" />
      </label>
      <label class="okr-decdlg-f">
        <span>{{ $t('okr.fe5.dec_f_rationale') }}</span>
        <el-input v-model="form.rationale" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="20000" :placeholder="$t('okr.fe5.dec_f_optional')" data-test="dec-rationale" />
      </label>
      <label class="okr-decdlg-f">
        <span>{{ $t('okr.fe5.dec_f_impact') }}</span>
        <el-input v-model="form.impact" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="20000" :placeholder="$t('okr.fe5.dec_f_optional')" data-test="dec-impact" />
      </label>
      <template v-if="!supersede">
        <label class="okr-decdlg-f">
          <span>{{ $t('okr.fe5.dec_f_objective') }}</span>
          <el-select v-model="form.objectiveId" filterable clearable :placeholder="$t('okr.fe5.dec_f_objective_ph')" data-test="dec-objective">
            <el-option v-for="o in objectives" :key="o.id" :value="o.id" :label="o.label" />
          </el-select>
          <small v-if="!writer" class="okr-decdlg-hint">{{ $t('okr.fe5.dec_f_objective_engineer') }}</small>
        </label>
        <label class="okr-decdlg-f">
          <span>{{ $t('okr.fe5.dec_f_project') }}</span>
          <el-select v-model="form.projectId" filterable clearable :placeholder="$t('okr.fe5.dec_f_project_ph')" data-test="dec-project">
            <el-option v-for="p in projects" :key="p.id" :value="p.id" :label="p.name" />
          </el-select>
        </label>
      </template>
      <label class="okr-decdlg-f">
        <span>{{ $t('okr.fe5.dec_f_decided_at') }}</span>
        <el-date-picker v-model="form.decidedAt" type="datetime" :clearable="false" :disabled-date="d => d.getTime() > Date.now() + 86400000" data-test="dec-decided-at" />
      </label>
      <p v-if="error" class="okr-decdlg-err" role="alert" data-test="dec-error">{{ error }}</p>
    </form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="busy" data-test="dec-submit" @click="submit">{{ supersede ? $t('okr.fe5.dec_supersede') : $t('okr.fe5.dec_new') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { $t } from '@/i18n'
import { decisionPayload } from '@/views/okr/okrFe5.js'

const props = defineProps({
  modelValue: Boolean,
  mode: { type: String, default: 'create' },
  /** 取代时的老决策 */
  old: { type: Object, default: null },
  objectives: { type: Array, default: () => [] },
  projects: { type: Array, default: () => [] },
  /** 默认项目(列表正按某个项目筛时带上) */
  defaultProjectId: { type: String, default: '' },
  /** ADMIN / MANAGER: 可以不挂 O */
  writer: Boolean,
  mobile: Boolean,
  busy: Boolean
})
const emit = defineEmits(['update:modelValue', 'submit'])
const supersede = computed(() => props.mode === 'supersede')
const blank = () => ({ title: '', detail: '', rationale: '', impact: '', objectiveId: '', projectId: props.defaultProjectId || '', decidedAt: new Date() })
const form = reactive(blank())
const error = ref('')

function reset() {
  Object.assign(form, blank())
  error.value = ''
}

/** 必填前端只做最基本的提示; 其余(权限 / 时间 / 长度)交给后端, 文案原样显示在框里 */
function submit() {
  if (props.busy) return
  if (!form.title.trim() || !form.detail.trim()) {
    error.value = $t('okr.fe5.dec_need_title')
    return
  }
  error.value = ''
  const payload = decisionPayload(supersede.value ? { ...form, objectiveId: '', projectId: '' } : form)
  emit('submit', payload, (msg) => { error.value = msg || '' })
}

defineExpose({ reset })
</script>

<style scoped>
.okr-decdlg-old { margin: 0 0 10px; padding: 8px 10px; border-radius: 8px; background: var(--el-fill-color-light); font-size: 13px; color: var(--el-text-color-secondary); text-decoration: line-through; }
.okr-decdlg-form { display: flex; flex-direction: column; gap: 12px; }
.okr-decdlg-f { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.okr-decdlg-f > span { font-weight: 600; color: var(--el-text-color-regular); }
.okr-decdlg-f .el-select, .okr-decdlg-f :deep(.el-date-editor) { width: 100%; }
.req { color: var(--el-color-danger); font-weight: 600; }
.okr-decdlg-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-decdlg-err { margin: 0; padding: 8px 10px; border-radius: 8px; font-size: 13px; color: var(--el-color-danger-dark-2); background: var(--el-color-danger-light-9); border: 1px solid var(--el-color-danger-light-5); }
</style>
