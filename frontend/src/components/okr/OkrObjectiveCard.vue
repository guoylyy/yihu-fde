<template>
  <!-- 一个 O: 标题/权重/状态/分数 + KR 进度(只读展示)。
       同屏可点元素要少: 每张卡只有一个「进展」开关, 记进展 / 时间线 / 未达成 / 主管评分都收在展开面板里 -->
  <section class="okr-card" :class="'st-' + obj.status">
    <header class="okr-card-head">
      <span class="okr-seq">O{{ obj.seq }}</span>
      <h3 class="okr-title">{{ obj.title }}</h3>
      <span class="okr-weight">{{ round(obj.weight) }}%</span>
    </header>
    <div class="okr-meta">
      <el-tag size="small" :type="OBJ_TAG[obj.status]" effect="light">{{ $t('okr.obj_status.' + obj.status) }}</el-tag>
      <span class="okr-pct">{{ pct(obj.progress) }}%</span>
      <span v-if="obj.selfScore != null" class="okr-score">{{ $t('okr.self_short') }} {{ obj.selfScore }}</span>
      <span v-if="obj.managerScore != null" class="okr-score mgr">{{ $t('okr.manager_short') }} {{ obj.managerScore }}</span>
      <span v-if="obj.lateSubmit" class="okr-late">{{ $t('okr.late') }}</span>
    </div>
    <p v-if="obj.description" class="okr-desc">{{ obj.description }}</p>

    <ul class="okr-krs">
      <li v-for="kr in obj.keyResults" :key="kr.id" class="okr-kr" :class="{ picked: open && form.krId === kr.id }">
        <span class="okr-kr-title">{{ kr.title }}</span>
        <span class="okr-kr-val" :class="{ done: kr.status === 'DONE', missed: kr.status === 'MISSED' }">{{ krValueText(kr, $t) }}</span>
        <span class="okr-bar"><i :style="{ width: pct(kr.progress) + '%' }" /></span>
      </li>
    </ul>

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
    <p v-if="obj.managerComment" class="okr-mcomment">{{ $t('okr.manager_said', { p0: obj.managerComment }) }}</p>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { $t } from '@/i18n'
import { OBJ_TAG, pct, krValueText, shDate } from '@/views/okr/okrUtils.js'

const props = defineProps({
  obj: { type: Object, required: true },
  canEdit: Boolean,
  canMiss: Boolean,
  canManagerScore: Boolean,
  busy: Boolean
})
const emit = defineEmits(['add-update', 'miss', 'manager-score'])

const open = ref(false)
const form = reactive({ krId: '', content: '', value: null, done: false })
const mScore = ref(props.obj.managerScore ?? null)
const mComment = ref('')

const round = (n) => Math.round(n * 100) / 100
const nUpdates = computed(() => props.obj.updates?.length || 0)
const hasPanel = computed(() => props.canEdit || props.canMiss || props.canManagerScore || nUpdates.value > 0)
const pickedKr = computed(() => props.obj.keyResults.find(k => k.id === form.krId) || null)
const toggleText = computed(() => {
  if (props.canManagerScore) return $t('okr.toggle_review', { p0: nUpdates.value })
  if (props.canEdit) return $t('okr.toggle_log', { p0: nUpdates.value })
  return $t('okr.updates_n', { p0: nUpdates.value })
})

function toggle() {
  open.value = !open.value
  if (open.value && props.canEdit) {
    // 默认挑第一条还没完成的 KR
    const kr = props.obj.keyResults.find(k => k.status !== 'DONE') || props.obj.keyResults[0]
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
.okr-desc { margin: 6px 0 0; font-size: 13px; color: var(--el-text-color-regular); white-space: pre-wrap; overflow-wrap: anywhere; }
.okr-krs { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.okr-kr { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto 4px; column-gap: 8px; row-gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--el-fill-color-light); }
.okr-kr.picked { outline: 1px solid var(--el-color-primary-light-5); }
.okr-kr-title { font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; min-width: 0; }
.okr-kr-val { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; align-self: center; }
.okr-kr-val.done { color: var(--el-color-success); }
.okr-kr-val.missed { color: var(--el-color-danger); }
.okr-bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--el-border-color-lighter); overflow: hidden; }
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
.okr-mcomment { margin: 6px 0 0; font-size: 12px; color: var(--el-color-success); }
</style>
