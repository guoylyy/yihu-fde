// v2.10.0(#1180) 创意中心前端小工具
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { plainExcerpt, renderComment, isImage, threadComments } from '../../src/components/admin/ideas/ideaUtils.js'

describe('plainExcerpt 列表摘要', () => {
  test('去掉标题/列表/强调符号、图片和代码块, 链接只留文字', () => {
    const md = '# 背景\n\n- **客户**总在问 [进度](https://x.y)\n![图](a.png)\n```js\nconst a = 1\n```\n> 做个`看板`'
    assert.equal(plainExcerpt(md), '背景 客户总在问 进度 做个看板')
  })
  test('超长截断加省略号', () => {
    const out = plainExcerpt('字'.repeat(300), 160)
    assert.equal(out.length, 161)
    assert.ok(out.endsWith('…'))
  })
})

describe('renderComment 评论渲染', () => {
  test('HTML 被转义, 脚本进不来', () => {
    const html = renderComment('<img src=x onerror=alert(1)><script>1</script>')
    assert.ok(!html.includes('<img'))
    assert.ok(!html.includes('<script'))
    assert.ok(html.includes('&lt;img'))
  })
  test('@提及高亮, 换行保留', () => {
    assert.equal(renderComment('@张工 看下\n谢谢'), '<span class="at-mention">@张工</span> 看下<br>谢谢')
  })
})

describe('isImage', () => {
  test('按扩展名识别图片(带查询串也行)', () => {
    assert.equal(isImage({ fileUrl: 'https://c.d/a.PNG?x=1' }), true)
    assert.equal(isImage({ fileUrl: 'https://c.d/a.pdf' }), false)
  })
})

describe('threadComments 两层讨论', () => {
  test('回复挂到对应的顶层评论下, 顶层按时间正序', () => {
    const out = threadComments([
      { id: 2, parentId: null, createdAt: '2026-10-02T02:00:00Z' },
      { id: 1, parentId: null, createdAt: '2026-10-02T01:00:00Z' },
      { id: 3, parentId: 1, createdAt: '2026-10-02T03:00:00Z' }
    ])
    assert.deepEqual(out.map(c => c.id), [1, 2])
    assert.deepEqual(out[0].replies.map(r => r.id), [3])
  })
  test('楼主那条被删了的回复升为顶层, 不丢', () => {
    const out = threadComments([{ id: 5, parentId: 99, createdAt: '2026-10-02T01:00:00Z' }])
    assert.equal(out.length, 1)
    assert.equal(out[0].id, 5)
  })
})
