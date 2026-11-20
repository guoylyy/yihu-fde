<template>
  <!-- 团队视图: 本周矩阵 + 三个数 + 连续两周完成率偏低(不排名、不做红黑榜)。
       OKR 2.0: 登录即可看(ADMIN 全部, 其他人本团队); 点行进个人详情; 有代管权限的行多一个「代操作」;
       主管分列只给 okr.score.manager(ADMIN), 其他人不出这一列 -->
  <div class="okr-team" v-loading="loading">
    <div class="okr-top">
      <OkrPersonPicker :model-value="meId" :people="people" :me-id="meId" :compact="isMobile" @change="openPerson" />
    </div>
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

      <!-- 桌面: 表格(点行进个人详情); 手机: 每人一行卡片, 不出横向滚动 -->
      <el-table v-if="!isMobile" :data="data.rows" class="okr-matrix" row-class-name="okr-row-link" data-test="okr-team-table" @row-click="row => openPerson(row.user.id)">
        <el-table-column :label="$t('okr.engineer')" min-width="140">
          <template #default="{ row }">
            <span class="okr-who">
              <el-avatar :size="24" :src="row.user.avatarUrl || undefined" class="okr-who-av">{{ initialOf(row.user.name) }}</el-avatar>
              <span class="okr-who-name">{{ row.user.name }}</span>
            </span>
          </template>
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
        <el-table-column v-if="canScore" :label="$t('okr.manager_score')" width="80" align="center">
          <template #default="{ row }">{{ row.managerScore ?? '-' }}</template>
        </el-table-column>
        <el-table-column v-if="anyProxy" width="110" align="right">
          <template #default="{ row }">
            <el-button v-if="mayProxyRow(me, row.user)" size="small" type="warning" plain data-test="okr-row-proxy" @click.stop="openProxy(row.user.id)">{{ $t('okr.proxy.act') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <ul v-else class="okr-mlist">
        <li v-for="row in data.rows" :key="row.user.id" class="okr-mrow" role="link" tabindex="0" @click="openPerson(row.user.id)" @keyup.enter="openPerson(row.user.id)">
          <span class="okr-m-name">
            <el-avatar :size="24" :src="row.user.avatarUrl || undefined" class="okr-who-av">{{ initialOf(row.user.name) }}</el-avatar>
            {{ row.user.name }}
          </span>
          <span :class="subClass(row)">{{ subText(row) }}</span>
          <span class="okr-m-stats">
            <template v-if="row.completion != null">{{ pct(row.completion) }}% · {{ row.objectiveCount }}O · {{ $t('okr.self_short') }}{{ row.selfScore ?? '-' }}<template v-if="canScore"> · {{ $t('okr.manager_short') }}{{ row.managerScore ?? '-' }}</template></template>
            <template v-else>-</template>
          </span>
          <el-button v-if="mayProxyRow(me, row.user)" size="small" type="warning" plain class="okr-m-proxy" @click.stop="openProxy(row.user.id)">{{ $t('okr.proxy.act') }}</el-button>
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

      <!-- OKR 3.0: 不再有「归档 / 重开本周」入口(应急重开只留在后端)。
           正常流程: ADMIN 打完主管分 →「保存并完成本周」归档 -->
      <div v-if="canScore && data.cycle?.status" class="okr-admin">
        <el-button :disabled="data.cycle.status === 'CLOSED'" data-test="okr-mgr-open" @click="mgrOpen = true">
          {{ data.cycle.status === 'CLOSED' ? $t('okr.v3.closed_btn') : $t('okr.v3.mgr_btn') }}
        </el-button>
      </div>
      <OkrManagerScorePanel
        v-if="canScore && data.cycle?.status" v-model="mgrOpen" :week="weekKeyNow" :me-id="meId" :closed="data.cycle.status === 'CLOSED'" :mobile="isMobile"
        @changed="mgrChanged = true" @update:model-value="v => { if (!v && mgrChanged) { mgrChanged = false; load() } }"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { useIsMobile } from '@/composables/useResponsive.js'
import OkrWeekBar from '@/components/okr/OkrWeekBar.vue'
import OkrPersonPicker from '@/components/okr/OkrPersonPicker.vue'
import OkrManagerScorePanel from '@/components/okr/OkrManagerScorePanel.vue'
import { pct, shiftKey, parseKey, isoWeekOf, weekKey } from './okrUtils.js'
import { initialOf, mayProxyRow, pickerPeople, currentUser } from './okrPeople.js'

const route = useRoute()
const router = useRouter()
const isMobile = useIsMobile()
const data = ref(null)
const loading = ref(false)
const canScore = can('okr.score.manager')
const me = currentUser()
const meId = String(me.id || '')
const people = computed(() => pickerPeople(data.value?.rows || [], me))
const anyProxy = computed(() => (data.value?.rows || []).some(r => mayProxyRow(me, r.user)))

const weekKeyNow = computed(() => data.value?.cycle?.key || route.query.week || weekKey(isoWeekOf()))
const weekParts = computed(() => parseKey(weekKeyNow.value) || isoWeekOf())
const mgrOpen = ref(false)
const mgrChanged = ref(false)
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

/** 进个人详情, 带上当前周(返回团队页时周不丢) */
function openPerson(id) {
  if (id) router.push({ path: `/admin/okr/person/${id}`, query: { week: weekKeyNow.value } })
}

/** 代操作: 进该人的周 OKR 页, 页面按 can.proxy 决定是否进代编辑 */
function openProxy(id) {
  router.push({ path: '/admin/okr', query: { week: weekKeyNow.value, userId: id } })
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

</script>

<style scoped>
.okr-team { max-width: 960px; margin: 0 auto; padding: 4px 0 24px; }
.okr-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.okr-kpis > div { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.okr-kpis b { font-size: 22px; line-height: 1.2; }
.okr-kpis small { font-size: 13px; }
.okr-kpis span { font-size: 12px; color: var(--el-text-color-secondary); text-align: center; }
.okr-kpis em { font-style: normal; color: var(--el-color-warning); margin-left: 4px; }
.okr-top { display: flex; justify-content: flex-start; margin-bottom: 8px; }
.okr-who { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.okr-who-av { flex: none; font-size: 12px; vertical-align: middle; }
.okr-who-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-matrix :deep(.okr-row-link) { cursor: pointer; }
.okr-m-proxy { grid-column: 1 / -1; justify-self: end; min-height: 44px; padding: 0 16px; margin-top: 4px; }
.okr-bar { display: inline-block; vertical-align: middle; width: 64px; height: 6px; border-radius: 3px; background: var(--el-border-color-lighter); overflow: hidden; margin-right: 6px; }
.okr-bar i { display: block; height: 100%; background: var(--el-color-primary); }
.okr-cell-pct { font-weight: 600; margin-right: 6px; }
.okr-cell-sub, .okr-dim { color: var(--el-text-color-secondary); font-size: 12px; }
.okr-sub.ok { color: var(--el-color-success); font-weight: 600; }
.okr-sub.late { color: var(--el-color-warning); }
.okr-sub.none { color: var(--el-text-color-secondary); }
.okr-sub.none.overdue { color: var(--el-color-danger); font-weight: 600; }
.okr-mlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.okr-mrow { cursor: pointer; min-height: 44px; display: grid; grid-template-columns: 1fr auto; row-gap: 2px; padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-bg-color); }
.okr-m-name { font-weight: 600; overflow-wrap: anywhere; }
.okr-m-stats { grid-column: 1 / -1; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-low { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: var(--el-fill-color-light); }
.okr-low h3 { margin: 0; font-size: 14px; }
.okr-low-sub { margin: 4px 0 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-low ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.okr-low li { display: flex; justify-content: space-between; gap: 8px; }
.okr-low a { color: var(--el-color-primary); text-decoration: none; }
.okr-admin { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
