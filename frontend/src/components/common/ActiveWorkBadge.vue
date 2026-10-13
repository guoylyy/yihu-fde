<template>
  <!-- v2.12.0(#1255) 任务「谁在做」徽标: 入参只有 activeWork, 派工/巡检共用一个组件。
       无 activeWork（null）→ 根节点 v-if 不渲染, 不留空白 -->
  <div v-if="view" :class="['aw-badge', 'is-' + view.key]" @click="timelineOpen = true">
    <span class="aw-icon">{{ view.icon }}</span>
    <span class="aw-text">
      <span class="aw-name" :title="nameTitle">{{ view.name }}</span>
      <template v-if="view.detail"><span class="aw-sep">·</span><span class="aw-detail">{{ view.detail }}</span></template>
    </span>
    <!-- 仅派工开发中: 确定性进度才显示进度条; 巡检绝不画 -->
    <div v-if="view.key === 'developing' && typeof w.progress === 'number'" class="aw-bar">
      <div class="aw-bar-fill" :style="{ width: w.progress + '%' }"></div>
    </div>
  </div>
  <!-- v2.12.0(#1261) 点击展开运行事件流, 组件自包含 -->
  <RunTimelineDrawer
    v-if="timelineOpen"
    v-model="timelineOpen"
    :task-id="taskId"
    :task-title="taskTitle"
  />
</template>

<script setup>
import { $t } from '@/i18n'
// 五态映射（严格按需求稿, 不自创状态）:
//  developing 派工开发中 / patrolling 巡检中 / stale 失联 / manual 人工 / queued 排队
import { computed, ref } from 'vue'
import RunTimelineDrawer from './RunTimelineDrawer.vue'

const props = defineProps({
  activeWork: { type: Object, default: null },
  // 点击展开时间线所需的任务标识
  taskId: { type: [String, Number], default: '' },
  taskTitle: { type: String, default: '' }
})
const timelineOpen = ref(false)
const w = computed(() => props.activeWork || null)

// 失联时长（分钟）, heartbeatAt 缺失也按失联处理
const staleMins = computed(() => {
  if (!w.value?.heartbeatAt) return null
  return Math.max(1, Math.round((Date.now() - new Date(w.value.heartbeatAt).getTime()) / 60000))
})

const view = computed(() => {
  const a = w.value
  if (!a) return null

  // agent 显示名: 优先 agentName, 兜底「机器人」
  const name = a.agentName || $t('common.robot')

  // 1) 失联优先级最高（无论派工/巡检, stale 都先报警示）
  if (a.stale) {
    return { key: 'stale', icon: '⚠️', name, detail: staleMins.value != null ? $t('common.lost_contact_for_min', { p0: staleMins.value }) : $t('activeWorkBadge.lost_contact') }
  }
  // 2) 派工·开发中: 带阶段与确定进度数字
  if (a.mode === 'DISPATCH' && a.status === 'DEVELOPING') {
    const parts = [a.phase, typeof a.progress === 'number' ? `${a.progress}%` : null].filter(Boolean)
    return { key: 'developing', icon: '🤖', name, detail: parts.join(' · ') }
  }
  // 3) 巡检·巡检中: 只有 agent 主动报 phase 才显示, 绝不编造进度
  if (a.mode === 'PATROL' && a.status === 'PATROLLING') {
    return { key: 'patrolling', icon: '🤖', name, detail: a.phase ? $t('activeWorkBadge.patrolling', { p0: a.phase }) : $t('common.patrolling') }
  }
  // 4) 进行中·人工
  if (a.status === 'MANUAL') {
    return { key: 'manual', icon: '⏳', name: $t('common.in_progress'), detail: $t('activeWorkBadge.manual') }
  }
  // 5) 排队中
  if (a.status === 'QUEUED') {
    return { key: 'queued', icon: '🔵', name: $t('common.queued_2'), detail: $t('activeWorkBadge.waiting_for_robot') }
  }
  // 其他未预期状态不渲染（保持诚实, 不乱标）
  return null
})

// 全名给原生 title 做 hover（CSS 截断配合）
const nameTitle = computed(() => {
  const a = w.value
  return [a?.agentName, a?.message].filter(Boolean).join(' · ')
})
</script>

<style scoped>
.aw-badge {
  display: inline-flex; align-items: center; gap: 6px;
  max-width: 100%;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px; line-height: 1.5;
  border: 1px solid transparent;
  vertical-align: middle;
  cursor: pointer;
}
.aw-badge:hover { filter: brightness(.97); }
.aw-icon { font-size: 12px; line-height: 1; flex: none; }
.aw-text {
  display: inline-flex; align-items: baseline;
  min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.aw-name { font-weight: 600; }
.aw-sep { margin: 0 4px; opacity: .6; }
.aw-detail { opacity: .85; font-weight: 400; }

/* 五态配色（与控制台 VI 米白基调协调） */
.is-developing { background: #eef4ff; color: #2b5cd9; border-color: #d4e2ff; }
.is-patrolling { background: #f3efff; color: #6d3fd1; border-color: #e2d8fb; }
.is-stale { background: #fdf0e6; color: #c2410c; border-color: #f7d4b8; }
.is-manual { background: #f1f0ed; color: #6b655c; border-color: #e3e0d9; }
.is-queued { background: #eef6fb; color: #2f72a8; border-color: #d4e8f5; }

/* 进度条: 贴底部的一条细线, 仅派工态 */
.aw-bar {
  position: absolute; left: 0; right: 0; bottom: -1px;
  height: 2px; border-radius: 0 0 999px 999px;
  background: rgba(43, 92, 217, 0.12); overflow: hidden;
}
.aw-bar-fill { height: 100%; background: currentColor; transition: width .3s; }
.aw-badge { position: relative; }

/* H5: 徽标可占整行不溢出, 不遮挡标题（由父容器控制布局, 自身只保证不撑破） */
@media (max-width: 767px) {
  .aw-badge { max-width: 100%; }
}
</style>
