<template>
  <div class="skillpk-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.skill_packages') }}</h2>
        <p class="hint">{{ $t('skillPackages.reusable_capabilities_skill_md_source_shared', { p0: pagination.total }) }}</p>
      </div>
      <el-button v-if="canManage" type="primary" @click="openEdit(null)"><el-icon><Plus /></el-icon>{{ $t('skillPackages.new_skill') }}</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-input v-model="filters.keyword" :placeholder="$t('skillPackages.search_name_description_category')" clearable @keyup.enter="loadList" style="width: 260px; margin-right: 12px;" />
      <el-select v-model="filters.category" clearable filterable allow-create :placeholder="$t('common.all_categories')" style="width: 160px; margin-right: 12px;" @change="loadList">
        <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select v-if="canManage" v-model="filters.status" clearable :placeholder="$t('common.all_statuses')" style="width: 130px; margin-right: 12px;" @change="loadList">
        <el-option :label="$t('skillPackages.enable')" value="ENABLED" />
        <el-option :label="$t('skillPackages.disable')" value="DISABLED" />
      </el-select>
      <el-button type="primary" @click="loadList">{{ $t('common.search') }}</el-button>
    </el-card>

    <el-table :data="list" v-loading="loading" stripe @row-click="openDetail" style="cursor: pointer;">
      <el-table-column :label="$t('common.name')" min-width="200">
        <template #default="{ row }">
          <strong>{{ row.displayName || row.name }}</strong>
          <code class="skill-name">{{ row.name }}</code>
        </template>
      </el-table-column>
      <el-table-column :label="$t('common.description')" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">{{ row.description || '—' }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.category')" width="130">
        <template #default="{ row }">{{ row.category || '—' }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.trigger_words')" min-width="150">
        <template #default="{ row }">
          <el-tag v-for="k in (row.keywords || []).slice(0, 3)" :key="k" size="small" effect="plain" style="margin-right: 4px;">{{ k }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('common.version_2')" width="70" align="center">
        <template #default="{ row }"><span class="muted">v{{ row.version }}</span></template>
      </el-table-column>
      <el-table-column :label="$t('common.status')" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column v-if="canManage" :label="$t('common.actions')" width="180" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status !== 'ENABLED'" link size="small" type="success" @click.stop="setStatus(row, 'ENABLED')">{{ $t('common.enabled') }}</el-button>
          <el-button v-if="row.status === 'ENABLED'" link size="small" type="warning" @click.stop="setStatus(row, 'DISABLED')">{{ $t('common.disable') }}</el-button>
          <el-button link size="small" @click.stop="showLogs(row)">{{ $t('skillPackages.log') }}</el-button>
          <el-button link size="small" type="danger" @click.stop="removeSkill(row)">{{ $t('common.delete_2') }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!list.length && !loading" :description="$t('skillPackages.no_skills_yet_create_one_or')" />

    <el-pagination v-model:current-page="pagination.page" v-model:page-size="pagination.page_size"
      :total="pagination.total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next"
      @current-change="loadList" @size-change="loadList" style="margin-top: 14px; justify-content: flex-end;" />

    <!-- 新建/编辑弹窗: 左表单右预览 -->
    <el-dialog v-model="edit.visible" :title="edit.id ? $t('skillPackages.edit', { p0: edit.form.name }) : $t('skillPackages.new_skill')" width="920px" top="4vh">
      <el-row :gutter="16">
        <el-col :span="14">
          <el-form label-width="76px">
            <el-form-item :label="$t('skillPackages.unique_name')" required>
              <el-input v-model="edit.form.name" :disabled="!!edit.id" :placeholder="$t('skillPackages.kebab_case_e_g_my_skill')" />
            </el-form-item>
            <el-form-item :label="$t('skillPackages.display_name')"><el-input v-model="edit.form.displayName" :placeholder="$t('skillPackages.optional_display_name')" /></el-form-item>
            <el-form-item :label="$t('common.description')"><el-input v-model="edit.form.description" :placeholder="$t('skillPackages.one_line_description_main_thing_agents')" /></el-form-item>
            <el-form-item :label="$t('common.category')"><el-input v-model="edit.form.category" :placeholder="$t('skillPackages.e_g_dev_workflow_ops_sales')" /></el-form-item>
            <el-form-item :label="$t('common.trigger_words')">
              <el-select v-model="edit.form.keywords" multiple filterable allow-create default-first-option :placeholder="$t('skillPackages.press_enter_after_typing')" style="width: 100%;" />
            </el-form-item>
            <!-- v2.1.1(#455) 移除草稿态: 新建默认停用, 确认可用后切启用 -->
            <el-form-item v-if="!edit.id" :label="$t('common.status')">
              <el-radio-group v-model="edit.form.status">
                <el-radio-button value="DISABLED">{{ $t('common.disable') }}</el-radio-button>
                <el-radio-button value="ENABLED">{{ $t('common.enabled') }}</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item :label="$t('skillPackages.content')" required>
              <el-input v-model="edit.form.content" type="textarea" :rows="14" :placeholder="$t('skillPackages.skill_md_source_markdown_may_include')" class="content-editor" />
            </el-form-item>
            <el-form-item v-if="edit.fmFilled" label="">
              <el-alert type="info" :closable="false" style="width: 100%;">{{ $t('skillPackages.filled_from_frontmatter', { p0: edit.fmFilled }) }}</el-alert>
            </el-form-item>
          </el-form>
        </el-col>
        <el-col :span="10">
          <div class="preview-label">{{ $t('common.preview') }}</div>
          <div class="md-preview" v-html="previewHtml"></div>
        </el-col>
      </el-row>
      <template #footer>
        <el-button @click="edit.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="edit.saving" @click="save">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 详情弹窗(只读) -->
    <el-dialog v-model="detail.visible" :title="detail.pkg ? (detail.pkg.displayName || detail.pkg.name) : ''" width="760px" top="4vh">
      <template v-if="detail.pkg">
        <div class="detail-meta">
          <code class="skill-name">{{ detail.pkg.name }}</code>
          <el-tag size="small" effect="plain">{{ $t('common.p0', { p0: detail.pkg.category || $t('common.uncategorized') }) }}</el-tag>
          <el-tag :type="statusType(detail.pkg.status)" size="small">{{ statusLabel(detail.pkg.status) }}</el-tag>
          <span class="muted">v{{ detail.pkg.version }}</span>
          <el-tag v-for="k in (detail.pkg.keywords || [])" :key="k" size="small" effect="plain">{{ k }}</el-tag>
        </div>
        <p class="muted" style="font-size: 13px; margin-top: 6px;">{{ detail.pkg.description }}</p>
        <div class="md-preview detail-body" v-html="detailHtml"></div>
      </template>
      <template #footer>
        <el-button @click="detail.visible = false">{{ $t('common.close') }}</el-button>
        <el-button v-if="canManage" type="primary" @click="detail.visible = false; openEdit(detail.pkg)">{{ $t('common.edit') }}</el-button>
      </template>
    </el-dialog>

    <!-- 调用日志弹窗 -->
    <el-dialog v-model="logs.visible" :title="$t('skillPackages.call_log', { p0: logs.pkgName })" width="640px">
      <el-table :data="logs.list" size="small" v-loading="logs.loading" max-height="420">
        <el-table-column :label="$t('common.time')" width="160"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
        <el-table-column :label="$t('common.source')" width="90">
          <template #default="{ row }"><el-tag :type="row.actorType === 'AGENT' ? 'warning' : 'info'" size="small" effect="plain">{{ $t('common.p0', { p0: row.actorType === 'AGENT' ? '🤖 Agent' : $t('common.user') }) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="actorName" :label="$t('skillPackages.caller')" width="130" />
        <el-table-column prop="action" :label="$t('common.action')" width="90" />
      </el-table>
      <el-empty v-if="!logs.list.length && !logs.loading" :description="$t('skillPackages.no_calls_yet')" :image-size="60" />
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'

const canManage = computed(() => can('skillPackage.manage'))
const loading = ref(false)
const list = ref([])
const categories = ref([])
const filters = reactive({ keyword: '', category: '', status: '' })
const pagination = reactive({ page: 1, page_size: 20, total: 0 })

async function loadList() {
  loading.value = true
  try {
    const params = { ...filters, page: pagination.page, page_size: pagination.page_size }
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
    const data = await fde.skillPackages.list(params)
    list.value = data.list
    pagination.total = data.total
    for (const p of data.list) if (p.category && !categories.value.includes(p.category)) categories.value.push(p.category)
  } finally { loading.value = false }
}

const statusLabel = (s) => ({ ENABLED: $t('common.enabled'), DISABLED: $t('common.disable') }[s] || s)  // v2.1.1(#455) 已无草稿态
const statusType = (s) => ({ ENABLED: 'success', DISABLED: 'warning' }[s] || 'info')
const fmtTime = (t) => t ? String(t).replace('T', ' ').slice(0, 16).replace('Z', '') : '—'

// ---------- 详情 ----------
const detail = reactive({ visible: false, pkg: null })
const detailHtml = computed(() => detail.pkg ? marked.parse(detail.pkg.content || '') : '')
async function openDetail(row) {
  const d = await fde.skillPackages.detail(row.id)
  detail.pkg = d
  detail.visible = true
}

// ---------- 编辑 ----------
const edit = reactive({ visible: false, id: null, saving: false, fmFilled: '', form: {} })
const previewHtml = computed(() => marked.parse(edit.form.content || $t('skillPackages.no_content')))
function openEdit(row) {
  edit.id = row?.id || null
  edit.fmFilled = ''
  edit.form = row
    ? { name: row.name, displayName: row.displayName || '', description: row.description || '', category: row.category || '', keywords: row.keywords || [], content: '', status: row.status }
    : { name: '', displayName: '', description: '', category: '', keywords: [], content: '', status: 'DISABLED' }
  if (row) {
    fde.skillPackages.detail(row.id).then(d => { edit.form.content = d.content })
  }
  edit.visible = true
}
// frontmatter 回填提示(仅新建时)
function checkFrontmatter() {
  if (edit.id) return
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(edit.form.content || '')
  if (!m) { edit.fmFilled = ''; return }
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) { const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim()); if (kv) fm[kv[1]] = kv[2].trim() }
  const filled = []
  if (fm.description && !edit.form.description) { edit.form.description = fm.description.slice(0, 500); filled.push($t('common.description')) }
  if (fm.name && !edit.form.name) { edit.form.name = fm.name; filled.push($t('skillPackages.unique_name')) }
  edit.fmFilled = filled.length ? filled.join($t('common.list_sep')) : ''
}
watch(() => edit.form.content, checkFrontmatter)

async function save() {
  if (!edit.form.name?.trim()) return ElMessage.warning($t('skillPackages.unique_name_required'))
  if (!edit.form.content?.trim()) return ElMessage.warning($t('skillPackages.content_required'))
  edit.saving = true
  try {
    if (edit.id) {
      await fde.skillPackages.update(edit.id, edit.form)   // version 由后端按 content 变更自动递增
      ElMessage.success($t('common.saved'))
    } else {
      await fde.skillPackages.create(edit.form)
      ElMessage.success($t('common.created_2'))
    }
    edit.visible = false
    loadList()
  } finally { edit.saving = false }
}

async function setStatus(row, status) {
  await fde.skillPackages.update(row.id, { status })
  ElMessage.success(status === 'ENABLED' ? $t('common.enabled_2') : $t('common.disabled_2'))
  loadList()
}

async function removeSkill(row) {
  await ElMessageBox.confirm($t('skillPackages.delete_skill_soft_delete_call_logs', { p0: row.displayName || row.name }), $t('common.confirm_delete'), { type: 'warning' })
  await fde.skillPackages.remove(row.id)
  ElMessage.success($t('common.deleted'))
  loadList()
}

// ---------- 调用日志 ----------
const logs = reactive({ visible: false, loading: false, pkgName: '', list: [] })
async function showLogs(row) {
  logs.pkgName = row.displayName || row.name
  logs.visible = true
  logs.loading = true
  try {
    const d = await fde.skillPackages.usageLogs(row.id, { page_size: 50 })
    logs.list = d.list
  } finally { logs.loading = false }
}

onMounted(loadList)
</script>

<style scoped>
.skillpk-page { display: flex; flex-direction: column; gap: 12px; }
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.filter-card { border-radius: 12px; }
.filter-card :deep(.el-card__body) { display: flex; align-items: center; }
.skill-name { font-size: 11px; color: #a8a29e; margin-left: 8px; background: #f5f4f0; padding: 1px 6px; border-radius: 4px; }
.muted { color: #a8a29e; font-size: 12px; }
.detail-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.detail-body { max-height: 480px; overflow: auto; border: 1px solid #f0ede8; border-radius: 8px; padding: 12px; margin-top: 8px; }
.preview-label { font-size: 12px; color: #a8a29e; margin-bottom: 6px; }
.md-preview { font-size: 13px; line-height: 1.7; }
.md-preview :deep(h1) { font-size: 17px; margin: 10px 0 6px; }
.md-preview :deep(h2) { font-size: 15px; margin: 10px 0 6px; }
.md-preview :deep(p) { margin: 6px 0; }
.md-preview :deep(ul) { padding-left: 18px; margin: 6px 0; }
.md-preview :deep(code) { background: #f5f4f0; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.content-editor :deep(textarea) { font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.6; }
</style>
