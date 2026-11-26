<template>
  <!-- 我的 OKR(手机优先): 周一写计划 → 周中追加进展 → 周五自评 → 下周一归档只读
       顶部「人」筛选切到别人(?userId=): 默认只读; 有代管权限(can.proxy)就进代编辑, 写操作带 targetUserId。
       主管评分只给 okr.score.manager 的 ADMIN / MANAGER(MANAGER 限本团队、不能归档), 其他人界面上不渲染 -->
  <div class="okr-page" v-loading="loading">
    <div class="okr-top">
      <OkrPersonPicker :model-value="pickedId" :people="people" :me-id="meId" :compact="isMobile" @change="pickPerson" />
      <span class="okr-top-right">
        <router-link v-if="viewingOther" class="okr-top-link" data-test="okr-person-detail" :to="{ path: `/admin/okr/person/${ownerId}`, query: { week: weekKeyNow } }">{{ $t('okr.people.detail') }} ›</router-link>
        <!-- OKR 8.0 导出: 当前看的人(默认自己)这一周, scope=person -->
        <OkrExportMenu :items="exportMenu" />
      </span>
    </div>

    <!-- OKR 10.0 连续未达成: 自己的 CRITICAL 红条 / WARN 黄条, 「看看」滚到那张 O 卡 -->
    <OkrRiskBars :bars="riskBars" :compact="isMobile" @look="lookRisk" />

    <!-- 0.6.6 管理员全局入口: 全部待审批的变更申请(跨周、跨人), 「查看」打开与团队页同一个弹窗; N=0 / 非 ADMIN 不出 -->
    <div v-if="isAdmin && adminPending.length" class="okr-admin-pending-bar" role="status" data-test="okr-admin-pending-bar">
      <span>{{ $t('okr.confirm.admin_pending_bar', { p0: adminPending.length }) }}</span>
      <el-button type="primary" size="small" class="okr-admin-pending-btn" data-test="okr-admin-pending-view" @click="adminChangesOpen = true">{{ $t('common.view') }}</el-button>
    </div>

    <!-- 代管: 常驻提示条(不是弹窗), 用 warning 色 -->
    <div v-if="proxyMode" class="okr-proxy-bar" role="status" data-test="okr-proxy-bar">
      {{ $t('okr.proxy.banner', { p0: ownerName, p1: meName }) }}
    </div>

    <OkrWeekBar
      :year="weekParts.year" :week-no="weekParts.weekNo" :week-key="weekKeyNow"
      :start="weekDates.start" :end="weekDates.end"
      :tag-text="tagText" :tag-type="tagType" :extra-tag="backfillTag" :active="viewingOther ? '' : 'mine'" :show-team="canTeam" :hide-links="viewingOther"
      :prev-disabled="!nav.prev" :next-disabled="!nav.next"
      @shift="shift"
    />

    <!-- 0.6.2 计划确认区: 提交后 灰(等员工确认) → 黄(等主管确认) → 绿(锁定); 锁定后有待批变更申请 → 蓝 -->
    <OkrConfirmBar
      v-if="data && !changeMode" :bar="cfBar" :other-name="viewingOther ? ownerName : ''" :busy="busy === 'confirm'"
      @confirm="confirmOwner" @manager-confirm="confirmManager" @cancel-change="cancelChange" @approve-change="approveOwnChange"
    />

    <!-- 精简第二轮: 本周项目计划(一周一份, 整体, 不分项目), 随顶部周切换 -->
    <OkrWeekPlanCard :week="weekKeyNow" />

    <div v-if="viewingOther && data?.owner" class="okr-owner">
      <router-link :to="{ path: '/admin/okr/team', query: { week: weekKeyNow } }">‹ {{ $t('okr.tab_team') }}</router-link>
      <!-- 人名已在顶部筛选器里, 这里不再重复 -->
      <span class="okr-owner-mid">{{ $t('okr.people.owner_okr') }}</span>
      <router-link :to="{ path: '/admin/okr/history', query: { ownerId: data.owner.id } }">{{ $t('okr.tab_history') }}</router-link>
    </div>

    <template v-if="data">
      <!-- OKR 3.0 页头操作: 「提交自评」主按钮(本人 / 代管, 计划已提交); 「主管评分」次要按钮(ADMIN / MANAGER)。
           不按时间限制, 能不能交由后端说了算; 归档后都置灰 -->
      <div v-if="data.cycle && !editing && (showSelfBtn || canScoreManager || showChangeBtn || showAuditBtn)" class="okr-actions" data-test="okr-actions">
        <el-button
          v-if="showSelfBtn" type="primary" class="okr-act-btn" :plain="selfAllDone && !isClosed" :disabled="isClosed"
          data-test="okr-self-open" @click="openSelf"
        >{{ selfBtnText }}</el-button>
        <span v-if="showSelfBtn && !isClosed && handling.missing.length" class="okr-act-warn" data-test="okr-self-pending">{{ $t('okr.v3.kr_pending', { p0: handling.missing.length }) }}</span>
        <!-- 主管评分: 只渲染给 okr.score.manager 的 ADMIN / MANAGER; 次要按钮, 与自评区分 -->
        <el-button
          v-if="canScoreManager" class="okr-act-btn okr-act-mgr" :disabled="isClosed" :title="isClosed ? $t('okr.v3.closed_tip') : undefined"
          data-test="okr-mgr-open" @click="mgr.visible = true"
        >{{ isClosed ? $t('okr.v3.closed_btn') : $t('okr.v3.mgr_btn') }}</el-button>
        <!-- 0.6.2: 锁定后改计划只能「申请变更」; 「修改记录」看计划层每一次改动 -->
        <el-button v-if="showChangeBtn" class="okr-act-btn okr-act-mgr" data-test="okr-change-open" @click="startChange">{{ $t('okr.confirm.request_change') }}</el-button>
        <el-button v-if="showAuditBtn" class="okr-act-btn okr-act-mgr" data-test="okr-audit-open" @click="auditOpen = true">{{ $t('okr.confirm.audit') }}</el-button>
      </div>

      <!-- 本周一句话概况 -->
      <div v-if="data.objectives.length && !editing" class="okr-summary">
        <span>{{ $t('okr.completion') }} <b>{{ pct(data.completion) ?? '-' }}%</b></span>
        <span v-if="data.selfScore != null">{{ $t('okr.self_score') }} <b>{{ data.selfScore }}</b></span>
        <span v-if="data.managerScore != null && (canScoreManager || !viewingOther)">{{ $t('okr.manager_score') }} <b>{{ data.managerScore }}</b></span>
        <button v-if="canEditPlan" type="button" class="okr-edit-link" @click="startEdit">{{ $t('okr.edit_plan') }}</button>
        <!-- 已确认锁定: 改计划置灰 + 提示走变更申请(不在编辑器里放行保存) -->
        <el-tooltip v-else-if="locked && canAct" :content="$t('okr.confirm.locked_tip')" placement="top">
          <span class="okr-edit-link okr-edit-locked" tabindex="0" data-test="okr-edit-locked">
            <button type="button" class="okr-edit-link" disabled :aria-label="$t('okr.confirm.locked_tip')">{{ $t('okr.edit_plan') }}</button>
          </span>
        </el-tooltip>
      </div>

      <!-- 这周一条 O 都没有: 空态必须带去处(补录 / 新建 / 代补录); 只有已归档、超出窗口、看别人且无代管权时才只有说明 -->
      <div v-if="empty && !editing" class="okr-empty okr-empty-box" data-test="okr-empty">
        <p class="okr-empty-title">{{ $t(...empty.text) }}</p>
        <el-button v-if="empty.action" type="primary" class="okr-empty-btn" :data-test="'okr-empty-' + empty.action" @click="startBackfill">{{ $t(...empty.label) }}</el-button>
      </div>

      <!-- 补录: 编辑器顶部常驻一条, 说清这周已过、提交记迟交 -->
      <div v-if="editing && isPastWeek" class="okr-backfill-bar" role="status" data-test="okr-backfill-bar">
        {{ $t('okr.backfill.banner', { p0: weekLabel }) }}
      </div>

      <!-- 本周还没提交: 贴周报生成草稿(只填编辑器, 不提交)。代管时常驻, 另加「导入文档生成」 -->
      <!-- 0.6.2 变更申请编辑态: 编辑器同平时, 只是保存变成「提交变更申请」(弹窗写原因), 主管批准后才生效 -->
      <div v-if="editorOpen && changeMode" class="okr-change-bar" role="status" data-test="okr-change-bar">{{ $t('okr.confirm.change_mode_bar') }}</div>

      <div v-if="editorOpen && !changeMode && (proxyMode || (!submittedOnce && !viewingOther))" class="okr-quick">
        <span class="okr-quick-text">{{ proxyMode ? $t('okr.import.entry_hint', { p0: ownerName }) : $t('okr.report.entry_hint') }}</span>
        <span class="okr-quick-btns">
          <el-button type="primary" plain size="small" data-test="report-open" @click="openDraft('text')">{{ $t('okr.report.open') }}</el-button>
          <el-button v-if="proxyMode" type="primary" plain size="small" data-test="import-open" @click="openDraft('file')">{{ $t('okr.import.open') }}</el-button>
        </span>
      </div>

      <!-- OKR 7.0 编计划提效: 编辑模式下的三个入口(复制 / 批量导入只往这周追加草稿, 已提交的周后端回 8171) -->
      <div v-if="editorOpen && !changeMode" class="okr-plan-tools" data-test="okr-plan-tools">
        <el-button class="okr-tool-btn" data-test="okr-copy-open" @click="openCopy">{{ $t('okr.plan.copy_btn') }}</el-button>
        <el-button class="okr-tool-btn" data-test="okr-bulk-open" @click="openImport('')">{{ $t('okr.plan.bulk_btn') }}</el-button>
        <el-button class="okr-tool-btn" data-test="okr-tpl-open" @click="openTemplates">{{ $t('okr.plan.tpl_btn') }}</el-button>
      </div>

      <!-- 写计划 / 改计划 -->
      <OkrPlanEditor
        v-if="editorOpen" ref="editorRef" :max-objectives="limits.maxObjectives" :max-krs="limits.maxKrsPerObjective"
        :initial="draftInit" :submitted="submittedOnce || changeMode" :cancellable="submittedOnce || !!empty || changeMode" :busy="busy"
        :late-hint="deadlinePassed && !submittedOnce && !changeMode"
        :submit-label="changeMode ? $t('okr.confirm.submit_change') : (proxyMode ? $t('okr.proxy.submit_for', { p0: ownerName }) : '')"
        @save="(objs) => savePlan(objs, false)" @submit="onEditorSubmit" @cancel="cancelEdit"
      />

      <template v-else-if="data.cycle">
        <div class="okr-list">
          <OkrObjectiveCard
            v-for="o in data.objectives" :id="'okr-obj-' + o.id" :key="o.id + ':' + o.updatedKey" :obj="o"
            :class="{ 'okr-flash': flashId === String(o.id) }"
            :streak="streakOf(riskMap, o)"
            :can-edit="data.can.edit && !!o.submittedAt && o.status !== 'DROPPED'"
            :can-progress="!!data.can.progress && !!o.submittedAt && o.status !== 'DROPPED'"
            :can-miss="canAct && data.cycle.status === 'REVIEW' && !['DONE', 'MISSED', 'DROPPED'].includes(o.status)"
            :can-manager-score="canScoreManager && data.can.managerScore && !!o.submittedAt"
            :can-complete="canAct && !!data.can.progress"
            :closed="canAct && isClosed"
            :kr-busy="krBusy"
            :busy="busy === 'update'"
            :can-edit-blocker="!!canEditPlan && !isClosed"
            :people="blockerPeople(blkUsers, o.blocker)"
            :compact="isMobile"
            @add-update="addUpdate" @miss="openMiss" @manager-score="managerScore" @complete="completeKr"
            @milestone="clickMilestone" @save-blocker="saveBlocker"
          />
        </div>

      </template>
    </template>

    <!-- 本周自评面板: 所有 O 一次填完。顶部「KR 处理情况 x/y」; 还有 KR 没标完成/未完成就列出来, 提交置灰 -->
    <el-drawer
      v-model="self.visible" :title="$t('okr.v3.self_panel_title')" :direction="isMobile ? 'btt' : 'rtl'" :size="isMobile ? '90%' : '480px'"
      append-to-body class="okr-self-drawer"
    >
      <div class="okr-sp" data-test="okr-self-panel">
        <p class="okr-sp-handling" :class="{ ok: !handling.missing.length }" data-test="okr-kr-handling">
          {{ $t('okr.v3.kr_handling', { p0: handling.handled, p1: handling.total }) }}
        </p>
        <div v-if="handling.missing.length" class="okr-sp-missing" role="alert" data-test="okr-self-missing">
          <b>{{ $t('okr.v3.kr_pending', { p0: handling.missing.length }) }}</b>
          <span>{{ $t('okr.v3.kr_pending_hint') }}</span>
          <ul>
            <li v-for="m in handling.missing" :key="m.krId"><code>{{ m.label }}</code> {{ m.title }}</li>
          </ul>
        </div>
        <section v-for="r in self.rows" :key="r.id" class="okr-sp-row" :data-test="'okr-self-row-' + r.id">
          <h4><span class="okr-sp-seq">O{{ r.seq }}</span> {{ r.title }}</h4>
          <p class="okr-sp-meta">
            {{ $t('okr.completion') }} {{ pct(r.progress) }}%
            <template v-if="r.original != null"> · {{ $t('okr.scored_n', { p0: r.original }) }}</template>
          </p>
          <div class="okr-sp-inputs">
            <el-input-number
              v-model="r.score" :min="0" :max="100" :precision="0" :controls="false" :placeholder="$t('okr.v3.score_ph')"
              :aria-label="$t('okr.v3.score_label')" class="okr-sp-num"
            />
            <el-input v-model="r.comment" maxlength="200" :placeholder="$t('okr.v3.comment_ph')" />
          </div>
        </section>
      </div>
      <template #footer>
        <div class="okr-sp-foot">
          <span v-if="!handling.missing.length && !scoresComplete(self.rows)" class="okr-sp-tip">{{ $t('okr.v3.self_need_all') }}</span>
          <el-button @click="self.visible = false">{{ $t('common.cancel') }}</el-button>
          <el-button
            type="primary" :disabled="!!handling.missing.length || !scoresComplete(self.rows)" :loading="busy === 'self'"
            data-test="okr-self-submit" @click="submitSelf"
          >{{ $t('okr.v3.self_submit') }}</el-button>
        </div>
      </template>
    </el-drawer>

    <OkrManagerScorePanel
      v-if="canScoreManager && data?.cycle" v-model="mgr.visible" :week="weekKeyNow" :me-id="String(meId)" :closed="isClosed" :can-close="canCloseWeek" :mobile="isMobile"
      @changed="mgr.changed = true" @update:model-value="onMgrClosed"
    />

    <OkrChangeReviewDialog v-if="isAdmin" v-model="adminChangesOpen" :changes="adminPending" :mobile="isMobile" @decided="onAdminDecided" @goto-week="adminGotoWeek" />
    <OkrAuditDrawer v-model="auditOpen" :week="weekKeyNow" :owner-id="String(ownerId || meId)" :me-id="String(meId)" :mobile="isMobile" />

    <OkrReportDraftDialog
      v-model="reportOpen" :source="reportSource" :target-user-id="proxyTarget" :target-name="proxyMode ? ownerName : ''" :max-objectives="limits.maxObjectives"
      @fill="fillFromReport"
    />

    <!-- OKR 7.0: 从上周复制 -->
    <el-dialog v-model="copy.visible" :title="$t('okr.plan.copy_title')" width="min(92vw, 420px)" append-to-body>
      <p class="okr-dialog-sub">{{ $t('okr.plan.copy_hint', { p0: weekKeyNow }) }}</p>
      <el-select v-model="copy.from" class="okr-copy-week" data-test="okr-copy-week">
        <el-option v-for="w in copyWeeks" :key="w" :value="w" :label="copyWeekLabel(w)" />
      </el-select>
      <template #footer>
        <el-button @click="copy.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!copy.from" :loading="busy === 'copy'" data-test="okr-copy-go" @click="runCopy">{{ $t('okr.plan.copy_go') }}</el-button>
      </template>
    </el-dialog>

    <OkrPlanImportDialog
      v-model="imp.visible" :week="weekKeyNow" :target-user-id="proxyTarget" :initial-text="imp.text" :before-apply="confirmDiscard" :limits="limits"
      @imported="onImported"
    />
    <OkrTemplateDialog v-model="tpl.visible" :current-md="tpl.md" @use="useTemplate" />

    <!-- 未达成原因(周五) -->
    <el-dialog v-model="miss.visible" :title="$t('okr.mark_missed')" width="min(92vw, 420px)" append-to-body>
      <p class="okr-dialog-sub">{{ miss.obj?.title }}</p>
      <el-input v-model="miss.reason" type="textarea" :rows="3" maxlength="500" :placeholder="$t('okr.miss_reason_placeholder')" />
      <el-checkbox v-model="miss.carry" class="okr-carry">{{ $t('okr.carry_next_week') }}</el-checkbox>
      <p class="okr-dialog-warn">{{ $t('okr.miss_consequence') }}</p>
      <template #footer>
        <el-button @click="miss.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="danger" :disabled="!miss.reason.trim()" :loading="busy === 'miss'" @click="submitMiss">{{ $t('okr.confirm_missed') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, h, nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { useIsMobile } from '@/composables/useResponsive.js'
import OkrPersonPicker from '@/components/okr/OkrPersonPicker.vue'
import OkrWeekBar from '@/components/okr/OkrWeekBar.vue'
import OkrObjectiveCard from '@/components/okr/OkrObjectiveCard.vue'
import OkrPlanEditor from '@/components/okr/OkrPlanEditor.vue'
import OkrReportDraftDialog from '@/components/okr/OkrReportDraftDialog.vue'
import OkrManagerScorePanel from '@/components/okr/OkrManagerScorePanel.vue'
import OkrPlanImportDialog from '@/components/okr/OkrPlanImportDialog.vue'
import OkrTemplateDialog from '@/components/okr/OkrTemplateDialog.vue'
import OkrExportMenu from '@/components/okr/OkrExportMenu.vue'
import OkrRiskBars from '@/components/okr/OkrRiskBars.vue'
import OkrWeekPlanCard from '@/components/okr/OkrWeekPlanCard.vue'
import OkrConfirmBar from '@/components/okr/OkrConfirmBar.vue'
import OkrAuditDrawer from '@/components/okr/OkrAuditDrawer.vue'
import OkrChangeReviewDialog from '@/components/okr/OkrChangeReviewDialog.vue'
import { confirmBar, isLocked, pendingChangeOf, reasonOk, decidable, LOCKED_CODE } from './okrConfirm.js'
import { exportItems, riskByObjective, streakOf, myRiskBars, findRiskTarget } from './okrFe5.js'
import {
  milestoneClick, milestonesWithDone, applyMilestonePatch, blockerPatch, planWithPatch, blockerPeople,
  copySourceWeeks, copyResultText, planToMarkdown
} from './okrFe4.js'
import {
  PERSONAL_TAG, pct, toDraft, shiftKey, parseKey, isoWeekOf, weekKey, weekStart,
  weekWindow, weekNav, isPastKey, shortWeekLabel, emptyState, isBackfilledPlan,
  applyKrComplete, needsProgressPrompt, progressMax, parseProgress, krHandling, scoresComplete
} from './okrUtils.js'
import { viewedUserId, queryForPerson, sameId, mergeDraft, mayScoreManager, mayCloseWeek } from './okrPeople.js'
import { useOkrPeople } from './useOkrPeople.js'
import { normalizeLimits, loadLimits } from './okrLimits.js'

const route = useRoute()
const router = useRouter()

const data = ref(null)
const loading = ref(false)
const busy = ref('')
const editing = ref(false)
const draftInit = ref([])
const editorRef = ref(null)
const reportOpen = ref(false)
const reportSource = ref('text')
const isMobile = useIsMobile()
const { me, meId, people, loadPeople, ensurePerson } = useOkrPeople()
const self = reactive({ visible: false, rows: [] })
// 主管评分面板(ADMIN / MANAGER): 关掉时有改动就重拉, 卡片上的主管分 / 归档状态同步
const mgr = reactive({ visible: false, changed: false })
function onMgrClosed(v) {
  if (!v && mgr.changed) { mgr.changed = false; load() }
}
const miss = reactive({ visible: false, obj: null, reason: '', carry: false })

// OKR 2.0: 团队页全员可进(后端按 ADMIN 全部 / 其他人本团队过滤)
const canTeam = computed(() => true)
// 0.5.8: 主管评分放开给部门主管(MANAGER, 范围后端卡本团队); 归档(保存并完成本周)仍只给 ADMIN
const canScoreManager = mayScoreManager(me, can('okr.score.manager'))
const canCloseWeek = mayCloseWeek(me)
const ownerId = computed(() => viewedUserId(route.query))
const viewingOther = computed(() => !!ownerId.value && !sameId(ownerId.value, meId))
const pickedId = computed(() => ownerId.value || meId)
// 代管: 看别人且后端说我能替他改(can.proxy)
const proxyMode = computed(() => viewingOther.value && !!data.value?.can?.proxy)
const proxyTarget = computed(() => (proxyMode.value ? String(data.value.owner?.id || ownerId.value) : ''))
/** 能动手(本人或代管): 改计划 / 记进展 / 自评 / 未达成 */
const canAct = computed(() => !viewingOther.value || proxyMode.value)
const ownerName = computed(() => data.value?.owner?.name || people.value?.find?.(p => sameId(p.id, ownerId.value))?.name || '')
const meName = me.name || me.username || ''
const weekKeyNow = computed(() => data.value?.cycle?.key || data.value?.week || route.query.week || weekKey(isoWeekOf()))
const weekParts = computed(() => parseKey(weekKeyNow.value) || isoWeekOf())

const submittedOnce = computed(() => (data.value?.objectives || []).some(o => o.submittedAt))

// 补录 / 空态 / 周切换边界
const weekDates = computed(() => {
  const d = data.value
  if (d?.cycle) return { start: d.cycle.startDate, end: d.cycle.endDate }
  if (d?.startDate) return { start: d.startDate, end: d.endDate }
  const s = weekStart(weekParts.value)
  return { start: s.toISOString(), end: new Date(s.getTime() + 7 * 86400000 - 1).toISOString() }
})
const win = computed(() => weekWindow(data.value?.window))
const nav = computed(() => weekNav(weekKeyNow.value, win.value))
const isPastWeek = computed(() => {
  const d = data.value
  if (d?.cycle?.backfilled != null) return d.cycle.backfilled
  if (d && !d.cycle && d.backfill != null) return d.backfill
  return isPastKey(weekKeyNow.value)
})
const weekLabel = computed(() => shortWeekLabel(weekKeyNow.value, $t))
const empty = computed(() => emptyState(data.value, { viewingOther: viewingOther.value, ownerName: ownerName.value }))
/** 编辑器开着: 有周期且在编辑; 或周期还没建(补录 / 新建)但后端说能建 */
const editorOpen = computed(() => !!data.value && editing.value && (!!data.value.cycle || !!data.value.can?.create))
const deadlinePassed = computed(() => {
  const d = data.value
  if (d?.cycle) return !!d.cycle.deadlinePassed
  return d?.submitDeadline ? Date.now() >= new Date(d.submitDeadline).getTime() : isPastWeek.value
})
const backfillTag = computed(() => (isBackfilledPlan(data.value) ? $t('okr.backfill.tag') : ''))
const canEditPlan = computed(() => canAct.value && data.value?.can?.edit)

const tagText = computed(() => {
  const d = data.value
  if (!d?.cycle) return ''
  if (viewingOther.value && d.personalStatus === 'NOT_SUBMITTED') return $t('okr.personal.NOT_SUBMITTED')
  return $t('okr.personal.' + d.personalStatus)
})
const tagType = computed(() => PERSONAL_TAG[data.value?.personalStatus] || 'info')

const isClosed = computed(() => data.value?.cycle?.status === 'CLOSED')
const krBusy = ref('')

// ---------------------------------------------------------------- 0.6.2 二级确认 / 变更申请 / 修改记录
const changeMode = ref(false)
const auditOpen = ref(false)
const locked = computed(() => isLocked(data.value))
const cfBar = computed(() => confirmBar(data.value, {
  meId, submitted: submittedOnce.value, ownerId: data.value?.owner?.id || ownerId.value || meId, isAdmin: me.role === 'ADMIN'
}))
/** 「申请变更」: 本人或代管、已锁定、没归档(有待批申请时也出, 点了提示「已有一条待批申请」) */
const showChangeBtn = computed(() => canAct.value && locked.value && !isClosed.value && !!data.value?.cycle)
const showAuditBtn = computed(() => !!data.value?.can?.viewAudit && locked.value)

async function confirmOwner() {
  busy.value = 'confirm'
  try {
    await fde.okr.confirmOwner(weekKeyNow.value, proxyTarget.value || undefined)
    ElMessage.success($t('okr.confirm.confirmed_ok'))
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

/** 主管确认; 0.6.5 管理员自己那份(cfBar.self)弹窗写清「这是你自己的 OKR」, 不用切到团队页 */
async function confirmManager() {
  const selfConfirm = !!cfBar.value?.self
  try {
    await ElMessageBox.confirm(
      selfConfirm ? $t('okr.confirm.self_confirm_body') : $t('okr.confirm.manager_confirm_body'),
      selfConfirm ? $t('okr.confirm.self_confirm_title') : $t('okr.confirm.manager_confirm_title'),
      { type: 'warning', confirmButtonText: selfConfirm ? $t('okr.confirm.confirm_lock') : $t('okr.confirm.confirm_manager'), cancelButtonText: $t('common.cancel') }
    )
  } catch { return }
  busy.value = 'confirm'
  try {
    await fde.okr.confirmManager(weekKeyNow.value, data.value?.owner?.id || ownerId.value || meId)
    ElMessage.success(selfConfirm ? $t('okr.confirm.self_confirmed_ok') : $t('okr.confirm.confirmed_ok'))
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

async function cancelChange(id, { ask = true } = {}) {
  if (ask) {
    try {
      await ElMessageBox.confirm($t('okr.confirm.cancel_confirm'), $t('okr.confirm.cancel_change'), {
        type: 'warning', confirmButtonText: $t('okr.confirm.cancel_change'), cancelButtonText: $t('common.cancel')
      })
    } catch { return }
  }
  busy.value = 'confirm'
  try {
    await fde.okr.cancelChange(id)
    ElMessage.success($t('okr.confirm.canceled'))
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

/** 0.6.6 管理员批准自己提的变更申请(蓝条「批准」), 不用切到团队页 */
async function approveOwnChange(id) {
  try {
    await ElMessageBox.confirm($t('okr.confirm.self_approve_body'), $t('okr.confirm.self_approve_title'), {
      type: 'warning', confirmButtonText: $t('okr.confirm.approve'), cancelButtonText: $t('common.cancel')
    })
  } catch { return }
  busy.value = 'confirm'
  try {
    await fde.okr.approveChange(id)
    ElMessage.success($t('okr.confirm.self_approved_ok'))
    await load()
  } catch (e) {
    ElMessage.error({ message: e.message, duration: 6000 })
  } finally {
    busy.value = ''
  }
}

/** 「申请变更」→ 编辑态; 已有待批申请 → 只提示, 给「撤回申请」(只有申请人自己能撤) */
async function startChange() {
  const pend = pendingChangeOf(data.value)
  if (pend) {
    const mine = String(pend.requestedBy?.id || '') === String(meId)
    try {
      await ElMessageBox.confirm($t('okr.confirm.pending_exists_body'), $t('okr.confirm.pending_exists'), {
        type: 'info', showConfirmButton: mine, distinguishCancelAndClose: true,
        confirmButtonText: $t('okr.confirm.cancel_change'), cancelButtonText: $t('okr.confirm.got_it')
      })
    } catch { return }
    return cancelChange(pend.id, { ask: false })
  }
  draftInit.value = toDraft(data.value.objectives)
  changeMode.value = true
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  changeMode.value = false
}

function onEditorSubmit(objs) {
  if (changeMode.value) return submitChange(objs)
  return savePlan(objs, true)
}

/** 提交变更申请: 弹窗写原因(必填, ≥4 字) → POST /plan/changes(带整份计划)→ 回到只读, 顶部变蓝 */
async function submitChange(objectives) {
  if (!editorRef.value?.isDirty?.()) {
    ElMessage.warning($t('okr.confirm.change_no_diff'))
    return
  }
  let reason
  try {
    const r = await ElMessageBox.prompt('', $t('okr.confirm.reason_title'), {
      inputType: 'textarea', inputPlaceholder: $t('okr.confirm.reason_ph'),
      inputValidator: v => reasonOk(v) || $t('okr.confirm.reason_short'),
      confirmButtonText: $t('okr.confirm.submit_change'), cancelButtonText: $t('common.cancel'),
      customClass: 'okr-reason-box'
    })
    reason = r.value.trim()
  } catch { return }
  busy.value = 'submit'
  try {
    await fde.okr.requestChange({ week: weekKeyNow.value, reason, objectives }, proxyTarget.value || undefined)
    ElMessage.success($t('okr.confirm.change_sent'))
    cancelEdit()
    await load()
  } catch (e) {
    ElMessage.error({ message: e.message, duration: 6000 })
  } finally {
    busy.value = ''
  }
}

/**
 * KR 完成开关: 点了就调 /krs/:id/complete, 用返回值就地改这一行和所在 O 的完成度(不整页刷新)。
 * 标「未完成」时数值型 KR 进度还是 0 → 先问实际做到多少, 先记进度(PATCH currentValue)再标未完成
 */
async function completeKr({ kr, done }) {
  let value = null
  if (!done && needsProgressPrompt(kr)) {
    const max = progressMax(kr)
    const msg = kr.metricType === 'PERCENT'
      ? $t('okr.v3.progress_prompt_pct', { p0: kr.title })
      : $t('okr.v3.progress_prompt_num', { p0: kr.title, p1: max, p2: kr.unit || '' })
    try {
      const r = await ElMessageBox.prompt(msg, $t('okr.v3.progress_title'), {
        confirmButtonText: $t('okr.v3.progress_confirm'), cancelButtonText: $t('common.cancel'),
        inputValue: '0',
        inputValidator: v => parseProgress(v, kr) != null || $t('okr.v3.progress_invalid', { p0: max })
      })
      value = parseProgress(r.value, kr)
    } catch { return }
  }
  krBusy.value = kr.id
  try {
    const t = proxyTarget.value || undefined
    if (value != null && value !== Number(kr.currentValue || 0)) await fde.okr.patchKr(kr.id, { currentValue: value }, t)
    const r = await fde.okr.completeKr(kr.id, { done }, t)
    applyKrComplete(data.value, r)
    ElMessage.success(done ? $t('okr.v3.marked_done') : $t('okr.v3.marked_missed'))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    krBusy.value = ''
  }
}

/**
 * OKR 6.0 阶段型 KR: 点某个阶段 → 推进到它(或取消它及之后)。全部完成走 /complete(done=true),
 * 其余 PATCH /krs/:id 改已完成阶段数(附带期望的阶段明细, 后端按数量回写 done); 成功后就地更新这一行和完成度
 */
async function clickMilestone({ kr, index }) {
  const act = milestoneClick(kr, index)
  if (!act) return
  krBusy.value = kr.id
  try {
    const t = proxyTarget.value || undefined
    if (act.kind === 'complete') {
      applyKrComplete(data.value, await fde.okr.completeKr(kr.id, { done: true }, t))
      ElMessage.success($t('okr.ms.all_done'))
    } else {
      const r = await fde.okr.patchKr(kr.id, { currentValue: act.value, milestones: milestonesWithDone(kr.milestones, act.value) }, t)
      applyMilestonePatch(data.value, kr.id, r)
      ElMessage.success($t('okr.ms.saved', { p0: act.value, p1: kr.milestones.length }))
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    krBusy.value = ''
  }
}

// OKR 6.0 卡点: 卡在谁可以选全公司在职的人(/users/mentionable, 登录即可); 能改卡点时才拉
const blkUsers = ref([])
let blkUsersLoaded = false
watch(() => !!canEditPlan.value, async (v) => {
  if (!v || blkUsersLoaded) return
  blkUsersLoaded = true
  try { blkUsers.value = (await fde.users.mentionable())?.list || [] } catch { blkUsers.value = [] }
}, { immediate: true })

/** 改某个 O 的卡点 / 风险: /plan 是整份覆盖, 其他 O 原样带上(不带卡点字段 = 不动)。后端 8120 的文案原样提示 */
async function saveBlocker({ objectiveId, form, done }) {
  try {
    const plan = planWithPatch(data.value.objectives, objectiveId, blockerPatch(form))
    await fde.okr.savePlan(weekKeyNow.value, plan, proxyTarget.value || undefined)
    ElMessage.success($t('okr.blk.saved'))
    done(true)
    await load()
  } catch (e) {
    ElMessage.error({ message: e.message, duration: 6000 })
    done(false)
  }
}

// ---------------------------------------------------------------- OKR 8.0 导出 / 10.0 连续未达成
const exportMenu = computed(() => exportItems({ page: 'mine', user: me, week: weekKeyNow.value, userId: ownerId.value || meId }))

// 预警范围后端裁(工程师只拿到自己的); 这里再按「当前看的人」筛, 看别人时显示他的
const riskItems = ref([])
const riskMap = computed(() => riskByObjective(riskItems.value))
const riskBars = computed(() => myRiskBars(riskItems.value, ownerId.value || meId))
watch(() => ownerId.value, async () => {
  try { riskItems.value = (await fde.okr.riskObjectives())?.items || [] } catch { riskItems.value = [] }
}, { immediate: true })

const flashId = ref('')
let pendingLook = null
/** 「看看」: 这一周有这个 O 就滚过去并闪一下; 没有就切到它最近未达成的那一周, 载完再滚 */
function lookRisk(item) {
  const id = findRiskTarget(data.value?.objectives || [], item)
  if (id) return scrollToObjective(id)
  if (item.week && item.week !== weekKeyNow.value) {
    pendingLook = item
    ElMessage.info($t('okr.fe5.risk_not_on_page', { p0: item.week }))
    router.replace({ query: { ...route.query, week: item.week } })
  }
}
function scrollToObjective(id) {
  // 正在写计划时卡片不渲染: 不替人关编辑器(会丢没保存的改动), 找不到元素就不滚
  nextTick(() => {
    document.getElementById('okr-obj-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flashId.value = String(id)
    setTimeout(() => { if (flashId.value === String(id)) flashId.value = '' }, 2000)
  })
}
watch(data, (d) => {
  if (!pendingLook || !d) return
  const id = findRiskTarget(d.objectives || [], pendingLook)
  pendingLook = null
  if (id) scrollToObjective(id)
})

// ---------------------------------------------------------------- OKR 7.0 编计划提效
const copy = reactive({ visible: false, from: '' })
const imp = reactive({ visible: false, text: '' })
const tpl = reactive({ visible: false, md: '' })
const copyWeeks = computed(() => copySourceWeeks(weekKeyNow.value))
const copyWeekLabel = (w) => (w === copyWeeks.value[0] ? $t('okr.plan.copy_last_week', { p0: w }) : w)

/** 复制 / 导入会重载编辑器: 有没保存的改动先确认 */
async function confirmDiscard() {
  if (!editorRef.value?.isDirty?.()) return true
  try {
    await ElMessageBox.confirm($t('okr.plan.discard_confirm'), $t('okr.plan.discard_title'), {
      type: 'warning', confirmButtonText: $t('okr.plan.discard_go'), cancelButtonText: $t('common.cancel')
    })
    return true
  } catch { return false }
}

function openCopy() {
  copy.from = copyWeeks.value[0]
  copy.visible = true
}

async function runCopy() {
  if (!(await confirmDiscard())) return
  busy.value = 'copy'
  try {
    const r = await fde.okr.copyFromWeek({ fromWeek: copy.from, toWeek: weekKeyNow.value }, proxyTarget.value || undefined)
    copy.visible = false
    const msg = copyResultText(r, $t)
    ElMessage({
      type: msg.level, duration: msg.lines.length ? 8000 : 4000, showClose: true,
      message: h('div', { class: 'okr-copy-toast', 'data-test': 'okr-copy-toast' }, [h('div', msg.text), ...msg.lines.map(l => h('div', { style: 'font-size:12px;opacity:.85' }, '· ' + l))])
    })
    if (r.createdObjectives) await reloadEditor()
  } catch (e) {
    ElMessage.error({ message: e.message, duration: 6000 })
  } finally {
    busy.value = ''
  }
}

function openImport(text) {
  imp.text = text || ''
  imp.visible = true
}

async function onImported(r) {
  imp.visible = false
  const skipped = r.skipped?.length || 0
  ElMessage[skipped || r.truncated ? 'warning' : 'success']({
    message: $t(skipped ? 'okr.plan.bulk_done_skip' : 'okr.plan.bulk_done', { p0: r.createdObjectives, p1: r.createdKrs, p2: skipped }),
    duration: 5000
  })
  await reloadEditor()
}

/** 复制 / 导入写的是服务器上的草稿: 重拉后编辑器显示服务器上的计划(load 在没提交时会自动进编辑) */
async function reloadEditor() {
  await load()
  if (data.value?.can?.edit && !editing.value) {
    draftInit.value = toDraft(data.value.objectives)
    editing.value = true
  }
}

function openTemplates() {
  tpl.md = planToMarkdown(editorRef.value?.getPlan?.() || [])
  tpl.visible = true
}

function useTemplate(tp) {
  tpl.visible = false
  openImport(tp.contentMd)
}

const scorable = computed(() => (data.value?.objectives || []).filter(o => o.submittedAt && o.status !== 'DROPPED'))
/** 自评按钮: 本人或代管、计划已提交; 不看时间(后端 can.selfScore 只在归档后为 false), 归档后置灰 */
const showSelfBtn = computed(() => canAct.value && submittedOnce.value && scorable.value.length > 0 && (!!data.value?.can?.selfScore || isClosed.value))
const selfAllDone = computed(() => scorable.value.length > 0 && scorable.value.every(o => o.selfScore != null))
const selfBtnText = computed(() => {
  const score = data.value?.selfScore != null ? Math.round(data.value.selfScore) : null
  if (isClosed.value) return selfAllDone.value && score != null ? $t('okr.v3.self_done_closed', { p0: score }) : $t('okr.v3.closed_btn')
  return selfAllDone.value && score != null ? $t('okr.v3.self_done_btn', { p0: score }) : $t('okr.v3.self_submit')
})
/** KR 处理情况(自评前置): 前端自算, 后端 8112 兜底 */
const handling = computed(() => krHandling(data.value?.objectives))

// ---------------------------------------------------------------- 0.6.6 管理员: 全部待审批的变更申请
// 不传 week(跨周), 跟着页面每次 load 一起刷(换周 / 自己批完 / 撤回后都会重拉); 非 ADMIN 不拉
const isAdmin = me.role === 'ADMIN'
const adminChanges = ref([])
const adminChangesOpen = ref(false)
const adminPending = computed(() => adminChanges.value.filter(c => decidable(c, meId, { isAdmin: true })))
let adminSeq = 0
async function loadAdminPending() {
  if (!isAdmin) return
  const seq = ++adminSeq
  try {
    const list = await fde.okr.changes({ status: 'PENDING' })
    if (seq === adminSeq) adminChanges.value = Array.isArray(list) ? list : (list?.items || [])
  } catch { /* 拉不到就不出这条 */ }
}
/** 弹窗里批 / 驳后: 移除这条; 正在看的就是这份计划(同周同人)就重拉页面 */
async function onAdminDecided({ id, ownerId: owner }) {
  const c = adminChanges.value.find(x => String(x.id) === String(id))
  adminChanges.value = adminChanges.value.filter(x => String(x.id) !== String(id))
  if (!adminChanges.value.length) adminChangesOpen.value = false
  const viewing = String(data.value?.owner?.id || ownerId.value || meId)
  if (c && c.week === weekKeyNow.value && sameId(owner, viewing)) await load()
}
/** 弹窗里点周次: 跳到那一周(负责人不是自己就带上 ?userId= 看那份计划), 关弹窗 */
function adminGotoWeek({ week, ownerId: owner }) {
  adminChangesOpen.value = false
  if (!week) return
  router.push({ query: { ...queryForPerson(route.query, owner || meId, meId), week } })
}

async function load() {
  loadAdminPending()
  loading.value = true
  try {
    const d = await fde.okr.cycle({ week: route.query.week, ownerId: ownerId.value })
    if (d.owner) ensurePerson(d.owner)
    for (const o of d.objectives || []) {
      o.updatedKey = (o.updates?.length || 0) + ':' + (o.selfScore ?? '') + ':' + (o.managerScore ?? '')
    }
    data.value = d
    changeMode.value = false
    // 本人(或代管人)、可编辑、还没提交过 → 直接进入写计划。看别人且无代管权时 can.edit 本来就是 false
    // 这周一条 O 都没有时不自动进编辑器: 先给空态卡(本周「本周(2026-W48)还没写 OKR / 写本周 OKR」, 过去周「补录这一周」), 点了再进。
    // 0.6.7: 以前本周空着会直接弹编辑器、没有任何提示, 老板以为页面坏了
    const noObjs = !(d.objectives || []).length
    editing.value = !!d.cycle && !!d.can?.edit && !(d.objectives || []).some(o => o.submittedAt) && (!viewingOther.value || !!d.can?.proxy) && !noObjs
    if (editing.value) draftInit.value = toDraft(d.objectives)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

watch(() => [route.query.week, ownerId.value], load, { immediate: true })
watch(() => route.query.week, w => loadPeople(w), { immediate: true })

// 0.6.5 O / KR 数量上限: 进页面读一次(不随周切换 / 渲染重拉); 拿不到回退 3 / 10, 不报错
const limits = ref(normalizeLimits(null))
loadLimits(fde.okr.limits).then((l) => { limits.value = l })

function pickPerson(id) {
  router.replace({ query: queryForPerson(route.query, id, meId) })
}

function openDraft(source) {
  reportSource.value = source
  reportOpen.value = true
}

function shift(delta) {
  router.replace({ query: { ...route.query, week: shiftKey(weekKeyNow.value, delta) } })
}

/** 空态主操作: 补录 / 新建 / 代补录 —— 都是直接进编辑器(周期由保存时的写接口建) */
function startBackfill() {
  draftInit.value = toDraft(data.value?.objectives)
  editing.value = true
}

function startEdit() {
  draftInit.value = toDraft(data.value.objectives)
  editing.value = true
}

/** 贴周报 / 导入文档生成的草稿填进编辑器: 覆盖前确认; 追加接在已有 O 后面。只填不存、永不自动提交 */
async function fillFromReport(objectives, { mode = 'replace' } = {}) {
  if (mode === 'append' && editorRef.value) {
    const r = mergeDraft(editorRef.value.getPlan(), objectives, 'append', { max: limits.value.maxObjectives })
    draftInit.value = r.objectives
    reportOpen.value = false
    if (r.dropped) ElMessage.warning($t('okr.import.dropped', { p0: r.dropped, p1: limits.value.maxObjectives }))
    else ElMessage.success($t('okr.report.filled'))
    return
  }
  if (editorRef.value?.hasContent()) {
    try {
      await ElMessageBox.confirm($t('okr.report.confirm_replace'), $t('okr.report.fill'), {
        type: 'warning', confirmButtonText: $t('okr.report.replace'), cancelButtonText: $t('common.cancel')
      })
    } catch { return }
  }
  draftInit.value = objectives
  reportOpen.value = false
  ElMessage.success($t('okr.report.filled'))
}

async function savePlan(objectives, submit) {
  // 代提交: 二次确认, 说清迟交按被代填人的时间算
  if (submit && proxyMode.value) {
    try {
      await ElMessageBox.confirm($t('okr.proxy.confirm_submit', { p0: ownerName.value }), $t('okr.proxy.submit_for', { p0: ownerName.value }), {
        type: 'warning', confirmButtonText: $t('okr.proxy.submit_for', { p0: ownerName.value }), cancelButtonText: $t('common.cancel')
      })
    } catch { return }
  }
  busy.value = submit ? 'submit' : 'save'
  try {
    const week = weekKeyNow.value
    const t = proxyTarget.value || undefined
    const d = submit ? await fde.okr.submitPlan(week, objectives, t) : await fde.okr.savePlan(week, objectives, t)
    if (submit) ElMessage.success(d.lateSubmit ? $t('okr.submitted_late') : $t('okr.submitted'))
    else ElMessage.success($t('okr.draft_saved'))
    await load()
  } catch (e) {
    ElMessage.error(e.message)
    // 0.6.2: 别人刚好把这周确认锁了 → 关编辑器, 重拉后只剩「申请变更」
    if (e.code === LOCKED_CODE) await load()
  } finally {
    busy.value = ''
  }
}

async function addUpdate({ objectiveId, payload, done }) {
  if (!payload.content && payload.valueAfter === undefined) {
    ElMessage.warning($t('okr.write_something'))
    return
  }
  busy.value = 'update'
  try {
    if (!payload.content) payload.content = $t('okr.value_updated')
    await fde.okr.addUpdate(objectiveId, payload, proxyTarget.value || undefined)
    done()
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

function openSelf() {
  if (isClosed.value) return
  self.rows = scorable.value.map(o => ({ id: o.id, seq: o.seq, title: o.title, progress: o.progress, original: o.selfScore ?? null, score: o.selfScore ?? null, comment: '' }))
  self.visible = true
}

/** 一次交完所有 O 的自评: 分数没变、也没写备注的不重复提交。KR 没处理完后端回 8112(点名缺哪几条) */
async function submitSelf() {
  if (handling.value.missing.length || !scoresComplete(self.rows)) return
  busy.value = 'self'
  try {
    const t = proxyTarget.value || undefined
    for (const r of self.rows) {
      if (r.score === r.original && !r.comment.trim()) continue
      const res = await fde.okr.selfScore({ objectiveId: r.id, score: r.score, comment: r.comment.trim() }, t)
      r.original = res.score
    }
    self.visible = false
    ElMessage.success($t('okr.v3.self_saved'))
    await load()
  } catch (e) {
    ElMessage.error({ message: e.message, duration: 6000 })
    if (e.code === 8112) await load()
  } finally {
    busy.value = ''
  }
}

async function managerScore(p) {
  try {
    await fde.okr.managerScore(p)
    ElMessage.success($t('okr.scored'))
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function openMiss(o) {
  Object.assign(miss, { visible: true, obj: o, reason: '', carry: false })
}

async function submitMiss() {
  busy.value = 'miss'
  try {
    const r = await fde.okr.miss(miss.obj.id, { reason: miss.reason, carryToNextWeek: miss.carry }, proxyTarget.value || undefined)
    ElMessage.success(r.carriedToWeek ? $t('okr.carried', { p0: r.carriedToWeek }) : $t('okr.miss_saved'))
    miss.visible = false
    await load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.okr-page { max-width: 720px; margin: 0 auto; padding: 4px 0 24px; }
.okr-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.okr-top-right { display: inline-flex; align-items: center; gap: 12px; flex: none; }
.okr-flash :deep(.okr-card), .okr-flash.okr-card { box-shadow: 0 0 0 2px var(--el-color-danger-light-5); transition: box-shadow .3s; }
.okr-top-link { font-size: 13px; color: var(--el-color-primary); text-decoration: none; padding: 12px 0; }
.okr-proxy-bar { position: sticky; top: 0; z-index: 5; margin-bottom: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 600;
  color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); border: 1px solid var(--el-color-warning-light-5); }
.okr-quick-btns { display: flex; gap: 6px; flex: none; flex-wrap: wrap; justify-content: flex-end; }
.okr-owner { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 13px; }
.okr-owner a { color: var(--el-color-primary); text-decoration: none; }
.okr-owner-mid { color: var(--el-text-color-secondary); font-size: 12px; }
.okr-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-bottom: 10px; font-size: 13px; color: var(--el-text-color-secondary); }
.okr-summary b { color: var(--el-text-color-primary); font-size: 15px; }
.okr-edit-link { margin-left: auto; border: 0; background: none; color: var(--el-color-primary); font-size: 13px; cursor: pointer; padding: 4px 0; }
.okr-edit-locked { display: inline-flex; }
.okr-edit-locked .okr-edit-link { margin-left: 0; color: var(--el-text-color-placeholder); cursor: not-allowed; pointer-events: none; }
.okr-admin-pending-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; padding: 8px 12px; border-radius: 8px;
  font-size: 13px; font-weight: 600; color: #1d4f91; background: #eaf2fd; border: 1px solid #a9c8f2; }
.okr-admin-pending-bar .el-button { flex: none; margin-left: 0; }
@media (max-width: 640px) { .okr-admin-pending-btn { min-height: 36px; } }
.okr-change-bar { margin-bottom: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #1d4f91; background: #eaf2fd; border: 1px solid #a9c8f2; }
.okr-quick { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; background: var(--el-color-primary-light-9); }
.okr-quick-text { font-size: 12px; color: var(--el-text-color-regular); min-width: 0; }
.okr-quick .el-button { flex: none; margin-left: 0; }
.okr-list { display: flex; flex-direction: column; gap: 10px; }
.okr-empty { color: var(--el-text-color-secondary); font-size: 13px; text-align: center; padding: 24px 0; }
.okr-empty-box { display: flex; flex-direction: column; align-items: center; gap: 12px; background: var(--el-bg-color); border: 1px dashed var(--el-border-color); border-radius: 10px; padding: 28px 16px; margin-top: 12px; }
.okr-empty-box p { margin: 0; }
.okr-empty-title { font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); }
.okr-empty-btn { min-height: 44px; padding: 0 20px; }
.okr-backfill-bar { margin-bottom: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 600;
  color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); border: 1px solid var(--el-color-warning-light-5); }
.okr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.okr-actions .el-button { margin-left: 0; }
.okr-act-btn { min-height: 40px; padding: 0 18px; font-weight: 600; }
.okr-act-mgr { font-weight: 500; }
.okr-act-warn { font-size: 12px; color: var(--el-color-warning-dark-2); }
.okr-sp { display: flex; flex-direction: column; gap: 12px; }
.okr-sp-handling { margin: 0; font-size: 14px; font-weight: 600; color: var(--el-color-warning-dark-2); }
.okr-sp-handling.ok { color: var(--el-color-success); }
.okr-sp-missing { padding: 10px 12px; border-radius: 8px; font-size: 13px; background: var(--el-color-warning-light-9); border: 1px solid var(--el-color-warning-light-5); display: flex; flex-direction: column; gap: 4px; }
.okr-sp-missing ul { margin: 2px 0 0; padding-left: 18px; }
.okr-sp-missing code { font-size: 12px; font-weight: 600; }
.okr-sp-row { padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
.okr-sp-row h4 { margin: 0; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.okr-sp-seq { color: var(--el-color-primary); font-size: 12px; }
.okr-sp-meta { margin: 2px 0 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-sp-inputs { display: flex; gap: 6px; align-items: center; }
.okr-sp-inputs .el-input { flex: 1; min-width: 0; }
.okr-sp-num { width: 84px; flex: none; }
.okr-sp-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.okr-sp-foot .el-button { margin-left: 0; }
.okr-sp-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-right: auto; }
@media (max-width: 640px) {
  .okr-edit-link { min-height: 44px; }
  .okr-act-btn { min-height: 44px; flex: 1 1 0; }
  .okr-act-warn { flex-basis: 100%; }
  .okr-sp-foot .el-button { min-height: 44px; flex: 1 1 0; }
}
.okr-num { width: 72px; flex: none; }
.okr-plan-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.okr-plan-tools .el-button { margin-left: 0; }
.okr-copy-week { width: 100%; }
@media (max-width: 640px) {
  .okr-tool-btn { min-height: 44px; flex: 1 1 0; padding: 0 8px; }
}
.okr-dialog-sub { margin: 0 0 8px; font-weight: 600; }
.okr-carry { margin-top: 8px; }
.okr-dialog-warn { margin: 8px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
