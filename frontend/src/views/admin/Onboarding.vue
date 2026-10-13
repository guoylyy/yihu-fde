<template>
  <div class="onboarding-page" v-loading="loading">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.developer_onboarding') }}</h2>
        <p class="hint">{{ $t('onboarding.finish_these_five_steps_youll_deliver') }}
          <a href="/docs/dev-workflow" target="_blank" class="doc-link">{{ $t('onboarding.full_guide_from_zero_delivery') }}</a> ·
          <a href="/docs/auto-dev" target="_blank" class="doc-link">{{ $t('onboarding.advanced_connect_project_auto_dev_mode') }}</a>
        </p>
      </div>
      <el-button @click="load">{{ $t('onboarding.refresh_progress') }}</el-button>
    </div>

    <!-- 我的进度 -->
    <el-card shadow="never" class="block-card">
      <template #header>
        <div class="block-title">
          <span>{{ $t('onboarding.my_progress') }}</span>
          <el-tag :type="doneCount >= steps.length ? 'success' : 'primary'" effect="light" style="margin-left: 10px;">
            {{ $t('common.p0', { p0: doneCount >= steps.length ? $t('onboarding.all_done') : `${doneCount}/${steps.length}` }) }}
          </el-tag>
        </div>
      </template>

      <div v-for="(s, i) in steps" :key="s.key" class="step-row" :class="{ done: s.done, current: i === currentIdx }">
        <div class="step-badge">
          <span v-if="s.done">✓</span>
          <span v-else>{{ i + 1 }}</span>
        </div>
        <div class="step-body">
          <div class="step-title">{{ s.title }}
            <el-tag v-if="i === currentIdx" size="small" type="warning" effect="plain">{{ $t('onboarding.current_step') }}</el-tag>
          </div>
          <div class="step-desc">{{ s.desc }}</div>

          <!-- 第 1 步的动作区: 生成并下载配置包 -->
          <div v-if="s.key === 'package'" class="step-action">
            <el-button type="primary" size="small" :loading="downloading" @click="downloadPackage">
              {{ $t('common.p0', { p0: s.done ? $t('onboarding.regenerate_download') : $t('onboarding.generate_download_kit') }) }}
            </el-button>
            <span v-if="s.done" class="action-note">{{ $t('onboarding.downloading_again_issues_new_key_old') }}</span>
          </div>
          <!-- 第 2 步提示连接地址 -->
          <div v-else-if="s.key === 'mcp' && !s.done" class="step-action">
            <span class="action-note">{{ $t('onboarding.platform_url') }}<code>{{ mcpUrl }}</code>{{ $t('onboarding.already_filled_in_kit_put_files') }}</span>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 我的开发助手入口 (v2.13.0 #1281) -->
    <el-card shadow="never" class="block-card">
      <template #header><span class="block-title">{{ $t('onboarding.my_dev_assistants') }}</span></template>
      <div class="mybots-entry">
        <span>{{ $t('onboarding.manage_robots_you_own_patrol_dispatch') }}</span>
        <el-button type="primary" plain @click="$router.push('/admin/my-bots')">{{ $t('onboarding.open_my_dev_assistants') }}</el-button>
      </div>
    </el-card>

    <!-- 全员进度 (经理/管理员) -->
    <el-card v-if="isManager" shadow="never" class="block-card">
      <template #header><span class="block-title">{{ $t('onboarding.everyones_progress') }}</span></template>
      <el-table :data="overview" stripe v-loading="overviewLoading">
        <el-table-column :label="$t('common.members')" width="160">
          <template #default="{ row }">{{ row.name }} <span class="muted">{{ row.username }}</span></template>
        </el-table-column>
        <el-table-column :label="$t('common.role')" width="120">
          <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.role }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="$t('common.progress')" width="200">
          <template #default="{ row }">
            <el-progress :percentage="Math.round(row.doneCount / row.total * 100)" :stroke-width="8"
              :color="row.doneCount >= row.total ? '#2e7d4f' : '#d2521e'" />
          </template>
        </el-table-column>
        <el-table-column :label="$t('onboarding.steps')" min-width="180">
          <template #default="{ row }">
            <span v-for="s in row.steps" :key="s.key" class="dot" :class="{ on: s.done }" :title="s.title"></span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('onboarding.stuck_at')" min-width="160">
          <template #default="{ row }">
            <span v-if="!row.currentStep" class="all-done">{{ $t('onboarding.all_done_2') }}</span>
            <span v-else>{{ row.currentStep }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'

const user = JSON.parse(localStorage.getItem('fde_internal_user') || 'null')
const isManager = computed(() => ['ADMIN', 'MANAGER'].includes(user?.role))

const loading = ref(false)
const steps = ref([])
const doneCount = ref(0)
const mcpUrl = ref('')
// 步骤可能跳着完成, 「当前步骤」= 第一个未完成的
const currentIdx = computed(() => steps.value.findIndex(s => !s.done))

const overview = ref([])
const overviewLoading = ref(false)

async function load() {
  loading.value = true
  try {
    const d = await fde.onboarding.steps()
    steps.value = d.steps
    doneCount.value = d.doneCount
    mcpUrl.value = d.mcpUrl
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
  if (isManager.value) loadOverview()
}

async function loadOverview() {
  overviewLoading.value = true
  try {
    const d = await fde.onboarding.overview()
    overview.value = d.list
  } catch (e) { /* 权限不足等静默 */ }
  finally { overviewLoading.value = false }
}

const downloading = ref(false)
async function downloadPackage() {
  downloading.value = true
  try {
    const blob = await fde.onboarding.downloadPackage()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'fde-dev-kit.zip'
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success($t('onboarding.kit_downloaded_key_in_mcp_json'))
    load()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    downloading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.onboarding-page { display: flex; flex-direction: column; gap: 12px; }
.page-header { display: flex; align-items: center; justify-content: space-between; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.doc-link { color: #d2521e; text-decoration: none; }
.doc-link:hover { text-decoration: underline; }
.block-card { border-radius: 12px; }
.block-title { display: flex; align-items: center; font-weight: 600; }

.step-row { display: flex; gap: 14px; padding: 14px 6px; border-bottom: 1px dashed #f0ede8; }
.step-row:last-of-type { border-bottom: none; }
.step-badge {
  width: 28px; height: 28px; border-radius: 50%; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: #f0ede8; color: #868580; font-weight: 700; font-size: 14px;
}
.step-row.done .step-badge { background: #2e7d4f; color: #fff; }
.step-row.current .step-badge { background: #d2521e; color: #fff; }
.step-body { flex: 1; }
.step-title { font-weight: 600; font-size: 14px; color: #1c1917; display: flex; align-items: center; gap: 8px; }
.step-row.done .step-title { color: #2e7d4f; }
.step-desc { font-size: 13px; color: #868580; margin-top: 4px; line-height: 1.6; }
.step-action { margin-top: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.action-note { font-size: 12px; color: #909399; }
.action-note code { background: #f0eee9; padding: 1px 6px; border-radius: 3px; font-size: 12px; }

.muted { font-size: 12px; color: #909399; margin-left: 4px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #e5e1da; margin-right: 6px; }
.dot.on { background: #2e7d4f; }
.all-done { color: #2e7d4f; font-weight: 600; }
</style>

.mybots-entry { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 14px; color: #57534e; }
