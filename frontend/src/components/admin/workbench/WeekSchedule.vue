<template>
  <!-- v2.6.0(#960) 本周日程: 当天到期任务与里程碑 + 当天工时 -->
  <el-card shadow="never" class="block-card">
    <template #header>
      <div class="block-title">
        <span>{{ $t('weekSchedule.this_week') }}</span>
        <span class="muted">{{ weekStartKey }} ~ {{ weekEndKey }}</span>
        <div class="nav">
          <el-button size="small" @click="shift(-7)">{{ $t('weekSchedule.last_week') }}</el-button>
          <el-button size="small" :disabled="offset === 0" @click="goThisWeek">{{ $t('common.this_week') }}</el-button>
          <el-button size="small" @click="shift(7)">{{ $t('weekSchedule.next_week') }}</el-button>
        </div>
      </div>
    </template>

    <div class="week">
      <div v-for="day in days" :key="day.date" class="day" :class="{ today: day.isToday, weekend: day.isWeekend }">
        <div class="day-head">
          <span class="dow">{{ day.dow }}</span>
          <span class="dd">{{ day.date.slice(5) }}</span>
        </div>

        <!-- 当天到期任务 / 里程碑 -->
        <div v-for="t in day.tasks" :key="'t' + t.id" class="mini task" :title="t.title" @click="$emit('open-task', String(t.id))">
          🗂 {{ t.title }}
        </div>
        <div v-for="m in day.milestones" :key="'m' + m.id" class="mini ms" :title="m.name">
          🚩 {{ m.name }}
        </div>

        <div v-if="day.hours" class="day-foot">
          <span class="hours">{{ day.hours }}h</span>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed } from 'vue'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  milestones: { type: Array, default: () => [] },
  hourDays: { type: Array, default: () => [] }      // 仅本周有值
})
defineEmits(['open-task'])

const DOW = [$t('common.mon'), $t('common.tue'), $t('common.wed'), $t('common.thu'), $t('common.fri'), $t('common.sat'), $t('common.sun')]

const offset = ref(0)        // 以周为单位的偏移, 0=本周

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const monday = computed(() => {
  const now = new Date()
  const m = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7) + offset.value)
  return m
})
const weekStartKey = computed(() => ymd(monday.value))
const weekEndKey = computed(() => {
  const d = new Date(monday.value)
  d.setDate(d.getDate() + 6)
  return ymd(d)
})
const todayKey = new Date().toLocaleDateString('sv')

const days = computed(() => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(monday.value)
  d.setDate(d.getDate() + i)
  const date = ymd(d)
  return {
    date,
    dow: DOW[i],
    isToday: date === todayKey,
    isWeekend: i >= 5,
    tasks: props.tasks.filter(t => t.dueDate && String(t.dueDate).slice(0, 10) === date),
    milestones: props.milestones.filter(m => m.plannedDate && String(m.plannedDate).slice(0, 10) === date),
    hours: props.hourDays.find(h => h.date === date)?.hours || 0
  }
}))

function shift(n) { offset.value += n }
function goThisWeek() { offset.value = 0 }
</script>

<style scoped>
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.muted { color: #8f8a82; font-size: 12px; font-weight: 400; }
.nav { margin-left: auto; display: flex; gap: 6px; align-items: center; }

.week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.day { border: 1px solid #eae7e2; border-radius: 8px; padding: 8px; min-height: 132px; display: flex; flex-direction: column; background: #fff; }
.day.weekend { background: #faf9f7; }
.day.today { border-color: #d2521e; box-shadow: 0 0 0 1px rgba(210, 82, 30, .15); }
.day-head { display: flex; justify-content: space-between; font-size: 12px; color: #5c574f; margin-bottom: 6px; }
.day-head .dd { color: #a8a29a; font-family: monospace; }

.mini { font-size: 11px; color: #5c574f; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.mini.ms { color: #b3450f; }

.day-foot { margin-top: auto; padding-top: 4px; }
.hours { font-size: 11px; color: #2e7d4f; font-weight: 600; }

@media (max-width: 900px) {
  .week { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
