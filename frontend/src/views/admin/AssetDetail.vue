<template>
  <div v-loading="loading" class="asset-detail">
    <el-button text :icon="ArrowLeft" class="back" @click="router.push('/admin/assets')">{{ $t('common.asset_library') }}</el-button>

    <template v-if="asset">
      <!-- 头部 -->
      <div class="hero">
        <div class="hero-main">
          <div class="hero-tags">
            <span class="layer-tag" :class="'layer-' + asset.layer.toLowerCase()">{{ layerLabels[asset.layer] }}</span>
            <el-tooltip :content="maturityHint[asset.maturity]" placement="top">
              <span class="maturity" :class="'m-' + asset.maturity">{{ asset.maturity }} {{ maturityLabels[asset.maturity] }}</span>
            </el-tooltip>
            <el-tag v-if="asset.status === 'DRAFT'" type="warning" effect="plain" size="small">{{ $t('common.p0', { p0: asset.aiGenerated ? $t('assetDetail.ai_drafted_awaiting_review') : $t('assetDetail.draft_awaiting_review') }) }}</el-tag>
            <el-tag v-if="asset.status === 'DEPRECATED'" type="info" effect="plain" size="small">{{ $t('common.deprecated') }}</el-tag>
            <span class="auth" :class="authClass">{{ authText }}</span>
            <span v-if="asset.currentVersion" class="ver">v{{ asset.currentVersion }}</span>
          </div>
          <h1>{{ asset.name }} <code class="slug">{{ asset.slug }}</code></h1>
          <p class="summary">{{ asset.summary }}</p>
          <div class="hero-meta">
            <span v-if="asset.ownerName">{{ $t('assetDetail.owner', { p0: asset.ownerName }) }}</span>
            <span v-if="asset.estSavedDays">{{ $t('assetDetail.estimated_savings_per_reuse') }} <b>{{ Number(asset.estSavedDays) }}</b> {{ $t('common.person_days') }}</span>
            <span>{{ $t('assetDetail.reused') }} <b>{{ asset.usageCount }}</b> {{ $t('assetDetail.times') }}<template v-if="asset.savedDaysTotal">{{ $t('assetDetail.total_saved') }} <b>{{ asset.savedDaysTotal }}</b> {{ $t('common.person_days') }}</template></span>
            <span v-for="t in asset.techStack || []" :key="t" class="chip tech">{{ t }}</span>
            <span v-for="i in asset.industries || []" :key="i" class="chip">{{ i }}</span>
          </div>
        </div>
        <div class="hero-actions">
          <el-button v-if="can('asset.use') && asset.status === 'PUBLISHED'" type="primary" @click="usageVisible = true">{{ $t('assetDetail.i_used_this_record_reuse') }}</el-button>
          <el-button v-if="asset.canEdit" @click="editVisible = true">{{ $t('common.edit') }}</el-button>
          <el-button v-if="can('asset.manage') && asset.status !== 'PUBLISHED'" type="success" plain :loading="publishing" @click="publish(false)">{{ $t('assetDetail.review_publish') }}</el-button>
          <el-dropdown v-if="can('asset.manage')" trigger="click" @command="onCommand">
            <el-button :icon="MoreFilled" />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="version">{{ $t('assetDetail.record_version_bump') }}</el-dropdown-item>
                <el-dropdown-item v-if="asset.status === 'PUBLISHED'" command="deprecate">{{ $t('assetDetail.mark_deprecated') }}</el-dropdown-item>
                <el-dropdown-item command="delete" divided><span style="color: var(--el-color-danger)">{{ $t('common.delete_2') }}</span></el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>

      <el-alert v-if="asset.authorization === 'RESTRICTED'" type="warning" :closable="false" show-icon class="auth-alert"
        :title="$t('assetDetail.from_customer_project_reference_ideas_design')" />

      <!-- 使用方式提示 -->
      <div class="howto">
        <div class="howto-item">
          <div class="howto-k">{{ $t('assetDetail.how_get_it') }}</div>
          <div class="howto-v">
            <template v-if="asset.assetRepoPath">{{ $t('assetDetail.asset_repository') }} <code>{{ asset.assetRepoPath }}/</code> {{ $t('assetDetail.copy_directory') }}</template>
            <template v-else-if="asset.maturity === 'L1'">{{ $t('assetDetail.read_write_up_below_key_files') }}</template>
            <template v-else>{{ $t('assetDetail.ask_owner_for_source_code') }}</template>
          </div>
        </div>
        <div class="howto-item">
          <div class="howto-k">{{ $t('assetDetail.available_ai') }}</div>
          <div class="howto-v"><code>get_asset(asset='{{ asset.slug }}')</code><template v-if="skillLink">{{ $t('assetDetail.integration_skill_package') }} <code>{{ skillLink.label.match(/((.+))/)?.[1] || skillLink.label }}</code><el-tag v-if="skillLink.extra?.status === 'DISABLED'" size="small" type="info" effect="plain" style="margin-left:4px">{{ $t('assetDetail.not_enabled') }}</el-tag></template></div>
        </div>
        <div v-if="asset.demoUrl" class="howto-item">
          <div class="howto-k">Demo</div>
          <div class="howto-v"><el-link :href="asset.demoUrl" target="_blank" type="primary">{{ asset.demoUrl }}</el-link></div>
        </div>
      </div>

      <el-tabs v-model="tab" class="tabs">
        <el-tab-pane :label="$t('common.write_up')" name="readme">
          <div v-if="asset.readme" class="markdown-body readme" v-html="renderSafeMarkdown(asset.readme)" />
          <el-empty v-else :description="$t('assetDetail.no_write_up_yet_l1_needs')" :image-size="60" />
        </el-tab-pane>
        <el-tab-pane name="data">
          <template #label>{{ $t('assetDetail.data') }}<span v-if="objectCount" class="tab-count">{{ objectCount }}</span></template>
          <OntologyView :ontology="asset.ontology" />
        </el-tab-pane>
        <el-tab-pane name="ui">
          <template #label>{{ $t('assetDetail.ui') }}<span v-if="asset.screenshots?.length" class="tab-count">{{ asset.screenshots.length }}</span></template>
          <div v-if="asset.screenshots?.length" class="shots">
            <figure v-for="s in asset.screenshots" :key="s.url" class="shot">
              <el-image :src="s.url" :preview-src-list="asset.screenshots.map(x => x.url)" fit="contain" />
              <figcaption v-if="s.caption">{{ s.caption }}</figcaption>
            </figure>
          </div>
          <el-empty v-else :description="asset.layer === 'ARCH' ? $t('assetDetail.architecture_capabilities_usually_have_no_ui') : $t('assetDetail.no_screenshots_yet')" :image-size="60" />
        </el-tab-pane>
        <el-tab-pane :label="$t('assetDetail.origin')" name="source">
          <el-descriptions :column="1" border size="small" class="source">
            <el-descriptions-item :label="$t('common.source_project')">
              <el-link v-if="asset.sourceProject" type="primary" @click="router.push(`/admin/projects/${asset.sourceProject.id}`)">
                {{ asset.sourceProject.name }} ({{ asset.sourceProject.code }})
              </el-link>
              <span v-else class="muted">—</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('common.source_repository')">{{ asset.sourceRepo || '—' }}</el-descriptions-item>
            <el-descriptions-item :label="$t('common.key_files')">
              <div v-if="asset.sourcePaths?.length" class="paths"><code v-for="p in asset.sourcePaths" :key="p">{{ p }}</code></div>
              <span v-else class="muted">—</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('common.asset_directory')">{{ $t('common.p0', { p0: asset.assetRepoPath ? $t('common.asset_repository', { p0: asset.assetRepoPath }) : $t('assetDetail.l2_above_only') }) }}</el-descriptions-item>
            <el-descriptions-item :label="$t('common.license')">{{ authText }}</el-descriptions-item>
            <el-descriptions-item :label="$t('common.register')">{{ asset.creatorName || '—' }} · {{ fmt(asset.createdAt) }}</el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>
        <el-tab-pane name="usages">
          <template #label>{{ $t('assetDetail.reuse_records') }}<span v-if="asset.usages?.length" class="tab-count">{{ asset.usages.length }}</span></template>
          <el-table v-if="asset.usages?.length" :data="asset.usages" size="small" border>
            <el-table-column :label="$t('common.project')" min-width="180">
              <template #default="{ row }">
                <el-link type="primary" @click="router.push(`/admin/projects/${row.project.id}`)">{{ row.project.name }}</el-link>
                <span v-if="row.taskId" class="muted"> {{ $t('assetDetail.task', { p0: row.taskId }) }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="$t('common.how')" width="90">
              <template #default="{ row }">{{ modeText[row.mode] }}</template>
            </el-table-column>
            <el-table-column :label="$t('common.saved_2')" width="80" align="right">
              <template #default="{ row }">{{ $t('common.p0', { p0: row.savedDays != null ? Number(row.savedDays) + $t('common.days') : '—' }) }}</template>
            </el-table-column>
            <el-table-column prop="feedback" :label="$t('common.feedback')" min-width="200" show-overflow-tooltip />
            <el-table-column :label="$t('common.register')" width="150">
              <template #default="{ row }">{{ row.creatorName }} · {{ fmt(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column width="60" align="center">
              <template #default="{ row }">
                <el-popconfirm :title="$t('assetDetail.withdraw_this_reuse_record')" @confirm="removeUsage(row)">
                  <template #reference><el-button link size="small" type="danger">{{ $t('common.withdraw') }}</el-button></template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else :description="$t('assetDetail.nobody_has_recorded_reuse_yet_if')" :image-size="60" />
        </el-tab-pane>
        <el-tab-pane name="links">
          <template #label>{{ $t('common.link') }}<span v-if="asset.links?.length" class="tab-count">{{ asset.links.length }}</span></template>
          <div class="links-head">
            <span class="muted">{{ $t('assetDetail.links_hint') }}</span>
            <el-button v-if="can('asset.manage')" size="small" :icon="Plus" @click="openLink">{{ $t('assetDetail.add_link') }}</el-button>
          </div>
          <div v-if="asset.links?.length" class="link-list">
            <div v-for="l in asset.links" :key="l.id" class="link-item">
              <el-tag size="small" :type="linkTagType[l.targetType]" effect="plain">{{ linkTypeText[l.targetType] }}</el-tag>
              <el-link v-if="l.href && !l.missing" :href="l.href.startsWith('/admin') ? undefined : l.href" type="primary"
                @click="l.href.startsWith('/admin') && router.push(l.href)">{{ l.label }}</el-link>
              <span v-else :class="{ muted: l.missing }">{{ l.label }}</span>
              <el-tag v-if="l.extra?.status === 'DISABLED'" size="small" type="info" effect="plain">{{ $t('assetDetail.not_enabled') }}</el-tag>
              <span v-if="l.note" class="muted">· {{ l.note }}</span>
              <span class="spacer" />
              <el-button v-if="can('asset.manage')" link size="small" type="danger" @click="removeLink(l)">{{ $t('common.remove') }}</el-button>
            </div>
          </div>
          <el-empty v-else :description="$t('assetDetail.no_links')" :image-size="50" />
        </el-tab-pane>
        <el-tab-pane v-if="asset.versions?.length" name="versions">
          <template #label>{{ $t('common.version_2') }}<span class="tab-count">{{ asset.versions.length }}</span></template>
          <el-timeline>
            <el-timeline-item v-for="v in asset.versions" :key="v.id" :timestamp="fmt(v.createdAt)" placement="top">
              <b>v{{ v.version }}</b> <code v-if="v.commitSha" class="muted">{{ v.commitSha }}</code>
              <div v-if="v.changelog" class="muted">{{ v.changelog }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-tab-pane>
      </el-tabs>
    </template>
    <el-empty v-else-if="!loading" :description="$t('assetDetail.asset_doesnt_exist_or_you_cant')" />

    <AssetEditDialog v-if="asset" v-model="editVisible" :asset="asset" :meta="meta" @saved="onEdited" />
    <RecordUsageDialog v-if="asset" v-model="usageVisible" :asset="asset" @saved="load" />

    <el-dialog v-model="linkDialog.visible" :title="$t('assetDetail.add_link')" width="480px" append-to-body>
      <el-form label-width="70px">
        <el-form-item :label="$t('common.type')">
          <el-select v-model="linkDialog.type" style="width: 100%" @change="searchTargets('')">
            <el-option v-for="k in NEW_LINK_TYPES" :key="k" :label="linkTypeText[k]" :value="k" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('assetDetail.object')">
          <el-select v-model="linkDialog.targetId" filterable remote :remote-method="searchTargets" style="width: 100%" :placeholder="$t('common.search')">
            <el-option v-for="o in linkDialog.options" :key="o.id" :label="o.label" :value="String(o.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.notes')">
          <el-input v-model="linkDialog.note" maxlength="200" :placeholder="$t('assetDetail.e_g_implementation_dependency')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="linkDialog.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveLink">{{ $t('common.add') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, MoreFilled, Plus } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'
import OntologyView from '@/components/admin/assets/OntologyView.vue'
import AssetEditDialog from '@/components/admin/assets/AssetEditDialog.vue'
import RecordUsageDialog from '@/components/admin/assets/RecordUsageDialog.vue'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const asset = ref(null)
const meta = ref({ layers: {}, maturities: {}, industries: [], techStacks: [] })
const tab = ref('readme')
const editVisible = ref(false)
const usageVisible = ref(false)
const publishing = ref(false)

const layerLabels = { FRAMEWORK: $t('common.project_framework'), ARCH: $t('common.architecture_capability'), BIZ: $t('common.business_capability') }
const maturityLabels = { L0: $t('assetDetail.lead'), L1: $t('assetDetail.reference'), L2: $t('assetDetail.copyable'), L3: $t('assetDetail.installable') }
const maturityHint = {
  L0: $t('common.lead_one_liner_origin_ask_owner'),
  L1: $t('common.reference_has_redacted_write_up_key'),
  L2: $t('common.copyable_code_extracted_into_asset_repository'),
  L3: $t('common.installable_standalone_package_service_install_u')
}
const modeText = { REFERENCE: $t('common.adapt'), COPY: $t('common.copy_directory'), INSTALL: $t('common.install') }
const linkTypeText = { SKILL_PACKAGE: $t('assetDetail.skill_package'), KNOWLEDGE: $t('assetDetail.knowledge_article'), ASSET: $t('common.assets') }
const linkTagType = { SKILL_PACKAGE: 'success', KNOWLEDGE: 'info', ASSET: 'primary' }
// 新建关联只能选这两类; 老数据里的 Skill 关联照常展示(Skill 已改到以虎 One 的 Skill 中心)
const NEW_LINK_TYPES = ['KNOWLEDGE', 'ASSET']

const authText = computed(() => ({ INTERNAL: $t('assetDetail.in_house_reusable_as'), CLIENT_CLEARED: $t('common.customer_approved_reuse'), RESTRICTED: $t('common.reference_only_customer_code') }[asset.value?.authorization]))
const authClass = computed(() => ({ INTERNAL: 'internal', CLIENT_CLEARED: 'cleared', RESTRICTED: 'restricted' }[asset.value?.authorization]))
const objectCount = computed(() => (asset.value?.ontology?.objects?.length || 0))
const skillLink = computed(() => asset.value?.links?.find(l => l.targetType === 'SKILL_PACKAGE' && !l.missing))

function fmt(d) { return d ? new Date(d).toLocaleDateString('zh-CN') : '' }

async function load() {
  loading.value = true
  try {
    asset.value = await fde.assets.detail(route.params.slug)
  } catch { asset.value = null } finally { loading.value = false }
}
async function loadMeta() { meta.value = await fde.assets.meta() }

async function publish(force) {
  publishing.value = true
  try {
    await fde.assets.publish(asset.value.id, force)
    ElMessage.success($t('assetDetail.published_visible_everyone'))
    await load()
  } catch (e) {
    // 客户名命中：让经理确认后强制发布（密钥命中不给强制）
    if (/客户名/.test(e.message || '')) {
      try {
        await ElMessageBox.confirm($t('assetDetail.force_publish_only_after_confirming_these', { p0: e.message }), $t('assetDetail.pre_publish_redaction_check'), { confirmButtonText: $t('assetDetail.confirm_public_force_publish'), cancelButtonText: $t('assetDetail.go_redact'), type: 'warning' })
        await publish(true)
      } catch { /* 取消 */ }
    } else ElMessage.error(e.message || $t('common.publish_failed'))
  } finally { publishing.value = false }
}

async function onCommand(cmd) {
  if (cmd === 'delete') {
    await ElMessageBox.confirm($t('assetDetail.delete_asset_its_reuse_records_will', { p0: asset.value.name }), $t('assetDetail.delete_asset'), { type: 'warning' })
    await fde.assets.remove(asset.value.id)
    ElMessage.success($t('common.deleted'))
    router.push('/admin/assets')
  } else if (cmd === 'deprecate') {
    await fde.assets.update(asset.value.id, { status: 'DEPRECATED' })
    ElMessage.success($t('assetDetail.marked_deprecated_no_longer_recommended'))
    load()
  } else if (cmd === 'version') {
    const { value } = await ElMessageBox.prompt($t('assetDetail.version_e_g_0_2_0'), $t('assetDetail.record_version_bump'), { inputPattern: /\S+/, inputErrorMessage: $t('common.required') })
    const { value: changelog } = await ElMessageBox.prompt($t('assetDetail.what_changed_optional'), `v${value}`, { inputType: 'textarea' }).catch(() => ({ value: '' }))
    await fde.assets.addVersion(asset.value.id, { version: value, changelog })
    ElMessage.success($t('assetDetail.recorded'))
    load()
  }
}

function onEdited(saved) {
  if (saved.slug !== route.params.slug) router.replace(`/admin/assets/${saved.slug}`)
  else load()
}

async function removeUsage(row) {
  try {
    await fde.assets.removeUsage(asset.value.id, row.id)
    ElMessage.success($t('common.withdrawn'))
    load()
  } catch (e) { ElMessage.error(e.message || $t('assetDetail.withdraw_failed')) }
}

const linkDialog = reactive({ visible: false, type: 'KNOWLEDGE', targetId: '', note: '', options: [] })
function openLink() {
  Object.assign(linkDialog, { visible: true, type: 'KNOWLEDGE', targetId: '', note: '', options: [] })
  searchTargets('')
}
async function searchTargets(kw) {
  const data = await fde.assets.linkTargets({ type: linkDialog.type, keyword: kw || '' })
  linkDialog.options = data?.list || []
}
async function saveLink() {
  if (!linkDialog.targetId) return ElMessage.warning($t('assetDetail.choose_what_link'))
  try {
    await fde.assets.addLink(asset.value.id, { targetType: linkDialog.type, targetId: linkDialog.targetId, note: linkDialog.note })
    linkDialog.visible = false
    ElMessage.success($t('common.linked'))
    load()
  } catch (e) { ElMessage.error(e.message || $t('common.link_failed')) }
}
async function removeLink(l) {
  await fde.assets.removeLink(asset.value.id, l.id)
  ElMessage.success($t('common.removed'))
  load()
}

watch(() => route.params.slug, (s) => { if (s) { tab.value = 'readme'; load() } }, { immediate: true })
loadMeta()
</script>

<style scoped>
.asset-detail { padding-bottom: 24px; }
.back { margin: -4px 0 8px -8px; }
.hero { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; }
.hero-main { flex: 1; min-width: 320px; }
.hero-tags { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.hero h1 { margin: 8px 0 6px; font-size: 24px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.slug { font-size: 13px; font-weight: 400; color: var(--el-text-color-secondary); }
.summary { margin: 0 0 10px; color: var(--el-text-color-regular); font-size: 14px; line-height: 1.6; max-width: 820px; }
.hero-meta { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--el-text-color-secondary); }
.hero-meta b { color: var(--el-text-color-primary); }
.hero-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.layer-tag { font-size: 12px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
.layer-framework { background: #eef2ff; color: #4338ca; }
.layer-arch { background: #ecfeff; color: #0e7490; }
.layer-biz { background: #fff7ed; color: #c2410c; }
.maturity { font-size: 12px; padding: 1px 8px; border-radius: 4px; border: 1px solid var(--el-border-color); cursor: help; }
.m-L2, .m-L3 { border-color: #16a34a; color: #15803d; background: #f0fdf4; }
.auth { font-size: 12px; padding: 2px 8px; border-radius: 4px; }
.auth.restricted { color: #9a3412; background: #fff7ed; }
.auth.internal { color: #15803d; background: #f0fdf4; }
.auth.cleared { color: #1d4ed8; background: #eff6ff; }
.ver { font-size: 12px; color: var(--el-text-color-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.chip { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--el-fill-color-light); }
.chip.tech { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.auth-alert { margin-top: 14px; }
.howto { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin: 14px 0 4px; }
.howto-item { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; background: var(--el-fill-color-blank); }
.howto-k { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 2px; }
.howto-v { font-size: 13px; word-break: break-all; }
.howto-v code, .paths code { font-size: 12px; background: var(--el-fill-color-light); padding: 1px 5px; border-radius: 4px; }
.tabs { margin-top: 10px; }
.tab-count { margin-left: 4px; font-size: 11px; color: var(--el-text-color-secondary); }
.readme { max-width: 920px; font-size: 14px; line-height: 1.75; }
.readme :deep(h2) { font-size: 17px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--el-border-color-lighter); }
.readme :deep(h1) { font-size: 20px; }
.readme :deep(table) { border-collapse: collapse; font-size: 13px; }
.readme :deep(th), .readme :deep(td) { border: 1px solid var(--el-border-color-lighter); padding: 5px 10px; }
.readme :deep(th) { background: var(--el-fill-color-light); }
.readme :deep(.md-table-wrap) { overflow-x: auto; margin: 8px 0; }
.readme :deep(pre) { background: #1f2430; color: #e6e6e6; padding: 12px 14px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; }
.readme :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.readme :deep(:not(pre) > code) { background: var(--el-fill-color-light); padding: 1px 5px; border-radius: 4px; }
.readme :deep(blockquote) { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--el-color-primary-light-5); color: var(--el-text-color-secondary); }
.readme :deep(img) { max-width: 100%; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 12px; }
.shot { margin: 0; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; overflow: hidden; background: var(--el-fill-color-lighter); }
.shot figcaption { font-size: 12px; color: var(--el-text-color-secondary); padding: 6px 10px; }
.source { max-width: 900px; }
.paths { display: flex; flex-direction: column; gap: 3px; }
.muted { color: var(--el-text-color-secondary); }
.links-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 12px; }
.link-list { display: flex; flex-direction: column; gap: 6px; }
.link-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; }
.spacer { flex: 1; }
</style>
