<template>
  <div class="customers-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.customers') }}</h2>
        <p class="hint">{{ $t('customers.customers_industries', { p0: stats.total, p1: stats.byIndustry.length }) }}</p>
      </div>
      <el-button v-if="can('customer.create')" type="primary" @click="openCreate"><el-icon><Plus /></el-icon>{{ $t('customers.new_customer') }}</el-button>
      <el-button v-if="can('report.export')" type="success" @click="exportExcel"><el-icon><Download /></el-icon>{{ $t('common.export_excel') }}</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item :label="$t('common.search')">
          <el-input v-model="filters.keyword" :placeholder="$t('customers.customer_name')" clearable @keyup.enter="loadList" />
        </el-form-item>
        <el-form-item :label="$t('common.industry')">
          <el-select v-model="filters.industry" :placeholder="$t('common.all')" clearable style="width: 140px;">
            <el-option v-for="i in stats.byIndustry" :key="i.industry" :label="`${i.industry} (${i.count})`" :value="i.industry" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">{{ $t('common.search_2') }}</el-button>
          <el-button @click="resetFilters">{{ $t('common.reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-card">
      <el-table :data="list" v-loading="loading" stripe @row-click="openDetail">
        <el-table-column prop="name" :label="$t('customers.customer_name')" min-width="180">
          <template #default="{ row }">
            <strong>{{ row.name }}</strong>
            <el-tag v-if="row.shortName" size="small" effect="plain" style="margin-left: 8px;">{{ row.shortName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="industry" :label="$t('common.industry')" width="120" />
        <el-table-column prop="scale" :label="$t('customers.size')" width="100">
          <template #default="{ row }">
            <el-tag :type="scaleType(row.scale)" effect="light" size="small">{{ scaleLabel(row.scale) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="address" :label="$t('customers.address')" show-overflow-tooltip min-width="200" />
        <el-table-column :label="$t('customers.projects_contacts')" width="120" align="center">
          <template #default="{ row }">{{ row._count.projects }} / {{ row._count.contacts }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small" effect="light">
              {{ $t('common.p0', { p0: row.status === 1 ? $t('customers.active') : $t('common.disable') }) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="240" fixed="right">
          <template #default="{ row }">
            <el-button v-if="can('customer.edit')" size="small" link type="primary" @click.stop="openEdit(row)">{{ $t('common.edit') }}</el-button>
            <el-popconfirm v-if="can('customer.delete')" :title="$t('customers.delete_this_customer')" @confirm="handleDelete(row)">
              <template #reference>
                <el-button size="small" link type="danger" @click.stop>{{ $t('common.delete_2') }}</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.page_size"
        :total="pagination.total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadList"
        @size-change="loadList"
        style="margin-top: 16px; justify-content: flex-end;"
      />
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" :title="currentCustomer?.name || $t('customers.customer_details')" width="720px">
      <div v-if="currentCustomer" v-loading="detailLoading">
        <el-descriptions :column="2" border>
          <el-descriptions-item :label="$t('customers.full_name')">{{ currentCustomer.name }}</el-descriptions-item>
          <el-descriptions-item :label="$t('customers.short_name')">{{ currentCustomer.shortName || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.industry')">{{ currentCustomer.industry || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('customers.size')">{{ scaleLabel(currentCustomer.scale) }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.tags')">{{ (currentCustomer.tags || []).join(' / ') || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('customers.address')" :span="2">{{ currentCustomer.address || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.notes')" :span="2">{{ currentCustomer.notes || '—' }}</el-descriptions-item>
        </el-descriptions>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 20px;">
          <h4 style="margin: 0;">{{ $t('customers.contacts', { p0: currentCustomer.contacts?.length || 0 }) }}</h4>
          <el-button v-if="can('customer.edit')" size="small" type="primary" :icon="Plus" @click="openAddContact">{{ $t('customers.add_contact') }}</el-button>
        </div>

        <!-- 添加联系人表单 -->
        <el-form v-if="showAddContact" :model="contactForm" :rules="contactRules" ref="contactFormRef" label-width="80px" size="small" style="margin: 12px 0; padding: 12px; background: rgba(64,158,255,0.04); border-radius: 4px;">
          <el-row :gutter="12">
            <el-col :span="8">
              <el-form-item :label="$t('common.name_2')" prop="name">
                <el-input v-model="contactForm.name" :placeholder="$t('customers.contact_name')" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="$t('customers.title')">
                <el-input v-model="contactForm.title" :placeholder="$t('customers.e_g_cto')" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="$t('customers.phone')">
                <el-input v-model="contactForm.phone" :placeholder="$t('common.phone')" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="$t('common.email')">
                <el-input v-model="contactForm.email" :placeholder="$t('common.email')" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="$t('common.primary_contact')">
                <el-switch v-model="contactForm.isPrimaryBool" :active-value="1" :inactive-value="0" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="$t('common.notes')" label-width="50px">
                <el-input v-model="contactForm.notes" :placeholder="$t('common.notes')" />
              </el-form-item>
            </el-col>
          </el-row>
          <div style="text-align: right;">
            <el-button size="small" @click="cancelAddContact">{{ $t('common.cancel') }}</el-button>
            <el-button size="small" type="primary" :loading="contactSubmitting" @click="handleSaveContact">{{ $t('common.save') }}</el-button>
          </div>
        </el-form>

        <el-table :data="currentCustomer.contacts || []" size="small" border>
          <el-table-column prop="name" :label="$t('common.name_2')" />
          <el-table-column prop="title" :label="$t('customers.title')" />
          <el-table-column prop="phone" :label="$t('customers.phone')" />
          <el-table-column prop="email" :label="$t('common.email')" />
          <el-table-column :label="$t('common.primary_contact')" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.isPrimary" type="success" size="small">{{ $t('common.primary') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="can('customer.edit')" :label="$t('common.actions')" width="140" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openEditContact(row)">{{ $t('common.edit') }}</el-button>
              <el-button link type="danger" size="small" @click="handleDeleteContact(row)">{{ $t('common.delete_2') }}</el-button>
            </template>
          </el-table-column>
        </el-table>

        <h4 style="margin-top: 20px;">{{ $t('customers.projects', { p0: currentCustomer.projects?.length || 0 }) }}</h4>
        <el-table :data="currentCustomer.projects || []" size="small" border>
          <el-table-column prop="code" :label="$t('common.code')" width="140" />
          <el-table-column prop="name" :label="$t('common.name')" />
          <el-table-column :label="$t('common.status')" width="120">
            <template #default="{ row }">
              <el-tag :type="projectStatusType(row.status)" size="small" effect="light">{{ projectStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="progress" :label="$t('common.progress')" width="100">
            <template #default="{ row }">{{ row.progress }}%</template>
          </el-table-column>
        </el-table>


        <!-- v1.6.1 客户轴聚合: 该客户名下所有项目的交互史(对接/聊天/会议 + Agent 对话), 打单/复盘前一页看全 -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 20px;">
          <h4 style="margin: 0;">{{ $t('customers.history', { p0: ix.total }) }}</h4>
          <el-radio-group v-model="ix.type" size="small" @change="loadInteractions()">
            <el-radio-button value="">{{ $t('common.all') }}</el-radio-button>
            <el-radio-button value="COMM">{{ $t('customers.communication') }}</el-radio-button>
            <el-radio-button value="CHAT">{{ $t('customers.chat') }}</el-radio-button>
            <el-radio-button value="MEETING">{{ $t('customers.meeting') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div v-loading="ix.loading" style="margin-top: 8px;">
          <el-timeline v-if="ix.records.length" style="padding-left: 4px;">
            <el-timeline-item v-for="r in ix.records" :key="r.id" :timestamp="String(r.occurredAt || '').slice(0, 16).replace('T', ' ')" placement="top"
              :type="{ MEETING: 'primary', COMM: 'warning', CHAT: 'warning' }[r.type] || 'info'">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <el-tag size="small" effect="plain">{{ ix.typeLabels[r.type] || r.type }}</el-tag>
                <el-tag size="small" type="info" effect="plain">{{ r.projectCode }}</el-tag>
                <strong>{{ r.title }}</strong>
                <el-tag v-if="r.agentName" size="small" type="warning" effect="light">🤖 {{ r.agentName }}</el-tag>
                <span style="color: #909399; font-size: 12px;">{{ r.creatorName }}</span>
              </div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else :description="$t('customers.no_interactions_yet_communication_chat_meeting')" :image-size="60" />
          <div v-if="ix.records.length < ix.total" style="text-align: center;">
            <el-button size="small" text @click="loadInteractions(true)">{{ $t('common.load_more', { p0: ix.records.length, p1: ix.total }) }}</el-button>
          </div>
          <template v-if="ix.conversations.length">
            <h4 style="margin: 14px 0 8px;">{{ $t('customers.agent_conversations', { p0: ix.conversations.length }) }}</h4>
            <div v-for="c in ix.conversations" :key="c.id"
              style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #f0f0f0; font-size: 13px;">
              <el-tag size="small" type="warning" effect="light">{{ $t('common.p0', { p0: c.source === 'EXTERNAL' ? $t('customers.agent_report') : $t('customers.in_app_assistant') }) }}</el-tag>
              <el-tag v-if="c.projectCode" size="small" type="info" effect="plain">{{ c.projectCode }}</el-tag>
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ $t('common.p0', { p0: c.title || $t('common.agent_conversations') }) }}</span>
              <span style="color: #909399; font-size: 12px;">{{ c.ownerName }}<template v-if="c.agentName"> {{ $t('customers.s', { p0: c.agentName }) }}</template> {{ $t('customers.p0', { p0: c.messageCount }) }}</span>
            </div>
          </template>
        </div>
      </div>
    </el-dialog>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="formVisible" :title="formMode === 'create' ? $t('customers.new_customer') : $t('customers.edit_customer')" width="640px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item :label="$t('customers.full_name')" prop="name">
          <el-input v-model="form.name" :placeholder="$t('customers.e_g_acme_manufacturing_co')" />
        </el-form-item>
        <el-form-item :label="$t('customers.short_name')">
          <el-input v-model="form.shortName" :placeholder="$t('customers.e_g_acme')" />
        </el-form-item>
        <el-form-item :label="$t('common.industry')">
          <el-input v-model="form.industry" :placeholder="$t('customers.e_g_manufacturing')" />
        </el-form-item>
        <el-form-item :label="$t('customers.size')">
          <el-select v-model="form.scale" :placeholder="$t('customers.choose_size')" clearable style="width: 100%;">
            <el-option :label="$t('customers.small')" value="SMALL" />
            <el-option :label="$t('common.medium')" value="MEDIUM" />
            <el-option :label="$t('customers.large')" value="LARGE" />
            <el-option :label="$t('customers.enterprise')" value="GIANT" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('customers.address')">
          <el-input v-model="form.address" :placeholder="$t('customers.e_g_suzhou_jiangsu')" />
        </el-form-item>
        <el-form-item :label="$t('common.tags')">
          <el-input v-model="form.tagsInput" :placeholder="$t('customers.comma_separated_key_account_signed')" />
        </el-form-item>
        <el-form-item :label="$t('common.notes')">
          <el-input v-model="form.notes" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item :label="$t('common.status')" v-if="formMode === 'edit'">
          <el-switch v-model="form.statusBool" :active-value="1" :inactive-value="0" :active-text="$t('customers.active')" :inactive-text="$t('common.disable')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.ok') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { Plus, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'

const list = ref([])
const stats = ref({ total: 0, byIndustry: [] })
const loading = ref(false)
const filters = reactive({ keyword: '', industry: '' })
const pagination = reactive({ page: 1, page_size: 20, total: 0 })

const detailVisible = ref(false)
const detailLoading = ref(false)
const currentCustomer = ref(null)

const formVisible = ref(false)
const formMode = ref('create')
const submitting = ref(false)
const formRef = ref()
const form = reactive({
  id: null,
  name: '',
  shortName: '',
  industry: '',
  scale: '',
  address: '',
  tagsInput: '',
  notes: '',
  statusBool: 1
})
const rules = {
  name: [{ required: true, message: $t('customers.customer_name_required'), trigger: 'blur' }]
}

// 联系人表单（新增 + 编辑复用）
const showAddContact = ref(false)
const contactSubmitting = ref(false)
const editingContactId = ref(null)
const contactFormRef = ref()
const contactForm = reactive({
  name: '', title: '', phone: '', email: '', isPrimaryBool: 0, notes: ''
})
const contactRules = {
  name: [{ required: true, message: $t('customers.name_required'), trigger: 'blur' }]
}
function resetContactForm() {
  Object.assign(contactForm, { name: '', title: '', phone: '', email: '', isPrimaryBool: 0, notes: '' })
  contactFormRef.value?.clearValidate()
}
function openAddContact() {
  resetContactForm()
  editingContactId.value = null
  showAddContact.value = true
}
function openEditContact(row) {
  resetContactForm()
  editingContactId.value = String(row.id)
  contactForm.name = row.name || ''
  contactForm.title = row.title || ''
  contactForm.phone = row.phone || ''
  contactForm.email = row.email || ''
  contactForm.isPrimaryBool = row.isPrimary ? 1 : 0
  contactForm.notes = row.notes || ''
  showAddContact.value = true
}
function cancelAddContact() {
  showAddContact.value = false
  editingContactId.value = null
  resetContactForm()
}
async function handleSaveContact() {
  try { await contactFormRef.value.validate() } catch { return }
  contactSubmitting.value = true
  try {
    const payload = {
      name: contactForm.name,
      title: contactForm.title || null,
      phone: contactForm.phone || null,
      email: contactForm.email || null,
      isPrimary: contactForm.isPrimaryBool,
      notes: contactForm.notes || null
    }
    if (editingContactId.value) {
      await fde.customers.updateContact(currentCustomer.value.id, editingContactId.value, payload)
      ElMessage.success($t('customers.contact_updated'))
    } else {
      await fde.customers.addContact(currentCustomer.value.id, payload)
      ElMessage.success($t('customers.contact_added'))
    }
    showAddContact.value = false
    editingContactId.value = null
    // 重新拉详情
    currentCustomer.value = await fde.customers.detail(currentCustomer.value.id)
    loadList()
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally { contactSubmitting.value = false }
}
async function handleDeleteContact(row) {
  try {
    await ElMessageBox.confirm($t('customers.delete_contact', { p0: row.name }), $t('common.confirm'), { type: 'warning' })
  } catch { return }
  try {
    await fde.customers.removeContact(currentCustomer.value.id, row.id)
    ElMessage.success($t('common.deleted'))
    currentCustomer.value = await fde.customers.detail(currentCustomer.value.id)
    loadList()
  } catch (e) { ElMessage.error(e.message || $t('common.delete_failed')) }
}

async function loadList() {
  loading.value = true
  try {
    const params = { ...filters, page: pagination.page, page_size: pagination.page_size }
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
    const data = await fde.customers.list(params)
    list.value = data.list
    pagination.total = data.total
  } finally { loading.value = false }
}

async function loadStats() {
  try { stats.value = await fde.customers.stats() } catch (e) { console.warn(e) }
}

async function openDetail(row) {
  detailVisible.value = true
  detailLoading.value = true
  try { currentCustomer.value = await fde.customers.detail(row.id) }
  finally { detailLoading.value = false }
  loadInteractions() // v1.6.1 交互史聚合
}

// ===== v1.6.1 客户轴交互史(对接/聊天/会议 + Agent 对话) =====
const ix = reactive({ loading: false, type: '', records: [], total: 0, page: 1, conversations: [], typeLabels: {} })
async function loadInteractions(more = false) {
  const cid = currentCustomer.value?.id
  if (!cid) return
  ix.loading = true
  try {
    ix.page = more === true ? ix.page + 1 : 1
    const d = await fde.projectRecords.customerInteractions(cid, { type: ix.type, page: ix.page, page_size: 10 })
    if (String(currentCustomer.value?.id) !== String(cid)) return // 切客户时丢弃迟到响应
    ix.records = more === true ? [...ix.records, ...d.records.list] : d.records.list
    ix.total = d.records.total
    ix.conversations = d.conversations
    ix.typeLabels = d.typeLabels || {}
  } catch (e) { console.warn('[customer interactions]', e.message) }
  finally { ix.loading = false }
}


function resetFilters() {
  filters.keyword = ''
  filters.industry = ''
  pagination.page = 1
  loadList()
}

function resetForm() {
  Object.assign(form, {
    id: null, name: '', shortName: '', industry: '', scale: '',
    address: '', tagsInput: '', notes: '', statusBool: 1
  })
  formRef.value?.clearValidate()
}

function openCreate() {
  formMode.value = 'create'
  resetForm()
  formVisible.value = true
}

function openEdit(row) {
  formMode.value = 'edit'
  resetForm()
  form.id = row.id
  form.name = row.name
  form.shortName = row.shortName || ''
  form.industry = row.industry || ''
  form.scale = row.scale || ''
  form.address = row.address || ''
  form.tagsInput = (row.tags || []).join(',')
  form.notes = row.notes || ''
  form.statusBool = row.status
  formVisible.value = true
}

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    const payload = {
      name: form.name,
      shortName: form.shortName || null,
      industry: form.industry || null,
      scale: form.scale || null,
      address: form.address || null,
      tags: form.tagsInput ? form.tagsInput.split(',').map(s => s.trim()).filter(Boolean) : [],
      notes: form.notes || null
    }
    if (formMode.value === 'create') {
      await fde.customers.create(payload)
      ElMessage.success($t('customers.customer_created'))
    } else {
      payload.status = form.statusBool
      await fde.customers.update(form.id, payload)
      ElMessage.success($t('customers.customer_updated'))
    }
    formVisible.value = false
    loadList()
    loadStats()
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally { submitting.value = false }
}

async function handleDelete(row) {
  try {
    await fde.customers.remove(row.id)
    ElMessage.success($t('customers.customer_deleted'))
    loadList()
    loadStats()
  } catch (e) { ElMessage.error(e.message || $t('common.delete_failed')) }
}

function scaleType(s) { return { SMALL: 'info', MEDIUM: 'success', LARGE: 'warning', GIANT: 'danger' }[s] || 'info' }
function scaleLabel(s) { return { SMALL: $t('customers.small'), MEDIUM: $t('common.medium'), LARGE: $t('customers.large'), GIANT: $t('customers.enterprise') }[s] || s || '—' }
function projectStatusType(s) { return { DRAFT: 'info', PROPOSAL: 'warning', APPROVED: 'primary', IN_PROGRESS: 'success', ACCEPTED: 'success', CLOSED: 'info', CANCELLED: 'danger' }[s] || 'info' }
function projectStatusLabel(s) { return { DRAFT: $t('common.draft'), PROPOSAL: $t('common.proposal'), APPROVED: $t('common.approved'), IN_PROGRESS: $t('common.in_progress'), ACCEPTED: $t('common.accepted'), CLOSED: $t('common.closed'), CANCELLED: $t('common.cancelled') }[s] || s }

import { downloadExcel } from '@/api/excel.js'
function exportExcel() {
  downloadExcel(fde.reports.customers(), $t('customers.customers_xlsx', { p0: new Date().toISOString().slice(0, 10) }))
}

onMounted(() => { loadList(); loadStats() })
</script>

<style scoped>
.page-header { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
/* v1.2.9: 信息块占满左侧, 新建/导出等按钮统一靠最右 */
.page-header > :first-child { margin-right: auto; }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.hint { font-size: 13px; color: rgba(28, 25, 23, 0.6); }
.filter-card, .table-card { background: white; border: 1px solid rgba(28, 25, 23, 0.1); margin-bottom: 16px; }
:deep(.el-table__row) { cursor: pointer; }
:deep(.el-table__row:hover > td) { background: rgba(210, 82, 30, 0.04) !important; }
</style>
