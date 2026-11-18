<template>
  <!-- 0.5.0 团队 · 负载: 谁手上太满、谁空着, 按档位排 -->
  <div class="team-load" v-loading="loading">
    <p class="hint">{{ $t('team.load_hint') }}</p>
    <el-empty v-if="!loading && !rows.length" :description="error || $t('team.no_members')" />
    <el-table v-else :data="rows" stripe class="load-table" data-test="load-table">
      <el-table-column :label="$t('team.member')" min-width="140" fixed>
        <template #default="{ row }">
          <div class="who">
            <strong>{{ row.name }}</strong>
            <span class="sub">{{ roleLabel(row.role) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="$t('team.load')" width="96">
        <template #default="{ row }">
          <el-tag size="small" :type="LOAD_TAG[row.load]" effect="plain">{{ $t('team.load_level.' + row.load) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('team.open_tasks')" min-width="160">
        <template #default="{ row }">
          <div class="bar-cell">
            <el-progress :percentage="barPct(row.open)" :show-text="false" :stroke-width="8" :color="barColor(row.load)" class="bar" />
            <span class="num">{{ row.open }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="inProgress" :label="$t('team.in_progress')" width="90" align="right" />
      <el-table-column :label="$t('team.overdue')" width="80" align="right">
        <template #default="{ row }"><span :class="{ danger: row.overdue }">{{ row.overdue }}</span></template>
      </el-table-column>
      <el-table-column prop="dueSoon" :label="$t('team.due_7d')" width="96" align="right" />
      <el-table-column prop="highPriority" :label="$t('team.high_priority')" width="90" align="right" />
      <el-table-column prop="doneThisWeek" :label="$t('team.done_week')" width="96" align="right" />
      <el-table-column :label="$t('team.actual_hours_week')" width="110" align="right">
        <template #default="{ row }">{{ row.actualHoursThisWeek ? row.actualHoursThisWeek + 'h' : '-' }}</template>
      </el-table-column>
      <el-table-column prop="activeProjects" :label="$t('team.projects')" width="80" align="right" />
    </el-table>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, onMounted } from 'vue'
import { fde } from '@/api/index.js'
import { roleLabel } from '@/api/roles.js'
import { LOAD_TAG, sortByLoad } from './teamUtils.js'

const list = ref([])
const loading = ref(false)
const error = ref('')
const rows = computed(() => sortByLoad(list.value))
const maxOpen = computed(() => Math.max(12, ...list.value.map(r => r.open || 0)))
const barPct = (n) => Math.round(((n || 0) / maxOpen.value) * 100)
const barColor = (l) => ({ OVERLOAD: '#c2362b', BUSY: '#b3450f', NORMAL: '#1c1917', IDLE: '#c9c4bc' }[l] || '#1c1917')

onMounted(async () => {
  loading.value = true
  try { list.value = (await fde.team.overview()).list || [] } catch (e) { error.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.hint { margin: 0 0 12px; color: #8f8a82; font-size: 13px; }
.who { display: flex; flex-direction: column; }
.sub { font-size: 12px; color: #8f8a82; }
.bar-cell { display: flex; align-items: center; gap: 8px; }
.bar { flex: 1; }
.num { width: 24px; text-align: right; font-variant-numeric: tabular-nums; }
.danger { color: #c2362b; font-weight: 600; }
</style>
