<template>
  <!-- 实例配了自己的 Logo 就用它, 否则用内置标志 -->
  <img v-if="logoUrl" :src="logoUrl" :style="{ width: size + 'px', height: size + 'px' }"
    class="brand-logo" alt="" aria-hidden="true" />
  <!-- 内置标志: 实心节点(工程师)与空心节点(智能体)相连 -->
  <svg v-else class="brand-mark" :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
    <line x1="11" y1="21" x2="21" y2="11" :stroke="inkColor" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="10" cy="22" r="6" fill="var(--brand-primary, #f54e00)" />
    <circle cx="22" cy="10" r="5" fill="none" :stroke="inkColor" stroke-width="2.5" />
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import { getBrand } from '@/api/edition.js'

const props = defineProps({
  size: { type: Number, default: 26 },
  dark: { type: Boolean, default: false }  // 深底反白
})

const inkColor = computed(() => (props.dark ? '#faf9f7' : '#1c1917'))
const logoUrl = computed(() => getBrand().logoUrl || '')
</script>

<style scoped>
.brand-logo { object-fit: contain; flex: none; display: inline-block; }
.brand-mark { flex: none; display: inline-block; }
</style>
