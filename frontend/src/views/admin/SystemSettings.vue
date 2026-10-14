<template>
  <div class="settings-page" v-loading="loading">
    <div class="page-header">
      <h2 class="page-title">{{ $t('systemSettings.title') }}</h2>
      <p class="hint">{{ $t('systemSettings.subtitle') }}</p>
    </div>

    <el-tabs v-model="tab" class="settings-tabs" @tab-change="onTabChange">
      <!-- 以虎 One: 接入情况(只读) -->
      <el-tab-pane :label="$t('systemSettings.tab_platform')" name="platform">
        <el-card shadow="never" class="block-card">
          <template v-if="platform">
            <el-descriptions :column="1" border>
              <el-descriptions-item :label="$t('systemSettings.platform')">
                <el-tag type="success" size="small">{{ platform.name }}</el-tag>
                <a :href="platform.url" target="_blank" rel="noopener" class="mono">{{ platform.url }}</a>
              </el-descriptions-item>
              <el-descriptions-item v-if="platform.space" :label="$t('systemSettings.space')">
                {{ platform.space.name }} <span class="dim">（{{ $t('systemSettings.space_note') }}）</span>
              </el-descriptions-item>
              <el-descriptions-item :label="$t('systemSettings.directory_sync')">
                <template v-if="sync && !sync.error">
                  {{ $t('systemSettings.directory_sync_result', { p0: fmt(sync.at), p1: sync.checked, p2: sync.updated, p3: sync.disabled }) }}
                </template>
                <span v-else-if="sync?.error" class="error-text">{{ sync.error }}</span>
                <span v-else class="dim">{{ $t('systemSettings.directory_sync_pending') }}</span>
              </el-descriptions-item>
              <el-descriptions-item :label="$t('systemSettings.ai_access')">
                <div>{{ $t('systemSettings.ai_access_assistant', { p0: platform.name }) }}</div>
                <div v-if="platform.gatewayMcpUrl">{{ $t('systemSettings.ai_access_personal') }} <code class="mono">{{ platform.gatewayMcpUrl }}</code></div>
                <div>{{ $t('systemSettings.ai_access_robot') }} <code class="mono">{{ platform.agentMcpUrl }}</code></div>
              </el-descriptions-item>
            </el-descriptions>
            <p class="hint" style="margin-top: 12px;">{{ $t('systemSettings.brand_from_platform', { p0: platform.name }) }}</p>
          </template>
          <el-alert v-else type="warning" :closable="false" show-icon :title="$t('systemSettings.not_connected')" />
        </el-card>
      </el-tab-pane>

      <!-- 账号与消息 -->
      <el-tab-pane :label="$t('systemSettings.tab_accounts')" name="accounts">
        <el-card shadow="never" class="block-card">
          <el-form label-width="180px" class="settings-form" @submit.prevent>
            <el-form-item :label="$t('systemSettings.new_accounts')">
              <span v-if="platform">{{ platform.autoCreate ? $t('systemSettings.auto_create', { p0: platform.defaultRoleName }) : $t('systemSettings.admin_creates') }}</span>
              <span v-else class="dim">—</span>
            </el-form-item>
            <el-form-item :label="$t('systemSettings.platform_admins')">
              <span>{{ $t('systemSettings.platform_admins_rule', { p0: platform?.name || 'Yihu One' }) }}</span>
            </el-form-item>
            <el-form-item :label="$t('systemSettings.leader_is_manager')">
              <el-switch v-model="form['auth.leaderIsManager']" />
              <div class="field-note">{{ $t('systemSettings.leader_is_manager_note') }}</div>
            </el-form-item>
            <el-form-item :label="$t('systemSettings.platform_messages')">
              <el-switch v-model="form['notify.platform']" />
              <div class="field-note">{{ $t('systemSettings.platform_messages_note', { p0: platform?.name || 'Yihu One' }) }}</div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">{{ $t('common.save') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 大模型 -->
      <el-tab-pane :label="$t('common.llm_settings')" name="llm" lazy>
        <LlmConfigs embedded />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import LlmConfigs from './LlmConfigs.vue'

const TABS = ['platform', 'accounts', 'llm']
const route = useRoute()
const router = useRouter()
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'platform')
const loading = ref(false)
const saving = ref(false)
const data = ref(null)
const form = reactive({})

const platform = computed(() => data.value?.platform || null)
const sync = computed(() => platform.value?.directorySync || null)
const fmt = (t) => (t ? new Date(t).toLocaleString() : '')

function fill(d) {
  data.value = d
  for (const s of d.settings) form[s.key] = s.value
}

async function load() {
  loading.value = true
  try { fill(await fde.systemSettings.get()) } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

async function save() {
  saving.value = true
  try {
    const values = Object.fromEntries(data.value.settings.map(s => [s.key, form[s.key]]))
    fill(await fde.systemSettings.update(values))
    ElMessage.success($t('common.saved'))
  } catch (e) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

function onTabChange(name) {
  router.replace({ query: { ...route.query, tab: name } })
}

onMounted(load)
</script>

<style scoped>
.settings-page { display: flex; flex-direction: column; gap: 8px; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.block-card { border-radius: 12px; }
.settings-form { max-width: 760px; }
.field-note { width: 100%; font-size: 12px; color: #a8a29e; line-height: 1.5; margin-top: 4px; }
.dim { color: #a8a29e; }
.error-text { color: var(--el-color-danger); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f5f5f4; padding: 1px 6px; border-radius: 4px; color: #44403c; margin-left: 6px; }
</style>
