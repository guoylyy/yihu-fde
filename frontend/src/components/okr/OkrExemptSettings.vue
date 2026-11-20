<template>
  <!-- OKR 免提交名单(仅 ADMIN): 从平台用户里勾选, 已选的用标签展示可移除; 保存整份覆盖 PUT /api/okr/settings/exempt -->
  <div class="okr-exempt" v-loading="loading" data-test="okr-exempt">
    <h3 class="okr-ex-title">{{ $t('okr.v3.exempt_title') }}</h3>
    <p class="okr-ex-desc">{{ $t('okr.v3.exempt_desc') }}</p>

    <el-select
      v-model="picked" multiple filterable collapse-tags collapse-tags-tooltip
      :placeholder="$t('okr.v3.exempt_pick')" class="okr-ex-select" data-test="okr-exempt-select"
    >
      <el-option v-for="u in candidates" :key="u.id" :value="u.id" :label="labelOf(u)">
        <span>{{ u.name || u.username }}</span>
        <span class="okr-ex-opt-sub">@{{ u.username }}<template v-if="u.role"> · {{ u.role }}</template></span>
      </el-option>
    </el-select>

    <p class="okr-ex-count">{{ $t('okr.v3.exempt_count', { p0: picked.length }) }}</p>
    <div v-if="picked.length" class="okr-ex-tags" data-test="okr-exempt-tags">
      <el-tag v-for="id in picked" :key="id" closable size="large" @close="remove(id)">{{ labelOf(byId.get(id) || { id }) }}</el-tag>
    </div>
    <p v-else class="okr-ex-empty">{{ $t('okr.v3.exempt_empty') }}</p>

    <el-button type="primary" :loading="saving" :disabled="!dirty" data-test="okr-exempt-save" @click="save">{{ $t('common.save') }}</el-button>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { exemptCandidates, idsChanged } from '@/views/okr/okrUtils.js'

const loading = ref(false)
const saving = ref(false)
const users = ref([])
const saved = ref([])
const picked = ref([])

const candidates = computed(() => users.value)
const byId = computed(() => new Map(users.value.map(u => [u.id, u])))
const dirty = computed(() => idsChanged(picked.value, saved.value))
const labelOf = u => (u.name ? `${u.name} (@${u.username})` : u.username ? `@${u.username}` : `#${u.id}`)

function fill(d) {
  saved.value = (d.userIds || []).map(String)
  picked.value = [...saved.value]
  users.value = exemptCandidates(users.value, d.users)
}

async function load() {
  loading.value = true
  try {
    // 平台用户列表(在职), 不手打用户名
    const [ex, list] = await Promise.all([fde.okr.exempt(), fde.users.list({ page_size: 500, status: 1 })])
    users.value = exemptCandidates(list?.list || [], ex.users)
    fill(ex)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function remove(id) {
  picked.value = picked.value.filter(x => x !== id)
}

async function save() {
  saving.value = true
  try {
    fill(await fde.okr.saveExempt(picked.value))
    ElMessage.success($t('okr.v3.exempt_saved'))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.okr-exempt { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; max-width: 760px; }
.okr-ex-title { margin: 0; font-size: 16px; }
.okr-ex-desc { margin: 0; font-size: 13px; color: var(--el-text-color-regular); }
.okr-ex-select { width: 100%; max-width: 480px; }
.okr-ex-opt-sub { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-ex-count { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-ex-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.okr-ex-empty { margin: 0; font-size: 13px; color: var(--el-text-color-secondary); }
</style>
