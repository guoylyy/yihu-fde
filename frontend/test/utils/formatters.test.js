// 单元测试 - src/utils/formatters.js 前端工具函数
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  formatMoney, formatMoneyShort, formatDate, formatDay, relativeTime,
  statusColor, statusLabel, severityType, severityLabel,
  STATUS_COLORS, STATUS_LABELS
} from '../../src/utils/formatters.js'

describe('utils/formatters.js - 工具函数', () => {

  // ===== formatMoney =====
  describe('formatMoney', () => {
    test('数字带千分位和 ¥', () => {
      assert.equal(formatMoney(1234567.89), '¥1,234,567.89')
    })
    test('null 返回 —', () => {
      assert.equal(formatMoney(null), '—')
    })
    test('undefined 返回 —', () => {
      assert.equal(formatMoney(undefined), '—')
    })
    test('0 返回 ¥0', () => {
      assert.equal(formatMoney(0), '¥0')
    })
    test('字符串数字', () => {
      assert.equal(formatMoney('1234.5'), '¥1,234.5')
    })
    test('负数', () => {
      assert.equal(formatMoney(-100), '¥-100')
    })
  })

  // ===== formatMoneyShort =====
  describe('formatMoneyShort', () => {
    test('0 返回 ¥0', () => {
      assert.equal(formatMoneyShort(0), '¥0')
    })
    test('null 返回 ¥0', () => {
      assert.equal(formatMoneyShort(null), '¥0')
    })
    test('< 1000 普通显示', () => {
      assert.equal(formatMoneyShort(500), '¥500')
    })
    test('>= 10000 显示 X.XK / X.XM (en)', () => {
      assert.equal(formatMoneyShort(10000), '¥10.0K')
      assert.equal(formatMoneyShort(125000), '¥125.0K')
      assert.equal(formatMoneyShort(1000000), '¥1.0M')
    })
  })

  // ===== formatDate =====
  describe('formatDate', () => {
    test('空值返回 —', () => {
      assert.equal(formatDate(null), '—')
      assert.equal(formatDate(''), '—')
    })
    test('Date 对象', () => {
      const d = new Date('2026-06-26T10:00:00Z')
      assert.equal(formatDate(d), '2026-06-26')
    })
    test('ISO 字符串', () => {
      assert.equal(formatDate('2026-01-01T00:00:00Z'), '2026-01-01')
    })
  })

  // ===== formatDay =====
  describe('formatDay', () => {
    test('取 MM-DD', () => {
      assert.equal(formatDay('2026-06-26'), '06-26')
      assert.equal(formatDay('2026-01-01'), '01-01')
    })
  })

  // ===== relativeTime =====
  describe('relativeTime', () => {
    test('空值返回空字符串', () => {
      assert.equal(relativeTime(null), '')
      assert.equal(relativeTime(''), '')
    })
    test('刚刚（< 1 分钟）', () => {
      const now = new Date().toISOString()
      assert.equal(relativeTime(now), 'Just now')
    })
    test('5 分钟前', () => {
      const t = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      assert.equal(relativeTime(t), '5 min ago')
    })
    test('3 小时前', () => {
      const t = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      assert.equal(relativeTime(t), '3 hours ago')
    })
    test('2 天前', () => {
      const t = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      assert.equal(relativeTime(t), '2 days ago')
    })
    test('> 30 天返回日期', () => {
      const t = '2025-01-01T00:00:00Z'
      const r = relativeTime(t)
      assert.equal(r, '2025-01-01')
    })
  })

  // ===== 状态颜色/标签 =====
  describe('状态映射', () => {
    test('statusColor 已知状态有颜色', () => {
      assert.equal(statusColor('DRAFT'), '#909399')
      assert.equal(statusColor('IN_PROGRESS'), '#2e7d4f')
      assert.equal(statusColor('CANCELLED'), '#c2362b')
    })
    test('statusColor 未知状态用灰', () => {
      assert.equal(statusColor('UNKNOWN'), '#909399')
      assert.equal(statusColor(null), '#909399')
    })
    test('statusLabel 已知状态有中文', () => {
      assert.equal(statusLabel('DRAFT'), 'Draft')
      assert.equal(statusLabel('IN_PROGRESS'), 'In progress')
      assert.equal(statusLabel('CANCELLED'), 'Cancelled')
    })
    test('statusLabel 未知状态回原值', () => {
      assert.equal(statusLabel('UNKNOWN'), 'UNKNOWN')
    })
    test('STATUS_COLORS 和 STATUS_LABELS 配对', () => {
      for (const key of Object.keys(STATUS_COLORS)) {
        assert.ok(STATUS_LABELS[key], `${key} 应有 label`)
      }
    })
  })

  // ===== 严重度 =====
  describe('严重度', () => {
    test('severityType 映射正确', () => {
      assert.equal(severityType('LOW'), 'info')
      assert.equal(severityType('MEDIUM'), 'warning')
      assert.equal(severityType('HIGH'), 'danger')
    })
    test('severityLabel 映射正确', () => {
      assert.equal(severityLabel('LOW'), 'Low')
      assert.equal(severityLabel('MEDIUM'), 'Medium')
      assert.equal(severityLabel('HIGH'), 'High')
    })
  })
})
