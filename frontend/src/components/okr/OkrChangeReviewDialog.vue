<template>
  <!-- 0.6.2 团队页「变更待批」: 申请人、原因、改了几条、查看差异(before → after)、批准 / 拒绝(拒绝必须写原因)。
       批准 / 拒绝后从列表移除, 由父组件刷新这个人的行 -->
  <el-dialog
    :model-value="modelValue" :title="$t('okr.confirm.pending_title')" :width="mobile ? '100%' : 'min(92vw, 640px)'" :fullscreen="mobile"
    append-to-body @update:model-value="v => $emit('update:modelValue', v)"
  >
    <p v-if="!rows.length" class="okr-cr-empty" data-test="okr-changes-empty">{{ $t('okr.confirm.pending_empty') }}</p>
    <ul v-else class="okr-cr-list" data-test="okr-changes">
      <li v-for="r in rows" :key="r.id" class="okr-cr-item" :data-test="'okr-change-' + r.id">
        <div class="okr-cr-head">
          <b class="okr-cr-who">{{ r.ownerName }}</b>
          <span v-if="r.requester" class="okr-cr-sub">{{ $t('okr.confirm.on_behalf', { p0: r.requester }) }}</span>
          <span class="okr-cr-sub">{{ r.at }}</span>
          <span class="okr-cr-count">{{ $t('okr.confirm.diff_n', { p0: r.count }) }}</span>
        </div>
        <p class="okr-cr-reason"><span>{{ $t('okr.confirm.reason') }}：</span>{{ r.reason }}</p>
        <p v-if="r.error" class="okr-cr-error" role="alert">{{ $t('okr.confirm.preview_error', { p0: r.error }) }}</p>
        <ul v-if="open[r.id]" class="okr-cr-diffs" :data-test="'okr-change-diffs-' + r.id">
          <li v-for="d in r.diffs" :key="d.key">
            <div class="okr-cr-dhead"><span>{{ d.label }}</span><code v-if="d.code">{{ d.code }}</code><span class="okr-cr-sub">{{ d.title }}</span></div>
            <div class="okr-cr-ba">
              <span class="okr-cr-before">{{ d.before ?? '—' }}</span>
              <span class="okr-cr-arrow" aria-hidden="true">→</span>
              <span class="okr-cr-after">{{ d.after ?? '—' }}</span>
            </div>
          </li>
        </ul>
        <div class="okr-cr-acts">
          <el-button v-if="r.diffs.length" text type="primary" class="okr-cr-btn" :data-test="'okr-change-diff-' + r.id" @click="open[r.id] = !open[r.id]">
            {{ open[r.id] ? $t('okr.confirm.hide_diff') : $t('okr.confirm.view_diff') }}
          </el-button>
          <el-button class="okr-cr-btn" :loading="busy === r.id + ':reject'" :disabled="!!busy" :data-test="'okr-change-reject-' + r.id" @click="reject(r)">{{ $t('okr.confirm.reject') }}</el-button>
          <el-button type="primary" class="okr-cr-btn" :loading="busy === r.id + ':approve'" :disabled="!!busy || !!r.error" :data-test="'okr-change-approve-' + r.id" @click="approve(r)">{{ $t('okr.confirm.approve') }}</el-button>
        </div>
      </li>
    </ul>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { changeRow } from '@/views/okr/okrConfirm.js'

const props = defineProps({
  modelValue: Boolean,
  changes: { type: Array, default: () => [] },
  mobile: Boolean
})
const emit = defineEmits(['update:modelValue', 'decided'])

const busy = ref('')
const open = reactive({})
const rows = computed(() => props.changes.map(c => changeRow(c, $t)))

async function approve(r) {
  try {
    await ElMessageBox.confirm($t('okr.confirm.approve_confirm', { p0: r.ownerName, p1: r.count }), $t('okr.confirm.approve'), {
      type: 'warning', confirmButtonText: $t('okr.confirm.approve'), cancelButtonText: $t('common.cancel')
    })
  } catch { return }
  busy.value = r.id + ':approve'
  try {
    await fde.okr.approveChange(r.id)
    ElMessage.success($t('okr.confirm.approved'))
    emit('decided', { id: r.id, ownerId: r.owner?.id, result: 'APPROVED' })
  } catch (e) {
    ElMessage.error({ message: e.message, duration: 6000 })
  } finally {
    busy.value = ''
  }
}

async function reject(r) {
  let note
  try {
    const res = await ElMessageBox.prompt('', $t('okr.confirm.reject_title'), {
      inputType: 'textarea', inputPlaceholder: $t('okr.confirm.reject_ph'),
      inputValidator: v => !!String(v || '').trim() || $t('okr.confirm.reject_need'),
      confirmButtonText: $t('okr.confirm.reject'), cancelButtonText: $t('common.cancel'), confirmButtonClass: 'el-button--danger'
    })
    note = res.value.trim()
  } catch { return }
  busy.value = r.id + ':reject'
  try {
    await fde.okr.rejectChange(r.id, note)
    ElMessage.success($t('okr.confirm.rejected'))
    emit('decided', { id: r.id, ownerId: r.owner?.id, result: 'REJECTED' })
  } catch (e) {
    ElMessage.error({ message: e.message, duration: 6000 })
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.okr-cr-empty { margin: 24px 0; text-align: center; color: var(--el-text-color-secondary); font-size: 13px; }
.okr-cr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.okr-cr-item { padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; font-size: 13px; }
.okr-cr-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.okr-cr-who { font-size: 14px; }
.okr-cr-sub { color: var(--el-text-color-secondary); font-size: 12px; }
.okr-cr-count { margin-left: auto; font-weight: 600; color: var(--el-color-primary); }
.okr-cr-reason { margin: 6px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.okr-cr-reason span { color: var(--el-text-color-secondary); }
.okr-cr-error { margin: 6px 0 0; color: var(--el-color-danger); font-size: 12px; }
.okr-cr-diffs { list-style: none; margin: 8px 0 0; padding: 8px 10px; border-radius: 6px; background: var(--el-fill-color-light); display: flex; flex-direction: column; gap: 8px; }
.okr-cr-dhead { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-weight: 600; }
.okr-cr-dhead code { font-size: 12px; color: var(--el-color-primary); }
.okr-cr-ba { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; margin-top: 2px; }
.okr-cr-before { color: var(--el-text-color-secondary); text-decoration: line-through; overflow-wrap: anywhere; }
.okr-cr-after { color: var(--el-color-success-dark-2); font-weight: 600; overflow-wrap: anywhere; }
.okr-cr-acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.okr-cr-acts .el-button { margin-left: 0; }
@media (max-width: 640px) {
  .okr-cr-btn { min-height: 44px; flex: 1 1 0; }
}
</style>
