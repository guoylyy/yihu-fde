<template>
  <!-- OKR 9.0 决策记录(项目交付 → 决策记录): 全员可读。
       顶部: 搜索(标题 / 正文) + 项目筛选 + 时间范围(默认最近 8 周) +「记一条决策」
       主区: 时间线(左竖线 + 每条一个点), 日期 · 决策人 · 标题 · 项目 / O 标签, 展开看背景 / 理由 / 影响;
             被取代: 灰色删除线 +「已被 X 取代」; 撤销: 红标签「已撤销」; 卡片菜单: 撤销(必填原因, 后端文案透出) / 用新决策取代
       右栏(宽屏 ≥1280 才显示): 本周决策数 + 按项目分布 -->
  <div class="dec-page" v-loading="loading">
    <div class="dec-top">
      <el-input v-model="q" clearable :placeholder="$t('okr.fe5.dec_search_ph')" class="dec-q" data-test="dec-q" />
      <el-select v-model="projectId" filterable clearable :placeholder="$t('okr.fe5.dec_all_projects')" class="dec-proj" data-test="dec-proj">
        <el-option v-for="p in projects" :key="p.id" :value="p.id" :label="p.name" />
      </el-select>
      <el-date-picker
        v-model="range" type="daterange" value-format="YYYY-MM-DD" :clearable="false" unlink-panels class="dec-range"
        :start-placeholder="$t('okr.fe5.dec_range_start')" :end-placeholder="$t('okr.fe5.dec_range_end')" data-test="dec-range"
      />
      <el-button type="primary" class="dec-new" data-test="dec-new" @click="openCreate">{{ $t('okr.fe5.dec_new') }}</el-button>
    </div>

    <div class="dec-body">
      <main class="dec-main">
        <p v-if="timeline?.truncated" class="dec-trunc">{{ $t('okr.fe5.dec_truncated', { p0: timeline.list.length }) }}</p>
        <ol v-if="rows.length" class="dec-tl" data-test="dec-timeline">
          <li
            v-for="d in rows" :id="'dec-' + d.id" :key="d.id" class="dec-item"
            :class="{ sup: d.superseded, rev: d.reverted, focus: focusId === d.id }" :data-test="'dec-item-' + d.id"
          >
            <span class="dec-dot" aria-hidden="true" />
            <div class="dec-card">
              <div class="dec-head">
                <button type="button" class="dec-head-main" :aria-expanded="isOpen(d.id)" @click="toggle(d.id)">
                  <span class="dec-meta">{{ d.date }} · {{ d.decidedByName || '-' }}</span>
                  <span class="dec-title" data-test="dec-title">{{ d.title }}</span>
                </button>
                <el-tag v-if="d.reverted" type="danger" size="small" effect="dark" class="dec-rev-tag" data-test="dec-reverted">{{ $t('okr.fe5.dec_reverted') }}</el-tag>
                <el-dropdown v-if="decisionMenu(d).length" trigger="click" @command="cmd => onMenu(cmd, d)">
                  <button type="button" class="dec-more" :aria-label="$t('okr.fe5.dec_menu')" data-test="dec-menu">⋯</button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-for="a in decisionMenu(d)" :key="a" :command="a" :data-test="'dec-act-' + a">{{ $t(a === 'revert' ? 'okr.fe5.dec_revert' : 'okr.fe5.dec_supersede') }}</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
              <p v-if="d.superseded" class="dec-sup-line" data-test="dec-superseded">
                <a v-if="d.supersededInList" href="#" @click.prevent="jump(d.supersededBy)">{{ supText(d) }}</a>
                <template v-else>{{ supText(d) }}</template>
              </p>
              <div v-if="d.tags.length" class="dec-tags">
                <span v-for="tg in d.tags" :key="tg.kind + tg.id" class="dec-tag" :class="'k-' + tg.kind" :title="tg.owner ? tg.text + ' · ' + tg.owner : tg.text">{{ tg.kind === 'objective' ? 'O ' : '' }}{{ tg.text }}</span>
              </div>
              <div v-if="isOpen(d.id)" class="dec-more-body" data-test="dec-expanded">
                <h4>{{ $t('okr.fe5.dec_detail') }}</h4>
                <p class="dec-text">{{ d.detail }}</p>
                <template v-if="d.rationale">
                  <h4>{{ $t('okr.fe5.dec_rationale') }}</h4>
                  <p class="dec-text">{{ d.rationale }}</p>
                </template>
                <template v-if="d.impact">
                  <h4>{{ $t('okr.fe5.dec_impact') }}</h4>
                  <p class="dec-text">{{ d.impact }}</p>
                </template>
              </div>
              <button type="button" class="dec-toggle" @click="toggle(d.id)">{{ isOpen(d.id) ? $t('okr.fe5.dec_collapse') : $t('okr.fe5.dec_expand') }}</button>
            </div>
          </li>
        </ol>
        <el-empty v-else-if="timeline" :description="$t('okr.fe5.dec_empty')" />
      </main>

      <aside class="dec-side" data-test="dec-side">
        <section class="dec-side-box">
          <h4>{{ $t('okr.fe5.dec_side_week') }}</h4>
          <b class="dec-side-num" data-test="dec-side-week">{{ stats.thisWeek }}</b>
          <small>{{ stats.week }}</small>
        </section>
        <section v-if="stats.projects.length" class="dec-side-box">
          <h4>{{ $t('okr.fe5.dec_side_by_project') }}</h4>
          <ul class="dec-side-list">
            <li v-for="p in stats.projects" :key="p.id || 'none'">
              <span class="dec-side-name" :title="p.name || $t('okr.fe5.dec_side_unassigned')">{{ p.name || $t('okr.fe5.dec_side_unassigned') }}</span>
              <span class="dec-side-bar"><i :style="{ width: Math.round(p.ratio * 100) + '%' }" /></span>
              <span class="dec-side-n">{{ p.count }}</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>

    <OkrDecisionDialog
      v-model="dlg.visible" :mode="dlg.mode" :old="dlg.old" :objectives="oOptions" :projects="projects" :default-project-id="projectId || ''"
      :writer="writer" :mobile="isMobile" :busy="busy" @submit="onSubmit"
    />

    <el-dialog v-model="rev.visible" :title="$t('okr.fe5.dec_revert_title')" width="min(92vw, 460px)" append-to-body>
      <p class="dec-rev-sub">{{ rev.d?.title }}</p>
      <el-input v-model="rev.reason" type="textarea" :rows="3" maxlength="2000" :placeholder="$t('okr.fe5.dec_revert_ph')" data-test="dec-revert-reason" />
      <p v-if="rev.error" class="dec-rev-err" role="alert" data-test="dec-revert-error">{{ rev.error }}</p>
      <template #footer>
        <el-button @click="rev.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="busy" data-test="dec-revert-go" @click="submitRevert">{{ $t('okr.fe5.dec_revert_go') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { useIsMobile } from '@/composables/useResponsive.js'
import OkrDecisionDialog from '@/components/okr/OkrDecisionDialog.vue'
import { currentUser } from './okrPeople.js'
import { isLead } from './okrFe3.js'
import { weekKey, isoWeekOf } from './okrUtils.js'
import { isActiveProjectRow } from './okrPolish.js'
import {
  defaultDecisionRange, filterDecisions, decisionRow, missingSupersederIds, decisionMenu, revertPayload, decisionStats, objectiveOptions
} from './okrFe5.js'

const route = useRoute()
const isMobile = useIsMobile()
const me = currentUser()
const writer = isLead(me)
const loading = ref(false)
const busy = ref(false)
const q = ref(String(route.query.q || ''))
const projectId = ref(route.query.projectId ? String(route.query.projectId) : '')
const def = defaultDecisionRange()
const range = ref([String(route.query.from || def.from), String(route.query.to || def.to)])
const timeline = ref(null)
const supCache = reactive(new Map())
const openIds = reactive(new Set())
const focusId = ref(route.query.focus ? String(route.query.focus) : '')

const all = computed(() => timeline.value?.list || [])
const byId = computed(() => new Map(all.value.map(d => [String(d.id), d])))
const rows = computed(() => filterDecisions(all.value, q.value).map(d => decisionRow(d, byId.value, supCache)))
const stats = computed(() => decisionStats(all.value))
const supText = d => (d.supersededTitle ? $t('okr.fe5.dec_superseded_by', { p0: d.supersededTitle }) : $t('okr.fe5.dec_superseded_by_id', { p0: d.supersededBy }))
const isOpen = id => openIds.has(String(id))
function toggle(id) {
  const k = String(id)
  if (openIds.has(k)) openIds.delete(k)
  else openIds.add(k)
}

async function load() {
  loading.value = true
  try {
    timeline.value = await fde.okr.decisionTimeline({ from: range.value?.[0], to: range.value?.[1], projectId: projectId.value || undefined })
    fillSuperseders()
    if (focusId.value) {
      openIds.add(focusId.value)
      jump(focusId.value)
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
watch([projectId, range], load, { immediate: true })

/** 取代者不在当前范围里: 逐条补查标题(只补一次) */
async function fillSuperseders() {
  for (const id of missingSupersederIds(all.value, supCache)) {
    try { supCache.set(id, await fde.okr.decision(id)) } catch { supCache.set(id, { id, title: null }) }
  }
}

function jump(id) {
  focusId.value = String(id)
  nextTick(() => document.getElementById('dec-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
}

// ---------------------------------------------------------------- 项目 / O 选项
const projects = ref([])
const oOptions = ref([])
const thisWeek = weekKey(isoWeekOf())
;(async () => {
  try {
    const r = await fde.okr.projectDocs(thisWeek)
    const list = [...(r?.rows || [])].sort((a, b) => Number(isActiveProjectRow(b)) - Number(isActiveProjectRow(a)))
    projects.value = list.map(x => ({ id: String(x.project.id), name: x.project.name }))
  } catch { projects.value = [] }
})()
async function loadObjectives() {
  try {
    if (writer) {
      const t = await fde.okr.team(thisWeek)
      oOptions.value = objectiveOptions({ rows: t?.rows || [] })
    } else {
      const c = await fde.okr.cycle({ week: thisWeek })
      oOptions.value = objectiveOptions({ objectives: c?.objectives || [], owner: c?.owner })
    }
  } catch { oOptions.value = [] }
}

// ---------------------------------------------------------------- 记 / 取代 / 撤销
const dlg = reactive({ visible: false, mode: 'create', old: null })
function openCreate() {
  Object.assign(dlg, { visible: true, mode: 'create', old: null })
  loadObjectives()
}
function onMenu(cmd, d) {
  if (cmd === 'supersede') Object.assign(dlg, { visible: true, mode: 'supersede', old: d })
  if (cmd === 'revert') Object.assign(rev, { visible: true, d, reason: '', error: '' })
}

async function onSubmit(payload, setError) {
  busy.value = true
  try {
    if (dlg.mode === 'supersede') {
      const r = await fde.okr.supersedeDecision(dlg.old.id, payload)
      ElMessage.success($t('okr.fe5.dec_superseded_ok'))
      focusId.value = String(r.decision.id)
    } else {
      const d = await fde.okr.createDecision(payload)
      ElMessage.success($t('okr.fe5.dec_saved'))
      focusId.value = String(d.id)
    }
    dlg.visible = false
    await load()
  } catch (e) {
    setError(e.message)
  } finally {
    busy.value = false
  }
}

const rev = reactive({ visible: false, d: null, reason: '', error: '' })
/** 不在前端拦空原因: 后端 400(8193)的文案原样显示在框里 */
async function submitRevert() {
  busy.value = true
  rev.error = ''
  try {
    await fde.okr.patchDecision(rev.d.id, revertPayload(rev.reason, rev.d.rationale, $t))
    ElMessage.success($t('okr.fe5.dec_reverted_ok'))
    rev.visible = false
    await load()
  } catch (e) {
    rev.error = e.message
    ElMessage.error(e.message)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.dec-page { max-width: 1200px; margin: 0 auto; padding: 4px 0 24px; }
.dec-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
.dec-q { width: 220px; }
.dec-proj { width: 200px; }
.dec-range { max-width: 280px; }
.dec-new { margin-left: auto; }
.dec-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
.dec-side { display: none; }
@media (min-width: 1280px) {
  .dec-body { grid-template-columns: minmax(0, 1fr) 260px; }
  .dec-side { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 12px; }
}
.dec-trunc { margin: 0 0 8px; font-size: 12px; color: var(--el-color-warning-dark-2); }
.dec-tl { list-style: none; margin: 0; padding: 0 0 0 22px; position: relative; display: flex; flex-direction: column; gap: 12px; }
.dec-tl::before { content: ''; position: absolute; left: 6px; top: 6px; bottom: 6px; width: 2px; background: var(--el-border-color); border-radius: 1px; }
.dec-item { position: relative; }
.dec-dot { position: absolute; left: -21px; top: 14px; width: 12px; height: 12px; border-radius: 50%; background: var(--el-color-primary); border: 2px solid var(--el-bg-color); box-shadow: 0 0 0 1px var(--el-color-primary-light-5); }
.dec-item.sup .dec-dot { background: var(--el-text-color-placeholder); box-shadow: 0 0 0 1px var(--el-border-color); }
.dec-item.rev .dec-dot { background: var(--el-color-danger); box-shadow: 0 0 0 1px var(--el-color-danger-light-5); }
.dec-card { padding: 10px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-bg-color); transition: box-shadow .2s; }
.dec-item.focus .dec-card { box-shadow: 0 0 0 2px var(--el-color-primary-light-5); }
.dec-head { display: flex; align-items: flex-start; gap: 8px; }
.dec-head-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 0; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; color: inherit; }
.dec-meta { font-size: 12px; color: var(--el-text-color-secondary); }
.dec-title { font-size: 15px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.dec-item.sup .dec-title { color: var(--el-text-color-placeholder); text-decoration: line-through; }
.dec-item.sup .dec-card { background: var(--el-fill-color-lighter); }
.dec-rev-tag { flex: none; }
.dec-more { flex: none; width: 32px; height: 28px; border: 0; border-radius: 6px; background: none; font-size: 18px; line-height: 1; color: var(--el-text-color-secondary); cursor: pointer; }
.dec-more:hover { background: var(--el-fill-color-light); }
.dec-sup-line { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
.dec-sup-line a { color: var(--el-color-primary); text-decoration: none; }
.dec-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.dec-tag { max-width: 100%; padding: 1px 8px; border-radius: 10px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: var(--el-fill-color); color: var(--el-text-color-regular); }
.dec-tag.k-project { background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2); }
.dec-more-body { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--el-border-color-lighter); }
.dec-more-body h4 { margin: 6px 0 2px; font-size: 12px; color: var(--el-text-color-secondary); font-weight: 600; }
.dec-text { margin: 0; font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.dec-toggle { margin-top: 4px; padding: 2px 0; border: 0; background: none; font: inherit; font-size: 12px; color: var(--el-color-primary); cursor: pointer; }
.dec-side-box { padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-bg-color); }
.dec-side-box h4 { margin: 0 0 6px; font-size: 13px; }
.dec-side-num { font-size: 28px; line-height: 1.2; margin-right: 6px; }
.dec-side-box small { font-size: 12px; color: var(--el-text-color-secondary); }
.dec-side-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.dec-side-list li { display: grid; grid-template-columns: 90px minmax(0, 1fr) 24px; align-items: center; gap: 6px; }
.dec-side-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dec-side-bar { height: 6px; border-radius: 3px; background: var(--el-border-color-lighter); overflow: hidden; }
.dec-side-bar i { display: block; height: 100%; background: var(--el-color-primary); }
.dec-side-n { text-align: right; font-weight: 600; }
.dec-rev-sub { margin: 0 0 8px; font-weight: 600; }
.dec-rev-err { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; font-size: 13px; color: var(--el-color-danger-dark-2); background: var(--el-color-danger-light-9); border: 1px solid var(--el-color-danger-light-5); }
@media (max-width: 768px) {
  .dec-top { gap: 6px; }
  .dec-q, .dec-proj { width: calc(50% - 3px); }
  .dec-q :deep(.el-input__wrapper), .dec-proj :deep(.el-select__wrapper) { min-height: 44px; }
  .dec-range { max-width: none; width: 100% !important; min-height: 44px; }
  .dec-new { margin-left: 0; width: 100%; min-height: 44px; }
  .dec-more { width: 44px; height: 44px; }
  .dec-toggle { min-height: 36px; }
}
</style>
