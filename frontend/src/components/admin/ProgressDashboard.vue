<template>
  <!-- v2.0.5(#406/#407/#408/#409) 进展驾驶舱: 消费 progress-dashboard 聚合接口
       设计: docs/04-技术设计/v2.0.5-进展驾驶舱设计.md -->
  <div v-loading="loading" class="pd">
    <template v-if="d">
      <!-- #406 KPI 条 -->
      <div class="pd-kpis">
        <div class="pd-kpi">
          <div class="pd-kpi-num"><span class="health-dot" :class="'h-' + (d.project.health || 'GREEN')"></span>{{ healthLabel }}</div>
          <div class="pd-kpi-label">{{ $t('common.health') }}</div>
        </div>
        <div class="pd-kpi"><div class="pd-kpi-num">{{ d.project.progress }}%</div><div class="pd-kpi-label">{{ $t('common.project_progress') }}</div></div>
        <div class="pd-kpi" v-if="d.hours"><div class="pd-kpi-num">{{ weekHours }}<span class="pd-unit">h</span></div><div class="pd-kpi-label">{{ $t('progressDashboard.hours_this_week') }}</div></div>
        <div class="pd-kpi"><div class="pd-kpi-num">{{ d.commits.last7 }}</div><div class="pd-kpi-label">{{ $t('progressDashboard.commits_7d') }}</div></div>
        <div class="pd-kpi"><div class="pd-kpi-num">{{ d.tasks.completionRate }}%</div><div class="pd-kpi-label">{{ $t('progressDashboard.task_completion') }}</div></div>
        <div class="pd-kpi"><div class="pd-kpi-num">{{ d.tasks.weekDone }}</div><div class="pd-kpi-label">{{ $t('progressDashboard.tasks_done_this_week') }}</div></div>
        <div class="pd-kpi"><div class="pd-kpi-num">🔥 {{ d.project.activityScore }}</div><div class="pd-kpi-label">{{ $t('progressDashboard.activity_score') }}</div></div>
        <div class="pd-kpi-actions">
          <el-button size="small" :icon="Refresh" circle @click="load()" />
          <el-button size="small" type="primary" plain @click="enterScreen">{{ $t('progressDashboard.presentation_mode') }}</el-button>
        </div>
      </div>

      <!-- #407 里程碑泳道 -->
      <div class="pd-card">
        <div class="pd-card-title">{{ $t('progressDashboard.milestones_done', { p0: msDone, p1: d.milestones.length }) }}</div>
        <div class="ms-lane">
          <div v-for="m in d.milestones" :key="m.id" class="ms-node" :class="['ms-' + m.status, { 'ms-overdue': m.overdue }]">
            <div class="ms-name" :title="m.name">{{ m.name }}</div>
            <div class="ms-dates">
              <span>{{ $t('progressDashboard.planned', { p0: fd(m.plannedDate) || '—' }) }}</span>
              <span v-if="m.actualDate" class="ms-actual">{{ $t('progressDashboard.actual', { p0: fd(m.actualDate) }) }}</span>
              <span v-else-if="m.overdue" class="ms-warn">{{ $t('progressDashboard.overdue') }}</span>
            </div>
          </div>
          <el-empty v-if="!d.milestones.length" :description="$t('common.no_milestones')" :image-size="50" />
        </div>
      </div>

      <!-- #408 三卡片 -->
      <div class="pd-row">
        <div class="pd-card">
          <div class="pd-card-title">{{ $t('progressDashboard.task_states_total', { p0: d.tasks.total }) }}</div>
          <div class="st-bars">
            <div v-for="s in STATES" :key="s.key" class="st-bar-row">
              <span class="st-label">{{ s.label }}</span>
              <div class="st-track"><div class="st-fill" :style="{ width: pct(d.tasks.byStatus[s.key]) + '%', background: s.color }"></div></div>
              <span class="st-num">{{ d.tasks.byStatus[s.key] || 0 }}</span>
            </div>
          </div>
          <template v-if="d.tasks.byAssignee?.length">
            <div class="pd-sub-title">{{ $t('progressDashboard.by_assignee') }}</div>
            <div v-for="a in d.tasks.byAssignee.slice(0, 6)" :key="a.name" class="pp-row">
              <span class="pp-name">{{ a.name }}</span>
              <span class="muted">{{ $t('common.done', { p0: a.done, p1: a.total }) }}</span>
            </div>
          </template>
        </div>

        <div v-if="d.hours" class="pd-card">
          <div class="pd-card-title">{{ $t('progressDashboard.hours_last_12_weeks_h', { p0: d.hours.totalHours }) }}</div>
          <div ref="hoursChartRef" class="pd-chart"></div>
          <div class="pd-sub-title">{{ $t('progressDashboard.people') }}</div>
          <div v-for="p in d.hours.byPerson.slice(0, 6)" :key="p.name" class="pp-row">
            <span class="pp-name">{{ p.name }}</span>
            <span class="muted">{{ p.hours }}h</span>
          </div>
          <!-- v2.0.8(#425): 预算消耗随财务模块下线(后端字段保留) -->
          <div v-if="false && d.hours.consumptionRate != null" class="pp-row" style="margin-top: 6px;">
            <span class="pp-name">{{ $t('progressDashboard.budget_used') }}</span>
            <el-progress :percentage="Math.min(d.hours.consumptionRate, 100)" :stroke-width="8" style="flex: 1;"
              :color="d.hours.consumptionRate > 90 ? '#c2362b' : '#d2521e'" />
          </div>
        </div>

        <div class="pd-card">
          <div class="pd-card-title">{{ $t('progressDashboard.code_activity_7d_30d', { p0: d.commits.last7, p1: d.commits.last30 }) }}</div>
          <div class="cm-bars">
            <div v-for="b in commitBars" :key="b.date" class="cm-bar" :title="$t('progressDashboard.commits', { p0: b.date, p1: b.count })"
              :style="{ height: b.h + '%' }"></div>
          </div>
          <template v-if="d.commits.recent?.length">
            <div class="pd-sub-title">{{ $t('progressDashboard.recent_commits') }}</div>
            <div v-for="c in d.commits.recent" :key="c.sha" class="cm-recent" :title="c.title">
              <span class="cm-title">{{ c.title }}</span>
              <span class="muted small">{{ c.author }} · {{ fd(c.happenedAt) }}</span>
            </div>
          </template>
          <template v-if="d.commits.repos?.length">
            <div class="pd-sub-title">{{ $t('progressDashboard.repository_sync') }}</div>
            <div v-for="r in d.commits.repos" :key="r.id" class="pp-row">
              <span class="pp-name">{{ r.name }}</span>
              <span class="muted small">{{ $t('common.p0', { p0: r.syncError ? $t('progressDashboard.sync_error') : (r.lastSyncedAt ? '✓ ' + fd(r.lastSyncedAt) : $t('progressDashboard.not_synced')) }) }}</span>
            </div>
          </template>
        </div>
      </div>
    </template>

    <!-- #409 客户投屏模式: 深色大字号 + 自动轮播, 数据走 view=customer(服务端脱敏) -->
    <Teleport to="body">
      <div v-if="screen.on" class="pd-screen" @click="screen.paused = !screen.paused">
        <div class="pds-head">
          <span class="pds-title">{{ $t('progressDashboard.project_progress', { p0: d?.project?.name }) }}</span>
          <span class="pds-meta">{{ $t('common.p0', { p0: screen.paused ? $t('progressDashboard.paused_click_resume') : $t('progressDashboard.screen_3', { p0: screen.idx + 1 }) }) }}
            <el-button size="small" text style="color: #aaa;" @click.stop="exitScreen">{{ $t('progressDashboard.exit_esc') }}</el-button>
          </span>
        </div>
        <div v-if="screen.d" class="pds-body">
          <!-- 屏1: 概览 + 里程碑 -->
          <div v-if="screen.idx === 0" class="pds-panel">
            <div class="pds-kpis">
              <div class="pds-kpi"><div class="pds-num"><span class="health-dot big" :class="'h-' + (screen.d.project.health || 'GREEN')"></span></div><div class="pds-label">{{ $t('common.health') }}</div></div>
              <div class="pds-kpi"><div class="pds-num">{{ screen.d.project.progress }}%</div><div class="pds-label">{{ $t('progressDashboard.overall_progress') }}</div></div>
              <div class="pds-kpi"><div class="pds-num">{{ screen.d.tasks.completionRate }}%</div><div class="pds-label">{{ $t('progressDashboard.task_completion') }}</div></div>
              <div class="pds-kpi"><div class="pds-num">{{ msDoneOf(screen.d) }}/{{ screen.d.milestones.length }}</div><div class="pds-label">{{ $t('progressDashboard.milestones_done_2') }}</div></div>
            </div>
            <div class="pds-ms">
              <div v-for="m in screen.d.milestones" :key="m.id" class="pds-ms-node" :class="['ms-' + m.status]">
                <span class="pds-ms-dot"></span>{{ m.name }}
                <span class="pds-ms-date">{{ fd(m.actualDate || m.plannedDate) }}</span>
              </div>
            </div>
          </div>
          <!-- 屏2: 任务完成情况 -->
          <div v-else-if="screen.idx === 1" class="pds-panel">
            <div class="pds-panel-title">{{ $t('progressDashboard.task_progress') }}</div>
            <div class="st-bars big">
              <div v-for="s in STATES" :key="s.key" class="st-bar-row">
                <span class="st-label">{{ s.label }}</span>
                <div class="st-track"><div class="st-fill" :style="{ width: pctOf(screen.d, s.key) + '%', background: s.color }"></div></div>
                <span class="st-num">{{ screen.d.tasks.byStatus[s.key] || 0 }}</span>
              </div>
            </div>
            <div class="pds-big-line">{{ $t('progressDashboard.done_this_week') }} <b>{{ screen.d.tasks.weekDone }}</b> {{ $t('progressDashboard.tasks_overall_completion') }} <b>{{ screen.d.tasks.completionRate }}%</b></div>
          </div>
          <!-- 屏3: 研发活跃度 -->
          <div v-else class="pds-panel">
            <div class="pds-panel-title">{{ $t('progressDashboard.development_activity') }}</div>
            <div class="cm-bars big">
              <div v-for="b in commitBarsOf(screen.d)" :key="b.date" class="cm-bar" :style="{ height: b.h + '%' }"></div>
            </div>
            <div class="pds-big-line">{{ $t('progressDashboard.last_7_days') }} <b>{{ screen.d.commits.last7 }}</b> {{ $t('progressDashboard.updates_last_30_days') }} <b>{{ screen.d.commits.last30 }}</b> {{ $t('progressDashboard.updates') }}</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { echarts } from '@/utils/echarts.js'
import { fde } from '@/api/index.js'

const props = defineProps({ projectId: { type: [String, Number], required: true } })

const STATES = [
  { key: 'TODO', label: $t('common.inbox'), color: '#909399' },
  { key: 'QUEUED', label: $t('common.queued'), color: '#b3771e' },
  { key: 'IN_PROGRESS', label: $t('common.in_progress_2'), color: '#1c1917' },
  { key: 'DONE', label: $t('common.built'), color: '#2e7d4f' },
  { key: 'VERIFIED', label: $t('common.accepted'), color: '#85ce61' }
]

const loading = ref(false)
const d = ref(null)
const hoursChartRef = ref(null)

const healthLabel = computed(() => ({ GREEN: $t('progressDashboard.normal'), YELLOW: $t('progressDashboard.watch'), RED: $t('common.risks') }[d.value?.project?.health] || d.value?.project?.health || '—'))
const msDone = computed(() => (d.value?.milestones || []).filter(m => m.status === 'COMPLETED').length)
function msDoneOf(data) { return (data?.milestones || []).filter(m => m.status === 'COMPLETED').length }
const weekHours = computed(() => {
  const w = d.value?.hours?.weekly
  return w?.length ? w[w.length - 1].hours : 0
})
function fd(v) { return v ? String(v).slice(0, 10) : '' }
function pct(n) { return d.value?.tasks?.total ? Math.round((n || 0) / d.value.tasks.total * 100) : 0 }
function pctOf(data, key) { return data?.tasks?.total ? Math.round((data.tasks.byStatus[key] || 0) / data.tasks.total * 100) : 0 }

// 30 日 commit 柱: 补零成连续 30 天
function buildCommitBars(data) {
  const map = new Map((data?.commits?.daily || []).map(x => [x.date, x.count]))
  const out = []
  let max = 1
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10)
    const count = map.get(day) || 0
    max = Math.max(max, count)
    out.push({ date: day, count })
  }
  return out.map(x => ({ ...x, h: Math.max(4, Math.round(x.count / max * 100)) }))
}
const commitBars = computed(() => buildCommitBars(d.value))
function commitBarsOf(data) { return buildCommitBars(data) }

async function load() {
  loading.value = true
  try {
    d.value = await fde.projects.progressDashboard(props.projectId)
    nextTick(renderHoursChart)
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

function renderHoursChart() {
  if (!hoursChartRef.value || !d.value?.hours) return
  echarts.init(hoursChartRef.value).setOption({
    grid: { left: 34, right: 8, top: 10, bottom: 20 },
    xAxis: { type: 'category', data: d.value.hours.weekly.map(w => w.week.slice(5)), axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    series: [{ type: 'line', smooth: true, data: d.value.hours.weekly.map(w => w.hours), itemStyle: { color: '#d2521e' }, areaStyle: { opacity: 0.1 } }],
    tooltip: { trigger: 'axis' }
  })
}

// ---------- #409 投屏 ----------
const screen = reactive({ on: false, d: null, idx: 0, timer: null, paused: false })
async function enterScreen() {
  try {
    // 投屏数据走 customer 视角: 服务端已脱敏(无工时/成本/人名/commit明细)
    screen.d = await fde.projects.progressDashboard(props.projectId, 'customer')
    screen.on = true
    screen.idx = 0
    screen.paused = false
    screen.timer = setInterval(() => { if (!screen.paused) screen.idx = (screen.idx + 1) % 3 }, 10000)
    document.addEventListener('keydown', onScreenKey)
  } catch (e) { ElMessage.error(e.message) }
}
function exitScreen() {
  screen.on = false
  clearInterval(screen.timer)
  document.removeEventListener('keydown', onScreenKey)
}
function onScreenKey(e) { if (e.key === 'Escape') exitScreen() }

// 隐藏 Tab 中挂载时容器宽 0, 由父级在 Tab 激活时调用重画
function rerenderChart() {
  if (hoursChartRef.value) {
    echarts.getInstanceByDom(hoursChartRef.value)?.dispose()
    renderHoursChart()
  }
}

onMounted(load)
onUnmounted(() => { clearInterval(screen.timer); document.removeEventListener('keydown', onScreenKey) })
defineExpose({ load, rerenderChart })
</script>

<style scoped>
.pd { display: flex; flex-direction: column; gap: 14px; }
/* KPI 条 */
.pd-kpis { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
.pd-kpi { background: #faf9f7; border: 1px solid #eae7e2; border-radius: 10px; padding: 10px 18px; text-align: center; min-width: 92px; }
.pd-kpi-num { font-size: 20px; font-weight: 800; color: #1c1917; }
.pd-unit { font-size: 12px; font-weight: 400; color: #909399; }
.pd-kpi-label { font-size: 12px; color: #868580; margin-top: 2px; }
.pd-kpi-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.health-dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; }
.health-dot.big { width: 28px; height: 28px; margin: 0; }
.h-GREEN { background: #2e7d4f; } .h-YELLOW { background: #e6a23c; } .h-RED { background: #c2362b; }

.pd-card { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 14px 16px; flex: 1; min-width: 0; }
.pd-card-title { font-weight: 700; font-size: 14px; color: #1c1917; margin-bottom: 10px; }
.pd-sub-title { font-size: 12px; color: #868580; margin: 12px 0 6px; font-weight: 600; }
.pd-row { display: flex; gap: 14px; align-items: stretch; flex-wrap: wrap; }
.pd-row .pd-card { min-width: 280px; }
.pd-chart { height: 140px; }

/* #407 里程碑泳道 */
.ms-lane { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.ms-node { flex: 1; min-width: 170px; border-top: 3px solid #c8c3bb; background: #faf9f7; border-radius: 8px; padding: 10px 12px; }
.ms-PENDING { border-top-color: #c8c3bb; }
.ms-IN_PROGRESS { border-top-color: #d2521e; }
.ms-COMPLETED { border-top-color: #2e7d4f; }
.ms-overdue { border: 1px solid #f0b8b3; border-top: 3px solid #c2362b; background: #fdf5f4; }
.ms-name { font-weight: 600; font-size: 13px; color: #1c1917; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-dates { display: flex; gap: 8px; font-size: 11px; color: #909399; margin-top: 6px; flex-wrap: wrap; }
.ms-actual { color: #2e7d4f; }
.ms-warn { color: #c2362b; font-weight: 600; }

/* #408 五态条 */
.st-bars { display: flex; flex-direction: column; gap: 8px; }
.st-bar-row { display: flex; align-items: center; gap: 8px; }
.st-label { width: 60px; font-size: 12px; color: #5c574f; flex: none; }
.st-track { flex: 1; height: 10px; background: #f0eee9; border-radius: 5px; overflow: hidden; }
.st-fill { height: 100%; border-radius: 5px; transition: width 0.4s; }
.st-num { width: 26px; text-align: right; font-size: 12px; font-weight: 700; color: #1c1917; }
.pp-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 3px 0; gap: 10px; }
.pp-name { color: #1c1917; }

/* #408 commit 柱 */
.cm-bars { display: flex; align-items: flex-end; gap: 2px; height: 70px; }
.cm-bars.big { height: 200px; gap: 6px; }
.cm-bar { flex: 1; background: #d2521e; border-radius: 2px 2px 0 0; min-height: 3px; opacity: 0.85; }
.cm-recent { display: flex; flex-direction: column; padding: 4px 0; border-bottom: 1px dashed #f0ede8; }
.cm-title { font-size: 12px; color: #1c1917; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.small { font-size: 11px; }
.muted { color: #909399; }

/* #409 投屏 */
.pd-screen { position: fixed; inset: 0; z-index: 3000; background: #141210; color: #f5f2ec; display: flex; flex-direction: column; cursor: pointer; }
.pds-head { display: flex; justify-content: space-between; align-items: center; padding: 22px 36px; border-bottom: 1px solid #2c2824; }
.pds-title { font-size: 24px; font-weight: 800; }
.pds-meta { font-size: 13px; color: #8d867c; display: flex; align-items: center; gap: 10px; }
.pds-body { flex: 1; display: flex; align-items: center; justify-content: center; padding: 30px 50px; }
.pds-panel { width: 100%; max-width: 1100px; }
.pds-panel-title { font-size: 30px; font-weight: 800; margin-bottom: 30px; text-align: center; }
.pds-kpis { display: flex; gap: 24px; justify-content: center; margin-bottom: 46px; }
.pds-kpi { text-align: center; background: #1e1b18; border-radius: 16px; padding: 26px 40px; }
.pds-num { font-size: 44px; font-weight: 800; }
.pds-label { font-size: 15px; color: #8d867c; margin-top: 6px; }
.pds-ms { display: flex; flex-direction: column; gap: 14px; max-width: 720px; margin: 0 auto; }
.pds-ms-node { display: flex; align-items: center; gap: 12px; font-size: 20px; }
.pds-ms-dot { width: 14px; height: 14px; border-radius: 50%; background: #57534e; flex: none; }
.pds-ms-node.ms-COMPLETED .pds-ms-dot { background: #4ade80; }
.pds-ms-node.ms-IN_PROGRESS .pds-ms-dot { background: #fb923c; }
.pds-ms-date { margin-left: auto; color: #8d867c; font-size: 15px; }
.pds-big-line { text-align: center; font-size: 22px; margin-top: 34px; color: #d6d0c8; }
.pds-big-line b { color: #fb923c; font-size: 30px; }
.pd-screen .st-bars.big .st-label { width: 110px; font-size: 18px; color: #d6d0c8; }
.pd-screen .st-bars.big .st-track { height: 22px; background: #2c2824; }
.pd-screen .st-bars.big .st-num { width: 50px; font-size: 20px; color: #f5f2ec; }
.pd-screen .st-bars.big { gap: 18px; max-width: 800px; margin: 0 auto; }
</style>
