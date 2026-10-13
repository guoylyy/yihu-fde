<template>
  <div class="change-password-page">
    <div class="card">
      <div class="header">
        
        <h2>{{ $t('changePassword.change_password') }}</h2>
        <p v-if="isForced" class="subtitle">
          {{ $t('changePassword.youre_using_default_password') }} <code>123456</code>{{ $t('changePassword.for_your_accounts_safety_please_set') }}
        </p>
        <p v-else class="subtitle">{{ $t('changePassword.changing_your_password_regularly_keeps_your') }}</p>
      </div>

      <el-alert v-if="isForced" type="warning" :closable="false" style="margin-bottom: 20px;">
        <template #title>
          {{ $t('changePassword.youre_using_default_password_must_change') }}
        </template>
      </el-alert>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" @submit.prevent="onSubmit">
        <el-form-item v-if="!isForced" :label="$t('changePassword.current_password')" prop="oldPassword">
          <el-input v-model="form.oldPassword" type="password" show-password :placeholder="$t('changePassword.current_password_2')" />
        </el-form-item>

        <el-form-item :label="$t('changePassword.new_password')" prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password :placeholder="$t('changePassword.at_least_6_characters_not_123456')" />
        </el-form-item>

        <el-form-item :label="$t('common.confirm_password')" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password :placeholder="$t('changePassword.enter_new_password_again')" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSubmit" style="width: 100%;">
            {{ $t('common.p0', { p0: isForced ? $t('changePassword.set_new_password_continue') : $t('changePassword.change_password') }) }}
          </el-button>
        </el-form-item>

        <el-button v-if="!isForced" link type="primary" @click="goBack" style="width: 100%; margin-top: 8px;">
          {{ $t('common.back') }}
        </el-button>
      </el-form>

      <div v-if="error" class="error">{{ error }}</div>

      <div class="hint">
        <p>{{ $t('changePassword.password_requirements') }}</p>
        <ul>
          <li>{{ $t('changePassword.at_least_6_characters') }}</li>
          <li>{{ $t('changePassword.you_cant_use_default_password_123456') }}</li>
          <li>{{ $t('changePassword.letters_numbers_recommended') }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'

const router = useRouter()
const route = useRoute()

const isForced = ref(route.query.forced === '1')

function readUser() {
  try { return JSON.parse(localStorage.getItem('fde_internal_user') || '{}') } catch { return {} }
}

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const rules = {
  newPassword: [
    { required: true, message: $t('changePassword.new_password_required'), trigger: 'blur' },
    { min: 6, message: $t('changePassword.new_password_must_be_at_least'), trigger: 'blur' },
    {
      validator: (_, value, cb) => {
        if (value === '123456') return cb(new Error($t('changePassword.you_cant_use_default_password_123456')))
        cb()
      },
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: $t('changePassword.enter_new_password_again_2'), trigger: 'blur' },
    {
      validator: (_, value, cb) => {
        if (value !== form.newPassword) return cb(new Error($t('changePassword.new_passwords_dont_match')))
        cb()
      },
      trigger: 'blur'
    }
  ],
  oldPassword: [
    { required: true, message: $t('changePassword.enter_your_current_password'), trigger: 'blur' }
  ]
}

const loading = ref(false)
const error = ref('')
const formRef = ref(null)

onMounted(() => {
  // 如果不是 forced 但没登录，跳到 login
  if (!localStorage.getItem('fde_internal_token')) {
    router.push('/admin/login')
  }
})

async function onSubmit() {
  error.value = ''
  try { await formRef.value.validate() } catch { return }
  loading.value = true
  try {
    const u = readUser()
    const body = isForced.value
      ? { oldPassword: '123456', newPassword: form.newPassword }  // 强制改密码时，oldPassword 一定是 123456
      : { oldPassword: form.oldPassword, newPassword: form.newPassword }

    const token = localStorage.getItem('fde_internal_token')
    const res = await fetch('/api/fde/users/me/change-password', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body)
    })
    const data = await res.json()
    if (data.code !== 0) {
      error.value = data.message || $t('changePassword.change_failed')
      return
    }

    // 更新本地 user 信息，清 mustChangePassword
    u.mustChangePassword = false
    localStorage.setItem('fde_internal_user', JSON.stringify(u))

    ElMessage.success($t('changePassword.password_changed'))

    // 跳回原来要去的地方
    const target = route.query.redirect && route.query.redirect !== 'protected' ? route.query.redirect : '/admin/my'
    setTimeout(() => router.push(target), 500)
  } catch (e) {
    error.value = $t('common.network_error') + e.message
  } finally {
    loading.value = false
  }
}

function goBack() {
  // 主动改密码，不是 forced：返回 dashboard
  router.back()
}
</script>

<style scoped>
.change-password-page {
  min-height: 100vh;
  background: #faf9f7;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  padding: 32px;
  width: 100%;
  max-width: 480px;
}

.header {
  text-align: center;
  margin-bottom: 24px;
}

.icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.header h2 {
  margin: 0 0 8px;
  font-size: 22px;
  color: #1c1917;
}

.subtitle {
  margin: 0;
  color: #606266;
  font-size: 14px;
  line-height: 1.5;
}

.subtitle code {
  background: #f0f1f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Monaco', 'Menlo', monospace;
  color: #c2362b;
  font-weight: 600;
}

.error {
  color: #c2362b;
  text-align: center;
  margin-top: 12px;
  font-size: 13px;
}

.hint {
  margin-top: 24px;
  padding: 12px 16px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
}

.hint p {
  margin: 0 0 8px;
  font-weight: 500;
}

.hint ul {
  margin: 0;
  padding-left: 20px;
}

.hint li {
  margin: 4px 0;
}
</style>