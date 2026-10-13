<template>
  <!-- v2.9.0(#1163) 机器人抽屉: 本项目派工单(暂停/继续/取消) + 机器人在线态 -->
  <el-drawer :model-value="modelValue" :title="$t('robotsDrawer.robots_dispatches')" size="520px" append-to-body @update:model-value="v => $emit('update:modelValue', v)" @open="load">
    <div class="rb-head">
      <el-checkbox v-model="includeDone" size="small" @change="load">{{ $t('robotsDrawer.show_finished') }}</el-checkbox>
      <el-button size="small" :icon="Refresh" :loading="loading" @click="load">{{ $t('common.refresh') }}</el-button>
      <el-button size="small" type="primary" plain @click="$emit('dispatch')">{{ $t('robotsDrawer.new_dispatch') }}</el-button>
    </div>

    <div class="rb-sec-title">{{ $t('robotsDrawer.dispatches', { p0: dispatches.length }) }}</div>
    <el-empty v-if="!dispatches.length && !loading" :description="$t('robotsDrawer.no_dispatches_yet_click_dispatch_on')" :image-size="60" />
    <div v-for="d in dispatches" :key="d.id" class="rb-card" :class="`st-${d.status.toLowerCase()}`">
      <div class="rb-card-head">
        <b class="rb-card-title">{{ d.title }}</b>
        <el-tag size="small" :type="{ RUNNING: 'primary', PAUSED: 'warning', DONE: 'success', CANCELLED: 'info' }[d.status]" effect="plain">{{ DISPATCH_STATUS_LABELS[d.status] || d.status }}</el-tag>
      </div>
      <div class="rb-card-sub">
        {{ $t('robotsDrawer.finished_succeeded', { p0: d.done, p1: d.total, p2: d.counts.SUCCEEDED || 0 }) }}<template v-if="d.counts.FAILED"> · <span class="bad">{{ $t('robotsDrawer.failed', { p0: d.counts.FAILED }) }}</span></template><template v-if="d.counts.RUNNING"> · <span class="ok">{{ $t('robotsDrawer.running', { p0: d.counts.RUNNING }) }}</span></template><template v-if="d.counts.PENDING"> {{ $t('robotsDrawer.queued', { p0: d.counts.PENDING }) }}</template>
        <span class="rb-card-time">{{ fmt(d.startedAt) }}</span>
      </div>
      <el-progress :percentage="d.total ? Math.round(((d.counts.SUCCEEDED || 0) / d.total) * 100) : 0" :stroke-width="6" :show-text="false" :color="d.counts.FAILED ? '#e6a23c' : '#2563eb'" style="margin: 6px 0;" />
      <div v-if="d.note" class="rb-note">{{ $t('robotsDrawer.notes', { p0: d.note }) }}</div>
      <div class="rb-actions">
        <el-button v-if="d.status === 'RUNNING'" size="small" @click="act(d, 'pause')">{{ $t('common.pause') }}</el-button>
        <el-button v-if="d.status === 'PAUSED'" size="small" type="primary" plain @click="act(d, 'resume')">{{ $t('robotsDrawer.resume') }}</el-button>
        <el-button v-if="['RUNNING', 'PAUSED'].includes(d.status)" size="small" type="danger" plain @click="act(d, 'cancel')">{{ $t('common.cancel') }}</el-button>
        <el-button size="small" link type="primary" @click="toggleDetail(d)">{{ $t('common.p0', { p0: expanded === d.id ? $t('common.collapse') : $t('robotsDrawer.run_details') }) }}</el-button>
      </div>
      <div v-if="expanded === d.id && detail" class="rb-runs">
        <div v-for="r in detail.runs" :key="r.id" class="rb-run" :class="`run-${r.status.toLowerCase()}`">
          <span class="rb-run-seq">{{ r.seq + 1 }}</span>
          <el-link :underline="false" class="rb-run-title" @click="$emit('open-task', r.taskId)">#{{ r.taskId }} {{ r.task?.title }}</el-link>
          <el-tag size="small" :type="RUN_STATUS_TYPES[r.status]" effect="plain">{{ RUN_STATUS_LABELS[r.status] }}{{ r.status === 'RUNNING' ? ` ${r.progress}%` : '' }}</el-tag>
          <span v-if="r.agentName" class="rb-run-agent">{{ r.agentName }}</span>
          <el-button v-if="['FAILED', 'CANCELLED'].includes(r.status) && !isDone(r.task?.status)" size="small" link type="primary" @click="redispatch(r)">{{ $t('common.redispatch') }}</el-button>
          <el-button v-if="['PENDING', 'RUNNING'].includes(r.status)" size="small" link type="danger" @click="cancelRun(r)">{{ $t('common.cancel') }}</el-button>
        </div>
      </div>
    </div>

    <div class="rb-sec-title" style="margin-top: 18px;">{{ $t('robotsDrawer.robots_online', { p0: robots.filter(r => r.online).length, p1: robots.length }) }}</div>
    <el-empty v-if="!robots.length && !loading" :description="$t('robotsDrawer.no_robots_registered_yet')" :image-size="60">
      <router-link to="/admin/agents"><el-button size="small">{{ $t('robotsDrawer.register_on_agents_page') }}</el-button></router-link>
    </el-empty>
    <div v-for="r in robots" :key="r.id" class="rb-robot">
      <span :class="['dp-dot', r.online ? 'on' : 'off']"></span>
      <b>{{ r.name }}</b>
      <span class="rb-robot-sub">{{ $t('common.p0', { p0: r.online ? (r.current ? $t('robotsDrawer.working_on', { p0: r.current.taskId, p1: r.current.phase || '', p2: r.current.progress }) : (r.activity || $t('common.online_idle'))) : $t('robotsDrawer.offline', { p0: r.lastBeatAt ? $t('robotsDrawer.last_heartbeat') + fmt(r.lastBeatAt) : '' }) }) }}</span>
    </div>
    <p class="rb-tip">{{ $t('robotsDrawer.robots_agent_profiles_on_agents_page') }}</p>
  </el-drawer>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { DISPATCH_STATUS_LABELS, RUN_STATUS_LABELS, RUN_STATUS_TYPES, isDone } from './roadmapUtils.js'

const props = defineProps({ modelValue: { type: Boolean, default: false }, projectId: { type: [Number, String], required: true } })
const emit = defineEmits(['update:modelValue', 'dispatch', 'changed', 'open-task'])
const dispatches = ref([]), robots = ref([]), loading = ref(false), includeDone = ref(false)
const expanded = ref(''), detail = ref(null)
function fmt(s) { if (!s) return ''; const d = new Date(s); const p = n => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` }
async function load() {
  loading.value = true
  try {
    const [d, r] = await Promise.all([fde.devDispatches.list({ projectId: props.projectId, includeDone: includeDone.value ? 'true' : 'false' }), fde.devDispatches.robots()])
    dispatches.value = d.list || []; robots.value = r.list || []
    if (expanded.value) detail.value = await fde.devDispatches.get(expanded.value)
  } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}
async function act(d, action) {
  if (action === 'cancel') { try { await ElMessageBox.confirm($t('robotsDrawer.cancel_dispatch_queued_runs_dropped_running', { p0: d.title }), $t('robotsDrawer.cancel_dispatch'), { type: 'warning' }) } catch { return } }
  try { await fde.devDispatches[action](d.id); ElMessage.success({ pause: $t('common.paused'), resume: $t('robotsDrawer.resumed'), cancel: $t('common.cancelled') }[action]); await load(); emit('changed') }
  catch (e) { ElMessage.error(e.message) }
}
async function toggleDetail(d) {
  if (expanded.value === d.id) { expanded.value = ''; detail.value = null; return }
  expanded.value = d.id
  try { detail.value = await fde.devDispatches.get(d.id) } catch (e) { ElMessage.error(e.message) }
}
async function redispatch(r) { try { await fde.devDispatches.redispatchRun(r.id); ElMessage.success($t('common.requeued')); await load(); emit('changed') } catch (e) { ElMessage.error(e.message) } }
async function cancelRun(r) { try { await fde.devDispatches.cancelRun(r.id); ElMessage.success($t('robotsDrawer.run_cancelled')); await load(); emit('changed') } catch (e) { ElMessage.error(e.message) } }
defineExpose({ load })
</script>

<style scoped>
.rb-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.rb-head .el-button + .el-button { margin-left: 0; }
.rb-sec-title { font-size: 12px; color: #a8a29e; margin: 6px 0; text-transform: uppercase; letter-spacing: .02em; }
.rb-card { border: 1px solid #eae7e2; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: #fff; }
.rb-card.st-running { border-color: #bfdbfe; }
.rb-card.st-paused { border-color: #fde68a; }
.rb-card-head { display: flex; align-items: center; gap: 8px; }
.rb-card-title { flex: 1; font-size: 13px; color: #1c1917; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rb-card-sub { font-size: 12px; color: #78716c; display: flex; gap: 2px; flex-wrap: wrap; }
.rb-card-time { margin-left: auto; color: #a8a29e; }
.rb-note { font-size: 12px; color: #57534e; background: #fafaf9; border-radius: 6px; padding: 4px 8px; margin: 4px 0; white-space: pre-wrap; }
.rb-actions { display: flex; gap: 6px; align-items: center; }
.rb-actions .el-button + .el-button { margin-left: 0; }
.rb-runs { border-top: 1px dashed #eae7e2; margin-top: 8px; padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.rb-run { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.rb-run-seq { width: 18px; height: 18px; border-radius: 50%; background: #f5f5f4; color: #78716c; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
.rb-run-title { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; justify-content: flex-start; }
.rb-run-agent { color: #a8a29e; }
.rb-robot { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #f5f5f4; font-size: 13px; }
.rb-robot-sub { color: #78716c; font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rb-tip { font-size: 12px; color: #a8a29e; line-height: 1.6; margin-top: 12px; }
.dp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #c0c4cc; }
.dp-dot.on { background: #22c55e; }
.ok { color: #1d4ed8; } .bad { color: #b91c1c; }
</style>
