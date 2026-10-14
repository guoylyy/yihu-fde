<template>
  <div class="admin-login">
    <div class="login-card">
      <LangSwitch class="login-lang" />
      <div class="brand">
        <div class="logo">
          <BrandMark :size="34" />
          <span class="logo-name">{{ brand.name }}</span>
          <span class="logo-badge">{{ $t('common.console') }}</span>
        </div>
        <div class="subtitle">{{ brand.tagline || $t('common.default_tagline') }}</div>
        <div v-if="appVersion" class="version">v{{ appVersion }}</div>
      </div>
      <!-- 只用以虎 One 账号登录 -->
      <el-button v-if="providers.platform" type="primary" size="large" class="sso-btn" :loading="ssoBusy || loading" @click="startSso">
        {{ $t('login.sign_in_with', { p0: providers.platform.name }) }}
      </el-button>
      <div v-else-if="loaded && !providers.devLogin" class="hint">{{ $t('login.not_connected') }}</div>
      <div v-if="ssoError" class="error">{{ ssoError }}</div>

      <!-- 开发登录: 只在本地开发 / 测试时出现(后端 DEV_LOGIN=true) -->
      <el-form v-if="providers.devLogin" class="dev-login" @submit.prevent="onDevLogin" label-position="top">
        <div class="divider"><span>{{ $t('login.dev_login') }}</span></div>
        <el-form-item>
          <el-input v-model="devUser" :placeholder="$t('login.dev_login_placeholder')" size="large" @keyup.enter="onDevLogin" />
        </el-form-item>
        <el-button size="large" :loading="loading" style="width: 100%;" @click="onDevLogin">{{ $t('common.sign_in') }}</el-button>
        <div v-if="error" class="error">{{ error }}</div>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { withBase } from '@/utils/base.js'
import { $t } from '@/i18n'
// v2.7.0 多实例: 登录页品牌跟随实例配置(未登录也要正确, 所以走免登录的 /api/public/edition)
import { getBrand, getVersion } from '@/api/edition.js'
const brand = getBrand()
const appVersion = getVersion()
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BrandMark from '@/components/common/BrandMark.vue'
import LangSwitch from '@/components/common/LangSwitch.vue'
import { refreshMyPermissions } from '@/api/permissions.js'

const router = useRouter()
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const ssoError = ref('')
const ssoBusy = ref(false)
const devUser = ref(localStorage.getItem('fde_last_username') || 'admin')
const providers = ref({ platform: null, devLogin: false })

function afterLoginTarget() {
  const q = router.currentRoute.value.query
  const target = q.next || q.redirect
  return target && target !== 'protected' && String(target).startsWith('/') && !String(target).startsWith('//') ? String(target) : '/admin/workbench'
}

function startSso() {
  ssoBusy.value = true
  location.href = withBase('/api/auth/oidc/login') + '?next=' + encodeURIComponent(afterLoginTarget())
}

/** 保存登录结果并进入系统 */
async function completeLogin(data) {
  localStorage.setItem('fde_internal_token', data.token)
  localStorage.setItem('fde_internal_user', JSON.stringify(data.user))
  // 拉取当前角色生效权限 (后台可配置); 失败自动回退前端静态矩阵
  await refreshMyPermissions()
  router.push(afterLoginTarget())
}

/** 以虎 One 回跳: 用一次性 ticket 换 token; 返回 true 表示已处理 */
async function handleSsoReturn() {
  const q = router.currentRoute.value.query
  if (q.sso_error) { ssoError.value = String(q.sso_error); return true }
  if (!q.ticket) return false
  const ticket = String(q.ticket)
  // ticket 只能用一次: 先从地址栏拿掉, 页面重载时不会拿旧 ticket 再换一次(而是用已存的 token 进入)
  await router.replace({ path: '/admin/login', query: q.next ? { next: q.next } : {} })
  loading.value = true
  try {
    const res = await fetch('/api/auth/oidc/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket })
    })
    const data = await res.json()
    if (data.code !== 0) { ssoError.value = data.message || $t('login.sign_in_failed'); return true }
    await completeLogin(data.data)
  } catch (e) {
    ssoError.value = $t('common.network_error') + e.message
  } finally {
    loading.value = false
  }
  return true
}

async function loadProviders() {
  try {
    const data = await (await fetch('/api/auth/providers')).json()
    if (data.code === 0) providers.value = data.data
  } catch { /* 留在登录页 */ }
  loaded.value = true
}

onMounted(async () => {
  if (await handleSsoReturn()) { loadProviders(); return }
  // 本地 token 还有效: 直接进系统
  const token = localStorage.getItem('fde_internal_token')
  if (token && !router.currentRoute.value.query.signed_out) {
    try {
      const res = await fetch('/api/fde/me', { headers: { Authorization: 'Bearer ' + token } })
      if ((await res.json()).code === 0) {
        await refreshMyPermissions()
        router.push(afterLoginTarget())
        return
      }
    } catch { /* 网络异常, 留在登录页 */ }
    localStorage.removeItem('fde_internal_token')
  }
  await loadProviders()
  // 接了以虎 One 且没开开发登录: 直接去平台(已在平台登录则一闪而过); 刚手动退出的不自动跳
  if (providers.value.platform && !providers.value.devLogin && !router.currentRoute.value.query.signed_out) startSso()
})

async function onDevLogin() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: devUser.value.trim() })
    })
    const data = await res.json()
    if (data.code !== 0) { error.value = data.message || $t('login.sign_in_failed'); return }
    localStorage.setItem('fde_last_username', devUser.value.trim())
    await completeLogin(data.data)
  } catch (e) {
    error.value = $t('common.network_error') + e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
/* VI v1.0: 米白底 + 白卡细描边 */
.admin-login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #faf9f7;
}
.login-card {
  background: #fff;
  border: 1px solid #eae7e2;
  border-radius: 12px;
  padding: 40px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 2px 12px rgba(28, 25, 23, 0.05);
}
.brand {
  text-align: center;
  margin-bottom: 32px;
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.logo-name {
  font-size: 20px;
  font-weight: 700;
  color: #1c1917;
  letter-spacing: 0.04em;
}
.logo-badge {
  font-family: 'Manrope', sans-serif;
  font-size: 10px;
  font-weight: 600;
  color: #8f8a82;
  letter-spacing: 0.1em;
  border: 1px solid #ddd9d2;
  border-radius: 4px;
  padding: 2px 7px;
}
.subtitle {
  font-size: 14px;
  color: #8f8a82;
  margin-top: 10px;
}
.error {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(194, 54, 43, 0.08);
  color: #c2362b;
  border-radius: 6px;
  font-size: 13px;
}
.hint {
  margin-top: 20px;
  padding: 12px;
  background: #faf9f7;
  border-radius: 6px;
  font-size: 12px;
  color: #5c574f;
  text-align: center;
}
.hint code {
  background: white;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.login-card { position: relative; }
.login-lang { position: absolute; top: 16px; right: 18px; }
.sso-btn { width: 100%; margin-bottom: 4px; }
.divider { display: flex; align-items: center; gap: 10px; margin: 18px 0 6px; color: var(--el-text-color-secondary); font-size: 12px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--el-border-color-lighter); }
.version { margin-top: 6px; font-size: 12px; color: var(--el-text-color-placeholder); }
</style>
