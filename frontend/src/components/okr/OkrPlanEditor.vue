<template>
  <!-- 周一写计划: 1–3 个 O, 每个 O 至少 1 个 KR; 权重默认均分, 打开「调整权重」才可手改 -->
  <div class="okr-editor">
    <section v-for="(o, i) in draft" :key="o._k" class="okr-ed-card">
      <div class="okr-ed-row">
        <span class="okr-seq">O{{ i + 1 }}</span>
        <el-input v-model="o.title" :placeholder="$t('okr.objective_placeholder')" maxlength="200" />
        <el-input-number v-if="manualWeights" v-model="o.weight" :min="0" :max="100" :controls="false" size="default" class="okr-w" />
        <el-button text :aria-label="$t('okr.delete_objective')" @click="removeObjective(i)">✕</el-button>
      </div>
      <el-input v-model="o.description" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="2000" :placeholder="$t('okr.description_placeholder')" class="okr-ed-desc" />
      <!-- OKR 5.0: 所属项目(多选, 可不选) -->
      <el-select
        v-model="o.projectIds" multiple filterable collapse-tags collapse-tags-tooltip :max-collapse-tags="3"
        :placeholder="$t('okr.byproj.pick_projects')" class="okr-ed-projs" :data-test="'okr-ed-projects-' + i"
      >
        <el-option v-for="p in projOptions" :key="p.id" :value="p.id" :label="projectLabel(p)" />
      </el-select>
      <div v-for="(k, j) in o.keyResults" :key="k._k" class="okr-ed-kr">
        <span class="okr-kr-no">KR{{ j + 1 }}</span>
        <div class="okr-ed-kr-main">
          <el-input v-model="k.title" size="small" :placeholder="$t('okr.kr_placeholder')" maxlength="200" />
          <div class="okr-ed-kr-opts">
            <el-select v-model="k.metricType" size="small" class="okr-type" :data-test="`okr-ed-type-${i}-${j}`" @change="onTypeChange(k)">
              <el-option value="BINARY" :label="$t('okr.metric.BINARY')" />
              <el-option value="PERCENT" :label="$t('okr.metric.PERCENT')" />
              <el-option value="NUMBER" :label="$t('okr.metric.NUMBER')" />
              <el-option value="MILESTONE" :label="$t('okr.metric.MILESTONE')" />
            </el-select>
            <el-input-number v-if="k.metricType === 'PERCENT' || k.metricType === 'NUMBER'" v-model="k.targetValue" size="small" :min="0" :controls="false" :placeholder="$t('okr.target')" class="okr-w" />
            <el-input v-if="k.metricType === 'NUMBER'" v-model="k.unit" size="small" maxlength="10" :placeholder="$t('okr.unit')" class="okr-unit" />
            <el-input-number v-if="manualWeights" v-model="k.weight" size="small" :min="0" :max="100" :controls="false" class="okr-w" />
            <button v-if="!k._blk && !k.blockers" type="button" class="okr-ed-link" :data-test="`okr-ed-kr-blk-open-${i}-${j}`" @click="k._blk = true">+ {{ $t('okr.blk.kr_add') }}</button>
          </div>
          <!-- OKR 6.0 阶段型: 阶段名 + 计划日期 + 勾选(按顺序推进; 已保存的 KR 在卡片上勾, 这里不改完成数) -->
          <div v-if="k.metricType === 'MILESTONE'" class="okr-ms-ed" :data-test="`okr-ms-ed-${i}-${j}`">
            <div v-for="(m, mi) in k.milestones" :key="mi" class="okr-ms-ed-row">
              <el-checkbox
                :model-value="m.done" :disabled="!!k.id" :title="k.id ? $t('okr.ms.done_on_card') : undefined" :aria-label="$t('okr.ms.done_label', { p0: mi + 1 })"
                @update:model-value="v => setMilestoneDone(k.milestones, mi, v)"
              />
              <el-input v-model="m.name" size="small" maxlength="100" :placeholder="$t('okr.ms.name_ph', { p0: mi + 1 })" class="okr-ms-name" />
              <el-date-picker v-model="m.dueDate" type="date" size="small" value-format="YYYY-MM-DD" :placeholder="$t('okr.ms.due_ph')" class="okr-ms-date" />
              <el-button text size="small" :aria-label="$t('okr.ms.remove')" :disabled="k.milestones.length <= 1" @click="k.milestones.splice(mi, 1)">✕</el-button>
            </div>
            <button type="button" class="okr-ed-link" :disabled="k.milestones.length >= MAX_MILESTONES" :data-test="`okr-ms-add-${i}-${j}`" @click="k.milestones.push(blankMilestone())">+ {{ $t('okr.ms.add') }}</button>
          </div>
          <el-input
            v-if="k._blk || k.blockers" v-model="k.blockers" size="small" maxlength="2000" :placeholder="$t('okr.blk.kr_ph')"
            class="okr-ed-kr-blk" :data-test="`okr-ed-kr-blk-${i}-${j}`"
          />
        </div>
        <el-button text size="small" :aria-label="$t('okr.delete_kr')" @click="removeKr(o, j)">✕</el-button>
      </div>
      <div class="okr-ed-kr-add">
        <el-button text size="small" type="primary" :disabled="o.keyResults.length >= MAX_KRS" @click="addKr(o)">+ KR</el-button>
        <button type="button" class="okr-ed-bulk" :disabled="roomFor(o) <= 0" data-test="bulk-open" @click="openBulk(o)">{{ $t('okr.bulk.open') }}</button>
      </div>
    </section>

    <div class="okr-ed-tools">
      <el-button v-if="draft.length < 3" @click="addObjective">+ {{ $t('okr.objective') }}</el-button>
      <el-checkbox v-model="manualWeights">{{ $t('okr.manual_weights') }}</el-checkbox>
    </div>

    <ul v-if="problems.length" class="okr-problems">
      <li v-for="p in problems" :key="p">{{ p }}</li>
    </ul>

    <div class="okr-ed-actions">
      <el-button v-if="cancellable" @click="$emit('cancel')">{{ $t('common.cancel') }}</el-button>
      <el-button v-if="!submitted" :loading="busy === 'save'" @click="emitPlan('save')">{{ $t('okr.save_draft') }}</el-button>
      <el-button type="primary" :loading="busy === 'submit'" :disabled="problems.length > 0" @click="emitPlan('submit')">
        {{ submitLabel || (submitted ? $t('okr.save_and_submit') : $t('okr.submit_plan')) }}
      </el-button>
    </div>
    <p v-if="lateHint" class="okr-late-hint">{{ $t('okr.late_hint') }}</p>

    <OkrBulkKrDialog v-model="bulk.visible" :objective-title="bulk.obj?.title || ''" :room="bulk.obj ? roomFor(bulk.obj) : 0" @insert="insertBulk" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { rebalance, planProblems, insertKrs } from '@/views/okr/okrUtils.js'
import { MAX_MILESTONES, blankMilestone, setMilestoneDone, editorKrPayload, planSnapshot } from '@/views/okr/okrFe4.js'
import { projectOptions, projectLabel } from '@/views/okr/okrFe3.js'
import OkrBulkKrDialog from './OkrBulkKrDialog.vue'

const MAX_KRS = 10

const props = defineProps({
  initial: { type: Array, default: () => [] },
  submitted: Boolean,
  cancellable: Boolean,
  lateHint: Boolean,
  busy: { type: String, default: '' },
  // 代管时「代 <姓名> 提交」; 空 = 默认文案
  submitLabel: { type: String, default: '' }
})
const emit = defineEmits(['save', 'submit', 'cancel'])

let seq = 0
const key = () => ++seq
const blankKr = () => ({ _k: key(), title: '', metricType: 'BINARY', unit: '', targetValue: null, weight: 100, blockers: '', milestones: [], _blk: false })
const blankObj = () => ({ _k: key(), title: '', description: '', weight: 100, status: 'ON_TRACK', projectIds: [], keyResults: [blankKr()] })

const draft = ref([])
const manualWeights = ref(false)
let snapshot = '[]'

watch(() => props.initial, (v) => {
  draft.value = v.length
    ? v.map(o => ({
      ...o, projectIds: [...(o.projectIds || [])], _k: key(),
      keyResults: o.keyResults.map(k => ({ ...k, blockers: k.blockers || '', milestones: (k.milestones || []).map(m => ({ ...m })), _blk: false, _k: key() }))
    }))
    : [blankObj()]
  snapshot = planSnapshot(draft.value)
  // 已有计划的权重若不是均分, 说明手改过, 直接展开权重
  manualWeights.value = v.length > 0 && !isEven(v)
}, { immediate: true })

function isEven(objs) {
  const near = (arr) => arr.length < 2 || Math.max(...arr) - Math.min(...arr) <= 0.02
  return near(objs.map(o => o.weight)) && objs.every(o => near(o.keyResults.map(k => k.weight)))
}

const problems = computed(() => planProblems(draft.value, $t))

// 所属项目下拉: 我数据范围内的项目(GET /api/fde/projects) + 这份计划里已挂但不在范围内的
const projList = ref([])
const projOptions = computed(() => projectOptions(projList.value, props.initial))
onMounted(async () => {
  try { projList.value = (await fde.projects.list({ page: 1, page_size: 200 })).list || [] } catch { projList.value = [] }
})

function addObjective() {
  draft.value.push(blankObj())
  if (!manualWeights.value) rebalance(draft.value)
}
/** 换成阶段型时给一个空阶段; 换走时阶段明细留着(换回来还在), 提交时只有阶段型才带 */
function onTypeChange(k) {
  if (k.metricType === 'MILESTONE' && !k.milestones?.length) k.milestones = [blankMilestone()]
}

function addKr(o) {
  o.keyResults.push(blankKr())
  if (!manualWeights.value) rebalance(o.keyResults)
}

async function removeObjective(i) {
  const o = draft.value[i]
  if (o.id || o.title) {
    try {
      await ElMessageBox.confirm(
        $t('okr.confirm_delete_objective', { p0: o.title || `O${i + 1}`, p1: o.keyResults.length }),
        $t('okr.delete_objective'),
        { type: 'warning', confirmButtonText: $t('okr.delete'), cancelButtonText: $t('common.cancel') }
      )
    } catch { return }
  }
  draft.value.splice(i, 1)
  if (!draft.value.length) draft.value.push(blankObj())
  if (!manualWeights.value) rebalance(draft.value)
}

async function removeKr(o, j) {
  const k = o.keyResults[j]
  if (k.id || k.title) {
    try {
      await ElMessageBox.confirm(
        $t('okr.confirm_delete_kr', { p0: k.title || `KR${j + 1}` }),
        $t('okr.delete_kr'),
        { type: 'warning', confirmButtonText: $t('okr.delete'), cancelButtonText: $t('common.cancel') }
      )
    } catch { return }
  }
  o.keyResults.splice(j, 1)
  if (!manualWeights.value) rebalance(o.keyResults)
}

// ---------------------------------------------------------------- 批量粘贴 KR
const bulk = reactive({ visible: false, obj: null })

/** 这个 O 还能插几条: 只有一条空占位 KR 时它会被顶替, 不占名额 */
function roomFor(o) {
  const krs = o.keyResults
  const placeholder = krs.length === 1 && !String(krs[0].title || '').trim() && !krs[0].id
  return MAX_KRS - (placeholder ? 0 : krs.length)
}

function openBulk(o) {
  bulk.obj = o
  bulk.visible = true
}

function insertBulk(titles) {
  const o = bulk.obj
  if (!o) return
  const { added, dropped } = insertKrs(o, titles, { max: MAX_KRS, makeKr: (title) => ({ ...blankKr(), title }) })
  if (!manualWeights.value) rebalance(o.keyResults)
  if (dropped) ElMessage.warning($t('okr.bulk.dropped', { p0: added, p1: dropped }))
  else ElMessage.success($t('okr.bulk.inserted', { p0: added }))
}

/** 编辑器里有没有人写过的东西(贴周报填入前用来确认是否覆盖) */
function hasContent() {
  return draft.value.some(o => String(o.title || '').trim() || String(o.description || '').trim() || o.keyResults.some(k => String(k.title || '').trim()))
}
/** 当前编辑器里的计划(去掉内部 key), 「追加」草稿时用 */
function getPlan() {
  return draft.value.map(({ _k, projects: _p, ...o }) => ({
    ...o,
    projectIds: [...(o.projectIds || [])],
    keyResults: o.keyResults.map(editorKrPayload)
  }))
}
/** 有没有没保存的改动(复制 / 批量导入会重载编辑器, 先确认) */
function isDirty() {
  return planSnapshot(draft.value) !== snapshot
}
defineExpose({ hasContent, getPlan, isDirty })

function emitPlan(kind) {
  emit(kind, getPlan())
}
</script>

<style scoped>
.okr-editor { display: flex; flex-direction: column; gap: 12px; }
.okr-ed-card { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.okr-ed-row { display: flex; align-items: center; gap: 6px; }
.okr-ed-projs { width: 100%; }
.okr-seq, .okr-kr-no { font-size: 12px; font-weight: 600; color: var(--el-color-primary); flex: none; }
.okr-kr-no { color: var(--el-text-color-secondary); padding-top: 6px; width: 30px; }
.okr-ed-kr { display: flex; align-items: flex-start; gap: 6px; padding-left: 4px; }
.okr-ed-kr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.okr-ed-kr-opts { display: flex; gap: 6px; flex-wrap: wrap; }
.okr-type { width: 96px; }
.okr-w { width: 70px; flex: none; }
.okr-unit { width: 64px; }
.okr-ed-kr-add { display: flex; align-items: center; gap: 12px; }
.okr-ed-bulk { border: 0; background: none; padding: 4px 0; font-size: 12px; color: var(--el-color-primary); cursor: pointer; }
.okr-ed-link { border: 0; background: none; padding: 2px 0; font-size: 12px; color: var(--el-color-primary); cursor: pointer; }
.okr-ed-link:disabled { color: var(--el-text-color-placeholder); cursor: not-allowed; }
.okr-ms-ed { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; border-radius: 8px; background: var(--el-fill-color-lighter); }
.okr-ms-ed-row { display: flex; align-items: center; gap: 6px; }
.okr-ms-name { flex: 1; min-width: 0; }
.okr-ms-date { width: 132px !important; flex: none; }
.okr-ms-ed .okr-ed-link { align-self: flex-start; }
@media (max-width: 640px) {
  .okr-ms-ed-row { flex-wrap: wrap; }
  .okr-ms-name { flex: 1 1 calc(100% - 40px); }
  .okr-ms-date { flex: 1 1 auto; width: auto !important; }
}
.okr-ed-bulk:disabled { color: var(--el-text-color-placeholder); cursor: not-allowed; }
.okr-ed-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.okr-problems { margin: 0; padding: 8px 12px 8px 26px; border-radius: 8px; background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); font-size: 12px; line-height: 1.7; }
.okr-ed-actions { display: flex; justify-content: flex-end; gap: 8px; position: sticky; bottom: 0; padding: 8px 0 calc(8px + env(safe-area-inset-bottom)); background: var(--el-bg-color-page); }
.okr-late-hint { margin: 0; font-size: 12px; color: var(--el-color-danger); text-align: right; }
</style>
