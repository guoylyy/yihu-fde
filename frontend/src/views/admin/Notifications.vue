<template>
  <div class="notif-page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('notifications.notifications') }}</h2>
        <p class="hint">{{ $t('notifications.unread_total', { p0: unreadCount, p1: total }) }}</p>
      </div>
      <div style="display: flex; gap: 8px;">
        <el-button @click="openSettings"><el-icon><Setting /></el-icon>{{ $t('common.notification_settings') }}</el-button>
        <el-button v-if="unreadCount > 0" type="primary" @click="markAllRead">
          <el-icon><Check /></el-icon>{{ $t('notifications.mark_all_read') }}
        </el-button>
      </div>
    </div>

    <!-- v2.5.5(#912) 通知设置: 按类型开关。三档默认: 必看即时 / 可选默认关 / 噪音进每日摘要; 开关覆盖默认 -->
    <el-drawer v-model="settingsVisible" :title="$t('common.notification_settings')" size="560px" destroy-on-close>
      <div v-loading="settingsLoading">
        <p class="hint" style="margin: 0 0 12px;">
          {{ $t('notifications.by_default_only_must_read_pushed') }}
        </p>
        <div v-for="g in settingsGroups" :key="g.group" class="pref-group">
          <div class="pref-group-title">{{ g.group }}</div>
          <div v-for="row in g.rows" :key="row.type" class="pref-row">
            <div class="pref-main">
              <div class="pref-label">
                {{ row.label }}
                <el-tag size="small" :type="tierTagType(row.tier)" effect="plain" style="margin-left: 6px;">{{ row.tierLabel }}</el-tag>
                <el-tag v-if="row.defaultDelivery === 'digest'" size="small" type="info" effect="plain" style="margin-left: 4px;">{{ $t('notifications.digest_by_default') }}</el-tag>
              </div>
              <div class="pref-reason">{{ row.reason }}</div>
            </div>
            <el-switch :model-value="effectiveOn(row)" :loading="savingType === row.type"
                       :disabled="row.type === digestType" @change="v => toggle(row, v)" />
          </div>
        </div>
        <div class="pref-footer">
          <el-button link type="primary" :disabled="!hasOverrides" @click="resetAll">{{ $t('notifications.restore_all_defaults') }}</el-button>
        </div>
      </div>
    </el-drawer>

    <el-card shadow="never" class="block-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item :label="$t('common.type')">
          <el-select v-model="filterType" clearable :placeholder="$t('common.all')" style="width: 200px;" @change="loadList">
            <el-option v-for="t in typeOptions" :key="t" :label="typeLabel(t)" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="unreadOnly" @change="loadList">{{ $t('notifications.unread_only') }}</el-checkbox>
        </el-form-item>
      </el-form>

      <el-empty v-if="!list.length && !loading" :description="$t('common.no_notifications')" />
      <div v-else class="notif-list">
        <div v-for="n in list" :key="n.id" :class="['notif-row', !n.readAt && 'unread']" @click="handleClick(n)">
          <div class="notif-icon">{{ getTypeIcon(n.type) }}</div>
          <div class="notif-content">
            <div class="notif-title-row">
              <strong>{{ n.title }}</strong>
              <span class="notif-time">{{ formatTime(n.createdAt) }}</span>
            </div>
            <div v-if="n.body" class="notif-body">{{ n.body }}</div>
            <div class="notif-meta">
              <el-tag size="small" effect="plain">{{ typeLabel(n.type) }}</el-tag>
              <el-button v-if="!n.readAt" link size="small" type="primary" @click.stop="markRead(n)">{{ $t('common.mark_read') }}</el-button>
              <el-button link size="small" type="danger" @click.stop="remove(n)">{{ $t('common.delete_2') }}</el-button>
            </div>
          </div>
        </div>
      </div>

      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="prev, pager, next, total"
        @current-change="loadList"
        style="margin-top: 16px; text-align: right;"
      />
    </el-card>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Setting } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { useRouter, useRoute } from 'vue-router'
import { openLink } from '@/utils/links.js'

const router = useRouter()
const route = useRoute()
const list = ref([])
const total = ref(0)
const unreadCount = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const filterType = ref('')
const unreadOnly = ref(false)

const typeOptions = ['TASK_ASSIGNED', 'MENTIONED', 'TASK_ACCEPTANCE', 'DAILY_DIGEST', 'TIMESHEET_APPROVED', 'TIMESHEET_REJECTED', 'QUOTATION_PENDING', 'PROJECT_STATUS_CHANGED']

// ===== v2.5.5(#912) 通知设置 =====
const settingsVisible = ref(false)
const settingsLoading = ref(false)
const savingType = ref('')
const catalog = ref([])
const prefs = ref({})
const digestType = ref('DAILY_DIGEST')
const labelMap = computed(() => Object.fromEntries(catalog.value.map(c => [c.type, c.label])))
function typeLabel(t) { return labelMap.value[t] || t }
const settingsGroups = computed(() => {
  const groups = []
  for (const row of catalog.value) {
    let g = groups.find(x => x.group === row.group)
    if (!g) { g = { group: row.group, rows: [] }; groups.push(g) }
    g.rows.push(row)
  }
  return groups
})
const hasOverrides = computed(() => Object.values(prefs.value).some(v => v && typeof v.enabled === 'boolean'))
function tierTagType(tier) { return tier === 'MUST' ? 'danger' : tier === 'OPTIONAL' ? 'warning' : 'info' }
// 有效状态: 用户开关优先; 否则档位默认(即时=开, 关/摘要=关)
function effectiveOn(row) {
  const p = prefs.value[row.type]
  if (p && typeof p.enabled === 'boolean') return p.enabled
  return row.defaultDelivery === 'on'
}
async function loadPrefs() {
  settingsLoading.value = true
  try {
    const data = await fde.notifications.prefs()
    catalog.value = data.catalog || []
    prefs.value = data.prefs || {}
    if (data.digestType) digestType.value = data.digestType
  } catch (e) { ElMessage.error(e.message) } finally { settingsLoading.value = false }
}
function openSettings() { settingsVisible.value = true; if (!catalog.value.length) loadPrefs() }
async function toggle(row, on) {
  savingType.value = row.type
  try {
    const data = await fde.notifications.savePrefs({ [row.type]: { enabled: !!on } })
    prefs.value = data.prefs || {}
  } catch (e) { ElMessage.error(e.message) } finally { savingType.value = '' }
}
async function resetAll() {
  try {
    await ElMessageBox.confirm($t('notifications.clear_all_your_per_type_switches'), $t('common.restore_default'), { type: 'warning' })
  } catch { return }
  const patch = Object.fromEntries(Object.keys(prefs.value).map(t => [t, null]))
  if (!Object.keys(patch).length) return
  try {
    const data = await fde.notifications.savePrefs(patch)
    prefs.value = data.prefs || {}
    ElMessage.success($t('notifications.defaults_restored'))
  } catch (e) { ElMessage.error(e.message) }
}

const TYPE_ICONS = {
  TASK_ASSIGNED: '📋',
  TASK_STATUS_CHANGED: '✅',
  TIMESHEET_APPROVED: '⏰',
  QUOTATION_PENDING: '💰',
  PROJECT_STATUS_CHANGED: '🔄'
}
function getTypeIcon(t) { return TYPE_ICONS[t] || '🔔' }

async function loadList() {
  loading.value = true
  try {
    const params = { page: page.value, page_size: pageSize.value }
    if (unreadOnly.value) params.unread = 'true'
    if (filterType.value) params.type = filterType.value
    const data = await fde.notifications.list(params)
    list.value = data.list
    total.value = data.total
    unreadCount.value = data.unreadCount
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function markRead(n) {
  try {
    await fde.notifications.markRead(n.id)
    n.readAt = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch (e) { ElMessage.error(e.message) }
}

async function markAllRead() {
  try {
    await fde.notifications.readAll()
    list.value.forEach(n => { n.readAt = new Date().toISOString() })
    unreadCount.value = 0
    ElMessage.success($t('notifications.all_marked_read'))
  } catch (e) { ElMessage.error(e.message) }
}

function handleClick(n) {
  if (!n.readAt) markRead(n)
  openLink(router, n.link)
}

async function remove(n) {
  try {
    await ElMessageBox.confirm($t('notifications.delete_this_notification'), $t('common.confirm'), { type: 'warning' })
  } catch { return }
  try {
    await fde.notifications.remove(n.id)
    ElMessage.success($t('common.deleted'))
    loadList()
  } catch (e) { ElMessage.error(e.message) }
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  loadList()
  loadPrefs()   // 顺手拿目录做类型中文名
  if (route.query.settings) openSettings()
})
</script>

<style scoped>
.notif-page { display: flex; flex-direction: column; gap: 16px; }
.pref-group { margin-bottom: 18px; }
.pref-group-title { font-weight: 600; color: #1c1917; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #ebeef5; }
.pref-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed #f0f0f0; }
.pref-main { flex: 1; min-width: 0; }
.pref-label { font-size: 14px; color: #1c1917; display: flex; align-items: center; flex-wrap: wrap; }
.pref-reason { font-size: 12px; color: #909399; margin-top: 2px; }
.pref-footer { display: flex; justify-content: flex-end; margin-top: 8px; }
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.block-card { border-radius: 12px; }
.notif-list { display: flex; flex-direction: column; gap: 8px; }
.notif-row {
  display: flex;
  gap: 12px;
  padding: 14px;
  background: white;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}
.notif-row:hover { border-color: #d2521e; box-shadow: 0 2px 8px rgba(210, 82, 30,0.08); }
.notif-row.unread { background: #fdf3ee; border-left: 3px solid #d2521e; }
.notif-icon { font-size: 24px; flex-shrink: 0; }
.notif-content { flex: 1; }
.notif-title-row { display: flex; justify-content: space-between; align-items: center; }
.notif-time { font-size: 11px; color: #909399; }
.notif-body { font-size: 13px; color: #606266; line-height: 1.5; margin: 6px 0; }
.notif-meta { display: flex; gap: 8px; align-items: center; }
</style>