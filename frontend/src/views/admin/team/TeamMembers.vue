<template>
  <!-- 0.5.0 团队 · 成员卡片: 一人一张卡, 看这周说了要做什么、手上多少活、最近有没有在干。
       数据: GET /api/team/members(组长看本组, 老板看全部) -->
  <div class="team-members">
    <div class="toolbar">
      <el-input v-model="keyword" :placeholder="$t('team.search_member')" clearable class="search" />
      <span v-if="weekText" class="week">{{ weekText }}</span>
    </div>

    <div v-if="loading" class="cards" data-test="members-skeleton">
      <div v-for="i in 6" :key="i" class="card"><el-skeleton :rows="4" animated /></div>
    </div>
    <LoadError v-else-if="error" :message="error" @retry="load" />
    <el-empty v-else-if="!shown.length" :description="$t('team.no_members')" />
    <div v-else class="cards">
      <article v-for="m in shown" :key="m.engineerId" class="card" data-test="member-card" tabindex="0"
               @click="open(m)" @keyup.enter="open(m)">
        <header>
          <el-avatar :size="36" class="avatar">{{ (m.name || '?').slice(0, 1) }}</el-avatar>
          <div class="who">
            <strong class="name">{{ m.name }}</strong>
            <span class="tags-line">
              <el-tag size="small" type="info" effect="plain" class="role">{{ roleLabel(m.role) }}</el-tag>
              <span v-if="m.level" class="level" data-test="member-level">{{ m.level }}</span>
            </span>
          </div>
        </header>

        <div v-if="m.skills.length" class="skills" data-test="member-skills">
          <el-tag v-for="s in takeTop(m.skills, 3).shown" :key="skillName(s)" size="small" effect="plain">{{ skillName(s) }}</el-tag>
          <span v-if="takeTop(m.skills, 3).rest" class="more">+{{ takeTop(m.skills, 3).rest }}</span>
        </div>

        <div class="promise">
          <span class="label">{{ $t('team.week_promise') }}</span>
          <ul v-if="m.committedObjectives.length" data-test="member-objectives">
            <li v-for="(o, i) in takeTop(m.committedObjectives, 2).shown" :key="i">
              <span class="o-title">{{ o.title }}</span>
              <span v-if="o.weight != null" class="o-weight">{{ $t('team.weight', { n: o.weight }) }}</span>
            </li>
            <li v-if="takeTop(m.committedObjectives, 2).rest" class="more">+{{ takeTop(m.committedObjectives, 2).rest }}</li>
          </ul>
          <span v-else class="muted">{{ $t('team.no_promise') }}</span>
        </div>

        <div class="facts">
          <div><span class="label">{{ $t('team.active_tasks') }}</span><b data-test="member-active">{{ m.activeTaskCount }}</b></div>
          <div><span class="label">{{ $t('team.last_conversation') }}</span><b class="ago">{{ ago(m.lastConversationAt) }}</b></div>
        </div>

        <div class="load" :title="$t('team.load_formula', { n: threshold })">
          <el-progress :percentage="loadBarPct(m.loadPct)" :show-text="false" :stroke-width="8" :color="loadColor(m.loadPct)" class="bar" />
          <span class="pct" :class="'band-' + loadBand(m.loadPct)" data-test="member-load">{{ m.loadPct }}%</span>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fde } from '@/api/index.js'
import { roleLabel } from '@/api/roles.js'
import LoadError from '@/components/common/LoadError.vue'
import { skillName, takeTop, loadBand, loadColor, loadBarPct, relativeTime, weekRangeText, LOAD_THRESHOLD } from './teamUtils.js'

const router = useRouter()
const list = ref([])
const meta = ref({})
const loading = ref(true)
const error = ref('')
const keyword = ref('')

const threshold = computed(() => meta.value.threshold || LOAD_THRESHOLD)
const weekText = computed(() => meta.value.week
  ? `${$t('team.week.label', { year: meta.value.week.year, n: meta.value.week.weekNo })} · ${weekRangeText(meta.value.week)}`
  : '')
const shown = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(m => `${m.name} ${(m.skills || []).map(skillName).join(' ')}`.toLowerCase().includes(kw))
})

function ago(at) {
  const r = relativeTime(at)
  if (r.unit === 'none') return $t('team.never')
  if (r.unit === 'date') return r.date
  return $t('team.ago.' + r.unit, { n: r.n })
}

function open(m) { router.push(`/admin/team/members/${m.engineerId}`) }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await fde.team.members()
    list.value = (r.data || []).map(m => ({ ...m, skills: m.skills || [], committedObjectives: m.committedObjectives || [] }))
    meta.value = r.meta || {}
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<style scoped>
.team-members { min-width: 0; }
.toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.search { width: 240px; }
.week { color: var(--text-muted); font-size: 13px; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
article.card { cursor: pointer; transition: border-color .15s; }
article.card:hover, article.card:focus-visible { border-color: var(--border-strong); outline: none; }
.card header { display: flex; align-items: center; gap: 10px; }
.avatar { background: #f0eee9; color: var(--text); flex-shrink: 0; }
.who { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.name { font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tags-line { display: flex; align-items: center; gap: 6px; }
.level { font-size: 11px; letter-spacing: .03em; color: var(--text-secondary); font-family: var(--font-num); }
.skills { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.more { font-size: 12px; color: var(--text-muted); }
.label { font-size: 11px; color: var(--text-muted); }
.promise ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.promise li { display: flex; gap: 8px; align-items: baseline; font-size: 13px; min-width: 0; }
.o-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.o-weight { flex-shrink: 0; font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.muted { display: block; margin-top: 4px; font-size: 13px; color: var(--text-muted); }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.facts div { display: flex; flex-direction: column; }
.facts b { font-size: 15px; color: var(--text); font-variant-numeric: tabular-nums; }
.facts b.ago { font-size: 13px; font-weight: 500; }
.load { display: flex; align-items: center; gap: 8px; margin-top: auto; }
.bar { flex: 1; }
.pct { width: 44px; text-align: right; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.band-OK { color: var(--success); }
.band-WARN { color: #b37d12; }
.band-OVER { color: var(--danger); }
@media (max-width: 1100px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .cards { grid-template-columns: minmax(0, 1fr); }
  .search { width: 100%; }
}
</style>
