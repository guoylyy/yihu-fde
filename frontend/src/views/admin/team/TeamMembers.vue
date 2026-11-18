<template>
  <!-- 0.5.0 团队 · 成员卡片: 每人一张卡, 看谁在干什么、手上多少活 -->
  <div class="team-members" v-loading="loading">
    <div class="toolbar">
      <el-input v-model="keyword" :placeholder="$t('team.search_member')" clearable class="search" />
      <el-radio-group v-model="loadFilter" size="small">
        <el-radio-button value="">{{ $t('common.all') }}</el-radio-button>
        <el-radio-button v-for="l in LOAD_LEVELS" :key="l" :value="l">{{ $t('team.load_level.' + l) }}</el-radio-button>
      </el-radio-group>
    </div>
    <el-empty v-if="!loading && !shown.length" :description="error || $t('team.no_members')" />
    <div class="cards">
      <article v-for="m in shown" :key="m.userId" class="card" data-test="member-card">
        <header>
          <el-avatar :size="36" :src="m.avatarUrl || undefined" class="avatar">{{ (m.name || '?').slice(0, 1) }}</el-avatar>
          <div class="who">
            <strong>{{ m.name }}</strong>
            <span class="sub">{{ roleLabel(m.role) }}<template v-if="m.level"> · {{ m.level }}</template><template v-if="m.city"> · {{ m.city }}</template></span>
          </div>
          <el-tag size="small" :type="LOAD_TAG[m.load]" effect="plain">{{ $t('team.load_level.' + m.load) }}</el-tag>
        </header>
        <div class="stats">
          <div><b>{{ m.open }}</b><span>{{ $t('team.open_tasks') }}</span></div>
          <div :class="{ danger: m.overdue }"><b>{{ m.overdue }}</b><span>{{ $t('team.overdue') }}</span></div>
          <div><b>{{ m.activeProjects }}</b><span>{{ $t('team.projects') }}</span></div>
          <div><b>{{ m.conversations7d }}</b><span>{{ $t('team.conversations_7d') }}</span></div>
        </div>
        <div v-if="m.skills.length || m.teams.length" class="tags">
          <el-tag v-for="t in m.teams" :key="'t' + t.id" size="small" type="info">{{ t.name }}</el-tag>
          <el-tag v-for="s in m.skills.slice(0, 5)" :key="'s' + skillName(s)" size="small" effect="plain">{{ skillName(s) }}</el-tag>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, onMounted } from 'vue'
import { fde } from '@/api/index.js'
import { roleLabel } from '@/api/roles.js'
import { LOAD_LEVELS, LOAD_TAG, skillName } from './teamUtils.js'

const list = ref([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const loadFilter = ref('')

const shown = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return list.value.filter(m =>
    (!loadFilter.value || m.load === loadFilter.value) &&
    (!kw || `${m.name} ${m.username} ${m.skills.map(skillName).join(' ')}`.toLowerCase().includes(kw)))
})

onMounted(async () => {
  loading.value = true
  try { list.value = (await fde.team.overview()).list || [] } catch (e) { error.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.search { width: 240px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.card { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.card header { display: flex; align-items: center; gap: 10px; }
.avatar { background: #f0eee9; color: #1c1917; flex-shrink: 0; }
.who { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.who strong { font-size: 14px; color: #1c1917; }
.sub { font-size: 12px; color: #8f8a82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; text-align: center; }
.stats div { display: flex; flex-direction: column; }
.stats b { font-size: 16px; color: #1c1917; font-variant-numeric: tabular-nums; }
.stats span { font-size: 11px; color: #8f8a82; }
.stats .danger b { color: #c2362b; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; }
@media (max-width: 768px) { .search { width: 100%; } }
</style>
