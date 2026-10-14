<template>
  <div class="reader-page">
    <div class="reader-nav">
      <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon>{{ $t('knowledgeDetail.back_blog') }}</el-button>
      <div class="nav-actions">
        <el-button v-if="article && can('knowledge.edit')" size="small" @click="editArticle"><el-icon><Edit /></el-icon>{{ $t('common.edit') }}</el-button>
        <el-popconfirm v-if="article && can('knowledge.delete')" :title="$t('common.delete_this_article')" @confirm="removeArticle">
          <template #reference><el-button size="small" type="danger" plain>{{ $t('common.delete_2') }}</el-button></template>
        </el-popconfirm>
      </div>
    </div>

    <div v-loading="loading" class="reader-body">
      <el-result v-if="notFound" icon="warning" :title="$t('knowledgeDetail.article_doesnt_exist_or_was_deleted')">
        <template #extra><el-button type="primary" @click="goBack">{{ $t('knowledgeDetail.back_blog_2') }}</el-button></template>
      </el-result>

      <template v-else-if="article">
        <div class="reader-layout">
          <article class="post-article">
            <header class="post-header">
              <div class="post-kicker">
                <el-tag v-if="article.category" size="small" type="info" effect="plain" class="clickable" @click="goList({ category: article.category })">{{ article.category }}</el-tag>
                <span v-if="article.project" class="post-project" @click="goProject">
                  <el-icon><Folder /></el-icon><code>{{ article.project.code }}</code> {{ article.project.name }}
                </span>
              </div>
              <h1 class="post-title">{{ article.title }}</h1>
              <div class="post-meta">
                <span class="author"><span class="avatar">{{ initial(article.author?.name) }}</span>{{ $t('common.p0', { p0: article.author?.name || $t('common.unknown_author') }) }}</span>
                <span class="dot">·</span>
                <span>{{ $t('knowledgeDetail.published', { p0: formatDate(article.createdAt) }) }}</span>
                <template v-if="isUpdated"><span class="dot">·</span><span>{{ $t('knowledgeDetail.updated', { p0: formatDate(article.updatedAt) }) }}</span></template>
                <span class="dot">·</span>
                <span>{{ $t('common.about_min', { p0: readMinutes }) }}</span>
                <span class="dot">·</span>
                <span>{{ $t('common.reads', { p0: article.viewCount }) }}</span>
              </div>
              <div v-if="article.tags?.length" class="post-tags">
                <el-tag v-for="t in article.tags" :key="t" size="small" effect="plain" class="clickable" @click="goList({ tag: t })">#{{ t }}</el-tag>
              </div>
            </header>

            <div ref="contentEl" class="post-content markdown-body" v-html="renderedHtml" @click="onContentClick"></div>

            <section v-if="checklist.length || checklistLoading || checklistError" class="post-section">
              <h2 class="section-title">{{ $t('knowledgeDetail.hands_on_checklist') }}</h2>
              <el-alert v-if="checklistError" :title="checklistError" type="warning" :closable="false" />
              <el-button v-if="checklistError" size="small" :loading="checklistLoading" @click="loadChecklist">{{ $t('knowledgeDetail.retry') }}</el-button>
              <div class="checklist">
                <el-checkbox
                  v-for="item in checklist" :key="item.itemKey" :model-value="item.checked"
                  :disabled="savingChecklist.has(item.itemKey)" @change="value => toggleChecklist(item, value)"
                >{{ item.label }}</el-checkbox>
              </div>
            </section>

            <footer class="post-footer">
              <span>{{ $t('knowledgeDetail.last_updated', { p0: formatDate(article.updatedAt) }) }}</span>
              <el-button link type="primary" @click="scrollTop">{{ $t('knowledgeDetail.back_top') }}</el-button>
            </footer>
          </article>

          <aside v-if="toc.length >= 2" class="post-toc">
            <div class="toc-title">{{ $t('knowledgeDetail.contents') }}</div>
            <nav>
              <a
                v-for="h in toc" :key="h.id" :href="'#' + h.id" class="toc-item" :class="[`lv${h.level}`, { active: activeId === h.id }]"
                @click.prevent="scrollToHeading(h.id)"
              >{{ h.text }}</a>
            </nav>
          </aside>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
// v2.5.5(#913) 知识库博客化: 独立阅读页(阅读排版 + 右侧目录 + 代码高亮/复制 + 表格横滚 + 图片自适应), 保留检查单与关联
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Edit, Folder } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import { sanitizeHtml } from '@/utils/safeMarkdown.js'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github.css'
import { fde, formatDate } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import { applyBrand } from '@/api/edition.js'

const route = useRoute()
const router = useRouter()
marked.setOptions({ breaks: true, gfm: true })

const article = ref(null)
const loading = ref(false)
const notFound = ref(false)
const contentEl = ref(null)
const toc = ref([])
const renderedHtml = ref('')
const activeId = ref('')
const checklist = ref([])
const checklistError = ref('')
const checklistLoading = ref(false)
const savingChecklist = ref(new Set())
let observer = null
let requestSeq = 0

const articleId = computed(() => String(route.params.id || ''))
const isUpdated = computed(() => article.value && formatDate(article.value.updatedAt) !== formatDate(article.value.createdAt))
const readMinutes = computed(() => {
  const text = article.value?.content || ''
  const cjk = (text.match(/[一-鿿]/g) || []).length
  const words = (text.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  return Math.max(1, Math.round((cjk + words * 1.5) / 400))
})

function initial(name) { return (name || '?').trim().slice(0, 1) }

/**
 * Markdown → HTML 后处理: 标题加 id 生成目录 / 代码块高亮 + 复制按钮 / 表格包横滚容器 / 图片懒加载
 * 用 DOMParser 而非 marked renderer, 与 marked 版本无关
 */
function renderMarkdown(md) {
  const html = sanitizeHtml(marked(md || ''))
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  const headings = []
  const used = new Set()
  root.querySelectorAll('h1, h2, h3, h4').forEach((h, i) => {
    const text = h.textContent.trim()
    let id = 'h-' + (text.replace(/[^\w一-鿿-]+/g, '-').replace(/^-+|-+$/g, '') || i)
    while (used.has(id)) id += '-' + i
    used.add(id)
    h.id = id
    headings.push({ id, text, level: Number(h.tagName.slice(1)) })
  })
  root.querySelectorAll('pre > code').forEach(code => {
    const lang = (code.className.match(/language-([\w+-]+)/) || [])[1]
    try {
      const out = lang && hljs.getLanguage(lang) ? hljs.highlight(code.textContent, { language: lang }) : hljs.highlightAuto(code.textContent)
      code.innerHTML = out.value
      code.classList.add('hljs')
    } catch { /* 保持原文 */ }
    const pre = code.parentElement
    const wrap = doc.createElement('div')
    wrap.className = 'code-block'
    const bar = doc.createElement('div')
    bar.className = 'code-bar'
    bar.innerHTML = $t('knowledgeDetail.span_class_code_lang_span_button', { p0: lang || 'text' })
    pre.replaceWith(wrap)
    wrap.appendChild(bar)
    wrap.appendChild(pre)
  })
  root.querySelectorAll('table').forEach(t => {
    const wrap = doc.createElement('div')
    wrap.className = 'table-wrap'
    t.replaceWith(wrap)
    wrap.appendChild(t)
  })
  root.querySelectorAll('img').forEach(img => { img.loading = 'lazy'; if (!img.alt) img.alt = '' })
  root.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener' })
  // 最小层级归一: 文章只用 h2/h3 时目录仍从一级缩进开始
  const minLevel = Math.min(...headings.map(h => h.level), 6)
  headings.forEach(h => { h.level = h.level - minLevel + 1 })
  return { html: root.innerHTML, headings }
}

async function onContentClick(e) {
  const btn = e.target.closest('[data-copy]')
  if (!btn) return
  const code = btn.closest('.code-block')?.querySelector('pre code')
  if (!code) return
  try {
    await navigator.clipboard.writeText(code.textContent)
    btn.textContent = $t('common.copied')
    setTimeout(() => { btn.textContent = $t('common.copy') }, 1500)
  } catch { ElMessage.warning($t('common.copy_failed_please_select_manually')) }
}

function setupObserver() {
  observer?.disconnect()
  if (!contentEl.value || !toc.value.length) return
  observer = new IntersectionObserver((entries) => {
    const visible = entries.filter(en => en.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    if (visible.length) activeId.value = visible[0].target.id
  }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 })
  contentEl.value.querySelectorAll('h1[id], h2[id], h3[id], h4[id]').forEach(h => observer.observe(h))
}

function scrollToHeading(id) {
  const el = contentEl.value?.querySelector('#' + CSS.escape(id))
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeId.value = id
  history.replaceState(null, '', `#${id}`)
}
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelector('.el-main')?.scrollTo?.({ top: 0, behavior: 'smooth' }) }

async function load() {
  const seq = ++requestSeq
  loading.value = true
  notFound.value = false
  article.value = null
  toc.value = []
  renderedHtml.value = ''
  try {
    const res = await fde.knowledge.detail(articleId.value)
    if (seq !== requestSeq) return
    article.value = res
    const { html, headings } = renderMarkdown(res.content)
    renderedHtml.value = html
    toc.value = headings
    document.title = $t('knowledgeDetail.team_blog', { p0: res.title })
    await nextTick()
    setupObserver()
    if (location.hash) scrollToHeading(decodeURIComponent(location.hash.slice(1)))
    loadChecklist()
    fde.knowledge.view(articleId.value).then(r => {
      if (article.value && String(article.value.id) === articleId.value && r?.viewCount !== undefined) article.value.viewCount = r.viewCount
    }).catch(() => {})
  } catch (e) {
    if (seq !== requestSeq) return
    if (/不存在|404/.test(e.message || '')) notFound.value = true
    else ElMessage.error($t('knowledgeDetail.failed_load_article') + e.message)
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

async function loadChecklist() {
  const id = articleId.value
  checklistLoading.value = true
  checklistError.value = ''
  try {
    const res = await fde.knowledge.checklist(id)
    if (id !== articleId.value) return
    checklist.value = res.items || []
  } catch (e) {
    if (id !== articleId.value) return
    checklist.value = []
    checklistError.value = e.message || $t('knowledgeDetail.failed_load_checklist')
  } finally {
    if (id === articleId.value) checklistLoading.value = false
  }
}

async function toggleChecklist(item, checked) {
  const id = articleId.value
  if (savingChecklist.value.has(item.itemKey)) return
  const pending = new Set(savingChecklist.value); pending.add(item.itemKey); savingChecklist.value = pending
  try {
    await fde.knowledge.setChecklistItem(id, item.itemKey, checked)
    if (id === articleId.value) item.checked = checked
  } catch (e) { ElMessage.error(e.message || $t('knowledgeDetail.failed_save_checklist_item')) }
  finally {
    const next = new Set(savingChecklist.value); next.delete(item.itemKey); savingChecklist.value = next
  }
}

function goBack() { if (history.length > 1 && document.referrer !== '') router.back(); else router.push('/admin/knowledge') }
function goList(query) { router.push({ path: '/admin/knowledge', query }) }
function goProject() { if (article.value?.project) router.push(`/admin/projects/${article.value.project.id}`) }
function editArticle() { router.push(`/admin/knowledge/edit/${articleId.value}`) }
async function removeArticle() {
  try {
    await fde.knowledge.remove(articleId.value)
    ElMessage.success($t('common.deleted'))
    router.replace('/admin/knowledge')
  } catch (e) { ElMessage.error(e.message || $t('common.delete_failed')) }
}

watch(articleId, (v) => { if (v && route.name === 'AdminKnowledgeDetail') load() })
onMounted(load)
onBeforeUnmount(() => { observer?.disconnect(); applyBrand() })
</script>

<style scoped>
.reader-page { padding: 0; }
.reader-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.nav-actions { display: flex; gap: 8px; }
.reader-body { min-height: 300px; }
.reader-layout { display: flex; gap: 32px; align-items: flex-start; }
.post-article {
  flex: 1; min-width: 0; max-width: 820px; background: #fff; border-radius: 10px;
  padding: 40px 48px 28px; box-shadow: 0 1px 2px rgba(28, 25, 23, 0.04), 0 0 0 1px rgba(28, 25, 23, 0.06);
}
.post-header { margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid rgba(28, 25, 23, 0.08); }
.post-kicker { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 12px; color: rgba(28, 25, 23, 0.55); }
.post-project { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.post-project:hover { color: #409eff; }
.post-project code { font-size: 12px; }
.post-title { font-size: 30px; line-height: 1.35; font-weight: 700; margin: 0 0 14px; color: #1c1917; letter-spacing: 0.2px; }
.post-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: rgba(28, 25, 23, 0.55); }
.post-meta .dot { color: rgba(28, 25, 23, 0.25); }
.post-meta .author { display: inline-flex; align-items: center; gap: 6px; color: rgba(28, 25, 23, 0.8); font-weight: 500; }
.avatar {
  width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #409eff, #79bbff);
  color: #fff; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; font-weight: 600;
}
.post-tags { margin-top: 12px; display: flex; gap: 6px; flex-wrap: wrap; }
.clickable { cursor: pointer; }

.post-section { margin-top: 32px; padding-top: 20px; border-top: 1px dashed rgba(28, 25, 23, 0.12); }
.section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; }
.checklist { display: flex; flex-direction: column; gap: 6px; }
.post-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 32px; padding-top: 14px; border-top: 1px solid rgba(28, 25, 23, 0.08); font-size: 12px; color: rgba(28, 25, 23, 0.45); }

.post-toc { width: 220px; flex: none; position: sticky; top: 76px; max-height: calc(100vh - 100px); overflow-y: auto; padding-left: 4px; }
.toc-title { font-size: 12px; font-weight: 600; color: rgba(28, 25, 23, 0.5); letter-spacing: 1px; margin-bottom: 8px; text-transform: uppercase; }
.toc-item {
  display: block; font-size: 13px; line-height: 1.5; padding: 4px 0 4px 10px; color: rgba(28, 25, 23, 0.6);
  border-left: 2px solid rgba(28, 25, 23, 0.08); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}
.toc-item.lv2 { padding-left: 22px; }
.toc-item.lv3 { padding-left: 34px; font-size: 12px; }
.toc-item.lv4 { padding-left: 46px; font-size: 12px; }
.toc-item:hover { color: #1c1917; }
.toc-item.active { color: #409eff; border-left-color: #409eff; font-weight: 500; }

/* 阅读排版 */
.post-content { font-size: 16px; line-height: 1.85; color: rgba(28, 25, 23, 0.88); word-break: break-word; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3), .markdown-body :deep(h4) {
  font-weight: 650; line-height: 1.4; color: #1c1917; scroll-margin-top: 80px;
}
.markdown-body :deep(h1) { font-size: 26px; margin: 40px 0 16px; padding-bottom: 8px; border-bottom: 1px solid rgba(28, 25, 23, 0.1); }
.markdown-body :deep(h2) { font-size: 22px; margin: 36px 0 14px; padding-bottom: 6px; border-bottom: 1px solid rgba(28, 25, 23, 0.08); }
.markdown-body :deep(h3) { font-size: 18px; margin: 28px 0 10px; }
.markdown-body :deep(h4) { font-size: 16px; margin: 20px 0 8px; }
.markdown-body :deep(h1:first-child), .markdown-body :deep(h2:first-child) { margin-top: 0; }
.markdown-body :deep(p) { margin: 0 0 16px; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { padding-left: 26px; margin: 0 0 16px; }
.markdown-body :deep(li) { margin: 4px 0; }
.markdown-body :deep(li > p) { margin-bottom: 6px; }
.markdown-body :deep(a) { color: #409eff; text-decoration: none; border-bottom: 1px solid rgba(64, 158, 255, 0.3); }
.markdown-body :deep(a:hover) { border-bottom-color: #409eff; }
.markdown-body :deep(strong) { font-weight: 650; }
.markdown-body :deep(hr) { border: 0; border-top: 1px solid rgba(28, 25, 23, 0.1); margin: 28px 0; }
.markdown-body :deep(code) {
  background: rgba(28, 25, 23, 0.06); padding: 2px 6px; border-radius: 4px; font-size: 0.875em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.markdown-body :deep(.code-block) { margin: 0 0 18px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(28, 25, 23, 0.08); background: #f6f8fa; }
.markdown-body :deep(.code-bar) { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; font-size: 12px; color: rgba(28, 25, 23, 0.5); background: rgba(28, 25, 23, 0.03); border-bottom: 1px solid rgba(28, 25, 23, 0.06); }
.markdown-body :deep(.code-lang) { font-family: ui-monospace, Menlo, monospace; text-transform: lowercase; }
.markdown-body :deep(.code-copy) { border: 0; background: transparent; color: rgba(28, 25, 23, 0.55); cursor: pointer; font-size: 12px; padding: 2px 6px; border-radius: 4px; }
.markdown-body :deep(.code-copy:hover) { background: rgba(28, 25, 23, 0.06); color: #1c1917; }
.markdown-body :deep(pre) { margin: 0; padding: 14px 16px; overflow-x: auto; background: transparent; font-size: 13.5px; line-height: 1.65; }
.markdown-body :deep(pre code) { background: none; padding: 0; font-size: inherit; }
.markdown-body :deep(blockquote) {
  border-left: 4px solid rgba(64, 158, 255, 0.55); background: rgba(64, 158, 255, 0.05);
  padding: 10px 16px; margin: 0 0 16px; color: rgba(28, 25, 23, 0.72); border-radius: 0 6px 6px 0;
}
.markdown-body :deep(blockquote p:last-child) { margin-bottom: 0; }
.markdown-body :deep(.table-wrap) { overflow-x: auto; margin: 0 0 18px; border: 1px solid rgba(28, 25, 23, 0.1); border-radius: 8px; }
.markdown-body :deep(table) { border-collapse: collapse; width: 100%; font-size: 14px; }
.markdown-body :deep(th), .markdown-body :deep(td) { border-bottom: 1px solid rgba(28, 25, 23, 0.08); padding: 9px 14px; text-align: left; vertical-align: top; }
.markdown-body :deep(th) { background: rgba(28, 25, 23, 0.03); font-weight: 600; white-space: nowrap; }
.markdown-body :deep(tr:last-child td) { border-bottom: 0; }
.markdown-body :deep(tbody tr:hover) { background: rgba(28, 25, 23, 0.02); }
.markdown-body :deep(img) { max-width: 100%; height: auto; display: block; margin: 8px auto 18px; border-radius: 8px; box-shadow: 0 1px 4px rgba(28, 25, 23, 0.12); }
.markdown-body :deep(input[type="checkbox"]) { margin-right: 6px; }

@media (max-width: 1100px) {
  .post-toc { display: none; }
}
@media (max-width: 768px) {
  .post-article { padding: 24px 18px; }
  .post-title { font-size: 24px; }
  .post-content { font-size: 15px; }
}
</style>
