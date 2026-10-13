// 单元测试 - v2.5.5(#912) 通知分档目录 / 送达决策 / 偏好规范化 / 每日摘要合并(纯函数, 不连库)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { NOTIFICATION_CATALOG, TIERS, resolveDelivery, normalizePrefsInput, listCatalogForSettings, getTier, DAILY_DIGEST_TYPE } from '../../src/lib/notificationCatalog.js'
import { composeDigest } from '../../src/lib/notificationDigest.js'
import { DEFAULT_CHANNELS_BY_TYPE } from '../../src/lib/notify.js'

describe('lib/notificationCatalog.js', () => {
  test('每个类型都有档位/标签/分组/判据, 档位合法', () => {
    for (const [type, e] of Object.entries(NOTIFICATION_CATALOG)) {
      assert.ok(TIERS[e.tier], `${type} 档位非法`)
      for (const k of ['label', 'group', 'reason']) assert.ok(e[k] && e[k].length > 1, `${type} 缺 ${k}`)
    }
  })

  test('通道矩阵里的类型都已登记(不漏)', () => {
    const missing = Object.keys(DEFAULT_CHANNELS_BY_TYPE).filter(t => !NOTIFICATION_CATALOG[t])
    assert.deepEqual(missing, [], '通道矩阵中的类型未登记: ' + missing.join(','))
  })

  test('任务说明里的必看样例都是 MUST', () => {
    for (const t of ['TASK_ASSIGNED', 'MENTIONED', 'TASK_ACCEPTANCE', 'TIMESHEET_PENDING', 'TIMESHEET_REJECTED', DAILY_DIGEST_TYPE]) {
      assert.equal(getTier(t), 'MUST', t)
    }
  })

  test('resolveDelivery: 档位默认 → on/off/digest', () => {
    assert.equal(resolveDelivery('TASK_ASSIGNED', null), 'on')
    assert.equal(resolveDelivery('COMMENT_REPLY', null), 'off')
    assert.equal(resolveDelivery('TIMESHEET_APPROVED', null), 'digest')
  })

  test('resolveDelivery: 用户 enabled 覆盖档位; 未知类型兜底 on', () => {
    assert.equal(resolveDelivery('TASK_ASSIGNED', { TASK_ASSIGNED: { enabled: false } }), 'off')
    assert.equal(resolveDelivery('COMMENT_REPLY', { COMMENT_REPLY: { enabled: true } }), 'on')
    assert.equal(resolveDelivery('TIMESHEET_APPROVED', { TIMESHEET_APPROVED: { enabled: true } }), 'on')
    assert.equal(resolveDelivery('TIMESHEET_APPROVED', { TIMESHEET_APPROVED: { site: false } }), 'digest', '旧版通道开关不影响档位')
    assert.equal(resolveDelivery('SOME_NEW_TYPE', null), 'on')
  })

  test('normalizePrefsInput: 只收目录内类型与布尔, null 清除, 合并已有', () => {
    const existing = { COMMENT_REPLY: { enabled: true }, CUSTOMER_CREATED: { feishu: false } }
    const { prefs, rejected } = normalizePrefsInput({
      COMMENT_REPLY: null, TASK_ASSIGNED: { enabled: false }, CUSTOMER_CREATED: { enabled: true }, BOGUS: { enabled: true }, MENTIONED: { enabled: 'yes' }
    }, existing)
    // 旧数据里的 feishu 键原样保留(读取时视同 chat), 新提交的 enabled 合并进去
    assert.deepEqual(prefs, { CUSTOMER_CREATED: { feishu: false, enabled: true }, TASK_ASSIGNED: { enabled: false } })
    assert.deepEqual(rejected.sort(), ['BOGUS', 'MENTIONED.enabled'])
  })

  test('listCatalogForSettings 按分组排序并带默认送达', () => {
    const list = listCatalogForSettings()
    assert.equal(list.length, Object.keys(NOTIFICATION_CATALOG).length)
    assert.equal(list[0].group, '任务协作')
    const row = list.find(x => x.type === 'TIMESHEET_APPROVED')
    assert.equal(row.defaultDelivery, 'digest'); assert.equal(row.tierLabel, '噪音')
  })
})

describe('lib/notificationDigest.js composeDigest', () => {
  test('按类型聚合, 多的排前, 每类最多 3 个标题, 总条数进标题', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) => ({ type: 'TIMESHEET_APPROVED', title: `✅ 工时已批准 ${i}` })),
      { type: 'PROJECT_STATUS_CHANGED', title: '项目状态变更' },
      { type: 'CUSTOMER_CREATED', title: '新客户创建' }
    ]
    const d = composeDigest(items)
    assert.equal(d.title, '🗞 昨日动态摘要（7 条）')
    const lines = d.body.split('\n')
    assert.equal(lines.length, 3)
    assert.match(lines[0], /^我的工时已批准 ×5：工时已批准 0；工时已批准 1；工时已批准 2 等 5 条$/)
    assert.deepEqual(d.typeCounts, { TIMESHEET_APPROVED: 5, PROJECT_STATUS_CHANGED: 1, CUSTOMER_CREATED: 1 })
  })
  test('超过 8 类时折叠', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ type: `T${i}`, title: `t${i}` }))
    const d = composeDigest(items)
    assert.equal(d.body.split('\n').length, 9)
    assert.match(d.body, /另有 2 类动态/)
  })
})
