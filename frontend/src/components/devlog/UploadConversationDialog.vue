<template>
  <!-- 0.5.1 上传对话文件: Claude Code jsonl / Codex 日志 / 带角色标记的文本 → 开发会话 + 自动摘要。
       一次请求传一个文件, 好逐个显示进度和结果(后端也支持一次多个) -->
  <el-dialog :model-value="modelValue" :title="$t('conversations.upload_title')" width="680px" class="upload-dialog"
    append-to-body :close-on-click-modal="!running" @update:model-value="v => emit('update:modelValue', v)" @closed="reset">
    <template v-if="!started">
      <div class="drop" :class="{ over: dragOver }" data-test="upload-drop"
        @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false" @drop.prevent="onDrop" @click="pick">
        <el-icon class="drop-icon"><UploadFilled /></el-icon>
        <p class="drop-main">{{ $t('conversations.upload_drop') }}</p>
        <p class="drop-sub">{{ $t('conversations.upload_drop_sub') }} <a class="pick">{{ $t('conversations.upload_pick') }}</a></p>
        <input ref="input" type="file" multiple :accept="UPLOAD_ACCEPT" class="hidden-input" data-test="upload-input" @change="onPick">
      </div>
      <p class="limits">{{ $t('conversations.upload_limits', { max: UPLOAD_MAX_FILES }) }}</p>

      <ul v-if="files.length" class="file-list" data-test="upload-files">
        <li v-for="(f, i) in files" :key="f.name + f.size" class="file-row">
          <el-icon class="file-icon"><Document /></el-icon>
          <div class="file-main">
            <span class="file-name">{{ f.name }}</span>
            <span class="file-meta">
              {{ formatSize(f.size) }}
              <span v-if="checkFile(f)" class="bad">· {{ $t('conversations.upload_' + checkFile(f)) }}</span>
            </span>
          </div>
          <el-button link type="danger" :aria-label="$t('conversations.upload_remove')" @click="files.splice(i, 1)">
            {{ $t('conversations.upload_remove') }}
          </el-button>
        </li>
      </ul>

      <div class="opts">
        <el-select v-model="form.stage" :placeholder="$t('conversations.upload_stage_auto')" clearable class="opt">
          <el-option v-for="s in STAGES" :key="s" :value="s" :label="$t('conversations.stages.' + s)" />
        </el-select>
        <el-select v-model="form.projectId" :placeholder="$t('conversations.upload_project_none')" clearable filterable
          :loading="projectsLoading" class="opt">
          <el-option v-for="p in projects" :key="p.id" :value="String(p.id)" :label="p.name" />
        </el-select>
      </div>
    </template>

    <div v-else class="results" data-test="upload-results">
      <ul class="progress">
        <li v-for="j in jobs" :key="j.key" class="job">
          <span class="job-name">{{ j.name }}</span>
          <span v-if="j.state === 'waiting'" class="muted">{{ $t('conversations.upload_waiting') }}</span>
          <span v-else-if="j.state === 'running'" class="muted"><el-icon class="is-loading"><Loading /></el-icon> {{ $t('conversations.upload_running') }}</span>
          <el-icon v-else-if="j.state === 'done'" class="ok-icon"><CircleCheckFilled /></el-icon>
          <el-icon v-else class="fail-icon"><CircleCloseFilled /></el-icon>
        </li>
      </ul>

      <template v-if="okItems.length">
        <h4 class="sec ok">{{ $t('conversations.upload_ok_title', { n: okItems.length }) }}</h4>
        <ul class="ok-list" data-test="upload-ok">
          <li v-for="it in okItems" :key="it.conversationId" class="ok-row" @click="openDetail(it.conversationId)">
            <div class="ok-head">
              <strong class="ok-title">{{ it.title || it.file }}</strong>
              <el-tag size="small" effect="plain" :type="it.created ? 'success' : 'info'">
                {{ it.created ? $t('conversations.upload_created') : $t('conversations.upload_updated') }}
              </el-tag>
            </div>
            <div class="ok-meta">
              {{ $t('conversations.sources.' + it.source) }} · {{ $t('conversations.stages.' + it.stage) }} ·
              {{ $t('conversations.upload_turns', { n: it.turns }) }} · <span class="muted">{{ it.file }}</span>
            </div>
            <p v-if="it.summary" class="ok-summary">{{ summaryLead(it.summary) }}</p>
          </li>
        </ul>
      </template>

      <template v-if="failItems.length">
        <h4 class="sec fail">{{ $t('conversations.upload_fail_title', { n: failItems.length }) }}</h4>
        <ul class="fail-list" data-test="upload-fail">
          <li v-for="(e, i) in failItems" :key="e.file + i" class="fail-row">
            <strong>{{ e.file }}</strong>
            <span>{{ e.message }}</span>
          </li>
        </ul>
      </template>
    </div>

    <template #footer>
      <div class="footer">
        <template v-if="!started">
          <el-button @click="emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" :disabled="!files.length" data-test="upload-submit" @click="start">
            {{ $t('conversations.upload_start') }}
          </el-button>
        </template>
        <template v-else>
          <el-button :disabled="running" @click="reset">{{ $t('conversations.upload_more') }}</el-button>
          <el-button type="primary" :disabled="running" @click="emit('update:modelValue', false)">{{ $t('common.close') }}</el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document, Loading, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { STAGES } from '@/views/admin/conversations/conversationUtils.js'
import { UPLOAD_ACCEPT, UPLOAD_MAX_FILES, formatSize, checkFile, mergeFiles, summaryLead } from './uploadUtils.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'saved'])
const router = useRouter()

const input = ref(null)
const files = ref([])
const dragOver = ref(false)
const form = reactive({ stage: '', projectId: '' })
const projects = ref([])
const projectsLoading = ref(false)
const started = ref(false)
const running = ref(false)
const jobs = ref([])

const okItems = computed(() => jobs.value.flatMap(j => j.items))
const failItems = computed(() => jobs.value.flatMap(j => j.errors))

watch(() => props.modelValue, (open) => { if (open && !projects.value.length) loadProjects() })

async function loadProjects() {
  projectsLoading.value = true
  try { projects.value = (await fde.projects.list({ page_size: 200 })).list || [] } catch { projects.value = [] } finally { projectsLoading.value = false }
}

function addFiles(list) {
  const { list: merged, dropped } = mergeFiles(files.value, [...list])
  files.value = merged
  if (dropped) ElMessage.warning($t('conversations.upload_too_many', { max: UPLOAD_MAX_FILES }))
}
function pick() { input.value?.click() }
function onPick(e) { addFiles(e.target.files || []); e.target.value = '' }
function onDrop(e) { dragOver.value = false; addFiles(e.dataTransfer?.files || []) }

async function start() {
  started.value = true
  running.value = true
  jobs.value = files.value.map((f, i) => ({ key: `${i}-${f.name}`, name: f.name, file: f, state: 'waiting', items: [], errors: [] }))
  for (const job of jobs.value) {
    // 前端能判断的(太大 / 类型不对)直接给原因, 不白传
    const bad = checkFile(job.file)
    if (bad) { job.state = 'failed'; job.errors = [{ file: job.name, message: $t('conversations.upload_' + bad) }]; continue }
    job.state = 'running'
    const fd = new FormData()
    fd.append('files', job.file, job.name)
    if (form.stage) fd.append('stage', form.stage)
    if (form.projectId) fd.append('projectId', form.projectId)
    try {
      const d = await fde.devConversations.upload(fd)
      job.items = d?.items || []
      job.errors = d?.errors || []
    } catch (e) {
      job.errors = [{ file: job.name, message: e.message }]
    }
    job.state = job.items.length ? 'done' : 'failed'
  }
  running.value = false
  if (okItems.value.length) emit('saved')
  ElMessage({ type: failItems.value.length ? 'warning' : 'success', message: $t('conversations.upload_done', { ok: okItems.value.length, fail: failItems.value.length }) })
}

function reset() {
  if (running.value) return
  files.value = []
  jobs.value = []
  started.value = false
  dragOver.value = false
}

function openDetail(id) {
  emit('update:modelValue', false)
  router.push(`/admin/conversations/${id}`)
}
</script>

<style scoped>
.drop {
  border: 1.5px dashed #d6d1c8; border-radius: 10px; padding: 26px 16px; text-align: center; cursor: pointer;
  background: #faf9f7; transition: border-color .15s, background .15s;
}
.drop:hover, .drop.over { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.drop-icon { font-size: 36px; color: #a8a29e; }
.drop-main { margin: 6px 0 4px; color: #1c1917; font-size: 14px; }
.drop-sub { margin: 0; color: #8f8a82; font-size: 12px; }
.pick { color: var(--el-color-primary); }
.hidden-input { display: none; }
.limits { margin: 8px 0 0; color: #8f8a82; font-size: 12px; }
.file-list, .progress, .ok-list, .fail-list { list-style: none; margin: 10px 0 0; padding: 0; }
.file-row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid #f0ede8; }
.file-icon { color: #a8a29e; flex: none; }
.file-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.file-name, .job-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1c1917; }
.file-meta { font-size: 12px; color: #8f8a82; }
.bad { color: var(--el-color-danger); }
.opts { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.opt { flex: 1; min-width: 180px; }
.job { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; }
.job-name { flex: 1; min-width: 0; }
.ok-icon { color: var(--el-color-success); }
.fail-icon { color: var(--el-color-danger); }
.sec { margin: 14px 0 4px; font-size: 13px; }
.sec.ok { color: var(--el-color-success); }
.sec.fail { color: var(--el-color-danger); }
.ok-row { padding: 8px 10px; border: 1px solid #ece8e1; border-radius: 8px; margin-bottom: 6px; cursor: pointer; }
.ok-row:hover { border-color: var(--el-color-primary-light-5); }
.ok-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ok-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ok-meta { font-size: 12px; color: #5c574f; margin-top: 2px; word-break: break-all; }
.ok-summary { margin: 4px 0 0; font-size: 13px; color: #1c1917; line-height: 1.5; }
.fail-row { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; background: #fef2f2; border-radius: 6px; margin-bottom: 6px; font-size: 13px; word-break: break-all; }
.fail-row span { color: #7f1d1d; }
.muted { color: #8f8a82; }
.footer { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
:global(.upload-dialog) { max-width: calc(100vw - 24px); }
@media (max-width: 480px) {
  .opt { min-width: 100%; }
  .footer :deep(.el-button) { flex: 1; margin-left: 0; }
}
</style>
