<template>
  <div class="settings-page" v-loading="loading">
    <div class="page-header">
      <h2 class="page-title">{{ $t('systemSettings.title') }}</h2>
      <p class="hint">{{ $t('systemSettings.subtitle') }}</p>
    </div>

    <el-tabs v-model="tab" class="settings-tabs" @tab-change="onTabChange">
      <!-- 品牌外观 -->
      <el-tab-pane :label="$t('systemSettings.tab_brand')" name="brand">
        <el-card shadow="never" class="block-card">
          <el-form label-width="120px" class="settings-form" @submit.prevent>
            <el-form-item :label="$t('systemSettings.brand_name')">
              <el-input v-model="form['brand.name']" maxlength="50" show-word-limit :placeholder="placeholder('brand.name')" />
              <SourceNote :item="item('brand.name')" />
            </el-form-item>
            <el-form-item :label="$t('systemSettings.tagline')">
              <el-input v-model="form['brand.tagline']" maxlength="100" show-word-limit :placeholder="placeholder('brand.tagline')" />
              <SourceNote :item="item('brand.tagline')" />
            </el-form-item>
            <el-form-item :label="$t('systemSettings.logo')">
              <div class="logo-row">
                <div class="logo-preview">
                  <img v-if="previewLogo" :src="previewLogo" alt="" />
                  <BrandMark v-else :size="40" />
                </div>
                <div class="logo-actions">
                  <el-upload :show-file-list="false" accept=".png,.jpg,.jpeg,.gif,.webp" :http-request="uploadLogo">
                    <el-button :loading="uploading"><el-icon><Upload /></el-icon>{{ $t('systemSettings.upload_logo') }}</el-button>
                  </el-upload>
                  <el-button v-if="form['brand.logoUrl']" link type="danger" @click="form['brand.logoUrl'] = ''">{{ $t('systemSettings.use_builtin_logo') }}</el-button>
                </div>
              </div>
              <el-input v-model="form['brand.logoUrl']" :placeholder="$t('systemSettings.logo_url_placeholder')" style="margin-top: 8px;" />
              <SourceNote :item="item('brand.logoUrl')" :hint="$t('systemSettings.logo_hint')" />
            </el-form-item>
            <el-form-item :label="$t('systemSettings.primary_color')">
              <div class="color-row">
                <el-color-picker v-model="form['brand.primaryColor']" :predefine="PRESET_COLORS" />
                <el-input v-model="form['brand.primaryColor']" :placeholder="placeholder('brand.primaryColor')" style="width: 140px;" />
                <span class="swatch-preview" :style="{ background: previewColor }">{{ previewName }}</span>
              </div>
              <SourceNote :item="item('brand.primaryColor')" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save('brand')">{{ $t('common.save') }}</el-button>
              <span class="field-hint">{{ $t('systemSettings.brand_save_hint') }}</span>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 访问地址 -->
      <el-tab-pane :label="$t('systemSettings.tab_urls')" name="url">
        <el-card shadow="never" class="block-card">
          <el-form label-width="120px" class="settings-form" @submit.prevent>
            <el-form-item :label="$t('systemSettings.public_url')">
              <el-input v-model="form['url.publicBase']" :placeholder="placeholder('url.publicBase')" />
              <SourceNote :item="item('url.publicBase')" :hint="$t('systemSettings.public_url_hint')" />
            </el-form-item>
            <el-form-item :label="$t('systemSettings.mcp_url')">
              <el-input v-model="form['url.mcp']" :placeholder="placeholder('url.mcp')" />
              <SourceNote :item="item('url.mcp')" :hint="$t('systemSettings.mcp_url_hint')" />
            </el-form-item>
            <el-form-item :label="$t('systemSettings.in_use')">
              <div class="effective">
                <div><span class="dim">{{ $t('systemSettings.public_url') }}</span><code>{{ data?.effective.publicBaseUrl || '—' }}</code></div>
                <div><span class="dim">{{ $t('systemSettings.mcp_url') }}</span><code>{{ data?.effective.mcpUrl }}</code></div>
              </div>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save('url')">{{ $t('common.save') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 大模型 -->
      <el-tab-pane :label="$t('common.llm_settings')" name="llm" lazy>
        <LlmConfigs embedded />
      </el-tab-pane>

      <!-- 登录方式(只读, 由部署配置决定) -->
      <el-tab-pane :label="$t('systemSettings.tab_login')" name="login">
        <el-card shadow="never" class="block-card">
          <el-descriptions :column="1" border v-if="data">
            <el-descriptions-item :label="$t('systemSettings.password_login')">
              <el-tag :type="data.login.password ? 'success' : 'info'" size="small">{{ data.login.password ? $t('common.enabled_2') : $t('common.disabled_2') }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('systemSettings.sso')">
              <template v-if="data.login.oidc">
                <el-tag type="success" size="small">{{ data.login.oidc.name }}</el-tag>
                <code class="mono">{{ data.login.oidc.issuer }}</code>
              </template>
              <el-tag v-else type="info" size="small">{{ $t('common.not_configured') }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item v-if="data.login.oidc" :label="$t('systemSettings.new_accounts')">
              {{ data.login.oidc.autoCreate ? $t('systemSettings.auto_create', { p0: roleLabel(data.login.oidc.defaultRole) }) : $t('systemSettings.admin_creates') }}
            </el-descriptions-item>
          </el-descriptions>
          <p class="hint" style="margin-top: 12px;">
            {{ data?.login.onYihuOne ? $t('systemSettings.login_hint_hosted') : $t('systemSettings.login_hint') }}
          </p>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { refreshEdition, DEFAULT_BRAND } from '@/api/edition.js'
import { roleLabel } from '@/api/roles.js'
import BrandMark from '@/components/common/BrandMark.vue'
import LlmConfigs from './LlmConfigs.vue'

const PRESET_COLORS = ['#f54e00', '#1f5d8c', '#0f766e', '#7c3aed', '#be123c', '#1c1917']
const TABS = ['brand', 'url', 'llm', 'login']

const route = useRoute()
const router = useRouter()
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'brand')
const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const data = ref(null)
const form = reactive({})

const item = (key) => data.value?.settings.find(s => s.key === key)

/** 输入框留空时提示会用哪个值 */
function placeholder(key) {
  const s = item(key)
  if (s?.envValue) return $t('systemSettings.empty_uses_env', { p0: s.envValue })
  const dflt = { 'brand.name': DEFAULT_BRAND.name, 'brand.primaryColor': DEFAULT_BRAND.primaryColor }[key]
  if (dflt) return $t('systemSettings.empty_uses_default', { p0: dflt })
  if (key === 'url.publicBase') return $t('systemSettings.empty_derived_from_request')
  if (key === 'url.mcp') return $t('systemSettings.empty_mcp_default')
  return $t('systemSettings.optional')
}

// 每项下面的小字: 当前值来自哪里
const SourceNote = (props) => {
  const s = props.item
  if (!s) return null
  const text = s.source === 'env'
    ? $t('systemSettings.source_env', { p0: s.env })
    : s.source === 'settings' ? $t('systemSettings.source_settings', { p0: s.env }) : ''
  return h('div', { class: 'source-note' }, [props.hint, text].filter(Boolean).join(' '))
}
SourceNote.props = ['item', 'hint']

const previewLogo = computed(() => form['brand.logoUrl'] || item('brand.logoUrl')?.envValue || '')
const previewColor = computed(() => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(form['brand.primaryColor'] || '')
  ? form['brand.primaryColor']
  : (item('brand.primaryColor')?.envValue || DEFAULT_BRAND.primaryColor))
const previewName = computed(() => form['brand.name'] || item('brand.name')?.envValue || DEFAULT_BRAND.name)

function fill(d) {
  data.value = d
  for (const s of d.settings) form[s.key] = s.value || ''
}

async function load() {
  loading.value = true
  try { fill(await fde.systemSettings.get()) } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

async function save(group) {
  const values = {}
  for (const s of data.value.settings.filter(x => x.group === group)) values[s.key] = form[s.key] || null
  saving.value = true
  try {
    fill(await fde.systemSettings.update(values))
    ElMessage.success($t('common.saved'))
    if (group === 'brand') {
      // 品牌在登录页、顶栏、标题里都用到: 刷新缓存后重载页面
      await refreshEdition()
      setTimeout(() => location.reload(), 600)
    }
  } catch (e) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

async function uploadLogo({ file }) {
  if (file.size > 2 * 1024 * 1024) { ElMessage.error($t('systemSettings.logo_too_large')); return }
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fde.uploads.upload(fd)
    if (r.code !== 0) throw new Error(r.message)
    form['brand.logoUrl'] = r.data.url
  } catch (e) { ElMessage.error(e.message) }
  finally { uploading.value = false }
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
.settings-form { max-width: 720px; }
.source-note { width: 100%; font-size: 12px; color: #a8a29e; line-height: 1.5; margin-top: 4px; }
.field-hint { font-size: 12px; color: #a8a29e; margin-left: 10px; }
.logo-row { display: flex; align-items: center; gap: 16px; }
.logo-preview { width: 64px; height: 64px; border: 1px dashed var(--el-border-color); border-radius: 10px; display: flex; align-items: center; justify-content: center; background: #faf9f7; }
.logo-preview img { max-width: 52px; max-height: 52px; object-fit: contain; }
.logo-actions { display: flex; align-items: center; gap: 8px; }
.color-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.swatch-preview { color: #fff; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; }
.effective { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.effective .dim { color: #868580; margin-right: 8px; }
.effective code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f5f5f4; padding: 1px 6px; border-radius: 4px; color: #44403c; margin-left: 6px; }
</style>
