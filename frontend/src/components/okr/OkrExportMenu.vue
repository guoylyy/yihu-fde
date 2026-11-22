<template>
  <!-- OKR 8.0 导出下拉: 选项由 okrFe5.exportItems 给(工程师没有「团队」项)。
       点了 fetch blob 再用 <a download> 落盘, 文件名取后端 Content-Disposition; 不开新标签页 -->
  <el-dropdown trigger="click" :disabled="busy" data-test="okr-export" @command="run">
    <el-button :loading="busy" class="okr-export-btn" data-test="okr-export-btn">
      {{ $t('okr.fe5.export') }} <span aria-hidden="true" class="okr-export-caret">▾</span>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="it in items" :key="it.key" :command="it.key" :divided="!!it.divided" :data-test="'okr-export-' + it.key"
        >{{ $t(it.label, it.labelArgs || {}) }}</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { $t } from '@/i18n'
import { downloadExport, fileSizeText } from '@/views/okr/okrFe5.js'

const props = defineProps({
  /** [{ key, label, labelArgs?, params, divided? }] */
  items: { type: Array, default: () => [] }
})
const emit = defineEmits(['downloaded'])
const busy = ref(false)

async function run(key) {
  const it = props.items.find(i => i.key === key)
  if (!it || busy.value) return
  busy.value = true
  try {
    const r = await downloadExport(it.params)
    ElMessage.success({ message: $t('okr.fe5.exported', { p0: r.name, p1: fileSizeText(r.size) }), duration: 5000 })
    emit('downloaded', r)
  } catch (e) {
    ElMessage.error({ message: $t('okr.fe5.export_failed', { p0: e.message }), duration: 6000 })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.okr-export-btn { min-height: 32px; }
.okr-export-caret { margin-left: 4px; font-size: 11px; }
@media (max-width: 640px) { .okr-export-btn { min-height: 44px; } }
</style>
