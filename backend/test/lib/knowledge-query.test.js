// 单元测试 - v2.5.5(#913) 知识库博客化: 列表筛选/摘要/标签字典
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildKnowledgeWhere, summarize, estimateReadMinutes, aggregateTags, toListItem, parseDateBound } from '../../src/lib/knowledgeQuery.js'

describe('lib/knowledgeQuery.js', () => {
  test('空 query 只带软删条件', () => {
    assert.deepEqual(buildKnowledgeWhere({}), { deletedAt: null })
  })

  test('keyword 命中标题/分类/标签 OR; category/project/author/tag 精确', () => {
    const w = buildKnowledgeWhere({ keyword: '部署', category: '运维', projectId: '64', author_id: '15', tag: '任务805' })
    assert.equal(w.OR.length, 3)
    assert.deepEqual(w.OR[0], { title: { contains: '部署' } })
    assert.deepEqual(w.OR[2], { tags: { array_contains: '部署' } })
    assert.equal(w.category, '运维')
    assert.equal(w.projectId, 64n)
    assert.equal(w.createdBy, 15n)
    assert.deepEqual(w.tags, { array_contains: '任务805' })
  })

  test('snake/camel 两种命名都收; 非数字 id 忽略', () => {
    assert.equal(buildKnowledgeWhere({ project_id: '64' }).projectId, 64n)
    assert.equal(buildKnowledgeWhere({ authorId: '15' }).createdBy, 15n)
    assert.equal(buildKnowledgeWhere({ author_id: 'abc' }).createdBy, undefined)
  })

  test('date_from/date_to → updatedAt 闭开区间(to 取次日 00:00)', () => {
    const w = buildKnowledgeWhere({ date_from: '2026-09-01', date_to: '2026-09-11' })
    assert.equal(w.updatedAt.gte.getTime(), new Date('2026-09-01T00:00:00').getTime())
    assert.equal(w.updatedAt.lt.getTime(), new Date('2026-09-12T00:00:00').getTime())
    assert.equal(buildKnowledgeWhere({ date_from: '2026/09/01' }).updatedAt, undefined)
    assert.equal(parseDateBound('bad'), null)
  })

  test('summarize: 去 markdown 符号/代码块/链接/表格线并截断', () => {
    const md = '# 标题\n\n> 引用 **加粗** [链接](http://x) ![img](a.png)\n\n```js\nconst x = 1\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n- 列表项'
    const s = summarize(md)
    assert.ok(!s.includes('#') && !s.includes('**') && !s.includes('const x'))
    assert.ok(s.includes('链接') && !s.includes('http://x'))
    assert.ok(!s.includes('---') && !s.includes('|'))
    assert.equal(summarize('a'.repeat(200), 50).length, 51)
    assert.equal(summarize(''), '')
  })

  test('estimateReadMinutes: 最少 1 分钟, 中文按字计', () => {
    assert.equal(estimateReadMinutes(''), 1)
    assert.equal(estimateReadMinutes('中'.repeat(1200)), 3)
  })

  test('aggregateTags: 数组/JSON 字串都收, 按计数倒序', () => {
    const list = aggregateTags([
      { tags: ['a', 'b'] }, { tags: '["a","c"]' }, { tags: null }, { tags: ['a', ' ', 'b'] }
    ])
    assert.deepEqual(list, [{ name: 'a', count: 3 }, { name: 'b', count: 2 }, { name: 'c', count: 1 }])
  })

  test('toListItem: 默认去正文附 summary/readMinutes; keepContent 保留', () => {
    const a = { id: 1n, title: 't', content: '## 正文\n内容' }
    const item = toListItem(a)
    assert.equal(item.content, undefined)
    assert.equal(item.summary, '正文 内容')
    assert.equal(item.readMinutes, 1)
    assert.equal(toListItem(a, { keepContent: true }).content, a.content)
  })
})
