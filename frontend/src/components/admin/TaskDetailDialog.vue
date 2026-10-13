<template>
  <!-- 1.2.6: 任务详情弹窗组件 —— 从 Tasks.vue 抽出, 任务管理/项目详情/个人仪表盘共用
       props 传 taskId, 打开时拉取详情(含 assignee/project), 3 个 tab: 信息/子任务/评论 -->
  <!-- v1.9.13(#366): 标题带任务编号, 与看板/分享链接对得上 -->
  <el-dialog :model-value="modelValue" :title="task ? `#${task.id} ${task.title}` : $t('taskDetailDialog.task_details')" width="720px" top="6vh" @update:model-value="v => emit('update:modelValue', v)">
    <el-tabs v-model="tab" v-loading="loading">
      <!-- 详情信息 -->
      <el-tab-pane :label="$t('common.details')" name="info">
        <div v-if="task" class="detail-info">
          <!-- v2.12.0(#1255) 谁在做徽标, 置顶 -->
          <div v-if="task.activeWork" class="detail-aw-row">
            <ActiveWorkBadge :active-work="task.activeWork" :task-id="task.id" :task-title="task.title" />
          </div>
          <el-row :gutter="16">
            <el-col :span="8"><div class="info-label">{{ $t('common.project') }}</div><div class="info-value"><code>{{ task.project?.code }}</code> {{ task.project?.name }}</div></el-col>
            <el-col :span="8"><div class="info-label">{{ $t('common.assignee') }}</div><div class="info-value">{{ task.assignee?.name || '—' }}</div></el-col>
            <el-col :span="8"><div class="info-label">{{ $t('common.status') }}</div><div class="info-value"><el-tag :type="statusType(task.status)" effect="light">{{ statusLabel(task.status) }}</el-tag></div></el-col>
            <el-col :span="8" style="margin-top: 12px;"><div class="info-label">{{ $t('common.priority') }}</div><div class="info-value"><el-tag :type="priorityType(task.priority)" effect="dark">{{ priorityLabel(task.priority) }}</el-tag></div></el-col>
            <el-col :span="8" style="margin-top: 12px;"><div class="info-label">{{ $t('common.due') }}</div><div class="info-value" :class="{ overdue: isOverdue }">{{ formatDate(task.dueDate) || '—' }}</div></el-col>
            <el-col :span="8" style="margin-top: 12px;"><div class="info-label">{{ $t('common.created') }}</div><div class="info-value">{{ formatDateTime(task.createdAt) }}</div></el-col>
            <el-col :span="8" style="margin-top: 12px;"><div class="info-label">{{ $t('common.milestone') }}</div><div class="info-value">{{ task.milestone?.name || '—' }}</div></el-col>
            <!-- v2.1.13(#563) 任务来源标注 -->
            <el-col :span="8" style="margin-top: 12px;">
              <div class="info-label">{{ $t('common.source') }}</div>
              <div class="info-value">
                <el-tag v-if="task.source" size="small" effect="plain" :type="SOURCE_TYPES[task.source] || 'info'">{{ SOURCE_LABELS[task.source] || task.source }}</el-tag>
                <span v-else style="color:#bbb;">{{ $t('common.not_set') }}</span>
              </div>
            </el-col>
            <!-- v2.1.7(#494) 任务实耗: 已审批工时之和; 记工时=预填项目/任务/内容的一键报工 -->
            <el-col :span="8" style="margin-top: 12px;">
              <div class="info-label">{{ $t('taskDetailDialog.actual_hours') }}</div>
              <div class="info-value">
                <template v-if="task.actualHours"> <b>{{ task.actualHours }}</b> {{ $t('taskDetailDialog.h_people', { p0: task.participantCount }) }}</template>
                <span v-else style="color:#bbb;">—</span>
                <el-button v-if="can('timesheet.create')" size="small" link type="primary" style="margin-left:6px;" @click="openQuickLog">{{ $t('common.log_hours') }}</el-button>
              </div>
            </el-col>
            <!-- v1.9.7(#353): 计划起止 + 流转时间线 -->
            <el-col :span="8" v-if="plannedRange" style="margin-top: 12px;"><div class="info-label">{{ $t('taskDetailDialog.planned_dates') }}</div><div class="info-value">📅 {{ plannedRange }}</div></el-col>
            <el-col :span="24" v-if="flowTimeline.length" style="margin-top: 12px;">
              <div class="info-label">{{ $t('taskDetailDialog.timeline') }}</div>
              <div class="flow-timeline">
                <span v-for="(f, i) in flowTimeline" :key="f.label" class="flow-step">
                  <span v-if="i > 0" class="flow-arrow">→</span>
                  {{ f.label }} {{ formatDateTime(f.at) }}
                  <!-- v2.0.1(#395): 各阶段用时 -->
                  <span v-if="f.dur" class="flow-dur"> ({{ f.dur }})</span>
                </span>
                <span v-if="totalDuration" class="flow-step flow-total">{{ $t('taskDetailDialog.total_time', { p0: totalDuration }) }}</span>
              </div>
            </el-col>
            <!-- 1.2.7: 描述按 Markdown 渲染 (需求文档常以 MD 形式写在描述里) -->
            <el-col :span="24" v-if="task.description" style="margin-top: 12px;">
              <div class="info-label">{{ $t('common.description') }}</div>
              <div class="info-value md-body" v-html="renderedDescription"></div>
            </el-col>
          </el-row>
          <!-- v2.7(#1140): 可复用资产 —— 开工前先看看我们是不是已经做过 -->
          <div v-if="task.suggestedAssets?.length" class="asset-suggest">
            <div class="info-label">{{ $t('taskDetailDialog.assets_that_might_help') }}</div>
            <div v-for="a in task.suggestedAssets" :key="a.id" class="asset-sug-row">
              <el-tag size="small" effect="plain" :type="a.maturity >= 'L2' ? 'success' : 'info'">{{ a.maturity }}</el-tag>
              <router-link :to="`/admin/assets/${a.slug}`" class="asset-sug-name" @click="emit('update:modelValue', false)">{{ a.name }}</router-link>
              <span class="asset-sug-sum">{{ a.summary }}</span>
              <span class="asset-sug-hit">{{ $t('taskDetailDialog.matched', { p0: a.matchedOn.join($t('common.list_sep')) }) }}<template v-if="a.estSavedDays"> {{ $t('taskDetailDialog.saves_about_person_days', { p0: Number(a.estSavedDays) }) }}</template></span>
            </div>
          </div>
          <!-- v1.4.x 附件: 需求文档/设计稿随任务同步 -->
          <div class="att-block">
            <div class="info-label" style="margin-top: 12px;">{{ $t('taskDetailDialog.attachments', { p0: taskAttachments.length }) }}</div>
            <div v-for="a in taskAttachments" :key="a.id" class="att-row">
              📎 <el-link :href="a.fileUrl" target="_blank" type="primary">{{ a.filename }}</el-link>
              <span class="att-meta">{{ fmtSize(a.fileSize) }}<template v-if="a.uploaderName"> · {{ a.uploaderName }}</template></span>
              <el-button v-if="canRemoveAtt(a)" link type="danger" size="small" @click="removeAttachment(a)">{{ $t('common.delete_2') }}</el-button>
            </div>
            <el-upload v-if="can('task.edit')" :http-request="uploadTaskAttachment" :show-file-list="false" multiple style="margin-top: 6px;">
              <el-button size="small" :loading="attUploading">{{ $t('common.upload_attachment') }}</el-button>
            </el-upload>
          </div>

          <div class="detail-actions">
            <el-button v-for="act in nextActions(task.status)" :key="act.to" :type="act.type" size="small" :disabled="!can('task.changeStatus')" @click="quickChange(act.to)">
              {{ act.label }}
            </el-button>
            <el-button v-if="can('task.edit')" size="small" @click="emit('edit', task)">{{ $t('common.edit_task') }}</el-button>
            <el-button size="small" @click="shareTask">{{ $t('taskDetailDialog.share_link') }}</el-button>
            <el-button size="small" @click="copyTask">{{ $t('taskDetailDialog.copy_task') }}</el-button>
            <el-button v-if="can('task.delete')" size="small" type="danger" plain @click="deleteTask">{{ $t('taskDetailDialog.delete_task') }}</el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- 子任务 (v1.9.3: 原「检查清单」改名, 与平台 subtask 概念对齐) -->
      <el-tab-pane :label="$t('taskDetailDialog.subtasks', { p0: subtasks.done, p1: subtasks.total || 0 })" name="subtasks">
        <div class="subtask-progress" v-if="subtasks.total">
          <el-progress :percentage="subtasks.progress" :stroke-width="8" :color="['#2e7d4f', '#b3450f', '#c2362b']" />
        </div>
        <div v-for="s in subtasks.list" :key="s.id" class="subtask-item">
          <el-checkbox v-model="s.doneLocal" @change="toggleSubtask(s)">{{ s.title }}</el-checkbox>
          <el-button link size="small" type="danger" @click="removeSubtask(s)">{{ $t('common.delete_2') }}</el-button>
        </div>
        <el-empty v-if="!subtasks.list.length" :image-size="60" :description="$t('taskDetailDialog.no_items_yet')" />
        <div class="add-subtask">
          <el-input v-model="newSubtask" :placeholder="$t('taskDetailDialog.new_item')" @keyup.enter="addSubtask" size="small" />
          <el-button type="primary" size="small" @click="addSubtask" :disabled="!newSubtask.trim()">{{ $t('common.add') }}</el-button>
        </div>
      </el-tab-pane>

      <!-- 评论 @提及 -->
      <el-tab-pane :label="$t('taskDetailDialog.comments', { p0: comments.length })" name="comments">
        <div class="comment-list">
          <div v-for="c in comments" :key="c.id" class="comment-item">
            <el-avatar :size="28" style="background: #d2521e;">{{ c.author?.name?.slice(0,1) }}</el-avatar>
            <div class="comment-body">
              <div class="comment-head">
                <strong>{{ c.author?.name }}</strong>
                <el-tag size="small" effect="plain">{{ c.author?.role }}</el-tag>
                <span class="comment-time">{{ formatDate(c.createdAt) }}</span>
              </div>
              <div class="comment-content">
                <span v-html="renderContent(c.content)"></span>
              </div>
              <!-- v1.4.x 评论附件 -->
              <div v-for="a in commentAttachments(c.id)" :key="a.id" class="att-row" style="margin-top: 4px;">
                📎 <el-link :href="a.fileUrl" target="_blank" type="primary" style="font-size: 12px;">{{ a.filename }}</el-link>
                <span class="att-meta">{{ fmtSize(a.fileSize) }}</span>
              </div>
              <el-button v-if="String(c.author?.id) === String(currentUserId) || user?.role === 'ADMIN'" link size="small" type="danger" @click="removeComment(c)">{{ $t('common.delete_2') }}</el-button>
            </div>
          </div>
          <el-empty v-if="!comments.length" :image-size="60" :description="$t('taskDetailDialog.no_comments_yet')" />
        </div>
        <div class="add-comment">
          <!-- 1.2.7: @ 提及自动补全, 不用记同事名字 -->
          <el-mention v-model="newComment" type="textarea" :rows="2" :options="mentionOptions" whole :placeholder="$t('taskDetailDialog.say_something_type_mention_teammate')" />
          <!-- v1.4.x: 评论可带附件 (先暂存, 发送时随评论绑定) -->
          <div v-if="pendingCommentAtts.length" style="margin-top: 6px;">
            <div v-for="(a, i) in pendingCommentAtts" :key="i" class="att-row">
              📎 <span style="font-size: 12px;">{{ a.filename }}</span>
              <el-button link type="danger" size="small" @click="pendingCommentAtts.splice(i, 1)">{{ $t('common.remove') }}</el-button>
            </div>
          </div>
          <div class="add-comment-foot">
            <span class="hint">{{ $t('taskDetailDialog.tip_type_pick_teammate') }}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <el-upload :http-request="uploadCommentAttachment" :show-file-list="false" multiple>
                <el-button size="small" :loading="attUploading">{{ $t('taskDetailDialog.attachments_2') }}</el-button>
              </el-upload>
              <el-button type="primary" size="small" :loading="commentSubmitting" @click="addComment" :disabled="!newComment.trim() && !pendingCommentAtts.length">{{ $t('common.send') }}</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

  </el-dialog>

  <!-- v2.1.7(#494) 一键报工: 预填项目/任务/内容, 只填日期与小时数 -->
  <el-dialog v-model="quickLog.visible" :title="$t('common.log_hours')" width="400px" append-to-body>
    <el-form label-width="70px" size="default">
      <el-form-item :label="$t('common.task')"><span style="font-size:13px;">#{{ task?.id }} {{ task?.title }}</span></el-form-item>
      <el-form-item :label="$t('common.date')"><el-date-picker v-model="quickLog.workDate" type="date" value-format="YYYY-MM-DD" style="width:100%;" /></el-form-item>
      <el-form-item :label="$t('common.hours_h')"><el-input-number v-model="quickLog.hours" :min="0.25" :max="24" :step="0.25" style="width:100%;" /></el-form-item>
      <el-form-item :label="$t('common.content')"><el-input v-model="quickLog.workContent" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="quickLog.visible = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="quickLog.saving" :disabled="!quickLog.workDate || !quickLog.hours" @click="submitQuickLog">{{ $t('taskDetailDialog.log_work') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { withBase } from '@/utils/base.js'
import { $t } from '@/i18n'
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import ActiveWorkBadge from '@/components/common/ActiveWorkBadge.vue'   // v2.12.0(#1255)

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  taskId: { type: [String, Number], default: null }
})
const emit = defineEmits(['update:modelValue', 'changed', 'edit'])

const user = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')
const currentUserId = computed(() => user?.id)

const task = ref(null)
const tab = ref('info')
const loading = ref(false)

// v1.9.7(#353): 任务状态流重构为五态, 新增 QUEUED(等候生产)
const STATUS_LABELS = { TODO: $t('common.inbox'), QUEUED: $t('common.queued'), IN_PROGRESS: $t('common.in_progress_2'), DONE: $t('common.built'), VERIFIED: $t('common.accepted'), REWORK: $t('taskDetailDialog.rework_legacy') }
const STATUS_TYPES = { TODO: 'info', QUEUED: 'warning', IN_PROGRESS: 'primary', DONE: 'success', VERIFIED: 'success' }
const PRIORITY_LABELS = { LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high'), URGENT: $t('common.urgent') }
const PRIORITY_TYPES = { LOW: 'info', MEDIUM: 'primary', HIGH: 'warning', URGENT: 'danger' }
// v2.1.13(#563) 任务来源标注
const SOURCE_LABELS = { CUSTOMER: $t('common.customer_request'), REVIEW: $t('common.review'), PATROL: $t('common.patrol'), SELF: $t('common.self_initiated') }
const SOURCE_TYPES = { CUSTOMER: 'danger', REVIEW: 'warning', PATROL: 'info', SELF: 'success' }
function statusLabel(s) { return STATUS_LABELS[s] || s }
function statusType(s) { return STATUS_TYPES[s] || 'info' }
function priorityLabel(p) { return PRIORITY_LABELS[p] || p }
function priorityType(p) { return PRIORITY_TYPES[p] || 'info' }
function formatDate(s) { return s ? String(s).slice(0, 10) : '' }
// v1.9.13(#364): 时间线精确到时分(本地时区; 原 slice 截 UTC 只有日期, 参考价值有限)
function formatDateTime(s) {
  if (!s) return ''
  const d = new Date(s)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const isOverdue = computed(() => {
  const t = task.value
  return t?.dueDate && ['TODO', 'QUEUED', 'IN_PROGRESS'].includes(t.status) && new Date(t.dueDate) < new Date()
})

// v2.0.1(#395): 阶段耗时格式化
function fmtDur(ms) {
  if (!isFinite(ms) || ms <= 0) return null
  const m = Math.round(ms / 60000)
  if (m < 1) return $t('taskDetailDialog.within_1_min')
  if (m < 60) return $t('taskDetailDialog.min', { p0: m })
  const h = ms / 3600000
  if (h < 24) return $t('taskDetailDialog.h', { p0: h.toFixed(1) })
  return $t('taskDetailDialog.d_h', { p0: Math.floor(h / 24), p1: Math.round(h % 24) })
}
// v1.9.7(#353): 流转时间线; v2.0.1(#395): 每段标注距上一节点的用时
const flowTimeline = computed(() => {
  const t = task.value
  if (!t) return []
  const points = [
    { label: $t('common.created'), at: t.createdAt },
    { label: $t('taskDetailDialog.move_queue'), at: t.queuedAt },
    { label: $t('common.start_work'), at: t.startedAt },
    { label: $t('common.built'), at: t.completedAt }
  ].filter(x => x.at)
  for (let i = 1; i < points.length; i++) {
    points[i].dur = fmtDur(new Date(points[i].at) - new Date(points[i - 1].at))
  }
  return points
})
// v2.0.1(#395): 总用时 = 创建 → 生产完成
const totalDuration = computed(() => {
  const t = task.value
  if (!t?.completedAt || !t?.createdAt) return null
  return fmtDur(new Date(t.completedAt) - new Date(t.createdAt))
})
const plannedRange = computed(() => {
  const t = task.value
  if (!t || (!t.plannedStartAt && !t.plannedEndAt)) return ''
  return `${formatDate(t.plannedStartAt) || '?'} ~ ${formatDate(t.plannedEndAt) || '?'}`
})

// 1.2.7: 描述 Markdown 渲染
const renderedDescription = computed(() => {
  const desc = task.value?.description
  if (!desc) return ''
  try { return marked.parse(desc) } catch { return desc }
})

// v1.9.13(#365): 剪贴板统一入口 —— http 访问(生产 80 不跳 https)时 navigator.clipboard 不存在,
// 降级走隐藏 textarea + execCommand
async function writeClipboard(text) {
  // API 存在也可能被权限策略拒绝(企业策略/内嵌 webview), 失败一律落回 execCommand
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch { /* fallthrough */ }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  if (!ok) throw new Error('copy failed')
}

// 1.2.7: 一键复制任务 (Markdown 格式, 可直接贴到群/文档)
async function copyTask() {
  const t = task.value
  if (!t) return
  const md = [
    `# ${t.title}`,
    '',
    $t('taskDetailDialog.project', { p0: t.project?.code || '', p1: t.project?.name || '' }),
    $t('taskDetailDialog.status_priority', { p0: statusLabel(t.status), p1: priorityLabel(t.priority) }),
    $t('taskDetailDialog.assignee_due', { p0: t.assignee?.name || $t('common.unassigned'), p1: formatDate(t.dueDate) || '—' }),
    t.milestone?.name ? $t('taskDetailDialog.milestone', { p0: t.milestone.name }) : null,
    '',
    t.description || ''
  ].filter(v => v !== null).join('\n')
  try {
    await writeClipboard(md)
    ElMessage.success($t('taskDetailDialog.task_copied_markdown'))
  } catch {
    ElMessage.error($t('taskDetailDialog.copy_failed_check_browsers_clipboard_permission'))
  }
}

// v1.9.13(#365): 分享链接 —— 复制 /admin/tasks?open=<id> 深链(v1.4.x 通知直达同款),
// 同事点开直达任务详情弹窗; 未登录会先到登录页, 登录后守卫按 redirect 带回
async function shareTask() {
  const t = task.value
  if (!t) return
  const url = `${location.origin}${withBase('/admin/tasks')}?open=${t.id}`
  try {
    await writeClipboard($t('taskDetailDialog.task', { p0: t.id, p1: t.title, p2: url }))
    ElMessage.success($t('taskDetailDialog.share_link_copied_send_it_teammate'))
  } catch {
    ElMessage.error($t('taskDetailDialog.copy_failed_check_browsers_clipboard_permission'))
  }
}

// 1.2.7: 经理/管理员可直接在详情删除任务
async function deleteTask() {
  try { await ElMessageBox.confirm($t('taskDetailDialog.delete_this_task_this_cant_be'), $t('common.confirm'), { type: 'warning' }) } catch { return }
  try {
    await fde.tasks.remove(props.taskId)
    ElMessage.success($t('common.deleted'))
    emit('changed')
    emit('update:modelValue', false)
  } catch (e) { ElMessage.error(e.message) }
}

// 1.2.7: @ 提及候选 (懒加载一次)
const mentionOptions = ref([])
async function loadMentionable() {
  if (mentionOptions.value.length) return
  try {
    const data = await fde.users.mentionable()
    mentionOptions.value = (data.list || []).map(u => ({ label: `${u.name} (${u.username})`, value: u.name }))
  } catch { /* 拉不到就退化为手输 */ }
}

// v1.9.7(#353): 五态快捷流转 TODO→QUEUED→IN_PROGRESS→DONE→VERIFIED
function nextActions(s) {
  const map = {
    TODO: [{ to: 'QUEUED', label: $t('common.move_queue'), type: 'warning' }],
    QUEUED: [{ to: 'IN_PROGRESS', label: $t('common.start_work'), type: 'primary' }],
    IN_PROGRESS: [{ to: 'DONE', label: $t('common.built'), type: 'success' }],
    DONE: [{ to: 'VERIFIED', label: $t('common.accept'), type: 'success' }],
    VERIFIED: []
  }
  return map[s] || []
}

async function loadTask() {
  if (!props.taskId) return
  loading.value = true
  try {
    task.value = await fde.tasks.get(props.taskId)
    tab.value = 'info'
    loadSubtasks()
    loadComments()
    loadMentionable()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

// ============ v2.1.7(#494) 一键报工 ============
const quickLog = reactive({ visible: false, saving: false, workDate: '', hours: 8, workContent: '' })
function openQuickLog() {
  const d = new Date(); const p2 = n => String(n).padStart(2, '0')
  quickLog.workDate = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  quickLog.hours = 8
  quickLog.workContent = task.value?.title || ''
  quickLog.visible = true
}
async function submitQuickLog() {
  quickLog.saving = true
  try {
    await fde.timesheets.create({
      projectId: task.value.project?.id || task.value.projectId,
      taskId: task.value.id,
      workDate: quickLog.workDate, hours: quickLog.hours,
      workContent: quickLog.workContent || task.value.title
    })
    ElMessage.success($t('taskDetailDialog.hours_submitted_waiting_for_approval'))
    quickLog.visible = false
    task.value = await fde.tasks.get(props.taskId)   // 刷新实耗(待审批不计入, 审批后可见)
  } catch (e) { ElMessage.error(e.message) } finally { quickLog.saving = false }
}

watch(() => [props.modelValue, props.taskId], ([visible]) => {
  if (visible) loadTask()
  else task.value = null
})

// v2.0.1(#391): 转等候生产不再强制填计划起止(主人反馈这步多余), 直接流转
async function quickChange(status) {
  try {
    await fde.tasks.changeStatus(props.taskId, status)
    task.value.status = status
    ElMessage.success($t('common.updated'))
    emit('changed')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// 子任务
const subtasks = reactive({ list: [], total: 0, done: 0, progress: 0 })
const newSubtask = ref('')
async function loadSubtasks() {
  if (!props.taskId) return
  try {
    const data = await fde.subtasks.list(props.taskId)
    subtasks.list = data.list.map(s => ({ ...s, doneLocal: s.done === 1 }))
    subtasks.total = data.total
    subtasks.done = data.done
    subtasks.progress = data.progress
  } catch (e) { ElMessage.error(e.message) }
}
async function addSubtask() {
  if (!newSubtask.value.trim() || !props.taskId) return
  try {
    await fde.subtasks.create({ taskId: props.taskId, title: newSubtask.value.trim() })
    newSubtask.value = ''
    loadSubtasks()
    ElMessage.success($t('taskDetailDialog.added'))
  } catch (e) { ElMessage.error(e.message) }
}
async function toggleSubtask(s) {
  try {
    await fde.subtasks.update(s.id, { done: s.doneLocal })
    loadSubtasks()
    emit('changed')  // 让父级列表同步子项进度
  } catch (e) { ElMessage.error(e.message) }
}
async function removeSubtask(s) {
  try {
    await fde.subtasks.remove(s.id)
    ElMessage.success($t('common.deleted'))
    loadSubtasks()
  } catch (e) { ElMessage.error(e.message) }
}

// ===== v1.4.x 附件 =====
const attUploading = ref(false)
const taskAttachments = computed(() => (task.value?.attachments || []).filter(a => !a.commentId))
function commentAttachments(commentId) {
  return (task.value?.attachments || []).filter(a => String(a.commentId) === String(commentId))
}
function fmtSize(s) { if (!s) return ''; const n = Number(s); return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB' }
function canRemoveAtt(a) { return String(a.uploadedBy) === String(currentUserId.value) || can('task.delete') }
async function uploadFile(file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fde.uploads.upload(fd)
  if (r.code !== 0) throw new Error(r.message || $t('common.upload_failed'))
  return { filename: file.name, fileUrl: r.data.url, fileSize: file.size }
}
async function uploadTaskAttachment({ file }) {
  attUploading.value = true
  try {
    const att = await uploadFile(file)
    await fde.tasks.addAttachment(props.taskId, att)
    ElMessage.success($t('common.attachment_uploaded'))
    task.value = await fde.tasks.get(props.taskId)
  } catch (e) { ElMessage.error(e.message || $t('common.upload_failed')) }
  finally { attUploading.value = false }
}
async function removeAttachment(a) {
  try {
    await fde.tasks.removeAttachment(a.id)
    task.value = await fde.tasks.get(props.taskId)
  } catch (e) { ElMessage.error(e.message) }
}
// 评论附件: 先上传暂存, 发送评论后用返回的 commentId 绑定
const pendingCommentAtts = ref([])
async function uploadCommentAttachment({ file }) {
  attUploading.value = true
  try { pendingCommentAtts.value.push(await uploadFile(file)) }
  catch (e) { ElMessage.error(e.message || $t('common.upload_failed')) }
  finally { attUploading.value = false }
}

// 评论
const comments = ref([])
const newComment = ref('')
const commentSubmitting = ref(false)
async function loadComments() {
  if (!props.taskId) return
  try {
    comments.value = await fde.comments.list('task', props.taskId)
  } catch (e) { ElMessage.error(e.message) }
}
async function addComment() {
  if ((!newComment.value.trim() && !pendingCommentAtts.value.length) || !props.taskId) return
  commentSubmitting.value = true
  try {
    const c = await fde.comments.create({
      entity: 'task', entityId: props.taskId,
      content: newComment.value.trim() || $t('taskDetailDialog.attachment')
    })
    // v1.4.x: 评论附件绑定 commentId
    for (const a of pendingCommentAtts.value) {
      await fde.tasks.addAttachment(props.taskId, { ...a, commentId: c.id }).catch(() => {})
    }
    if (pendingCommentAtts.value.length) task.value = await fde.tasks.get(props.taskId)
    pendingCommentAtts.value = []
    newComment.value = ''
    loadComments()
    ElMessage.success($t('common.sent'))
  } catch (e) { ElMessage.error(e.message) }
  finally { commentSubmitting.value = false }
}
async function removeComment(c) {
  try {
    await fde.comments.remove(c.id)
    loadComments()
  } catch (e) { ElMessage.error(e.message) }
}
function renderContent(text) {
  return text.replace(/@([\w一-龥]+)/g, '<span class="at-mention">@$1</span>')
}
</script>

<style scoped>
.detail-info { padding: 8px 0; }
.detail-aw-row { margin-bottom: 12px; }
.info-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
.info-value { font-size: 14px; color: #1c1917; }
.info-value code { background: #f0f0f0; padding: 1px 6px; border-radius: 3px; font-size: 12px; color: #606266; }
.info-value.overdue, .overdue { color: #c2362b; font-weight: 600; }
.detail-actions { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ebeef5; display: flex; gap: 8px; flex-wrap: wrap; }
/* v1.9.7(#353): 流转时间线 */
.flow-timeline { font-size: 13px; color: #5c574f; line-height: 1.8; }
.flow-arrow { color: #b0aeaa; margin: 0 6px; }
.flow-dur { color: #b3450f; font-size: 12px; }   /* v2.0.1(#395) 阶段用时 */
.flow-total { font-weight: 700; color: #1c1917; }
/* v1.4.x 附件 */
.att-row { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 1.9; }
.att-meta { font-size: 11px; color: #909399; }

/* 1.2.7: 描述 Markdown 基础排版 */
.md-body { line-height: 1.7; }
.md-body :deep(h1), .md-body :deep(h2), .md-body :deep(h3) { margin: 12px 0 6px; font-size: 15px; font-weight: 700; }
.md-body :deep(h1) { font-size: 17px; }
.md-body :deep(p) { margin: 6px 0; }
.md-body :deep(ul), .md-body :deep(ol) { padding-left: 20px; margin: 6px 0; }
.md-body :deep(code) { background: #f0eee9; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.md-body :deep(pre) { background: #1c1917; color: #faf9f7; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.md-body :deep(pre code) { background: transparent; color: inherit; padding: 0; }
.md-body :deep(blockquote) { border-left: 3px solid #ddd9d2; margin: 8px 0; padding: 2px 12px; color: #5c574f; }
.md-body :deep(table) { border-collapse: collapse; margin: 8px 0; }
.md-body :deep(th), .md-body :deep(td) { border: 1px solid #eae7e2; padding: 4px 10px; font-size: 13px; }

.subtask-progress { margin-bottom: 12px; }
.subtask-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px dashed #f0f0f0; }
.subtask-item:last-of-type { border-bottom: none; }
.subtask-item :deep(.el-checkbox) { flex: 1; }
.add-subtask { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #ebeef5; }

.comment-list { max-height: 400px; overflow-y: auto; }
.comment-item { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px dashed #f0f0f0; }
.comment-item:last-of-type { border-bottom: none; }
.comment-body { flex: 1; }
.comment-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.comment-time { font-size: 11px; color: #909399; }
.comment-content { font-size: 14px; line-height: 1.6; color: #1c1917; }
.comment-content :deep(.at-mention) { color: #d2521e; font-weight: 600; background: #fdf3ee; padding: 1px 4px; border-radius: 3px; }
.add-comment { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #ebeef5; }
.add-comment-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.add-comment-foot .hint { font-size: 11px; color: #909399; }
.asset-suggest { margin-top: 12px; padding: 10px 12px; border: 1px dashed var(--el-color-primary-light-5); border-radius: 8px; background: var(--el-color-primary-light-9); }
.asset-sug-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13px; margin-top: 4px; }
.asset-sug-name { font-weight: 600; color: var(--el-color-primary); text-decoration: none; }
.asset-sug-sum { color: var(--el-text-color-regular); flex: 1; min-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-sug-hit { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
