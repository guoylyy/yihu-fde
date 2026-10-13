<template>
  <!-- v2.6.0(#959) 个人工作台 —— FDE 工程师 / 项目经理「一页把活干完」
       与公司级仪表盘(AdminDashboard)分工: 那边看公司, 这边办自己的事 -->
  <div class="workbench" v-loading="loading">
    <!-- ======== 今日焦点条 ======== -->
    <el-card shadow="never" class="focus-card">
      <div class="focus">
        <div class="who">
          <img v-if="user?.avatarUrl" :src="user.avatarUrl" class="avatar-img" />
          <div v-else class="avatar">{{ (d?.profile?.name || '?').slice(0, 1) }}</div>
          <div>
            <h2>{{ greeting }}, {{ d?.profile?.name }}</h2>
            <p class="muted">{{ roleLabel(d?.profile?.role) }} · {{ todayText }}</p>
          </div>
        </div>

        <div class="today-stats">
          <div class="stat" @click="scrollTo('tasks')">
            <div class="stat-label">{{ $t('workbench.due_today') }}</div>
            <div class="stat-value">{{ d?.today?.tasksDueToday || 0 }}<span class="unit">{{ $t('workbench.tasks') }}</span></div>
          </div>
          <div class="stat" :class="{ danger: (d?.today?.tasksOverdue || 0) > 0 }" @click="scrollTo('tasks')">
            <div class="stat-label">{{ $t('workbench.overdue') }}</div>
            <div class="stat-value">{{ d?.today?.tasksOverdue || 0 }}<span class="unit">{{ $t('workbench.tasks') }}</span></div>
          </div>
          <div class="stat" :class="{ warn: !d?.today?.hoursLogged }">
            <div class="stat-label">{{ $t('workbench.hours_today') }}</div>
            <div class="stat-value">
              {{ d?.today?.hoursLogged || 0 }}<span class="unit">h</span>
              <span v-if="!d?.today?.hoursLogged" class="dot-red" :title="$t('workbench.no_hours_logged_today')"></span>
            </div>
          </div>
          <div class="stat" @click="$router.push('/admin/notifications')">
            <div class="stat-label">{{ $t('workbench.unread_notifications') }}</div>
            <div class="stat-value">{{ d?.today?.unreadNotifications || 0 }}<span class="unit">{{ $t('workbench.text') }}</span></div>
          </div>
        </div>

        <button
          type="button"
          class="focus-toggle"
          :title="focusMode ? $t('workbench.exit_focus_mode_esc_also_works') : $t('workbench.focus_mode_hide_menu_top_bar')"
          @click="toggleFocus"
        >{{ $t('common.p0', { p0: focusMode ? $t('workbench.exit_focus') : $t('workbench.focus_mode') }) }}</button>
      </div>

      <div v-if="hasQuickAction" class="actions-row">
        <QuickActions
          :projects="d?.projects || []"
          :tasks="d?.tasks?.list || []"
          :user-id="d?.profile?.id"
          @done="load(true)"
        />
      </div>

      <el-alert
        v-if="d && !d.hasEngineerProfile"
        type="info"
        :closable="false"
        show-icon
        :title="$t('workbench.this_account_has_no_engineer_profile')"
        style="margin-top: 12px;"
      />
    </el-card>

    <!-- ======== 主体两栏 ======== -->
    <div class="cols">
      <div class="col-main">
        <TodoInbox
          :items="todos.items"
          :counts="todos.counts"
          :loading="todosLoading"
          @refresh="load(true)"
          @open-task="openTask"
        />

        <!-- 经理专属: 待我审批 + 组员脉搏(按权限显隐, 后端没给 approvals 就不渲染) -->
        <ApprovalPanel
          v-if="d?.approvals"
          :approvals="d.approvals"
          :team-pulse="d.teamPulse || []"
          @changed="load(true)"
        />

        <div ref="tasksAnchor"></div>
        <MyTasksPanel
          :tasks="d?.tasks?.list || []"
          @refresh="load(true)"
          @open-task="openTask"
        />
        <WeekSchedule
          :tasks="d?.tasks?.list || []"
          :milestones="d?.milestones || []"
          :hour-days="d?.hours?.days || []"
          @open-task="openTask"
        />

        <HoursStrip :hours="d?.hours || {}" @changed="load(true)" />
      </div>

      <div class="col-side">
        <!-- 我的项目 -->
        <el-card shadow="never" class="block-card">
          <template #header>
            <div class="block-title">
              <span>{{ $t('workbench.my_projects', { p0: d?.projects?.length || 0 }) }}</span>
              <span class="muted sub" v-if="d?.openIssueCount">{{ $t('workbench.open_issues', { p0: d.openIssueCount }) }}</span>
            </div>
          </template>
          <el-empty v-if="!d?.projects?.length" :image-size="50" :description="$t('workbench.not_in_any_project_yet')" />
          <div v-else class="proj-list">
            <div v-for="p in d.projects" :key="p.id" class="proj-item" @click="$router.push(`/admin/projects/${p.id}`)">
              <div class="proj-head">
                <strong>{{ p.name }}</strong>
                <span class="health" :style="{ color: healthColor(p.health) }">●</span>
              </div>
              <div class="proj-meta">
                <span class="code">{{ p.code }}</span>
                <span>{{ p.customer?.shortName || p.customer?.name }}</span>
              </div>
              <div v-if="p.overdueTasks || p.openIssues" class="proj-alert">
                <span v-if="p.overdueTasks" class="danger">{{ $t('workbench.overdue_tasks', { p0: p.overdueTasks }) }}</span>
                <span v-if="p.openIssues">{{ $t('workbench.open_issues', { p0: p.openIssues }) }}</span>
              </div>
              <div class="proj-progress">
                <el-progress :percentage="p.progress || 0" :stroke-width="5" :show-text="false" color="#1c1917" />
                <span class="pct">{{ p.progress || 0 }}%</span>
              </div>
            </div>
          </div>
        </el-card>

        <!-- 里程碑 -->
        <el-card shadow="never" class="block-card">
          <template #header>
            <div class="block-title"><span>{{ $t('workbench.upcoming_milestones') }}</span></div>
          </template>
          <el-empty v-if="!d?.milestones?.length" :image-size="50" :description="$t('workbench.no_milestones_due_in_next_30')" />
          <div v-else class="ms-list">
            <div v-for="ms in d.milestones" :key="ms.id" class="ms-row" @click="$router.push(`/admin/projects/${ms.project.id}`)">
              <span class="ms-date" :class="{ overdue: ms.overdue }">{{ String(ms.plannedDate || '').slice(0, 10) }}</span>
              <div class="ms-main">
                <div class="ms-name">{{ ms.name }}</div>
                <div class="ms-proj">{{ ms.project?.code }}</div>
              </div>
              <el-tag v-if="ms.overdue" type="danger" size="small">{{ $t('workbench.overdue') }}</el-tag>
            </div>
          </div>
        </el-card>

        <el-card v-if="leaderboard" shadow="never" class="block-card">
          <template #header>
            <div class="block-title">
              <span>{{ $t('workbench.this_weeks_leaderboard') }}</span>
              <span class="muted sub">{{ $t('workbench.since', { p0: leaderboard.weekStart }) }}</span>
            </div>
          </template>
          <div class="lb-block">
            <div class="lb-title">{{ $t('workbench.hours') }}</div>
            <div v-if="!leaderboard.hours.length" class="lb-empty">{{ $t('workbench.no_hours_this_week') }}</div>
            <div v-for="(r, i) in leaderboard.hours.slice(0, 5)" :key="'h' + i" class="lb-row" :class="{ me: isMe(r.userId) }">
              <span class="lb-rank">{{ medal(i) }}</span>
              <span class="lb-name">{{ r.name }}</span>
              <span class="lb-value">{{ r.hours }}h</span>
            </div>
          </div>
          <div class="lb-block">
            <div class="lb-title">{{ $t('workbench.tasks_done') }}</div>
            <div v-if="!leaderboard.tasks.length" class="lb-empty">{{ $t('workbench.no_tasks_done_this_week') }}</div>
            <div v-for="(r, i) in leaderboard.tasks.slice(0, 5)" :key="'t' + i" class="lb-row" :class="{ me: isMe(r.userId) }">
              <span class="lb-rank">{{ medal(i) }}</span>
              <span class="lb-name">{{ r.name }}</span>
              <span class="lb-value">{{ $t('workbench.p0', { p0: r.count }) }}</span>
            </div>
          </div>
        </el-card>

        <!-- 团队动态 -->
        <el-card shadow="never" class="block-card">
          <template #header>
            <div class="block-title">
              <span>{{ $t('workbench.team_activity') }}</span>
              <el-radio-group v-model="activityScope" size="small" style="margin-left: auto;" @change="loadActivities">
                <el-radio-button value="all">{{ $t('common.all') }}</el-radio-button>
                <el-radio-button value="mine">{{ $t('workbench.mine') }}</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <el-empty v-if="!activities.length" :image-size="50" :description="$t('common.no_activity')" />
          <div v-else class="act-list">
            <div v-for="a in activities" :key="a.id" class="act-row">
              <span class="act-time">{{ actTime(a.createdAt) }}</span>
              <span class="act-text"><strong>{{ $t('common.p0', { p0: a.actor?.name || $t('workbench.system') }) }}</strong> {{ a.summary }}</span>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <TaskDetailDialog v-model="taskDetailVisible" :task-id="taskDetailId" @changed="() => load(true)" />
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { roleLabel } from '@/api/roles.js'
import { can } from '@/api/permissions.js'
import TaskDetailDialog from '@/components/admin/TaskDetailDialog.vue'
import TodoInbox from '@/components/admin/workbench/TodoInbox.vue'
import MyTasksPanel from '@/components/admin/workbench/MyTasksPanel.vue'
import QuickActions from '@/components/admin/workbench/QuickActions.vue'
import WeekSchedule from '@/components/admin/workbench/WeekSchedule.vue'
import HoursStrip from '@/components/admin/workbench/HoursStrip.vue'
import ApprovalPanel from '@/components/admin/workbench/ApprovalPanel.vue'

const user = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')

const d = ref(null)
const todos = ref({ items: [], counts: {} })
const loading = ref(false)
const todosLoading = ref(false)
const activities = ref([])
const activityScope = ref('all')
const tasksAnchor = ref(null)

// 一个快捷动作都没有的角色不渲染这条, 免得留一条空横线
const hasQuickAction = computed(() =>
  ['timesheet.create', 'task.create', 'idea.create'].some(p => can(p)))

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? $t('workbench.working_late') : h < 12 ? $t('workbench.good_morning') : h < 14 ? $t('workbench.good_afternoon') : h < 18 ? $t('workbench.good_afternoon_2') : $t('workbench.good_evening')
})
const todayText = computed(() => {
  const now = new Date()
  const week = [$t('common.sun'), $t('common.mon'), $t('common.tue'), $t('common.wed'), $t('common.thu'), $t('common.fri'), $t('common.sat')][now.getDay()]
  return $t('workbench.p2_p0_p1', { p0: now.getMonth() + 1, p1: now.getDate(), p2: week })
})
function healthColor(h) { return { GREEN: '#2e7d4f', YELLOW: '#b3450f', RED: '#c2362b' }[h] || '#8f8a82' }

/** silent=true 时不整页 loading(操作后回刷用) */
async function load(silent = false) {
  if (!silent) loading.value = true
  todosLoading.value = true
  try {
    const [wb, td] = await Promise.all([fde.meWorkbench(), fde.meTodos()])
    d.value = wb
    todos.value = td
  } catch (e) {
    ElMessage.error($t('common.failed_load_2') + e.message)
  } finally {
    loading.value = false
    todosLoading.value = false
  }
}

// 本周排行榜(团队激励, 与个人仪表盘同口径)
const leaderboard = ref(null)
function isMe(userId) { return userId != null && String(userId) === String(user?.id) }
function medal(i) { return ['🥇', '🥈', '🥉'][i] || `${i + 1}.` }
async function loadLeaderboard() {
  try { leaderboard.value = await fde.meWeeklyLeaderboard() } catch { /* 排行榜失败不打断主流程 */ }
}

async function loadActivities() {
  try {
    const data = await fde.activities.list({ scope: activityScope.value, page: 1, page_size: 12 })
    activities.value = data.list
  } catch { /* 动态失败不打断主流程 */ }
}

function actTime(iso) {
  if (!iso) return ''
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return $t('common.min_ago_2', { p0: Math.max(m, 1) })
  if (m < 1440) return $t('common.hours_ago_2', { p0: Math.floor(m / 60) })
  return String(iso).slice(5, 16).replace('T', ' ')
}

// ---- 专注模式(v2.6.1 #962): 隐藏后台外壳 + 浏览器全屏, 一页只剩自己的活 ----
// 外壳隐藏靠 body.wb-focus(样式在本文件末尾的非 scoped 块), 离开页面必须摘掉, 否则别的页面也没菜单了
const focusMode = ref(false)

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement)
}
async function enterFullscreen() {
  const el = document.documentElement
  const fn = el.requestFullscreen || el.webkitRequestFullscreen
  // 全屏被浏览器策略拒绝也不影响专注模式本身(外壳照样隐藏)
  if (fn) await fn.call(el).catch(() => {})
}
async function exitFullscreen() {
  if (!isFullscreen()) return
  const fn = document.exitFullscreen || document.webkitExitFullscreen
  if (fn) await fn.call(document).catch(() => {})
}

function setFocus(on) {
  focusMode.value = on
  document.body.classList.toggle('wb-focus', on)
}
async function toggleFocus() {
  if (focusMode.value) {
    setFocus(false)
    await exitFullscreen()
  } else {
    setFocus(true)
    await enterFullscreen()
  }
}
// 用户按 Esc / F11 退出浏览器全屏时, 专注模式跟着退出, 别留个没菜单的页面
function onFullscreenChange() {
  if (!isFullscreen() && focusMode.value) setFocus(false)
}

const taskDetailVisible = ref(false)
const taskDetailId = ref(null)
function openTask(id) {
  taskDetailId.value = id
  taskDetailVisible.value = true
}
function scrollTo() {
  tasksAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 60s 轻刷新, 且只在页面可见时(v1.6.2 轮询失控教训: 后台标签页不要打接口)
let timer = null
function tick() {
  if (document.visibilityState === 'visible') load(true)
}
onMounted(() => {
  load()
  loadActivities()
  loadLeaderboard()
  timer = setInterval(tick, 60000)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  setFocus(false)
  exitFullscreen()
})
</script>

<style scoped>
.workbench { display: flex; flex-direction: column; gap: 16px; }

.focus-card { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; box-shadow: none; }
.focus-toggle {
  align-self: flex-start;
  white-space: nowrap;
  border: 1px solid #eae7e2;
  background: #fff;
  color: #8f8a82;
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  z-index: 2;
}
.focus-toggle:hover { border-color: #d2521e; color: #d2521e; }

.focus { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.who { display: flex; align-items: center; gap: 14px; }
.avatar, .avatar-img { width: 52px; height: 52px; border-radius: 50%; }
.avatar { background: #f0eee9; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; color: #1c1917; }
.avatar-img { object-fit: cover; }
.who h2 { margin: 0; font-size: 20px; color: #1c1917; }
.muted { color: #8f8a82; margin: 4px 0 0; font-size: 13px; }

.today-stats { display: flex; gap: 22px; flex-wrap: wrap; margin-left: auto; }
.stat { cursor: default; min-width: 92px; }
.stat-label { font-size: 12px; color: #8f8a82; margin-bottom: 4px; }
.stat-value { font-family: 'Manrope', 'Helvetica Neue', Arial, sans-serif; font-size: 24px; font-weight: 800; color: #1c1917; line-height: 1.1; }
.stat .unit { font-size: 12px; color: #8f8a82; font-weight: 400; margin-left: 3px; }
.stat.danger .stat-value { color: #c2362b; }
.stat.warn .stat-value { color: #b3450f; }
.dot-red { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #c2362b; margin-left: 6px; vertical-align: middle; }

.actions-row { margin-top: 16px; padding-top: 14px; border-top: 1px solid #f3f1ed; }

.cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
.col-main, .col-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.block-title .sub { font-size: 12px; margin-left: auto; }

.proj-list { display: flex; flex-direction: column; gap: 10px; }
.proj-item { padding: 10px; border: 1px solid #eae7e2; border-radius: 8px; cursor: pointer; transition: all .2s; }
.proj-item:hover { border-color: #d2521e; }
.proj-head { display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
.proj-meta { font-size: 12px; color: #8f8a82; display: flex; gap: 10px; margin-top: 2px; }
.proj-meta .code { font-family: monospace; }
.proj-progress { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.proj-progress :deep(.el-progress) { flex: 1; }
.pct { font-size: 12px; color: #5c574f; }

.proj-alert { display: flex; gap: 10px; font-size: 11px; color: #8f8a82; margin-top: 4px; }
.proj-alert .danger { color: #c2362b; }

.ms-list { display: flex; flex-direction: column; }
.ms-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f3f1ed; cursor: pointer; }
.ms-row:last-child { border-bottom: none; }
.ms-date { font-family: monospace; font-size: 12px; color: #5c574f; }
.ms-date.overdue { color: #c2362b; font-weight: 600; }
.ms-main { flex: 1; min-width: 0; }
.ms-name { font-size: 13px; color: #1c1917; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-proj { font-size: 11px; color: #8f8a82; font-family: monospace; }

.train-row { display: flex; gap: 18px; font-size: 13px; color: #5c574f; }
.danger { color: #c2362b; }

.lb-block { margin-bottom: 12px; }
.lb-title { font-size: 12px; color: #8f8a82; margin-bottom: 6px; }
.lb-empty { font-size: 12px; color: #a8a29a; }
.lb-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; }
.lb-row.me { background: #fdf6f2; border-radius: 4px; }
.lb-rank { width: 22px; color: #8f8a82; }
.lb-name { flex: 1; color: #1c1917; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-value { color: #5c574f; font-weight: 600; }

.act-list { display: flex; flex-direction: column; gap: 8px; }
.act-row { display: flex; gap: 8px; font-size: 12px; align-items: baseline; }
.act-time { color: #a8a29a; white-space: nowrap; }
.act-text { color: #5c574f; }

@media (max-width: 1200px) {
  .cols { grid-template-columns: minmax(0, 1fr); }
  .today-stats { margin-left: 0; }
}
</style>

<!-- 非 scoped: 专注模式要越过组件边界去收掉 AdminLayout 的外壳。
     只在 body.wb-focus 下生效, 该 class 仅由本页开关添加, 卸载时必定摘除 -->
<style>
body.wb-focus .sidebar { display: none; }
body.wb-focus .header { display: none; }
body.wb-focus .content-wrap { margin-left: 0; }
body.wb-focus .main { padding: 18px 24px 32px; }
/* 超宽屏别把一行拉到两米长, 专注的前提是视线不用横扫 */
body.wb-focus .workbench { max-width: 1680px; margin: 0 auto; }
</style>
