<template>
  <!-- 某人最近 12 周: 完成率 + 自评/主管分折线。看别人时也不再放「历史」链接(同一页, 白占一个可点元素) -->
  <div class="okr-history" v-loading="loading">
    <OkrWeekBar
      :year="cur.year" :week-no="cur.weekNo" :week-key="curKey" :active="'history'" :show-team="canTeam"
      @shift="() => {}" class="okr-hist-bar"
    />
    <div v-if="data" class="okr-hist-head">
      <strong>{{ data.owner.name }}</strong>
      <span>{{ $t('okr.history_sub', { p0: data.weeks.length }) }}</span>
    </div>
    <div class="okr-legend">
      <span class="l1">{{ $t('okr.completion') }}</span>
      <span class="l2">{{ $t('okr.self_score') }}</span>
      <span v-if="showMgr" class="l3">{{ $t('okr.manager_score') }}</span>
    </div>
    <div ref="chartEl" class="okr-chart" />
    <!-- 明细只露最近 4 周, 更早的收进「全部 12 周」(首屏可点元素不随周数增长) -->
    <template v-if="data">
      <h4 class="okr-hist-cap">{{ $t('okr.recent_weeks', { p0: recent.length }) }}</h4>
      <ul class="okr-hist-list">
        <OkrHistoryRow v-for="w in recent" :key="w.key" :w="w" :owner-id="ownerId" />
      </ul>
      <template v-if="older.length">
        <button type="button" class="okr-hist-more" :aria-expanded="showAll" @click="showAll = !showAll">
          {{ $t('okr.all_weeks', { p0: data.weeks.length }) }} <span aria-hidden="true">{{ showAll ? '▾' : '▸' }}</span>
        </button>
        <ul v-if="showAll" class="okr-hist-list">
          <OkrHistoryRow v-for="w in older" :key="w.key" :w="w" :owner-id="ownerId" />
        </ul>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { echarts } from '@/utils/echarts.js'
import OkrWeekBar from '@/components/okr/OkrWeekBar.vue'
import OkrHistoryRow from '@/components/okr/OkrHistoryRow.vue'
import { pct, isoWeekOf, weekKey } from './okrUtils.js'
import { canSeeManagerScore, currentUser, viewedUserId } from './okrPeople.js'

const RECENT = 4

const route = useRoute()
const data = ref(null)
const loading = ref(false)
const chartEl = ref(null)
let chart = null
// OKR 2.0: 团队页全员可进; 主管分只给本人与 okr.score.manager(后端对其他人不返回)
const canTeam = computed(() => true)
const meId = String(currentUser().id || '')
const ownerId = computed(() => viewedUserId(route.query))
const showMgr = computed(() => canSeeManagerScore({ ownerId: ownerId.value || meId, meId, canScore: can('okr.score.manager') }))
const cur = isoWeekOf()
const curKey = weekKey(cur)
const showAll = ref(false)
const newestFirst = computed(() => (data.value ? [...data.value.weeks].reverse() : []))
const recent = computed(() => newestFirst.value.slice(0, RECENT))
const older = computed(() => newestFirst.value.slice(RECENT))

async function load() {
  loading.value = true
  try {
    data.value = await fde.okr.history({ ownerId: ownerId.value, weeks: 12 })
    await nextTick()
    draw()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
watch(ownerId, load, { immediate: true })

function draw() {
  if (!chartEl.value || !data.value) return
  chart = chart || echarts.init(chartEl.value)
  const ws = data.value.weeks
  const css = getComputedStyle(document.documentElement)
  const c1 = css.getPropertyValue('--el-color-primary').trim() || '#409eff'
  const c2 = css.getPropertyValue('--el-color-warning').trim() || '#e6a23c'
  const c3 = css.getPropertyValue('--el-color-success').trim() || '#67c23a'
  chart.setOption({
    grid: { left: 32, right: 12, top: 28, bottom: 24 },
    tooltip: { trigger: 'axis', valueFormatter: v => (v == null ? '-' : v) },
    xAxis: { type: 'category', data: ws.map(w => 'W' + w.weekNo), axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, max: 100, interval: 25 },
    series: [
      { name: $t('okr.completion'), type: 'line', data: ws.map(w => (w.completion == null ? null : pct(w.completion))), connectNulls: false, symbolSize: 6, itemStyle: { color: c1 }, lineStyle: { width: 2 } },
      { name: $t('okr.self_score'), type: 'line', data: ws.map(w => w.selfScore), symbolSize: 5, itemStyle: { color: c2 }, lineStyle: { width: 1.5, type: 'dashed' } },
      ...(showMgr.value ? [{ name: $t('okr.manager_score'), type: 'line', data: ws.map(w => w.managerScore), symbolSize: 5, itemStyle: { color: c3 }, lineStyle: { width: 1.5 } }] : [])
    ]
  }, true)
  chart.resize()
}

const onResize = () => chart?.resize()
window.addEventListener('resize', onResize)
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); chart?.dispose() })
</script>

<style scoped>
.okr-history { max-width: 720px; margin: 0 auto; padding: 4px 0 24px; }
.okr-hist-bar :deep(.okr-wb-main) { display: none; }
.okr-hist-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.okr-hist-head span { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-legend { display: flex; gap: 14px; font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.okr-legend span::before { content: ''; display: inline-block; width: 14px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 4px; }
.okr-legend .l1::before { border-color: var(--el-color-primary); }
.okr-legend .l2::before { border-top-style: dashed; border-color: var(--el-color-warning); }
.okr-legend .l3::before { border-color: var(--el-color-success); }
.okr-chart { width: 100%; height: 240px; background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
.okr-hist-cap { margin: 14px 0 0; font-size: 13px; font-weight: 600; }
.okr-hist-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; font-size: 13px; }
.okr-hist-more { margin-top: 8px; padding: 6px 0; border: 0; background: none; color: var(--el-color-primary); font-size: 13px; cursor: pointer; }
</style>
