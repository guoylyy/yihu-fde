<template>
  <div class="knowledge-edit-page">
    <div class="page-header">
      <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon>{{ $t('common.back') }}</el-button>
      <h2 class="page-title">{{ $t('common.p0', { p0: isEdit ? $t('knowledgeEdit.edit_article') : $t('common.new_article') }) }}</h2>
      <el-button v-if="isEdit" size="small" link @click="goDetail">{{ $t('knowledgeEdit.view_details') }}</el-button>
    </div>

    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never" class="form-card">
          <el-form ref="formRef" :model="form" :rules="rules" label-width="84px">
            <el-form-item :label="$t('common.title')" prop="title">
              <el-input v-model="form.title" :placeholder="$t('knowledgeEdit.e_g_fde_platform_deployment_guide')" size="large" />
            </el-form-item>
            <el-form-item :label="$t('common.category')">
              <el-select v-model="form.category" allow-create filterable :placeholder="$t('knowledgeEdit.choose_or_create_category')" style="width: 100%;">
                <el-option v-for="c in categories" :key="c.name" :label="c.name" :value="c.name" />
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('knowledgeEdit.linked_project')">
              <el-select v-model="form.projectId" filterable clearable :placeholder="$t('common.optional')" style="width: 100%;">
                <el-option v-for="p in projectOptions" :key="p.id" :label="`${p.code} ${p.name}`" :value="Number(p.id)" />
              </el-select>
            </el-form-item>
            <el-form-item :label="$t('common.tags')">
              <el-input v-model="tagInput" :placeholder="$t('knowledgeEdit.press_enter_confirm')" @keyup.enter="addTag" />
              <div class="tags-preview">
                <el-tag v-for="t in form.tags" :key="t" closable @close="removeTag(t)" effect="plain" style="margin-right: 6px;">#{{ t }}</el-tag>
                <small v-if="!form.tags.length" style="color: rgba(28, 25, 23,0.4);">{{ $t('knowledgeEdit.multiple_tags_press_enter_after_each') }}</small>
              </div>
            </el-form-item>
            <el-form-item :label="$t('common.content')" prop="content">
              <div class="md-toolbar">
                <el-button-group size="small">
                  <el-button @click="insertSnippet('h1')">H1</el-button>
                  <el-button @click="insertSnippet('h2')">H2</el-button>
                  <el-button @click="insertSnippet('h3')">H3</el-button>
                  <el-button @click="insertSnippet('bold')"><strong>B</strong></el-button>
                  <el-button @click="insertSnippet('italic')"><em>I</em></el-button>
                  <el-button @click="insertSnippet('code')">{{ $t('knowledgeEdit.code') }}</el-button>
                  <el-button @click="insertSnippet('link')">{{ $t('common.link_2') }}</el-button>
                  <el-button @click="insertSnippet('list')">{{ $t('common.list') }}</el-button>
                </el-button-group>
                <el-button-group size="small" style="margin-left: 12px;">
                  <el-button :type="showPreview ? 'primary' : 'default'" @click="showPreview = !showPreview">
                    <el-icon><View /></el-icon>{{ $t('common.p0', { p0: showPreview ? $t('knowledgeEdit.hide_preview') : $t('knowledgeEdit.show_preview') }) }}
                  </el-button>
                </el-button-group>
              </div>
              <el-input
                v-model="form.content"
                type="textarea"
                :rows="22"
                :placeholder="$t('knowledgeEdit.markdown_supported')"
                style="font-family: 'SF Mono', Consolas, monospace; font-size: 13px;"
                ref="textareaRef"
              />
            </el-form-item>
          </el-form>

          <div class="form-footer">
            <el-button @click="goBack">{{ $t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="submitting" @click="handleSubmit">
              {{ $t('common.p0', { p0: isEdit ? $t('common.save') : $t('common.publish') }) }}
            </el-button>
          </div>
        </el-card>
      </el-col>

      <el-col v-if="showPreview" :span="10">
        <el-card shadow="never" class="preview-card" style="position: sticky; top: 80px;">
          <div class="preview-title">{{ $t('common.p0', { p0: form.title || $t('knowledgeEdit.untitled') }) }}</div>
          <div class="preview-meta">
            <el-tag v-if="form.category" size="small">{{ form.category }}</el-tag>
            <span v-if="form.projectId">{{ projectName }}</span>
            <span v-if="form.tags.length">{{ form.tags.map(t => '#' + t).join(' ') }}</span>
          </div>
          <el-divider style="margin: 12px 0;" />
          <div class="markdown-body preview-content" v-html="renderedPreview"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, View } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github.css'
import { fde, formatDate } from '@/api/index.js'

const route = useRoute()
const router = useRouter()

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
    return hljs.highlightAuto(code).value
  },
  breaks: true,
  gfm: true
})

const isEdit = computed(() => route.params.id && route.params.id !== 'new')
const formRef = ref()
const submitting = ref(false)
const showPreview = ref(true)

const form = reactive({
  title: '', category: '', projectId: null,
  tags: [], content: ''
})
const tagInput = ref('')
const categories = ref([])
const projectOptions = ref([])

const rules = {
  title: [{ required: true, message: $t('common.title_required'), trigger: 'blur' }],
  content: [{ required: true, message: $t('knowledgeEdit.content_required'), trigger: 'blur' }]
}

const renderedPreview = computed(() => marked(form.content || ''))

const projectName = computed(() => {
  if (!form.projectId) return ''
  const p = projectOptions.value.find(p => Number(p.id) === form.projectId)
  return p ? `${p.code} ${p.name}` : ''
})

function addTag() {
  const t = tagInput.value.trim()
  if (t && !form.tags.includes(t)) form.tags.push(t)
  tagInput.value = ''
}

function removeTag(t) {
  form.tags = form.tags.filter(x => x !== t)
}

function insertSnippet(type) {
  const samples = {
    h1: $t('knowledgeEdit.heading_1'),
    h2: $t('knowledgeEdit.heading_2'),
    h3: $t('knowledgeEdit.heading_3'),
    bold: $t('knowledgeEdit.bold'),
    italic: $t('knowledgeEdit.italic'),
    code: '```javascript\nconst x = 1\n```',
    link: $t('knowledgeEdit.link_text_https_example_com'),
    list: $t('knowledgeEdit.item_1_item_2_item_3')
  }
  form.content = (form.content || '') + (samples[type] || '')
}

async function loadOptions() {
  const [proj, cats] = await Promise.all([
    fde.projects.list({ page: 1, page_size: 200 }),
    fde.knowledge.categories()
  ])
  projectOptions.value = proj.list
  categories.value = cats.data
}

async function loadArticle() {
  if (!isEdit.value) return
  try {
    const res = await fde.knowledge.detail(route.params.id)
    const a = res
    Object.assign(form, {
      title: a.title,
      category: a.category || '',
      projectId: a.projectId ? Number(a.projectId) : null,
      tags: a.tags || [],
      content: a.content
    })
  } catch (e) {
    ElMessage.error($t('knowledgeEdit.failed_load_article'))
  }
}

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    const payload = {
      title: form.title,
      category: form.category || null,
      content: form.content,
      tags: form.tags,
      projectId: form.projectId || null
    }
    if (isEdit.value) {
      await fde.knowledge.update(route.params.id, payload)
      ElMessage.success($t('common.saved'))
      router.push('/admin/knowledge')
    } else {
      const res = await fde.knowledge.create(payload)
      ElMessage.success($t('common.published'))
      router.push(`/admin/knowledge/edit/${res.id}`)
    }
  } catch (e) {
    ElMessage.error($t('knowledgeEdit.save_failed') + (e.response?.data?.message || e.message))
  } finally {
    submitting.value = false
  }
}

function goBack() { router.push('/admin/knowledge') }
function goDetail() { router.push(isEdit.value ? `/admin/knowledge/${route.params.id}` : '/admin/knowledge') }

onMounted(() => {
  loadOptions()
  loadArticle()
  // 2026-07-31: 从项目主页「新建文章」进来时预填所属项目 (?projectId=)
  if (!isEdit.value && route.query.projectId) form.projectId = Number(route.query.projectId)
})
</script>

<style scoped>
.knowledge-edit-page { padding: 0; }
.page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; margin: 0; flex: 1; }

.form-card { padding: 24px; }
.tags-preview { margin-top: 8px; min-height: 24px; }

.md-toolbar { margin-bottom: 8px; padding: 8px; background: rgba(28, 25, 23,0.02); border-radius: 4px; }

.form-footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 16px; border-top: 1px solid rgba(28, 25, 23,0.06); margin-top: 16px; }

.preview-card { padding: 16px 20px; max-height: calc(100vh - 100px); overflow-y: auto; }
.preview-title { font-size: 22px; font-weight: 700; color: rgba(28, 25, 23,0.9); }
.preview-meta { display: flex; gap: 12px; font-size: 12px; color: rgba(28, 25, 23,0.6); align-items: center; flex-wrap: wrap; }
.preview-content { font-size: 14px; line-height: 1.8; }

/* Markdown 渲染样式 */
.markdown-body :deep(h1) { font-size: 24px; margin: 16px 0 12px; border-bottom: 1px solid rgba(28, 25, 23,0.1); padding-bottom: 8px; }
.markdown-body :deep(h2) { font-size: 20px; margin: 16px 0 10px; }
.markdown-body :deep(h3) { font-size: 17px; margin: 14px 0 8px; }
.markdown-body :deep(p) { margin: 10px 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 24px; margin: 10px 0; }
.markdown-body :deep(code) { background: rgba(28, 25, 23,0.06); padding: 1px 6px; border-radius: 3px; font-size: 13px; }
.markdown-body :deep(pre) { background: #f6f8fa; padding: 14px; border-radius: 6px; overflow-x: auto; margin: 10px 0; }
.markdown-body :deep(pre code) { background: none; padding: 0; }
.markdown-body :deep(blockquote) { border-left: 4px solid rgba(64,158,255,0.6); padding: 6px 14px; margin: 10px 0; color: rgba(28, 25, 23,0.7); background: rgba(64,158,255,0.04); }
.markdown-body :deep(table) { border-collapse: collapse; margin: 10px 0; width: 100%; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid rgba(28, 25, 23,0.1); padding: 8px 12px; }
.markdown-body :deep(a) { color: #1c1917; text-decoration: none; }
.markdown-body :deep(a):hover { text-decoration: underline; }
</style>