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
      <el-form :model="form" @submit.prevent="onLogin" label-position="top">
        <el-form-item :label="$t('common.username')">
          <el-input v-model="form.username" :placeholder="$t('common.enter_your_username')" size="large" />
        </el-form-item>
        <el-form-item :label="$t('common.password')">
          <el-input v-model="form.password" type="password" :placeholder="$t('login.enter_your_password')" size="large" show-password @keyup.enter="onLogin" />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="remember">{{ $t('login.stay_signed_in_30_days') }}</el-checkbox>
        </el-form-item>
        <el-button type="primary" size="large" :loading="loading" @click="onLogin" style="width: 100%;">
          {{ $t('common.p0', { p0: autoLogging ? $t('login.signing_in_automatically') : $t('common.sign_in') }) }}
        </el-button>
        <div v-if="error" class="error">{{ error }}</div>
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

// 1.2.7: 自动登录 —— 勾选过"下次自动登录"且本地 token 仍有效, 进登录页直接放行
// (路由守卫的历史 bug 读错 key 不会自动跳转, 这里在页面级兜底; 守卫修复在 v1.3.0)
onMounted(async () => {
  const token = localStorage.getItem('fde_internal_token')
  if (!token || localStorage.getItem('fde_remember') !== '1') return
  autoLogging.value = true
  loading.value = true
  try {
    const res = await fetch('/api/fde/me', { headers: { Authorization: 'Bearer ' + token } })
    const data = await res.json()
    if (data.code === 0) {
      await refreshMyPermissions()
      const target = router.currentRoute.value.query.redirect
      // v2.6.0(#959) 主人拍板: 登录默认落个人工作台
      router.push(target && target !== 'protected' ? String(target) : '/admin/workbench')
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
    localStorage.setItem('fde_internal_token', data.data.token)
    localStorage.setItem('fde_internal_user', JSON.stringify(data.data.user))
    localStorage.setItem('fde_last_username', form.value.username)
    localStorage.setItem('fde_remember', remember.value ? '1' : '0')
    // 拉取当前角色生效权限 (后台可配置); 失败自动回退前端静态矩阵
    await refreshMyPermissions()
    // 2026-07-05: 默认密码登录后强制跳修改密码页
    if (data.data.user?.mustChangePassword) {
      const target = router.currentRoute.value.query.redirect
      const redirect = target && target !== 'protected' ? target : '/admin/workbench'
      router.push({ path: '/admin/change-password', query: { forced: '1', redirect } })
    } else {
      router.push('/admin/workbench')
    }
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
</style>
