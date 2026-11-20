<template>
  <!-- 顶部「人」筛选: 头像 + 姓名; 手机上只露头像 + 姓名首字(≤160px 宽, 点击区 ≥44px) -->
  <el-select
    :model-value="modelValue" filterable :filter-method="onFilter" class="okr-pp" :class="{ 'is-compact': compact }"
    popper-class="okr-pp-popper" :aria-label="$t('okr.people.pick')" data-test="okr-person-picker"
    @update:model-value="pick" @visible-change="v => v && (query = '')"
  >
    <template #label>
      <span class="okr-pp-label">
        <el-avatar :size="24" :src="current?.avatarUrl || undefined" class="okr-pp-av">{{ initialOf(current?.name) }}</el-avatar>
        <span class="okr-pp-name">{{ compact ? initialOf(current?.name) : (current?.name || '') }}</span>
        <span v-if="!compact && current && isMe(current.id)" class="okr-pp-me">{{ $t('okr.people.me') }}</span>
      </span>
    </template>
    <el-option v-for="p in shown" :key="p.id" :value="p.id" :label="p.name">
      <span class="okr-pp-opt">
        <el-avatar :size="24" :src="p.avatarUrl || undefined" class="okr-pp-av">{{ initialOf(p.name) }}</el-avatar>
        <span class="okr-pp-name">{{ p.name }}</span>
        <span v-if="isMe(p.id)" class="okr-pp-me">{{ $t('okr.people.me') }}</span>
      </span>
    </el-option>
  </el-select>
</template>

<script setup>
import { computed, ref } from 'vue'
import { $t } from '@/i18n'
import { initialOf, sameId } from '@/views/okr/okrPeople.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  people: { type: Array, default: () => [] },
  meId: { type: String, default: '' },
  compact: Boolean
})
const emit = defineEmits(['update:modelValue', 'change'])

const query = ref('')
const current = computed(() => props.people.find(p => sameId(p.id, props.modelValue)) || null)
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.people.filter(p => String(p.name).toLowerCase().includes(q)) : props.people
})
const isMe = id => sameId(id, props.meId)

function onFilter(q) { query.value = q || '' }

function pick(id) {
  emit('update:modelValue', id)
  emit('change', id)
}
</script>

<style scoped>
.okr-pp { width: 200px; }
.okr-pp :deep(.el-select__wrapper) { min-height: 36px; }
.okr-pp-label, .okr-pp-opt { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.okr-pp-av { flex: none; font-size: 12px; }
.okr-pp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.okr-pp-me { flex: none; font-size: 11px; padding: 0 4px; border-radius: 4px; color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
/* 手机: 只露头像 + 首字, 宽 ≤160px, 点击区 ≥44px */
.okr-pp.is-compact { width: 96px; max-width: 160px; }
.okr-pp.is-compact :deep(.el-select__wrapper) { min-height: 44px; }
</style>

<style>
@media (max-width: 640px) {
  .okr-pp-popper .el-select-dropdown__item { min-height: 44px; line-height: 44px; height: auto; }
}
</style>
