<template>
  <!-- v2.12.0(#1259) 项目主页总览条: 首屏一眼看清几个 Agent 在干活、
       多少可开工/逾期。数字点击下钻。 -->
  <div class="proj-overview">
    <div class="po-item" @click="$emit('drill', 'progress')">
      <div class="po-num">{{ project.progress || 0 }}%</div>
      <div class="po-label">{{ $t('common.project_progress') }}</div>
    </div>
    <div class="po-item" :class="{ alert: activeAgents > 0 }" @click="$emit('drill', 'agents')">
      <div class="po-num">{{ activeAgents }}</div>
      <div class="po-label">{{ $t('projectOverviewBar.agents_working') }}</div>
    </div>
    <div class="po-item" @click="$emit('drill', 'board')">
      <div class="po-num">{{ readyCount }}</div>
      <div class="po-label">{{ $t('projectOverviewBar.ready_start') }}</div>
    </div>
    <div class="po-item" :class="{ alert: overdueMs > 0 }" @click="$emit('drill', 'milestones')">
      <div class="po-num">{{ overdueMs }}</div>
      <div class="po-label">{{ $t('projectOverviewBar.overdue_milestones') }}</div>
    </div>
    <div class="po-item po-today" @click="todayOpen = true">
      <div class="po-num">📊</div>
      <div class="po-label">{{ $t('projectOverviewBar.changes_today') }}</div>
    </div>
  </div>
  <!-- v2.12.0(#1261) 今日变化 -->
  <TodayChangesDrawer v-if="todayOpen" v-model="todayOpen" :project-id="project.id" />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { fde } from '@/api/index.js'
import TodayChangesDrawer from './TodayChangesDrawer.vue'

const props = defineProps({
  project: { type: Object, required: true },
  // 15s 轮询信号(父组件定时递增即触发刷新)
  refreshTick: { type: Number, default: 0 }
})
defineEmits(['drill'])

// 拉当前项目的活跃 presence（#1253 接口, 含 taskId/patrol）
const agents = ref([])
const todayOpen = ref(false)
async function load() {
  try {
    const r = await fde.agentPresence.list({ projectId: props.project.id })
    agents.value = r.list || []
  } catch { agents.value = [] }
}
load()
watch(() => [props.project.id, props.refreshTick], load)

// 正在作业的 Agent（未失联即算, 含派工+巡检）
const activeAgents = computed(() => agents.value.filter(a => !a.stale).length)

// 可开工: 无 blockedBy 的 TODO/QUEUED（与 roadmap 口径一致）
const readyCount = computed(() =>
  (props.project.tasks || []).filter(t => !t.blockedBy?.length && ['TODO', 'QUEUED'].includes(t.status)).length
)

// 逾期里程碑数（计划日严格早于今天、未完成）
const overdueMs = computed(() => {
  const today = new Date(); today.setHours(0,0,0,0)
  return (props.project.milestones || []).filter(m => {
    if (m.status === 'COMPLETED' || !m.plannedDate) return false
    const d = new Date(m.plannedDate); d.setHours(0,0,0,0)
    return d < today
  }).length
})
</script>

<style scoped>
.proj-overview {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
  margin-bottom: 14px;
}
.po-item {
  background: #fff; border: 1px solid #eae7e2; border-radius: 10px;
  padding: 10px 8px; text-align: center; cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
}
.po-item:hover { border-color: #d2521e; box-shadow: 0 2px 8px rgba(210,82,30,.1); }
.po-num { font-size: 20px; font-weight: 700; color: #1c1917; font-variant-numeric: tabular-nums; }
.po-label { font-size: 11px; color: #868580; margin-top: 2px; }
.po-item.alert .po-num { color: #d2521e; }
@media (max-width: 767px) {
  .proj-overview { gap: 6px; }
  .po-item { padding: 7px 4px; }
  .po-num { font-size: 17px; }
  .po-label { font-size: 10px; }
}
</style>
