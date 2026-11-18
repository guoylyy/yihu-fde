<template>
  <!-- 0.5.0 团队 · 承诺 vs 交付(只给老板, team.view.all): 说要做 / 系统里做了 / 实际干了多少 三个数摆一起,
       加一个提示标记。刻意不排名、不打分 —— 顺序就是接口给的顺序。
       数据: GET /api/team/promise?week=YYYY-MM-DD -->
  <div class="team-promise">
    <TeamWeekHeader :week="meta.week" />
    <p class="hint" data-test="promise-hint">{{ $t('team.promise.hint') }}</p>

    <div v-if="loading" class="panel pad" data-test="promise-skeleton"><el-skeleton :rows="6" animated /></div>
    <LoadError v-else-if="error" :message="error" @retry="load" />
    <el-empty v-else-if="!rows.length" :description="$t('team.no_members')" />
    <div v-else class="panel" role="table">
      <div class="grid head" role="row">
        <span class="c-name" />
        <span class="c-said">{{ $t('team.promise.said') }}</span>
        <span class="c-done">{{ $t('team.promise.done') }}</span>
        <span class="c-actual">{{ $t('team.promise.actual') }}</span>
        <span class="c-flag">{{ $t('team.promise.flag') }}</span>
      </div>
      <div v-for="r in rows" :key="r.engineerId" class="grid row" role="row" data-test="promise-row">
        <router-link :to="`/admin/team/members/${r.engineerId}`" class="c-name name">{{ r.name }}</router-link>

        <div class="c-said cell">
          <span class="m-label">{{ $t('team.promise.said') }}</span>
          <template v-if="r.objectives.length">
            <el-tooltip placement="top" :content="r.objectives.map(o => `${o.title}（${o.weight ?? '-'}）`).join('；')">
              <span class="num">{{ $t('team.promise.objectives', { n: r.objectives.length }) }}</span>
            </el-tooltip>
            <span class="sub">{{ $t('team.weight', { n: totalWeight(r.objectives) }) }}</span>
          </template>
          <span v-else class="sub">{{ $t('team.promise.no_objectives') }}</span>
        </div>

        <div class="c-done cell">
          <span class="m-label">{{ $t('team.promise.done') }}</span>
          <span class="num">{{ $t('team.promise.completed', { n: r.completedTasks }) }}</span>
        </div>

        <div class="c-actual cell">
          <span class="m-label">{{ $t('team.promise.actual') }}</span>
          <span class="num">{{ $t('team.promise.convs', { n: r.conversationCount }) }}</span>
          <span class="sub">{{ $t('team.promise.projects', { n: r.projectCount }) }}</span>
        </div>

        <div class="c-flag flags" data-test="promise-flags">
          <template v-if="promiseFlagsOf(r).length">
            <el-tooltip v-for="f in promiseFlagsOf(r)" :key="f" :content="$t('team.promise.flag_tips.' + f)" placement="top">
              <el-tag size="small" :type="PROMISE_FLAG_TONE[f]" effect="light" :class="'flag-' + f">{{ $t('team.promise.flags.' + f) }}</el-tag>
            </el-tooltip>
          </template>
          <span v-else class="sub">—</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fde } from '@/api/index.js'
import LoadError from '@/components/common/LoadError.vue'
import TeamWeekHeader from './TeamWeekHeader.vue'
import { promiseFlagsOf, PROMISE_FLAG_TONE, totalWeight } from './teamUtils.js'

const route = useRoute()
const rows = ref([])
const meta = ref({})
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await fde.team.promise(route.query.week || undefined)
    rows.value = (r.data || []).map(x => ({ ...x, objectives: x.objectives || [] }))
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
.team-promise { min-width: 0; }
.hint { margin: 0 0 12px; color: var(--text-secondary); font-size: 13px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; min-width: 0; }
.pad { padding: 14px; }
.grid { display: grid; grid-template-columns: minmax(110px, 1.1fr) repeat(3, minmax(0, 1fr)) minmax(150px, 1.2fr); gap: 12px; align-items: center; padding: 10px 16px; }
.head { font-size: 12px; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.row { border-top: 1px solid #f3f1ed; }
.head + .row { border-top: none; }
.name { color: var(--text); font-weight: 600; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name:hover { text-decoration: underline; }
.cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.num { font-size: 14px; color: var(--text); font-variant-numeric: tabular-nums; }
.sub { font-size: 12px; color: var(--text-muted); }
.m-label { display: none; }
.flags { display: flex; flex-wrap: wrap; gap: 4px; }
/* 手机: 一人两行 —— 第一行 名字 + 标记, 第二行 三个数并排 */
@media (max-width: 640px) {
  .head { display: none; }
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-areas: 'name name flag' 'said done actual'; gap: 8px 10px; padding: 12px; align-items: start; }
  .c-name { grid-area: name; }
  .c-flag { grid-area: flag; justify-content: flex-end; }
  .c-said { grid-area: said; }
  .c-done { grid-area: done; }
  .c-actual { grid-area: actual; }
  .m-label { display: block; font-size: 11px; color: var(--text-muted); }
  .num { font-size: 13px; }
}
</style>
