<template>
  <!-- OKR 4.0 每日总结: 每人每天 = 当天自动聚合的进展(只读) + 自己补的一句总结。
       「我的」只有自己; 「团队」列出可见范围内的人, 没写的出浅色「未写」;
       ADMIN/MANAGER 顶部看到「今天 N 人未写」并可「提醒」; 别人的卡片只有能代管的主管可代写 -->
  <div class="dsum" v-loading="loading">
    <div class="dsum-top">
      <el-date-picker
        :model-value="date" type="date" value-format="YYYY-MM-DD" :clearable="false" :editable="false"
        :disabled-date="d => d.getTime() > Date.now()" class="dsum-date" data-test="dsum-date"
        @update:model-value="v => setQuery({ date: v })"
      />
      <el-radio-group :model-value="scope" class="dsum-scope" data-test="dsum-scope" @update:model-value="v => setQuery({ scope: v })">
        <el-radio-button value="me">{{ $t('okr.daily.scope_me') }}</el-radio-button>
        <el-radio-button value="team">{{ $t('okr.daily.scope_team') }}</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 主管: 没写的人数 + 提醒 -->
    <div v-if="lead && scope === 'team' && view" class="dsum-lead" :class="{ ok: !missing.length }" data-test="dsum-lead">
      <span v-if="missing.length" class="dsum-lead-text">
        {{ isToday ? $t('okr.daily.missing_today', { p0: missing.length }) : $t('okr.daily.missing_day', { p0: missing.length, p1: date }) }}
        <small>{{ missing.map(r => r.user.name).join('、') }}</small>
      </span>
      <span v-else class="dsum-lead-text">{{ $t('okr.daily.all_written') }}</span>
      <el-button v-if="missing.length" type="warning" plain data-test="dsum-remind" @click="remind">{{ $t('okr.daily.remind') }}</el-button>
    </div>

    <p v-if="view && scope === 'team'" class="dsum-sum">{{ $t('okr.daily.summary_line', { p0: view.summary.written, p1: view.summary.people, p2: view.summary.withProgress }) }}</p>

    <ul v-if="rows.length" class="dsum-list">
      <li v-for="row in rows" :key="row.user.id" class="dsum-card" :class="{ unwritten: !row.hasWritten }" :data-test="'dsum-card-' + row.user.id">
        <header class="dsum-head">
          <el-avatar :size="28" :src="row.user.avatarUrl || undefined" class="dsum-av">{{ initialOf(row.user.name) }}</el-avatar>
          <span class="dsum-name">{{ row.user.name }}</span>
          <span v-if="!row.hasWritten" class="dsum-tag-unwritten" data-test="dsum-unwritten">{{ $t('okr.daily.unwritten') }}</span>
          <span v-else-if="row.summary?.onBehalfOf" class="dsum-proxy">{{ $t('okr.daily.on_behalf', { p0: row.summary.onBehalfOf.name || '' }) }}</span>
        </header>

        <ul v-if="row.autoItems.length" class="dsum-auto" data-test="dsum-auto">
          <li v-for="(it, i) in row.autoItems" :key="i">{{ it.text }}</li>
        </ul>
        <p v-else class="dsum-noprog">{{ $t('okr.daily.no_progress') }}</p>

        <template v-if="editable(row)">
          <el-input
            v-model="drafts[row.user.id]" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" maxlength="10000"
            :placeholder="$t('okr.daily.placeholder')" class="dsum-input" :data-test="'dsum-input-' + row.user.id"
          />
          <div class="dsum-acts">
            <span v-if="row.summary?.updatedAt" class="dsum-at">{{ $t('okr.daily.saved_at', { p0: timeOf(row.summary.updatedAt) }) }}</span>
            <el-button
              type="primary" :loading="busy === row.user.id" :disabled="!dirty(row)" :data-test="'dsum-save-' + row.user.id"
              @click="save(row)"
            >{{ $t('common.save') }}</el-button>
          </div>
        </template>
        <p v-else-if="row.hasWritten" class="dsum-text">{{ row.summary.summaryMd }}</p>
      </li>
    </ul>
    <el-empty v-else-if="view" :description="$t('okr.daily.empty')" />
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { currentUser, initialOf, mayProxyRow, sameId } from './okrPeople.js'
import { isLead, todayKey, dailyMissingRows, dailyRemindText, summaryText } from './okrFe3.js'

const route = useRoute()
const router = useRouter()
const me = currentUser()
const lead = isLead(me)

const date = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(String(route.query.date || '')) ? route.query.date : todayKey()))
const scope = computed(() => (route.query.scope === 'team' ? 'team' : 'me'))
const isToday = computed(() => date.value === todayKey())

const view = ref(null)
const loading = ref(false)
const busy = ref('')
const drafts = reactive({})

/** 「我的」: 本周没交计划的人后端不列, 这里补一张自己的空卡, 照样能写 */
const rows = computed(() => {
  const list = view.value?.rows || []
  if (scope.value !== 'me' || !view.value || list.some(r => sameId(r.user.id, me.id)) || !me.id) return list
  return [{ user: { id: String(me.id), name: me.name || me.username, avatarUrl: me.avatarUrl, role: me.role }, hasOkr: false, autoItems: [], summary: null, hasWritten: false }]
})
const missing = computed(() => dailyMissingRows(view.value))

async function load() {
  loading.value = true
  try {
    view.value = await fde.okr.daily(date.value, scope.value)
    for (const k of Object.keys(drafts)) delete drafts[k]
    for (const r of rows.value) drafts[r.user.id] = summaryText(r)
  } catch (e) {
    view.value = null
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
watch([date, scope], load, { immediate: true })

function setQuery(patch) {
  router.replace({ query: { ...route.query, ...patch } })
}

/** 自己的卡总能写; 别人的卡只有能代管的主管能代写(后端再校验团队范围) */
const editable = row => sameId(row.user.id, me.id) || mayProxyRow(me, row.user)
const dirty = row => {
  const v = String(drafts[row.user.id] || '').trim()
  return !!v && v !== summaryText(row).trim()
}
const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

async function save(row) {
  busy.value = row.user.id
  try {
    const mine = sameId(row.user.id, me.id)
    const r = await fde.okr.saveDaily(date.value, drafts[row.user.id], mine ? undefined : row.user.id)
    const target = view.value.rows.find(x => sameId(x.user.id, row.user.id))
    const summary = { id: r.id, summaryMd: r.summaryMd, updatedAt: r.updatedAt, onBehalfOf: mine ? null : { id: String(me.id), name: me.name } }
    if (target) {
      if (!target.hasWritten) view.value.summary.written += 1
      Object.assign(target, { summary, hasWritten: true })
    } else {
      view.value.rows.push({ ...row, summary, hasWritten: true })
    }
    drafts[row.user.id] = r.summaryMd
    ElMessage.success($t('okr.daily.saved'))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

/** 后端没有「每日总结催交」接口: 把 @名单 + 提醒文案复制出去, 贴到群里 */
async function remind() {
  const text = dailyRemindText(missing.value, date.value, $t)
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success($t('okr.daily.remind_copied', { p0: missing.value.length }))
  } catch {
    ElMessage.info(text)
  }
}
</script>

<style scoped>
.dsum { max-width: 960px; margin: 0 auto; padding: 4px 0 24px; }
.dsum-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.dsum-date { width: 180px; }
.dsum-lead { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; margin-bottom: 10px; border-radius: 10px; background: var(--el-color-warning-light-9); }
.dsum-lead.ok { background: var(--el-color-success-light-9); }
.dsum-lead-text { font-size: 14px; font-weight: 600; min-width: 0; }
.dsum-lead-text small { display: block; font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.dsum-sum { margin: 0 0 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.dsum-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 10px; }
.dsum-card { background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dsum-head { display: flex; align-items: center; gap: 8px; }
.dsum-av { flex: none; font-size: 12px; }
.dsum-name { font-weight: 600; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dsum-tag-unwritten { flex: none; font-size: 12px; padding: 0 8px; line-height: 20px; border-radius: 10px; background: var(--el-fill-color); color: var(--el-text-color-secondary); }
.dsum-proxy { flex: none; font-size: 12px; color: var(--el-color-warning); }
.dsum-auto { margin: 0; padding: 8px 10px 8px 24px; border-radius: 8px; background: var(--el-fill-color-light); font-size: 13px; line-height: 1.6; }
.dsum-auto li { overflow-wrap: anywhere; }
.dsum-noprog { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--el-fill-color-lighter); font-size: 13px; color: var(--el-text-color-secondary); }
.dsum-acts { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.dsum-at { font-size: 12px; color: var(--el-text-color-secondary); }
.dsum-text { margin: 0; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 768px) {
  .dsum-top > * { flex: 1 1 auto; }
  .dsum-date { width: auto; }
  .dsum-top :deep(.el-input__wrapper) { min-height: 44px; box-sizing: border-box; }
  .dsum-scope { display: flex; }
  .dsum-scope :deep(.el-radio-button) { flex: 1; }
  .dsum-scope :deep(.el-radio-button__inner) { width: 100%; min-height: 44px; line-height: 20px; padding-top: 12px; padding-bottom: 12px; }
  .dsum-list { grid-template-columns: minmax(0, 1fr); }
  .dsum-acts .el-button, .dsum-lead .el-button { min-height: 44px; padding: 0 18px; }
}
</style>
