<template>
  <!-- v2.6.0(#960) 本周工时格子: 一眼看满没满, 草稿一键提交 -->
  <el-card shadow="never" class="block-card">
    <template #header>
      <div class="block-title">
        <span>{{ $t('hoursStrip.hours_this_week') }}</span>
        <span class="sum">{{ hours.week || 0 }} / {{ hours.weekTarget || 40 }}h</span>
        <div class="right">
          <el-button v-if="hours.weekDraftCount" type="primary" size="small" :loading="submitting" @click="submitDrafts">
            {{ $t('hoursStrip.submit_drafts', { p0: hours.weekDraftCount }) }}
          </el-button>
          <el-button link type="primary" size="small" @click="$router.push('/admin/timesheets')">{{ $t('hoursStrip.hour_details') }}</el-button>
        </div>
      </div>
    </template>

    <div class="bar">
      <div class="bar-fill" :style="{ width: pct + '%' }" :class="{ full: pct >= 100 }"></div>
    </div>

    <div class="grid">
      <div v-for="d in hours.days || []" :key="d.date" class="cell" :class="{ today: d.isToday, empty: !d.hours }">
        <div class="cell-date">{{ d.date.slice(5) }}</div>
        <div class="cell-hours">{{ d.hours || 0 }}<span class="unit">h</span></div>
        <div class="cell-bars">
          <span v-if="d.approved" class="seg approved" :style="{ flex: d.approved }" :title="$t('common.h_approved', { p0: d.approved })"></span>
          <span v-if="d.submitted" class="seg submitted" :style="{ flex: d.submitted }" :title="$t('hoursStrip.h_pending', { p0: d.submitted })"></span>
          <span v-if="d.draft" class="seg draft" :style="{ flex: d.draft }" :title="$t('hoursStrip.h_draft', { p0: d.draft })"></span>
        </div>
      </div>
    </div>

    <div class="legend">
      <span><i class="dot approved"></i>{{ $t('hoursStrip.approved', { p0: hours.monthApproved || 0 }) }}</span>
      <span><i class="dot submitted"></i>{{ $t('hoursStrip.pending', { p0: hours.monthSubmitted || 0 }) }}</span>
      <span><i class="dot draft"></i>{{ $t('hoursStrip.drafts', { p0: hours.monthDraft || 0 }) }}</span>
      <span class="month">{{ $t('hoursStrip.month_total_h', { p0: hours.month || 0 }) }}</span>
    </div>
  </el-card>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde } from '@/api/index.js'

const props = defineProps({ hours: { type: Object, default: () => ({}) } })
const emit = defineEmits(['changed'])

const submitting = ref(false)
const pct = computed(() => {
  const target = props.hours.weekTarget || 40
  return Math.min(Math.round(((props.hours.week || 0) / target) * 100), 100)
})

async function submitDrafts() {
  try {
    await ElMessageBox.confirm($t('hoursStrip.submit_draft_entries_from_this_week', { p0: props.hours.weekDraftCount }), $t('common.submit_hours'), { type: 'warning' })
    submitting.value = true
    const r = await fde.timesheets.submitBatch([])   // 空数组 = 后端按本周范围取本人草稿
    ElMessage.success($t('common.submitted_entries_h_total', { p0: r.submitted, p1: r.hours }))
    emit('changed')
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || $t('common.submit_failed'))
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.sum { font-family: 'Manrope', Arial, sans-serif; color: #d2521e; font-size: 14px; }
.right { margin-left: auto; display: flex; gap: 8px; align-items: center; }

.bar { height: 6px; border-radius: 3px; background: #f0eee9; overflow: hidden; margin-bottom: 12px; }
.bar-fill { height: 100%; background: #1c1917; transition: width .3s; }
.bar-fill.full { background: #2e7d4f; }

.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.cell { border: 1px solid #eae7e2; border-radius: 8px; padding: 8px; text-align: center; }
.cell.today { border-color: #d2521e; }
.cell.empty .cell-hours { color: #c9c4bc; }
.cell-date { font-size: 11px; color: #8f8a82; font-family: monospace; }
.cell-hours { font-family: 'Manrope', Arial, sans-serif; font-size: 18px; font-weight: 700; color: #1c1917; }
.cell-hours .unit { font-size: 11px; color: #8f8a82; font-weight: 400; }
.cell-bars { display: flex; height: 4px; border-radius: 2px; overflow: hidden; background: #f3f1ed; margin-top: 6px; }
.seg.approved { background: #1c1917; }
.seg.submitted { background: #b3450f; }
.seg.draft { background: #a8a29a; }

.legend { display: flex; gap: 14px; margin-top: 12px; font-size: 12px; color: #8f8a82; align-items: center; }
.legend .month { margin-left: auto; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
.dot.approved { background: #1c1917; }
.dot.submitted { background: #b3450f; }
.dot.draft { background: #a8a29a; }

@media (max-width: 900px) {
  .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
</style>
