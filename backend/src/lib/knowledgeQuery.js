// v2.5.5(#913) 知识库博客化: 列表筛选与摘要的纯函数, 供 routes/fde/knowledge.js 与单测共用
// 口径: 不改 knowledge_articles 表结构, 博客列表所需的作者/标签/时间筛选与摘要全部由现有字段派生

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function pickFirst(query, ...names) {
  for (const n of names) {
    const v = query[n]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/** YYYY-MM-DD → Date(当天 00:00 本地); endOfDay=true 时取次日 00:00 作为开区间上界 */
export function parseDateBound(v, endOfDay = false) {
  if (!v || !DATE_RE.test(v)) return null
  const d = new Date(`${v}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  if (endOfDay) d.setDate(d.getDate() + 1)
  return d
}

/**
 * 从 req.query 构造 prisma where。
 * 支持: keyword(标题/标签/分类模糊) / category / project_id|projectId / author_id|authorId / tag / date_from / date_to
 * date_* 作用于 updatedAt(列表按更新时间倒序, 「最近更新」是博客的时间语义)
 */
export function buildKnowledgeWhere(query = {}) {
  const where = { deletedAt: null }
  const keyword = pickFirst(query, 'keyword', 'q')
  const category = pickFirst(query, 'category')
  const projectId = pickFirst(query, 'project_id', 'projectId')
  const authorId = pickFirst(query, 'author_id', 'authorId')
  const tag = pickFirst(query, 'tag')
  const dateFrom = parseDateBound(pickFirst(query, 'date_from', 'dateFrom'))
  const dateTo = parseDateBound(pickFirst(query, 'date_to', 'dateTo'), true)

  if (keyword) {
    // 博客搜索: 标题为主, 顺带命中分类与标签(JSON 字串包含); 不做正文全文检索(LongText 无索引)
    where.OR = [
      { title: { contains: keyword } },
      { category: { contains: keyword } },
      { tags: { array_contains: keyword } }
    ]
  }
  if (category) where.category = category
  if (projectId && /^\d+$/.test(projectId)) where.projectId = BigInt(projectId)
  if (authorId && /^\d+$/.test(authorId)) where.createdBy = BigInt(authorId)
  if (tag) where.tags = { array_contains: tag }
  if (dateFrom || dateTo) {
    where.updatedAt = {}
    if (dateFrom) where.updatedAt.gte = dateFrom
    if (dateTo) where.updatedAt.lt = dateTo
  }
  return where
}

/** Markdown → 纯文本摘要(列表卡片用); 去标题符/代码块/链接/图片/表格分隔线 */
export function summarize(md, max = 160) {
  if (!md) return ''
  let text = String(md)
    .replace(/```[\s\S]*?```/g, ' ')            // 代码块整体去掉
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')       // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // 链接保留文字
    .replace(/^\s{0,3}(#{1,6})\s+/gm, '')        // 标题井号
    .replace(/^\s*>\s?/gm, '')                   // 引用
    .replace(/^\s*[-*+]\s+/gm, '')               // 列表符
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, ' ') // 表格分隔线
    .replace(/\|/g, ' ')
    .replace(/[*_~`]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > max) text = text.slice(0, max).trimEnd() + '…'
  return text
}

/** 估算阅读时长(分钟): 中文按字、英文按词, 400 字/分 */
export function estimateReadMinutes(md) {
  if (!md) return 1
  const text = String(md)
  const cjk = (text.match(/[一-鿿]/g) || []).length
  const words = (text.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length
  return Math.max(1, Math.round((cjk + words * 1.5) / 400))
}

/** 标签字典: 从多篇文章的 tags(JSON 数组/字串) 汇总计数, 按数量倒序 */
export function aggregateTags(rows) {
  const counter = new Map()
  for (const r of rows || []) {
    let tags = r?.tags
    if (typeof tags === 'string') { try { tags = JSON.parse(tags) } catch { tags = [] } }
    if (!Array.isArray(tags)) continue
    for (const t of tags) {
      const name = String(t || '').trim()
      if (!name) continue
      counter.set(name, (counter.get(name) || 0) + 1)
    }
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

/** 列表项装配: 附 summary/readMinutes, 去掉正文以减小列表体积(详情接口仍返回全文) */
export function toListItem(article, { keepContent = false } = {}) {
  const { content, ...rest } = article
  return {
    ...rest,
    ...(keepContent ? { content } : {}),
    summary: summarize(content),
    readMinutes: estimateReadMinutes(content)
  }
}
