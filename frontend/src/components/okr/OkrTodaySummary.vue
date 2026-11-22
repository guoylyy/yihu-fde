<template>
  <!-- 精简第二轮: 每日总结并进「我的今日」, 放在最上面。只有自己(不出团队视图; 团队谁没写看团队 OKR 页的周进度)。
       上: 系统聚合的今日 KR 进展(只读, 最多 5 条, 多了「再看 N 条」); 下: 一句话 + 保存(PUT /api/okr/daily) -->
  <section class="tsum" data-test="today-summary">
    <div class="tsum-head">
      <h3 data-test="today-summary-title">{{ $t('okr.slim.today_title') }}</h3>
      <router-link to="/admin/okr" class="tsum-more">{{ $t('today.open_okr') }}</router-link>
    </div>
    <div v-if="loading" class="tsum-skel"><el-skeleton :rows="2" animated /></div>
    <template v-else>
      <p v-if="error" class="tsum-empty err">{{ error }}</p>
      <ul v-else-if="digest.items.length" class="tsum-items" data-test="today-summary-items">
        <li v-for="(it, i) in digest.items" :key="i">{{ it.text }}</li>
      </ul>
      <p v-else class="tsum-empty" data-test="today-summary-none">{{ $t('okr.slim.today_none') }}</p>
      <button v-if="digest.more > 0" type="button" class="tsum-expand" data-test="today-summary-more" @click="expanded = true">
        {{ $t('okr.slim.today_more', { p0: digest.more }) }}
      </button>

      <form class="tsum-write" @submit.prevent="save">
        <el-input
          v-model="draft" maxlength="2000" :placeholder="$t('okr.slim.today_ph')" class="tsum-input" data-test="today-summary-input"
        />
        <span v-if="digest.savedAt" class="tsum-at" data-test="today-summary-saved">{{ $t('okr.slim.today_saved_at', { p0: savedTime(digest.savedAt) }) }}</span>
        <el-button type="primary" native-type="submit" :loading="saving" :disabled="!dirty" data-test="today-summary-save">{{ $t('common.save') }}</el-button>
      </form>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { todayKey } from '@/views/okr/okrFe3.js'
import { currentUser } from '@/views/okr/okrPeople.js'
import { todayDigest, digestDirty, savedTime } from '@/views/okr/okrSlim.js'

const me = currentUser()
const date = todayKey()
const view = ref(null)
const loading = ref(true)
const error = ref('')
const expanded = ref(false)
const draft = ref('')
const saving = ref(false)

const digest = computed(() => todayDigest(view.value, me.id, { expanded: expanded.value }))
const dirty = computed(() => digestDirty(digest.value.summary, draft.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    view.value = await fde.okr.daily(date, 'me')
    draft.value = digest.value.summary
  } catch (e) {
    view.value = null
    error.value = $t('today.load_failed', { msg: e.message })
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function save() {
  if (!dirty.value) return
  saving.value = true
  try {
    const r = await fde.okr.saveDaily(date, draft.value.trim())
    const summary = { id: r.id, summaryMd: r.summaryMd, updatedAt: r.updatedAt, onBehalfOf: null }
    const rows = view.value?.rows || []
    const row = rows.find(x => String(x.user?.id) === String(me.id))
    if (row) Object.assign(row, { summary, hasWritten: true })
    else view.value = { ...(view.value || {}), rows: [...rows, { user: { id: String(me.id) }, autoItems: [], summary, hasWritten: true }] }
    draft.value = r.summaryMd
    ElMessage.success($t('okr.slim.today_saved'))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.tsum { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 12px 14px; }
.tsum-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.tsum-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: #1c1917; }
.tsum-more { font-size: 12px; color: #8f8a82; text-decoration: none; }
.tsum-more:hover { color: #1c1917; }
.tsum-items { margin: 0; padding: 6px 10px 6px 24px; border-radius: 8px; background: #faf9f7; font-size: 13px; line-height: 1.6; color: #1c1917; }
.tsum-items li { overflow-wrap: anywhere; }
.tsum-empty { margin: 4px 0; color: #8f8a82; font-size: 13px; }
.tsum-empty.err { color: #c2362b; }
.tsum-expand { border: 0; background: none; padding: 4px 0; font: inherit; font-size: 12px; color: #5c574f; cursor: pointer; }
.tsum-expand:hover { color: #1c1917; }
.tsum-write { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.tsum-input { flex: 1; min-width: 0; }
.tsum-at { flex: none; font-size: 12px; color: #8f8a82; white-space: nowrap; }
.tsum-write .el-button { flex: none; }
.tsum-skel { padding: 4px 0; }
@media (max-width: 768px) {
  .tsum { padding: 10px 12px; }
  .tsum-write { flex-wrap: wrap; }
  .tsum-input { flex-basis: 100%; }
  .tsum-input :deep(.el-input__wrapper) { min-height: 44px; box-sizing: border-box; }
  .tsum-at { flex: 1; }
  .tsum-write .el-button { min-height: 44px; padding: 0 18px; }
}
</style>
