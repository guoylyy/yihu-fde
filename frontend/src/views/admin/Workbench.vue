<template>
  <!-- 0.5.0 我的今日: 一屏回答「我今天该干什么」。最上面「今天的总结」(精简第二轮), 下面四块各自取数, 一块失败不拖垮整页;
       手机上单列, 顶部压得很矮, 让「我的任务」「等我处理」在首屏内 -->
  <div class="today">
    <header class="today-head">
      <div class="who">
        <h2>{{ greeting }}<span v-if="userName">，{{ userName }}</span></h2>
        <span class="date">{{ todayText }}</span>
      </div>
      <router-link v-if="okrState" to="/admin/okr" class="okr-chip" :class="'okr-' + okrState" data-test="okr-chip">
        {{ $t('today.okr_week') }} · {{ $t('today.okr_state.' + okrState) }}
      </router-link>
    </header>

    <!-- 精简第二轮: 每日总结并进来, 放最上面(只有自己; 今日 KR 进展只读 + 一句话) -->
    <OkrTodaySummary v-if="okrOn" />

    <div class="grid">
      <!-- 区块 1: 我的任务 -->
      <section class="block" data-test="today-tasks">
        <div class="block-head">
          <h3>{{ $t('today.my_tasks') }}</h3>
          <router-link v-if="canTasks" to="/admin/tasks" class="more">{{ $t('today.all_tasks') }}</router-link>
        </div>
        <div v-if="tasksState.loading" class="skeleton"><el-skeleton :rows="3" animated /></div>
        <p v-else-if="tasksState.error" class="empty err">{{ tasksState.error }}</p>
        <p v-else-if="!todayTasks.length" class="empty">{{ $t('today.no_tasks') }}</p>
        <ul v-else class="rows">
          <li v-for="t in todayTasks" :key="t.id" class="row task-row" data-test="today-task" @click="openTask(t.id)">
            <div class="row-main">
              <span class="title">{{ t.title }}</span>
              <span class="sub">{{ t.project?.name || t.project?.code || '' }}</span>
            </div>
            <div class="row-meta">
              <span v-if="dueDay(t)" class="due" :class="'due-' + dueState(t, today)">
                {{ dueText(t) }}
              </span>
              <el-tag v-if="t.priority === 'HIGH' || t.priority === 'URGENT'" size="small" :type="t.priority === 'URGENT' ? 'danger' : 'warning'" effect="plain">
                {{ priorityLabel(t.priority) }}
              </el-tag>
              <span class="status">{{ statusLabel(t.status) }}</span>
            </div>
          </li>
        </ul>
      </section>

      <!-- 区块 2: 等我处理 -->
      <section class="block" data-test="today-approvals">
        <div class="block-head">
          <h3>{{ $t('today.waiting_on_me') }}<span v-if="approvals?.total" class="count">{{ approvals.total }}</span></h3>
        </div>
        <div v-if="approvalsState.loading" class="skeleton"><el-skeleton :rows="2" animated /></div>
        <p v-else-if="approvalsState.error" class="empty err">{{ approvalsState.error }}</p>
        <p v-else-if="!approvals?.total" class="empty">
          {{ approvals?.canApprove ? $t('today.no_approvals') : $t('today.no_approvals_role') }}
        </p>
        <template v-else>
          <div class="approval-counts">
            <router-link v-if="approvals.counts.tasksToVerify" to="/admin/tasks?status=DONE" class="pill">
              {{ $t('today.tasks_to_verify', { n: approvals.counts.tasksToVerify }) }}
            </router-link>
            <router-link v-if="approvals.counts.timesheets" to="/admin/timesheets?status=SUBMITTED" class="pill">
              {{ $t('today.timesheets_to_approve', { n: approvals.counts.timesheets }) }}
            </router-link>
          </div>
          <ul class="rows">
            <li v-for="a in approvals.recent" :key="a.kind + a.id" class="row" @click="$router.push(a.link)">
              <div class="row-main">
                <span class="title">{{ a.title }}</span>
                <span class="sub">{{ $t('today.approval_kind.' + a.kind) }}<template v-if="a.project"> · {{ a.project.name }}</template></span>
              </div>
            </li>
          </ul>
        </template>
      </section>

      <!-- 区块 3: 本周承诺(OKR 的 O, 只读) -->
      <section v-if="okrOn" class="block" data-test="today-okr">
        <div class="block-head">
          <h3>{{ $t('today.week_commitments') }}</h3>
          <router-link to="/admin/okr" class="more">{{ okrState === 'PENDING' || okrState === 'OVERDUE' ? $t('today.go_fill_okr') : $t('today.open_okr') }}</router-link>
        </div>
        <div v-if="okrStateLoad.loading" class="skeleton"><el-skeleton :rows="2" animated /></div>
        <p v-else-if="okrStateLoad.error" class="empty err">{{ okrStateLoad.error }}</p>
        <p v-else-if="!objectives.length" class="empty">{{ $t('today.no_okr') }}</p>
        <ul v-else class="rows">
          <li v-for="o in objectives" :key="o.id" class="row okr-row">
            <div class="row-main">
              <span class="title">{{ o.title }}</span>
              <el-progress :percentage="pct100(o.progress)" :stroke-width="5" color="#1c1917" class="okr-bar" />
            </div>
          </li>
        </ul>
      </section>

      <!-- 区块 4: 最近会话 -->
      <section class="block" data-test="today-conversations">
        <div class="block-head">
          <h3>{{ $t('today.recent_conversations') }}</h3>
          <router-link v-if="canConversations" to="/admin/conversations" class="more">{{ $t('today.all_conversations') }}</router-link>
        </div>
        <div v-if="convState.loading" class="skeleton"><el-skeleton :rows="2" animated /></div>
        <p v-else-if="convState.error" class="empty err">{{ convState.error }}</p>
        <p v-else-if="!conversations.length" class="empty">{{ $t('today.no_conversations') }}</p>
        <ul v-else class="rows">
          <li v-for="c in conversations" :key="c.id" class="row" data-test="today-conversation" @click="$router.push(`/admin/conversations/${c.id}`)">
            <div class="row-main">
              <span class="title">{{ firstSentence(c.summary) || c.title || $t('conversations.untitled') }}</span>
              <span class="sub">
                {{ $t('conversations.sources.' + c.source) }} · {{ $t('conversations.stages.' + c.stage) }} · {{ convTime(c) }}
              </span>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <!-- 底部快捷入口 -->
    <footer class="quick">
      <QuickActions :projects="projects" :actions="['task']" :user-id="me?.id" @done="loadTasks" />
      <el-button data-test="today-paste" @click="pasteVisible = true">{{ $t('today.log_conversation') }}</el-button>
      <el-button v-if="moduleEnabled('agent')" data-test="today-assistant" @click="openAssistant">
        <el-icon><MagicStick /></el-icon><span>{{ $t('today.open_assistant') }}</span>
      </el-button>
    </footer>

    <TaskDetailDialog v-model="taskDetailVisible" :task-id="taskDetailId" @changed="loadTasks" />
    <PasteConversationDialog v-model="pasteVisible" @saved="loadConversations" />
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { MagicStick } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { moduleEnabled } from '@/api/edition.js'
import { useAssistant } from '@/composables/useAssistant.js'
import TaskDetailDialog from '@/components/admin/TaskDetailDialog.vue'
import QuickActions from '@/components/admin/workbench/QuickActions.vue'
import PasteConversationDialog from '@/components/devlog/PasteConversationDialog.vue'
import OkrTodaySummary from '@/components/okr/OkrTodaySummary.vue'
import { pickTodayTasks, dueDay, dueState, okrSubmitState, pct100, firstSentence, ymd } from './today/todayUtils.js'
import { convTime } from './conversations/conversationUtils.js'

const me = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')
const userName = me?.name || me?.username || ''
const today = ymd()
const canTasks = can('task.view')
const canConversations = can('project.view')
const okrOn = moduleEnabled('okr')

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? $t('workbench.working_late') : h < 12 ? $t('workbench.good_morning') : h < 14 ? $t('workbench.good_afternoon') : h < 18 ? $t('workbench.good_afternoon_2') : $t('workbench.good_evening')
})
const todayText = (() => {
  const now = new Date()
  const week = [$t('common.sun'), $t('common.mon'), $t('common.tue'), $t('common.wed'), $t('common.thu'), $t('common.fri'), $t('common.sat')][now.getDay()]
  return $t('workbench.p2_p0_p1', { p0: now.getMonth() + 1, p1: now.getDate(), p2: week })
})()

const STATUS_LABELS = { TODO: $t('common.inbox'), QUEUED: $t('common.queued'), IN_PROGRESS: $t('common.in_progress_2'), DONE: $t('common.built'), VERIFIED: $t('common.accepted'), REWORK: $t('tasks.rework') }
const PRIORITY_LABELS = { LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high'), URGENT: $t('common.urgent') }
const statusLabel = (s) => STATUS_LABELS[s] || s
const priorityLabel = (p) => PRIORITY_LABELS[p] || p
function dueText(t) {
  const st = dueState(t, today)
  if (st === 'overdue') return $t('today.overdue_on', { d: dueDay(t).slice(5) })
  if (st === 'today') return $t('today.due_today')
  return dueDay(t).slice(5)
}

// 每块独立的加载/错误状态
const state = () => reactive({ loading: true, error: '' })
async function guarded(s, fn) {
  s.loading = true
  s.error = ''
  try { await fn() } catch (e) { s.error = $t('today.load_failed', { msg: e.message }) } finally { s.loading = false }
}

const tasks = ref([])
const tasksState = state()
const todayTasks = computed(() => pickTodayTasks(tasks.value, { today }))
const loadTasks = () => guarded(tasksState, async () => {
  if (!canTasks) { tasks.value = []; return }
  const d = await fde.tasks.list({ mine: 'true', page_size: 100 })
  tasks.value = d.list || []
})

const approvals = ref(null)
const approvalsState = state()
const loadApprovals = () => guarded(approvalsState, async () => { approvals.value = await fde.meApprovals(3) })

const okrWeek = ref(null)
const okrStateLoad = state()
const objectives = computed(() => (okrWeek.value?.objectives || []).filter(o => o.status !== 'DROPPED'))
const okrState = computed(() => okrSubmitState(okrWeek.value))
const loadOkr = () => guarded(okrStateLoad, async () => { if (okrOn) okrWeek.value = await fde.okr.my() })

const conversations = ref([])
const convState = state()
const loadConversations = () => guarded(convState, async () => {
  const d = await fde.devConversations.list({ engineerId: 'me', size: 3 })
  conversations.value = d.list || []
})

// 新建任务要选项目: 拿我能看到的在手项目(后端已按数据范围过滤)
const projects = ref([])
async function loadProjects() {
  if (!can('task.create') || !can('project.view')) return
  try { projects.value = (await fde.projects.list({ page_size: 100 })).list || [] } catch { /* 选不到项目时弹窗里会提示 */ }
}

const taskDetailVisible = ref(false)
const taskDetailId = ref(null)
function openTask(id) {
  taskDetailId.value = id
  taskDetailVisible.value = true
}

const pasteVisible = ref(false)
const { openPanel } = useAssistant()
function openAssistant() { openPanel() }

onMounted(() => {
  loadTasks()
  loadApprovals()
  loadOkr()
  loadConversations()
  loadProjects()
})
</script>

<style scoped>
.today { display: flex; flex-direction: column; gap: 14px; max-width: 1200px; }
.today-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.who { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.who h2 { margin: 0; font-size: 20px; font-weight: 600; color: #1c1917; }
.date { color: #8f8a82; font-size: 13px; }
.okr-chip { font-size: 12px; padding: 3px 10px; border-radius: 999px; border: 1px solid #eae7e2; color: #5c574f; text-decoration: none; background: #fff; white-space: nowrap; }
.okr-ON_TIME { color: #2e7d4f; border-color: #cfe5d8; background: #f3faf6; }
.okr-LATE { color: #b3450f; border-color: #f0d5c4; background: #fdf6f1; }
.okr-PENDING { color: #5c574f; }
.okr-OVERDUE { color: #c2362b; border-color: #f1cfcb; background: #fdf3f2; }

.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.block { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 12px 14px; min-width: 0; }
.block-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.block-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: #1c1917; display: flex; align-items: center; gap: 6px; }
.count { background: #1c1917; color: #fff; border-radius: 999px; font-size: 11px; padding: 0 7px; line-height: 18px; }
.more { font-size: 12px; color: #8f8a82; text-decoration: none; }
.more:hover { color: #1c1917; }
.empty { margin: 6px 0; color: #8f8a82; font-size: 13px; }
.empty.err { color: #c2362b; }
.skeleton { padding: 4px 0; }

.rows { list-style: none; margin: 0; padding: 0; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 4px; border-top: 1px solid #f3f1ee; cursor: pointer; }
.row:first-child { border-top: none; }
.row:hover { background: #faf9f7; }
.okr-row { cursor: default; }
.okr-row:hover { background: none; }
.row-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.title { font-size: 13px; color: #1c1917; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { font-size: 12px; color: #8f8a82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 12px; color: #5c574f; }
.due { font-variant-numeric: tabular-nums; }
.due-overdue { color: #c2362b; font-weight: 600; }
.due-today { color: #b3450f; font-weight: 600; }
.status { color: #8f8a82; }
.okr-bar { margin-top: 3px; }
.okr-bar :deep(.el-progress__text) { font-size: 11px !important; min-width: 34px; }
.approval-counts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.pill { font-size: 12px; padding: 2px 9px; border-radius: 999px; background: #f6f4f1; color: #1c1917; text-decoration: none; }

.quick { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.quick :deep(.quick-actions) { display: contents; }
.quick .el-button + .el-button { margin-left: 0; }

/* 手机: 单列, 头部压矮, 任务行的项目名收起到一行内 */
@media (max-width: 768px) {
  .today { gap: 10px; }
  .grid { grid-template-columns: 1fr; gap: 10px; }
  .who h2 { font-size: 17px; }
  .block { padding: 10px 12px; }
  .row { padding: 6px 2px; }
  .task-row .status { display: none; }
}
</style>
