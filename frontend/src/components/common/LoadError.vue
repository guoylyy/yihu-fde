<template>
  <!-- 请求失败: 「加载失败：<message>」+ 重试(与今日页同一句文案) -->
  <div class="load-error" role="alert" data-test="load-error">
    <span class="msg">{{ $t('today.load_failed', { msg: message }) }}</span>
    <el-button size="small" data-test="load-retry" @click="$emit('retry')">{{ $t('common.retry') }}</el-button>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
defineProps({ message: { type: String, default: '' } })
defineEmits(['retry'])
</script>

<style scoped>
.load-error { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 14px; border: 1px dashed #f1cfcb; background: #fdf3f2; border-radius: 8px; }
.msg { color: var(--danger, #c2362b); font-size: 13px; word-break: break-word; flex: 1; min-width: 0; }
</style>
