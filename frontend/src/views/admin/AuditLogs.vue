<template>
  <div class="audit-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.audit_log') }}</h2>
        <p class="hint">{{ $t('auditLogs.key_actions_by_staff_in_customer') }}</p>
      </div>
    </div>

    <div class="filter-bar">
      <el-input v-model="filters.action" :placeholder="$t('auditLogs.action_type_e_g_user_create')" clearable style="width: 220px;" @change="reload" />
      <el-date-picker v-model="filters.range" type="daterange" value-format="YYYY-MM-DD"
        :start-placeholder="$t('common.start_date')" :end-placeholder="$t('common.end_date')" @change="reload" />
    </div>

    <el-card shadow="never" class="list-card" v-loading="loading">
      <el-table :data="list" stripe size="small">
        <el-table-column :label="$t('common.time')" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="$t('auditLogs.actor')" prop="actor" min-width="180" show-overflow-tooltip />
        <el-table-column :label="$t('common.actions')" prop="action" width="150" />
        <el-table-column :label="$t('auditLogs.resource')" width="180">
          <template #default="{ row }">
            <span v-if="row.resourceType">{{ row.resourceType }} #{{ row.resourceId }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.details')" min-width="220">
          <template #default="{ row }">
            <code v-if="row.details" class="details">{{ JSON.stringify(row.details) }}</code>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="IP" prop="ip" width="130" />
        <template #empty><el-empty :description="$t('auditLogs.no_audit_records')" :image-size="90" /></template>
      </el-table>
      <el-pagination v-if="total > pageSize" layout="prev, pager, next, total" :total="total" :page-size="pageSize"
        v-model:current-page="page" @current-change="load" style="margin-top: 12px; justify-content: flex-end;" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const loading = ref(false)
const filters = reactive({ userType: '', action: '', range: null })

function fmtTime(v) {
  if (!v) return ''
  const d = new Date(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function reload() { page.value = 1; load() }

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, page_size: pageSize }
    if (filters.userType) params.userType = filters.userType
    if (filters.action) params.action = filters.action
    if (filters.range?.[0]) { params.from = filters.range[0]; params.to = filters.range[1] }
    const d = await fde.auditLogs.list(params)
    list.value = d.list || []
    total.value = d.total || 0
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

onMounted(load)
</script>

<style scoped>
.audit-page { max-width: 1300px; margin: 0 auto; }
.page-header { margin-bottom: 12px; }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.hint { font-size: 13px; color: rgba(28, 25, 23, 0.6); }
.filter-bar { display: flex; gap: 12px; margin-bottom: 12px; }
.list-card { background: white; border: 1px solid rgba(28, 25, 23, 0.1); }
.details { font-size: 12px; color: #909399; word-break: break-all; }
</style>
