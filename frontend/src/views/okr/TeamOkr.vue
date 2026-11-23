<template>
  <!-- 团队视图: 本周矩阵 + 三个数 + 连续两周完成率偏低(不排名、不做红黑榜)。
       OKR 2.0: 登录即可看(ADMIN 全部, 其他人本团队); 点行进个人详情; 有代管权限的行多一个「代操作」;
       主管分列只给 okr.score.manager(ADMIN), 其他人不出这一列。
       精简第二轮: 只按人(按项目切换、项目块、连续未达成面板都已下线; 我的 OKR 顶部红条 OkrRiskBars 仍在) -->
  <div class="okr-team" v-loading="loading">
    <div class="okr-top">
      <OkrPersonPicker :model-value="meId" :people="people" :me-id="meId" :compact="isMobile" @change="openPerson" />
      <!-- OKR 8.0 导出: Excel 明细 / Word 汇报(自己); ADMIN / MANAGER 多「团队 Excel」。精简第二轮起只按人, 没有项目导出 -->
      <OkrExportMenu :items="exportMenu" class="okr-team-export" />
    </div>
    <OkrWeekBar
      :year="weekParts.year" :week-no="weekParts.weekNo" :week-key="weekKeyNow"
      :start="data?.cycle?.startDate" :end="data?.cycle?.endDate"
      :tag-text="data?.cycle?.status ? $t('okr.cycle_status.' + data.cycle.status) : ''" :tag-type="cycleTag"
      active="team" show-team @shift="shift"
    />

    <!-- OKR 4.0: 本周进度 + 催交(仅 ADMIN/MANAGER) -->
    <OkrWeekStatus v-if="lead" ref="wstRef" :key="weekKeyNow" :week="weekKeyNow" @loaded="s => (wst = s)" />

    <!-- 0.6.3: 已归档的周有人没交自评 → 浅黄提示条(可关闭, 按周记住); 名单来自周状态, 与归档时后端的 pendingSelfScore 同口径 -->
    <div v-if="closedNotice" class="okr-close-notice" role="status" data-test="okr-close-notice">
      <span>{{ closedNotice }}</span>
      <button type="button" class="okr-close-notice-x" :aria-label="$t('okr.close.dismiss')" :title="$t('okr.close.dismiss')" data-test="okr-close-notice-x" @click="hideNotice">×</button>
    </div>

    <!-- 0.6.2: 周进度后面两个计数(主管): 待你确认 / 变更待批, 都可点开; 0.6.3 多一个「未交自评」(名单来自周状态) -->
    <div v-if="canScore && data" class="okr-cf-counts" data-test="okr-cf-counts">
      <button type="button" class="okr-cf-count" :class="{ hot: counts.toConfirm.length }" data-test="okr-to-confirm" @click="toConfirmOpen = true">
        {{ $t('okr.confirm.to_confirm_n', { p0: counts.toConfirm.length }) }}
      </button>
      <button type="button" class="okr-cf-count" :class="{ hot: counts.pending.length }" data-test="okr-pending-changes" @click="changesOpen = true">
        {{ $t('okr.confirm.pending_n', { p0: counts.pending.length }) }}
      </button>
      <button v-if="wst" type="button" class="okr-cf-count" :class="{ warm: pendingSelf.length }" data-test="okr-pending-self" @click="pendingSelfOpen = true">
        {{ $t('okr.close.pending_self_n', { p0: pendingSelf.length }) }}
      </button>
    </div>

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
        <el-table-column :label="$t('okr.confirm.col')" width="104" align="center">
          <template #default="{ row }">
            <span class="okr-cf-cell" :data-test="'okr-cf-cell-' + row.user.id" @click.stop>
              <template v-for="c in [cellOf(row)]" :key="c.kind">
                <el-button v-if="c.kind === 'confirm'" type="primary" size="small" :loading="cfBusy === String(row.user.id)" :data-self="c.self ? 'true' : undefined" data-test="okr-row-confirm" @click.stop="confirmRow(row)">{{ c.self ? $t('okr.confirm.confirm_self') : $t('okr.confirm.confirm_manager') }}</el-button>
                <el-tooltip v-else-if="c.kind === 'done'" :content="$t('okr.confirm.done_tip', { p0: c.ownerAt, p1: c.manager, p2: c.managerAt })" placement="top">
                  <span class="okr-cf-done" tabindex="0">{{ $t('okr.confirm.done') }}</span>
                </el-tooltip>
                <span v-else-if="c.kind === 'await_owner'" class="okr-dim">{{ $t('okr.confirm.await_owner') }}</span>
                <span v-else-if="c.kind === 'await_manager'" class="okr-dim">{{ $t('okr.confirm.await_manager') }}</span>
                <span v-else class="okr-dim">-</span>
              </template>
            </span>
          </template>
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
          <template #default="{ row }">
            <template v-for="c in [selfCell(row)]" :key="c.kind">
              <span v-if="c.kind === 'missing'" class="okr-dim" :data-test="'okr-self-missing-' + row.user.id">{{ $t('okr.close.self_missing') }}</span>
              <template v-else>{{ c.kind === 'score' ? c.text : '-' }}</template>
            </template>
          </template>
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
          <span class="okr-m-cf" :data-test="'okr-cf-cell-' + row.user.id" @click.stop>
            <template v-for="c in [cellOf(row)]" :key="c.kind">
              <el-button v-if="c.kind === 'confirm'" type="primary" class="okr-m-cf-btn" :loading="cfBusy === String(row.user.id)" :data-self="c.self ? 'true' : undefined" data-test="okr-row-confirm" @click.stop="confirmRow(row)">{{ c.self ? $t('okr.confirm.confirm_self') : $t('okr.confirm.confirm_manager') }}</el-button>
              <span v-else-if="c.kind === 'done'" class="okr-cf-done" :title="$t('okr.confirm.done_tip', { p0: c.ownerAt, p1: c.manager, p2: c.managerAt })">{{ $t('okr.confirm.done') }}</span>
              <span v-else-if="c.kind === 'await_owner'" class="okr-dim">{{ $t('okr.confirm.await_owner') }}</span>
              <span v-else-if="c.kind === 'await_manager'" class="okr-dim">{{ $t('okr.confirm.await_manager') }}</span>
            </template>
          </span>
          <span class="okr-m-stats">
            <template v-if="row.completion != null">{{ pct(row.completion) }}% · {{ row.objectiveCount }}O · {{ $t('okr.self_short') }}<span v-if="selfCell(row).kind === 'missing'" class="okr-m-self-missing" :data-test="'okr-self-missing-' + row.user.id">{{ $t('okr.close.self_missing') }}</span><template v-else>{{ row.selfScore ?? '-' }}</template><template v-if="canScore"> · {{ $t('okr.manager_short') }}{{ row.managerScore ?? '-' }}</template></template>
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
           正常流程: ADMIN / MANAGER 打主管分(MANAGER 限本团队); ADMIN 「保存并完成本周」归档 -->
      <div v-if="canScore && data.cycle?.status" class="okr-admin">
        <el-button :disabled="data.cycle.status === 'CLOSED'" data-test="okr-mgr-open" @click="mgrOpen = true">
          {{ data.cycle.status === 'CLOSED' ? $t('okr.v3.closed_btn') : $t('okr.v3.mgr_btn') }}
        </el-button>
      </div>
      <!-- 0.6.2: 待你确认(点开逐个确认) / 变更待批(差异 + 批准 / 拒绝) -->
      <el-dialog v-model="toConfirmOpen" :title="$t('okr.confirm.to_confirm_title')" :width="isMobile ? '100%' : 'min(92vw, 420px)'" :fullscreen="isMobile" append-to-body>
        <p v-if="!counts.toConfirm.length" class="okr-cf-empty">{{ $t('okr.confirm.to_confirm_empty') }}</p>
        <ul v-else class="okr-cf-tolist" data-test="okr-to-confirm-list">
          <li v-for="row in counts.toConfirm" :key="row.user.id">
            <span class="okr-who"><el-avatar :size="24" :src="row.user.avatarUrl || undefined" class="okr-who-av">{{ initialOf(row.user.name) }}</el-avatar>{{ row.user.name }}</span>
            <span class="okr-dim">{{ cellOf(row).ownerAt }}</span>
            <el-button type="primary" class="okr-cf-tobtn" :loading="cfBusy === String(row.user.id)" @click="confirmRow(row)">{{ cellOf(row).self ? $t('okr.confirm.confirm_self') : $t('okr.confirm.confirm_manager') }}</el-button>
          </li>
        </ul>
      </el-dialog>
      <!-- 0.6.3: 未交自评名单(不影响归档, 主管可直接打分) -->
      <el-dialog v-model="pendingSelfOpen" :title="$t('okr.close.pending_self_title', { p0: weekKeyNow })" :width="isMobile ? '94vw' : 'min(92vw, 420px)'" append-to-body>
        <p v-if="!pendingSelf.length" class="okr-cf-empty">{{ $t('okr.close.pending_self_empty') }}</p>
        <ul v-else class="okr-cf-tolist okr-ps-list" data-test="okr-pending-self-list">
          <li v-for="p in pendingSelf" :key="p.userId" :data-test="'okr-pending-self-' + p.userId">
            <button type="button" class="okr-ps-who" @click="pendingSelfOpen = false; openPerson(p.userId)">{{ p.name }}</button>
            <span class="okr-dim">{{ $t('okr.close.pending_self_os', { p0: p.objectiveCount }) }}</span>
          </li>
        </ul>
      </el-dialog>
      <OkrChangeReviewDialog v-model="changesOpen" :changes="counts.pending" :mobile="isMobile" @decided="onDecided" />

      <OkrManagerScorePanel
        v-if="canScore && data.cycle?.status" v-model="mgrOpen" :week="weekKeyNow" :me-id="meId" :closed="data.cycle.status === 'CLOSED'" :can-close="canCloseWeek" :mobile="isMobile"
        @changed="mgrChanged = true" @update:model-value="v => { if (!v && mgrChanged) { mgrChanged = false; load(); wstRef?.reload() } }"
      />
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
import OkrPersonPicker from '@/components/okr/OkrPersonPicker.vue'
import OkrManagerScorePanel from '@/components/okr/OkrManagerScorePanel.vue'
import OkrWeekStatus from '@/components/okr/OkrWeekStatus.vue'
import OkrExportMenu from '@/components/okr/OkrExportMenu.vue'
import OkrChangeReviewDialog from '@/components/okr/OkrChangeReviewDialog.vue'
import { teamConfirmCell, teamCounts } from './okrConfirm.js'
import { pendingSelfFromStatus, closedNoticeText, noticeDismissed, dismissNotice, selfCell } from './okrClose.js'
import { exportItems } from './okrFe5.js'
import { isLead } from './okrFe3.js'
import { pct, shiftKey, parseKey, isoWeekOf, weekKey } from './okrUtils.js'
import { initialOf, mayProxyRow, pickerPeople, currentUser, mayScoreManager, mayCloseWeek } from './okrPeople.js'

const route = useRoute()
const router = useRouter()
const isMobile = useIsMobile()
const data = ref(null)
const loading = ref(false)
const me = currentUser()
const canScore = mayScoreManager(me, can('okr.score.manager'))
const canCloseWeek = mayCloseWeek(me)
const meId = String(me.id || '')
const lead = isLead(me)
const people = computed(() => pickerPeople(data.value?.rows || [], me))
const anyProxy = computed(() => (data.value?.rows || []).some(r => mayProxyRow(me, r.user)))

const weekKeyNow = computed(() => data.value?.cycle?.key || route.query.week || weekKey(isoWeekOf()))
const weekParts = computed(() => parseKey(weekKeyNow.value) || isoWeekOf())
const mgrOpen = ref(false)
const mgrChanged = ref(false)
const cycleTag = computed(() => ({ PLANNING: 'warning', IN_PROGRESS: 'primary', REVIEW: 'warning', CLOSED: 'info' }[data.value?.cycle?.status] || 'info'))

async function load({ quiet = false } = {}) {
  if (!quiet) loading.value = true
  try {
    data.value = await fde.okr.team(route.query.week)
    loadConfirms()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------- 0.6.2 确认列 / 待你确认 / 变更待批
// 团队接口不带确认状态(契约不改), 逐人拉 confirm-status(团队小, 并发拉); 变更待批只给主管拉
const cfMap = ref({})
const changes = ref([])
const cfBusy = ref('')
const toConfirmOpen = ref(false)
const changesOpen = ref(false)
// 0.6.5: ADMIN 可以确认任何人, 含自己那行(「确认（自）」)
const cfCtx = { meId, canScore, isAdmin: me.role === 'ADMIN' }
const cellOf = row => teamConfirmCell(row, cfMap.value[String(row.user.id)], cfCtx)
const counts = computed(() => teamCounts(data.value?.rows, cfMap.value, changes.value, cfCtx))

async function loadConfirmOf(userId, week = weekKeyNow.value) {
  try {
    const s = await fde.okr.confirmStatus(week, userId)
    if (week === weekKeyNow.value) cfMap.value = { ...cfMap.value, [String(userId)]: s }
  } catch { /* 拉不到就画 - */ }
}

async function loadConfirms() {
  const week = weekKeyNow.value
  cfMap.value = {}
  const rows = data.value?.rows || []
  await Promise.all(rows.map(r => loadConfirmOf(r.user.id, week)))
  if (canScore) {
    try {
      const list = await fde.okr.changes({ week, status: 'PENDING' })
      if (week === weekKeyNow.value) changes.value = Array.isArray(list) ? list : (list?.items || [])
    } catch { changes.value = [] }
  }
}

/** 行里的「确认」: 二次确认(锁定后改动需走变更申请)→ 主管确认 → 只刷这一行。
 *  0.6.5 管理员自己那行: 弹窗写清「这是你自己的 OKR，确认后本周锁定」 */
async function confirmRow(row) {
  const selfConfirm = !!cellOf(row).self
  try {
    await ElMessageBox.confirm(
      selfConfirm ? $t('okr.confirm.self_confirm_body') : $t('okr.confirm.manager_confirm_body'),
      (selfConfirm ? $t('okr.confirm.self_confirm_title') : $t('okr.confirm.manager_confirm_title')) + ' · ' + row.user.name,
      { type: 'warning', confirmButtonText: selfConfirm ? $t('okr.confirm.confirm_lock') : $t('okr.confirm.confirm_manager'), cancelButtonText: $t('common.cancel') }
    )
  } catch { return }
  cfBusy.value = String(row.user.id)
  try {
    const s = await fde.okr.confirmManager(weekKeyNow.value, row.user.id)
    cfMap.value = { ...cfMap.value, [String(row.user.id)]: s }
    ElMessage.success(selfConfirm ? $t('okr.confirm.self_confirmed_ok') : $t('okr.confirm.confirmed_ok'))
  } catch (e) {
    ElMessage.error(e.message)
    await loadConfirmOf(row.user.id)
  } finally {
    cfBusy.value = ''
  }
}

/** 批准 / 拒绝后: 列表里移除, 刷新这个人的行(计划可能变了, 完成度 / O 数跟着变) */
async function onDecided({ id, ownerId }) {
  changes.value = changes.value.filter(c => String(c.id) !== String(id))
  if (ownerId) await loadConfirmOf(ownerId)
  try { data.value = { ...data.value, ...(await fde.okr.team(weekKeyNow.value)) } } catch { /* 下次进页再刷 */ }
}
watch(() => route.query.week, load, { immediate: true })

// ---------------------------------------------------------------- 0.6.3 未交自评(周状态) / 归档提示条
const wstRef = ref(null)
const wst = ref(null)
const pendingSelf = computed(() => (wst.value && wst.value.week === weekKeyNow.value ? pendingSelfFromStatus(wst.value) : []))
const pendingSelfOpen = ref(false)
const dismissed = ref(new Set())
const closedNotice = computed(() => {
  const week = weekKeyNow.value
  if (data.value?.cycle?.status !== 'CLOSED' || !pendingSelf.value.length) return ''
  if (dismissed.value.has(week) || noticeDismissed(week)) return ''
  return closedNoticeText($t, week, pendingSelf.value)
})
function hideNotice() {
  dismissNotice(weekKeyNow.value)
  dismissed.value = new Set([...dismissed.value, weekKeyNow.value])
}

// ---------------------------------------------------------------- OKR 8.0 导出
const exportMenu = computed(() => exportItems({ page: 'team', user: me, week: weekKeyNow.value, userId: meId }))

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
.okr-team-export { margin-left: auto; }
.okr-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
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
.okr-close-notice { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; padding: 10px 8px 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.6; color: #6b5300; background: #fdf6d8; border: 1px solid #f1dc8a; }
.okr-close-notice > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.okr-close-notice-x { flex: none; width: 32px; height: 32px; margin: -6px 0; border: 0; border-radius: 6px; background: none; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
.okr-close-notice-x:hover { background: rgba(0, 0, 0, .06); }
.okr-cf-counts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.okr-cf-count { min-height: 36px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--el-border-color); background: var(--el-bg-color); color: var(--el-text-color-regular); font-size: 13px; cursor: pointer; }
.okr-cf-count.hot { border-color: var(--el-color-primary-light-5); color: var(--el-color-primary); font-weight: 600; background: var(--el-color-primary-light-9); }
.okr-cf-count.warm { border-color: #f1dc8a; color: #6b5300; font-weight: 600; background: #fdf6d8; }
.okr-m-self-missing { color: var(--el-text-color-placeholder); }
.okr-ps-list { max-height: min(60vh, 480px); overflow-y: auto; }
.okr-ps-who { flex: 1; min-height: 36px; padding: 0; border: 0; background: none; font: inherit; font-weight: 600; text-align: left; color: var(--el-color-primary); cursor: pointer; }
.okr-cf-cell { display: inline-flex; justify-content: center; }
.okr-cf-done { color: var(--el-color-success); font-weight: 600; cursor: default; }
.okr-m-cf { grid-column: 1 / -1; justify-self: end; font-size: 12px; }
.okr-m-cf:empty { display: none; }
.okr-m-cf-btn { min-height: 44px; padding: 0 16px; }
.okr-cf-empty { margin: 16px 0; text-align: center; color: var(--el-text-color-secondary); font-size: 13px; }
.okr-cf-tolist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.okr-cf-tolist li { display: flex; align-items: center; gap: 10px; }
.okr-cf-tolist .okr-who { flex: 1; }
.okr-cf-tobtn { min-height: 36px; }
@media (max-width: 640px) {
  .okr-cf-count { min-height: 44px; flex: 1 1 0; }
  .okr-cf-tobtn { min-height: 44px; }
  .okr-ps-who { min-height: 44px; }
  .okr-close-notice-x { width: 44px; height: 44px; margin: -10px -4px; }
}
</style>
