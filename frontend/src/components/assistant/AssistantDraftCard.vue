<!--
  AI 助手的草稿卡: 按类型列字段; 「改一改」就地编辑, 「确认」由服务端代调正常业务接口落库, 「丢弃」留记录。
  确认成功后变成「已创建 #id」+ 跳转链接; 失败显示业务错误原文(不吞)。状态在服务端, 翻历史会话时照样显示
-->
<template>
  <div class="ai-draft" :class="[`is-${draft.status.toLowerCase()}`, { editing }]">
    <div class="d-head">
      <span class="d-kind" :class="`k-${draft.kind}`">{{ $t(`assistant.kind_${draft.kind}`) }}</span>
      <span class="d-label">{{ $t('assistant.draft') }}</span>
      <span v-if="draft.status === 'SUBMITTED'" class="d-done">
        <el-icon><CircleCheckFilled /></el-icon>{{ $t('assistant.created', { p0: draft.resultId }) }}
        <router-link v-if="draft.link" :to="draft.link" class="d-link" @click="$emit('navigate')">{{ $t('assistant.open_link') }}</router-link>
      </span>
      <span v-else-if="draft.status === 'DISCARDED'" class="d-muted">{{ $t('assistant.discarded') }}</span>
    </div>

    <!-- 只读视图 -->
    <dl v-if="!editing" class="d-fields">
      <template v-for="f in fields" :key="f.key">
        <dt>{{ $t(f.label) }}</dt>
        <dd :class="{ need: isMissing(f.key), multiline: f.type === 'textarea' }">
          <template v-if="isMissing(f.key)">{{ $t('assistant.need') }}</template>
          <template v-else>{{ display(f) }}</template>
        </dd>
      </template>
      <template v-if="draft.kind === 'comment'">
        <dt>{{ $t('assistant.f_mentions') }}</dt>
        <dd>
          <span v-if="!draft.mentions.length">—</span>
          <el-tag v-for="m in draft.mentions" :key="m.userId" size="small" effect="plain" class="mention">@{{ m.name }}</el-tag>
        </dd>
      </template>
    </dl>

    <!-- 改一改 -->
    <el-form v-else label-position="top" size="default" class="d-form" @submit.prevent>
      <el-form-item v-for="f in editableFields" :key="f.key" :label="$t(f.label)" :required="required.includes(f.key)">
        <el-select v-if="f.type === 'project'" v-model="form[f.key]" filterable style="width: 100%" @change="onProjectChange">
          <el-option v-for="p in projectOptions" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-select v-else-if="f.type === 'member'" v-model="form[f.key]" filterable clearable style="width: 100%">
          <el-option v-for="m in memberOptions" :key="m.userId" :label="m.name" :value="m.userId" />
        </el-select>
        <el-select v-else-if="f.type === 'priority'" v-model="form[f.key]" style="width: 100%">
          <el-option v-for="p in PRIORITIES" :key="p" :label="$t(`assistant.p_${p}`)" :value="p" />
        </el-select>
        <el-date-picker v-else-if="f.type === 'date'" v-model="form[f.key]" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        <el-input-number v-else-if="f.type === 'hours'" v-model="form[f.key]" :min="0.25" :max="24" :step="0.5" style="width: 100%" />
        <el-input v-else-if="f.type === 'textarea'" v-model="form[f.key]" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" />
        <el-input v-else v-model="form[f.key]" />
      </el-form-item>
    </el-form>

    <div v-if="draft.warnings?.length && draft.status === 'PENDING'" class="d-warn">
      <div v-for="(w, i) in draft.warnings" :key="i">⚠ {{ w }}</div>
    </div>
    <div v-if="missingNow.length && draft.status === 'PENDING' && !editing" class="d-warn">
      {{ $t('assistant.missing_hint', { p0: missingNow.map((k) => $t(labelOf(k))).join('、') }) }}
    </div>
    <div v-if="draft.lastError && draft.status === 'PENDING'" class="d-error" role="alert">
      {{ $t('assistant.confirm_failed') }}{{ draft.lastError }}
    </div>

    <div v-if="draft.status === 'PENDING'" class="d-actions">
      <el-button size="small" :disabled="busy" @click="discard">{{ $t('assistant.discard') }}</el-button>
      <el-button v-if="!editing" size="small" :disabled="busy" @click="startEdit">{{ $t('assistant.edit') }}</el-button>
      <el-button v-else size="small" :disabled="busy" @click="finishEdit">{{ $t('assistant.done_edit') }}</el-button>
      <el-button type="primary" size="small" :loading="busy" :disabled="!editing && missingNow.length > 0" @click="confirm">{{ $t('assistant.confirm') }}</el-button>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheckFilled } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'

const props = defineProps({ draft: { type: Object, required: true } })
defineEmits(['navigate'])

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
// 每类草稿的字段: key / 文案 / 类型(决定显示与编辑控件)
const FIELDS = {
  task: [
    ['projectId', 'f_project', 'project'], ['title', 'f_title'], ['assigneeUserId', 'f_assignee', 'member'],
    ['dueDate', 'f_due', 'date'], ['priority', 'f_priority', 'priority'], ['description', 'f_description', 'textarea']
  ],
  requirement: [
    ['projectId', 'f_project', 'project'], ['title', 'f_title'], ['priority', 'f_priority', 'priority'],
    ['ownerId', 'f_owner', 'member'], ['detail', 'f_detail', 'textarea']
  ],
  timesheet: [
    ['projectId', 'f_project', 'project'], ['workDate', 'f_work_date', 'date'], ['hours', 'f_hours', 'hours'],
    ['workContent', 'f_work_content', 'textarea'], ['taskId', 'f_task', 'readonly']
  ],
  comment: [['entityId', 'f_target', 'readonly'], ['content', 'f_content', 'textarea']]
}
const REQUIRED = {
  task: ['projectId', 'title'], requirement: ['projectId', 'title'],
  timesheet: ['projectId', 'workDate', 'hours', 'workContent'], comment: ['entityId', 'content']
}
const LABEL = Object.fromEntries(Object.values(FIELDS).flat().map(([k, l]) => [k, `assistant.${l}`]))
const labelOf = (k) => LABEL[k] || k

const required = computed(() => REQUIRED[props.draft.kind] || [])
const fields = computed(() => (FIELDS[props.draft.kind] || [])
  .map(([key, label, type = 'text']) => ({ key, label: `assistant.${label}`, type }))
  // 选填且没值的不占地方(描述、关联任务等)
  .filter((f) => required.value.includes(f.key) || has(props.draft.payload[f.key])))
const editableFields = computed(() => (FIELDS[props.draft.kind] || [])
  .map(([key, label, type = 'text']) => ({ key, label: `assistant.${label}`, type }))
  .filter((f) => f.type !== 'readonly'))

const has = (v) => v !== undefined && v !== null && v !== ''
const missingNow = computed(() => required.value.filter((k) => !has(props.draft.payload[k])))
const isMissing = (k) => required.value.includes(k) && !has(props.draft.payload[k])

const projectOptions = computed(() => props.draft.options?.projects || [])
const memberOptions = ref(props.draft.options?.members || [])

function display(f) {
  const v = props.draft.payload[f.key]
  const name = props.draft.names?.[f.key]
  if (f.type === 'priority') return $t(`assistant.p_${v}`)
  if (f.type === 'hours') return `${v} h`
  if (f.type === 'project') return name || projectOptions.value.find((p) => p.id === String(v))?.name || `#${v}`
  if (f.type === 'member') return name || memberOptions.value.find((m) => m.userId === String(v))?.name || `#${v}`
  if (f.type === 'readonly') return name || `#${v}`
  return v
}

// ---------- 改一改 ----------
const editing = ref(false)
const form = reactive({})
function startEdit() {
  for (const k of Object.keys(form)) delete form[k]
  Object.assign(form, props.draft.payload)
  editing.value = true
}
async function onProjectChange(id) {
  // 换了项目: 负责人要从新项目的成员里选
  form.assigneeUserId = undefined
  form.ownerId = undefined
  try {
    const p = await fde.projects.detail(id)
    const out = []
    for (const m of p.members || []) {
      const u = m.user || m.engineer?.user
      if (!m.leaveDate && u && !out.some((x) => x.userId === String(u.id))) out.push({ userId: String(u.id), name: u.name })
    }
    memberOptions.value = out
  } catch { memberOptions.value = [] }
}
function finishEdit() {
  const d = props.draft
  d.payload = Object.fromEntries(Object.entries(form).filter(([, v]) => has(v)))
  const names = { ...d.names }
  for (const f of editableFields.value) {
    if (f.type === 'project') names[f.key] = projectOptions.value.find((p) => p.id === String(form[f.key]))?.name
    if (f.type === 'member') names[f.key] = memberOptions.value.find((m) => m.userId === String(form[f.key]))?.name
  }
  d.names = names
  d.warnings = []
  d.edited = true   // 只有人改过才把 payload 带给服务端(审计里的 edited 才是真的)
  editing.value = false
}

// ---------- 确认 / 丢弃 ----------
const busy = ref(false)
async function confirm() {
  if (editing.value) finishEdit()
  if (missingNow.value.length) return
  busy.value = true
  try {
    const r = await fde.assistant.confirmDraft(props.draft.id, props.draft.edited ? props.draft.payload : undefined)
    Object.assign(props.draft, r)
    ElMessage.success($t('assistant.created', { p0: r.resultId }))
  } catch (e) {
    // 业务错误原文(如「项目已关闭，不能再建任务」)留在卡片上, 不只是一闪而过的提示
    props.draft.lastError = e.message
  } finally {
    busy.value = false
  }
}
async function discard() {
  try {
    await ElMessageBox.confirm($t('assistant.discard_confirm'), $t('assistant.discard'), { type: 'warning' })
  } catch { return }
  busy.value = true
  try {
    Object.assign(props.draft, await fde.assistant.discardDraft(props.draft.id))
    editing.value = false
  } catch (e) {
    props.draft.lastError = e.message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.ai-draft { border: 1px solid #e7e5e4; border-radius: 10px; background: #fff; margin-top: 8px; overflow: hidden; }
.ai-draft.is-discarded { opacity: 0.6; }
.ai-draft.is-submitted { border-color: #bbf7d0; }
.d-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 12px; background: #fafaf9; border-bottom: 1px solid #f0eeeb; }
.d-kind { padding: 0 8px; border-radius: 4px; font-size: 12px; font-weight: 600; line-height: 20px; color: #fff; background: #57534e; }
.d-kind.k-task { background: #2563eb; }
.d-kind.k-requirement { background: #7c3aed; }
.d-kind.k-timesheet { background: #0f766e; }
.d-kind.k-comment { background: #b45309; }
.d-label { font-size: 13px; font-weight: 600; color: #44403c; margin-right: auto; }
.d-done { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: #15803d; font-weight: 600; }
.d-link { margin-left: 6px; color: #2563eb; font-weight: 500; text-decoration: none; }
.d-link:hover { text-decoration: underline; }
.d-muted { font-size: 13px; color: #a8a29e; }
.d-fields { display: grid; grid-template-columns: 64px 1fr; gap: 6px 10px; margin: 0; padding: 10px 12px; font-size: 13px; }
.d-fields dt { color: #78716c; }
.d-fields dd { margin: 0; color: #1c1917; word-break: break-word; }
.d-fields dd.multiline { white-space: pre-wrap; }
.d-fields dd.need { color: #dc2626; font-weight: 600; }
.mention { margin: 0 4px 2px 0; }
.d-form { padding: 10px 12px 0; }
.d-form :deep(.el-form-item) { margin-bottom: 10px; }
.d-form :deep(.el-form-item__label) { margin-bottom: 2px; line-height: 20px; font-size: 12px; }
.d-warn { font-size: 12px; color: #b45309; padding: 6px 12px; border-top: 1px dashed #f0eeeb; line-height: 1.6; }
.d-error { font-size: 13px; color: #dc2626; padding: 8px 12px; background: #fef2f2; border-top: 1px solid #fecaca; line-height: 1.5; word-break: break-word; }
.d-actions { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 12px; border-top: 1px solid #f0eeeb; }
.d-actions .el-button + .el-button { margin-left: 0; }

/* 手机: 按钮等分、够大(≥44px) */
@media (max-width: 767px) {
  .d-fields { font-size: 14px; grid-template-columns: 72px 1fr; }
  .d-actions { padding: 10px 12px; }
  .d-actions .el-button { flex: 1; min-height: 44px; font-size: 15px; }
}
</style>
