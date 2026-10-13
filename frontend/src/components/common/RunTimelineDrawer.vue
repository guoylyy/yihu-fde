<template>
  <!-- v2.12.0(#1261) 徽标点击展开的运行事件流。派工显示完整 phase 时间线,
       巡检只显示心跳点(无进度条, 诚实呈现)。 -->
  <el-drawer
    :model-value="modelValue"
    @update:model-value="v => emit('update:modelValue', v)"
    :title="$t('runTimelineDrawer.live_run', { p0: taskTitle })"
    size="420px" direction="rtl"
  >
    <div v-if="list.length" class="rt-timeline">
      <div v-for="(it, i) in list" :key="i" class="rt-item" :class="`is-${it.source.toLowerCase()}`">
        <div class="rt-dot">{{ it.source === 'DISPATCH' ? '⚙️' : '🔍' }}</div>
        <div class="rt-body">
          <div class="rt-meta">
            <span class="rt-time">{{ fmt(it.at) }}</span>
            <el-tag size="small" :type="it.source === 'DISPATCH' ? 'primary' : 'success'" effect="plain">
              {{ $t('common.p0', { p0: it.source === 'DISPATCH' ? $t('common.dispatch') : $t('common.patrol') }) }}
            </el-tag>
            <span v-if="it.phase" class="rt-phase">{{ it.phase }}</span>
            <span v-if="typeof it.progress === 'number'" class="rt-progress">{{ it.progress }}%</span>
          </div>
          <div v-if="it.message" class="rt-msg">{{ it.message }}</div>
        </div>
      </div>
    </div>
    <el-empty v-else :description="$t('runTimelineDrawer.no_runs_yet')" :image-size="80" />
  </el-drawer>
</template>

<script setup>
import { ref, watch } from 'vue'
import { fde } from '@/api/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  taskId: { type: [String, Number], required: true },
  taskTitle: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])

const list = ref([])
async function load() {
  try {
    const r = await fde.tasks.runTimeline(props.taskId)
    list.value = r.list || []
  } catch { list.value = [] }
}
watch(() => [props.modelValue, props.taskId], (v) => { if (v[0]) load() })

function fmt(t) {
  const d = new Date(t)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
</script>

<style scoped>
.rt-timeline { display: flex; flex-direction: column; gap: 12px; }
.rt-item { display: flex; gap: 10px; }
.rt-dot { font-size: 14px; line-height: 1.4; flex: none; }
.rt-body { flex: 1; min-width: 0; border-left: 2px solid #eee; padding-left: 10px; }
.rt-item.is-patrol .rt-body { border-color: #d8b4fe; }
.rt-item.is-dispatch .rt-body { border-color: #bfdbfe; }
.rt-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: #868580; }
.rt-time { font-variant-numeric: tabular-nums; }
.rt-phase { color: #6b655c; font-weight: 600; }
.rt-progress { color: #2b5cd9; font-weight: 600; }
.rt-msg { font-size: 12px; color: #1c1917; margin-top: 3px; line-height: 1.5; }
</style>
