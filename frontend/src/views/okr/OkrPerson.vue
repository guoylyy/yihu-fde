<template>
  <!-- 个人 OKR 详情(团队列表点进来): 头部五项 + 按周 / 按年。只读; 有代管权限时给「代操作」入口。
       主管评分只给本人与 okr.score.manager(ADMIN): 后端对其他人不返回该字段, 前端也不留列、不留占位 -->
  <div class="okr-person" v-loading="loading">
    <div class="op-top">
      <router-link class="op-back" :to="{ path: '/admin/okr/team', query: weekQuery }">‹ {{ $t('okr.tab_team') }}</router-link>
      <OkrPersonPicker :model-value="userId" :people="people" :me-id="meId" :compact="isMobile" @change="pickPerson" />
    </div>

    <template v-if="ov">
      <header class="op-head">
        <el-avatar :size="isMobile ? 40 : 52" :src="ov.user.avatarUrl || undefined" class="op-av">{{ initialOf(ov.user.name) }}</el-avatar>
        <div class="op-who">
          <strong class="op-name">{{ ov.user.name || ov.user.username }}</strong>
          <span class="op-role">{{ roleLabel(ov.user.role) }}<template v-if="ov.user.teams?.length"> · {{ ov.user.teams.map(t => t.name).join(' / ') }}</template></span>
        </div>
        <div class="op-actions">
          <router-link class="op-link" data-test="op-open-okr" :to="{ path: '/admin/okr', query: okrQuery }">{{ $t('okr.person.open_okr') }}</router-link>
          <el-button v-if="canProxy" type="warning" plain size="small" data-test="op-proxy" @click="goProxy">{{ $t('okr.proxy.act') }}</el-button>
        </div>
      </header>

      <!-- 本周五项 -->
      <p class="op-cap">{{ $t('okr.person.this_week', { p0: ov.current.week }) }}</p>
      <div class="op-stats" data-test="op-stats">
        <div><b>{{ ov.current.objectiveCount }}</b><span>{{ $t('okr.person.o_count') }}</span></div>
        <div><b>{{ ov.current.krCount }}</b><span>{{ $t('okr.person.kr_count') }}</span></div>
        <div><b>{{ ov.current.avgSelfScore ?? '-' }}</b><span>{{ $t('okr.person.avg_self') }}</span></div>
        <div><b :class="{ warn: ov.current.lateCount > 0 }">{{ ov.current.lateCount }}</b><span>{{ $t('okr.person.late_count') }}</span></div>
        <div><b>{{ ov.current.updateCount }}</b><span>{{ $t('okr.person.update_count') }}</span></div>
        <div v-if="showMgr(ov.current)"><b>{{ ov.current.managerScore ?? '-' }}</b><span>{{ $t('okr.manager_score') }}</span></div>
      </div>

      <el-tabs :model-value="tab" class="op-tabs" @update:model-value="setTab">
        <el-tab-pane :label="$t('okr.person.tab_week')" name="week">
          <OkrWeekBar
            :year="weekParts.year" :week-no="weekParts.weekNo" :week-key="weekKeyNow"
            :start="ws?.cycle?.startDate" :end="ws?.cycle?.endDate" hide-links @shift="shift"
          />
          <template v-if="ws">
            <div v-if="ws.objectives.length" class="op-wsum">
              <span>{{ $t('okr.completion') }} <b>{{ pct(ws.summary.completion) ?? '-' }}%</b></span>
              <span>{{ $t('okr.self_score') }} <b>{{ ws.summary.selfScore ?? '-' }}</b></span>
              <span v-if="showMgr(ws.summary)">{{ $t('okr.manager_score') }} <b>{{ ws.summary.managerScore ?? '-' }}</b></span>
              <span>{{ $t('okr.person.updates_n', { p0: ws.summary.updateCount }) }}</span>
              <span v-if="ws.summary.late" class="op-late">{{ $t('okr.late') }}</span>
              <span v-else-if="!ws.summary.submitted" class="op-dim">{{ $t('okr.person.not_submitted') }}</span>
            </div>
            <p v-if="!ws.objectives.length" class="op-empty">{{ $t('okr.person.no_week') }}</p>
            <div class="op-cards">
              <OkrObjectiveCard v-for="o in ws.objectives" :key="o.id" :obj="o" />
            </div>
          </template>
        </el-tab-pane>

        <el-tab-pane :label="$t('okr.person.tab_year')" name="year">
          <div class="op-yearbar">
            <el-select :model-value="year" class="op-year" :aria-label="$t('okr.person.tab_year')" @update:model-value="setYear">
              <el-option v-for="y in years" :key="y" :value="y" :label="$t('okr.person.year_n', { p0: y })" />
            </el-select>
          </div>
          <template v-if="ys">
            <div class="op-stats op-stats-year" data-test="op-year-summary">
              <div><b>{{ ys.summary.weeksParticipated }}</b><span>{{ $t('okr.person.weeks_participated') }}</span></div>
              <div><b>{{ ys.summary.avgSelfScore ?? '-' }}</b><span>{{ $t('okr.person.avg_self') }}</span></div>
              <div><b>{{ pct(ys.summary.completionRate) ?? '-' }}<small v-if="ys.summary.completionRate != null">%</small></b><span>{{ $t('okr.person.completion_rate') }}</span></div>
              <div v-if="showMgr(ys.summary, 'avgManagerScore')"><b>{{ ys.summary.avgManagerScore ?? '-' }}</b><span>{{ $t('okr.person.avg_manager') }}</span></div>
            </div>

            <p v-if="!ys.weeks.length" class="op-empty">{{ $t('okr.person.no_year') }}</p>
            <template v-else>
              <!-- 周度自评均值: 手写 SVG(单序列, 标题即图例); 没分的周断开, 不补 0 -->
              <section class="op-chart">
                <h4>{{ $t('okr.person.trend_title') }}</h4>
                <svg v-if="geo.dots.length" :viewBox="`0 0 ${CW} ${CH}`" class="op-svg" role="img" :aria-label="$t('okr.person.trend_title')">
                  <g class="op-grid">
                    <template v-for="t in geo.ticks" :key="t.value">
                      <line :x1="PAD" :x2="CW - PAD" :y1="t.y" :y2="t.y" />
                      <text :x="PAD - 6" :y="t.y + 4" text-anchor="end">{{ t.value }}</text>
                    </template>
                  </g>
                  <polyline v-for="(seg, i) in geo.segments" :key="i" :points="seg" class="op-line" />
                  <g v-for="d in geo.dots" :key="d.label" class="op-dot">
                    <circle :cx="d.x" :cy="d.y" r="12" class="op-hit"><title>{{ d.label }} · {{ d.value }}</title></circle>
                    <circle :cx="d.x" :cy="d.y" r="4" class="op-mark" />
                  </g>
                  <text v-for="l in xLabels" :key="l.label" :x="l.x" :y="CH - 4" text-anchor="middle" class="op-xl">{{ l.label }}</text>
                </svg>
                <p v-else class="op-empty">{{ $t('okr.person.trend_empty') }}</p>
              </section>

              <!-- 每周: 条形 + 数字(也是图的表格视图) -->
              <section class="op-weeks">
                <h4>{{ $t('okr.person.weekly') }}</h4>
                <ul>
                  <li v-for="w in ys.weeks" :key="w.key" class="op-wrow">
                    <button type="button" class="op-wno" @click="openWeek(w.key)">{{ $t('okr.person.week_short', { p0: w.weekNo }) }}</button>
                    <span class="op-wbar"><i :style="{ width: (pct(w.completion) || 0) + '%' }" /></span>
                    <span class="op-wpct">{{ pct(w.completion) ?? '-' }}%</span>
                    <span class="op-wmeta">
                      <template v-if="w.submitted">{{ $t('okr.person.done_of', { p0: w.done, p1: w.committed }) }}</template>
                      <template v-else>{{ $t('okr.person.not_submitted') }}</template>
                      · {{ $t('okr.self_short') }} {{ w.selfScore ?? '-' }}
                      <template v-if="showMgr(w)"> · {{ $t('okr.manager_short') }} {{ w.managerScore ?? '-' }}</template>
                      <em v-if="w.late" class="op-late">{{ $t('okr.late') }}</em>
                    </span>
                  </li>
                </ul>
              </section>
            </template>
          </template>
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { roleLabel } from '@/api/roles.js'
import { useIsMobile } from '@/composables/useResponsive.js'
import OkrPersonPicker from '@/components/okr/OkrPersonPicker.vue'
import OkrWeekBar from '@/components/okr/OkrWeekBar.vue'
import OkrObjectiveCard from '@/components/okr/OkrObjectiveCard.vue'
import { pct, shiftKey, parseKey, isoWeekOf, weekKey } from './okrUtils.js'
import { initialOf, sameId, canSeeManagerScore, hasField, trendGeometry, yearOptions } from './okrPeople.js'
import { useOkrPeople } from './useOkrPeople.js'

const CW = 640
const CH = 180
const PAD = 28

const route = useRoute()
const router = useRouter()
const isMobile = useIsMobile()
const { meId, people, loadPeople, ensurePerson } = useOkrPeople()

const ov = ref(null)
const ws = ref(null)
const ys = ref(null)
const canProxy = ref(false)
const loading = ref(false)

const userId = computed(() => String(route.params.userId || ''))
const tab = computed(() => (route.query.tab === 'year' ? 'year' : 'week'))
const weekKeyNow = computed(() => ws.value?.week || route.query.week || weekKey(isoWeekOf()))
const weekParts = computed(() => parseKey(weekKeyNow.value) || isoWeekOf())
const weekQuery = computed(() => (route.query.week ? { week: route.query.week } : {}))
const thisYear = isoWeekOf().year
const year = computed(() => Number(route.query.year) || thisYear)
const years = computed(() => yearOptions([...(ov.value?.years || []), { year: year.value }], thisYear))
const okrQuery = computed(() => ({ ...(sameId(userId.value, meId) ? {} : { userId: userId.value }), week: weekKeyNow.value }))

const canScore = can('okr.score.manager')
/** 主管评分: 有权看且后端确实返回了这个字段才画(两道都过才出列) */
function showMgr(obj, key = 'managerScore') {
  return canSeeManagerScore({ ownerId: userId.value, meId, canScore }) && hasField(obj, key)
}

// 横轴按周号连续铺开: 后端只列有 O 的周, 中间没交的周补空值, 折线在那里断开
const trendWeeks = computed(() => {
  const ws = ys.value?.weeks || []
  if (!ws.length) return []
  const by = new Map(ws.map(w => [w.weekNo, w]))
  const out = []
  for (let n = ws[0].weekNo; n <= ws[ws.length - 1].weekNo; n++) out.push({ weekNo: n, selfScore: by.get(n)?.selfScore ?? null })
  return out
})
const geo = computed(() => trendGeometry(
  trendWeeks.value.map(w => ({ label: `W${w.weekNo}`, value: w.selfScore })),
  { width: CW, height: CH - 14, pad: PAD }
))
// 横轴标签: 周多了只挑几个, 不挤
const xLabels = computed(() => {
  const weeks = trendWeeks.value
  const n = weeks.length
  if (!n) return []
  const step = Math.max(1, Math.ceil(n / (isMobile.value ? 5 : 10)))
  const g = trendGeometry(weeks.map(w => ({ label: `W${w.weekNo}`, value: 0 })), { width: CW, height: CH - 14, pad: PAD })
  return g.dots.filter((_, i) => i % step === 0 || i === n - 1).map(d => ({ x: d.x, label: d.label }))
})

async function loadHead() {
  if (!userId.value) return
  loading.value = true
  canProxy.value = false
  try {
    ov.value = await fde.okr.personOverview(userId.value)
    ensurePerson(ov.value.user)
    // 代管权限以后端为准: /my 的 can.proxy(本人不需要)
    if (!sameId(userId.value, meId)) {
      fde.okr.my({ ownerId: userId.value }).then(d => { canProxy.value = !!d?.can?.proxy }).catch(() => {})
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function loadWeek() {
  if (!userId.value) return
  try {
    ws.value = await fde.okr.stats({ userId: userId.value, scope: 'week', week: route.query.week || 'current' })
  } catch (e) { ElMessage.error(e.message) }
}

async function loadYear() {
  if (!userId.value) return
  try {
    ys.value = await fde.okr.stats({ userId: userId.value, scope: 'year', year: year.value })
  } catch (e) { ElMessage.error(e.message) }
}

watch(userId, () => { ov.value = null; ws.value = null; ys.value = null; loadHead() }, { immediate: true })
watch(() => [userId.value, route.query.week], loadWeek, { immediate: true })
watch(() => [userId.value, year.value, tab.value], () => { if (tab.value === 'year') loadYear() }, { immediate: true })
watch(() => route.query.week, w => loadPeople(w), { immediate: true })

function setTab(t) {
  router.replace({ query: { ...route.query, tab: t === 'year' ? 'year' : undefined } })
}
function setYear(y) {
  router.replace({ query: { ...route.query, year: y === thisYear ? undefined : String(y) } })
}
function shift(delta) {
  router.replace({ query: { ...route.query, week: shiftKey(weekKeyNow.value, delta) } })
}
function openWeek(key) {
  router.replace({ query: { ...route.query, week: key, tab: undefined } })
}
function pickPerson(id) {
  if (id && !sameId(id, userId.value)) router.push({ path: `/admin/okr/person/${id}`, query: route.query })
}
function goProxy() {
  router.push({ path: '/admin/okr', query: { userId: userId.value, week: weekKeyNow.value } })
}
</script>

<style scoped>
.okr-person { max-width: 880px; margin: 0 auto; padding: 4px 0 24px; }
.op-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.op-back { font-size: 13px; color: var(--el-color-primary); text-decoration: none; padding: 12px 0; }
.op-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.op-av { flex: none; font-size: 18px; }
.op-who { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.op-name { font-size: 18px; line-height: 1.3; overflow-wrap: anywhere; }
.op-role { font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.op-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.op-link { font-size: 13px; color: var(--el-color-primary); text-decoration: none; padding: 12px 0; }
.op-cap { margin: 4px 0 6px; font-size: 12px; color: var(--el-text-color-secondary); }
.op-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 12px; }
.op-stats > div { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px 6px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.op-stats b { font-size: 22px; line-height: 1.2; color: var(--el-text-color-primary); }
.op-stats b.warn { color: var(--el-color-warning-dark-2); }
.op-stats small { font-size: 13px; }
.op-stats span { font-size: 12px; color: var(--el-text-color-secondary); text-align: center; }
.op-tabs :deep(.el-tabs__item) { min-height: 44px; }
.op-wsum { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-bottom: 10px; font-size: 13px; color: var(--el-text-color-secondary); }
.op-wsum b { color: var(--el-text-color-primary); font-size: 15px; }
.op-late { color: var(--el-color-danger); font-style: normal; margin-left: 4px; }
.op-dim { color: var(--el-text-color-secondary); }
.op-cards { display: flex; flex-direction: column; gap: 10px; }
.op-empty { color: var(--el-text-color-secondary); font-size: 13px; text-align: center; padding: 20px 0; margin: 0; }
.op-yearbar { display: flex; justify-content: flex-end; margin-bottom: 10px; }
.op-year { width: 140px; }
.op-year :deep(.el-select__wrapper) { min-height: 40px; }
.op-chart, .op-weeks { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
.op-chart h4, .op-weeks h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.op-svg { display: block; width: 100%; height: auto; overflow: visible; }
.op-grid line { stroke: var(--el-border-color-lighter); stroke-width: 1; }
.op-grid text, .op-xl { fill: var(--el-text-color-secondary); font-size: 10px; }
.op-line { fill: none; stroke: var(--el-color-primary); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.op-mark { fill: var(--el-color-primary); stroke: var(--el-bg-color); stroke-width: 2; pointer-events: none; }
.op-hit { fill: transparent; cursor: default; }
.op-dot:hover .op-mark { r: 6; }
.op-weeks ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.op-wrow { display: grid; grid-template-columns: 64px 1fr 44px; grid-template-areas: 'no bar pct' 'no meta meta'; align-items: center; column-gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--el-border-color-extra-light); }
.op-wno { grid-area: no; border: 0; background: none; padding: 0; min-height: 44px; text-align: left; font: inherit; font-size: 13px; color: var(--el-color-primary); cursor: pointer; }
.op-wbar { grid-area: bar; height: 6px; border-radius: 3px; background: var(--el-border-color-lighter); overflow: hidden; }
.op-wbar i { display: block; height: 100%; background: var(--el-color-primary); border-radius: 3px; }
.op-wpct { grid-area: pct; font-size: 13px; font-weight: 600; text-align: right; }
.op-wmeta { grid-area: meta; font-size: 12px; color: var(--el-text-color-secondary); }
@media (max-width: 640px) {
  .op-head { flex-wrap: wrap; }
  .op-actions { width: 100%; justify-content: space-between; }
  .op-actions .el-button { min-height: 44px; padding: 0 16px; }
  .op-stats { grid-template-columns: repeat(3, 1fr); }
  .op-stats b { font-size: 18px; }
}
</style>
