<template>
  <!-- 0.6.2 修改记录: 宽屏 520px 右抽屉, 手机全屏。按时间倒序一行一条, 「展开」看改前 / 改后全文与原因。
       只画计划层记录(后端只记计划层), 不出主管评分等无关字段 -->
  <el-drawer
    :model-value="modelValue" :title="$t('okr.confirm.audit')" direction="rtl" :size="mobile ? '100%' : '520px'"
    append-to-body class="okr-audit-drawer" @update:model-value="v => $emit('update:modelValue', v)"
  >
    <div v-loading="loading" class="okr-au" data-test="okr-audit">
      <p v-if="!loading && !rows.length" class="okr-au-empty" data-test="okr-audit-empty">{{ $t('okr.confirm.audit_empty') }}</p>
      <ul v-else class="okr-au-list">
        <li v-for="r in rows" :key="r.id" class="okr-au-item" :data-test="'okr-audit-' + r.id">
          <div class="okr-au-line">
            <span class="okr-au-when">{{ r.when }}</span>
            <span class="okr-au-who">{{ r.who + (r.manager ? $t('okr.confirm.manager_tag') : '') }}</span>
            <span class="okr-au-label">{{ r.label }}</span>
            <code v-if="r.code" class="okr-au-code">{{ r.code }}</code>
            <span v-if="r.summary" class="okr-au-sum">{{ r.summary }}</span>
            <span v-if="r.fromChange" class="okr-au-tag" data-test="okr-audit-from-change">{{ $t('okr.confirm.from_change') }}</span>
            <button
              v-if="r.expandable" type="button" class="okr-au-toggle" :aria-expanded="!!open[r.id]"
              :data-test="'okr-audit-toggle-' + r.id" @click="open[r.id] = !open[r.id]"
            >{{ open[r.id] ? $t('okr.confirm.collapse') : $t('okr.confirm.expand') }}</button>
          </div>
          <dl v-if="open[r.id]" class="okr-au-detail">
            <template v-if="r.before != null"><dt>{{ $t('okr.confirm.before') }}</dt><dd>{{ r.before }}</dd></template>
            <template v-if="r.after != null"><dt>{{ $t('okr.confirm.after') }}</dt><dd>{{ r.after }}</dd></template>
            <template v-if="r.reason"><dt>{{ $t('okr.confirm.reason') }}</dt><dd>{{ r.reason }}</dd></template>
          </dl>
        </li>
      </ul>
    </div>
  </el-drawer>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'
import { auditRow } from '@/views/okr/okrConfirm.js'

const props = defineProps({
  modelValue: Boolean,
  week: { type: String, default: '' },
  ownerId: { type: [String, Number], default: '' },
  meId: { type: [String, Number], default: '' },
  mobile: Boolean
})
defineEmits(['update:modelValue'])

const loading = ref(false)
const items = ref([])
const open = reactive({})
const rows = computed(() => items.value.map(i => auditRow(i, { meId: props.meId, ownerId: props.ownerId }, $t)))

async function load() {
  loading.value = true
  try {
    const r = await fde.okr.audit({ week: props.week, userId: props.ownerId || undefined, limit: 200 })
    items.value = r?.items || []
    for (const k of Object.keys(open)) delete open[k]
  } catch (e) {
    items.value = []
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
// 每次打开都重拉(刚确认 / 刚批准的要马上看到)
watch(() => props.modelValue, v => { if (v) load() })
</script>

<style scoped>
.okr-au { min-height: 120px; }
.okr-au-empty { margin: 32px 0; text-align: center; color: var(--el-text-color-secondary); font-size: 13px; }
.okr-au-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.okr-au-item { padding: 10px 0; border-bottom: 1px solid var(--el-border-color-lighter); font-size: 13px; }
.okr-au-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.okr-au-when { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; flex: none; }
.okr-au-who { font-weight: 600; flex: none; }
.okr-au-label { flex: none; }
.okr-au-code { font-size: 12px; font-weight: 600; color: var(--el-color-primary); }
.okr-au-sum { color: var(--el-text-color-regular); overflow-wrap: anywhere; min-width: 0; }
.okr-au-tag { font-size: 11px; padding: 0 6px; border-radius: 4px; color: #1d4f91; background: #eaf2fd; border: 1px solid #a9c8f2; flex: none; }
.okr-au-toggle { margin-left: auto; border: 0; background: none; color: var(--el-color-primary); cursor: pointer; font-size: 12px; padding: 4px 0; flex: none; }
.okr-au-detail { margin: 8px 0 0; padding: 8px 10px; border-radius: 6px; background: var(--el-fill-color-light); display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; }
.okr-au-detail dt { color: var(--el-text-color-secondary); }
.okr-au-detail dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 640px) {
  .okr-au-toggle { min-height: 44px; padding: 0 4px; }
}
</style>
