<template>
  <div class="blog-page">
    <div class="page-header">
      <div class="header-text">
        <h2 class="page-title">{{ $t('knowledge.team_blog') }}</h2>
        <p class="hint">
          {{ $t('knowledge.knowledge_articles_total', { p0: allTotal }) }}
          <template v-if="hasFilter"> {{ $t('knowledge.matching', { p0: pagination.total }) }}</template>
        </p>
      </div>
      <el-button v-if="can('knowledge.create')" type="primary" @click="createNew"><el-icon><Plus /></el-icon>{{ $t('knowledge.write') }}</el-button>
    </div>

    <el-card shadow="never" class="filter-card">
      <div class="filter-row">
        <el-input v-model="filters.keyword" :placeholder="$t('knowledge.search_title_category_tags')" clearable class="f-keyword" @keyup.enter="search()" @clear="search()">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filters.author_id" clearable filterable :placeholder="$t('knowledge.all_authors')" class="f-author" @change="search()">
          <el-option v-for="a in authors" :key="a.id" :label="`${a.name} (${a.count})`" :value="String(a.id)" />
        </el-select>
        <el-date-picker
          v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" unlink-panels
          :range-separator="$t('knowledge.to')" :start-placeholder="$t('knowledge.updated_since')" :end-placeholder="$t('knowledge.to_2')" class="f-date"
          :shortcuts="dateShortcuts" @change="search()"
        />
        <el-button type="primary" @click="search()">{{ $t('common.search') }}</el-button>
        <el-button v-if="hasFilter" link @click="resetFilters">{{ $t('common.reset') }}</el-button>
      </div>
      <div v-if="hasFilter" class="active-filters">
        <span class="af-label">{{ $t('knowledge.filters') }}</span>
        <el-tag v-if="filters.keyword" closable size="small" @close="filters.keyword = ''; search()">{{ $t('knowledge.keyword', { p0: filters.keyword }) }}</el-tag>
        <el-tag v-if="filters.category" closable size="small" type="info" @close="filters.category = ''; search()">{{ $t('knowledge.category', { p0: filters.category }) }}</el-tag>
        <el-tag v-if="filters.tag" closable size="small" type="success" @close="filters.tag = ''; search()">#{{ filters.tag }}</el-tag>
        <el-tag v-if="filters.author_id" closable size="small" type="warning" @close="filters.author_id = ''; search()">{{ $t('knowledge.author', { p0: authorName(filters.author_id) }) }}</el-tag>
        <el-tag v-if="filters.date_from || filters.date_to" closable size="small" @close="dateRange = null; search()">{{ filters.date_from || '…' }} ~ {{ filters.date_to || '…' }}</el-tag>
      </div>
    </el-card>

    <el-row :gutter="20" class="content-row">
      <!-- 左: 分类 + 标签云 -->
      <el-col :xs="24" :sm="7" :md="6" :lg="5">
        <el-card shadow="never" class="side-card">
          <div class="side-title">{{ $t('common.category') }}</div>
          <div class="cat-list">
            <div class="cat-item" :class="{ active: !filters.category }" @click="selectCat('')">
              <span>{{ $t('common.all') }}</span><el-tag size="small" effect="plain">{{ allTotal }}</el-tag>
            </div>
            <div v-for="c in categories" :key="c.name" class="cat-item" :class="{ active: filters.category === c.name }" @click="selectCat(c.name)">
              <span>{{ c.name }}</span><el-tag size="small" effect="plain">{{ c.count }}</el-tag>
            </div>
            <div v-if="!categories.length" class="side-empty">{{ $t('knowledge.no_categories') }}</div>
          </div>
        </el-card>
        <el-card shadow="never" class="side-card">
          <div class="side-title">{{ $t('common.tags') }}</div>
          <div class="tag-cloud">
            <span
              v-for="t in tags" :key="t.name" class="cloud-tag" :class="{ active: filters.tag === t.name }"
              :style="{ fontSize: tagSize(t.count) + 'px' }" @click="selectTag(t.name)"
            >#{{ t.name }}<sup>{{ t.count }}</sup></span>
            <div v-if="!tags.length" class="side-empty">{{ $t('knowledge.no_tags') }}</div>
          </div>
        </el-card>
      </el-col>

      <!-- 右: 博客流 -->
      <el-col :xs="24" :sm="17" :md="18" :lg="19">
        <div v-loading="loading" class="post-list">
          <el-empty v-if="!list.length && !loading" :description="hasFilter ? $t('knowledge.no_articles_match_filters') : $t('knowledge.no_articles_yet_write_first_one')" />
          <article v-for="a in list" :key="a.id" class="post" @click="openDetail(a)">
            <div class="post-main">
              <h3 class="post-title">
                <router-link :to="`/admin/knowledge/${a.id}`" @click.stop>{{ a.title }}</router-link>
              </h3>
              <p class="post-summary">{{ $t('common.p0', { p0: a.summary || $t('knowledge.no_summary') }) }}</p>
              <div class="post-meta">
                <span class="author"><span class="avatar">{{ initial(a.author?.name) }}</span>{{ $t('common.p0', { p0: a.author?.name || $t('common.unknown_author') }) }}</span>
                <span class="dot">·</span>
                <span :title="$t('knowledge.updated') + formatDate(a.updatedAt)">{{ relativeTime(a.updatedAt) }}</span>
                <span class="dot">·</span>
                <span>{{ $t('common.about_min', { p0: a.readMinutes || 1 }) }}</span>
                <span class="dot">·</span>
                <span>{{ $t('common.reads', { p0: a.viewCount }) }}</span>
                                <template v-if="a.project"><span class="dot">·</span><span class="proj"><el-icon><Folder /></el-icon>{{ a.project.code }}</span></template>
              </div>
              <div class="post-tags">
                <el-tag v-if="a.category" size="small" type="info" effect="plain" class="clickable" @click.stop="selectCat(a.category)">{{ a.category }}</el-tag>
                <el-tag v-for="t in a.tags || []" :key="t" size="small" effect="plain" class="clickable" @click.stop="selectTag(t)">#{{ t }}</el-tag>
              </div>
            </div>
            <div class="post-actions" @click.stop>
              <el-button v-if="can('knowledge.edit')" size="small" link type="primary" @click="editArticle(a)">{{ $t('common.edit') }}</el-button>
              <el-popconfirm v-if="can('knowledge.delete')" :title="$t('common.delete_this_article')" @confirm="removeArticle(a)">
                <template #reference><el-button size="small" link type="danger">{{ $t('common.delete_2') }}</el-button></template>
              </el-popconfirm>
            </div>
          </article>
          <el-pagination
            v-if="pagination.total > pagination.page_size"
            class="pagination" background layout="prev, pager, next, total"
            :current-page="pagination.page" :page-size="pagination.page_size" :total="pagination.total"
            @current-change="changePage"
          />
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
// v2.5.5(#913) 知识库博客化: 列表页改博客流(标题/摘要/作者/时间/标签 + 标签/作者/时间筛选), 阅读走独立页 KnowledgeDetail.vue
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus, Folder, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { fde, formatDate } from '@/api/index.js'
import { can } from '@/api/permissions.js'

const router = useRouter()
const route = useRoute()

const FILTER_KEYS = ['keyword', 'category', 'tag', 'author_id', 'date_from', 'date_to']
const filters = reactive({ keyword: '', category: '', tag: '', author_id: '', date_from: '', date_to: '' })
const pagination = reactive({ page: 1, page_size: 10, total: 0 })
const list = ref([])
const loading = ref(false)
const categories = ref([])
const tags = ref([])
const authors = ref([])

const allTotal = computed(() => authors.value.reduce((s, a) => s + (a.count || 0), 0))
const hasFilter = computed(() => FILTER_KEYS.some(k => filters[k]))
const dateRange = computed({
  get: () => (filters.date_from && filters.date_to) ? [filters.date_from, filters.date_to] : null,
  set: (v) => { filters.date_from = v?.[0] || ''; filters.date_to = v?.[1] || '' }
})
const dateShortcuts = [
  { text: $t('knowledge.last_week'), value: () => rangeDays(7) },
  { text: $t('knowledge.last_month'), value: () => rangeDays(30) },
  { text: $t('knowledge.last_3_months'), value: () => rangeDays(90) }
]
function rangeDays(n) {
  const end = new Date(); const start = new Date(); start.setDate(end.getDate() - n)
  return [start, end]
}

function authorName(id) { return authors.value.find(a => String(a.id) === String(id))?.name || `#${id}` }
function initial(name) { return (name || '?').trim().slice(0, 1) }
function relativeTime(d) {
  if (!d) return ''
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return $t('common.just_now')
  if (m < 60) return $t('common.min_ago_2', { p0: m })
  const h = Math.floor(m / 60)
  if (h < 24) return $t('common.hours_ago_2', { p0: h })
  const day = Math.floor(h / 24)
  if (day < 30) return $t('common.days_ago_2', { p0: day })
  return formatDate(d)
}
function tagSize(count) {
  const max = Math.max(1, ...tags.value.map(t => t.count))
  return 12 + Math.round((count / max) * 6)
}

// ---- URL 同步: 筛选与页码写进 query, 便于分享/后退 ----
function toQuery() {
  const q = {}
  FILTER_KEYS.forEach(k => { if (filters[k]) q[k] = filters[k] })
  if (pagination.page > 1) q.page = String(pagination.page)
  return q
}
function applyQuery(q) {
  FILTER_KEYS.forEach(k => { filters[k] = q[k] ? String(q[k]) : '' })
  pagination.page = Math.max(1, Number(q.page) || 1)
}
function sameQuery(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
function search({ resetPage = true } = {}) {
  if (resetPage) pagination.page = 1
  const q = toQuery()
  if (sameQuery(q, route.query)) loadList()
  else router.replace({ path: route.path, query: q })
}
function changePage(p) { pagination.page = p; search({ resetPage: false }) }
function resetFilters() { FILTER_KEYS.forEach(k => { filters[k] = '' }); search() }
function selectCat(name) { filters.category = filters.category === name ? '' : name; search() }
function selectTag(name) { filters.tag = filters.tag === name ? '' : name; search() }

async function loadList() {
  loading.value = true
  try {
    const params = { ...toQuery(), page: pagination.page, page_size: pagination.page_size }
    const res = await fde.knowledge.list(params)
    list.value = res.list
    pagination.total = res.total
  } catch (e) {
    ElMessage.error($t('common.failed_load_2') + e.message)
  } finally {
    loading.value = false
  }
}

async function loadDicts() {
  const [c, t, a] = await Promise.allSettled([fde.knowledge.categories(), fde.knowledge.tags(), fde.knowledge.authors()])
  categories.value = c.status === 'fulfilled' ? (c.value || []) : []
  tags.value = t.status === 'fulfilled' ? (t.value || []) : []
  authors.value = a.status === 'fulfilled' ? (a.value || []) : []
}

function openDetail(a) { router.push(`/admin/knowledge/${a.id}`) }
function createNew() { router.push('/admin/knowledge/edit/new') }
function editArticle(a) { router.push(`/admin/knowledge/edit/${a.id}`) }

async function removeArticle(a) {
  try {
    await fde.knowledge.remove(a.id)
    ElMessage.success($t('common.deleted'))
    loadList()
    loadDicts()
  } catch (e) {
    ElMessage.error($t('common.delete_failed'))
  }
}

watch(() => route.query, (q) => {
  if (route.name !== 'AdminKnowledge' || q.open) return
  applyQuery(q)
  loadList()
})

onMounted(() => {
  // 兼容 2026-07-31 起的 ?open=<id> 直达(项目主页/旧链接): 跳到独立阅读页
  if (route.query.open) {
    router.replace(`/admin/knowledge/${route.query.open}`)
    return
  }
  applyQuery(route.query)
  loadList()
  loadDicts()
})
</script>

<style scoped>
.blog-page { padding: 0; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: 0.5px; }
.hint { color: rgba(28, 25, 23, 0.55); font-size: 13px; margin: 4px 0 0; }
.filter-card { margin-bottom: 16px; }
.filter-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.f-keyword { width: 300px; }
.f-author { width: 180px; }
.f-date { width: 280px; }
.active-filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.af-label { font-size: 12px; color: rgba(28, 25, 23, 0.5); }

.side-card { margin-bottom: 16px; }
.side-card :deep(.el-card__body) { padding: 0; }
.side-title { font-weight: 600; padding: 12px 16px; border-bottom: 1px solid rgba(28, 25, 23, 0.08); font-size: 14px; }
.cat-list { padding: 8px; }
.cat-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 14px; transition: background 0.15s;
}
.cat-item:hover { background: rgba(28, 25, 23, 0.04); }
.cat-item.active { background: rgba(64, 158, 255, 0.1); font-weight: 500; }
.side-empty { padding: 12px; color: rgba(28, 25, 23, 0.4); font-size: 12px; text-align: center; }
.tag-cloud { padding: 12px 14px; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
.cloud-tag { cursor: pointer; color: rgba(28, 25, 23, 0.7); line-height: 1.4; transition: color 0.15s; }
.cloud-tag sup { font-size: 10px; color: rgba(28, 25, 23, 0.4); margin-left: 2px; }
.cloud-tag:hover, .cloud-tag.active { color: #409eff; }
.cloud-tag.active { font-weight: 600; }

.post-list { display: flex; flex-direction: column; min-height: 200px; }
.post {
  display: flex; gap: 16px; padding: 20px 4px; border-bottom: 1px solid rgba(28, 25, 23, 0.08);
  cursor: pointer; position: relative;
}
.post:first-child { padding-top: 4px; }
.post-main { flex: 1; min-width: 0; }
.post-title { margin: 0 0 8px; font-size: 19px; font-weight: 600; line-height: 1.4; }
.post-title a { color: #1c1917; text-decoration: none; }
.post-title a:hover { color: #409eff; }
.post-summary {
  margin: 0 0 10px; font-size: 14px; line-height: 1.7; color: rgba(28, 25, 23, 0.65);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.post-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: rgba(28, 25, 23, 0.5); }
.post-meta .dot { color: rgba(28, 25, 23, 0.25); }
.post-meta .author { display: inline-flex; align-items: center; gap: 6px; color: rgba(28, 25, 23, 0.75); }
.post-meta .proj { display: inline-flex; align-items: center; gap: 3px; font-family: ui-monospace, Menlo, monospace; }
.avatar {
  width: 20px; height: 20px; border-radius: 50%; background: linear-gradient(135deg, #409eff, #79bbff);
  color: #fff; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600;
}
.post-tags { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
.clickable { cursor: pointer; }
.post-actions { position: absolute; top: 18px; right: 8px; opacity: 0; transition: opacity 0.15s; display: flex; gap: 4px; }
.post:hover .post-actions { opacity: 1; }
.pagination { margin-top: 20px; justify-content: flex-end; display: flex; }

@media (max-width: 768px) {
  .f-keyword, .f-author, .f-date { width: 100%; }
  .post-actions { opacity: 1; position: static; }
  .post { flex-direction: column; }
}
</style>
