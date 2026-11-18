// 单元测试 - 0.5.0 第 2 轮纯函数: 粘贴解析 / 规则抽取 / 阶段建议 / 经验草稿 / Obsidian 渲染与文件名
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parsePaste, pasteUid, pasteTitle } from '../../src/services/devlog/paste.js'
import { ruleExtract, suggestStage, sentencesOf, detectCommits } from '../../src/services/devlog/summarize.js'
import { draftFromSummary, guessKind, draftTitle } from '../../src/services/devlog/experience.js'
import { renderExperience, safeName, yamlScalar, cstDate, cstIso } from '../../src/services/obsidian.js'

describe('粘贴解析', () => {
  test('识别 用户:/助手:/Human:/Assistant: 分块, 多行内容归到上一块', () => {
    const { messages, marked } = parsePaste('前言一句\n用户：日期解析报错了\n第二行\n助手: 原因是时区\nHuman: 那怎么改\nAssistant：改成 LocalDate')
    assert.equal(marked, true)
    assert.deepEqual(messages, [
      { role: 'user', content: '前言一句' },
      { role: 'user', content: '日期解析报错了\n第二行' },
      { role: 'assistant', content: '原因是时区' },
      { role: 'user', content: '那怎么改' },
      { role: 'assistant', content: '改成 LocalDate' }
    ])
    assert.equal(pasteTitle(messages), '前言一句')
  })
  test('没有角色标记 → 整段一条 user 消息', () => {
    const { messages, marked } = parsePaste('就一段话\n两行')
    assert.equal(marked, false)
    assert.deepEqual(messages, [{ role: 'user', content: '就一段话\n两行' }])
  })
  test('uid = paste_ + sha256 前 24 位; 换行风格/首尾空白不影响', () => {
    const a = pasteUid('用户: a\n助手: b')
    assert.match(a, /^paste_[0-9a-f]{24}$/)
    assert.equal(pasteUid('\n用户: a\r\n助手: b\n\n'), a)
    assert.notEqual(pasteUid('用户: a\n助手: c'), a)
  })
})

describe('规则抽取', () => {
  const conv = {
    title: 't',
    body: [
      { role: 'user', content: '华丰的日期解析报错了，帮我看下 src/main/DateUtil.java。用例也挂了' },
      { role: 'assistant', content: '报错原因是 SimpleDateFormat 线程不安全。\n决定改成 java.time 的 DateTimeFormatter，因为它不可变。\n- 结论：所有解析走 DateUtil.parse。' },
      { role: 'user', content: '好，提交吧' },
      { role: 'assistant', content: '已提交 commit 1a2b3c4d，测试 12 个用例全过。踩坑：Jackson 默认时区是 UTC。' }
    ]
  }
  test('摘要/决策/坑/产出/标签/阶段', () => {
    const r = ruleExtract(conv, [{ kind: 'DECISION', text: '上报按 uid 幂等' }])
    assert.match(r.summary, /^1\. 华丰的日期解析报错了/)
    assert.match(r.summary, /2\. 好，提交吧/)
    assert.deepEqual(r.decisions, ['上报按 uid 幂等', '决定改成 java.time 的 DateTimeFormatter，因为它不可变。', '结论：所有解析走 DateUtil.parse。'])
    assert.deepEqual(r.pitfalls, ['报错原因是 SimpleDateFormat 线程不安全。', '踩坑：Jackson 默认时区是 UTC。'])
    assert.ok(r.artifacts.includes('src/main/DateUtil.java'), r.artifacts.join(','))
    assert.ok(r.artifacts.includes('commit 1a2b3c4d'))
    assert.deepEqual(r.tags, ['java'])
    assert.equal(r.stageSuggestion, 'TEST', '报错×2 + 测试 + 用例×2 明显多于 提交×2')
  })
  test('阶段建议只在明显时给', () => {
    assert.equal(suggestStage(['先对一下需求口径，范围别扩大']), 'REQUIREMENT')
    assert.equal(suggestStage(['看下 diff，然后编译一下再提交']), 'CODING')
    assert.equal(suggestStage(['需求有点变化，测试也要补']), null, '各 1 次不算明显')
    assert.equal(suggestStage(['随便聊聊']), null)
  })
  test('切句去掉列表符号; commit 识别', () => {
    assert.deepEqual(sentencesOf('- 决定用 A。\n1. 结论：B'), ['决定用 A。', '结论：B'])
    assert.deepEqual(detectCommits(['发布了 v0.4.2(25cbcc8)', 'commit ABCDEF1234']), ['25cbcc8', 'abcdef1234'])
  })
})

describe('经验草稿', () => {
  test('标题=摘要首句去编号, 正文=决策+坑+产出, kind 按内容', () => {
    const d = draftFromSummary({ summary: '1. 日期解析报错了。\n2. 其它', decisions: [], pitfalls: ['时区坑'], artifacts: ['src/a.js', 'commit abc1234'], tags: ['java'] }, { title: '会话' })
    assert.equal(d.title, '日期解析报错了')
    assert.equal(d.kind, 'PITFALL')
    assert.equal(d.body, '## 踩坑\n\n- 时区坑\n\n## 产出\n\n- `src/a.js`\n- `commit abc1234`')
    assert.deepEqual(d.tags, ['java'])
    assert.equal(guessKind({ decisions: ['x'], pitfalls: [] }), 'DECISION')
    assert.equal(guessKind({ decisions: ['x'], pitfalls: ['y'] }), 'EXPERIENCE')
    assert.equal(guessKind({ summary: '记录如何部署', decisions: [], pitfalls: [] }), 'HOWTO')
    assert.equal(draftTitle('', '会话标题'), '会话标题')
    assert.equal(draftFromSummary({ summary: '只有摘要', decisions: [], pitfalls: [], artifacts: [] }).body, '只有摘要')
  })
})

describe('Obsidian 渲染', () => {
  test('文件名去特殊字符、空白变连字符、截 60 字', () => {
    assert.equal(safeName('a/b:c*d?"e"<f>|g#h^[i] j  k', 60, { dashSpaces: true }), 'abcdefghi-j-k')
    assert.equal([...safeName('长'.repeat(100), 60)].length, 60)
    assert.equal(safeName('...隐藏'), '隐藏')
  })
  test('时间按 UTC+8', () => {
    assert.equal(cstDate('2026-11-17T17:00:00Z'), '2026-11-18')
    assert.equal(cstIso('2026-11-18T02:00:00Z'), '2026-11-18T10:00:00+08:00')
  })
  test('YAML 标量: 普通词不加引号, 特殊值加引号', () => {
    assert.equal(yamlScalar('spring-boot'), 'spring-boot')
    assert.equal(yamlScalar('日期解析'), '日期解析')
    assert.equal(yamlScalar('a: b'), '"a: b"')
    assert.equal(yamlScalar('true'), '"true"')
    assert.equal(yamlScalar('123'), '"123"')
  })
  test('frontmatter 字段齐全 + 来源段', () => {
    const md = renderExperience(
      { id: 123n, kind: 'PITFALL', title: '日期解析的坑', body: '正文', conversationId: 45n, tags: ['spring-boot', '日期解析'], reusableLevel: 2, createdAt: new Date('2026-11-18T02:00:00Z') },
      { project: { name: '华丰一体化' }, conversation: { id: 45n, title: '修日期', source: 'CLAUDE_CODE', stage: 'CODING', startedAt: new Date('2026-11-18T01:30:00Z') } }
    )
    assert.equal(md, [
      '---', 'fde_id: 123', 'kind: PITFALL', 'project: 华丰一体化', 'conversation_id: 45', 'tags: [spring-boot, 日期解析]',
      'reusable_level: 2', 'created_at: 2026-11-18T10:00:00+08:00', '---', '', '# 日期解析的坑', '', '正文', '', '## 来源',
      '- 会话：修日期（Claude Code / 编码 / 2026-11-18 09:30）', '- 项目：华丰一体化', ''
    ].join('\n'))
    const bare = renderExperience({ id: 1n, kind: 'EXPERIENCE', title: 't', body: 'b', conversationId: null, tags: null, reusableLevel: 1, createdAt: new Date() })
    assert.match(bare, /project: null\nconversation_id: null\ntags: \[\]/)
    assert.match(bare, /- 项目：未归类/)
  })
})
