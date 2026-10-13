<template>
  <div class="assets-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">{{ $t('common.asset_library') }}</h2>
        <div class="page-sub">{{ $t('assets.things_weve_built_ready_for_next') }}</div>
      </div>
      <div class="head-actions">
        <el-button v-if="can('asset.manage') && meta.stats?.drafts" plain @click="setFilter('status', 'DRAFT')">
          {{ $t('assets.drafts_review') }} <el-badge :value="meta.stats.drafts" class="draft-badge" />
        </el-button>
        <el-button v-if="can('asset.create')" type="primary" :icon="Plus" @click="openCreate">{{ $t('common.register_asset') }}</el-button>
      </div>
    </div>

    <!-- 统计 -->
    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-label">{{ $t('assets.total_assets') }}</div>
        <div class="stat-value">{{ meta.stats?.total ?? '—' }}</div>
        <div class="stat-foot">
          <span v-for="(label, k) in meta.layers" :key="k">{{ label }} {{ meta.stats?.byLayer?.[k] || 0 }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('assets.copyable_as_l2') }}</div>
        <div class="stat-value">{{ (meta.stats?.byMaturity?.L2 || 0) + (meta.stats?.byMaturity?.L3 || 0) }}</div>
        <div class="stat-foot">{{ $t('assets.code_in_asset_repository_copy_directory') }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('assets.reuses') }}</div>
        <div class="stat-value">{{ meta.stats?.usageCount ?? 0 }}</div>
        <div class="stat-foot">{{ $t('assets.counted_after_reuse_recorded') }}</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-label">{{ $t('assets.total_saved') }}</div>
        <div class="stat-value">{{ meta.stats?.savedDays ?? 0 }}<small> {{ $t('common.person_days') }}</small></div>
        <div class="stat-foot">{{ $t('assets.this_number_asset_librarys_value') }}</div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-input v-model="filters.keyword" :placeholder="$t('assets.search_names_descriptions_write_ups_e')" clearable :prefix-icon="Search"
        class="kw" @keyup.enter="reload" @clear="reload" />
      <el-radio-group v-model="filters.layer" @change="reload">
        <el-radio-button value="">{{ $t('common.all') }}</el-radio-button>
        <el-radio-button v-for="(label, k) in meta.layers" :key="k" :value="k">{{ label }}</el-radio-button>
      </el-radio-group>
      <el-select v-model="filters.maturity" :placeholder="$t('common.maturity')" clearable style="width: 130px" @change="reload">
        <el-option v-for="(label, k) in meta.maturities" :key="k" :label="`${k} ${label}`" :value="k" />
      </el-select>
      <el-select v-model="filters.industry" :placeholder="$t('common.industry')" clearable filterable style="width: 120px" @change="reload">
        <el-option v-for="i in meta.industries" :key="i" :label="i" :value="i" />
      </el-select>
      <el-select v-model="filters.tech" :placeholder="$t('common.tech_stack')" clearable filterable style="width: 130px" @change="reload">
        <el-option v-for="t in meta.techStacks" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-if="can('asset.manage')" v-model="filters.status" :placeholder="$t('common.status')" clearable style="width: 110px" @change="reload">
        <el-option :label="$t('common.published')" value="PUBLISHED" />
        <el-option :label="$t('common.draft')" value="DRAFT" />
        <el-option :label="$t('common.deprecated')" value="DEPRECATED" />
      </el-select>
      <el-select v-model="filters.sort" style="width: 120px" @change="reload">
        <el-option :label="$t('assets.most_reused')" value="usage" />
        <el-option :label="$t('assets.recently_updated')" value="updated" />
      </el-select>
    </div>

    <!-- 卡片 -->
    <div v-loading="loading" class="grid">
      <div v-for="a in list" :key="a.id" class="asset-card" :class="{ draft: a.status !== 'PUBLISHED' }" @click="open(a)">
        <div class="card-top">
          <span class="layer-tag" :class="'layer-' + a.layer.toLowerCase()">{{ meta.layers?.[a.layer] || a.layer }}</span>
          <span class="maturity" :class="'m-' + a.maturity" :title="maturityHint[a.maturity]">{{ a.maturity }} {{ meta.maturities?.[a.maturity] }}</span>
          <el-tag v-if="a.status === 'DRAFT'" size="small" type="warning" effect="plain">{{ $t('common.p0', { p0: a.aiGenerated ? $t('common.ai_draft') : $t('common.draft') }) }}</el-tag>
          <el-tag v-if="a.status === 'DEPRECATED'" size="small" type="info" effect="plain">{{ $t('common.deprecated') }}</el-tag>
          <span class="spacer" />
          <span v-if="a.authorization === 'RESTRICTED'" class="auth restricted" :title="$t('assets.from_customer_project_reference_ideas_only')">{{ $t('assets.reference_only') }}</span>
          <span v-else-if="a.authorization === 'INTERNAL'" class="auth internal" :title="$t('assets.in_house_reusable_as')">{{ $t('common.in_house') }}</span>
          <span v-else class="auth cleared" :title="$t('assets.customer_approved_reuse')">{{ $t('assets.licensed') }}</span>
        </div>
        <div class="card-name">{{ a.name }}</div>
        <div class="card-summary">{{ a.summary }}</div>
        <div class="card-chips">
          <span v-for="t in (a.techStack || []).slice(0, 4)" :key="t" class="chip tech">{{ t }}</span>
          <span v-for="i in (a.industries || []).slice(0, 2)" :key="i" class="chip">{{ i }}</span>
        </div>
        <div class="card-foot">
          <span v-if="a.estSavedDays" :title="$t('assets.estimated_savings_per_reuse')">{{ $t('assets.saves_person_days_each_time', { p0: Number(a.estSavedDays) }) }}</span>
          <span>{{ $t('common.reused_times', { p0: a.usageCount }) }}</span>
          <span v-if="a.assetRepoPath" class="repo" :title="$t('common.asset_repository', { p0: a.assetRepoPath })">📦 {{ a.assetRepoPath }}</span>
        </div>
      </div>
      <el-empty v-if="!loading && !list.length" class="empty" :description="emptyText" />
    </div>
    <div v-if="total > list.length" class="more">
      <el-button text @click="loadMore">{{ $t('common.load_more', { p0: list.length, p1: total }) }}</el-button>
    </div>

    <AssetEditDialog v-model="editVisible" :meta="meta" @saved="onSaved" />
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Plus, Search } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import AssetEditDialog from '@/components/admin/assets/AssetEditDialog.vue'

const router = useRouter()
const route = useRoute()
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const meta = ref({ layers: {}, maturities: {}, industries: [], techStacks: [], stats: {} })
const filters = reactive({
  keyword: route.query.keyword || '', layer: route.query.layer || '', maturity: '', industry: '',
  tech: '', status: route.query.status || '', sort: 'usage'
})
const editVisible = ref(false)

const maturityHint = {
  L0: $t('common.lead_one_liner_origin_ask_owner'),
  L1: $t('common.reference_has_redacted_write_up_key'),
  L2: $t('common.copyable_code_extracted_into_asset_repository'),
  L3: $t('common.installable_standalone_package_service_install_u')
}
const emptyText = computed(() => (filters.keyword ? $t('assets.no_assets_match_register_one_when', { p0: filters.keyword }) : $t('assets.no_assets')))

async function loadMeta() {
  meta.value = await fde.assets.meta()
}
async function load(more = false) {
  loading.value = true
  try {
    page.value = more ? page.value + 1 : 1
    // URLSearchParams 会把 undefined 变成字符串，空筛选一律传空串
    const params = { page: page.value, page_size: 24, sort: filters.sort }
    for (const k of ['keyword', 'layer', 'maturity', 'industry', 'tech', 'status']) if (filters[k]) params[k] = filters[k]
    const data = await fde.assets.list(params)
    list.value = more ? list.value.concat(data.list) : data.list
    total.value = data.total
  } finally { loading.value = false }
}
function reload() { load(false) }
function loadMore() { load(true) }
function setFilter(k, v) { filters[k] = v; reload() }
function open(a) { router.push(`/admin/assets/${a.slug}`) }
function openCreate() { editVisible.value = true }
function onSaved(a) { router.push(`/admin/assets/${a.slug}`) }

onMounted(() => { loadMeta(); load() })
</script>

<style scoped>
.assets-page { padding: 4px 0 24px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.page-title { margin: 0; font-size: 20px; }
.page-sub { color: var(--el-text-color-secondary); font-size: 13px; margin-top: 4px; }
.head-actions { display: flex; gap: 8px; align-items: center; }
.draft-badge { margin-left: 6px; }
.draft-badge :deep(.el-badge__content) { position: static; transform: none; }

.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 14px 16px; background: var(--el-bg-color); }
.stat-card.accent { background: linear-gradient(135deg, rgba(245, 78, 0, 0.06), rgba(245, 78, 0, 0.01)); border-color: rgba(245, 78, 0, 0.25); }
.stat-label { font-size: 12px; color: var(--el-text-color-secondary); }
.stat-value { font-size: 26px; font-weight: 700; margin: 4px 0; font-variant-numeric: tabular-nums; }
.stat-value small { font-size: 13px; font-weight: 500; color: var(--el-text-color-secondary); }
.stat-foot { font-size: 12px; color: var(--el-text-color-secondary); display: flex; gap: 10px; flex-wrap: wrap; }

.filter-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
.filter-bar .kw { width: 300px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; min-height: 120px; }
.asset-card {
  border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 14px 16px; background: var(--el-bg-color);
  cursor: pointer; transition: border-color .15s, box-shadow .15s; display: flex; flex-direction: column; gap: 8px;
}
.asset-card:hover { border-color: var(--el-color-primary-light-5); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05); }
.asset-card.draft { border-style: dashed; }
.card-top { display: flex; align-items: center; gap: 6px; }
.spacer { flex: 1; }
.layer-tag { font-size: 11px; padding: 1px 7px; border-radius: 4px; font-weight: 600; }
.layer-framework { background: #eef2ff; color: #4338ca; }
.layer-arch { background: #ecfeff; color: #0e7490; }
.layer-biz { background: #fff7ed; color: #c2410c; }
.maturity { font-size: 11px; padding: 1px 7px; border-radius: 4px; border: 1px solid var(--el-border-color); color: var(--el-text-color-regular); }
.m-L2, .m-L3 { border-color: #16a34a; color: #15803d; background: #f0fdf4; }
.auth { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.auth.restricted { color: #9a3412; background: #fff7ed; }
.auth.internal { color: #15803d; background: #f0fdf4; }
.auth.cleared { color: #1d4ed8; background: #eff6ff; }
.card-name { font-size: 16px; font-weight: 600; }
.card-summary { font-size: 13px; color: var(--el-text-color-regular); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-height: 60px; }
.card-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); }
.chip.tech { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.card-foot { display: flex; gap: 12px; font-size: 12px; color: var(--el-text-color-secondary); flex-wrap: wrap; margin-top: auto; }
.card-foot .repo { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.empty { grid-column: 1 / -1; }
.more { text-align: center; margin-top: 12px; }

@media (max-width: 900px) {
  .stat-row { grid-template-columns: repeat(2, 1fr); }
  .filter-bar .kw { width: 100%; }
}
</style>
