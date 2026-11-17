<template>
  <!-- 批量粘贴 KR: 粘贴 → 拆成列表预览(可删、可调序) → 插入编辑器。不依赖模型, 不提交 -->
  <el-dialog
    :model-value="modelValue" :title="$t('okr.bulk.title')" width="min(94vw, 520px)" append-to-body
    class="okr-bulk-dialog" @update:model-value="$emit('update:modelValue', $event)" @closed="reset"
  >
    <p v-if="objectiveTitle" class="okr-bulk-target">{{ $t('okr.bulk.into', { p0: objectiveTitle }) }}</p>

    <template v-if="step === 'paste'">
      <el-input
        v-model="text" type="textarea" :rows="8" :placeholder="$t('okr.bulk.placeholder')"
        class="okr-bulk-text" data-test="bulk-text"
      />
      <p class="okr-bulk-hint">{{ $t('okr.bulk.hint') }}</p>
    </template>

    <template v-else>
      <p class="okr-bulk-count">{{ $t('okr.bulk.count', { p0: items.length }) }}</p>
      <el-alert v-if="clipped" type="warning" :closable="false" show-icon class="okr-bulk-alert" :title="$t('okr.bulk.clipped', { p0: clipped, p1: KR_TITLE_MAX })" />
      <el-alert v-if="overflow > 0" type="warning" :closable="false" show-icon class="okr-bulk-alert" :title="$t('okr.bulk.over_limit', { p0: room, p1: overflow })" />
      <ol class="okr-bulk-list">
        <li v-for="(it, i) in items" :key="it.k" :class="{ 'is-over': i >= room }">
          <span class="okr-bulk-no">{{ i + 1 }}</span>
          <el-input v-model="it.title" size="small" :maxlength="KR_TITLE_MAX" class="okr-bulk-input" />
          <div class="okr-bulk-ops">
            <el-button text size="small" :disabled="i === 0" :aria-label="$t('okr.bulk.up')" @click="move(i, -1)">↑</el-button>
            <el-button text size="small" :disabled="i === items.length - 1" :aria-label="$t('okr.bulk.down')" @click="move(i, 1)">↓</el-button>
            <el-button text size="small" :aria-label="$t('okr.delete_kr')" @click="items.splice(i, 1)">✕</el-button>
          </div>
        </li>
      </ol>
      <p v-if="!items.length" class="okr-bulk-empty">{{ $t('okr.bulk.empty') }}</p>
    </template>

    <template #footer>
      <template v-if="step === 'paste'">
        <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!text.trim()" data-test="bulk-split" @click="split">{{ $t('okr.bulk.split') }}</el-button>
      </template>
      <template v-else>
        <el-button @click="step = 'paste'">{{ $t('okr.bulk.back') }}</el-button>
        <el-button type="primary" :disabled="!usable.length || room <= 0" data-test="bulk-insert" @click="insert">
          {{ $t('okr.bulk.insert_n', { p0: Math.min(usable.length, room) }) }}
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import { splitBulkLines, moveItem, KR_TITLE_MAX } from '@/views/okr/okrUtils.js'

const props = defineProps({
  modelValue: Boolean,
  objectiveTitle: { type: String, default: '' },
  /** 这个 O 还能放几条 KR(编辑器上限 10, 空占位行会被顶替, 由调用方算好) */
  room: { type: Number, default: 10 }
})
const emit = defineEmits(['update:modelValue', 'insert'])

const step = ref('paste')
const text = ref('')
const items = ref([])
const clipped = ref(0)
let seq = 0

const usable = computed(() => items.value.map(i => i.title.trim()).filter(Boolean))
const overflow = computed(() => usable.value.length - props.room)

function split() {
  const r = splitBulkLines(text.value)
  items.value = r.items.map(title => ({ k: ++seq, title }))
  clipped.value = r.clipped
  step.value = 'preview'
}

function move(i, d) { moveItem(items.value, i, d) }

function insert() {
  emit('insert', usable.value.slice(0, props.room))
  emit('update:modelValue', false)
}

function reset() {
  step.value = 'paste'
  text.value = ''
  items.value = []
  clipped.value = 0
}
</script>

<style scoped>
.okr-bulk-target { margin: 0 0 8px; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.okr-bulk-hint, .okr-bulk-count, .okr-bulk-empty { margin: 6px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
.okr-bulk-count { margin: 0 0 6px; }
.okr-bulk-alert { margin-bottom: 6px; }
.okr-bulk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; }
.okr-bulk-list li { display: flex; align-items: center; gap: 4px; }
.okr-bulk-list li.is-over { opacity: .45; }
.okr-bulk-no { width: 20px; flex: none; font-size: 12px; color: var(--el-text-color-secondary); text-align: right; }
.okr-bulk-input { flex: 1; min-width: 0; }
.okr-bulk-ops { display: flex; flex: none; }
.okr-bulk-ops .el-button { padding: 4px 6px; margin: 0; min-width: 28px; }
</style>
