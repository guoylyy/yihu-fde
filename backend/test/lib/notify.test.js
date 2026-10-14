// 单元测试 - lib/notify.js 纯函数（不依赖 prisma）
// 测试 channel 矩阵 + 用户 prefs 过滤逻辑
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// 不引入 notify.js（会 import prisma），只测试纯函数
// 但 _parseUserPrefs / _resolveChannels 是导出的
// 通过 test-only 路径：读源码后 eval？不安全。改成 import 后不调 prisma 方法

// 由于 notify.js 顶层 import prisma 会导致 prisma 客户端初始化（连 DB），
// 这里用 module.constructor 动态 import 测试导出，但测试不调 prisma 方法

let _parseUserPrefs, _resolveChannels, DEFAULT_CHANNELS_BY_TYPE
try {
  const mod = await import('../../src/lib/notify.js')
  _parseUserPrefs = mod._parseUserPrefs
  _resolveChannels = mod._resolveChannels
  DEFAULT_CHANNELS_BY_TYPE = mod.DEFAULT_CHANNELS_BY_TYPE
} catch (e) {
  console.error('❌ import notify.js 失败:', e.message)
  throw e
}

describe('lib/notify.js - 纯函数', () => {

  // ===== DEFAULT_CHANNELS_BY_TYPE 矩阵 =====
  describe('默认通道矩阵', () => {
    test('USER_INVITED 默认三通道 (site+chat+platform)', () => {
      assert.deepEqual(DEFAULT_CHANNELS_BY_TYPE.USER_INVITED, ['site', 'chat', 'platform'])
    })
    test('没有密码相关通知, 也没有邮件通道', () => {
      assert.equal(DEFAULT_CHANNELS_BY_TYPE.PASSWORD_RESET, undefined)
      assert.ok(Object.values(DEFAULT_CHANNELS_BY_TYPE).every(chs => !chs.includes('mail')))
    })
    test('TIMESHEET_PENDING 发给审批人的个人消息', () => {
      assert.deepEqual(DEFAULT_CHANNELS_BY_TYPE.TIMESHEET_PENDING, ['site', 'chat', 'platform'])
    })
    test('COMMENT_REPLY 单通道（仅 site）', () => {
      assert.deepEqual(DEFAULT_CHANNELS_BY_TYPE.COMMENT_REPLY, ['site'])
    })
    test('CUSTOMER_CREATED 双通道 (site+chat)', () => {
      assert.deepEqual(DEFAULT_CHANNELS_BY_TYPE.CUSTOMER_CREATED, ['site', 'chat'])
    })
    test('所有事件至少含 site', () => {
      for (const [type, channels] of Object.entries(DEFAULT_CHANNELS_BY_TYPE)) {
        assert.ok(channels.includes('site'), `${type} 应含 site`)
      }
    })
  })

  // ===== _parseUserPrefs =====
  describe('_parseUserPrefs 解析用户 prefs', () => {
    test('null 返回 null', () => {
      assert.equal(_parseUserPrefs(null), null)
    })
    test('空字符串返回 null', () => {
      assert.equal(_parseUserPrefs(''), null)
    })
    test('合法 JSON 字符串解析', () => {
      const r = _parseUserPrefs('{"USER_INVITED":{"mail":false}}')
      assert.deepEqual(r, { USER_INVITED: { mail: false } })
    })
    test('已是对象直接返回', () => {
      const obj = { USER_INVITED: { mail: false } }
      assert.equal(_parseUserPrefs(obj), obj)
    })
    test('非法 JSON 返回 null', () => {
      assert.equal(_parseUserPrefs('{not valid'), null)
    })
  })

  // ===== _resolveChannels =====
  describe('_resolveChannels 决定通道', () => {
    test('无 prefs 无 channels 用默认', () => {
      const r = _resolveChannels('USER_INVITED', null, null)
      assert.deepEqual(r, ['site', 'chat', 'platform'])
    })

    test('无 prefs 无 channels + 未知 type 用 site 兜底', () => {
      const r = _resolveChannels('UNKNOWN_TYPE', null, null)
      assert.deepEqual(r, ['site'])
    })

    test('调用方 channels 覆盖默认', () => {
      const r = _resolveChannels('COMMENT_REPLY', null, ['site', 'chat', 'platform'])
      assert.deepEqual(r, ['site', 'chat', 'platform'])
    })

    test('调用方传空数组用默认', () => {
      const r = _resolveChannels('USER_INVITED', null, [])
      assert.deepEqual(r, ['site', 'chat', 'platform'])
    })

    test('用户 prefs 关闭某通道(旧数据的 mail 键视同 platform)', () => {
      const r = _resolveChannels('USER_INVITED', { USER_INVITED: { mail: false } }, null)
      assert.deepEqual(r, ['site', 'chat'])
    })

    test('用户 prefs 关闭所有通道时，site 仍兜底', () => {
      const r = _resolveChannels('TEST', { TEST: { site: false, chat: false, mail: false } }, null)
      assert.ok(r.includes('site'), 'site 必须存在')
      assert.equal(r.length, 1)
    })

    test('用户 prefs 只配置部分通道，未配置的走默认', () => {
      // 只关 platform，chat 没设（默认 = true）
      const r = _resolveChannels('USER_INVITED', { USER_INVITED: { platform: false } }, null)
      assert.deepEqual(r, ['site', 'chat'])
    })

    test('调用方 channels + 用户 prefs 同时生效', () => {
      const r = _resolveChannels('COMMENT_REPLY', { COMMENT_REPLY: { chat: false } }, ['site', 'chat', 'platform'])
      assert.deepEqual(r, ['site', 'platform'])
    })

    test('旧版 prefs 的 feishu 键视同 chat', () => {
      const r = _resolveChannels('COMMENT_REPLY', { COMMENT_REPLY: { feishu: false } }, ['site', 'chat', 'platform'])
      assert.deepEqual(r, ['site', 'platform'])
    })

    test('site 不在调用方列表时自动补上', () => {
      const r = _resolveChannels('TEST', null, ['chat'])
      assert.ok(r.includes('site'))
    })
  })
})
