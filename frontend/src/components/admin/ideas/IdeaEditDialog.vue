<template>
  <!-- v2.10.0(#1180) 发想法 / 改想法: 话题 + 标题 + Markdown 正文(可预览) + 图片附件 -->
  <el-dialog :model-value="modelValue" :title="idea ? $t('ideaEditDialog.edit_idea') : $t('ideaEditDialog.post_idea')" width="680px" :close-on-click-modal="false" @update:model-value="v => $emit('update:modelValue', v)">
    <el-form label-width="60px">
      <el-form-item :label="$t('common.topic')" required>
        <el-select v-model="form.topicId" :placeholder="$t('ideaEditDialog.which_topic_does_it_belong')" style="width: 100%;">
          <el-option v-for="t in activeTopics" :key="t.id" :label="`${t.icon || '#'} ${t.name}`" :value="String(t.id)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="$t('common.title')" required>
        <el-input v-model="form.title" maxlength="200" :placeholder="$t('ideaEditDialog.sum_up_idea_in_one_sentence')" />
      </el-form-item>
      <el-form-item :label="$t('common.content')" required>
        <div class="editor">
          <div class="editor-tabs">
            <button type="button" :class="{ on: !preview }" @click="preview = false">{{ $t('common.edit') }}</button>
            <button type="button" :class="{ on: preview }" @click="preview = true">{{ $t('common.preview') }}</button>
            <span class="hint">{{ $t('ideaEditDialog.markdown_supported_name_notifies_that_person') }}</span>
          </div>
          <el-input v-if="!preview" v-model="form.content" type="textarea" :rows="10"
            :placeholder="$t('ideaEditDialog.what_it_why_it_worth_doing')" />
          <div v-else class="md-body preview" v-html="previewHtml"></div>
        </div>
      </el-form-item>
      <el-form-item :label="$t('common.attachments')">
        <div class="atts">
          <div v-for="(a, i) in form.attachments" :key="a.fileUrl" class="att">
            <img v-if="isImage(a)" :src="a.fileUrl" :alt="a.filename" />
            <span v-else class="att-file">📎 {{ a.filename }}</span>
            <el-button link type="danger" size="small" @click="form.attachments.splice(i, 1)">{{ $t('common.remove') }}</el-button>
          </div>
          <el-upload v-if="form.attachments.length < 9" :http-request="upload" :show-file-list="false" multiple>
            <el-button size="small" :loading="uploading">{{ $t('ideaEditDialog.image_file') }}</el-button>
          </el-upload>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ $t('common.p0', { p0: idea ? $t('common.save') : $t('common.publish') }) }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'
import { isImage } from './ideaUtils.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  topics: { type: Array, default: () => [] },
  idea: { type: Object, default: null },            // 传了就是编辑
  defaultTopicId: { type: [String, Number], default: '' }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const form = reactive({ topicId: '', title: '', content: '', attachments: [] })
const preview = ref(false)
const saving = ref(false)
const uploading = ref(false)

// 归档的话题不能再发新想法; 编辑时保留想法原来所在的话题
const activeTopics = computed(() => props.topics.filter(t => !t.archived || String(t.id) === String(props.idea?.topicId)))
const previewHtml = computed(() => renderSafeMarkdown(form.content || $t('ideaEditDialog.nothing_written_yet')))

watch(() => props.modelValue, open => {
  if (!open) return
  preview.value = false
  Object.assign(form, props.idea
    ? { topicId: String(props.idea.topicId), title: props.idea.title, content: props.idea.content, attachments: [...(props.idea.attachments || [])] }
    : { topicId: props.defaultTopicId ? String(props.defaultTopicId) : '', title: '', content: '', attachments: [] })
})

async function upload({ file }) {
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fde.uploads.upload(fd)
    if (r.code !== 0) throw new Error(r.message || $t('common.upload_failed'))
    form.attachments.push({ filename: file.name, fileUrl: r.data.url, fileSize: file.size })
  } catch (e) {
    ElMessage.error(e.message || $t('common.upload_failed'))
  } finally {
    uploading.value = false
  }
}

async function save() {
  if (!form.topicId) return ElMessage.warning($t('ideaEditDialog.choose_topic'))
  if (!form.title.trim() || !form.content.trim()) return ElMessage.warning($t('ideaEditDialog.title_content_both_required'))
  saving.value = true
  try {
    const payload = { topicId: form.topicId, title: form.title.trim(), content: form.content.trim(), attachments: form.attachments }
    const saved = props.idea ? await fde.ideas.update(props.idea.id, payload) : await fde.ideas.create(payload)
    ElMessage.success(props.idea ? $t('common.saved') : $t('common.published'))
    emit('update:modelValue', false)
    emit('saved', saved)
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.editor { width: 100%; }
.editor-tabs { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
.editor-tabs button { border: none; background: transparent; padding: 2px 10px; border-radius: 6px; font-size: 13px; color: #8f8a82; cursor: pointer; font-family: inherit; }
.editor-tabs button.on { background: #f0eee9; color: #1c1917; font-weight: 600; }
.hint { margin-left: auto; font-size: 12px; color: #a8a29a; }
.preview { min-height: 214px; max-height: 360px; overflow: auto; border: 1px solid #eae7e2; border-radius: 8px; padding: 8px 12px; font-size: 14px; line-height: 1.7; }
.preview :deep(p) { margin: 6px 0; }
.preview :deep(pre) { background: #1c1917; color: #faf9f7; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
.preview :deep(img) { max-width: 100%; }
.atts { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.att { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.att img { width: 72px; height: 72px; object-fit: cover; border-radius: 6px; border: 1px solid #eae7e2; }
.att-file { font-size: 12px; color: #5c574f; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
