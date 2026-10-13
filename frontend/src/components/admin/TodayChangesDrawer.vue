<template>
  <!-- v2.12.0(#1261) 总览条「今日变化」: 今天项目里谁做了什么 -->
  <el-drawer
    :model-value="modelValue"
    @update:model-value="v => emit('update:modelValue', v)"
    :title="$t('todayChangesDrawer.changes_today')"
    size="420px" direction="rtl"
  >
    <div v-if="summary.total" class="tc-wrap">
      <div class="tc-summary">
        <el-tag v-for="(n, action) in summary.byAction" :key="action" size="small" effect="plain" class="tc-tag">
          {{ action }} · {{ n }}
        </el-tag>
      </div>
      <el-timeline class="tc-list">
        <el-timeline-item v-for="(r, i) in list" :key="i" :timestamp="time(r.createdAt)" placement="top">
          <div class="tc-item">
            <el-tag size="small" :type="r.entity === 'project' ? 'warning' : 'primary'" effect="plain">
              {{ r.entity }}
            </el-tag>
            <span class="tc-summary-text">{{ r.summary }}</span>
          </div>
        </el-timeline-item>
      </el-timeline>
    </div>
    <el-empty v-else :description="$t('todayChangesDrawer.no_changes_today')" :image-size="80" />
  </el-drawer>
</template>

<script setup>
import { ref, watch } from 'vue'
import { fde } from '@/api/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  projectId: { type: [String, Number], required: true }
})
const emit = defineEmits(['update:modelValue'])

const list = ref([])
const summary = ref({ total: 0, byAction: {} })
async function load() {
  try {
    const r = await fde.activities.today(props.projectId)
    list.value = r.list || []
    summary.value = r.summary || { total: 0, byAction: {} }
  } catch { list.value = [] }
}
watch(() => [props.modelValue, props.projectId], v => { if (v[0]) load() })

function time(t) {
  const d = new Date(t)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
</script>

<style scoped>
.tc-summary { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.tc-item { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.tc-summary-text { font-size: 12px; color: #1c1917; line-height: 1.5; }
</style>
