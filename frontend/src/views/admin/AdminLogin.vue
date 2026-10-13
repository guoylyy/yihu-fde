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
      </div>
      <!-- 统一登录(以虎 One 等 OIDC 身份提供方) -->
      <template v-if="providers.oidc">
        <el-button type="primary" size="large" class="sso-btn" :loading="ssoBusy" @click="startSso">
          {{ $t('login.sign_in_with', { p0: providers.oidc.name }) }}
        </el-button>
        <div v-if="providers.password" class="divider"><span>{{ $t('login.or_use_password') }}</span></div>
      </template>
      <div v-if="ssoError && !providers.password" class="error">{{ ssoError }}</div>
      <el-form v-if="providers.password" :model="form" @submit.prevent="onLogin" label-position="top">
        <el-form-item :label="$t('common.username')">
          <el-input v-model="form.username" :placeholder="$t('common.enter_your_username')" size="large" />
        </el-form-item>
        <el-form-item :label="$t('common.password')">
          <el-input v-model="form.password" type="password" :placeholder="$t('login.enter_your_password')" size="large" show-password @keyup.enter="onLogin" />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="remember">{{ $t('login.stay_signed_in_30_days') }}</el-checkbox>
        </el-form-item>
        <el-button :type="providers.oidc ? 'default' : 'primary'" size="large" :loading="loading" @click="onLogin" style="width: 100%;">
          {{ $t('common.p0', { p0: autoLogging ? $t('login.signing_in_automatically') : $t('common.sign_in') }) }}
        </el-button>
        <div v-if="error || ssoError" class="error">{{ error || ssoError }}</div>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
// v2.7.0 多实例: 登录页品牌跟随实例配置(未登录也要正确, 所以走免登录的 /api/public/edition)
import { getBrand } from '@/api/edition.js'
const brand = getBrand()
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BrandMark from '@/components/common/BrandMark.vue'
import LangSwitch from '@/components/common/LangSwitch.vue'
import { refreshMyPermissions } from '@/api/permissions.js'

const router = useRouter()
// 1.2.7: 记住用户名 + 自动登录选项 (勾选后后端发 30 天长效 token)
const form = ref({ username: localStorage.getItem('fde_last_username') || '', password: '' })
const remember = ref(localStorage.getItem('fde_remember') !== '0')
const loading = ref(false)
const autoLogging = ref(false)
const error = ref('')
const ssoError = ref('')
const ssoBusy = ref(false)
// 登录方式: 默认按「只有密码」渲染, 接口回来再更新(接口失败也不至于没法登录)
const providers = ref({ password: true, oidc: null })

function afterLoginTarget() {
  const q = router.currentRoute.value.query
  const target = q.next || q.redirect
  return target && target !== 'protected' && String(target).startsWith('/') && !String(target).startsWith('//') ? String(target) : '/admin/workbench'
}

function startSso() {
  ssoBusy.value = true
  location.href = '/api/auth/oidc/login?next=' + encodeURIComponent(afterLoginTarget())
}

/** 保存登录结果并进入系统(密码登录与统一登录共用) */
async function completeLogin(data) {
  localStorage.setItem('fde_internal_token', data.token)
  localStorage.setItem('fde_internal_user', JSON.stringify(data.user))
  // 拉取当前角色生效权限 (后台可配置); 失败自动回退前端静态矩阵
  await refreshMyPermissions()
  if (data.user?.mustChangePassword) {
    router.push({ path: '/admin/change-password', query: { forced: '1', redirect: afterLoginTarget() } })
  } else {
    router.push(afterLoginTarget())
  }
}

/** 统一登录回跳: 用一次性 ticket 换 token; 返回 true 表示已处理 */
async function handleSsoReturn() {
  const q = router.currentRoute.value.query
  if (q.sso_error) { ssoError.value = String(q.sso_error); return true }
  if (!q.ticket) return false
  loading.value = true
  try {
    const res = await fetch('/api/auth/oidc/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: q.ticket })
    })
    const data = await res.json()
    if (data.code !== 0) { ssoError.value = data.message || $t('login.sign_in_failed'); return true }
    localStorage.setItem('fde_remember', '0')
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
  } catch { /* 保持默认: 只有密码登录 */ }
}

// 1.2.7: 自动登录 —— 勾选过"下次自动登录"且本地 token 仍有效, 进登录页直接放行
// (路由守卫的历史 bug 读错 key 不会自动跳转, 这里在页面级兜底; 守卫修复在 v1.3.0)
onMounted(async () => {
  if (await handleSsoReturn()) { loadProviders(); return }
  await loadProviders()
  const token = localStorage.getItem('fde_internal_token')
  if (!token || localStorage.getItem('fde_remember') !== '1') {
    // 只允许统一登录时直接跳过去(用户已在身份提供方登录则一闪而过); 刚手动退出的不自动跳
    if (!providers.value.password && providers.value.oidc && !router.currentRoute.value.query.signed_out) startSso()
    return
  }
  autoLogging.value = true
  loading.value = true
  try {
    const res = await fetch('/api/fde/me', { headers: { Authorization: 'Bearer ' + token } })
    const data = await res.json()
    if (data.code === 0) {
      await refreshMyPermissions()
      router.push(afterLoginTarget())
      return
    }
    // token 失效: 清掉, 留在登录页手动登录
    localStorage.removeItem('fde_internal_token')
  } catch { /* 网络异常, 留在登录页 */ }
  finally { autoLogging.value = false; loading.value = false }
})

async function onLogin() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form.value, remember: remember.value })
    })
    const data = await res.json()
    if (data.code !== 0) {
      error.value = data.message || $t('login.sign_in_failed')
      return
    }
    localStorage.setItem('fde_last_username', form.value.username)
    localStorage.setItem('fde_remember', remember.value ? '1' : '0')
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
</style>
