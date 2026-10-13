<template>
  <el-dropdown trigger="click" @command="setLocale">
    <span class="lang-switch" :title="current.label">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9M12 3c-2.5 2.8-3.8 5.8-3.8 9s1.3 6.2 3.8 9" />
      </svg>
      <span v-if="!compact">{{ current.label }}</span>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item v-for="l in LOCALES" :key="l.code" :command="l.code" :disabled="l.code === locale">
          {{ l.label }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { LOCALES, locale, setLocale } from '@/i18n'

defineProps({ compact: { type: Boolean, default: false } })
const current = LOCALES.find(l => l.code === locale) || LOCALES[0]
</script>

<style scoped>
.lang-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--el-text-color-regular);
  outline: none;
}
.lang-switch:hover { color: var(--brand-primary, #f54e00); }
</style>
