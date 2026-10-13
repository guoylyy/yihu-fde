<template>
  <!-- v2.8.0(#1144) 路径图终点节点 = 当前里程碑本身 -->
  <div class="rm-ms" :class="`ms-${data.status}`" :title="data.goal || data.name">
    <Handle type="target" :position="Position.Left" class="rm-ms-handle" />
    <div class="rm-ms-flag">🏁</div>
    <div class="rm-ms-body">
      <div class="rm-ms-name">{{ data.name }}</div>
      <div class="rm-ms-sub">
        <span v-if="data.stats">{{ $t('common.done', { p0: data.stats.done, p1: data.stats.total }) }}</span>
        <span v-if="data.plannedDate"> · {{ String(data.plannedDate).slice(5, 10) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core'
defineProps({ data: { type: Object, required: true } })
</script>

<style scoped>
.rm-ms { width: 150px; height: 56px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 28px; background: #1c1917; color: #fff; border: 2px solid #1c1917; }
.rm-ms.ms-COMPLETED { background: #2e7d4f; border-color: #2e7d4f; }
.rm-ms.ms-DELAYED { background: #b91c1c; border-color: #b91c1c; }
.rm-ms-flag { font-size: 18px; }
.rm-ms-name { font-size: 12px; font-weight: 600; line-height: 1.3; max-height: 32px; overflow: hidden; }
.rm-ms-sub { font-size: 10px; opacity: .8; }
.rm-ms-handle { width: 8px; height: 8px; background: #fff; border: 2px solid #1c1917; }
</style>
