// 单元测试 - OKR 7.0 粘贴 Markdown 批量建: O 行 / KR 行识别、目标值与类型判定、unparsed、截断与权重。不连数据库
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parsePlanMarkdown, parseKrLine, normalizeBulkPlan, BULK_MAX_OBJECTIVES, BULK_MAX_KRS } from '../../src/services/okrDraft.js'
import { MAX_OBJECTIVES, MAX_KRS } from '../../src/services/okrRules.js'

const sum = a => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100

describe('parseKrLine: 目标值 + metricType', () => {
  const cases = [
    ['培训 ≥3 名', { title: '培训 ≥3 名', metricType: 'NUMBER', unit: '名', targetValue: 3 }],
    ['单测覆盖率 50%', { title: '单测覆盖率 50%', metricType: 'PERCENT', unit: '%', targetValue: 50 }],
    ['完成定稿', { title: '完成定稿', metricType: 'BINARY', unit: null, targetValue: null }],
    ['回访客户 目标：5 家', { title: '回访客户', metricType: 'NUMBER', unit: '家', targetValue: 5 }],
    ['回访客户（目标: 5）', { title: '回访客户', metricType: 'NUMBER', unit: null, targetValue: 5 }],
    ['转化率 目标：30%', { title: '转化率', metricType: 'PERCENT', unit: '%', targetValue: 30 }],
    ['发布 >= 2 篇博客', { title: '发布 >= 2 篇博客', metricType: 'NUMBER', unit: '篇', targetValue: 2 }],
    ['不少于 3 个客户试用', { title: '不少于 3 个客户试用', metricType: 'NUMBER', unit: '个', targetValue: 3 }],
    ['FAQ 补齐 10 条以上', { title: 'FAQ 补齐 10 条以上', metricType: 'NUMBER', unit: '条', targetValue: 10 }],
    ['合并 ≥5 PRs', { title: '合并 ≥5 PRs', metricType: 'NUMBER', unit: 'PRs', targetValue: 5 }],
    ['周四上线 v2 版本', { title: '周四上线 v2 版本', metricType: 'BINARY', unit: null, targetValue: null }]
  ]
  for (const [line, want] of cases) {
    test(`「${line}」→ ${want.metricType}`, () => {
      const got = parseKrLine(line)
      assert.deepEqual({ title: got.title, metricType: got.metricType, unit: got.unit, targetValue: got.targetValue }, want)
    })
  }

  test('权重写法「（权重 40）」被抽走, 不当成百分比', () => {
    const k = parseKrLine('完成联调（权重 40%）')
    assert.equal(k.weight, 40)
    assert.equal(k.metricType, 'BINARY')
    assert.equal(k.title, '完成联调')
  })
})

describe('parsePlanMarkdown: O 行 / KR 行 / unparsed', () => {
  test('五种 O 写法都认: ## / ### / O1 标题 / O1：标题 / - 【P0】标题 ｜ 完成标准', () => {
    const md = [
      '## 甲目标', '- k1',
      '### 乙目标', '- k2',
      'O3 丙目标', '- k3',
      'O4：丁目标', '- k4',
      '- 【P0】戊目标 ｜ 完成标准：交付手册；回访两家客户'
    ].join('\n')
    const { objectives, unparsed } = parsePlanMarkdown(md)
    assert.deepEqual(objectives.map(o => o.title), ['甲目标', '乙目标', '丙目标', '丁目标', '戊目标'])
    assert.deepEqual(objectives[4].keyResults.map(k => k.title), ['交付手册', '回访两家客户'], '完成标准分句 → KR')
    assert.deepEqual(unparsed, [])
  })

  test('KR 行: - / * / 1. / 1、/ 勾选框 / KR1：; ## O1 前缀从标题里去掉', () => {
    const md = ['## O1：上线', '- 甲甲', '* 乙乙', '1. 丙丙', '2、丁丁', '- [x] 戊戊', 'KR6：己己', '**加粗不是 KR**'].join('\n')
    const { objectives, unparsed } = parsePlanMarkdown(md)
    assert.equal(objectives[0].title, '上线')
    assert.deepEqual(objectives[0].keyResults.map(k => k.title), ['甲甲', '乙乙', '丙丙', '丁丁', '戊戊', '己己'])
    assert.deepEqual(unparsed, [{ line: 8, text: '**加粗不是 KR**' }])
  })

  test('一级标题是文档名不当 O; 但「# O1 …」算; 没有 KR 的 O 进 unparsed', () => {
    const { objectives, unparsed } = parsePlanMarkdown('# 第 47 周计划\n# O1 甲\n- kk\n## 空分节\n')
    assert.deepEqual(objectives.map(o => o.title), ['甲'])
    assert.deepEqual(unparsed.map(u => u.line), [1, 4])
  })

  test('1.5 天这种小数开头不当序号; 分隔线 / 代码围栏忽略', () => {
    const { objectives, unparsed } = parsePlanMarkdown('## 甲\n1.5 天完成联调\n---\n```\n- kk\n```')
    assert.deepEqual(objectives[0].keyResults.map(k => k.title), ['kk'])
    assert.deepEqual(unparsed, [{ line: 2, text: '1.5 天完成联调' }])
  })
})

describe('normalizeBulkPlan: 上限与权重', () => {
  const mk = (n, krs) => Array.from({ length: n }, (_, i) => ({ title: `O${i + 1}`, keyResults: Array.from({ length: krs(i) }, (_, j) => ({ title: `k${j}`, metricType: 'BINARY' })) }))

  test('上限: 需求的 5 个 O / 6 条 KR, 但不超过计划硬上限', () => {
    assert.equal(BULK_MAX_OBJECTIVES, Math.min(5, MAX_OBJECTIVES))
    assert.equal(BULK_MAX_KRS, Math.min(6, MAX_KRS))
  })

  test('超出截断并 truncated=true; 权重合计各自 100', () => {
    const { objectives, truncated } = normalizeBulkPlan(mk(7, i => (i === 0 ? 9 : 2)))
    assert.equal(truncated, true)
    assert.equal(objectives.length, BULK_MAX_OBJECTIVES)
    assert.equal(objectives[0].keyResults.length, BULK_MAX_KRS)
    assert.equal(sum(objectives.map(o => o.weight)), 100)
    for (const o of objectives) assert.equal(sum(o.keyResults.map(k => k.weight)), 100)
  })

  test('没写权重 → KR 均分、O 按 KR 条数占比; 都写了且合计 100 → 保留', () => {
    const a = normalizeBulkPlan(mk(2, i => (i === 0 ? 3 : 1)))
    assert.deepEqual(a.objectives.map(o => o.weight), [75, 25])
    assert.deepEqual(a.objectives[0].keyResults.map(k => k.weight), [33.33, 33.33, 33.34])
    const given = mk(2, () => 2).map((o, i) => ({ ...o, weight: i ? 30 : 70, keyResults: o.keyResults.map((k, j) => ({ ...k, weight: j ? 10 : 90 })) }))
    const b = normalizeBulkPlan(given)
    assert.deepEqual(b.objectives.map(o => o.weight), [70, 30])
    assert.deepEqual(b.objectives[0].keyResults.map(k => k.weight), [90, 10])
  })
})
