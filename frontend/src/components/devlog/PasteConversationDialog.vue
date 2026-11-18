<template>
  <!-- 0.5.0 记一笔会话: 粘贴一段和 AI 的对话 → 落成开发会话 + 自动摘要(没配模型走规则兜底) -->
  <el-dialog :model-value="modelValue" :title="$t('conversations.paste_title')" width="640px" class="paste-dialog"
    append-to-body @update:model-value="v => emit('update:modelValue', v)" @closed="reset">
    <template v-if="!result">
      <p class="hint">{{ $t('conversations.paste_hint') }}</p>
      <el-input v-model="form.text" type="textarea" :rows="10" :placeholder="$t('conversations.paste_placeholder')"
        data-test="paste-text" />
      <div class="row">
        <el-input v-model="form.title" :placeholder="$t('conversations.paste_title_optional')" clearable class="grow" />
        <el-select v-model="form.stage" :placeholder="$t('conversations.stage')" clearable class="stage">
          <el-option v-for="s in STAGES" :key="s" :value="s" :label="$t('conversations.stages.' + s)" />
        </el-select>
      </div>
    </template>
    <div v-else class="result" data-test="paste-result">
      <el-alert type="success" :closable="false" show-icon
        :title="result.created ? $t('conversations.paste_created') : $t('conversations.paste_updated')" />
      <h4>{{ result.title }}</h4>
      <p v-if="result.summary" class="summary">{{ result.summary }}</p>
      <p v-if="result.mode === 'rules'" class="muted">{{ $t('conversations.rules_mode') }}</p>
    </div>
    <template #footer>
      <template v-if="!result">
        <el-button @click="emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" :disabled="!form.text.trim()" data-test="paste-submit" @click="submit">
          {{ $t('conversations.paste_submit') }}
        </el-button>
      </template>
      <template v-else>
        <el-button @click="emit('update:modelValue', false)">{{ $t('common.close') }}</el-button>
        <el-button type="primary" @click="openDetail">{{ $t('conversations.view_detail') }}</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { STAGES } from '@/views/admin/conversations/conversationUtils.js'

defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'saved'])
const router = useRouter()

const form = reactive({ text: '', title: '', stage: '' })
const saving = ref(false)
const result = ref(null)

function reset() {
  form.text = ''
  form.title = ''
  form.stage = ''
  result.value = null
}

async function submit() {
  if (!form.text.trim()) return
  saving.value = true
  try {
    result.value = await fde.devConversations.paste({
      text: form.text,
      title: form.title.trim() || undefined,
      stage: form.stage || undefined
    })
    emit('saved', result.value)
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

function openDetail() {
  const id = result.value?.id
  emit('update:modelValue', false)
  if (id) router.push(`/admin/conversations/${id}`)
}
</script>

<style scoped>
.hint { margin: 0 0 8px; color: #5c574f; font-size: 13px; }
.row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.grow { flex: 1; min-width: 200px; }
.stage { width: 140px; }
.result h4 { margin: 12px 0 6px; }
.summary { margin: 0; color: #1c1917; line-height: 1.6; white-space: pre-wrap; }
.muted { color: #8f8a82; font-size: 12px; }
:global(.paste-dialog) { max-width: calc(100vw - 24px); }
</style>
