<template>
  <!-- 0.5.0 经验库: 从开发会话沉淀下来的经验 / 决策 / 坑 / 做法 -->
  <div class="experience">
    <ExperienceTabs />
    <div class="toolbar">
      <el-input v-model="query.keyword" :placeholder="$t('experience.search')" clearable class="search" @keyup.enter="load(1)" @clear="load(1)" />
      <el-select v-model="query.kind" :placeholder="$t('experience.kind')" clearable class="kind" @change="load(1)">
        <el-option v-for="k in EXPERIENCE_KINDS" :key="k" :value="k" :label="$t('experience.kinds.' + k)" />
      </el-select>
      <el-button @click="load(1)">{{ $t('common.search') }}</el-button>
    </div>

    <div v-loading="loading">
      <el-empty v-if="!loading && !list.length" :description="error || $t('experience.empty')">
        <el-button v-if="!error && can('project.view')" @click="$router.push('/admin/conversations')">{{ $t('experience.go_conversations') }}</el-button>
      </el-empty>
      <div class="cards">
        <article v-for="x in list" :key="x.id" class="card" data-test="experience-card" @click="open(x)">
          <div class="head">
            <el-tag size="small" :type="KIND_TAG[x.kind]" effect="plain">{{ $t('experience.kinds.' + x.kind) }}</el-tag>
            <span class="reuse" :title="$t('experience.reusable')">{{ '★'.repeat(x.reusableLevel || 0) }}</span>
          </div>
          <h4>{{ x.title }}</h4>
          <p class="body">{{ firstSentence(x.body, 120) }}</p>
          <div class="foot">
            <el-tag v-for="t in strList(x.tags).slice(0, 4)" :key="t" size="small" type="info">{{ t }}</el-tag>
            <span class="date">{{ String(x.createdAt || '').slice(0, 10) }}</span>
          </div>
        </article>
      </div>
      <el-pagination v-if="total > query.size" class="pager" layout="prev, pager, next" :total="total" :page-size="query.size"
        :current-page="query.page" @current-change="load" />
    </div>

    <el-drawer v-model="drawer" :title="current?.title" size="min(640px, 100vw)" append-to-body>
      <template v-if="current">
        <div class="meta">
          <el-tag size="small" :type="KIND_TAG[current.kind]" effect="plain">{{ $t('experience.kinds.' + current.kind) }}</el-tag>
          <span>{{ $t('experience.reusable') }} {{ '★'.repeat(current.reusableLevel || 0) }}</span>
          <router-link v-if="current.conversationId" :to="`/admin/conversations/${current.conversationId}`">{{ $t('experience.from_conversation') }}</router-link>
        </div>
        <div class="md" v-html="renderMd(current.body)"></div>
        <p v-if="current.obsidianPath" class="muted">{{ $t('experience.synced_to', { p: current.obsidianPath }) }}</p>
        <el-button size="small" :loading="syncing" @click="sync(current)">{{ $t('experience.sync_obsidian') }}</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import ExperienceTabs from '@/components/devlog/ExperienceTabs.vue'
import { EXPERIENCE_KINDS, strList } from '../conversations/conversationUtils.js'
import { firstSentence } from '../today/todayUtils.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'

const KIND_TAG = { EXPERIENCE: 'success', DECISION: 'primary', PITFALL: 'danger', HOWTO: 'info', DRIFT: 'warning' }
const query = reactive({ keyword: '', kind: '', page: 1, size: 24 })
const list = ref([])
const total = ref(0)
const loading = ref(false)
const error = ref('')

async function load(page = query.page) {
  query.page = page
  loading.value = true
  error.value = ''
  try {
    const d = await fde.experience.list({ keyword: query.keyword, kind: query.kind, page: query.page, size: query.size })
    list.value = d.list || []
    total.value = d.total || 0
  } catch (e) { error.value = e.message } finally { loading.value = false }
}

const drawer = ref(false)
const current = ref(null)
function open(x) { current.value = x; drawer.value = true }

// 正文是人/模型写的 Markdown, 走消毒渲染
const renderMd = (text) => renderSafeMarkdown(String(text || ''))

const syncing = ref(false)
async function sync(x) {
  syncing.value = true
  try {
    const r = await fde.experience.syncObsidian(x.id)
    if (r?.ok === false) ElMessage.warning(r.error || $t('experience.sync_failed'))
    else {
      ElMessage.success($t('experience.sync_ok'))
      if (r?.path) x.obsidianPath = r.path
    }
  } catch (e) { ElMessage.error(e.message) } finally { syncing.value = false }
}

onMounted(() => load(1))
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.search { width: 260px; }
.kind { width: 140px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.card { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 12px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; }
.card:hover { border-color: #c9c4bc; }
.head { display: flex; justify-content: space-between; align-items: center; }
.reuse { color: #b3450f; font-size: 12px; letter-spacing: 1px; }
.card h4 { margin: 0; font-size: 14px; color: #1c1917; }
.body { margin: 0; font-size: 13px; color: #5c574f; line-height: 1.5; }
.foot { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.date { margin-left: auto; font-size: 12px; color: #8f8a82; }
.pager { margin-top: 14px; justify-content: center; }
.meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13px; color: #5c574f; margin-bottom: 10px; }
.md { font-size: 14px; line-height: 1.7; color: #1c1917; }
.muted { color: #8f8a82; font-size: 12px; }
@media (max-width: 768px) { .search { width: 100%; } }
</style>
