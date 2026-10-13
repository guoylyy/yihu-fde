<template>
  <!-- v2.8.0(#1144) 里程碑轨: 按 sortOrder 排, 显示状态/完成数/可开始数/阻塞数; 点选切换画布 -->
  <div class="rm-rail">
    <div class="rm-rail-item" :class="{ active: modelValue === '' }" @click="$emit('update:modelValue', '')">
      <div class="rm-rail-name">{{ $t('milestoneRail.all_milestones') }}</div>
      <div class="rm-rail-sub">{{ $t('milestoneRail.whole_project_on_one_map') }}</div>
    </div>
    <div v-for="m in visibleMilestones" :key="m.id" class="rm-rail-item" :class="[{ active: modelValue === String(m.id) }, `ms-${m.status}`]" @click="$emit('update:modelValue', String(m.id))">
      <div class="rm-rail-head">
        <span class="rm-rail-dot"></span>
        <span class="rm-rail-name" :title="m.goal || m.name">{{ m.name }}</span>
        <el-button v-if="canEdit" link size="small" class="rm-rail-edit" @click.stop="$emit('edit', m)">{{ $t('common.edit') }}</el-button>
      </div>
      <el-progress v-if="m.stats.total" :percentage="Math.round(m.stats.done / m.stats.total * 100)" :stroke-width="5" :show-text="false" :color="m.stats.done === m.stats.total ? '#2e7d4f' : '#d2521e'" style="margin: 4px 0;" />
      <div class="rm-rail-sub">
        <span>{{ m.stats.done }}/{{ m.stats.total }}</span>
        <span v-if="m.stats.ready" class="ok">{{ $t('milestoneRail.ready', { p0: m.stats.ready }) }}</span>
        <span v-if="m.stats.blocked" class="bad">{{ $t('milestoneRail.blocked', { p0: m.stats.blocked }) }}</span>
        <span v-if="m.plannedDate" class="date">{{ String(m.plannedDate).slice(5, 10) }}</span>
      </div>
    </div>
    <el-link v-if="completedCount" type="info" :underline="false" style="font-size: 12px; margin: 4px 0 0 8px;" @click="showCompleted = !showCompleted">
      {{ $t('common.p0', { p0: showCompleted ? $t('milestoneRail.hide_completed') : $t('milestoneRail.completed_milestones', { p0: completedCount }) }) }}
    </el-link>
    <div class="rm-rail-item orphan" :class="{ active: modelValue === 'none' }" @click="$emit('update:modelValue', 'none')">
      <div class="rm-rail-name">{{ $t('common.no_milestone') }}</div>
      <div class="rm-rail-sub">{{ orphanStats?.done || 0 }}/{{ orphanStats?.total || 0 }}<span v-if="orphanStats?.blocked" class="bad"> {{ $t('milestoneRail.blocked', { p0: orphanStats.blocked }) }}</span></div>
    </div>
    <el-button v-if="canEdit" size="small" plain style="margin: 6px 0 0 0; width: 100%;" @click="$emit('create')">{{ $t('milestoneRail.milestone') }}</el-button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
const props = defineProps({
  modelValue: { type: String, default: '' },      // '' 全部 / 'none' 未挂 / 里程碑 id
  milestones: { type: Array, default: () => [] },
  orphanStats: { type: Object, default: null },
  canEdit: { type: Boolean, default: false }
})
defineEmits(['update:modelValue', 'edit', 'create'])
const showCompleted = ref(false)
const completedCount = computed(() => props.milestones.filter(m => m.status === 'COMPLETED').length)
const visibleMilestones = computed(() => props.milestones.filter(m => showCompleted.value || m.status !== 'COMPLETED' || String(m.id) === props.modelValue))
</script>

<style scoped>
.rm-rail { display: flex; flex-direction: column; gap: 6px; }
.rm-rail-item { padding: 8px 10px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; background: #fff; transition: all .15s; }
.rm-rail-item:hover { border-color: #eae7e2; }
.rm-rail-item.active { background: #fff7ed; border-color: #f5c9b3; }
.rm-rail-head { display: flex; align-items: center; gap: 6px; }
.rm-rail-dot { width: 8px; height: 8px; border-radius: 50%; background: #c0c4cc; flex: none; }
.ms-IN_PROGRESS .rm-rail-dot { background: #d2521e; }
.ms-COMPLETED .rm-rail-dot { background: #2e7d4f; }
.ms-DELAYED .rm-rail-dot { background: #e24b4a; }
.rm-rail-name { font-size: 13px; font-weight: 600; color: #1c1917; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-COMPLETED .rm-rail-name { color: #78716c; font-weight: 500; }
.rm-rail-edit { opacity: 0; font-size: 11px; }
.rm-rail-item:hover .rm-rail-edit { opacity: 1; }
.rm-rail-sub { font-size: 11px; color: #78716c; display: flex; gap: 4px; flex-wrap: wrap; }
.rm-rail-sub .ok { color: #2e7d4f; }
.rm-rail-sub .bad { color: #b91c1c; }
.rm-rail-sub .date { margin-left: auto; }
.rm-rail-item.orphan { border-style: dashed; border-color: #eae7e2; }
</style>
