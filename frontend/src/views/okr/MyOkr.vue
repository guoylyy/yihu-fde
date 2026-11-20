<template>
  <!-- 我的 OKR(手机优先): 周一写计划 → 周中追加进展 → 周五自评 → 下周一归档只读
       顶部「人」筛选切到别人(?userId=): 默认只读; 有代管权限(can.proxy)就进代编辑, 写操作带 targetUserId。
       主管评分只给 okr.score.manager(ADMIN), 其他人界面上不渲染 -->
  <div class="okr-page" v-loading="loading">
    <div class="okr-top">
      <OkrPersonPicker :model-value="pickedId" :people="people" :me-id="meId" :compact="isMobile" @change="pickPerson" />
      <router-link v-if="viewingOther" class="okr-top-link" data-test="okr-person-detail" :to="{ path: `/admin/okr/person/${ownerId}`, query: { week: weekKeyNow } }">{{ $t('okr.people.detail') }} ›</router-link>
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

    <div v-if="viewingOther && data?.owner" class="okr-owner">
      <router-link :to="{ path: '/admin/okr/team', query: { week: weekKeyNow } }">‹ {{ $t('okr.tab_team') }}</router-link>
      <!-- 人名已在顶部筛选器里, 这里不再重复 -->
      <span class="okr-owner-mid">{{ $t('okr.people.owner_okr') }}</span>
      <router-link :to="{ path: '/admin/okr/history', query: { ownerId: data.owner.id } }">{{ $t('okr.tab_history') }}</router-link>
    </div>

    <template v-if="data">
      <!-- 本周一句话概况 -->
      <div v-if="data.objectives.length && !editing" class="okr-summary">
        <span>{{ $t('okr.completion') }} <b>{{ pct(data.completion) ?? '-' }}%</b></span>
        <span v-if="data.selfScore != null">{{ $t('okr.self_score') }} <b>{{ data.selfScore }}</b></span>
        <span v-if="data.managerScore != null && (canScoreManager || !viewingOther)">{{ $t('okr.manager_score') }} <b>{{ data.managerScore }}</b></span>
        <button v-if="canEditPlan" type="button" class="okr-edit-link" @click="startEdit">{{ $t('okr.edit_plan') }}</button>
      </div>

      <!-- 这周一条 O 都没有: 空态必须带去处(补录 / 新建 / 代补录); 只有已归档、超出窗口、看别人且无代管权时才只有说明 -->
      <div v-if="empty && !editing" class="okr-empty okr-empty-box" data-test="okr-empty">
        <p>{{ $t(...empty.text) }}</p>
        <el-button v-if="empty.action" type="primary" class="okr-empty-btn" :data-test="'okr-empty-' + empty.action" @click="startBackfill">{{ $t(...empty.label) }}</el-button>
      </div>

      <!-- 补录: 编辑器顶部常驻一条, 说清这周已过、提交记迟交 -->
      <div v-if="editing && isPastWeek" class="okr-backfill-bar" role="status" data-test="okr-backfill-bar">
        {{ $t('okr.backfill.banner', { p0: weekLabel }) }}
      </div>

      <!-- 本周还没提交: 贴周报生成草稿(只填编辑器, 不提交)。代管时常驻, 另加「导入文档生成」 -->
      <div v-if="editorOpen && (proxyMode || (!submittedOnce && !viewingOther))" class="okr-quick">
        <span class="okr-quick-text">{{ proxyMode ? $t('okr.import.entry_hint', { p0: ownerName }) : $t('okr.report.entry_hint') }}</span>
        <span class="okr-quick-btns">
          <el-button type="primary" plain size="small" data-test="report-open" @click="openDraft('text')">{{ $t('okr.report.open') }}</el-button>
          <el-button v-if="proxyMode" type="primary" plain size="small" data-test="import-open" @click="openDraft('file')">{{ $t('okr.import.open') }}</el-button>
        </span>
      </div>

      <!-- 写计划 / 改计划 -->
      <OkrPlanEditor
        v-if="editorOpen" ref="editorRef"
        :initial="draftInit" :submitted="submittedOnce" :cancellable="submittedOnce || !!empty" :busy="busy"
        :late-hint="deadlinePassed && !submittedOnce"
        :submit-label="proxyMode ? $t('okr.proxy.submit_for', { p0: ownerName }) : ''"
        @save="(objs) => savePlan(objs, false)" @submit="(objs) => savePlan(objs, true)" @cancel="editing = false"
      />

      <template v-else-if="data.cycle">
        <div class="okr-list">
          <OkrObjectiveCard
            v-for="o in data.objectives" :key="o.id + ':' + o.updatedKey" :obj="o"
            :can-edit="data.can.edit && !!o.submittedAt && o.status !== 'DROPPED'"
            :can-miss="canAct && data.cycle.status === 'REVIEW' && !['DONE', 'MISSED', 'DROPPED'].includes(o.status)"
            :can-manager-score="canScoreManager && data.can.managerScore && !!o.submittedAt"
            :busy="busy === 'update'"
            @add-update="addUpdate" @miss="openMiss" @manager-score="managerScore"
          />
        </div>

        <!-- 周五: 本周自评。首屏只放一个按钮, 点开逐条打分(一次一个 O), 不把 2×N 个输入框摊在卡片下面 -->
        <div v-if="showSelfScore" class="okr-self">
          <div class="okr-self-text">
            <h3>{{ $t('okr.self_review') }}</h3>
            <span>{{ $t('okr.self_progress', { p0: selfDone, p1: scorable.length }) }}</span>
          </div>
          <el-button type="primary" @click="openSelf">{{ selfDone ? $t('okr.self_review_edit') : $t('okr.self_review') }}</el-button>
        </div>
      </template>
    </template>

    <!-- 本周自评: 逐个 O 打分, 每步单独保存(后端每次评分都留历史) -->
    <el-dialog v-model="self.visible" :title="$t('okr.self_review')" width="min(92vw, 460px)" append-to-body>
      <template v-if="selfObj">
        <p class="okr-self-step">{{ $t('okr.self_step', { p0: self.idx + 1, p1: scorable.length }) }}</p>
        <p class="okr-dialog-sub">O{{ selfObj.seq }} {{ selfObj.title }}</p>
        <p class="okr-self-meta">
          {{ $t('okr.completion') }} {{ pct(selfObj.progress) }}%
          <template v-if="selfObj.selfScore != null"> · {{ $t('okr.scored_n', { p0: selfObj.selfScore }) }}</template>
        </p>
        <div class="okr-self-inputs">
          <el-input-number v-model="self.score" :min="0" :max="100" :controls="false" :placeholder="$t('okr.score_0_100')" class="okr-num" />
          <el-input v-model="self.comment" maxlength="200" :placeholder="$t('okr.one_line_reason')" @keyup.enter="selfNext" />
        </div>
      </template>
      <template #footer>
        <el-button v-if="self.idx > 0" @click="selfGo(self.idx - 1)">{{ $t('okr.prev_o') }}</el-button>
        <el-button v-else @click="self.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="self.score == null" :loading="busy === 'self'" @click="selfNext">
          {{ self.idx < scorable.length - 1 ? $t('okr.score_and_next') : $t('okr.score_and_finish') }}
        </el-button>
      </template>
    </el-dialog>

    <OkrReportDraftDialog
      v-model="reportOpen" :source="reportSource" :target-user-id="proxyTarget" :target-name="proxyMode ? ownerName : ''"
      @fill="fillFromReport"
    />

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
import { computed, reactive, ref, watch } from 'vue'
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
import {
  PERSONAL_TAG, pct, toDraft, shiftKey, parseKey, isoWeekOf, weekKey, weekStart,
  weekWindow, weekNav, isPastKey, shortWeekLabel, emptyState, isBackfilledPlan
} from './okrUtils.js'
import { viewedUserId, queryForPerson, sameId, mergeDraft } from './okrPeople.js'
import { useOkrPeople } from './useOkrPeople.js'

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
const self = reactive({ visible: false, idx: 0, score: null, comment: '', dirty: false })
const miss = reactive({ visible: false, obj: null, reason: '', carry: false })

// OKR 2.0: 团队页全员可进(后端按 ADMIN 全部 / 其他人本团队过滤)
const canTeam = computed(() => true)
const canScoreManager = can('okr.score.manager')
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

const scorable = computed(() => (data.value?.objectives || []).filter(o => o.submittedAt && o.status !== 'DROPPED'))
const showSelfScore = computed(() => canAct.value && data.value?.cycle?.status === 'REVIEW' && data.value?.can?.selfScore && scorable.value.length)

async function load() {
  loading.value = true
  try {
    const d = await fde.okr.cycle({ week: route.query.week, ownerId: ownerId.value })
    if (d.owner) ensurePerson(d.owner)
    for (const o of d.objectives || []) {
      o.updatedKey = (o.updates?.length || 0) + ':' + (o.selfScore ?? '') + ':' + (o.managerScore ?? '')
    }
    data.value = d
    // 本人(或代管人)、可编辑、还没提交过 → 直接进入写计划。看别人且无代管权时 can.edit 本来就是 false
    // 过去的周一条都没有时不自动进编辑器, 先给「补录这一周」空态, 点了再进
    const pastEmpty = !(d.objectives || []).length && (d.cycle ? !!d.cycle.backfilled : true)
    editing.value = !!d.cycle && !!d.can?.edit && !(d.objectives || []).some(o => o.submittedAt) && (!viewingOther.value || !!d.can?.proxy) && !pastEmpty
    if (editing.value) draftInit.value = toDraft(d.objectives)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

watch(() => [route.query.week, ownerId.value], load, { immediate: true })
watch(() => route.query.week, w => loadPeople(w), { immediate: true })

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
    const r = mergeDraft(editorRef.value.getPlan(), objectives, 'append')
    draftInit.value = r.objectives
    reportOpen.value = false
    if (r.dropped) ElMessage.warning($t('okr.import.dropped', { p0: r.dropped }))
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

const selfDone = computed(() => scorable.value.filter(o => o.selfScore != null).length)
const selfObj = computed(() => scorable.value[self.idx] || null)

function selfGo(i) {
  const o = scorable.value[i]
  Object.assign(self, { idx: i, score: o?.selfScore ?? null, comment: '' })
}

function openSelf() {
  // 从第一个还没评的 O 开始; 都评过了就从头改
  const first = scorable.value.findIndex(o => o.selfScore == null)
  selfGo(first < 0 ? 0 : first)
  self.dirty = false
  self.visible = true
}

async function selfNext() {
  const o = selfObj.value
  if (!o || self.score == null) return
  busy.value = 'self'
  try {
    // 分数没变、也没写新理由就不重复提交
    if (self.score !== o.selfScore || self.comment.trim()) {
      const r = await fde.okr.selfScore({ objectiveId: o.id, score: self.score, comment: self.comment.trim() }, proxyTarget.value || undefined)
      o.selfScore = r.score
      self.dirty = true
    }
    if (self.idx < scorable.value.length - 1) {
      selfGo(self.idx + 1)
    } else {
      self.visible = false
      ElMessage.success($t('okr.scored'))
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

// 关掉对话框后再拉一次, 让卡片上的「自 xx」和概况里的加权自评分同步
watch(() => self.visible, v => { if (!v && self.dirty) { self.dirty = false; load() } })

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
.okr-quick { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; background: var(--el-color-primary-light-9); }
.okr-quick-text { font-size: 12px; color: var(--el-text-color-regular); min-width: 0; }
.okr-quick .el-button { flex: none; margin-left: 0; }
.okr-list { display: flex; flex-direction: column; gap: 10px; }
.okr-empty { color: var(--el-text-color-secondary); font-size: 13px; text-align: center; padding: 24px 0; }
.okr-empty-box { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.okr-empty-box p { margin: 0; }
.okr-empty-btn { min-height: 44px; padding: 0 20px; }
.okr-backfill-bar { margin-bottom: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 600;
  color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); border: 1px solid var(--el-color-warning-light-5); }
.okr-self { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: var(--el-color-warning-light-9); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.okr-self-text { min-width: 0; }
.okr-self h3 { margin: 0; font-size: 14px; }
.okr-self-text span { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-self-step { margin: 0 0 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-self-meta { margin: 0 0 10px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-self-inputs { display: flex; gap: 6px; align-items: center; }
.okr-self-inputs .el-input { flex: 1; min-width: 0; }
.okr-num { width: 72px; flex: none; }
.okr-dialog-sub { margin: 0 0 8px; font-weight: 600; }
.okr-carry { margin-top: 8px; }
.okr-dialog-warn { margin: 8px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
