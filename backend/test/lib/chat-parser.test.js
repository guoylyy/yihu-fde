// 单元测试 - v1.6.1 聊天记录规则解析器
// 用真实导出样式的样本钉住每个模式; 解析器改动导致格式识别回退时这里先红
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseChat } from '../../src/lib/chatParser.js'

describe('微信导出: 时间在前', () => {
  const sample = `2026-08-01 10:23:45 张三
下周能上线吗
这个比较急

2026-08-01 10:24:02 李四(我方)
可以的, 周三发版
2026-08-01 10:25:11 张三
好, 那就这么定`

  test('识别出 3 条消息', () => {
    const r = parseChat(sample)
    assert.equal(r.ok, true)
    assert.equal(r.pattern, 'wechat-time-first')
    assert.equal(r.messages.length, 3)
  })

  test('多行内容归并到同一条', () => {
    const r = parseChat(sample)
    assert.equal(r.messages[0].text, '下周能上线吗\n这个比较急')
  })

  test('说话人昵称带括号后缀不拆坏', () => {
    const r = parseChat(sample)
    assert.deepEqual(r.speakers, ['张三', '李四(我方)'])
  })

  test('occurredAt 取第一条完整时间', () => {
    const r = parseChat(sample)
    assert.equal(r.occurredAt.getFullYear(), 2026)
    assert.equal(r.occurredAt.getMonth(), 7)
    assert.equal(r.occurredAt.getDate(), 1)
  })

  test('markdown 含说话人加粗与时间', () => {
    const r = parseChat(sample)
    assert.ok(r.markdown.includes('**张三**'))
    assert.ok(r.markdown.includes('`2026-08-01 10:23:45`'))
  })
})

describe('微信/留痕风格: 说话人在前', () => {
  const sample = `张三 2026/08/01 10:23:45
需求文档发我一份
李四 2026/08/01 10:26:00
[文件] 需求文档v2.docx
张三 2026/08/01 10:26:30
收到`

  test('识别 3 条, 保留 [文件] 占位', () => {
    const r = parseChat(sample)
    assert.equal(r.ok, true)
    assert.equal(r.pattern, 'wechat-speaker-first')
    assert.equal(r.messages.length, 3)
    assert.equal(r.messages[1].text, '[文件] 需求文档v2.docx')
  })
})

describe('飞书复制: 短日期', () => {
  const sample = `王经理 08-11 09:15
本月账单什么时候出
财务小刘 08-11 09:20
今天下班前发您
王经理 08-11 09:21
好的谢谢`

  test('识别 3 条', () => {
    const r = parseChat(sample)
    assert.equal(r.ok, true)
    assert.equal(r.messages.length, 3)
    assert.equal(r.messages[0].speaker, '王经理')
  })

  test('无完整日期时 occurredAt 为 null(由前端默认当前)', () => {
    const r = parseChat(sample)
    assert.equal(r.occurredAt, null)
  })
})

describe('飞书三行式', () => {
  const sample = `张三
2026-08-11 10:00:00
系统今天有点慢

运维值班
2026-08-11 10:02:12
在查了, 数据库连接池满了
已经扩容, 观察中`

  test('识别 2 条, 内容多行归并', () => {
    const r = parseChat(sample)
    assert.equal(r.ok, true)
    assert.equal(r.pattern, 'three-line')
    assert.equal(r.messages.length, 2)
    assert.ok(r.messages[1].text.includes('已经扩容'))
  })
})

describe('冒号誊抄风格', () => {
  const sample = `客户: 验收报告什么时候能给
我方: 周五前
客户: 行, 记得带上测试数据
我方: 没问题`

  test('识别 4 条, 内容在同一行', () => {
    const r = parseChat(sample)
    assert.equal(r.ok, true)
    assert.equal(r.pattern, 'colon-style')
    assert.equal(r.messages.length, 4)
    assert.equal(r.messages[0].text, '验收报告什么时候能给')
  })
})

describe('降级纯文本', () => {
  test('认不出格式时 ok=false 且 markdown=原文', () => {
    const sample = '这是一段随手记的内容\n没有任何聊天格式\n就是普通备忘'
    const r = parseChat(sample)
    assert.equal(r.ok, false)
    assert.equal(r.markdown, sample)
  })

  test('空输入不崩', () => {
    const r = parseChat('')
    assert.equal(r.ok, false)
    assert.equal(r.markdown, '')
  })

  test('普通文章不会被冒号模式误伤(说话人种类爆炸守卫)', () => {
    const sample = `会议纪要: 本次讨论了三个议题
议题一: 上线时间定在周三
议题二: 验收流程走线上
议题三: 账单月底出
备注: 以上需要客户确认
结论: 周五前回复
附件: 无
记录人: 张三`
    const r = parseChat(sample)
    // 每行"说话人"都不同 → 不该当成聊天记录
    assert.equal(r.ok, false)
  })
})
