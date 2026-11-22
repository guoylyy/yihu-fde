<template>
  <!-- OKR 4.0 周状态与催交(团队页顶部, 仅 ADMIN/MANAGER; 数据 /week/status, MANAGER 后端限本团队)。
       一条进度: 已提交 / 已自评 / 已打分(分母 = 应交人数, 免提交不算); 展开是每人一行, 未完成标红;
       「催交」调 /week/remind, toast 报实际催到几人, 并把催到的人那行标灰 -->
  <section v-if="status" class="wst" data-test="okr-week-status">
    <div class="wst-bar">
      <button type="button" class="wst-toggle" :aria-expanded="open" data-test="wst-toggle" @click="open = !open">
        <span class="wst-label">{{ $t('okr.wstatus.title') }}</span>
        <span class="wst-nums" data-test="wst-nums">
          {{ $t('okr.wstatus.plan', { p0: prog.plan, p1: prog.total }) }} · {{ $t('okr.wstatus.self', { p0: prog.self, p1: prog.total }) }} · {{ $t('okr.wstatus.mgr', { p0: prog.mgr, p1: prog.total }) }}
          <em v-if="prog.exempt" class="wst-exempt-n">{{ $t('okr.wstatus.exempt_n', { p0: prog.exempt }) }}</em>
        </span>
        <span class="wst-caret" aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
      </button>
      <el-button
        type="warning" plain :loading="reminding" :disabled="closed || !prog.incomplete" class="wst-remind" data-test="wst-remind"
        :title="closed ? $t('okr.v3.closed_tip') : undefined" @click="remind"
      >{{ $t('okr.wstatus.remind') }}<template v-if="prog.incomplete"> ({{ prog.incomplete }})</template></el-button>
    </div>

    <div v-if="open" class="wst-table" role="table" data-test="wst-table">
      <div class="wst-row wst-headrow" role="row">
        <span role="columnheader">{{ $t('okr.engineer') }}</span>
        <span role="columnheader">{{ $t('okr.wstatus.col_plan') }}</span>
        <span role="columnheader">{{ $t('okr.wstatus.col_self') }}</span>
        <span role="columnheader">{{ $t('okr.wstatus.col_mgr') }}</span>
        <span role="columnheader">{{ $t('okr.wstatus.col_daily') }}</span>
      </div>
      <div
        v-for="row in status.rows" :key="row.user.id" class="wst-row" role="row"
        :class="{ exempt: row.exempt, reminded: reminded.has(row.user.id) }" :data-test="'wst-row-' + row.user.id"
      >
        <span class="wst-name" role="cell">
          {{ row.user.name }}
          <span v-if="row.exempt" class="wst-tag" data-test="wst-exempt">{{ $t('okr.wstatus.exempt') }}</span>
          <span v-else-if="reminded.has(row.user.id)" class="wst-tag" data-test="wst-reminded">{{ $t('okr.wstatus.reminded') }}</span>
        </span>
        <template v-if="!row.exempt">
          <span role="cell" :class="{ bad: cells(row).plan.bad }" :data-label="$t('okr.wstatus.col_plan')">
            {{ cells(row).plan.ok ? (cells(row).plan.late ? $t('okr.late') : '✓') : $t('okr.not_submitted_short') }}
          </span>
          <span role="cell" :class="{ bad: cells(row).self.bad }" :data-label="$t('okr.wstatus.col_self')">{{ cells(row).self.text }}</span>
          <span role="cell" :class="{ bad: cells(row).mgr.bad }" :data-label="$t('okr.wstatus.col_mgr')">{{ cells(row).mgr.text }}</span>
          <span role="cell" :class="{ bad: cells(row).daily.bad }" :data-label="$t('okr.wstatus.col_daily')">{{ cells(row).daily.text }}</span>
        </template>
        <span v-else class="wst-skip" role="cell">{{ $t('okr.wstatus.exempt_hint') }}</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { weekProgress, statusCells, mergeReminded, skippedByReason } from '@/views/okr/okrFe3.js'

const props = defineProps({
  week: { type: String, required: true }
})
// 0.6.3: 团队页拿同一份数据算「未交自评」计数与归档提示条, 不再多拉一次
const emit = defineEmits(['loaded'])

const status = ref(null)
const open = ref(false)
const reminding = ref(false)
const reminded = ref(new Set())
const prog = computed(() => weekProgress(status.value))
const closed = computed(() => status.value?.cycle?.status === 'CLOSED')
const cells = statusCells

async function load() {
  try {
    status.value = await fde.okr.weekStatus(props.week)
  } catch {
    status.value = null // 非 ADMIN/MANAGER 403: 不出这一条
  }
  emit('loaded', status.value)
}
watch(() => props.week, () => { reminded.value = new Set(); load() }, { immediate: true })

async function remind() {
  reminding.value = true
  try {
    const res = await fde.okr.remindWeek(props.week)
    reminded.value = mergeReminded(reminded.value, res)
    const n = res.reminded?.length || 0
    const recent = skippedByReason(res).RECENTLY_REMINDED || 0
    const tail = recent ? $t('okr.wstatus.recent_skipped', { p0: recent }) : ''
    if (n) ElMessage.success($t('okr.wstatus.reminded_n', { p0: n }) + tail)
    else ElMessage.info($t('okr.wstatus.nobody') + tail)
    open.value = true
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    reminding.value = false
  }
}

defineExpose({ reload: load })
</script>

<style scoped>
.wst { margin-bottom: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-bg-color); }
.wst-bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 4px; }
.wst-toggle { flex: 1; min-width: 0; min-height: 44px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 4px 10px; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; color: inherit; }
.wst-label { font-weight: 600; font-size: 14px; }
.wst-nums { font-size: 13px; color: var(--el-text-color-regular); }
.wst-exempt-n { font-style: normal; margin-left: 6px; color: var(--el-text-color-secondary); }
.wst-caret { color: var(--el-text-color-secondary); margin-left: auto; }
.wst-table { border-top: 1px solid var(--el-border-color-lighter); padding: 4px 12px 10px; font-size: 13px; }
.wst-row { display: grid; grid-template-columns: minmax(0, 2fr) repeat(4, minmax(0, 1fr)); gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-extra-light); }
.wst-row:last-child { border-bottom: 0; }
.wst-headrow { font-size: 12px; color: var(--el-text-color-secondary); }
.wst-row > span:not(.wst-name) { text-align: center; }
.wst-name { font-weight: 600; overflow-wrap: anywhere; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wst-row .bad { color: var(--el-color-danger); font-weight: 600; }
.wst-tag { font-size: 11px; font-weight: 400; padding: 0 6px; line-height: 18px; border-radius: 9px; background: var(--el-fill-color); color: var(--el-text-color-secondary); }
.wst-row.exempt, .wst-row.reminded { opacity: .55; }
.wst-row.exempt .wst-skip { grid-column: 2 / -1; color: var(--el-text-color-secondary); font-size: 12px; }
@media (max-width: 768px) {
  .wst-bar { flex-wrap: wrap; }
  .wst-remind { width: 100%; min-height: 44px; margin: 0 4px 4px; }
  .wst-headrow { display: none; }
  .wst-row { grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 4px; }
  .wst-name { grid-column: 1 / -1; }
  .wst-row > span[data-label]::before { content: attr(data-label); display: block; font-size: 11px; font-weight: 400; color: var(--el-text-color-secondary); }
  .wst-row.exempt .wst-skip { grid-column: 1 / -1; text-align: left; }
}
</style>
