<template>
  <div class="docs-page">
    <PlainHeader />

    <div class="docs-body">
      <div class="container docs-layout">
        <!-- 目录 -->
        <aside class="docs-nav">
          <div class="docs-nav-title">{{ $t('docsView.user_guide') }}</div>
          <div v-for="g in DOC_GROUPS" :key="g.title" class="docs-group">
            <div class="docs-group-title">{{ g.title }}</div>
            <router-link v-for="d in g.docs" :key="d.slug"
                         :to="`/docs/${d.slug}`"
                         :class="['docs-link', { active: d.slug === slug }]">
              {{ d.title }}
            </router-link>
          </div>
        </aside>

        <!-- 正文 -->
        <main class="docs-main">
          <template v-if="doc">
            <div class="doc-desc">{{ doc.desc }}</div>
            <article class="md-doc" v-html="html"></article>
          </template>
          <div v-else class="doc-missing">
            <h2>{{ $t('docsView.document_not_found') }}</h2>
            <p>{{ $t('docsView.pick_document_from_menu_on_left') }}</p>
          </div>
        </main>
      </div>
    </div>

  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, computed, watch } from 'vue'
import { getBrand } from '@/api/edition.js'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'
import PlainHeader from '@/components/common/PlainHeader.vue'
import { DOC_GROUPS, DEFAULT_SLUG, findDoc } from '@/docs/manifest.js'

const route = useRoute()
const router = useRouter()

const slug = computed(() => route.params.slug || DEFAULT_SLUG)
const doc = computed(() => findDoc(slug.value))
const html = ref('')

watch(slug, load, { immediate: true })

async function load() {
  if (!doc.value) {
    // 直达了不存在的 slug: 回默认文档
    if (route.params.slug && DEFAULT_SLUG) router.replace(`/docs/${DEFAULT_SLUG}`)
    return
  }
  html.value = ''
  try {
    const raw = (await doc.value.load()).default
    html.value = marked.parse(raw)
  } catch {
    // 常见于刚发完新版: 浏览器还拿着旧页面, 按旧哈希请求分包 404
    html.value = $t('docsView.blockquote_failed_load_document_new_version')
  }
  document.title = `${doc.value.title} - ${getBrand().name}`
}
</script>

<style scoped>
.docs-page { background: var(--bg, #faf9f7); min-height: 100vh; display: flex; flex-direction: column; }
.docs-body { flex: 1; padding: 40px 0 64px; }
.container { max-width: 1160px; margin: 0 auto; padding: 0 24px; }
.docs-layout { display: flex; gap: 40px; align-items: flex-start; }

/* 目录 */
.docs-nav { width: 220px; flex-shrink: 0; position: sticky; top: 88px; }
.docs-nav-title { font-size: 18px; font-weight: 800; color: #1c1917; margin-bottom: 16px; }
.docs-group-title { font-size: 12px; color: #8f8a82; text-transform: uppercase; letter-spacing: 0.06em; margin: 14px 0 6px; }
.docs-link { display: block; padding: 7px 10px; border-radius: 8px; font-size: 14px; color: #5c574f; text-decoration: none; }
.docs-link:hover { background: #f0eee9; color: #1c1917; }
.docs-link.active { background: #1c1917; color: #fff; font-weight: 600; }

/* 正文 */
.docs-main { flex: 1; min-width: 0; background: #fff; border: 1px solid #eae7e2; border-radius: 14px; padding: 36px 44px 48px; }
.doc-desc { font-size: 13px; color: #8f8a82; border-bottom: 1px solid #f0eee9; padding-bottom: 14px; margin-bottom: 6px; }
.doc-missing { text-align: center; color: #8f8a82; padding: 60px 0; }

/* Markdown 排版: 常规 API 文档风 */
.md-doc { line-height: 1.75; color: #33302b; font-size: 14.5px; }
.md-doc :deep(h1) { font-size: 26px; margin: 18px 0 10px; color: #1c1917; }
.md-doc :deep(h2) { font-size: 19px; margin: 30px 0 10px; padding-top: 14px; border-top: 1px solid #f0eee9; color: #1c1917; }
.md-doc :deep(h3) { font-size: 16px; margin: 22px 0 8px; color: #1c1917; }
.md-doc :deep(p) { margin: 8px 0; }
.md-doc :deep(ul), .md-doc :deep(ol) { padding-left: 22px; margin: 8px 0; }
.md-doc :deep(li) { margin: 4px 0; }
.md-doc :deep(code) { background: #f0eee9; padding: 1px 6px; border-radius: 4px; font-size: 13px; font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
.md-doc :deep(pre) { background: #1c1917; color: #f5f3ef; border-radius: 10px; padding: 14px 18px; overflow-x: auto; margin: 12px 0; }
.md-doc :deep(pre code) { background: none; color: inherit; padding: 0; font-size: 13px; }
.md-doc :deep(table) { border-collapse: collapse; width: 100%; margin: 12px 0; display: block; overflow-x: auto; }
.md-doc :deep(th), .md-doc :deep(td) { border: 1px solid #eae7e2; padding: 8px 12px; text-align: left; vertical-align: top; }
.md-doc :deep(th) { background: #faf9f7; font-weight: 700; white-space: nowrap; }
.md-doc :deep(blockquote) { border-left: 3px solid #d2521e; background: #faf9f7; margin: 12px 0; padding: 8px 14px; border-radius: 0 8px 8px 0; color: #5c574f; }
.md-doc :deep(a) { color: #d2521e; }
.md-doc :deep(strong) { color: #1c1917; }

@media (max-width: 860px) {
  .docs-layout { flex-direction: column; }
  .docs-nav { position: static; width: 100%; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
  .docs-nav-title { width: 100%; margin-bottom: 4px; }
  .docs-group { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; }
  .docs-main { padding: 22px 18px 32px; }
}
</style>
