// 单元测试 - v2.7(#1139) 群机器人发送层
// 覆盖: 三家加签算法(对照官方文档算法独立实现) / 消息体结构 / 域名白名单 /
//       本地假机器人服务验证 errcode≠0 判失败、超时判失败、@ 人补发
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import {
  feishuSign, dingtalkSign, buildBotRequests, sendBotMessage, validateBotUrl
} from '../../src/lib/webhookBot.js'

const msg = { title: '🔴 服务不可用', lines: ['**项目**：演示', '**环境**：生产'], level: 'danger', link: 'https://x.test/admin/projects/1?tab=ops' }

describe('加签算法', () => {
  test('飞书: HmacSHA256(key=`ts\\nsecret`, msg="") → base64', () => {
    const expected = crypto.createHmac('sha256', '1700000000\nabc').update(Buffer.alloc(0)).digest('base64')
    assert.equal(feishuSign('abc', 1700000000), expected)
  })
  test('钉钉: HmacSHA256(key=secret, msg=`ts\\nsecret`) → base64', () => {
    const expected = crypto.createHmac('sha256', 'SECabc').update('1700000000000\nSECabc', 'utf8').digest('base64')
    assert.equal(dingtalkSign('SECabc', 1700000000000), expected)
  })
})

describe('消息体', () => {
  const now = 1700000000123

  test('飞书: interactive 卡片, 红色头, 秒级 timestamp + sign 放 body, @所有人', () => {
    const [r] = buildBotRequests({ channel: 'FEISHU', url: 'https://open.feishu.cn/hook/x', secret: 's', mentionAll: true }, msg, now)
    assert.equal(r.url, 'https://open.feishu.cn/hook/x')
    assert.equal(r.body.msg_type, 'interactive')
    assert.equal(r.body.card.header.template, 'red')
    assert.equal(r.body.timestamp, '1700000000')
    assert.equal(r.body.sign, feishuSign('s', 1700000000))
    assert.match(r.body.card.elements[0].text.content, /<at id=all><\/at>/)
    assert.equal(r.body.card.elements[1].actions[0].url, msg.link)
  })

  test('飞书: 无密钥不带 sign 字段', () => {
    const [r] = buildBotRequests({ channel: 'FEISHU', url: 'https://open.feishu.cn/hook/x' }, msg, now)
    assert.equal(r.body.sign, undefined)
  })

  test('钉钉: markdown, 毫秒 timestamp + urlencode sign 拼 URL, atMobiles 出现在正文', () => {
    const [r] = buildBotRequests({ channel: 'DINGTALK', url: 'https://oapi.dingtalk.com/robot/send?access_token=t', secret: 'SEC1', mentionMobiles: ['13800000000'] }, msg, now)
    const u = new URL(r.url)
    assert.equal(u.searchParams.get('access_token'), 't')
    assert.equal(u.searchParams.get('timestamp'), String(now))
    assert.equal(u.searchParams.get('sign'), dingtalkSign('SEC1', now))   // searchParams 已解码
    assert.equal(r.body.msgtype, 'markdown')
    assert.deepEqual(r.body.at.atMobiles, ['13800000000'])
    assert.match(r.body.markdown.text, /@13800000000/)
  })

  test('企微: markdown 一条; 需要 @ 时补一条 text 带 mentioned_mobile_list', () => {
    const plain = buildBotRequests({ channel: 'WECOM', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' }, msg, now)
    assert.equal(plain.length, 1)
    assert.equal(plain[0].body.msgtype, 'markdown')
    const withAt = buildBotRequests({ channel: 'WECOM', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k', mentionAll: true, mentionMobiles: ['13900000000'] }, msg, now)
    assert.equal(withAt.length, 2)
    assert.deepEqual(withAt[1].body.text.mentioned_mobile_list, ['@all', '13900000000'])
  })
})

describe('Slack 与通用 Webhook 消息体', () => {
  const msg = { title: '标题', lines: ['**项目**：P'], level: 'danger', link: 'https://x.test/p/1' }
  test('Slack: **粗体** 转 *粗体*, 链接 <url|text>, @所有人 <!channel>', () => {
    const [r] = buildBotRequests({ channel: 'SLACK', url: 'https://hooks.slack.com/services/x', mentionAll: true }, msg)
    assert.equal(r.body.text, '*标题*\n*项目*：P\n<https://x.test/p/1|查看详情>\n<!channel>')
  })
  test('通用 Webhook: 结构化字段 + 纯文本', () => {
    const [r] = buildBotRequests({ channel: 'WEBHOOK', url: 'https://example.com/hook' }, msg)
    assert.deepEqual(r.body, { title: '标题', level: 'danger', lines: ['**项目**：P'], link: 'https://x.test/p/1', text: '标题\n**项目**：P\nhttps://x.test/p/1' })
  })
})

describe('域名白名单', () => {
  test('合法地址通过', () => {
    assert.equal(validateBotUrl('FEISHU', 'https://open.feishu.cn/open-apis/bot/v2/hook/abc'), null)
    assert.equal(validateBotUrl('DINGTALK', 'https://oapi.dingtalk.com/robot/send?access_token=x'), null)
    assert.equal(validateBotUrl('WECOM', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x'), null)
    assert.equal(validateBotUrl('SLACK', 'https://hooks.slack.com/services/T/B/x'), null)
  })
  test('内网/错渠道/http 拒绝', () => {
    assert.ok(validateBotUrl('FEISHU', 'http://open.feishu.cn/x'))
    assert.ok(validateBotUrl('FEISHU', 'https://127.0.0.1/x'))
    assert.ok(validateBotUrl('WECOM', 'https://oapi.dingtalk.com/robot/send'))
    assert.ok(validateBotUrl('SLACK', 'https://example.com/x'))
    assert.ok(validateBotUrl('WEBHOOK', 'https://example.com/x'), '通用 Webhook 不对界面开放(SSRF)')
  })
})

describe('发送结果判定(本地假机器人)', () => {
  let server, base
  const received = []
  before(async () => {
    server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        received.push({ url: req.url, body: JSON.parse(raw || '{}') })
        if (req.url.startsWith('/slow')) return   // 不回, 触发超时
        res.setHeader('Content-Type', 'application/json')
        if (req.url.startsWith('/feishu-bad')) return res.end(JSON.stringify({ code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time' }))
        if (req.url.startsWith('/ding-bad')) return res.end(JSON.stringify({ errcode: 310000, errmsg: 'keywords not in content' }))
        if (req.url.startsWith('/feishu')) return res.end(JSON.stringify({ code: 0, msg: 'success' }))
        res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }))
      })
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => { server.closeAllConnections?.(); server.close() })

  test('code=0 / errcode=0 判成功', async () => {
    assert.deepEqual(await sendBotMessage({ channel: 'FEISHU', url: `${base}/feishu` }, msg), { ok: true })
    assert.deepEqual(await sendBotMessage({ channel: 'DINGTALK', url: `${base}/ding` }, msg), { ok: true })
  })

  test('HTTP 200 但 code/errcode≠0 判失败, 错误信息带回', async () => {
    const f = await sendBotMessage({ channel: 'FEISHU', url: `${base}/feishu-bad`, secret: 'x' }, msg)
    assert.equal(f.ok, false)
    assert.match(f.error, /19021/)
    const d = await sendBotMessage({ channel: 'DINGTALK', url: `${base}/ding-bad` }, msg)
    assert.equal(d.ok, false)
    assert.match(d.error, /keywords/)
  })

  test('企微带 @ 时两条都发出', async () => {
    const before = received.length
    const r = await sendBotMessage({ channel: 'WECOM', url: `${base}/wecom`, mentionMobiles: ['13900000000'] }, msg)
    assert.equal(r.ok, true)
    assert.equal(received.length - before, 2)
  })

  test('超时判失败且不抛错(含一次重试)', { timeout: 20000 }, async () => {
    const r = await sendBotMessage({ channel: 'WECOM', url: `${base}/slow` }, msg)
    assert.equal(r.ok, false)
    assert.match(r.error, /超时/)
  })
})
