<template>
  <!-- v2.10.0(#1180) 想法详情: 正文 + 去向 + AI 总结 + 讨论 -->
  <el-drawer :model-value="modelValue" size="680px" :with-header="false" append-to-body @update:model-value="v => $emit('update:modelValue', v)">
    <div v-loading="loading" class="detail">
      <template v-if="idea">
        <header class="head">
          <div class="tags">
            <el-tag size="small" effect="plain">{{ idea.topic?.icon || '#' }} {{ idea.topic?.name }}</el-tag>
            <el-tag size="small" :type="IDEA_STATUS[idea.status]?.type">{{ IDEA_STATUS[idea.status]?.label || idea.status }}</el-tag>
            <el-tag v-if="idea.pinned" size="small" type="danger" effect="plain">{{ $t('common.pin') }}</el-tag>
            <el-tag v-if="idea.viaAgent" size="small" effect="plain">{{ $t('ideaDetail.posted_by_agent') }}</el-tag>
            <div class="head-actions">
              <el-dropdown v-if="idea.can?.edit || idea.can?.manage" trigger="click" @command="onCommand">
                <el-button link>{{ $t('ideaDetail.more') }}</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="idea.can.edit" command="edit">{{ $t('ideaDetail.edit') }}</el-dropdown-item>
                    <el-dropdown-item v-if="idea.can.manage" command="pin">{{ $t('common.p0', { p0: idea.pinned ? $t('common.unpin') : $t('common.pin') }) }}</el-dropdown-item>
                    <el-dropdown-item v-if="idea.can.manage && idea.status === 'OPEN'" command="park">{{ $t('common.shelve') }}</el-dropdown-item>
                    <el-dropdown-item v-if="idea.can.manage && idea.status === 'PARKED'" command="reopen">{{ $t('ideaDetail.reopen_discussion') }}</el-dropdown-item>
                    <!-- v2.12.1(#1274/#1276) 归档: 发布人或管理员; 已转里程碑的也可归档 -->
                    <el-dropdown-item v-if="idea.can.edit && idea.status !== 'ARCHIVED'" command="archive">{{ $t('common.archive') }}</el-dropdown-item>
                    <el-dropdown-item v-if="idea.can.edit && idea.status === 'ARCHIVED'" command="unarchive">{{ $t('ideaDetail.unarchive') }}</el-dropdown-item>
                    <el-dropdown-item v-if="idea.can.edit" command="remove" divided>{{ $t('common.delete_2') }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-button link @click="$emit('update:modelValue', false)">{{ $t('ideaDetail.close') }}</el-button>
            </div>
          </div>
          <h2>{{ idea.title }}</h2>
          <div class="byline">
            <el-avatar :size="22" :src="idea.author?.avatarUrl || undefined" class="avatar">{{ idea.author?.name?.slice(0, 1) }}</el-avatar>
            <span>{{ idea.author?.name || '—' }}</span>
            <span class="muted">{{ $t('ideaDetail.posted', { p0: relTime(idea.createdAt) }) }}</span>
          </div>
        </header>

        <!-- 去向 -->
        <div v-if="idea.status === 'ADOPTED' && idea.project" class="adopted">
          <div>
            <div class="adopted-title">{{ $t('ideaDetail.assigned_project') }}</div>
            <div class="adopted-body">{{ idea.project.code }} {{ idea.project.name }} <span class="muted">›</span> {{ $t('ideaDetail.p0', { p0: idea.milestone?.name || $t('common.milestone_2') }) }}</div>
          </div>
          <el-button type="primary" plain size="small" @click="goRoadmap">{{ $t('ideaDetail.break_into_tasks_on_roadmap') }}</el-button>
        </div>
        <!-- 项目不在自己的数据范围内: 只知道被采纳了, 不展开去向 -->
        <div v-else-if="idea.status === 'ADOPTED'" class="adopted">
          <div>
            <div class="adopted-title">{{ $t('ideaDetail.assigned_project') }}</div>
            <div class="adopted-body muted">{{ $t('ideaDetail.youre_not_in_this_project_so') }}</div>
          </div>
        </div>

        <div class="md-body content" v-html="contentHtml"></div>

        <div v-if="idea.attachments?.length" class="atts">
          <template v-for="a in idea.attachments" :key="a.fileUrl">
            <a v-if="isImage(a)" :href="a.fileUrl" target="_blank" rel="noopener noreferrer"><img :src="a.fileUrl" :alt="a.filename" /></a>
            <a v-else :href="a.fileUrl" target="_blank" rel="noopener noreferrer" class="att-file">📎 {{ a.filename }}</a>
          </template>
        </div>

        <div class="actions">
          <button type="button" class="like" :class="{ on: idea.liked }" :disabled="!canWrite" @click="toggleLike">
            👍 {{ idea.likeCount || 0 }}
          </button>
          <el-button v-if="idea.can?.convert && idea.status !== 'ADOPTED' && idea.status !== 'ARCHIVED'" type="primary" @click="convertVisible = true">{{ $t('ideaDetail.convert_milestone') }}</el-button>
          <el-button v-if="canWrite" :loading="summarizing" @click="summarize">{{ $t('ideaDetail.p0_2', { p0: idea.aiSummary ? $t('ideaDetail.summarize_again') : $t('ideaDetail.ai_summary_discussion') }) }}</el-button>
        </div>

        <el-alert v-if="llmMissing" type="warning" :closable="false" show-icon style="margin-bottom: 12px;"
          :title="$t('ideaDetail.no_llm_available_ask_admin_add')" />
        <div v-if="idea.aiSummary" class="summary">
          <div class="summary-head">{{ $t('ideaDetail.ai_summary') }} <span class="muted">{{ relTime(idea.aiSummaryAt) }}</span></div>
          <div class="md-body" v-html="summaryHtml"></div>
        </div>

        <!-- 讨论 -->
        <h3 class="thread-title">{{ $t('ideaDetail.discussion') }} <span class="muted">{{ idea.comments.length }}</span></h3>
        <el-empty v-if="!thread.length" :image-size="50" :description="$t('ideaDetail.no_one_has_said_anything_yet')" />
        <div v-for="c in thread" :key="c.id" class="comment">
          <el-avatar :size="28" :src="c.author?.avatarUrl || undefined" class="avatar">{{ c.author?.name?.slice(0, 1) }}</el-avatar>
          <div class="comment-main">
            <div class="comment-head">
              <strong>{{ c.author?.name || '—' }}</strong>
              <span class="muted">{{ relTime(c.createdAt) }}</span>
            </div>
            <div class="comment-text" v-html="renderComment(c.content)"></div>
            <div class="comment-ops">
              <el-button v-if="canWrite" link size="small" @click="startReply(c)">{{ $t('common.reply') }}</el-button>
              <el-popconfirm v-if="c.canDelete" :title="$t('ideaDetail.delete_this_comment')" @confirm="removeComment(c)">
                <template #reference><el-button link size="small" type="danger">{{ $t('common.delete_2') }}</el-button></template>
              </el-popconfirm>
            </div>
            <div v-for="r in c.replies" :key="r.id" class="comment reply">
              <el-avatar :size="22" :src="r.author?.avatarUrl || undefined" class="avatar">{{ r.author?.name?.slice(0, 1) }}</el-avatar>
              <div class="comment-main">
                <div class="comment-head">
                  <strong>{{ r.author?.name || '—' }}</strong>
                  <span class="muted">{{ relTime(r.createdAt) }}</span>
                </div>
                <div class="comment-text" v-html="renderComment(r.content)"></div>
                <div class="comment-ops">
                  <el-button v-if="canWrite" link size="small" @click="startReply(c, r)">{{ $t('common.reply') }}</el-button>
                  <el-popconfirm v-if="r.canDelete" :title="$t('ideaDetail.delete_this_reply')" @confirm="removeComment(r)">
                    <template #reference><el-button link size="small" type="danger">{{ $t('common.delete_2') }}</el-button></template>
                  </el-popconfirm>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="canWrite" ref="composerRef" class="composer">
          <div v-if="replyTo" class="replying">
            {{ $t('ideaDetail.reply', { p0: replyTo.name }) }}
            <el-button link size="small" @click="replyTo = null">{{ $t('common.cancel') }}</el-button>
          </div>
          <el-mention v-model="newComment" type="textarea" :rows="2" :options="mentionOptions" whole
            :placeholder="$t('ideaDetail.share_your_thoughts_type_mention_teammate')" />
          <div class="composer-foot">
            <span class="muted">{{ $t('ideaDetail.ctrl_enter_send') }}</span>
            <el-button type="primary" size="small" :loading="sending" :disabled="!newComment.trim()" @click="send">{{ $t('common.send') }}</el-button>
          </div>
        </div>
      </template>
    </div>

    <IdeaEditDialog v-model="editVisible" :topics="topics" :idea="idea" @saved="onEdited" />
    <IdeaConvertDialog v-model="convertVisible" :idea="idea" @converted="onConverted" />
  </el-drawer>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'
import { relativeTime as relTime } from '@/utils/formatters.js'
import { IDEA_STATUS, renderComment, isImage, threadComments } from './ideaUtils.js'
import IdeaEditDialog from './IdeaEditDialog.vue'
import IdeaConvertDialog from './IdeaConvertDialog.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  ideaId: { type: [String, Number], default: '' },
  topics: { type: Array, default: () => [] }
})
// changed: 想法有变化(点赞/评论/修改/转化), 列表要跟着刷; removed: 想法被删
const emit = defineEmits(['update:modelValue', 'changed', 'removed'])
const router = useRouter()

const idea = ref(null)
const loading = ref(false)
// v2.12.1(#1274): 已归档的想法只读(点赞/评论/AI总结都收起)
const canWrite = computed(() => can('idea.create') && idea.value?.status !== 'ARCHIVED')
const contentHtml = computed(() => renderSafeMarkdown(idea.value?.content))
const summaryHtml = computed(() => renderSafeMarkdown(idea.value?.aiSummary))
const thread = computed(() => threadComments(idea.value?.comments))

async function load() {
  if (!props.ideaId) return
  loading.value = true
  try {
    idea.value = await fde.ideas.detail(props.ideaId)
  } catch (e) {
    ElMessage.error(e.message || $t('common.failed_load'))
    emit('update:modelValue', false)
  } finally {
    loading.value = false
  }
}
// ---- 点赞 ----
async function toggleLike() {
  try {
    const r = await fde.ideas.like(idea.value.id)
    idea.value.liked = r.liked
    idea.value.likeCount = r.likeCount
    emit('changed')
  } catch (e) { ElMessage.error(e.message) }
}

// ---- 讨论 ----
const newComment = ref('')
const replyTo = ref(null)        // { parentId, name }
const sending = ref(false)
const composerRef = ref(null)
const mentionOptions = ref([])

function startReply(top, reply) {
  const target = reply || top
  replyTo.value = { parentId: String(top.id), name: target.author?.name || '' }
  // 回复的是楼里的某个人, 顺手 @ 上, 对方才收得到通知
  if (reply && target.author?.name && !newComment.value.includes(`@${target.author.name}`)) {
    newComment.value = `@${target.author.name} ` + newComment.value
  }
  nextTick(() => composerRef.value?.querySelector('textarea')?.focus())
}

async function send() {
  if (!newComment.value.trim()) return
  sending.value = true
  try {
    await fde.ideas.addComment(idea.value.id, { content: newComment.value.trim(), parentId: replyTo.value?.parentId })
    newComment.value = ''
    replyTo.value = null
    await load()
    emit('changed')
  } catch (e) {
    ElMessage.error(e.message || $t('common.send_failed'))
  } finally {
    sending.value = false
  }
}

async function removeComment(c) {
  try {
    await fde.ideas.removeComment(idea.value.id, c.id)
    await load()
    emit('changed')
  } catch (e) { ElMessage.error(e.message) }
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && props.modelValue && composerRef.value?.contains(document.activeElement)) send()
}
onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    const users = await fde.users.mentionable()
    mentionOptions.value = (users.list || users || []).map(u => ({ label: u.name, value: u.name }))
  } catch { /* 拿不到同事列表不影响评论, 手打 @姓名 一样生效 */ }
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// ---- AI 总结 ----
const summarizing = ref(false)
const llmMissing = ref(false)
async function summarize() {
  summarizing.value = true
  llmMissing.value = false
  try {
    const r = await fde.ideas.aiSummary(idea.value.id)
    idea.value.aiSummary = r.aiSummary
    idea.value.aiSummaryAt = r.aiSummaryAt
    emit('changed')
  } catch (e) {
    if (e.code === 4101) llmMissing.value = true
    else ElMessage.error(e.message || $t('ideaDetail.ai_summary_failed'))
  } finally {
    summarizing.value = false
  }
}

// ---- 修改 / 置顶 / 搁置 / 删除 ----
const editVisible = ref(false)
const convertVisible = ref(false)

async function patch(data, okText) {
  try {
    await fde.ideas.update(idea.value.id, data)
    ElMessage.success(okText)
    await load()
    emit('changed')
  } catch (e) { ElMessage.error(e.message) }
}

async function onCommand(cmd) {
  if (cmd === 'edit') editVisible.value = true
  else if (cmd === 'pin') patch({ pinned: !idea.value.pinned }, idea.value.pinned ? $t('common.unpinned') : $t('ideaDetail.pinned'))
  else if (cmd === 'park') patch({ status: 'PARKED' }, $t('ideaDetail.shelved'))
  else if (cmd === 'reopen') patch({ status: 'OPEN' }, $t('ideaDetail.discussion_reopened'))
  else if (cmd === 'archive') {   // v2.12.1(#1274)
    try {
      await ElMessageBox.confirm($t('ideaDetail.archived_ideas_hidden_from_list_cant'), $t('ideaDetail.archive_idea'), { type: 'warning' })
      await fde.ideas.archive(idea.value.id)
      ElMessage.success($t('common.archived'))
      await load(); emit('changed')
    } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || $t('ideaDetail.archive_failed')) }
  }
  else if (cmd === 'unarchive') {
    try {
      await fde.ideas.unarchive(idea.value.id)
      ElMessage.success($t('ideaDetail.unarchived'))
      await load(); emit('changed')
    } catch (e) { ElMessage.error(e.message || $t('common.reopen_failed')) }
  }
  else if (cmd === 'remove') {
    try {
      await ElMessageBox.confirm($t('ideaDetail.this_idea_its_discussion_will_disappear'), $t('ideaDetail.delete_idea'), { type: 'warning' })
      await fde.ideas.remove(idea.value.id)
      ElMessage.success($t('common.deleted'))
      emit('update:modelValue', false)
      emit('removed')
    } catch (e) {
      if (e !== 'cancel') ElMessage.error(e.message || $t('common.delete_failed'))
    }
  }
}

function onEdited() { load(); emit('changed') }
function onConverted() { load(); emit('changed') }

function goRoadmap() {
  router.push({ path: `/admin/projects/${idea.value.project.id}`, query: idea.value.milestone ? { milestone: String(idea.value.milestone.id) } : {} })
}

// 放在最后: immediate 会在 setup 里同步执行, 用到的 ref 必须都已声明
watch(() => [props.modelValue, props.ideaId], ([open]) => {
  if (!open) return
  idea.value = null
  newComment.value = ''
  replyTo.value = null
  llmMissing.value = false
  load()
}, { immediate: true })
</script>

<style scoped>
.detail { padding: 4px 4px 24px; min-height: 200px; }
.muted { color: #8f8a82; font-size: 12px; font-weight: 400; }
.head { margin-bottom: 14px; }
.tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.head-actions { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.head h2 { margin: 10px 0 8px; font-size: 20px; line-height: 1.4; color: #1c1917; }
.byline { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #5c574f; }
.avatar { background: #d2521e; color: #fff; flex-shrink: 0; }

.adopted { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #eef6f0; border: 1px solid #cfe5d6; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; }
.adopted-title { font-size: 12px; color: #2e7d4f; font-weight: 600; margin-bottom: 2px; }
.adopted-body { font-size: 14px; color: #1c1917; }

.md-body { line-height: 1.7; font-size: 14px; color: #1c1917; overflow-wrap: anywhere; }
.md-body :deep(h1), .md-body :deep(h2), .md-body :deep(h3) { margin: 12px 0 6px; font-size: 15px; font-weight: 700; }
.md-body :deep(h1) { font-size: 17px; }
.md-body :deep(p) { margin: 6px 0; }
.md-body :deep(ul), .md-body :deep(ol) { padding-left: 20px; margin: 6px 0; }
.md-body :deep(code) { background: #f0eee9; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.md-body :deep(pre) { background: #1c1917; color: #faf9f7; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.md-body :deep(pre code) { background: transparent; color: inherit; padding: 0; }
.md-body :deep(blockquote) { border-left: 3px solid #ddd9d2; margin: 8px 0; padding: 2px 12px; color: #5c574f; }
.md-body :deep(img) { max-width: 100%; border-radius: 6px; }
.md-body :deep(a) { color: #d2521e; }
.md-body :deep(.md-table-wrap) { overflow-x: auto; }
.md-body :deep(th), .md-body :deep(td) { border: 1px solid #eae7e2; padding: 4px 10px; font-size: 13px; }
.md-body :deep(table) { border-collapse: collapse; margin: 8px 0; }

.atts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.atts img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; border: 1px solid #eae7e2; display: block; }
.att-file { font-size: 13px; color: #d2521e; text-decoration: none; }

.actions { display: flex; align-items: center; gap: 8px; margin: 16px 0; padding-bottom: 14px; border-bottom: 1px solid #eae7e2; }
.like { border: 1px solid #eae7e2; background: #fff; border-radius: 16px; padding: 5px 14px; font-size: 13px; cursor: pointer; color: #5c574f; font-family: inherit; }
.like:hover:not(:disabled) { border-color: #d2521e; }
.like.on { background: #fdf3ee; border-color: #d2521e; color: #b3450f; font-weight: 600; }
.like:disabled { cursor: default; }

.summary { background: #faf9f7; border: 1px solid #eae7e2; border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; }
.summary-head { font-size: 13px; font-weight: 600; color: #1c1917; margin-bottom: 4px; display: flex; gap: 8px; align-items: baseline; }

.thread-title { font-size: 15px; margin: 0 0 10px; color: #1c1917; }
.comment { display: flex; gap: 10px; margin-bottom: 12px; }
.comment.reply { margin: 10px 0 0; }
.comment-main { flex: 1; min-width: 0; }
.comment-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
.comment-text { font-size: 14px; line-height: 1.6; color: #1c1917; margin-top: 2px; overflow-wrap: anywhere; }
.comment-text :deep(.at-mention) { color: #d2521e; background: #fdf3ee; padding: 0 3px; border-radius: 3px; }
.comment-ops { margin-top: 2px; }

.composer { position: sticky; bottom: 0; background: #fff; padding-top: 10px; margin-top: 16px; border-top: 1px solid #eae7e2; }
.replying { font-size: 12px; color: #b3450f; margin-bottom: 4px; }
.composer-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
</style>
