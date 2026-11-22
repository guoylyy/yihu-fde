<template>
  <!-- 顶部「人」筛选: 头像 + 姓名, 自己后面灰色小字「（我）」; 按钮宽度跟着姓名走, 不截断(手机 ≤160px, 点击区 ≥44px)。
       头像首字用 CSS ::after 画(data-initial), 不进 innerText, 读出来就是「老板（我）」而不是「老 老板 我」 -->
  <el-select
    :model-value="modelValue" filterable :filter-method="onFilter" class="okr-pp" :class="{ 'is-compact': compact }" :style="{ width: width + 'px' }"
    popper-class="okr-pp-popper" :aria-label="$t('okr.people.pick')" data-test="okr-person-picker"
    @update:model-value="pick" @visible-change="v => v && (query = '')"
  >
    <template #label>
      <span class="okr-pp-label">
        <el-avatar :size="24" :src="current?.avatarUrl || undefined" class="okr-pp-av" aria-hidden="true" :data-initial="current?.avatarUrl ? undefined : initialOf(current?.name)" />
        <span class="okr-pp-name">{{ current?.name || '' }}<span v-if="current && isMe(current.id)" class="okr-pp-me">{{ $t('okr.people.me') }}</span></span>
      </span>
    </template>
    <el-option v-for="p in shown" :key="p.id" :value="p.id" :label="p.name">
      <span class="okr-pp-opt">
        <el-avatar :size="24" :src="p.avatarUrl || undefined" class="okr-pp-av" aria-hidden="true" :data-initial="p.avatarUrl ? undefined : initialOf(p.name)" />
        <span class="okr-pp-name">{{ p.name }}<span v-if="isMe(p.id)" class="okr-pp-me">{{ $t('okr.people.me') }}</span></span>
      </span>
    </el-option>
  </el-select>
</template>

<script setup>
import { computed, ref } from 'vue'
import { $t } from '@/i18n'
import { initialOf, sameId } from '@/views/okr/okrPeople.js'
import { pickerWidth } from '@/views/okr/okrPolish.js'

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
const width = computed(() => pickerWidth(current.value?.name || '', {
  isMe: !!current.value && isMe(current.value.id),
  meText: $t('okr.people.me'),
  ...(props.compact ? { min: 96, max: 160 } : {})
}))

function onFilter(q) { query.value = q || '' }

function pick(id) {
  emit('update:modelValue', id)
  emit('change', id)
}
</script>

<style scoped>
.okr-pp { max-width: 100%; }
.okr-pp :deep(.el-select__wrapper) { min-height: 36px; }
.okr-pp-label, .okr-pp-opt { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.okr-pp-av { flex: none; font-size: 12px; }
.okr-pp-av[data-initial]::after { content: attr(data-initial); }
.okr-pp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.okr-pp-me { margin-left: 1px; font-size: 12px; color: var(--el-text-color-secondary); white-space: nowrap; }
/* 手机: 宽 ≤160px(超长名才省略), 点击区 ≥44px */
.okr-pp.is-compact :deep(.el-select__wrapper) { min-height: 44px; }
</style>

<style>
@media (max-width: 640px) {
  .okr-pp-popper .el-select-dropdown__item { min-height: 44px; line-height: 44px; height: auto; }
}
</style>
