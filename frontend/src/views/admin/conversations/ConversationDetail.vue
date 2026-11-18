<template>
  <!-- 0.5.0 会话详情: 摘要 / 决策 / 踩坑 / 正文, 一键沉淀成经验 -->
  <div class="conv-detail" v-loading="loading">
    <el-button link class="back" @click="$router.push('/admin/conversations')">← {{ $t('conversations.back') }}</el-button>
    <el-empty v-if="!loading && !c" :description="error || $t('conversations.not_found')" />
    <template v-if="c">
      <header class="head">
        <h2 data-test="conv-title">{{ c.title || $t('conversations.untitled') }}</h2>
        <div class="meta">
          <el-tag size="small" effect="plain">{{ $t('conversations.sources.' + c.source) }}</el-tag>
          <el-tag size="small" effect="plain" type="info">{{ $t('conversations.stages.' + c.stage) }}</el-tag>
          <el-tag size="small" :type="c.status === 'LINKED' ? 'success' : 'info'">{{ $t('conversations.statuses.' + c.status) }}</el-tag>
          <span v-if="c.engineerName">{{ c.engineerName }}</span>
          <span>{{ convTime(c) }}</span>
          <span v-if="c.model">{{ c.model }}</span>
          <span v-if="c.branch" class="mono">{{ c.branch }}</span>
          <router-link v-if="c.projectId" :to="`/admin/projects/${c.projectId}`">{{ $t('conversations.open_project') }}</router-link>
        </div>
        <div class="actions">
          <el-button size="small" :loading="summarizing" @click="summarize">{{ c.summary ? $t('conversations.resummarize') : $t('conversations.summarize') }}</el-button>
          <el-button size="small" type="primary" :loading="distilling" data-test="conv-distill" @click="distill">{{ $t('conversations.to_experience') }}</el-button>
        </div>
      </header>

      <section class="block">
        <h3>{{ $t('conversations.summary') }}</h3>
        <p v-if="c.summary" class="summary">{{ c.summary }}</p>
        <p v-else class="muted">{{ $t('conversations.no_summary') }}</p>
        <div v-if="decisions.length" class="list">
          <h4>{{ $t('conversations.decisions') }}</h4>
          <ul><li v-for="(d, i) in decisions" :key="'d' + i">{{ d }}</li></ul>
        </div>
        <div v-if="pitfalls.length" class="list">
          <h4>{{ $t('conversations.pitfalls') }}</h4>
          <ul><li v-for="(d, i) in pitfalls" :key="'p' + i">{{ d }}</li></ul>
        </div>
        <div v-if="tags.length" class="tags"><el-tag v-for="t in tags" :key="t" size="small" type="info">{{ t }}</el-tag></div>
      </section>

      <section v-if="c.events?.length" class="block">
        <h3>{{ $t('conversations.events') }}</h3>
        <ul class="events">
          <li v-for="e in c.events" :key="e.id"><el-tag size="small" effect="plain">{{ e.kind }}</el-tag> {{ e.text }}</li>
        </ul>
      </section>

      <section class="block">
        <h3>{{ $t('conversations.body') }}<span v-if="c.bodyRedacted" class="muted"> · {{ $t('conversations.redacted') }}</span></h3>
        <p v-if="!messages.length" class="muted">{{ $t('conversations.no_body') }}</p>
        <div v-for="(m, i) in messages" :key="i" class="msg" :class="'role-' + m.role">
          <span class="role">{{ m.role }}</span>
          <pre>{{ m.content }}</pre>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { strList, bodyMessages, convTime } from './conversationUtils.js'

const route = useRoute()
const router = useRouter()
const c = ref(null)
const loading = ref(false)
const error = ref('')
const decisions = computed(() => strList(c.value?.decisions))
const pitfalls = computed(() => strList(c.value?.pitfalls))
const tags = computed(() => strList(c.value?.tags))
const messages = computed(() => bodyMessages(c.value?.body))

async function load() {
  loading.value = true
  error.value = ''
  try { c.value = await fde.devConversations.get(route.params.id) } catch (e) { error.value = e.message; c.value = null } finally { loading.value = false }
}

const summarizing = ref(false)
async function summarize() {
  summarizing.value = true
  try {
    await fde.devConversations.summarize(c.value.id)
    await load()
  } catch (e) { ElMessage.error(e.message) } finally { summarizing.value = false }
}

const distilling = ref(false)
async function distill() {
  distilling.value = true
  try {
    await fde.experience.fromConversation({ conversationId: c.value.id, auto: true })
    ElMessage.success($t('conversations.experience_saved'))
    router.push('/admin/experience')
  } catch (e) { ElMessage.error(e.message) } finally { distilling.value = false }
}

watch(() => route.params.id, (id) => { if (id) load() }, { immediate: true })
</script>

<style scoped>
.conv-detail { max-width: 960px; display: flex; flex-direction: column; gap: 12px; }
.back { align-self: flex-start; }
.head h2 { margin: 0 0 6px; font-size: 18px; color: #1c1917; }
.meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 12px; color: #5c574f; }
.mono { font-family: ui-monospace, Menlo, monospace; }
.actions { margin-top: 10px; display: flex; gap: 8px; }
.block { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 12px 14px; }
.block h3 { margin: 0 0 8px; font-size: 14px; }
.block h4 { margin: 10px 0 4px; font-size: 13px; color: #5c574f; }
.summary { margin: 0; line-height: 1.7; white-space: pre-wrap; }
.list ul, .events { margin: 0; padding-left: 18px; line-height: 1.7; font-size: 13px; }
.events { list-style: none; padding-left: 0; }
.tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
.muted { color: #8f8a82; font-size: 12px; }
.msg { border-top: 1px solid #f3f1ee; padding: 8px 0; }
.role { font-size: 11px; color: #8f8a82; text-transform: uppercase; }
.msg pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13px; line-height: 1.6; }
.role-user pre { color: #1c1917; }
.role-assistant pre { color: #3d3a35; }
</style>
