<template>
  <!-- v2.6.0(#960) 经理块: 待我审批 + 我的组员。按权限显隐, 工程师看不到 -->
  <el-card shadow="never" class="block-card">
    <template #header>
      <div class="block-title">
        <span>{{ $t('approvalPanel.waiting_for_my_approval') }}</span>
        <el-tag v-if="total" type="warning" size="small" effect="dark" style="margin-left: 6px;">{{ total }}</el-tag>
      </div>
    </template>

    <div class="stat-row">
      <button v-for="c in cards" :key="c.key" type="button" class="stat" :class="{ zero: !c.value }"
        @click="c.expand ? toggle() : $router.push(c.link)">
        <div class="s-label">{{ c.label }}</div>
        <div class="s-value">{{ c.value }}</div>
      </button>
    </div>

    <!-- 工时批量审批 -->
    <div v-if="expanded" class="pending" v-loading="loading">
      <div class="pending-head">
        <el-checkbox v-model="allChecked" @change="toggleAll">{{ $t('common.select_all') }}</el-checkbox>
        <span class="muted">{{ $t('approvalPanel.selected', { p0: checked.length, p1: pending.length }) }}</span>
        <el-button type="primary" size="small" :disabled="!checked.length" :loading="approving" @click="approve(checked)">
          {{ $t('approvalPanel.approve_selected', { p0: checked.length || '' }) }}
        </el-button>
        <el-button size="small" :disabled="!pending.length" :loading="approving" @click="approve(pending.map(t => String(t.id)))">
          {{ $t('approvalPanel.approve_all') }}
        </el-button>
        <el-button link size="small" @click="expanded = false">{{ $t('common.collapse') }}</el-button>
      </div>
      <el-empty v-if="!pending.length" :image-size="50" :description="$t('approvalPanel.no_hours_waiting_for_approval')" />
      <div v-else class="pending-list">
        <div v-for="t in pending" :key="t.id" class="pending-row">
          <el-checkbox :model-value="checked.includes(String(t.id))" @change="toggleOne(String(t.id))" />
          <span class="who">{{ t.engineer?.user?.name || '—' }}</span>
          <span class="date">{{ String(t.workDate).slice(0, 10) }}</span>
          <span class="proj">{{ t.project?.name }}</span>
          <span class="content" :title="t.workContent">{{ t.workContent }}</span>
          <strong class="hours">{{ Number(t.hours) }}h</strong>
        </div>
      </div>
    </div>

    <!-- 我的组员 -->
    <div v-if="teamPulse?.length" class="team">
      <div class="team-head">{{ $t('approvalPanel.my_team_this_week') }}</div>
      <div class="team-list">
        <div v-for="m in teamPulse" :key="m.engineerId" class="team-row" :class="{ idle: m.idle }">
          <span class="t-name">{{ m.name }}</span>
          <span class="t-hours">{{ m.hours }}h</span>
          <span class="t-done">{{ $t('approvalPanel.done', { p0: m.doneTasks }) }}</span>
          <el-tag v-if="m.idle" size="small" type="warning" effect="plain">{{ $t('approvalPanel.no_hours_this_week') }}</el-tag>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde } from '@/api/index.js'

const props = defineProps({
  approvals: { type: Object, default: () => ({}) },
  teamPulse: { type: Array, default: () => [] }
})
const emit = defineEmits(['changed'])

const a = computed(() => props.approvals || {})
const total = computed(() => ['timesheets', 'tasksToVerify']
  .reduce((s, k) => s + (a.value[k] || 0), 0))

const cards = computed(() => [
  { key: 'timesheets', label: $t('common.hours'), value: a.value.timesheets || 0, expand: true, link: '/admin/timesheets?status=SUBMITTED' },
  { key: 'tasksToVerify', label: $t('approvalPanel.tasks_accept'), value: a.value.tasksToVerify || 0, link: '/admin/tasks' }
].filter(c => a.value[c.key] != null))

const expanded = ref(false)
const loading = ref(false)
const approving = ref(false)
const pending = ref([])
const checked = ref([])
const allChecked = ref(false)

async function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) await loadPending()
}
async function loadPending() {
  loading.value = true
  try {
    const data = await fde.timesheets.pending({ page: 1, page_size: 50 })
    pending.value = (data.list || []).filter(t => t.status === 'SUBMITTED')
    checked.value = []
    allChecked.value = false
  } catch (e) {
    ElMessage.error(e.message || $t('approvalPanel.failed_load_pending_hours'))
  } finally {
    loading.value = false
  }
}
function toggleAll(v) { checked.value = v ? pending.value.map(t => String(t.id)) : [] }
function toggleOne(id) {
  const i = checked.value.indexOf(id)
  if (i >= 0) checked.value.splice(i, 1)
  else checked.value.push(id)
  allChecked.value = checked.value.length === pending.value.length && pending.value.length > 0
}

async function approve(idList) {
  const ids = [...idList]
  if (!ids.length) return
  const hours = pending.value.filter(t => ids.includes(String(t.id))).reduce((s, t) => s + Number(t.hours || 0), 0)
  try {
    await ElMessageBox.confirm($t('approvalPanel.approve_entries_h_total', { p0: ids.length, p1: Math.round(hours * 10) / 10 }), $t('approvalPanel.approve_selected_2'), { type: 'warning' })
    approving.value = true
    // 并发 5 条一批, 免得一次打太多请求
    let ok = 0, fail = 0
    for (let i = 0; i < ids.length; i += 5) {
      const batch = ids.slice(i, i + 5)
      const rs = await Promise.allSettled(batch.map(id => fde.timesheets.approve(id, true)))
      ok += rs.filter(r => r.status === 'fulfilled').length
      fail += rs.filter(r => r.status === 'rejected').length
    }
    ElMessage[fail ? 'warning' : 'success']($t('approvalPanel.approved', { p0: ok, p1: fail ? $t('common.failed', { p0: fail }) : '' }))
    await loadPending()
    emit('changed')
  } catch (e) {
    if (e !== 'cancel') ElMessage.error(e.message || $t('approvalPanel.bulk_approval_failed'))
  } finally {
    approving.value = false
  }
}
</script>

<style scoped>
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.muted { color: #8f8a82; font-size: 12px; }

.stat-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.stat { border: 1px solid #eae7e2; border-radius: 8px; padding: 10px; text-align: center; cursor: pointer; background: #fff; font: inherit; }
.stat:hover { border-color: #d2521e; }
.stat.zero { opacity: .55; }
.s-label { font-size: 12px; color: #8f8a82; }
.s-value { font-family: 'Manrope', Arial, sans-serif; font-size: 22px; font-weight: 800; color: #b3450f; line-height: 1.2; }
.stat.zero .s-value { color: #a8a29a; }

.pending { margin-top: 14px; border-top: 1px solid #f3f1ed; padding-top: 12px; }
.pending-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.pending-head .el-button:nth-of-type(1) { margin-left: auto; }
.pending-list { display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; }
.pending-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f7f5f2; font-size: 13px; }
.pending-row .who { width: 64px; color: #1c1917; }
.pending-row .date { font-family: monospace; font-size: 12px; color: #8f8a82; }
.pending-row .proj { width: 140px; color: #5c574f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pending-row .content { flex: 1; min-width: 0; color: #8f8a82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pending-row .hours { color: #1c1917; }

.team { margin-top: 14px; border-top: 1px solid #f3f1ed; padding-top: 12px; }
.team-head { font-size: 13px; font-weight: 600; color: #1c1917; margin-bottom: 8px; }
.team-list { display: flex; flex-direction: column; }
.team-row { display: flex; align-items: center; gap: 12px; padding: 5px 0; font-size: 13px; color: #5c574f; }
.team-row .t-name { width: 80px; color: #1c1917; }
.team-row .t-hours { width: 56px; font-weight: 600; }
.team-row.idle .t-hours { color: #b3450f; }

@media (max-width: 900px) {
  .stat-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
