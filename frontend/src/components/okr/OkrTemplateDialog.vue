<template>
  <!-- OKR 7.0 个人模板: 列表(名称 + 使用 + 删除) + 「把当前计划存为模板」。使用 = 把模板 Markdown 交给批量导入(先预览再导入) -->
  <el-dialog
    :model-value="modelValue" :title="$t('okr.plan.tpl_title')" width="min(96vw, 520px)" append-to-body
    @update:model-value="v => $emit('update:modelValue', v)"
  >
    <div class="okr-tpl" v-loading="loading" data-test="okr-tpl">
      <form class="okr-tpl-save" @submit.prevent="save">
        <el-input v-model="name" maxlength="100" :placeholder="$t('okr.plan.tpl_name_ph')" :disabled="!currentMd" data-test="okr-tpl-name" />
        <el-button type="primary" native-type="submit" :disabled="!currentMd || !name.trim()" :loading="busy === 'save'" data-test="okr-tpl-save">{{ $t('okr.plan.tpl_save') }}</el-button>
      </form>
      <p v-if="!currentMd" class="okr-tpl-hint">{{ $t('okr.plan.tpl_empty_plan') }}</p>

      <ul v-if="list.length" class="okr-tpl-list">
        <li v-for="tp in list" :key="tp.id" class="okr-tpl-row" :data-test="'okr-tpl-row-' + tp.id">
          <div class="okr-tpl-main">
            <span class="okr-tpl-name">{{ tp.name }}</span>
            <span class="okr-tpl-meta">{{ $t('okr.plan.tpl_meta', { p0: countObjectives(tp.contentMd) }) }}</span>
          </div>
          <el-button size="small" type="primary" plain :data-test="'okr-tpl-use-' + tp.id" @click="$emit('use', tp)">{{ $t('okr.plan.tpl_use') }}</el-button>
          <el-button size="small" text type="danger" :loading="busy === tp.id" :data-test="'okr-tpl-del-' + tp.id" @click="remove(tp)">{{ $t('okr.delete') }}</el-button>
        </li>
      </ul>
      <p v-else-if="!loading" class="okr-tpl-none" data-test="okr-tpl-none">{{ $t('okr.plan.tpl_none') }}</p>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { $t } from '@/i18n'
import { fde } from '@/api/index.js'

const props = defineProps({
  modelValue: Boolean,
  /** 当前编辑器里的计划转成的 Markdown(空 = 没东西可存) */
  currentMd: { type: String, default: '' }
})
defineEmits(['update:modelValue', 'use'])

const list = ref([])
const loading = ref(false)
const busy = ref('')
const name = ref('')

watch(() => props.modelValue, (v) => { if (v) load() })

/** 模板里有几个 O(## 标题 / O1：) */
function countObjectives(md) {
  return String(md || '').split(/\r?\n/).filter(l => /^\s*(?:#{2,6}\s+|[-*]?\s*(?:\*\*)?O\s*\d)/i.test(l)).length
}

async function load() {
  loading.value = true
  try { list.value = await fde.okr.templates() } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
}

async function save() {
  busy.value = 'save'
  try {
    const tp = await fde.okr.createTemplate({ name: name.value.trim(), contentMd: props.currentMd })
    list.value = [tp, ...list.value]
    name.value = ''
    ElMessage.success($t('okr.plan.tpl_saved'))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

async function remove(tp) {
  try {
    await ElMessageBox.confirm($t('okr.plan.tpl_confirm_delete', { p0: tp.name }), $t('okr.delete'), {
      type: 'warning', confirmButtonText: $t('okr.delete'), cancelButtonText: $t('common.cancel')
    })
  } catch { return }
  busy.value = tp.id
  try {
    await fde.okr.deleteTemplate(tp.id)
    list.value = list.value.filter(x => x.id !== tp.id)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    busy.value = ''
  }
}

defineExpose({ countObjectives })
</script>

<style scoped>
.okr-tpl { display: flex; flex-direction: column; gap: 10px; min-height: 80px; }
.okr-tpl-save { display: flex; gap: 6px; }
.okr-tpl-save .el-input { flex: 1; min-width: 0; }
.okr-tpl-hint, .okr-tpl-none { margin: 0; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-tpl-none { text-align: center; padding: 16px 0; }
.okr-tpl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.okr-tpl-row { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.okr-tpl-row .el-button { margin-left: 0; }
.okr-tpl-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.okr-tpl-name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-tpl-meta { font-size: 12px; color: var(--el-text-color-secondary); }
@media (max-width: 640px) {
  .okr-tpl-save .el-button, .okr-tpl-row .el-button { min-height: 44px; }
}
</style>
