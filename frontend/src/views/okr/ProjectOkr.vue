<template>
  <!-- OKR 4.0 项目周 OKR: 每周每个项目一份 Markdown 文档, 全员可读。
       顶部: 项目选择(空 = 全部项目) + 周切换; 选了项目且有写权限(ADMIN/MANAGER/项目成员)才出「上传文档 / 编辑」。
       渲染复用 utils/safeMarkdown(仓库已有的 marked + 消毒), 不引新依赖 -->
  <div class="pokr" v-loading="loading">
    <div class="pokr-top">
      <el-select
        :model-value="projectId" filterable :placeholder="$t('okr.proj.all')" class="pokr-pick" data-test="pokr-project"
        @update:model-value="pickProject"
      >
        <el-option value="" :label="$t('okr.proj.all')" />
        <el-option v-for="r in list?.rows || []" :key="r.project.id" :value="r.project.id" :label="projectLabel(r.project)">
          <span class="pokr-opt">{{ projectLabel(r.project) }}<i v-if="r.hasDoc" class="pokr-opt-dot" :title="$t('okr.proj.has_doc')" /></span>
        </el-option>
      </el-select>
      <div v-if="projectId && canEdit" class="pokr-acts">
        <el-button :loading="uploading" data-test="pokr-upload" @click="fileInput?.click()">{{ $t('okr.proj.upload') }}</el-button>
        <el-button type="primary" data-test="pokr-edit" @click="openEdit">{{ $t('okr.proj.edit') }}</el-button>
        <input ref="fileInput" type="file" accept=".md,.markdown,.txt,.docx" class="pokr-file" data-test="pokr-file" @change="onFile">
      </div>
    </div>

    <OkrWeekBar :year="weekParts.year" :week-no="weekParts.weekNo" :week-key="week" :start="range.start" :end="range.end" hide-links @shift="shift" />

    <!-- 全部项目: 每个项目一行, 有文档的在前; 点进去看全文 -->
    <template v-if="!projectId">
      <p v-if="list" class="pokr-sum" data-test="pokr-sum">{{ $t('okr.proj.summary', { p0: list.withDoc, p1: list.total }) }}</p>
      <ul v-if="list?.rows?.length" class="pokr-list">
        <li v-for="r in list.rows" :key="r.project.id">
          <button type="button" class="pokr-row" :class="{ empty: !r.hasDoc }" data-test="pokr-row" @click="pickProject(r.project.id)">
            <span class="pokr-row-name">{{ r.project.name }}<small v-if="r.project.code">{{ r.project.code }}</small></span>
            <span v-if="r.hasDoc" class="pokr-row-title">{{ r.title }}</span>
            <span v-else class="pokr-row-none">{{ $t('okr.proj.none_short') }}</span>
            <span v-if="r.hasDoc" class="pokr-row-meta">{{ metaText(r) }}</span>
          </button>
        </li>
      </ul>
      <el-empty v-else-if="list" :description="$t('okr.proj.no_projects')" />
    </template>

    <!-- 单个项目 -->
    <template v-else-if="detail">
      <article v-if="detail.doc" class="pokr-doc" data-test="pokr-doc">
        <header class="pokr-doc-head">
          <h2>{{ detail.doc.title }}</h2>
          <p class="pokr-doc-meta">{{ metaText(detail.doc) }}<template v-if="detail.doc.sourceFile"> · {{ $t('okr.proj.from_file', { p0: detail.doc.sourceFile }) }}</template></p>
        </header>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="md-body" data-test="pokr-md" v-html="html" />
      </article>
      <div v-else class="pokr-empty" data-test="pokr-empty">
        <p>{{ $t('okr.proj.empty', { p0: detail.project.name }) }}</p>
        <div v-if="canEdit" class="pokr-empty-acts">
          <el-button :loading="uploading" @click="fileInput?.click()">{{ $t('okr.proj.upload') }}</el-button>
          <el-button type="primary" @click="openEdit">{{ $t('okr.proj.paste') }}</el-button>
        </div>
      </div>
    </template>

    <el-dialog v-model="edit.open" :title="$t('okr.proj.edit_title', { p0: detail?.project?.name || '', p1: week })" :fullscreen="isMobile" width="760px" append-to-body>
      <el-input v-model="edit.title" maxlength="200" :placeholder="$t('okr.proj.title_ph')" class="pokr-ed-title" data-test="pokr-ed-title" />
      <el-input v-model="edit.content" type="textarea" :rows="isMobile ? 16 : 20" :placeholder="$t('okr.proj.content_ph')" class="pokr-ed-md" data-test="pokr-ed-md" />
      <template #footer>
        <el-button @click="edit.open = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" :disabled="!edit.content.trim()" data-test="pokr-save" @click="save">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'
import { useIsMobile } from '@/composables/useResponsive.js'
import OkrWeekBar from '@/components/okr/OkrWeekBar.vue'
import { shiftKey, parseKey, isoWeekOf, weekKey, weekStart, shDate } from './okrUtils.js'
import { currentUser } from './okrPeople.js'
import { canEditProjectDoc, projectLabel, projectDocFileProblem, isLead, firstHeading } from './okrFe3.js'

const route = useRoute()
const router = useRouter()
const isMobile = useIsMobile()
const me = currentUser()

const week = computed(() => (parseKey(route.query.week) ? route.query.week : weekKey(isoWeekOf())))
const weekParts = computed(() => parseKey(week.value))
const range = computed(() => {
  const s = weekStart(weekParts.value)
  return { start: s.toISOString(), end: new Date(s.getTime() + 6 * 86400000).toISOString() }
})
const projectId = computed(() => String(route.query.project || ''))

const list = ref(null)
const detail = ref(null)
const loading = ref(false)
const projectInfo = ref(null)
const canEdit = computed(() => canEditProjectDoc(me, projectInfo.value))
const html = computed(() => (detail.value?.doc ? renderSafeMarkdown(detail.value.doc.contentMd) : ''))

async function loadList() {
  try { list.value = await fde.okr.projectDocs(week.value) } catch (e) { ElMessage.error(e.message) }
}
async function loadDetail() {
  if (!projectId.value) { detail.value = null; return }
  loading.value = true
  try {
    detail.value = await fde.okr.projectDoc(projectId.value, week.value)
  } catch (e) {
    detail.value = null
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
/** 写权限: ADMIN/MANAGER 直接有; 其他人看项目详情里的经理 / 成员(看不到详情 = 不是成员) */
async function loadProjectInfo() {
  projectInfo.value = null
  if (!projectId.value || isLead(me)) return
  try { projectInfo.value = await fde.projects.detail(projectId.value) } catch { projectInfo.value = null }
}

watch(week, loadList, { immediate: true })
watch([projectId, week], loadDetail, { immediate: true })
watch(projectId, loadProjectInfo, { immediate: true })

function pickProject(id) {
  router.replace({ query: { ...route.query, project: id || undefined } })
}
function shift(delta) {
  router.replace({ query: { ...route.query, week: shiftKey(week.value, delta) } })
}
function metaText(d) {
  const who = d.updatedBy?.name || d.updatedBy?.username || ''
  return $t('okr.proj.updated', { p0: who, p1: d.updatedAt ? shDate(d.updatedAt) : '' })
}

// ---------------------------------------------------------------- 编辑 / 上传
const edit = reactive({ open: false, title: '', content: '' })
const saving = ref(false)
const uploading = ref(false)
const fileInput = ref(null)

function openEdit() {
  edit.title = detail.value?.doc?.title || ''
  edit.content = detail.value?.doc?.contentMd || ''
  edit.open = true
}

async function afterSave(doc, msgKey) {
  detail.value = { ...detail.value, hasDoc: true, doc }
  ElMessage.success($t(msgKey))
  loadList()
}

async function save() {
  saving.value = true
  try {
    const doc = await fde.okr.saveProjectDoc(projectId.value, { week: week.value, title: edit.title.trim() || undefined, contentMd: edit.content })
    edit.open = false
    afterSave(doc, 'okr.proj.saved')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

async function onFile(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  const bad = projectDocFileProblem(file)
  if (bad) { if (bad !== 'empty') ElMessage.warning($t('okr.proj.file_' + bad)); return }
  uploading.value = true
  try {
    // .md/.txt: 正文第一个标题当标题; .docx 交给后端(用文件名)
    const title = /\.(md|markdown|txt)$/i.test(file.name) ? firstHeading(await file.text()) : ''
    const doc = await fde.okr.importProjectDoc(projectId.value, week.value, file, title || undefined)
    afterSave(doc, 'okr.proj.imported')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.pokr { max-width: 960px; margin: 0 auto; padding: 4px 0 24px; }
.pokr-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.pokr-pick { width: 320px; max-width: 100%; }
.pokr-opt { display: inline-flex; align-items: center; gap: 6px; }
.pokr-opt-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--el-color-success); }
.pokr-acts { display: flex; gap: 8px; }
.pokr-acts .el-button + .el-button { margin-left: 0; }
.pokr-file { display: none; }
.pokr-sum { margin: 0 0 8px; font-size: 13px; color: var(--el-text-color-secondary); }
.pokr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pokr-row { width: 100%; min-height: 44px; display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; padding: 10px 14px;
  border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-bg-color); font: inherit; text-align: left; cursor: pointer; color: inherit; }
.pokr-row:hover { border-color: var(--el-color-primary-light-5); }
.pokr-row.empty { background: var(--el-fill-color-lighter); }
.pokr-row-name { font-weight: 600; overflow-wrap: anywhere; }
.pokr-row-name small { margin-left: 6px; font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); }
.pokr-row-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pokr-row-none { font-size: 13px; color: var(--el-text-color-placeholder); }
.pokr-row-meta { font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; }
.pokr-doc { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 16px 20px; }
.pokr-doc-head h2 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.pokr-doc-meta { margin: 4px 0 12px; font-size: 12px; color: var(--el-text-color-secondary); }
.pokr-empty { padding: 40px 16px; text-align: center; color: var(--el-text-color-secondary); background: var(--el-bg-color); border: 1px dashed var(--el-border-color); border-radius: 10px; }
.pokr-empty p { margin: 0 0 12px; overflow-wrap: anywhere; }
.pokr-empty-acts { display: flex; justify-content: center; gap: 8px; }
.pokr-ed-title { margin-bottom: 8px; }
.pokr-ed-md :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.md-body { line-height: 1.7; overflow-wrap: anywhere; }
.md-body :deep(h1), .md-body :deep(h2), .md-body :deep(h3), .md-body :deep(h4) { margin: 16px 0 6px; font-weight: 700; line-height: 1.4; }
.md-body :deep(h1) { font-size: 20px; }
.md-body :deep(h2) { font-size: 17px; }
.md-body :deep(h3) { font-size: 15px; }
.md-body :deep(p) { margin: 6px 0; }
.md-body :deep(ul), .md-body :deep(ol) { padding-left: 22px; margin: 6px 0; }
.md-body :deep(li) { margin: 2px 0; }
.md-body :deep(code) { background: var(--el-fill-color); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.md-body :deep(pre) { background: #1c1917; color: #faf9f7; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.md-body :deep(pre code) { background: transparent; color: inherit; padding: 0; }
.md-body :deep(blockquote) { border-left: 3px solid var(--el-border-color); margin: 8px 0; padding: 2px 12px; color: var(--el-text-color-secondary); }
.md-body :deep(.md-table-wrap) { overflow-x: auto; }
.md-body :deep(table) { border-collapse: collapse; margin: 8px 0; }
.md-body :deep(th), .md-body :deep(td) { border: 1px solid var(--el-border-color-lighter); padding: 4px 10px; }
@media (max-width: 768px) {
  .pokr-pick { width: 100%; }
  .pokr-pick :deep(.el-select__wrapper) { min-height: 44px; }
  .pokr-acts { width: 100%; }
  .pokr-acts .el-button, .pokr-empty-acts .el-button { flex: 1; min-height: 44px; }
  .pokr-row { grid-template-columns: minmax(0, 1fr); }
  .pokr-row-title { white-space: normal; }
  .pokr-doc { padding: 12px; }
}
</style>
