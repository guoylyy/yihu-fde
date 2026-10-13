// v2.10.0(#1180) 创意中心 —— 给大模型的文本拼装 / AI 总结渲染 / 出处标记(纯函数, 不碰库)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderIdeaForLlm, renderSummaryMarkdown, ideaSourceLine, IDEA_SUMMARY_SYSTEM_PROMPT, IDEA_MILESTONE_SYSTEM_PROMPT } from '../../src/services/ideas.js'

const idea = { id: 7n, title: '给客户做一个进度看板', content: '客户总在问做到哪了。\n\n做个只读看板。' }

test('想法与讨论拼成一段文本: 带标题、正文、按人署名的讨论', () => {
  const text = renderIdeaForLlm(idea, [
    { authorId: 1n, content: '赞成\n先做只读' },
    { authorId: 2n, content: '数据从哪来？' }
  ], new Map([['1', '张工'], ['2', '李工']]))
  assert.match(text, /# 想法：给客户做一个进度看板/)
  assert.match(text, /做个只读看板/)
  assert.match(text, /- 张工：赞成 先做只读/)   // 评论内换行压成一行
  assert.match(text, /- 李工：数据从哪来？/)
})

test('没有讨论时不出现讨论小节; 作者查不到时用「同事」兜底', () => {
  assert.doesNotMatch(renderIdeaForLlm(idea), /## 讨论/)
  assert.match(renderIdeaForLlm(idea, [{ authorId: 9n, content: '好' }]), /- 同事：好/)
})

test('讨论超长只保留最近的部分, 并标明更早的已省略', () => {
  const comments = Array.from({ length: 400 }, (_, i) => ({ authorId: 1n, content: `第${i}条 ` + '很长的评论'.repeat(20) }))
  const text = renderIdeaForLlm(idea, comments)
  assert.match(text, /更早的讨论已省略/)
  assert.match(text, /第399条/)
  assert.doesNotMatch(text, /第0条 /)
  assert.ok(text.length < 13000)
})

test('AI 总结渲染成 Markdown: 空的小节不出现', () => {
  const md = renderSummaryMarkdown({
    summary: '大家认可先做只读看板。',
    consensus: ['先做只读'],
    disagreements: [],
    openQuestions: ['数据从哪来', '  '],
    nextStep: '找一个项目试点'
  })
  assert.match(md, /^大家认可先做只读看板。/)
  assert.match(md, /\*\*已有共识\*\*\n- 先做只读/)
  assert.doesNotMatch(md, /仍有分歧/)
  assert.match(md, /\*\*待回答\*\*\n- 数据从哪来\n\n/)
  assert.match(md, /\*\*建议下一步\*\*：找一个项目试点$/)
})

test('AI 没返回内容时渲染结果为空串(调用方据此报错, 不存空总结)', () => {
  assert.equal(renderSummaryMarkdown({}), '')
})

test('里程碑出处标记带想法编号与标题', () => {
  assert.equal(ideaSourceLine(idea), '—— 来源: 创意中心想法 #7「给客户做一个进度看板」')
})

test('两段提示词都要求只输出 JSON 且不得臆造', () => {
  for (const p of [IDEA_SUMMARY_SYSTEM_PROMPT, IDEA_MILESTONE_SYSTEM_PROMPT]) {
    assert.match(p, /只输出 JSON/)
    assert.match(p, /不要臆造/)
  }
})
