<template>
  <!-- 0.5.0 团队 · 个人页: 一个人手上在干什么(任务)、这周说要干什么(OKR)、最近实际在聊什么(会话)。
       三块各自取数, 一块失败不拖垮整页:
         头部  GET /api/team/members(找这个 engineerId; 不在范围内就说清楚)
         任务  GET /api/fde/tasks?assigneeId=  只留未完成
         OKR   GET /api/okr/my?ownerId=<userId>(要 okr.view.all; userId 从 /api/fde/team/overview 换)
         会话  GET /api/dev/conversations?engineerId=&size=5 -->
  <div class="member-detail">
    <router-link to="/admin/team/members" class="back">← {{ $t('team.detail.back') }}</router-link>

    <section class="block head" data-test="member-head">
      <el-skeleton v-if="headState.loading" :rows="1" animated />
      <LoadError v-else-if="headState.error" :message="headState.error" @retry="loadHead" />
      <p v-else-if="!member" class="empty">{{ $t('team.detail.not_found') }}</p>
      <div v-else class="head-row">
        <el-avatar :size="44" class="avatar">{{ (member.name || '?').slice(0, 1) }}</el-avatar>
        <div class="who">
          <h2>{{ member.name }}</h2>
          <span class="sub">
            <el-tag size="small" type="info" effect="plain">{{ roleLabel(member.role) }}</el-tag>
            <span v-if="member.level" class="level">{{ member.level }}</span>
          </span>
        </div>
        <div class="head-load" :title="$t('team.load_formula', { n: threshold })">
          <span class="label">{{ $t('team.load') }}</span>
          <b :class="'band-' + loadBand(member.loadPct)">{{ member.loadPct }}%</b>
        </div>
      </div>
    </section>

    <div class="grid">
      <!-- 任务 -->
      <section class="block" data-test="member-tasks">
        <h3>{{ $t('team.detail.tasks') }}<span v-if="openTasks.length" class="count">{{ openTasks.length }}</span></h3>
        <el-skeleton v-if="tasksState.loading" :rows="3" animated />
        <LoadError v-else-if="tasksState.error" :message="tasksState.error" @retry="loadTasks" />
        <p v-else-if="!openTasks.length" class="empty" data-test="member-no-tasks">{{ $t('team.detail.no_tasks') }}</p>
        <ul v-else class="rows">
          <li v-for="t in openTasks" :key="t.id" class="row" @click="openTask(t.id)">
            <div class="row-main">
              <span class="title">{{ t.title }}</span>
              <span class="sub">{{ t.project?.name || t.project?.code || '' }}</span>
            </div>
            <div class="row-meta">
              <span class="status">{{ statusLabel(t.status) }}</span>
              <span class="due" :class="'due-' + dueState(t, today)">{{ dueDay(t) ? dueDay(t).slice(5) : $t('team.detail.no_due') }}</span>
            </div>
          </li>
        </ul>
      </section>

      <!-- 本周 OKR -->
      <section class="block" data-test="member-okr">
        <h3>{{ $t('team.detail.okr') }}</h3>
        <p v-if="!canOkr" class="empty">{{ $t('team.detail.okr_no_perm') }}</p>
        <el-skeleton v-else-if="okrState.loading" :rows="3" animated />
        <LoadError v-else-if="okrState.error" :message="okrState.error" @retry="loadOkr" />
        <p v-else-if="!objectives.length" class="empty">{{ $t('team.detail.no_okr') }}</p>
        <ul v-else class="rows">
          <li v-for="o in objectives" :key="o.id" class="row okr-row">
            <div class="row-main">
              <span class="title">{{ o.title }}</span>
              <span class="sub">
                <template v-if="o.weight != null">{{ $t('team.weight', { n: o.weight }) }} · </template>
                {{ $t('team.detail.kr_done', { done: krDone(o), total: (o.keyResults || []).length }) }}
              </span>
              <el-progress :percentage="pct100(o.progress)" :stroke-width="5" color="#1c1917" />
            </div>
          </li>
        </ul>
      </section>

      <!-- 最近会话 -->
      <section class="block" data-test="member-conversations">
        <h3>{{ $t('team.detail.conversations') }}</h3>
        <el-skeleton v-if="convState.loading" :rows="3" animated />
        <LoadError v-else-if="convState.error" :message="convState.error" @retry="loadConversations" />
        <p v-else-if="!conversations.length" class="empty">{{ $t('team.detail.no_conversations') }}</p>
        <ul v-else class="rows">
          <li v-for="c in conversations" :key="c.id" class="row" data-test="member-conversation" @click="$router.push(`/admin/conversations/${c.id}`)">
            <div class="row-main">
              <span class="title">{{ firstSentence(c.summary) || c.title || $t('conversations.untitled') }}</span>
              <span class="sub">{{ $t('conversations.sources.' + c.source) }} · {{ $t('conversations.stages.' + c.stage) }} · {{ convTime(c) }}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <TaskDetailDialog v-model="taskDetailVisible" :task-id="taskDetailId" @changed="loadTasks" />
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { roleLabel } from '@/api/roles.js'
import LoadError from '@/components/common/LoadError.vue'
import TaskDetailDialog from '@/components/admin/TaskDetailDialog.vue'
import { OPEN_STATUSES, dueDay, dueState, pct100, firstSentence, ymd } from '../today/todayUtils.js'
import { convTime } from '../conversations/conversationUtils.js'
import { loadBand, LOAD_THRESHOLD } from './teamUtils.js'

const route = useRoute()
const engineerId = computed(() => String(route.params.engineerId))
const today = ymd()
const canOkr = can('okr.view.all')

const STATUS_LABELS = { TODO: $t('common.inbox'), QUEUED: $t('common.queued'), IN_PROGRESS: $t('common.in_progress_2'), DONE: $t('common.built'), VERIFIED: $t('common.accepted'), REWORK: $t('tasks.rework') }
const statusLabel = (s) => STATUS_LABELS[s] || s

const state = () => reactive({ loading: true, error: '' })
async function guarded(s, fn) {
  s.loading = true
  s.error = ''
  try { await fn() } catch (e) { s.error = e.message } finally { s.loading = false }
}

const member = ref(null)
const threshold = ref(LOAD_THRESHOLD)
const headState = state()
const loadHead = () => guarded(headState, async () => {
  const r = await fde.team.members()
  member.value = (r.data || []).find(m => String(m.engineerId) === engineerId.value) || null
  threshold.value = r.meta?.threshold || LOAD_THRESHOLD
})

const tasks = ref([])
const tasksState = state()
const openTasks = computed(() => tasks.value.filter(t => OPEN_STATUSES.includes(t.status))
  .sort((a, b) => (dueDay(a) || '9999') < (dueDay(b) || '9999') ? -1 : 1))
const loadTasks = () => guarded(tasksState, async () => {
  const d = await fde.tasks.list({ assigneeId: engineerId.value, page_size: 100 })
  tasks.value = d.list || []
})

// OKR 按 userId 存, 团队接口只给 engineerId: 用 R3 的 overview 换一下(老板有 engineer.view)
const objectives = ref([])
const okrState = state()
const krDone = (o) => (o.keyResults || []).filter(k => k.status === 'DONE').length
const loadOkr = () => guarded(okrState, async () => {
  if (!canOkr) return
  const ov = await fde.team.overview()
  const row = (ov.list || []).find(r => String(r.engineerId) === engineerId.value)
  if (!row) { objectives.value = []; return }
  const w = await fde.okr.my({ ownerId: row.userId })
  objectives.value = (w.objectives || []).filter(o => o.status !== 'DROPPED' && o.submittedAt)
})

const conversations = ref([])
const convState = state()
const loadConversations = () => guarded(convState, async () => {
  const d = await fde.devConversations.list({ engineerId: engineerId.value, size: 5 })
  conversations.value = (d.list || []).slice(0, 5)
})

const taskDetailVisible = ref(false)
const taskDetailId = ref(null)
function openTask(id) { taskDetailId.value = id; taskDetailVisible.value = true }

function loadAll() { loadHead(); loadTasks(); loadOkr(); loadConversations() }
onMounted(loadAll)
watch(engineerId, loadAll)
</script>

<style scoped>
.member-detail { display: flex; flex-direction: column; gap: 14px; max-width: 1200px; min-width: 0; }
.back { font-size: 13px; color: var(--text-muted); text-decoration: none; }
.back:hover { color: var(--text); }
.block { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; min-width: 0; }
.block h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 6px; }
.count { background: var(--text); color: #fff; border-radius: 999px; font-size: 11px; padding: 0 7px; line-height: 18px; }
.head-row { display: flex; align-items: center; gap: 12px; }
.avatar { background: #f0eee9; color: var(--text); flex-shrink: 0; font-size: 18px; }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.who h2 { margin: 0; font-size: 18px; color: var(--text); }
.who .sub { display: flex; align-items: center; gap: 6px; }
.level { font-size: 12px; color: var(--text-secondary); font-family: var(--font-num); }
.head-load { display: flex; flex-direction: column; align-items: flex-end; }
.head-load b { font-size: 20px; font-variant-numeric: tabular-nums; }
.label { font-size: 11px; color: var(--text-muted); }
.band-OK { color: var(--success); }
.band-WARN { color: #b37d12; }
.band-OVER { color: var(--danger); }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }
.empty { margin: 6px 0; color: var(--text-muted); font-size: 13px; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid #f3f1ed; cursor: pointer; }
.row:first-child { border-top: none; }
.okr-row { cursor: default; }
.row-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.title { font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-row .title { white-space: normal; }
.sub { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; font-size: 12px; }
.status { color: var(--text-secondary); }
.due { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.due-overdue { color: var(--danger); font-weight: 600; }
.due-today, .due-soon { color: var(--warning); }
@media (max-width: 1100px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
