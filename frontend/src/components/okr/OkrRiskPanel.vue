<template>
  <!-- OKR 10.0 团队页顶部(周进度条上方, 只给 ADMIN / MANAGER): 「N 个 O 连续未达成(M 红线)」, 数字直接用后端 summary。
       点开列出 O / 负责人 / 连续周数 / 最近三周完成率小条形 -->
  <section v-if="counts.total" class="okr-rpanel" :class="{ red: counts.critical > 0 }" data-test="okr-risk-panel">
    <button type="button" class="okr-rpanel-head" :aria-expanded="open" data-test="okr-risk-toggle" @click="open = !open">
      <span class="okr-rpanel-dot" aria-hidden="true" />
      <span class="okr-rpanel-text" data-test="okr-risk-summary">{{ $t('okr.fe5.risk_team', { p0: counts.total, p1: counts.critical }) }}</span>
      <span aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
    </button>
    <div v-if="open" class="okr-rpanel-body">
      <div class="okr-rrow okr-rrow-head" aria-hidden="true">
        <span>{{ $t('okr.fe5.risk_col_o') }}</span>
        <span>{{ $t('okr.fe5.risk_col_owner') }}</span>
        <span>{{ $t('okr.fe5.risk_col_weeks') }}</span>
        <span>{{ $t('okr.fe5.risk_col_rates') }}</span>
      </div>
      <div v-for="it in items" :key="it.objectiveId" class="okr-rrow" :data-test="'okr-risk-row-' + it.objectiveId">
        <span class="okr-rrow-o">
          <i class="okr-rdot" :class="'lv-' + it.level" :title="$t('okr.fe5.risk_level.' + it.level)" />
          <button type="button" class="okr-rrow-link" :title="it.title" @click="$emit('open', it)">{{ it.title }}</button>
          <em v-if="it.hasOverdueBlocker" class="okr-rrow-blk">{{ $t('okr.fe5.risk_overdue_blocker') }}</em>
        </span>
        <span class="okr-rrow-owner">{{ it.ownerName }}</span>
        <span class="okr-rrow-n" :class="'lv-' + it.level">{{ $t('okr.fe5.risk_weeks_n', { p0: it.consecutiveMissedWeeks }) }}</span>
        <span class="okr-rrow-rates" role="img" :aria-label="rateLabel(it)">
          <span v-for="r in recentRates(it, 3)" :key="r.week" class="okr-rbar3" :title="`${r.week} · ${r.pct == null ? '-' : r.pct + '%'}`">
            <i :class="{ miss: r.missed, none: r.pct == null }" :style="{ height: Math.max(r.pct ?? 0, 4) + '%' }" />
          </span>
          <small>{{ rateLabel(it) }}</small>
        </span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { riskSummaryCounts, recentRates } from '@/views/okr/okrFe5.js'

const props = defineProps({
  /** GET /api/okr/risk/objectives 的返回 */
  risk: { type: Object, default: null },
  defaultOpen: Boolean
})
defineEmits(['open'])
const open = ref(props.defaultOpen)
const counts = computed(() => riskSummaryCounts(props.risk?.summary))
const items = computed(() => props.risk?.items || [])
const rateLabel = it => recentRates(it, 3).map(r => (r.pct == null ? '-' : r.pct + '%')).join(' → ')
</script>

<style scoped>
/* 只有黄线时用黄色(主题 warning 是橙红); 有红线时整条红 */
.okr-rpanel { margin-bottom: 10px; border-radius: 10px; border: 1px solid #ecd27a; background: #fdf7dc; color: #7a5a00; }
.okr-rpanel.red { border-color: var(--el-color-danger-light-5); background: var(--el-color-danger-light-9); color: var(--el-color-danger-dark-2); }
.okr-rpanel-head { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; background: none; font: inherit; font-size: 13px; font-weight: 600; color: inherit; cursor: pointer; text-align: left; }
.okr-rpanel-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.okr-rpanel-text { flex: 1; min-width: 0; }
.okr-rpanel-body { padding: 0 12px 10px; color: var(--el-text-color-primary); }
.okr-rrow { display: grid; grid-template-columns: minmax(0, 1fr) 90px 72px 170px; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; border-top: 1px solid var(--el-border-color-lighter); }
.okr-rrow-head { font-size: 12px; color: var(--el-text-color-secondary); border-top: 0; padding-top: 0; }
.okr-rrow-o { display: flex; align-items: center; gap: 6px; min-width: 0; }
.okr-rrow-link { min-width: 0; border: 0; background: none; padding: 0; font: inherit; color: var(--el-color-primary); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.okr-rrow-blk { flex: none; font-style: normal; font-size: 11px; color: var(--el-color-danger); }
.okr-rrow-owner { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-rrow-n { font-weight: 600; }
.okr-rrow-n.lv-CRITICAL { color: var(--el-color-danger); }
.okr-rrow-n.lv-WARN { color: #7a5a00; }
.okr-rdot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.okr-rdot.lv-CRITICAL { background: var(--el-color-danger); }
.okr-rdot.lv-WARN { background: #d9a400; }
.okr-rrow-rates { display: flex; align-items: flex-end; gap: 3px; height: 22px; }
.okr-rbar3 { display: flex; align-items: flex-end; width: 10px; height: 100%; border-radius: 2px; background: var(--el-border-color-lighter); overflow: hidden; }
.okr-rbar3 i { display: block; width: 100%; background: var(--el-color-primary); }
.okr-rbar3 i.miss { background: var(--el-color-danger); }
.okr-rbar3 i.none { background: transparent; }
.okr-rrow-rates small { margin-left: 6px; align-self: center; font-size: 11px; color: var(--el-text-color-secondary); white-space: nowrap; }
@media (max-width: 768px) {
  .okr-rpanel-head { min-height: 44px; }
  .okr-rrow-head { display: none; }
  .okr-rrow { grid-template-columns: minmax(0, 1fr) auto; row-gap: 2px; }
  .okr-rrow-o { grid-column: 1 / -1; }
  .okr-rrow-link { min-height: 32px; }
  .okr-rrow-owner { font-size: 12px; color: var(--el-text-color-secondary); }
  .okr-rrow-rates { grid-column: 1 / -1; }
}
</style>
