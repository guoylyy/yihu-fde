<template>
  <!-- v2.10.0(#1180) 创意中心 —— 面向全公司的想法与需求广场
       左: 话题(频道)  中: 想法流  右(抽屉): 想法详情与讨论
       生产流程最前端: 想法在这里聊清楚, 再分配到项目形成里程碑 -->
  <div class="ideas">
    <!-- ======== 话题栏 ======== -->
    <aside class="topics">
      <div class="topics-head">
        <span>{{ $t('common.topic') }}</span>
        <el-button v-if="canCreate" link type="primary" size="small" @click="openTopic()">{{ $t('ideas.topic') }}</el-button>
      </div>
      <button type="button" class="topic" :class="{ on: !filters.topicId }" @click="pickTopic('')">
        <span class="topic-icon">🗂</span>
        <span class="topic-name">{{ $t('ideas.all_ideas') }}</span>
        <span class="topic-count">{{ totalIdeas }}</span>
      </button>
      <button v-for="t in liveTopics" :key="t.id" type="button" class="topic" :class="{ on: filters.topicId === String(t.id) }" @click="pickTopic(t.id)">
        <span class="topic-icon">{{ t.icon || '#' }}</span>
        <span class="topic-name">{{ t.name }}</span>
        <span class="topic-count">{{ t.ideaCount }}</span>
      </button>
      <template v-if="archivedTopics.length">
        <button type="button" class="archived-toggle" @click="showArchived = !showArchived">
          {{ $t('ideas.archived', { p0: showArchived ? '▾' : '▸', p1: archivedTopics.length }) }}
        </button>
        <template v-if="showArchived">
          <button v-for="t in archivedTopics" :key="t.id" type="button" class="topic archived" :class="{ on: filters.topicId === String(t.id) }" @click="pickTopic(t.id)">
            <span class="topic-icon">{{ t.icon || '#' }}</span>
            <span class="topic-name">{{ t.name }}</span>
            <span class="topic-count">{{ t.ideaCount }}</span>
          </button>
        </template>
      </template>
    </aside>

    <!-- ======== 想法流 ======== -->
    <main class="feed">
      <div class="feed-head">
        <div class="feed-title">
          <h2>{{ $t('common.p0', { p0: currentTopic ? `${currentTopic.icon || '#'} ${currentTopic.name}` : $t('ideas.all_ideas') }) }}</h2>
          <el-tag v-if="currentTopic?.archived" size="small" type="info">{{ $t('common.archived') }}</el-tag>
          <el-button v-if="currentTopic && canEditTopic(currentTopic)" link size="small" @click="openTopic(currentTopic)">{{ $t('ideas.settings') }}</el-button>
        </div>
        <p class="feed-desc">{{ $t('common.p0', { p0: currentTopic ? (currentTopic.description || $t('ideas.this_topic_has_no_description_yet')) : $t('ideas.every_project_starts_as_idea_drop') }) }}</p>
      </div>

      <div class="toolbar">
        <el-radio-group v-model="filters.status" size="small" @change="reload">
          <el-radio-button value="">{{ $t('common.all') }}</el-radio-button>
          <el-radio-button value="OPEN">{{ $t('common.under_discussion') }}</el-radio-button>
          <el-radio-button value="ADOPTED">{{ $t('common.converted_milestone') }}</el-radio-button>
          <el-radio-button value="PARKED">{{ $t('common.shelve') }}</el-radio-button>
          <el-radio-button value="ARCHIVED">{{ $t('common.archived') }}</el-radio-button>
        </el-radio-group>
        <el-select v-model="filters.sort" size="small" style="width: 124px;" @change="reload">
          <el-option :label="$t('ideas.recently_active')" value="active" />
          <el-option :label="$t('ideas.newest')" value="new" />
          <el-option :label="$t('ideas.most_liked')" value="hot" />
        </el-select>
        <el-checkbox v-model="filters.mine" size="small" @change="reload">{{ $t('ideas.mine_only') }}</el-checkbox>
        <el-input v-model="filters.keyword" size="small" clearable :placeholder="$t('ideas.search_title_or_content')" style="width: 180px;" @keyup.enter="reload" @clear="reload" />
        <el-button v-if="canCreate" type="primary" class="new-btn" :disabled="!!currentTopic?.archived" @click="openNew">{{ $t('ideas.post_idea') }}</el-button>
      </div>

      <div v-loading="loading" class="list">
        <el-empty v-if="!loading && !list.length" :description="emptyText">
          <el-button v-if="canCreate && !currentTopic?.archived" type="primary" @click="openNew">{{ $t('ideas.post_first_idea') }}</el-button>
        </el-empty>

        <article v-for="i in list" :key="i.id" class="idea" :class="{ active: String(i.id) === String(detailId) && detailVisible, archived: i.status === 'ARCHIVED' }" @click="openDetail(i.id)">
          <!-- v2.12.1(#1276) 批量归档勾选(点卡片本身不触发) -->
          <input v-if="canCreate && i.status !== 'ARCHIVED'" type="checkbox" class="batch-check"
                 :checked="selectedIds.has(String(i.id))"
                 @click.stop
                 @change="toggleSelect(String(i.id))" />
          <button type="button" class="vote" :class="{ on: i.liked }" :disabled="!canCreate" :title="i.liked ? $t('ideas.unlike') : $t('ideas.like')" @click.stop="toggleLike(i)">
            <span class="vote-arrow">▲</span>
            <span class="vote-count">{{ i.likeCount }}</span>
          </button>
          <div class="idea-main">
            <div class="idea-title">
              <el-tag v-if="i.pinned" size="small" type="danger" effect="plain">{{ $t('common.pin') }}</el-tag>
              <span>{{ i.title }}</span>
            </div>
            <p class="idea-excerpt">{{ plainExcerpt(i.excerpt) }}</p>
            <div class="idea-meta">
              <el-avatar :size="18" :src="i.author?.avatarUrl || undefined" class="avatar">{{ i.author?.name?.slice(0, 1) }}</el-avatar>
              <span>{{ i.author?.name || '—' }}</span>
              <span v-if="i.viaAgent" :title="$t('ideas.posted_by_agent')">🤖</span>
              <span class="dot">·</span>
              <span>{{ relTime(i.lastActivityAt) }}</span>
              <span class="dot">·</span>
              <span>💬 {{ i.commentCount }}</span>
              <span v-if="i.hasAiSummary" :title="$t('ideas.has_ai_summary')">✨</span>
              <el-tag v-if="!filters.topicId" size="small" effect="plain" class="meta-tag">{{ i.topic?.icon || '#' }} {{ i.topic?.name }}</el-tag>
              <el-tag v-if="i.status !== 'OPEN'" size="small" :type="IDEA_STATUS[i.status]?.type" class="meta-tag">{{ IDEA_STATUS[i.status]?.label }}</el-tag>
              <span v-if="i.project" class="dest">→ {{ i.project.name }}<template v-if="i.milestone"> › {{ i.milestone.name }}</template></span>
            </div>
          </div>
        </article>

        <div v-if="list.length < total" class="more">
          <el-button :loading="loadingMore" @click="loadMore">{{ $t('ideas.load_more_left', { p0: total - list.length }) }}</el-button>
        </div>
      </div>

      <!-- v2.12.1(#1276) 批量归档操作条: 勾选后浮出 -->
      <div v-if="selectedIds.size" class="batch-bar">
        <span>{{ $t('ideas.selected', { p0: selectedIds.size }) }}</span>
        <el-button size="small" @click="selectedIds.clear()">{{ $t('common.cancel') }}</el-button>
        <el-button size="small" type="warning" :loading="batchArchiving" @click="batchArchiveSelected">{{ $t('ideas.archive_selected') }}</el-button>
      </div>
    </main>

    <IdeaDetail v-model="detailVisible" :idea-id="detailId" :topics="topics" @changed="refreshQuietly" @removed="refreshQuietly" />
    <IdeaEditDialog v-model="newVisible" :topics="topics" :default-topic-id="filters.topicId" @saved="onCreated" />

    <!-- 话题: 新建 / 设置 -->
    <el-dialog v-model="topicVisible" :title="topicForm.id ? $t('ideas.topic_settings') : $t('ideas.start_topic')" width="460px">
      <el-form label-width="60px">
        <el-form-item :label="$t('common.name')" required>
          <div class="topic-form-row">
            <el-input v-model="topicForm.icon" maxlength="4" placeholder="💡" style="width: 64px;" />
            <el-input v-model="topicForm.name" maxlength="60" :placeholder="$t('ideas.e_g_product_ideas')" />
          </div>
        </el-form-item>
        <el-form-item :label="$t('common.notes_2')">
          <el-input v-model="topicForm.description" type="textarea" :rows="2" maxlength="500" :placeholder="$t('ideas.what_this_topic_about')" />
        </el-form-item>
        <el-form-item v-if="topicForm.id" :label="$t('common.archive')">
          <el-switch v-model="topicForm.archived" />
          <span class="hint">{{ $t('ideas.archived_topics_take_no_new_ideas') }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-popconfirm v-if="topicForm.id" :title="$t('ideas.only_empty_topics_can_be_deleted')" @confirm="removeTopic">
          <template #reference><el-button type="danger" plain :loading="topicSaving" style="float: left;">{{ $t('ideas.delete_topic') }}</el-button></template>
        </el-popconfirm>
        <el-button @click="topicVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="topicSaving" @click="saveTopic">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import IdeaDetail from '@/components/admin/ideas/IdeaDetail.vue'
import IdeaEditDialog from '@/components/admin/ideas/IdeaEditDialog.vue'
import { relativeTime as relTime } from '@/utils/formatters.js'
import { IDEA_STATUS, plainExcerpt } from '@/components/admin/ideas/ideaUtils.js'

const route = useRoute()
const router = useRouter()
const me = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')
const canCreate = computed(() => can('idea.create'))
const PAGE_SIZE = 20

// ---- 话题 ----
const topics = ref([])
const showArchived = ref(false)
const liveTopics = computed(() => topics.value.filter(t => !t.archived))
const archivedTopics = computed(() => topics.value.filter(t => t.archived))
const totalIdeas = computed(() => topics.value.reduce((s, t) => s + (t.ideaCount || 0), 0))
const currentTopic = computed(() => topics.value.find(t => String(t.id) === filters.topicId) || null)
function canEditTopic(t) { return can('idea.manage') || String(t.createdBy) === String(me?.id) }

async function loadTopics() {
  try {
    const data = await fde.ideas.topics()
    topics.value = data.list || []
  } catch (e) { ElMessage.error($t('ideas.failed_load_topics') + e.message) }
}

// ---- 想法流 ----
const filters = reactive({ topicId: String(route.query.topic || ''), status: '', sort: 'active', mine: false, keyword: '' })

// v2.12.1(#1276) 批量归档勾选
const selectedIds = reactive(new Set())
const batchArchiving = ref(false)
function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id)
  else selectedIds.add(id)
}
async function batchArchiveSelected() {
  const ids = [...selectedIds]
  try {
    await ElMessageBox.confirm($t('ideas.archive_selected_ideas_theyre_hidden_from', { p0: ids.length }), $t('ideas.archive_selected_2'), { type: 'warning' })
  } catch { return }
  batchArchiving.value = true
  try {
    const r = await fde.ideas.batchArchive(ids)
    if (r.archived) ElMessage.success($t('ideas.archived_ideas', { p0: r.archived }))
    if (r.failed?.length) ElMessage.warning($t('ideas.not_allowed', { p0: r.failed.length, p1: r.failed.map(f => `#${f.id} ${f.reason}`).join($t('common.list_sep_semi')).slice(0, 150) }))
    selectedIds.clear()
    reload()
  } catch (e) { ElMessage.error(e.message) } finally { batchArchiving.value = false }
}
const list = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const emptyText = computed(() =>
  filters.keyword || filters.status || filters.mine ? $t('ideas.no_matching_ideas') : $t('ideas.no_ideas_here_yet'))

function query(p, size = PAGE_SIZE) {
  // GET 参数一律给字符串, 空值给空串(URLSearchParams 会把 undefined 变成字面量 "undefined")
  return {
    topicId: filters.topicId, status: filters.status, sort: filters.sort,
    mine: filters.mine ? 'true' : '', keyword: filters.keyword.trim(),
    page: String(p), page_size: String(size)
  }
}

async function reload() {
  loading.value = true
  try {
    const data = await fde.ideas.list(query(1))
    list.value = data.list || []
    total.value = data.total || 0
    page.value = 1
  } catch (e) {
    ElMessage.error($t('common.failed_load_2') + e.message)
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loadingMore.value = true
  try {
    const data = await fde.ideas.list(query(page.value + 1))
    list.value.push(...(data.list || []))
    total.value = data.total || 0
    page.value += 1
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loadingMore.value = false
  }
}

/** 详情里有动作(点赞/评论/转化)后回刷: 保持已加载的条数, 不整页 loading */
async function refreshQuietly() {
  loadTopics()
  try {
    const data = await fde.ideas.list(query(1, Math.min(100, Math.max(PAGE_SIZE, list.value.length))))
    list.value = data.list || []
    total.value = data.total || 0
    page.value = Math.max(1, Math.ceil(list.value.length / PAGE_SIZE))
  } catch { /* 静默回刷失败不打断当前操作 */ }
}

function pickTopic(id) {
  filters.topicId = id ? String(id) : ''
  router.replace({ query: { ...route.query, topic: filters.topicId || undefined } })
  reload()
}

async function toggleLike(i) {
  try {
    const r = await fde.ideas.like(i.id)
    i.liked = r.liked
    i.likeCount = r.likeCount
  } catch (e) { ElMessage.error(e.message) }
}

// ---- 详情抽屉(地址栏带 ?idea=, 通知与分享链接可直达) ----
const detailVisible = ref(false)
const detailId = ref('')
function openDetail(id) {
  detailId.value = String(id)
  detailVisible.value = true
}
watch(detailVisible, open => {
  const q = { ...route.query, idea: open ? detailId.value : undefined }
  router.replace({ query: q })
})
watch(() => route.query.idea, id => {
  if (id && (String(id) !== detailId.value || !detailVisible.value)) openDetail(id)
})

// ---- 发想法 ----
const newVisible = ref(false)
function openNew() {
  if (!topics.value.some(t => !t.archived)) return ElMessage.warning($t('ideas.no_topics_yet_start_one_first'))
  newVisible.value = true
}
function onCreated(idea) {
  loadTopics()
  reload()
  openDetail(idea.id)
}

// ---- 话题新建 / 设置 ----
const topicVisible = ref(false)
const topicSaving = ref(false)
const topicForm = reactive({ id: null, name: '', icon: '', description: '', archived: false })
function openTopic(t) {
  Object.assign(topicForm, t
    ? { id: String(t.id), name: t.name, icon: t.icon || '', description: t.description || '', archived: !!t.archived }
    : { id: null, name: '', icon: '', description: '', archived: false })
  topicVisible.value = true
}
async function saveTopic() {
  if (!topicForm.name.trim()) return ElMessage.warning($t('ideas.topic_name_required'))
  topicSaving.value = true
  try {
    const payload = { name: topicForm.name.trim(), icon: topicForm.icon.trim(), description: topicForm.description.trim() }
    if (topicForm.id) {
      await fde.ideas.updateTopic(topicForm.id, { ...payload, archived: topicForm.archived })
    } else {
      const created = await fde.ideas.createTopic(payload)
      filters.topicId = String(created.id)
      router.replace({ query: { ...route.query, topic: filters.topicId } })
    }
    ElMessage.success($t('common.saved'))
    topicVisible.value = false
    await loadTopics()
    reload()
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally {
    topicSaving.value = false
  }
}
async function removeTopic() {
  topicSaving.value = true
  try {
    await fde.ideas.removeTopic(topicForm.id)
    ElMessage.success($t('common.deleted'))
    topicVisible.value = false
    pickTopic('')
    loadTopics()
  } catch (e) {
    ElMessage.error(e.message || $t('common.delete_failed'))
  } finally {
    topicSaving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadTopics(), reload()])
  if (route.query.idea) openDetail(route.query.idea)
  // 工作台「提想法」带 ?new=1 过来, 直接打开发布框
  if (route.query.new && canCreate.value) {
    router.replace({ query: { ...route.query, new: undefined } })
    openNew()
  }
})
</script>

<style scoped>
.ideas { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; align-items: start; }

.topics { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 10px 8px; position: sticky; top: 12px; }
.topics-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 8px 8px; font-size: 12px; color: #8f8a82; font-weight: 600; letter-spacing: .04em; }
.topic { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: transparent; padding: 7px 8px; border-radius: 8px; cursor: pointer; font-size: 14px; color: #1c1917; text-align: left; font-family: inherit; }
.topic:hover { background: #faf9f7; }
.topic.on { background: #1c1917; color: #fff; }
.topic.archived { color: #8f8a82; }
.topic.archived.on { color: #fff; }
.topic-icon { width: 20px; text-align: center; flex-shrink: 0; }
.topic-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topic-count { font-size: 12px; color: #a8a29a; font-family: 'Manrope', 'Helvetica Neue', Arial, sans-serif; }
.topic.on .topic-count { color: rgba(255, 255, 255, .7); }
.archived-toggle { border: none; background: transparent; width: 100%; text-align: left; padding: 8px 8px 4px; font-size: 12px; color: #a8a29a; cursor: pointer; font-family: inherit; }

.feed { min-width: 0; }
.feed-head { margin-bottom: 12px; }
.feed-title { display: flex; align-items: center; gap: 8px; }
.feed-title h2 { margin: 0; font-size: 20px; color: #1c1917; }
.feed-desc { margin: 4px 0 0; font-size: 13px; color: #8f8a82; }

.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.new-btn { margin-left: auto; }

.list { min-height: 160px; }
.idea { display: flex; gap: 12px; background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; cursor: pointer; transition: border-color .15s; }
.idea:hover { border-color: #c9c4bb; }
.idea.active { border-color: #d2521e; box-shadow: 0 0 0 1px rgba(210, 82, 30, .15); }
/* v2.12.1(#1274) 已归档: 置灰降权 */
.idea.archived { opacity: .55; background: #faf9f7; }
/* v2.12.1(#1276) 批量归档勾选与操作条 */
.batch-check { position: absolute; top: 10px; right: 10px; width: 16px; height: 16px; accent-color: #d2521e; cursor: pointer; z-index: 2; }
.idea { position: relative; }
.batch-bar {
  position: sticky; bottom: 12px; z-index: 10;
  display: flex; align-items: center; gap: 12px; justify-content: center;
  margin-top: 12px; padding: 10px 18px;
  background: #1c1917; color: #faf9f7; border-radius: 999px;
  box-shadow: 0 6px 20px rgba(28, 25, 23, .25); font-size: 13px;
}

.vote { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; width: 44px; height: 48px; flex-shrink: 0; border: 1px solid #eae7e2; border-radius: 8px; background: #faf9f7; cursor: pointer; color: #8f8a82; font-family: inherit; }
.vote:hover:not(:disabled) { border-color: #d2521e; color: #b3450f; }
.vote.on { background: #fdf3ee; border-color: #d2521e; color: #b3450f; }
.vote:disabled { cursor: default; }
.vote-arrow { font-size: 10px; line-height: 1; }
.vote-count { font-size: 14px; font-weight: 700; font-family: 'Manrope', 'Helvetica Neue', Arial, sans-serif; line-height: 1.2; }

.idea-main { flex: 1; min-width: 0; }
.idea-title { display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; color: #1c1917; line-height: 1.4; }
.idea-excerpt { margin: 4px 0 8px; font-size: 13px; color: #5c574f; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.idea-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: #8f8a82; }
.avatar { background: #d2521e; color: #fff; font-size: 10px; }
.dot { color: #c9c4bb; }
.meta-tag { margin-left: 2px; }
.dest { color: #2e7d4f; }

.more { text-align: center; padding: 8px 0 16px; }
.topic-form-row { display: flex; gap: 8px; width: 100%; }
.hint { margin-left: 10px; font-size: 12px; color: #8f8a82; }

@media (max-width: 900px) {
  .ideas { grid-template-columns: 1fr; }
  .topics { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
  .topics-head { width: 100%; }
  .topic { width: auto; }
  .new-btn { margin-left: 0; }
}
</style>
