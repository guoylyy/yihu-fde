<template>
  <!-- v1.2.8 个人中心: 头像/手机/邮箱/自我介绍自助维护 + 改密码入口 -->
  <div class="profile-page" v-loading="loading">
    <el-row :gutter="16">
      <el-col :span="9">
        <el-card shadow="never" class="block-card">
          <div class="p-head">
            <div class="avatar-wrap">
              <img v-if="form.avatarUrl" :src="form.avatarUrl" class="p-avatar" />
              <div v-else class="p-avatar p-avatar-fallback">{{ (profile?.name || '?').slice(0, 1) }}</div>
              <el-upload :show-file-list="false" :auto-upload="false" accept="image/*" @change="onAvatarPick">
                <el-button size="small" style="margin-top: 10px;" :loading="avatarUploading">{{ $t('common.p0', { p0: form.avatarUrl ? $t('profile.change_avatar') : $t('profile.upload_avatar') }) }}</el-button>
              </el-upload>
            </div>
            <div class="p-info">
              <h2>{{ profile?.name }}</h2>
              <p class="muted">{{ profile?.username }} · {{ roleLabel(profile?.role) }}</p>
              <p class="muted" v-if="profile?.lastLoginAt">{{ $t('profile.last_sign_in', { p0: String(profile.lastLoginAt).slice(0, 16).replace('T', ' ') }) }}</p>
            </div>
          </div>
          <!-- v1.2.9: 预设卡通头像(男女各半), 也可自行上传(上传走七牛云) -->
          <div class="preset-avatars">
            <span class="preset-label">{{ $t('profile.pick_cartoon_avatar') }}</span>
            <img v-for="i in 10" :key="i" :src="withBase(`/avatars/cartoon-${i}.svg`)"
                 :class="['preset-avatar', { active: form.avatarUrl === withBase(`/avatars/cartoon-${i}.svg`) }]"
                 @click="pickPreset(i)" />
          </div>
          <el-divider />
          <div class="sec-row">
            <span>{{ $t('profile.password') }}</span>
            <el-button link type="primary" @click="$router.push('/admin/change-password')">{{ $t('profile.change_password') }}</el-button>
          </div>
          <!-- v2.5.5(#912) 通知按类型开关在通知中心 -->
          <div class="sec-row">
            <span>{{ $t('common.notification_settings') }}</span>
            <el-button link type="primary" @click="$router.push('/admin/notifications?settings=1')">{{ $t('profile.per_type_switches') }}</el-button>
          </div>
          <!-- v2.13.0(#1281) 我的开发助手入口 -->
          <div class="sec-row">
            <span>{{ $t('common.my_dev_assistants') }}</span>
            <el-button link type="primary" @click="$router.push('/admin/my-bots')">{{ $t('profile.manage_my_robots') }}</el-button>
          </div>
          <div class="sec-row muted-sm">{{ $t('profile.name_role_managed_by_administrators_in') }}</div>
        </el-card>
      </el-col>

      <el-col :span="15">
        <el-card shadow="never" class="block-card">
          <template #header><span class="block-title">{{ $t('profile.basic_info') }}</span></template>
          <el-form label-width="90px" style="max-width: 520px;">
            <el-form-item :label="$t('common.phone_2')">
              <el-input v-model="form.phone" :placeholder="$t('profile.for_teammates_notifications')" maxlength="20" />
            </el-form-item>
            <el-form-item :label="$t('common.email')">
              <el-input v-model="form.email" :placeholder="$t('profile.work_email')" maxlength="100" />
            </el-form-item>
            <!-- v1.5.6 所属团队: 只读展示, 归属由管理员在「用户管理」设置; 即时消息通知按团队定位 -->
            <el-form-item :label="$t('common.team')">
              <div>
                <template v-if="myTeams.length">
                  <el-tag v-for="t in myTeams" :key="t.id" size="small" effect="plain" style="margin-right: 6px;">{{ t.name }}</el-tag>
                </template>
                <span v-else class="muted-sm">{{ $t('common.not_set_2') }}</span>
                <div class="muted-sm" style="margin-top: 4px;">{{ $t('profile.managed_by_administrators_in_users_instant') }}</div>
              </div>
            </el-form-item>
            <el-form-item :label="$t('profile.about_me')">
              <el-input v-model="form.bio" type="textarea" :rows="5" maxlength="500" show-word-limit
                        :placeholder="$t('profile.tech_stack_industry_experience_interests_shown')" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">{{ $t('common.save') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { withBase } from '@/utils/base.js'
import { $t } from '@/i18n'
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'

const loading = ref(false)
const saving = ref(false)
const avatarUploading = ref(false)
const profile = ref(null)
const myTeams = ref([])   // v1.5.6 所属团队(只读, 管理员在用户管理设置)
const form = reactive({ phone: '', email: '', avatarUrl: '', bio: '' })

import { roleLabel } from '@/api/roles.js'  // v1.3.2 动态角色

async function load() {
  loading.value = true
  try {
    const me = await fde.me()
    profile.value = me.profile
    myTeams.value = me.profile.teams || []
    Object.assign(form, {
      phone: me.profile.phone || '', email: me.profile.email || '',
      avatarUrl: me.profile.avatarUrl || '', bio: me.profile.bio || ''
    })
  } catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

async function onAvatarPick(file) {
  if (!file?.raw) return
  avatarUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file.raw)
    const r = await fde.uploads.upload(fd)
    if (r.code !== 0) throw new Error(r.message || $t('common.upload_failed'))
    form.avatarUrl = r.data.url
    await save(true)
  } catch (e) { ElMessage.error(e.message) }
  finally { avatarUploading.value = false }
}

async function pickPreset(i) {
  form.avatarUrl = withBase(`/avatars/cartoon-${i}.svg`)
  await save(true)
}

async function save(silent = false) {
  saving.value = true
  try {
    const updated = await fde.updateProfile({ phone: form.phone, email: form.email, avatarUrl: form.avatarUrl, bio: form.bio })
    // 同步本地缓存, 让顶栏头像即时生效
    try {
      const u = JSON.parse(localStorage.getItem('fde_internal_user') || '{}')
      u.avatarUrl = updated.avatarUrl
      localStorage.setItem('fde_internal_user', JSON.stringify(u))
      window.dispatchEvent(new CustomEvent('yh-user-updated', { detail: u }))
    } catch { /* ignore */ }
    if (!silent) ElMessage.success($t('common.saved'))
    else ElMessage.success($t('profile.avatar_updated'))
    profile.value = { ...profile.value, ...updated }
  } catch (e) { ElMessage.error(e.message) }
  finally { saving.value = false }
}

onMounted(load)
</script>

<style scoped>
.profile-page { max-width: 1000px; }
.block-card { border-radius: 12px; }
.block-title { font-weight: 700; }
.p-head { display: flex; gap: 20px; align-items: flex-start; }
.avatar-wrap { display: flex; flex-direction: column; align-items: center; }
.p-avatar { width: 88px; height: 88px; border-radius: 50%; object-fit: cover; border: 1px solid #eae7e2; }
.p-avatar-fallback { display: flex; align-items: center; justify-content: center; background: #f0eee9; color: #1c1917; font-size: 34px; font-weight: 800; }
.p-info h2 { margin: 6px 0 4px; color: #1c1917; }
.muted { color: #8f8a82; font-size: 13px; margin: 2px 0; }
.muted-sm { color: #a8a29a; font-size: 12px; }
.sec-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
/* v1.2.9 预设头像 */
.preset-avatars { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.preset-label { font-size: 12px; color: #8f8a82; width: 100%; }
.preset-avatar { width: 44px; height: 44px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: all 0.15s; }
.preset-avatar:hover { transform: scale(1.1); }
.preset-avatar.active { border-color: #d2521e; }
</style>
