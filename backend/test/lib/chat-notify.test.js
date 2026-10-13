// 单元测试 - lib/chatNotify.js 全局群通知: 配置解析 + 消息组装 + 未配置/Mock 降级
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { resolveChatBot, buildChatMessage, notifyChat } from '../../src/lib/chatNotify.js'

const SAVED = { ...process.env }
afterEach(() => {
  for (const k of ['CHAT_WEBHOOK_URL', 'CHAT_WEBHOOK_CHANNEL', 'CHAT_WEBHOOK_SECRET', 'FEISHU_NOTIFY_ENABLED', 'FEISHU_WEBHOOK_URL', 'FEISHU_SECRET', 'MOCK_MODE']) {
    if (k in SAVED) process.env[k] = SAVED[k]; else delete process.env[k]
  }
})

describe('resolveChatBot 配置解析', () => {
  test('什么都不配 = 关闭', () => {
    assert.equal(resolveChatBot({}), null)
  })
  test('只配 URL 时按域名猜渠道, 认不出当通用 Webhook', () => {
    assert.equal(resolveChatBot({ CHAT_WEBHOOK_URL: 'https://hooks.slack.com/services/x' }).channel, 'SLACK')
    assert.equal(resolveChatBot({ CHAT_WEBHOOK_URL: 'https://oapi.dingtalk.com/robot/send?access_token=x' }).channel, 'DINGTALK')
    assert.equal(resolveChatBot({ CHAT_WEBHOOK_URL: 'https://example.com/hook' }).channel, 'WEBHOOK')
  })
  test('显式渠道优先, 密钥透传', () => {
    const bot = resolveChatBot({ CHAT_WEBHOOK_URL: 'https://example.com/hook', CHAT_WEBHOOK_CHANNEL: 'feishu', CHAT_WEBHOOK_SECRET: 's' })
    assert.deepEqual(bot, { channel: 'FEISHU', url: 'https://example.com/hook', secret: 's' })
  })
  test('兼容旧 FEISHU_* 配置, 但仍要 FEISHU_NOTIFY_ENABLED=true', () => {
    assert.equal(resolveChatBot({ FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/x' }), null)
    const bot = resolveChatBot({ FEISHU_NOTIFY_ENABLED: 'true', FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/x', FEISHU_SECRET: 's' })
    assert.deepEqual(bot, { channel: 'FEISHU', url: 'https://open.feishu.cn/x', secret: 's' })
  })
})

describe('buildChatMessage 消息组装', () => {
  test('已知事件: 标题 + 字段行, 空值显示 -', () => {
    const m = buildChatMessage('task.assigned', { title: 'T', project: 'P' })
    assert.equal(m.title, '📝 新工单')
    assert.deepEqual(m.lines, ['**标题**：T', '**项目**：P', '**截止**：-'])
    assert.equal(m.level, 'info')
  })
  test('故障告警走 danger, 恢复走 success', () => {
    assert.equal(buildChatMessage('ops.incident_open', {}).level, 'danger')
    assert.equal(buildChatMessage('ops.incident_resolved', {}).level, 'success')
  })
  test('新成员加入的群消息不带密码', () => {
    const m = buildChatMessage('user.invited', { name: 'N', username: 'u', role: 'ADMIN', defaultPassword: 'secret' })
    assert.ok(!m.lines.join('\n').includes('secret'))
  })
  test('未登记事件不崩, 用事件名当标题', () => {
    assert.deepEqual(buildChatMessage('nonexistent.event'), { title: 'nonexistent.event', lines: [], level: 'info', link: null })
  })
})

describe('notifyChat 降级', () => {
  test('未配置返回 disabled, 不抛错', async () => {
    delete process.env.CHAT_WEBHOOK_URL
    delete process.env.FEISHU_NOTIFY_ENABLED
    assert.deepEqual(await notifyChat({ event: 'task.assigned', data: {} }), { success: false, disabled: true })
  })
  test('MOCK_MODE 只打日志不发请求', async () => {
    process.env.CHAT_WEBHOOK_URL = 'https://hooks.slack.com/services/x'
    process.env.MOCK_MODE = 'true'
    assert.deepEqual(await notifyChat({ event: 'task.assigned', data: { title: 'T' } }), { success: true, mock: true })
  })
})
