<template>
  <!-- v2.8.0(#1144) 路径图任务节点: 编号/标题/负责人/子任务进度/阻塞角标; 左入右出两个把手 -->
  <div class="rm-node" :class="[`tone-${data.tone}`, { external: data.external, critical: data.critical, ghost: data.ghost, selected }]" :title="data.ghost ? $t('taskNode.ai_draft_not_saved') : data.external ? $t('taskNode.cross_milestone_prerequisite', { p0: data.milestoneName || $t('common.no_milestone') }) : data.title">
    <Handle v-if="!data.external && !data.ghost" type="target" :position="Position.Left" class="rm-handle" />
    <div class="rm-head">
      <span class="rm-no">{{ $t('common.p0', { p0: data.ghost ? $t('taskNode.draft') : '#' + data.id }) }}</span>
      <el-tag v-if="data.ghost" size="small" effect="plain" class="rm-tag rm-ghost-tag">{{ $t('taskNode.p0_p1', { p0: data.role, p1: data.estimateDays ? $t('taskNode.d', { p0: data.estimateDays }) : '' }) }}</el-tag>
      <el-tag v-else-if="data.external" size="small" effect="plain" type="info" class="rm-tag">{{ $t('common.p0', { p0: data.milestoneName || $t('common.no_milestone') }) }}</el-tag>
      <el-tag v-else size="small" :type="statusType" :effect="data.tone === 'active' ? 'dark' : 'plain'" class="rm-tag">{{ statusLabel }}</el-tag>
      <span v-if="data.priority === 'URGENT' || data.priority === 'HIGH'" class="rm-prio" :class="data.priority.toLowerCase()">{{ $t('common.p0', { p0: data.priority === 'URGENT' ? $t('common.urgent') : $t('common.high') }) }}</span>
    </div>
    <div class="rm-title">{{ data.title }}</div>
    <div v-if="data.ghost" class="rm-foot"><span class="muted">{{ $t('taskNode.ai_draft_saved_when_applied') }}</span></div>
    <div v-else class="rm-foot">
      <span class="rm-assignee">
        <el-avatar v-if="data.assignee" :size="16" :src="data.assignee.avatarUrl || undefined" style="background: #d2521e; font-size: 10px;">{{ data.assignee.name?.slice(0, 1) }}</el-avatar>
        <span v-if="data.assignee">{{ data.assignee.name }}</span>
        <span v-else class="muted">{{ $t('common.unassigned') }}</span>
      </span>
      <span v-if="data.subtaskStats?.total" class="rm-sub">✓ {{ data.subtaskStats.done }}/{{ data.subtaskStats.total }}</span>
      <span v-if="data.blocked" class="rm-blocked" :title="$t('taskNode.blocked_by') + data.blockedBy.map(x => '#' + x).join($t('common.list_sep')) + $t('taskNode.blocking')">{{ $t('taskNode.blocked', { p0: data.blockedBy.length }) }}</span>
      <span v-else-if="data.ready" class="rm-ready">{{ $t('common.ready') }}</span>
      <span v-if="data.dueDate" class="rm-due" :class="{ overdue: overdue }">{{ String(data.dueDate).slice(5, 10) }}</span>
    </div>
    <!-- v2.9.0(#1163) 机器人运行态: 排队/开发中(进度条+阶段)/完成/失败/失联 -->
    <div v-if="data.run && !data.external" class="rm-run" :class="[`run-${data.run.status.toLowerCase()}`, { stale: data.run.stale, patrol: data.run.patrol }]" :title="runTitle">
      <span class="rm-run-icon">{{ runIcon }}</span>
      <span class="rm-run-text">{{ runText }}</span>
      <!-- 巡检不显示百分比（诚实: 无真实进度不假报） -->
      <span v-if="data.run.status === 'RUNNING' && !data.run.patrol" class="rm-run-pct">{{ data.run.progress }}%</span>
      <div v-if="data.run.status === 'RUNNING' && !data.run.patrol" class="rm-run-bar"><i :style="{ width: data.run.progress + '%' }"></i></div>
    </div>
    <Handle v-if="!data.external && !data.ghost" type="source" :position="Position.Right" class="rm-handle" />
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { STATUS_LABELS, STATUS_TYPES, isDone } from './roadmapUtils.js'

const props = defineProps({ data: { type: Object, required: true }, selected: { type: Boolean, default: false } })
const statusLabel = computed(() => STATUS_LABELS[props.data.status] || props.data.status)
const statusType = computed(() => STATUS_TYPES[props.data.status] || 'info')
const overdue = computed(() => props.data.dueDate && !isDone(props.data.status) && new Date(props.data.dueDate) < new Date())
const runIcon = computed(() => { const r = props.data.run; if (!r) return ''; if (r.patrol) return '🔍'; if (r.stale) return '📡'; return { PENDING: '⏳', RUNNING: '🤖', SUCCEEDED: '🤖✅', FAILED: '🤖❌', CANCELLED: '⏹' }[r.status] || '🤖' })
const runText = computed(() => { const r = props.data.run; if (!r) return ''; if (r.patrol) return $t('taskNode.patrolling', { p0: r.agentName || $t('common.robot'), p1: r.phase && r.phase !== '巡检中' ? ' · ' + r.phase : '' }); if (r.status === 'PENDING') return $t('taskNode.waiting_for_robot'); if (r.status === 'RUNNING') return `${r.agentName || $t('common.robot')}${r.stale ? $t('taskNode.lost_contact') : ''} · ${r.phase || $t('common.developing')}`; if (r.status === 'SUCCEEDED') return $t('taskNode.done', { p0: r.agentName || $t('common.robot') }); if (r.status === 'FAILED') return $t('taskNode.failed', { p0: r.agentName || $t('common.robot') }); return $t('taskNode.run_cancelled') })
const runTitle = computed(() => { const r = props.data.run; return r ? `${runText.value}${r.message ? ': ' + r.message : ''}` : '' })
</script>

<style scoped>
.rm-node { width: 220px; min-height: 78px; box-sizing: border-box; background: #fff; border: 1.5px solid #d6d3d1; border-radius: 10px; padding: 8px 10px; font-size: 12px; color: #1c1917; box-shadow: 0 1px 2px rgba(0,0,0,.04); transition: box-shadow .15s, border-color .15s; }
.rm-node:hover { box-shadow: 0 4px 14px rgba(28,25,23,.12); }
.rm-node.selected { box-shadow: 0 0 0 3px rgba(210,82,30,.25); }
.rm-node.tone-done { background: #f0f9f1; border-color: #7bc496; }
.rm-node.tone-active { background: #fff7ed; border-color: #d2521e; }
.rm-node.tone-blocked { border-color: #e24b4a; border-width: 2px; }
.rm-node.tone-ready { border-color: #a8a29e; }
.rm-node.tone-idle { border-style: dashed; color: #57534e; }
.rm-node.external { background: #fafaf9; border-style: dashed; opacity: .85; }
.rm-node.critical { outline: 2px solid #f59e0b; outline-offset: 2px; }
.rm-node.ghost { background: #faf5ff; border: 1.5px dashed #a78bfa; color: #4c1d95; }
.rm-ghost-tag { border-color: #c4b5fd; color: #6d28d9; background: #f5f3ff; }
.rm-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.rm-no { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #78716c; font-size: 11px; }
.rm-tag { height: 18px; line-height: 16px; padding: 0 5px; font-size: 10px; }
.rm-prio { margin-left: auto; font-size: 10px; padding: 0 5px; border-radius: 4px; background: #fee2e2; color: #991b1b; }
.rm-prio.high { background: #fef3c7; color: #92400e; }
.rm-title { font-weight: 600; font-size: 13px; line-height: 1.35; max-height: 36px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.rm-foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; color: #78716c; font-size: 11px; }
.rm-assignee { display: inline-flex; align-items: center; gap: 4px; }
.muted { color: #c0c4cc; }
.rm-blocked { color: #b91c1c; font-weight: 600; margin-left: auto; }
.rm-ready { color: #2e7d4f; font-weight: 600; margin-left: auto; }
.rm-due { color: #57534e; }
.rm-due.overdue { color: #c2362b; font-weight: 600; }
.rm-handle { width: 10px; height: 10px; background: #d2521e; border: 2px solid #fff; }
/* v2.9.0(#1163) 机器人运行态 */
.rm-run { position: relative; margin: 6px -4px -2px; padding: 3px 6px 5px; border-radius: 6px; font-size: 11px; display: flex; align-items: center; gap: 4px; background: #f5f5f4; color: #57534e; }
.rm-run.run-running { background: #eff6ff; color: #1d4ed8; }
.rm-run.run-succeeded { background: #f0fdf4; color: #166534; }
.rm-run.run-failed { background: #fef2f2; color: #991b1b; }
.rm-run.stale { background: #f5f5f4; color: #78716c; }
.rm-run-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rm-run-pct { font-weight: 600; font-variant-numeric: tabular-nums; }
.rm-run-bar { position: absolute; left: 6px; right: 6px; bottom: 1px; height: 3px; background: #dbeafe; border-radius: 2px; overflow: hidden; }
.rm-run-bar i { display: block; height: 100%; background: #2563eb; transition: width .4s; }
.rm-run.stale .rm-run-bar i { background: #a8a29e; }
.rm-node.tone-active .rm-run.run-running { background: #fff; }
/* v2.12.0(#1258) 巡检态: 紫色, 与派工蓝区分 */
.rm-run.run-running.patrol { background: #f5f3ff; color: #6d28d9; }
</style>
