<template>
  <!-- 一个 O: 标题/权重/状态/分数 + KR 进度。
       OKR 3.0: 每条 KR 右侧一组「完成 / 未完成」(明确操作, 不藏在记进展里); 归档后置灰。
       记进展 / 时间线 / 未达成 / 主管评分仍收在展开面板里 -->
  <section class="okr-card" :class="'st-' + obj.status">
    <header class="okr-card-head">
      <!-- OKR 6.0: 风险等级 红 / 黄 / 绿 圆点 -->
      <span
        v-if="obj.riskLevel" class="okr-risk" :class="'r-' + obj.riskLevel" role="img"
        :aria-label="$t('okr.blk.risk.' + obj.riskLevel)" :title="$t('okr.blk.risk.' + obj.riskLevel)" :data-test="'okr-risk-' + obj.riskLevel"
      />
      <span class="okr-seq">O{{ obj.seq }}</span>
      <h3 class="okr-title">{{ obj.title }}</h3>
      <span class="okr-weight">{{ round(obj.weight) }}%</span>
      <!-- OKR 10.0: 连续未达成 ≥2 周 —— CRITICAL 红点 / WARN 黄点 + 悬浮提示 -->
      <el-tooltip v-if="streak" :content="$t('okr.fe5.risk_dot', { p0: streak.n })" placement="top">
        <span
          class="okr-streak" :class="'lv-' + streak.level" role="img" tabindex="0"
          :aria-label="$t('okr.fe5.risk_dot', { p0: streak.n })" :title="$t('okr.fe5.risk_dot', { p0: streak.n })" :data-test="'okr-streak-' + streak.level"
        />
      </el-tooltip>
    </header>
    <div class="okr-meta">
      <el-tag size="small" :type="OBJ_TAG[obj.status]" effect="light">{{ $t('okr.obj_status.' + obj.status) }}</el-tag>
      <span class="okr-pct">{{ pct(obj.progress) }}%</span>
      <span v-if="obj.selfScore != null" class="okr-score">{{ $t('okr.self_short') }} {{ obj.selfScore }}</span>
      <span v-if="obj.managerScore != null" class="okr-score mgr">{{ $t('okr.manager_short') }} {{ obj.managerScore }}</span>
      <span v-if="obj.lateSubmit" class="okr-late">{{ $t('okr.late') }}</span>
      <!-- 按项目视图的 O 不带 KR 明细, 只给 KR 完成数 -->
      <span v-if="!obj.keyResults && obj.krTotal != null" class="okr-krsum" data-test="okr-kr-sum">{{ $t('okr.byproj.kr_sum', { p0: obj.krDone, p1: obj.krTotal }) }}</span>
    </div>
    <!-- OKR 5.0: O 挂的项目 -->
    <div v-if="obj.projects?.length" class="okr-projs" data-test="okr-card-projects">
      <span v-for="p in obj.projects" :key="p.id" class="okr-proj" :title="p.code || undefined">{{ p.name }}</span>
    </div>
    <p v-if="obj.description" class="okr-desc">{{ obj.description }}</p>

    <ul v-if="obj.keyResults?.length" class="okr-krs">
      <li v-for="kr in obj.keyResults" :key="kr.id" class="okr-kr" :class="{ picked: open && form.krId === kr.id, 'has-acts': showActs }" :data-test="'okr-kr-' + kr.id">
        <span class="okr-kr-title">{{ kr.title }}</span>
        <span class="okr-kr-val" :class="{ done: kr.status === 'DONE', missed: kr.status === 'MISSED' }" data-test="okr-kr-val">{{ krValueText(kr, $t) }}</span>
        <span class="okr-bar"><i :style="{ width: pct(kr.progress) + '%' }" /></span>
        <!-- OKR 6.0 阶段型: 阶段列表(完成打勾 / 未完成灰 / 逾期红日期); 能动手时点一下就推进或取消 -->
        <ol v-if="kr.metricType === 'MILESTONE' && kr.milestones?.length" class="okr-ms" :data-test="'okr-ms-' + kr.id">
          <li v-for="m in milestoneRows(kr, today)" :key="m.index">
            <button
              type="button" class="okr-ms-item" :class="{ done: m.done, overdue: m.overdue }" :disabled="!msClickable"
              :aria-pressed="m.done" :data-test="`okr-ms-${kr.id}-${m.index}`" @click="clickMilestone(kr, m.index)"
            >
              <span class="okr-ms-box" aria-hidden="true">{{ m.done ? '✓' : '' }}</span>
              <span class="okr-ms-name">{{ m.name }}</span>
              <span v-if="m.dueDate" class="okr-ms-due" :data-test="m.overdue ? 'okr-ms-overdue' : undefined">{{ m.overdue ? $t('okr.ms.overdue', { p0: m.dueDate.slice(5) }) : m.dueDate.slice(5) }}</span>
            </button>
          </li>
        </ol>
        <p v-if="kr.blockers" class="okr-kr-blk" :data-test="'okr-kr-blk-' + kr.id">{{ $t('okr.blk.kr_line', { p0: kr.blockers }) }}</p>
        <el-tooltip v-if="showActs" :disabled="!closed" :content="$t('okr.v3.closed_tip')" placement="top">
          <span class="okr-kr-acts" role="group" :aria-label="$t('okr.v3.kr_actions')" :title="closed ? $t('okr.v3.closed_tip') : undefined">
            <button
              type="button" class="okr-kr-btn ok" :class="{ on: kr.status === 'DONE' }" :aria-pressed="kr.status === 'DONE'"
              :disabled="actsDisabled" data-test="okr-kr-done" @click="complete(kr, true)"
            >{{ $t('okr.v3.kr_done') }}</button>
            <button
              type="button" class="okr-kr-btn no" :class="{ on: kr.status === 'MISSED' }" :aria-pressed="kr.status === 'MISSED'"
              :disabled="actsDisabled" data-test="okr-kr-missed" @click="complete(kr, false)"
            >{{ $t('okr.v3.kr_missed') }}</button>
          </span>
        </el-tooltip>
      </li>
    </ul>

    <!-- OKR 6.0 卡点: 对全员可见; 逾期时顶部红条; 本人 / 代管可改(说明 / 卡在谁 / 截止日 三项要么都空要么都填) -->
    <div v-if="obj.blocker || canEditBlocker" class="okr-blk" :class="{ has: !!obj.blocker }" data-test="okr-blocker">
      <p v-if="obj.blocker?.overdue" class="okr-blk-overdue" role="alert" data-test="okr-blocker-overdue">{{ $t('okr.blk.overdue', { p0: overdueDays(obj.blocker.dueDate, today) || 1 }) }}</p>
      <button type="button" class="okr-blk-head" :aria-expanded="blkOpen" data-test="okr-blocker-toggle" @click="blkOpen = !blkOpen">
        <span class="okr-blk-label">{{ $t('okr.blk.title') }}</span>
        <span v-if="obj.blocker" class="okr-blk-sum">{{ obj.blocker.text }}</span>
        <span v-else class="okr-blk-none">{{ $t('okr.blk.none') }}</span>
        <span aria-hidden="true">{{ blkOpen ? '▾' : '▸' }}</span>
      </button>
      <div v-if="blkOpen" class="okr-blk-body">
        <template v-if="!blkEditing">
          <dl v-if="obj.blocker" class="okr-blk-dl">
            <dt>{{ $t('okr.blk.text') }}</dt><dd class="okr-blk-text">{{ obj.blocker.text }}</dd>
            <dt>{{ $t('okr.blk.owner') }}</dt>
            <dd>
              <!-- 手机窄屏: 人名折叠, 点开才看 -->
              <details v-if="compact" class="okr-blk-who" data-test="okr-blocker-owner-fold">
                <summary>{{ $t('okr.blk.show_owner') }}</summary>{{ obj.blocker.ownerName || '-' }}
              </details>
              <span v-else data-test="okr-blocker-owner">{{ obj.blocker.ownerName || '-' }}</span>
            </dd>
            <dt>{{ $t('okr.blk.due') }}</dt><dd :class="{ bad: obj.blocker.overdue }">{{ obj.blocker.dueDate || '-' }}</dd>
          </dl>
          <button v-if="canEditBlocker" type="button" class="okr-link" data-test="okr-blocker-edit" @click="startBlk">{{ obj.blocker ? $t('okr.blk.edit') : $t('okr.blk.add') }}</button>
        </template>
        <form v-else class="okr-blk-form" @submit.prevent="saveBlk">
          <el-input v-model="blk.blockers" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="2000" :placeholder="$t('okr.blk.text_ph')" data-test="okr-blocker-text" />
          <div class="okr-blk-row">
            <el-select v-model="blk.blockerOwnerId" filterable clearable :placeholder="$t('okr.blk.owner_ph')" class="okr-blk-owner" data-test="okr-blocker-owner-pick">
              <el-option v-for="p in people" :key="p.id" :value="String(p.id)" :label="p.name || p.username" />
            </el-select>
            <el-date-picker v-model="blk.blockerDueDate" type="date" value-format="YYYY-MM-DD" :placeholder="$t('okr.blk.due_ph')" class="okr-blk-date" data-test="okr-blocker-due" />
          </div>
          <div class="okr-blk-risk" role="radiogroup" :aria-label="$t('okr.blk.risk_label')">
            <span>{{ $t('okr.blk.risk_label') }}</span>
            <button
              v-for="r in RISK_LEVELS" :key="r" type="button" role="radio" class="okr-risk-btn" :class="['r-' + r, { on: blk.riskLevel === r }]"
              :aria-checked="blk.riskLevel === r" :data-test="'okr-risk-pick-' + r" @click="blk.riskLevel = r"
            ><i class="okr-risk" :class="'r-' + r" />{{ $t('okr.blk.risk.' + r) }}</button>
          </div>
          <p v-if="blkState === 'partial'" class="okr-blk-warn" role="alert" data-test="okr-blocker-partial">{{ $t('okr.blk.incomplete') }}</p>
          <div class="okr-blk-acts">
            <el-button @click="blkEditing = false">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" native-type="submit" :disabled="blkState === 'partial'" :loading="blkBusy" data-test="okr-blocker-save">{{ $t('okr.blk.save') }}</el-button>
          </div>
        </form>
      </div>
    </div>

    <button v-if="hasPanel" type="button" class="okr-toggle" :aria-expanded="open" @click="toggle">
      {{ toggleText }} <span aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
    </button>

    <div v-if="open" class="okr-panel">
      <!-- 记进展: 挑一条 KR(或不挂), 写一句, 可选改数值 -->
      <form v-if="canEdit" class="okr-add" @submit.prevent="send">
        <el-select v-model="form.krId" size="small" class="okr-kr-pick" :placeholder="$t('okr.pick_kr')">
          <el-option v-for="kr in obj.keyResults" :key="kr.id" :value="kr.id" :label="`KR${kr.seq} ${kr.title}`" />
          <el-option value="" :label="$t('okr.no_kr')" />
        </el-select>
        <div class="okr-add-row">
          <el-input v-model="form.content" size="small" :placeholder="$t('okr.progress_placeholder')" maxlength="500" />
          <el-input-number v-if="pickedKr && pickedKr.metricType !== 'BINARY'" v-model="form.value" size="small" :controls="false" :placeholder="$t('okr.value')" class="okr-num" />
          <el-checkbox v-else-if="pickedKr" v-model="form.done" size="small">{{ $t('okr.done') }}</el-checkbox>
          <el-button size="small" type="primary" native-type="submit" :loading="busy">{{ $t('okr.send') }}</el-button>
        </div>
      </form>

      <ol v-if="obj.updates?.length || obj.misses?.length" class="okr-timeline">
        <li v-for="u in obj.updates" :key="u.id">
          <span class="okr-tl-date">{{ shDate(u.createdAt) }}</span>
          <span class="okr-tl-body">
            {{ u.content }}
            <em v-if="u.valueBefore !== u.valueAfter && u.valueAfter != null" class="okr-tl-val">{{ u.valueBefore }} → {{ u.valueAfter }}</em>
            <span v-if="u.source === 'ASSISTANT'" class="okr-ai" :title="u.sourceQuote ? $t('okr.assistant_quote', { p0: u.sourceQuote }) : $t('okr.assistant_wrote')">{{ $t('okr.assistant') }}</span>
            <q v-if="u.source === 'ASSISTANT' && u.sourceQuote" class="okr-quote">{{ u.sourceQuote }}</q>
          </span>
        </li>
        <li v-for="m in obj.misses || []" :key="'m' + m.id" class="miss">
          <span class="okr-tl-date">{{ shDate(m.createdAt) }}</span>
          <span class="okr-tl-body">{{ $t('okr.missed_reason', { p0: m.reason }) }}</span>
        </li>
      </ol>
      <p v-else-if="!canEdit" class="okr-none">{{ $t('okr.no_updates') }}</p>

      <!-- 主管/老板: 给这个 O 打分 -->
      <form v-if="canManagerScore" class="okr-add-row okr-mscore" @submit.prevent="$emit('manager-score', { objectiveId: obj.id, score: mScore, comment: mComment })">
        <el-input-number v-model="mScore" :min="0" :max="100" size="small" :controls="false" :placeholder="$t('okr.manager_score')" class="okr-num" />
        <el-input v-model="mComment" size="small" maxlength="200" :placeholder="$t('okr.one_line_comment')" />
        <el-button size="small" type="primary" native-type="submit" :disabled="mScore == null">{{ $t('okr.score') }}</el-button>
      </form>

      <button v-if="canMiss" type="button" class="okr-link warn" @click="$emit('miss', obj)">{{ $t('okr.mark_missed') }}</button>
    </div>
    <!-- OKR 9.0: 挂在这个 O 上的决策(O 视图带最近 3 条), 折叠区: 标题 + 日期 + 决策人 -->
    <div v-if="decisions.length" class="okr-decs" data-test="okr-card-decisions">
      <button type="button" class="okr-decs-head" :aria-expanded="decOpen" data-test="okr-decs-toggle" @click="decOpen = !decOpen">
        {{ $t('okr.fe5.dec_card_n', { p0: decisions.length }) }} <span aria-hidden="true">{{ decOpen ? '▾' : '▸' }}</span>
      </button>
      <ul v-if="decOpen" class="okr-decs-list">
        <li v-for="d in decisions" :key="d.id" :class="{ off: d.status !== 'ACTIVE' }">
          <router-link :to="{ path: '/admin/okr/decisions', query: { focus: d.id, from: d.date } }" class="okr-decs-title">{{ d.title }}</router-link>
          <span class="okr-decs-meta">{{ d.date }} · {{ d.decidedByName || '-' }}</span>
        </li>
      </ul>
    </div>
    <p v-if="obj.managerComment" class="okr-mcomment">{{ $t('okr.manager_said', { p0: obj.managerComment }) }}</p>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { $t } from '@/i18n'
import { OBJ_TAG, pct, krValueText, shDate } from '@/views/okr/okrUtils.js'
import { todayKey } from '@/views/okr/okrFe3.js'
import { RISK_LEVELS, milestoneRows, overdueDays, blockerForm, blockerFormState } from '@/views/okr/okrFe4.js'
import { decisionBriefs } from '@/views/okr/okrFe5.js'

const props = defineProps({
  obj: { type: Object, required: true },
  canEdit: Boolean,
  canMiss: Boolean,
  canManagerScore: Boolean,
  /** OKR 3.0: KR 完成开关可点(本人或代管、已提交、未归档) */
  canComplete: Boolean,
  /** 本周已归档: 开关照样显示, 但置灰并给 tooltip */
  closed: Boolean,
  /** 正在提交完成开关的 KR id(该卡整组按钮暂时不可点) */
  krBusy: { type: String, default: '' },
  busy: Boolean,
  /** OKR 6.0: 能改卡点 / 风险(本人或代管、计划可改) */
  canEditBlocker: Boolean,
  /** 卡点人候选(选人) */
  people: { type: Array, default: () => [] },
  /** 手机窄屏: 卡点人名折叠 */
  compact: Boolean,
  /** OKR 10.0 连续未达成: { n, level } | null(okrFe5.streakOf) */
  streak: { type: Object, default: null }
})
const emit = defineEmits(['add-update', 'miss', 'manager-score', 'complete', 'milestone', 'save-blocker'])

const today = todayKey()
const decisions = computed(() => decisionBriefs(props.obj))
const decOpen = ref(false)
/** 阶段可点: 和完成开关同一套条件 */
const msClickable = computed(() => props.canComplete && !props.closed && !props.krBusy && !!props.obj.submittedAt && props.obj.status !== 'DROPPED')
function clickMilestone(kr, index) {
  if (!msClickable.value) return
  emit('milestone', { kr, index, objectiveId: props.obj.id })
}

// 卡点编辑
const blkOpen = ref(!!props.obj.blocker?.overdue)
const blkEditing = ref(false)
const blkBusy = ref(false)
const blk = reactive(blockerForm(props.obj))
const blkState = computed(() => blockerFormState(blk))
function startBlk() {
  Object.assign(blk, blockerForm(props.obj))
  blkEditing.value = true
}
function saveBlk() {
  if (blkState.value === 'partial') return
  blkBusy.value = true
  emit('save-blocker', {
    objectiveId: props.obj.id, form: { ...blk },
    done: (ok) => { blkBusy.value = false; if (ok) blkEditing.value = false }
  })
}

const open = ref(false)
const form = reactive({ krId: '', content: '', value: null, done: false })
const mScore = ref(props.obj.managerScore ?? null)
const mComment = ref('')

const round = (n) => Math.round(n * 100) / 100
const showActs = computed(() => (props.canComplete || props.closed) && !!props.obj.submittedAt && props.obj.status !== 'DROPPED')
const actsDisabled = computed(() => props.closed || !props.canComplete || !!props.krBusy)

/** 点「完成 / 未完成」: 已是这个状态就不重复提交 */
function complete(kr, done) {
  if (actsDisabled.value) return
  if (kr.status === (done ? 'DONE' : 'MISSED')) return
  emit('complete', { kr, done, objectiveId: props.obj.id })
}
const nUpdates = computed(() => props.obj.updates?.length || 0)
const hasPanel = computed(() => props.canEdit || props.canMiss || props.canManagerScore || nUpdates.value > 0)
const pickedKr = computed(() => (props.obj.keyResults || []).find(k => k.id === form.krId) || null)
const toggleText = computed(() => {
  if (props.canManagerScore) return $t('okr.toggle_review', { p0: nUpdates.value })
  if (props.canEdit) return $t('okr.toggle_log', { p0: nUpdates.value })
  return $t('okr.updates_n', { p0: nUpdates.value })
})

function toggle() {
  open.value = !open.value
  if (open.value && props.canEdit) {
    // 默认挑第一条还没完成的 KR
    const krs = props.obj.keyResults || []
    const kr = krs.find(k => k.status !== 'DONE') || krs[0]
    pick(kr)
  }
}

function pick(kr) {
  form.krId = kr?.id || ''
  form.content = ''
  form.value = kr && kr.metricType !== 'BINARY' ? kr.currentValue : null
  form.done = kr?.status === 'DONE'
}

function send() {
  const kr = pickedKr.value
  const payload = { content: form.content.trim() }
  if (kr) {
    payload.krId = kr.id
    if (kr.metricType === 'BINARY') {
      if (form.done !== (kr.status === 'DONE')) payload.valueAfter = form.done ? 1 : 0
    } else if (form.value != null && form.value !== kr.currentValue) {
      payload.valueAfter = form.value
    }
  }
  emit('add-update', { objectiveId: props.obj.id, payload, done: () => pick(kr) })
}
</script>

<style scoped>
.okr-streak { flex: none; align-self: center; width: 10px; height: 10px; border-radius: 50%; margin-left: 2px; cursor: help; }
.okr-streak.lv-CRITICAL { background: var(--el-color-danger); box-shadow: 0 0 0 3px var(--el-color-danger-light-8); }
.okr-streak.lv-WARN { background: #d9a400; box-shadow: 0 0 0 3px #f6e7a6; }
.okr-decs { margin-top: 8px; border-top: 1px dashed var(--el-border-color-lighter); padding-top: 6px; }
.okr-decs-head { border: 0; background: none; padding: 4px 0; font: inherit; font-size: 12px; color: var(--el-text-color-secondary); cursor: pointer; }
.okr-decs-list { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.okr-decs-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.okr-decs-title { color: var(--el-color-primary); text-decoration: none; font-weight: 600; overflow-wrap: anywhere; }
.okr-decs-list li.off .okr-decs-title { color: var(--el-text-color-placeholder); text-decoration: line-through; }
.okr-decs-meta { color: var(--el-text-color-secondary); }
@media (max-width: 640px) { .okr-decs-head { min-height: 44px; } }
.okr-card { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 12px 14px; }
.okr-card.st-DROPPED { opacity: .55; }
.okr-card-head { display: flex; align-items: baseline; gap: 8px; }
.okr-seq { font-size: 12px; font-weight: 600; color: var(--el-color-primary); flex: none; }
.okr-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.okr-weight { font-size: 12px; color: var(--el-text-color-secondary); flex: none; }
.okr-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-pct { font-weight: 600; color: var(--el-text-color-primary); }
.okr-score.mgr { color: var(--el-color-success); }
.okr-late { color: var(--el-color-danger); }
.okr-krsum { color: var(--el-text-color-secondary); }
.okr-projs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.okr-proj { font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 9px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-desc { margin: 6px 0 0; font-size: 13px; color: var(--el-text-color-regular); white-space: pre-wrap; overflow-wrap: anywhere; }
.okr-krs { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.okr-kr { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto 4px; column-gap: 8px; row-gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--el-fill-color-light); }
.okr-kr.picked { outline: 1px solid var(--el-color-primary-light-5); }
.okr-kr-title { font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; min-width: 0; }
.okr-kr-val { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; align-self: center; }
.okr-kr-val.done { color: var(--el-color-success); }
.okr-kr-val.missed { color: var(--el-color-danger); }
.okr-bar { grid-column: 1 / 3; height: 4px; border-radius: 2px; background: var(--el-border-color-lighter); overflow: hidden; }
.okr-kr.has-acts { grid-template-rows: auto 4px auto; }
/* 完成 / 未完成: 手机上占一整行, 两个按钮各占一半(≥44px 高, 不换行); 桌面放在 KR 行右侧 */
.okr-kr-acts { grid-column: 1 / -1; display: flex; gap: 6px; margin-top: 4px; }
.okr-kr-btn { flex: 1 1 0; min-width: 0; min-height: 44px; padding: 0 12px; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-bg-color);
  font: inherit; font-size: 13px; color: var(--el-text-color-regular); white-space: nowrap; cursor: pointer; }
.okr-kr-btn:hover:not(:disabled) { border-color: var(--el-color-primary-light-5); }
.okr-kr-btn.ok.on { background: var(--el-color-success); border-color: var(--el-color-success); color: #fff; font-weight: 600; }
.okr-kr-btn.no.on { background: var(--el-color-danger); border-color: var(--el-color-danger); color: #fff; font-weight: 600; }
.okr-kr-btn:disabled { cursor: not-allowed; opacity: .55; }
.okr-kr-acts:has(:disabled) { cursor: not-allowed; }
@media (min-width: 641px) {
  .okr-kr.has-acts { grid-template-columns: 1fr auto auto; grid-template-rows: auto 4px; }
  .okr-kr.has-acts .okr-kr-acts { grid-column: 3; grid-row: 1 / 3; margin: 0 0 0 4px; align-self: center; }
  .okr-kr-btn { flex: none; min-height: 32px; min-width: 64px; font-size: 12px; }
}
.okr-bar i { display: block; height: 100%; background: var(--el-color-primary); border-radius: 2px; }
.okr-toggle { margin-top: 8px; width: 100%; min-height: 36px; border: 1px dashed var(--el-border-color); border-radius: 8px; background: none; font: inherit; font-size: 13px; color: var(--el-color-primary); cursor: pointer; }
.okr-panel { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.okr-add { display: flex; flex-direction: column; gap: 6px; }
.okr-kr-pick { width: 100%; }
.okr-add-row { display: flex; gap: 6px; align-items: center; }
.okr-add-row .el-input { flex: 1; min-width: 0; }
.okr-num { width: 72px; flex: none; }
.okr-link { align-self: flex-start; border: 0; background: none; padding: 4px 0; font-size: 12px; cursor: pointer; }
.okr-link.warn { color: var(--el-color-danger); }
.okr-timeline { list-style: none; margin: 0; padding: 0 0 0 2px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.okr-timeline li { display: flex; gap: 8px; }
.okr-timeline li.miss { color: var(--el-color-danger); }
.okr-tl-date { color: var(--el-text-color-secondary); flex: none; }
.okr-tl-body { overflow-wrap: anywhere; min-width: 0; }
.okr-tl-val { font-style: normal; color: var(--el-color-primary); margin-left: 4px; }
.okr-ai { display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 4px; font-size: 11px; line-height: 16px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.okr-quote { display: block; margin-top: 2px; color: var(--el-text-color-secondary); font-size: 11px; }
.okr-none { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-risk { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; align-self: center; background: var(--el-color-success); }
.okr-risk.r-MEDIUM { background: var(--el-color-warning); }
.okr-risk.r-HIGH { background: var(--el-color-danger); }
/* 阶段型 */
.okr-ms { grid-column: 1 / -1; list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.okr-ms-item { width: 100%; display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 2px 4px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 13px; text-align: left; color: var(--el-text-color-secondary); cursor: pointer; }
.okr-ms-item:hover:not(:disabled) { background: var(--el-fill-color); }
.okr-ms-item:disabled { cursor: default; }
.okr-ms-box { width: 16px; height: 16px; flex: none; border: 1px solid var(--el-border-color); border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; line-height: 1; background: var(--el-bg-color); }
.okr-ms-item.done { color: var(--el-text-color-primary); }
.okr-ms-item.done .okr-ms-box { background: var(--el-color-success); border-color: var(--el-color-success); color: #fff; }
.okr-ms-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.okr-ms-due { flex: none; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-ms-item.overdue .okr-ms-due { color: var(--el-color-danger); font-weight: 600; }
.okr-kr-blk { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--el-color-warning-dark-2); overflow-wrap: anywhere; }
@media (max-width: 640px) { .okr-ms-item, .okr-toggle, .okr-link { min-height: 44px; } }
/* 卡点 */
.okr-blk { margin-top: 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; overflow: hidden; }
.okr-blk.has { border-color: var(--el-color-warning-light-5); }
.okr-blk-overdue { margin: 0; padding: 6px 10px; background: var(--el-color-danger); color: #fff; font-size: 12px; font-weight: 600; }
.okr-blk-head { width: 100%; display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 10px; border: 0; background: var(--el-fill-color-lighter); font: inherit; font-size: 13px; text-align: left; cursor: pointer; color: var(--el-text-color-regular); }
.okr-blk.has .okr-blk-head { background: var(--el-color-warning-light-9); }
.okr-blk-label { font-weight: 600; flex: none; }
.okr-blk-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-blk-none { flex: 1; color: var(--el-text-color-placeholder); font-size: 12px; }
.okr-blk-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.okr-blk-dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 13px; }
.okr-blk-dl dt { color: var(--el-text-color-secondary); }
.okr-blk-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.okr-blk-dl dd.bad { color: var(--el-color-danger); font-weight: 600; }
.okr-blk-text { white-space: pre-wrap; }
.okr-blk-who summary { cursor: pointer; color: var(--el-color-primary); min-height: 32px; }
.okr-blk-form { display: flex; flex-direction: column; gap: 8px; }
.okr-blk-row { display: flex; gap: 6px; flex-wrap: wrap; }
.okr-blk-owner { flex: 1 1 160px; min-width: 0; }
.okr-blk-date { flex: 1 1 140px; width: auto !important; }
.okr-blk-risk { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-risk-btn { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 10px; border: 1px solid var(--el-border-color); border-radius: 16px; background: var(--el-bg-color); font: inherit; font-size: 12px; cursor: pointer; color: var(--el-text-color-regular); }
.okr-risk-btn.on { border-color: var(--el-color-primary); color: var(--el-color-primary); font-weight: 600; }
.okr-blk-warn { margin: 0; font-size: 12px; color: var(--el-color-danger); }
.okr-blk-acts { display: flex; justify-content: flex-end; gap: 8px; }
.okr-blk-acts .el-button { margin-left: 0; }
@media (max-width: 640px) {
  .okr-blk-head { min-height: 44px; }
  .okr-risk-btn { min-height: 44px; }
  .okr-blk-acts .el-button { min-height: 44px; flex: 1 1 0; }
}
.okr-mcomment { margin: 6px 0 0; font-size: 12px; color: var(--el-color-success); }
</style>
