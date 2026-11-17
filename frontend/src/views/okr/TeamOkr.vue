<template>
  <!-- 团队视图(仅老板): 本周矩阵 + 三个数 + 连续两周完成率偏低(不排名、不做红黑榜) -->
  <div class="okr-team" v-loading="loading">
    <OkrWeekBar
      :year="weekParts.year" :week-no="weekParts.weekNo" :week-key="weekKeyNow"
      :start="data?.cycle?.startDate" :end="data?.cycle?.endDate"
      :tag-text="data?.cycle?.status ? $t('okr.cycle_status.' + data.cycle.status) : ''" :tag-type="cycleTag"
      active="team" show-team @shift="shift"
    />

    <template v-if="data">
      <div class="okr-kpis">
        <div><b>{{ data.summary.expected }}</b><span>{{ $t('okr.expected') }}</span></div>
        <div><b>{{ data.summary.submitted }}</b><span>{{ $t('okr.submitted_count') }}<em v-if="data.summary.late">{{ $t('okr.late_n', { p0: data.summary.late }) }}</em></span></div>
        <div><b>{{ pct(data.summary.avgCompletion) ?? '-' }}<small v-if="data.summary.avgCompletion != null">%</small></b><span>{{ $t('okr.avg_completion') }}</span></div>
      </div>

      <!-- 矩阵只读(人多了也不增加可点元素); 进某人详情/打分只走这一个选择器。未交、未打主管分的排前 -->
      <div class="okr-pick">
        <el-select :model-value="null" filterable :placeholder="$t('okr.open_person')" class="okr-pick-sel" @change="openById">
          <el-option v-for="row in pickRows" :key="row.user.id" :value="row.user.id" :label="row.user.name">
            <span>{{ row.user.name }}</span>
            <span class="okr-pick-hint">{{ pickHint(row) }}</span>
          </el-option>
        </el-select>
      </div>

      <!-- 桌面: 表格; 手机: 每人一行卡片, 不出横向滚动 -->
      <el-table v-if="!isMobile" :data="data.rows" class="okr-matrix">
        <el-table-column :label="$t('okr.engineer')" min-width="140">
          <template #default="{ row }">{{ row.user.name }}</template>
        </el-table-column>
        <el-table-column :label="$t('okr.submission')" width="96" align="center">
          <template #default="{ row }"><span :class="subClass(row)">{{ subText(row) }}</span></template>
        </el-table-column>
        <el-table-column :label="$t('okr.o_count')" width="70" align="center" prop="objectiveCount" />
        <el-table-column :label="$t('okr.kr_completion')" min-width="150">
          <template #default="{ row }">
            <template v-if="row.completion != null">
              <span class="okr-bar"><i :style="{ width: pct(row.completion) + '%' }" /></span>
              <span class="okr-cell-pct">{{ pct(row.completion) }}%</span>
              <span class="okr-cell-sub">{{ row.krDone }}/{{ row.krTotal }}</span>
            </template>
            <span v-else class="okr-dim">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('okr.self_score')" width="80" align="center">
          <template #default="{ row }">{{ row.selfScore ?? '-' }}</template>
        </el-table-column>
        <el-table-column :label="$t('okr.manager_score')" width="80" align="center">
          <template #default="{ row }">{{ row.managerScore ?? '-' }}</template>
        </el-table-column>
      </el-table>

      <ul v-else class="okr-mlist">
        <li v-for="row in data.rows" :key="row.user.id" class="okr-mrow">
          <span class="okr-m-name">{{ row.user.name }}</span>
          <span :class="subClass(row)">{{ subText(row) }}</span>
          <span class="okr-m-stats">
            <template v-if="row.completion != null">{{ pct(row.completion) }}% · {{ row.objectiveCount }}O · {{ $t('okr.self_short') }}{{ row.selfScore ?? '-' }} · {{ $t('okr.manager_short') }}{{ row.managerScore ?? '-' }}</template>
            <template v-else>-</template>
          </span>
        </li>
      </ul>

      <section v-if="data.lowStreak.people.length" class="okr-low">
        <h3>{{ $t('okr.low_streak_title') }}</h3>
        <p class="okr-low-sub">{{ $t('okr.low_streak_sub', { p0: data.lowStreak.weeks.join(' / ') }) }}</p>
        <ul>
          <li v-for="p in data.lowStreak.people" :key="p.user.id">
            <router-link :to="{ path: '/admin/okr/history', query: { ownerId: p.user.id } }">{{ p.user.name }}</router-link>
            <span>{{ p.completions.map(c => pct(c) + '%').join(' → ') }}</span>
          </li>
        </ul>
      </section>

      <!-- 周期管理收成一个菜单: 归档 / 重开都要二次确认并写清后果 -->
      <div v-if="canManage && data.cycle?.id && (canClose || canReopen)" class="okr-admin">
        <el-dropdown trigger="click" @command="(c) => (c === 'close' ? closeWeek() : reopenWeek())">
          <el-button size="small">{{ $t('okr.manage_cycle') }} ▾</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-if="canClose" command="close">{{ $t('okr.close_week') }}</el-dropdown-item>
              <el-dropdown-item v-if="canReopen" command="reopen" class="okr-danger-item">{{ $t('okr.reopen_week') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { useIsMobile } from '@/composables/useResponsive.js'
import OkrWeekBar from '@/components/okr/OkrWeekBar.vue'
import { pct, shiftKey, parseKey, isoWeekOf, weekKey } from './okrUtils.js'

const route = useRoute()
const router = useRouter()
const isMobile = useIsMobile()
const data = ref(null)
const loading = ref(false)
const canManage = computed(() => can('okr.cycle.manage'))

const weekKeyNow = computed(() => data.value?.cycle?.key || route.query.week || weekKey(isoWeekOf()))
const weekParts = computed(() => parseKey(weekKeyNow.value) || isoWeekOf())
const canClose = computed(() => data.value?.cycle?.status === 'REVIEW' || (data.value?.cycle?.status !== 'CLOSED' && data.value?.cycle?.reopened))
const canReopen = computed(() => ['REVIEW', 'CLOSED'].includes(data.value?.cycle?.status))
const cycleTag = computed(() => ({ PLANNING: 'warning', IN_PROGRESS: 'primary', REVIEW: 'warning', CLOSED: 'info' }[data.value?.cycle?.status] || 'info'))

async function load() {
  loading.value = true
  try {
    data.value = await fde.okr.team(route.query.week)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
watch(() => route.query.week, load, { immediate: true })

function shift(delta) {
  router.replace({ query: { ...route.query, week: shiftKey(weekKeyNow.value, delta) } })
}

function openById(id) {
  if (id) router.push({ path: '/admin/okr', query: { week: weekKeyNow.value, ownerId: id } })
}

// 选择器里: 交了还没打主管分的排最前(老板要处理的), 其次未交, 其余按矩阵顺序
const pickRows = computed(() => {
  const rank = r => (r.submitted && r.managerScore == null ? 0 : r.submitted ? 2 : 1)
  return [...(data.value?.rows || [])].sort((a, b) => rank(a) - rank(b))
})
function pickHint(row) {
  if (!row.submitted) return subText(row)
  if (row.managerScore == null) return $t('okr.to_score')
  return `${$t('okr.manager_short')}${row.managerScore}`
}

function subText(row) {
  if (row.submission === 'ON_TIME') return '✓'
  if (row.submission === 'LATE') return $t('okr.late')
  return $t('okr.not_submitted_short')
}
function subClass(row) {
  if (row.submission === 'NONE') return data.value?.cycle?.deadlinePassed ? 'okr-sub none overdue' : 'okr-sub none'
  return row.submission === 'LATE' ? 'okr-sub late' : 'okr-sub ok'
}

async function closeWeek() {
  try {
    await ElMessageBox.confirm($t('okr.confirm_close', { p0: weekKeyNow.value }), $t('okr.close_week'), { type: 'warning', confirmButtonText: $t('okr.close_week'), cancelButtonText: $t('common.cancel') })
  } catch { return }
  try {
    await fde.okr.close(weekKeyNow.value)
    ElMessage.success($t('okr.closed_ok'))
    await load()
  } catch (e) { ElMessage.error(e.message) }
}

async function reopenWeek() {
  let reason
  try {
    const r = await ElMessageBox.prompt($t('okr.confirm_reopen', { p0: weekKeyNow.value }), $t('okr.reopen_week'), {
      type: 'warning', confirmButtonText: $t('okr.reopen_week'), cancelButtonText: $t('common.cancel'),
      inputPlaceholder: $t('okr.reopen_reason'), inputValidator: v => !!String(v || '').trim() || $t('okr.reopen_reason_required')
    })
    reason = r.value
  } catch { return }
  try {
    await fde.okr.reopen(weekKeyNow.value, reason)
    ElMessage.success($t('okr.reopened_ok'))
    await load()
  } catch (e) { ElMessage.error(e.message) }
}
</script>

<style scoped>
.okr-team { max-width: 960px; margin: 0 auto; padding: 4px 0 24px; }
.okr-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.okr-kpis > div { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.okr-kpis b { font-size: 22px; line-height: 1.2; }
.okr-kpis small { font-size: 13px; }
.okr-kpis span { font-size: 12px; color: var(--el-text-color-secondary); text-align: center; }
.okr-kpis em { font-style: normal; color: var(--el-color-warning); margin-left: 4px; }
.okr-pick { display: flex; justify-content: flex-end; margin-bottom: 8px; }
.okr-pick-sel { width: 240px; max-width: 100%; }
.okr-pick-hint { float: right; margin-left: 12px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-bar { display: inline-block; vertical-align: middle; width: 64px; height: 6px; border-radius: 3px; background: var(--el-border-color-lighter); overflow: hidden; margin-right: 6px; }
.okr-bar i { display: block; height: 100%; background: var(--el-color-primary); }
.okr-cell-pct { font-weight: 600; margin-right: 6px; }
.okr-cell-sub, .okr-dim { color: var(--el-text-color-secondary); font-size: 12px; }
.okr-sub.ok { color: var(--el-color-success); font-weight: 600; }
.okr-sub.late { color: var(--el-color-warning); }
.okr-sub.none { color: var(--el-text-color-secondary); }
.okr-sub.none.overdue { color: var(--el-color-danger); font-weight: 600; }
.okr-mlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.okr-mrow { display: grid; grid-template-columns: 1fr auto; row-gap: 2px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-bg-color); }
.okr-m-name { font-weight: 600; overflow-wrap: anywhere; }
.okr-m-stats { grid-column: 1 / -1; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-low { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: var(--el-fill-color-light); }
.okr-low h3 { margin: 0; font-size: 14px; }
.okr-low-sub { margin: 4px 0 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-low ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.okr-low li { display: flex; justify-content: space-between; gap: 8px; }
.okr-low a { color: var(--el-color-primary); text-decoration: none; }
.okr-admin { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
:global(.okr-danger-item) { color: var(--el-color-danger) !important; }
</style>
