<template>
  <!-- 0.5.0 团队 · 负载看板: 这周谁手上太满、谁空着。
       数据: GET /api/team/load?week=YYYY-MM-DD(组长看本组, 老板看全部); 负载 = 进行中任务数 ÷ meta.threshold -->
  <div class="team-load">
    <TeamWeekHeader :week="meta.week" />
    <p class="hint">{{ $t('team.load_page.hint', { n: threshold }) }}</p>

    <div v-if="loading" class="panel" data-test="load-skeleton"><el-skeleton :rows="6" animated /></div>
    <LoadError v-else-if="error" :message="error" @retry="load" />
    <el-empty v-else-if="!rows.length" :description="$t('team.no_members')" />
    <div v-else class="panel table-wrap">
      <el-table :data="rows" stripe class="load-table" data-test="load-table" :default-sort="{ prop: 'loadPct', order: 'descending' }">
        <el-table-column prop="name" :label="$t('team.load_page.name')" min-width="130" fixed sortable>
          <template #default="{ row }">
            <router-link :to="`/admin/team/members/${row.engineerId}`" class="name">{{ row.name }}</router-link>
          </template>
        </el-table-column>
        <el-table-column prop="activeTaskCount" :label="$t('team.load_page.active')" min-width="110" align="right" sortable />
        <el-table-column prop="plannedHours" min-width="130" align="right">
          <template #header>
            <el-tooltip :content="$t('team.load_page.planned_tip')" placement="top">
              <span class="th-tip">{{ $t('team.load_page.planned') }} <span class="q">?</span></span>
            </el-tooltip>
          </template>
          <template #default="{ row }">{{ row.plannedHours == null ? '—' : row.plannedHours + 'h' }}</template>
        </el-table-column>
        <el-table-column prop="committedWeight" :label="$t('team.load_page.weight')" min-width="130" align="right" sortable />
        <el-table-column prop="conversationCount" :label="$t('team.load_page.convs')" min-width="120" align="right" sortable />
        <el-table-column prop="loadPct" min-width="150" sortable>
          <template #header>
            <el-tooltip :content="$t('team.load_formula', { n: threshold })" placement="top">
              <span class="th-tip" data-test="load-th">{{ $t('team.load_page.load_pct') }} <span class="q">?</span></span>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <span class="load-cell" :class="'band-' + loadBand(row.loadPct)" data-test="load-cell">
              <span class="swatch" :style="{ background: loadColor(row.loadPct) }" />
              <b>{{ row.loadPct }}%</b>
              <span class="band-text">{{ $t('team.load_band.' + loadBand(row.loadPct)) }}</span>
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fde } from '@/api/index.js'
import LoadError from '@/components/common/LoadError.vue'
import TeamWeekHeader from './TeamWeekHeader.vue'
import { loadBand, loadColor, LOAD_THRESHOLD } from './teamUtils.js'

const route = useRoute()
const rows = ref([])
const meta = ref({})
const loading = ref(true)
const error = ref('')
const threshold = computed(() => meta.value.threshold || LOAD_THRESHOLD)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await fde.team.load(route.query.week || undefined)
    rows.value = r.data || []
    meta.value = r.meta || {}
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
watch(() => route.query.week, load, { immediate: true })
</script>

<style scoped>
.team-load { min-width: 0; }
.hint { margin: 0 0 12px; color: var(--text-muted); font-size: 13px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 4px; min-width: 0; }
.table-wrap { overflow: hidden; } /* 窄屏时 el-table 自己横向滚, 页面不溢出 */
.name { color: var(--text); font-weight: 600; text-decoration: none; }
.name:hover { text-decoration: underline; }
.th-tip { cursor: help; white-space: nowrap; }
.load-table :deep(th .cell) { white-space: nowrap; }
.q { display: inline-block; width: 14px; height: 14px; line-height: 14px; text-align: center; border-radius: 50%; background: #f0eee9; color: var(--text-muted); font-size: 10px; }
.load-cell { display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.swatch { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
.band-text { font-size: 12px; color: var(--text-muted); }
.band-OK b { color: var(--success); }
.band-WARN b { color: #b37d12; }
.band-OVER b { color: var(--danger); }
</style>
