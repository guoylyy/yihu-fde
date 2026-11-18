<template>
  <!-- 0.5.0 开发会话: 采集器上报 / 平台助手 / 手动粘贴进来的 AI 对话, 默认只看我的 -->
  <div class="conversations">
    <div class="toolbar">
      <el-radio-group v-model="query.scope" size="small" @change="load(1)">
        <el-radio-button value="me">{{ $t('conversations.mine') }}</el-radio-button>
        <el-radio-button value="all">{{ $t('conversations.all_visible') }}</el-radio-button>
      </el-radio-group>
      <el-input v-model="query.keyword" :placeholder="$t('conversations.search')" clearable class="search" @keyup.enter="load(1)" @clear="load(1)" />
      <el-select v-model="query.source" :placeholder="$t('conversations.source')" clearable class="sel" @change="load(1)">
        <el-option v-for="s in SOURCES" :key="s" :value="s" :label="$t('conversations.sources.' + s)" />
      </el-select>
      <el-select v-model="query.stage" :placeholder="$t('conversations.stage')" clearable class="sel" @change="load(1)">
        <el-option v-for="s in STAGES" :key="s" :value="s" :label="$t('conversations.stages.' + s)" />
      </el-select>
      <div class="actions">
        <el-button data-test="conv-paste" @click="pasteVisible = true">{{ $t('today.log_conversation') }}</el-button>
        <el-button type="primary" data-test="conv-upload" @click="uploadVisible = true">{{ $t('conversations.upload_btn') }}</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="list" stripe class="conv-table" :empty-text="error || $t('today.no_conversations')"
      @row-click="row => $router.push(`/admin/conversations/${row.id}`)">
      <el-table-column :label="$t('conversations.title_col')" min-width="260">
        <template #default="{ row }">
          <div class="cell-title">
            <strong>{{ row.title || $t('conversations.untitled') }}</strong>
            <span class="sub">{{ firstSentence(row.summary, 80) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="$t('conversations.source')" width="130">
        <template #default="{ row }">{{ $t('conversations.sources.' + row.source) }}</template>
      </el-table-column>
      <el-table-column :label="$t('conversations.stage')" width="100">
        <template #default="{ row }">{{ $t('conversations.stages.' + row.stage) }}</template>
      </el-table-column>
      <el-table-column :label="$t('conversations.status')" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'LINKED' ? 'success' : 'info'" effect="plain">{{ $t('conversations.statuses.' + row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="engineerName" :label="$t('conversations.engineer')" width="100" />
      <el-table-column :label="$t('conversations.time')" width="120">
        <template #default="{ row }">{{ convTime(row) }}</template>
      </el-table-column>
    </el-table>
    <el-pagination v-if="total > query.size" class="pager" layout="prev, pager, next" :total="total" :page-size="query.size"
      :current-page="query.page" @current-change="load" />

    <PasteConversationDialog v-model="pasteVisible" @saved="load(1)" />
    <UploadConversationDialog v-model="uploadVisible" @saved="load(1)" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { fde } from '@/api/index.js'
import PasteConversationDialog from '@/components/devlog/PasteConversationDialog.vue'
import UploadConversationDialog from '@/components/devlog/UploadConversationDialog.vue'
import { SOURCES, STAGES, convTime } from './conversationUtils.js'
import { firstSentence } from '../today/todayUtils.js'

const query = reactive({ scope: 'me', keyword: '', source: '', stage: '', page: 1, size: 20 })
const list = ref([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const pasteVisible = ref(false)
const uploadVisible = ref(false)

async function load(page = query.page) {
  query.page = page
  loading.value = true
  error.value = ''
  try {
    const d = await fde.devConversations.list({
      engineerId: query.scope === 'me' ? 'me' : '',
      keyword: query.keyword, source: query.source, stage: query.stage, page: query.page, size: query.size
    })
    list.value = d.list || []
    total.value = d.total || 0
  } catch (e) { error.value = e.message; list.value = [] } finally { loading.value = false }
}

onMounted(() => load(1))
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.search { width: 220px; }
.sel { width: 130px; }
.actions { margin-left: auto; display: flex; gap: 8px; }
.actions .el-button + .el-button { margin-left: 0; }
.conv-table :deep(.el-table__row) { cursor: pointer; }
.cell-title { display: flex; flex-direction: column; min-width: 0; }
.cell-title strong { font-weight: 500; color: #1c1917; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { font-size: 12px; color: #8f8a82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pager { margin-top: 14px; justify-content: center; }
@media (max-width: 768px) {
  .search { width: 100%; }
  .actions { margin-left: 0; width: 100%; }
  .actions .el-button { flex: 1; }
}
</style>
