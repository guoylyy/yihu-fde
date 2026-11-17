<template>
  <!-- 我的 OKR(手机优先): 周一写计划 → 周中追加进展 → 周五自评 → 下周一归档只读
       主管/老板从团队视图点进来时带 ownerId: 只读 + 可打主管分 -->
  <div class="okr-page" v-loading="loading">
    <OkrWeekBar
      :year="weekParts.year" :week-no="weekParts.weekNo" :week-key="weekKeyNow"
      :start="data?.cycle?.startDate" :end="data?.cycle?.endDate"
      :tag-text="tagText" :tag-type="tagType" :active="viewingOther ? '' : 'mine'" :show-team="canTeam" :hide-links="viewingOther"
      @shift="shift"
    />

    <div v-if="viewingOther && data?.owner" class="okr-owner">
      <router-link :to="{ path: '/admin/okr/team', query: { week: weekKeyNow } }">‹ {{ $t('okr.tab_team') }}</router-link>
      <strong>{{ data.owner.name }}</strong>
      <router-link :to="{ path: '/admin/okr/history', query: { ownerId: data.owner.id } }">{{ $t('okr.tab_history') }}</router-link>
    </div>

    <template v-if="data">
      <!-- 本周一句话概况 -->
      <div v-if="data.objectives.length && !editing" class="okr-summary">
        <span>{{ $t('okr.completion') }} <b>{{ pct(data.completion) ?? '-' }}%</b></span>
        <span v-if="data.selfScore != null">{{ $t('okr.self_score') }} <b>{{ data.selfScore }}</b></span>
        <span v-if="data.managerScore != null">{{ $t('okr.manager_score') }} <b>{{ data.managerScore }}</b></span>
        <button v-if="canEditPlan" type="button" class="okr-edit-link" @click="startEdit">{{ $t('okr.edit_plan') }}</button>
      </div>

      <p v-if="!data.cycle" class="okr-empty">{{ $t('okr.no_cycle') }}</p>

      <!-- 写计划 / 改计划 -->
      <OkrPlanEditor
        v-else-if="editing"
        :initial="draftInit" :submitted="submittedOnce" :cancellable="submittedOnce" :busy="busy"
        :late-hint="data.cycle.deadlinePassed && !submittedOnce"
        @save="(objs) => savePlan(objs, false)" @submit="(objs) => savePlan(objs, true)" @cancel="editing = false"
      />

      <template v-else>
        <p v-if="!data.objectives.length" class="okr-empty">{{ viewingOther ? $t('okr.other_not_submitted') : $t('okr.nothing_this_week') }}</p>
        <div class="okr-list">
          <OkrObjectiveCard
            v-for="o in data.objectives" :key="o.id + ':' + o.updatedKey" :obj="o"
            :can-edit="data.can.edit && !!o.submittedAt && o.status !== 'DROPPED'"
            :can-miss="!viewingOther && data.cycle.status === 'REVIEW' && !['DONE', 'MISSED', 'DROPPED'].includes(o.status)"
            :can-manager-score="data.can.managerScore && !!o.submittedAt"
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
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import OkrWeekBar from '@/components/okr/OkrWeekBar.vue'
import OkrObjectiveCard from '@/components/okr/OkrObjectiveCard.vue'
import OkrPlanEditor from '@/components/okr/OkrPlanEditor.vue'
import { PERSONAL_TAG, pct, toDraft, shiftKey, parseKey, isoWeekOf, weekKey } from './okrUtils.js'

const route = useRoute()
const router = useRouter()

const data = ref(null)
const loading = ref(false)
const busy = ref('')
const editing = ref(false)
const draftInit = ref([])
const self = reactive({ visible: false, idx: 0, score: null, comment: '', dirty: false })
const miss = reactive({ visible: false, obj: null, reason: '', carry: false })

const canTeam = computed(() => can('okr.view.all'))
const ownerId = computed(() => route.query.ownerId || '')
const viewingOther = computed(() => !!ownerId.value && data.value?.owner && !isMe(data.value.owner.id))
const weekKeyNow = computed(() => data.value?.cycle?.key || data.value?.week || route.query.week || weekKey(isoWeekOf()))
const weekParts = computed(() => parseKey(weekKeyNow.value) || isoWeekOf())

function isMe(id) {
  try { return String(JSON.parse(localStorage.getItem('fde_internal_user') || '{}').id) === String(id) } catch { return false }
}

const submittedOnce = computed(() => (data.value?.objectives || []).some(o => o.submittedAt))
const canEditPlan = computed(() => !viewingOther.value && data.value?.can?.edit)

const tagText = computed(() => {
  const d = data.value
  if (!d?.cycle) return ''
  if (viewingOther.value && d.personalStatus === 'NOT_SUBMITTED') return $t('okr.personal.NOT_SUBMITTED')
  return $t('okr.personal.' + d.personalStatus)
})
const tagType = computed(() => PERSONAL_TAG[data.value?.personalStatus] || 'info')

const scorable = computed(() => (data.value?.objectives || []).filter(o => o.submittedAt && o.status !== 'DROPPED'))
const showSelfScore = computed(() => !viewingOther.value && data.value?.cycle?.status === 'REVIEW' && data.value?.can?.selfScore && scorable.value.length)

async function load() {
  loading.value = true
  try {
    const d = await fde.okr.cycle({ week: route.query.week, ownerId: ownerId.value })
    for (const o of d.objectives || []) {
      o.updatedKey = (o.updates?.length || 0) + ':' + (o.selfScore ?? '') + ':' + (o.managerScore ?? '')
    }
    data.value = d
    // 本人、可编辑、还没提交过 → 直接进入写计划
    editing.value = !!d.cycle && !!d.can?.edit && !(d.objectives || []).some(o => o.submittedAt) && !viewingOther.value
    if (editing.value) draftInit.value = toDraft(d.objectives)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

watch(() => [route.query.week, route.query.ownerId], load, { immediate: true })

function shift(delta) {
  router.replace({ query: { ...route.query, week: shiftKey(weekKeyNow.value, delta) } })
}

function startEdit() {
  draftInit.value = toDraft(data.value.objectives)
  editing.value = true
}

async function savePlan(objectives, submit) {
  busy.value = submit ? 'submit' : 'save'
  try {
    const week = weekKeyNow.value
    const d = submit ? await fde.okr.submitPlan(week, objectives) : await fde.okr.savePlan(week, objectives)
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
    await fde.okr.addUpdate(objectiveId, payload)
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
      const r = await fde.okr.selfScore({ objectiveId: o.id, score: self.score, comment: self.comment.trim() })
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
    const r = await fde.okr.miss(miss.obj.id, { reason: miss.reason, carryToNextWeek: miss.carry })
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
.okr-owner { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 13px; }
.okr-owner a { color: var(--el-color-primary); text-decoration: none; }
.okr-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin-bottom: 10px; font-size: 13px; color: var(--el-text-color-secondary); }
.okr-summary b { color: var(--el-text-color-primary); font-size: 15px; }
.okr-edit-link { margin-left: auto; border: 0; background: none; color: var(--el-color-primary); font-size: 13px; cursor: pointer; padding: 4px 0; }
.okr-list { display: flex; flex-direction: column; gap: 10px; }
.okr-empty { color: var(--el-text-color-secondary); font-size: 13px; text-align: center; padding: 24px 0; }
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
