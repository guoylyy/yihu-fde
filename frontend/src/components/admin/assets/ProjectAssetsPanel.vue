<!-- 项目页「资产」Tab：出自本项目的资产 + 本项目复用了哪些资产 + 收尾沉淀入口 -->
<template>
  <div v-loading="loading" class="pa">
    <div class="pa-head">
      <div>
        <div class="pa-title">{{ $t('projectAssetsPanel.assets_from_this_project') }}</div>
        <div class="muted">{{ $t('projectAssetsPanel.things_built_in_project_that_other') }}</div>
      </div>
      <div class="pa-actions">
        <el-button v-if="can('asset.create')" :loading="drafting" @click="draft">
          {{ $t('projectAssetsPanel.draft_assets_from_this_project') }}
        </el-button>
        <el-button v-if="can('asset.create')" type="primary" plain @click="createVisible = true">{{ $t('common.register_asset') }}</el-button>
      </div>
    </div>
    <div v-if="sourced.length" class="pa-list">
      <div v-for="a in sourced" :key="a.id" class="pa-item" @click="router.push(`/admin/assets/${a.slug}`)">
        <el-tag size="small" effect="plain">{{ layerLabels[a.layer] }}</el-tag>
        <el-tag size="small" effect="plain" :type="['L2', 'L3'].includes(a.maturity) ? 'success' : 'info'">{{ a.maturity }}</el-tag>
        <el-tag v-if="a.status === 'DRAFT'" size="small" type="warning" effect="plain">{{ $t('common.p0', { p0: a.aiGenerated ? $t('common.ai_draft') : $t('common.draft') }) }}</el-tag>
        <b>{{ a.name }}</b>
        <span class="muted ellipsis">{{ a.summary }}</span>
        <span class="muted">{{ $t('common.reused_times', { p0: a.usageCount }) }}</span>
      </div>
    </div>
    <el-empty v-else :image-size="50" :description="$t('projectAssetsPanel.no_assets_from_this_project_yet')" />

    <div class="pa-title" style="margin-top: 20px;">{{ $t('projectAssetsPanel.reused_in_this_project') }}</div>
    <el-table v-if="usages.length" :data="usages" size="small" border>
      <el-table-column :label="$t('common.assets')" min-width="180">
        <template #default="{ row }">
          <router-link :to="`/admin/assets/${row.asset.slug}`" class="link">{{ row.asset.name }}</router-link>
          <el-tag size="small" effect="plain" style="margin-left: 6px;">{{ row.asset.maturity }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('common.how')" width="90">
        <template #default="{ row }">{{ $t('common.p0', { p0: ({ REFERENCE: $t('common.adapt'), COPY: $t('common.copy_directory'), INSTALL: $t('common.install') })[row.mode] }) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.saved_2')" width="80" align="right">
        <template #default="{ row }">{{ $t('common.p0', { p0: row.savedDays != null ? Number(row.savedDays) + $t('common.days') : '—' }) }}</template>
      </el-table-column>
      <el-table-column prop="feedback" :label="$t('common.feedback')" min-width="200" show-overflow-tooltip />
    </el-table>
    <div v-else class="muted">{{ $t('projectAssetsPanel.nothing_registered_yet_before_development_check') }} <router-link to="/admin/assets" class="link">{{ $t('common.asset_library') }}</router-link> {{ $t('projectAssetsPanel.search_when_you_use_one_click') }}</div>
    <div v-if="savedTotal" class="saved">{{ $t('projectAssetsPanel.saved_by_reusing_assets_in_this') }} <b>{{ savedTotal }}</b> {{ $t('common.person_days') }}</div>

    <AssetEditDialog v-model="createVisible" :meta="meta" :asset="null"
      :preset="project ? { sourceProject: { id: project.id, name: project.name, code: project.code } } : null" @saved="a => router.push(`/admin/assets/${a.slug}`)" />
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import AssetEditDialog from './AssetEditDialog.vue'

const props = defineProps({
  projectId: { type: [String, Number], required: true },
  project: { type: Object, default: null }   // 登记资产时预填出处
})
const router = useRouter()
const loading = ref(false)
const drafting = ref(false)
const sourced = ref([])
const usages = ref([])
const meta = ref({ layers: {}, maturities: {}, industries: [], techStacks: [] })
const createVisible = ref(false)
const layerLabels = { FRAMEWORK: $t('common.project_framework'), ARCH: $t('common.architecture_capability'), BIZ: $t('common.business_capability') }
const savedTotal = computed(() => usages.value.reduce((s, u) => s + Number(u.savedDays || 0), 0))

async function load() {
  loading.value = true
  try {
    const data = await fde.assets.byProject(props.projectId)
    sourced.value = data?.sourced || []
    usages.value = data?.usages || []
  } finally { loading.value = false }
}

async function draft() {
  drafting.value = true
  try {
    const r = await fde.assets.draftFromProject(props.projectId)
    const n = r.created.length
    ElMessage({ type: n ? 'success' : 'info', message: n ? $t('projectAssetsPanel.drafted_assets_publish_after_review_redaction', { p0: n, p1: r.mode === 'AI' ? $t('projectAssetsPanel.ai_drafted') : $t('projectAssetsPanel.skeleton') }) : (r.reason || $t('projectAssetsPanel.ai_found_no_reusable_capability_worth')), duration: 5000 })
    await load()
  } catch (e) {
    ElMessage.error(e.message || $t('projectAssetsPanel.drafting_failed'))
  } finally { drafting.value = false }
}

onMounted(async () => {
  load()
  meta.value = await fde.assets.meta().catch(() => meta.value)
})
defineExpose({ load })
</script>

<style scoped>
.pa-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.pa-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.pa-actions { display: flex; gap: 8px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.pa-list { display: flex; flex-direction: column; gap: 6px; }
.pa-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; cursor: pointer; font-size: 13px; }
.pa-item:hover { border-color: var(--el-color-primary-light-5); }
.ellipsis { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link { color: var(--el-color-primary); text-decoration: none; }
.saved { margin-top: 10px; font-size: 13px; }
.saved b { color: var(--el-color-primary); font-size: 16px; }
</style>
