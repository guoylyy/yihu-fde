<template>
  <!-- OKR 10.0 我的 OKR 顶部: 自己连续未达成的 O, CRITICAL 红条 / WARN 黄条, 最多 3 条。
       桌面: 一行字 +「看看」(滚到那张 O 卡); 手机: 标题一行省略号, 右侧「详情」进底部弹层 -->
  <div v-if="bars.length" class="okr-rbars" data-test="okr-risk-bars">
    <div
      v-for="b in shown" :key="b.objectiveId" class="okr-rbar" :class="'lv-' + b.level" :role="b.level === 'CRITICAL' ? 'alert' : 'status'"
      :data-test="'okr-risk-bar-' + b.level"
    >
      <span class="okr-rbar-dot" aria-hidden="true" />
      <span class="okr-rbar-text" :title="barText(b)">{{ barText(b) }}</span>
      <button v-if="compact" type="button" class="okr-rbar-btn" data-test="okr-risk-detail" @click="sheet = b">{{ $t('okr.fe5.risk_details') }}</button>
      <button v-else type="button" class="okr-rbar-btn" data-test="okr-risk-look" @click="$emit('look', b)">{{ $t('okr.fe5.risk_look') }}</button>
    </div>
    <p v-if="bars.length > shown.length" class="okr-rbar-more">{{ $t('okr.fe5.risk_more', { p0: bars.length - shown.length }) }}</p>

    <el-drawer
      :model-value="!!sheet" direction="btt" size="auto" append-to-body :title="$t('okr.fe5.risk_sheet_title')" class="okr-rsheet"
      @update:model-value="v => { if (!v) sheet = null }"
    >
      <div v-if="sheet" class="okr-rsheet-body" data-test="okr-risk-sheet">
        <p class="okr-rsheet-title">
          <span class="okr-rlv" :class="'lv-' + sheet.level">{{ $t('okr.fe5.risk_level.' + sheet.level) }}</span>
          {{ sheet.title }}
        </p>
        <p class="okr-rsheet-line">{{ $t('okr.fe5.risk_dot', { p0: sheet.consecutiveMissedWeeks }) }}<template v-if="sheet.hasOverdueBlocker"> · {{ $t('okr.fe5.risk_overdue_blocker') }}</template></p>
        <ul class="okr-rsheet-rates">
          <li v-for="r in rates(sheet)" :key="r.week">
            <span class="okr-rsheet-wk">{{ r.week }}</span>
            <span class="okr-mini"><i :class="{ miss: r.missed }" :style="{ width: (r.pct ?? 0) + '%' }" /></span>
            <span class="okr-rsheet-pct">{{ r.pct == null ? '-' : r.pct + '%' }}</span>
          </li>
        </ul>
        <el-button type="primary" class="okr-rsheet-go" @click="lookFromSheet">{{ $t('okr.fe5.risk_look') }}</el-button>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { $t } from '@/i18n'
import { recentRates } from '@/views/okr/okrFe5.js'

const props = defineProps({
  /** okrFe5.myRiskBars 的结果 */
  bars: { type: Array, default: () => [] },
  compact: Boolean,
  max: { type: Number, default: 3 }
})
const emit = defineEmits(['look'])
const sheet = ref(null)
const shown = computed(() => props.bars.slice(0, props.max))
const barText = b => $t('okr.fe5.risk_bar', { p0: b.title, p1: b.consecutiveMissedWeeks })
const rates = b => recentRates(b, 4)
function lookFromSheet() {
  const b = sheet.value
  sheet.value = null
  emit('look', b)
}
</script>

<style scoped>
.okr-rbars { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.okr-rbar { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid; }
.okr-rbar.lv-CRITICAL { color: var(--el-color-danger-dark-2); background: var(--el-color-danger-light-9); border-color: var(--el-color-danger-light-5); }
/* 主题的 warning 是橙红, 和红线分不开: 黄条用单独的黄色 */
.okr-rbar.lv-WARN { color: #7a5a00; background: #fdf7dc; border-color: #ecd27a; }
.okr-rbar.lv-WARN .okr-rbar-dot { background: #d9a400; }
.okr-rbar-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.okr-rbar-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-rbar-btn { flex: none; border: 0; background: none; padding: 4px 0; font: inherit; font-weight: 600; color: var(--el-color-primary); cursor: pointer; white-space: nowrap; }
.okr-rbar-more { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); }
@media (max-width: 640px) {
  .okr-rbar { padding: 0 12px; min-height: 44px; }
  .okr-rbar-btn { min-height: 44px; padding: 0 2px; }
}
.okr-rsheet-body { display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; }
.okr-rsheet-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.okr-rlv { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 4px; font-size: 12px; font-weight: 600; color: #fff; vertical-align: 1px; }
.okr-rlv.lv-CRITICAL { background: var(--el-color-danger); }
.okr-rlv.lv-WARN { background: #d9a400; color: #3d2d00; }
.okr-rsheet-line { margin: 0; font-size: 13px; color: var(--el-text-color-secondary); }
.okr-rsheet-rates { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.okr-rsheet-rates li { display: flex; align-items: center; gap: 8px; }
.okr-rsheet-wk { width: 76px; flex: none; color: var(--el-text-color-secondary); }
.okr-rsheet-pct { width: 40px; text-align: right; font-weight: 600; }
.okr-mini { flex: 1; height: 8px; border-radius: 4px; background: var(--el-border-color-lighter); overflow: hidden; }
.okr-mini i { display: block; height: 100%; background: var(--el-color-primary); }
.okr-mini i.miss { background: var(--el-color-danger); }
.okr-rsheet-go { min-height: 44px; margin-top: 4px; }
</style>
