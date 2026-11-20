<template>
  <!-- OKR 3.0 主管评分面板(只给 okr.score.manager = ADMIN, 父组件负责不渲染给别人)。
       按人 → 按 O 列出「自评分」和「主管分」输入框, 一次填多个 O:
       「保存评分」逐个调 /manager-score; 「保存并完成本周」先保存再调 /cycle/close-by-score 归档。
       员工没自评的 O 后端不让打主管分(8115), 这里直接置灰; 自己的 O 也不能自己打(8109) -->
  <el-drawer
    :model-value="modelValue" :title="$t('okr.v3.mgr_panel_title', { p0: week })"
    :direction="mobile ? 'btt' : 'rtl'" :size="mobile ? '90%' : '640px'" append-to-body class="okr-mgr-drawer"
    @update:model-value="v => $emit('update:modelValue', v)" @open="load"
  >
    <div class="okr-mp" v-loading="loading" data-test="okr-mgr-panel">
      <p class="okr-mp-hint">{{ $t('okr.v3.mgr_hint') }}</p>
      <p v-if="groups.length" class="okr-mp-progress" data-test="okr-mgr-progress">{{ $t('okr.v3.mgr_progress', { p0: scoredCount, p1: allRows.length }) }}</p>
      <div v-if="error" class="okr-mp-error" role="alert" data-test="okr-mgr-error">{{ error }}</div>

      <p v-if="!loading && !groups.length" class="okr-mp-empty">{{ $t('okr.v3.mgr_none') }}</p>
      <section v-for="g in groups" :key="g.user.id" class="okr-mp-person" :data-test="'okr-mgr-person-' + g.user.id">
        <h4>{{ g.user.name || g.user.username }}</h4>
        <div v-for="r in g.rows" :key="r.id" class="okr-mp-row" :class="{ locked: r.locked }" :data-test="'okr-mgr-row-' + r.id">
          <div class="okr-mp-title"><span class="okr-mp-seq">O{{ r.seq }}</span> {{ r.title }}</div>
          <div class="okr-mp-fields">
            <span class="okr-mp-self">
              <small>{{ $t('okr.v3.mgr_self') }}</small>
              <b v-if="r.selfScore != null">{{ r.selfScore }}</b>
              <em v-else>{{ $t('okr.v3.mgr_no_self') }}</em>
            </span>
            <label class="okr-mp-score">
              <small>{{ $t('okr.v3.mgr_score') }}</small>
              <el-input-number
                v-model="r.score" :min="0" :max="100" :precision="0" :controls="false" :disabled="!!r.locked || closed"
                :placeholder="r.locked === 'own' ? '—' : '0–100'" class="okr-mp-num"
              />
            </label>
            <el-input v-model="r.comment" maxlength="200" :disabled="!!r.locked || closed" :placeholder="$t('okr.one_line_comment')" class="okr-mp-comment" />
          </div>
          <p v-if="r.locked === 'own'" class="okr-mp-lock">{{ $t('okr.v3.mgr_own') }}</p>
        </div>
      </section>
    </div>
    <template #footer>
      <div class="okr-mp-foot">
        <el-button :disabled="closed || !groups.length" :loading="busy === 'save'" data-test="okr-mgr-save" @click="saveOnly">{{ $t('okr.v3.mgr_save') }}</el-button>
        <el-button type="primary" :disabled="closed || !groups.length" :loading="busy === 'close'" data-test="okr-mgr-close" @click="saveAndClose">{{ $t('okr.v3.mgr_save_close') }}</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { managerScoreChanges } from '@/views/okr/okrUtils.js'
import { sameId } from '@/views/okr/okrPeople.js'

const props = defineProps({
  modelValue: Boolean,
  /** 周 key, 如 2026-W47 */
  week: { type: String, required: true },
  meId: { type: String, default: '' },
  /** 本周已归档: 只读 */
  closed: Boolean,
  mobile: Boolean
})
const emit = defineEmits(['update:modelValue', 'changed'])

const loading = ref(false)
const busy = ref('')
const error = ref('')
const groups = ref([])

const allRows = computed(() => groups.value.flatMap(g => g.rows))
const scoredCount = computed(() => allRows.value.filter(r => r.original != null).length)

/** 拉这一周交了 OKR 的人, 再逐人取 O(并发, 一次 6 个) */
async function load() {
  loading.value = true
  error.value = ''
  try {
    const team = await fde.okr.team(props.week)
    const people = (team.rows || []).filter(r => r.submitted).map(r => r.user)
    const out = []
    for (let i = 0; i < people.length; i += 6) {
      const batch = await Promise.all(people.slice(i, i + 6).map(u => fde.okr.cycle({ week: props.week, ownerId: u.id }).then(d => ({ u, d }))))
      for (const { u, d } of batch) {
        const rows = (d.objectives || []).filter(o => o.submittedAt && o.status !== 'DROPPED').map(o => ({
          id: String(o.id), seq: o.seq, title: o.title, selfScore: o.selfScore ?? null,
          original: o.managerScore ?? null, score: o.managerScore ?? null, comment: '',
          locked: sameId(u.id, props.meId) ? 'own' : o.selfScore == null ? 'noself' : null
        }))
        if (rows.length) out.push({ user: d.owner || u, rows })
      }
    }
    groups.value = out
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

/** 逐个保存有改动的 O。返回失败列表(不中断: 能存的都存下) */
async function saveScores() {
  const failed = []
  let saved = 0
  for (const g of groups.value) {
    for (const r of managerScoreChanges(g.rows)) {
      try {
        const res = await fde.okr.managerScore({ objectiveId: r.id, score: r.score, comment: r.comment.trim() })
        r.original = res.score
        r.comment = ''
        saved++
      } catch (e) {
        failed.push(`${g.user.name || g.user.username} O${r.seq}: ${e.message}`)
      }
    }
  }
  return { saved, failed }
}

async function saveOnly() {
  busy.value = 'save'
  error.value = ''
  try {
    const { saved, failed } = await saveScores()
    if (failed.length) {
      error.value = $t('okr.v3.mgr_partial', { p0: failed.length, p1: failed.join('；') })
      ElMessage.error(error.value)
    } else {
      ElMessage.success(saved ? $t('okr.v3.mgr_saved', { p0: saved }) : $t('okr.v3.mgr_nothing'))
    }
    if (saved) emit('changed')
  } finally {
    busy.value = ''
  }
}

/** 先保存, 再归档。close-by-score 400 时把后端 message 原样展示(里面写了还差谁哪个 O) */
async function saveAndClose() {
  try {
    await ElMessageBox.confirm($t('okr.v3.mgr_confirm_close', { p0: props.week }), $t('okr.v3.mgr_save_close'), {
      type: 'warning', confirmButtonText: $t('okr.v3.mgr_save_close'), cancelButtonText: $t('common.cancel')
    })
  } catch { return }
  busy.value = 'close'
  error.value = ''
  try {
    const { saved, failed } = await saveScores()
    if (saved) emit('changed')
    if (failed.length) {
      error.value = $t('okr.v3.mgr_partial', { p0: failed.length, p1: failed.join('；') })
      ElMessage.error(error.value)
      return
    }
    await fde.okr.closeByScore(props.week)
    ElMessage.success({ message: $t('okr.v3.mgr_closed'), duration: 5000 })
    emit('changed')
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e.message
    ElMessage.error({ message: e.message, duration: 8000 })
  } finally {
    busy.value = ''
  }
}

defineExpose({ load })
</script>

<style scoped>
.okr-mp { display: flex; flex-direction: column; gap: 12px; }
.okr-mp-hint { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-mp-progress { margin: 0; font-size: 14px; font-weight: 600; }
.okr-mp-error { padding: 10px 12px; border-radius: 8px; font-size: 13px; line-height: 1.5; color: var(--el-color-danger); background: var(--el-color-danger-light-9); border: 1px solid var(--el-color-danger-light-5); overflow-wrap: anywhere; }
.okr-mp-empty { margin: 24px 0; text-align: center; font-size: 13px; color: var(--el-text-color-secondary); }
.okr-mp-person { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px 12px; }
.okr-mp-person h4 { margin: 0 0 6px; font-size: 14px; }
.okr-mp-row { padding: 8px 0; border-top: 1px dashed var(--el-border-color-lighter); }
.okr-mp-row:first-of-type { border-top: 0; }
.okr-mp-row.locked { opacity: .7; }
.okr-mp-title { font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; margin-bottom: 6px; }
.okr-mp-seq { color: var(--el-color-primary); font-size: 12px; font-weight: 600; }
.okr-mp-fields { display: flex; align-items: center; gap: 8px; }
.okr-mp-self, .okr-mp-score { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.okr-mp-self small, .okr-mp-score small { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-mp-self b { font-size: 15px; min-width: 24px; }
.okr-mp-self em { font-style: normal; font-size: 12px; color: var(--el-color-warning-dark-2); }
.okr-mp-num { width: 72px; }
.okr-mp-comment { flex: 1; min-width: 0; }
.okr-mp-lock { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-mp-foot { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.okr-mp-foot .el-button { margin-left: 0; }
@media (max-width: 640px) {
  .okr-mp-fields { flex-wrap: wrap; }
  .okr-mp-comment { flex-basis: 100%; }
  .okr-mp-foot .el-button { flex: 1 1 0; min-height: 44px; }
}
</style>
