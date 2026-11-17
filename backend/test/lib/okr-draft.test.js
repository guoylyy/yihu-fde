// 单元测试 - 贴周报生成 OKR 草稿: 规则解析 / 权重分配 / 超限截断 / 模型失败降级。不连数据库、不连模型
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  weightsByKrCount, normalizeDraft, parseReportByRules, generateOkrDraft,
  DRAFT_MAX_OBJECTIVES, DRAFT_MAX_KRS, TOO_SHORT_MESSAGE, NO_OBJECTIVE_MESSAGE
} from '../../src/services/okrDraft.js'
import { OkrRuleError } from '../../src/services/okrRules.js'

// 结构照真实周报(一级标题 / ## 分节 / 【P0】行 + 完成标准 / 周X 行动方案 / 加粗合计), 内容是虚构的
const REPORT = `# 本周工作计划 · 示例工程师 · 2026 第 47 周

## 一、本周目标

- 【P0】订单模块开发上线并交试点门店试用 ｜ 项目：示例甲 ｜ 完成标准：按上周现场收集的需求完成开发与自测，周四上线交试点门店实际用一轮；周五按试用反馈改一轮并当天上线。

- 【P1】回复客户清单的完成情况 ｜ 项目：示例甲 ｜ 完成标准：拿到清单当天逐条回「是否完成」的答复。不按旧口径重排——需求还在变。本条从第 46 周顺延。

- 【P1】乙项目答疑与问题修复 ｜ 项目：示例乙 ｜ 完成标准：群里提出的问题逐条回应，本周遗留项清零。

- 【P1】其他岗位测试反馈收口 ｜ 项目：示例甲 ｜ 完成标准：各岗位反馈逐条回应并判定，收口成清单。

## 二、行动方案

- 周一 11/16：示例甲——订单模块开发启动（0.75 人天）。
- 周五 11/20：周复盘。

## 三、预期结果（周五复盘时对照的验收标准）

- 订单模块周四上线，试点门店实际用过一轮。

## 四、排产与工时预算

**合计：5 人天。**`

const notConfigured = async () => { throw Object.assign(new Error('未接入'), { code: 'LLM_NOT_CONFIGURED' }) }
const quiet = { warn() {} }

describe('O 权重: 按 KR 条数占比, 取整合计 100', () => {
  test('3/2/1 → 50/33/17', () => assert.deepEqual(weightsByKrCount([3, 2, 1]), [50, 33, 17]))
  test('1/1/1 → 34/33/33(余数给靠前的)', () => assert.deepEqual(weightsByKrCount([1, 1, 1]), [34, 33, 33]))
  test('2/1/1 → 50/25/25', () => assert.deepEqual(weightsByKrCount([2, 1, 1]), [50, 25, 25]))
  test('单个 O → 100; 空 → []', () => {
    assert.deepEqual(weightsByKrCount([4]), [100])
    assert.deepEqual(weightsByKrCount([]), [])
  })
  test('任意组合合计都是 100 且都是整数', () => {
    for (const c of [[1, 2], [4, 4, 3], [1, 4, 4], [3, 3], [2, 3, 4]]) {
      const w = weightsByKrCount(c)
      assert.equal(w.reduce((s, x) => s + x, 0), 100, c.join('/'))
      assert.ok(w.every(Number.isInteger))
    }
  })
})

describe('规则解析', () => {
  const objs = parseReportByRules(REPORT)

  test('【P0】/【P1】行 → 候选 O, 标题取到第一个「｜」前, 去掉优先级标记', () => {
    assert.deepEqual(objs.map(o => o.title), [
      '订单模块开发上线并交试点门店试用', '回复客户清单的完成情况', '乙项目答疑与问题修复', '其他岗位测试反馈收口'
    ])
  })

  test('完成标准按 ；。 分句成 KR', () => {
    assert.deepEqual(objs[0].keyResults.map(k => k.title), [
      '按上周现场收集的需求完成开发与自测，周四上线交试点门店实际用一轮',
      '周五按试用反馈改一轮并当天上线'
    ])
    assert.ok(objs[0].keyResults.every(k => k.metricType === 'BINARY'))
  })

  test('「不按…」「本条…顺延」这类说明不当 KR', () => {
    assert.deepEqual(objs[1].keyResults.map(k => k.title), ['拿到清单当天逐条回「是否完成」的答复'])
  })

  test('完成标准原文放进 O 的说明, 方便人改', () => {
    assert.match(objs[0].description, /^按上周现场收集的需求/)
  })

  test('「合计」加粗行、标题里的「验收标准」不当 O / KR', () => {
    assert.ok(!objs.some(o => /合计/.test(o.title)))
    assert.ok(!objs.some(o => o.keyResults.some(k => /^）/.test(k.title))))
  })

  test('「目标：… / 完成标准：…」格式(完成标准另起一行 + 列表项)', () => {
    const r = parseReportByRules('目标：支付对账上线\n完成标准：\n1. 周三对账脚本跑通\n2. 周五差异单清零\n\n目标：周报模板改版\n完成标准：周四发出新模板；周五收齐反馈')
    assert.deepEqual(r.map(o => o.title), ['支付对账上线', '周报模板改版'])
    assert.deepEqual(r[0].keyResults.map(k => k.title), ['周三对账脚本跑通', '周五差异单清零'])
    assert.deepEqual(r[1].keyResults.map(k => k.title), ['周四发出新模板', '周五收齐反馈'])
  })

  test('英文格式 Objective: / Done when:', () => {
    const r = parseReportByRules('- [P0] Ship billing export | Done when: CSV export released Thursday; finance signs off Friday.')
    assert.deepEqual(r.map(o => o.title), ['Ship billing export'])
    assert.deepEqual(r[0].keyResults.map(k => k.title), ['CSV export released Thursday', 'finance signs off Friday'])
  })

  test('加粗行当 O; 新的 ## 分节不继承上一节的 O', () => {
    const r = parseReportByRules('## 甲\n**客户报表上线**\n验收标准：周四交付报表\n## 乙\n完成标准：这句不属于任何 O')
    assert.equal(r.length, 1)
    assert.deepEqual(r[0].keyResults.map(k => k.title), ['周四交付报表'])
  })

  test('O 没有完成标准时, 用字面最接近的「周X：…」行动方案当 KR', () => {
    const r = parseReportByRules([
      '## 目标', '- 【P0】仓库盘点模块上线', '- 【P1】周报', '## 行动方案',
      '- 周二：仓库盘点模块开发收口；客户回访', '- 周四：仓库盘点模块上线试跑（1 人天）'
    ].join('\n'))
    assert.deepEqual(r[0].keyResults.map(k => k.title), ['周二：仓库盘点模块开发收口', '周四：仓库盘点模块上线试跑（1 人天）'])
    assert.equal(r[1].keyResults.length, 0) // 「周报」配不上任何行动 → 由 normalizeDraft 丢掉
  })
})

describe('规范化 + 超限截断', () => {
  const mk = (n, k) => Array.from({ length: n }, (_, i) => ({
    title: `O${i + 1}`, keyResults: Array.from({ length: k }, (_, j) => ({ title: `KR${j + 1}` }))
  }))

  test(`超过 ${DRAFT_MAX_OBJECTIVES} 个 O → 截到 3 个并打 truncated`, () => {
    const d = normalizeDraft(mk(5, 1))
    assert.equal(d.objectives.length, DRAFT_MAX_OBJECTIVES)
    assert.equal(d.truncated, true)
  })

  test(`单个 O 超过 ${DRAFT_MAX_KRS} 个 KR → 截到 4 个, KR 权重均分合计 100`, () => {
    const d = normalizeDraft(mk(1, 7))
    assert.equal(d.objectives[0].keyResults.length, DRAFT_MAX_KRS)
    assert.equal(d.truncated, true)
    assert.deepEqual(d.objectives[0].keyResults.map(k => k.weight), [25, 25, 25, 25])
  })

  test('不超限 → truncated=false', () => {
    assert.equal(normalizeDraft(mk(3, 4)).truncated, false)
  })

  test('没有 KR 的 O 丢掉, 空标题的 KR 丢掉', () => {
    const d = normalizeDraft([{ title: 'A', keyResults: [{ title: '' }] }, { title: 'B', keyResults: [{ title: 'x1' }] }])
    assert.deepEqual(d.objectives.map(o => o.title), ['B'])
    assert.equal(d.objectives[0].weight, 100)
  })

  test('模型给的 O 权重合法就保留, 否则按 KR 条数重算', () => {
    const raw = [{ title: 'A', weight: 70, keyResults: [{ title: 'a1' }] }, { title: 'B', weight: 30, keyResults: [{ title: 'b1' }, { title: 'b2' }] }]
    assert.deepEqual(normalizeDraft(raw, { keepWeights: true }).objectives.map(o => o.weight), [70, 30])
    const bad = raw.map(o => ({ ...o, weight: 60 }))
    assert.deepEqual(normalizeDraft(bad, { keepWeights: true }).objectives.map(o => o.weight), [33, 67])
  })

  test('KR 指标: NUMBER 没有正目标值退回 BINARY; PERCENT 默认 100; 未知类型按 BINARY', () => {
    const d = normalizeDraft([{
      title: 'A',
      keyResults: [
        { title: 'n0', metricType: 'NUMBER', targetValue: 0, unit: '个' },
        { title: 'n5', metricType: 'NUMBER', targetValue: 5, unit: '个' },
        { title: 'p', metricType: 'PERCENT' },
        { title: 'x', metricType: 'WHATEVER', targetValue: 3 }
      ]
    }])
    const ks = d.objectives[0].keyResults
    assert.deepEqual(ks.map(k => [k.metricType, k.targetValue, k.unit]), [
      ['BINARY', null, null], ['NUMBER', 5, '个'], ['PERCENT', 100, '%'], ['BINARY', null, null]
    ])
  })

  test('超 200 字的标题截断', () => {
    const d = normalizeDraft([{ title: '长'.repeat(300), keyResults: [{ title: '短'.repeat(250) }] }])
    assert.equal(d.objectives[0].title.length, 200)
    assert.equal(d.objectives[0].keyResults[0].title.length, 200)
  })
})

describe('生成: 模型优先, 规则兜底', () => {
  const MODEL_OUT = {
    objectives: [
      { title: '订单模块上线交试点试用', weight: 60, keyResults: [{ title: '周四上线并实际跑一轮', metricType: 'BINARY' }, { title: '周五改完一轮', metricType: 'BINARY' }] },
      { title: '客户问题收口', weight: 40, keyResults: [{ title: '遗留项清零', metricType: 'NUMBER', unit: '项', targetValue: 3 }] }
    ]
  }

  test('文本 < 50 字 → 8130, 不调模型', async () => {
    let called = 0
    await assert.rejects(
      generateOkrDraft('本周工作：开会、写代码', { llm: async () => { called++; return MODEL_OUT } }),
      e => e instanceof OkrRuleError && e.code === 8130 && e.message === TOO_SHORT_MESSAGE
    )
    assert.equal(called, 0)
  })

  test('模型正常 → mode=model, 权重沿用模型的', async () => {
    let sys = ''
    const r = await generateOkrDraft(REPORT, { llm: async (o) => { sys = o.system; return MODEL_OUT } })
    assert.equal(r.mode, 'model')
    assert.equal(r.fallbackReason, null)
    assert.deepEqual(r.objectives.map(o => o.weight), [60, 40])
    assert.match(sys, /objectives/)
    assert.match(sys, /1–3 个/)
    assert.match(sys, /合计正好 100/)
  })

  test('模型超限 → 截断 + truncated', async () => {
    const many = { objectives: Array.from({ length: 4 }, (_, i) => ({ title: `O${i}`, weight: 25, keyResults: Array.from({ length: 6 }, (_, j) => ({ title: `k${j}` })) })) }
    const r = await generateOkrDraft(REPORT, { llm: async () => many })
    assert.equal(r.mode, 'model')
    assert.equal(r.truncated, true)
    assert.equal(r.objectives.length, 3)
    assert.ok(r.objectives.every(o => o.keyResults.length === 4))
    assert.equal(r.objectives.reduce((s, o) => s + o.weight, 0), 100)
  })

  test('非法 JSON 一次 → 重试成功, 仍是 mode=model', async () => {
    let n = 0
    const r = await generateOkrDraft(REPORT, {
      llm: async () => { if (n++ === 0) throw Object.assign(new Error('不是 JSON'), { code: 'LLM_BAD_JSON' }); return MODEL_OUT }
    })
    assert.equal(n, 2)
    assert.equal(r.mode, 'model')
  })

  test('非法 JSON 两次 → 降级规则, fallbackReason=invalid_json', async () => {
    let n = 0
    const r = await generateOkrDraft(REPORT, { log: quiet, llm: async () => { n++; throw Object.assign(new Error('不是 JSON'), { code: 'LLM_BAD_JSON' }) } })
    assert.equal(n, 2)
    assert.equal(r.mode, 'rules')
    assert.equal(r.fallbackReason, 'invalid_json')
    assert.equal(r.objectives[0].title, '订单模块开发上线并交试点门店试用')
  })

  test('结构不对(缺 objectives)也算非法, 重试 1 次后降级', async () => {
    let n = 0
    const r = await generateOkrDraft(REPORT, { log: quiet, llm: async () => { n++; return { answer: 'hi' } } })
    assert.equal(n, 2)
    assert.equal(r.fallbackReason, 'invalid_json')
  })

  test('没配模型 → 规则解析, fallbackReason=not_configured; 王牡丹格式 4 个 O 截成 3 个', async () => {
    const r = await generateOkrDraft(REPORT, { llm: notConfigured })
    assert.equal(r.mode, 'rules')
    assert.equal(r.fallbackReason, 'not_configured')
    assert.equal(r.truncated, true)
    assert.equal(r.objectives.length, 3)
    // KR 条数 2/1/1 → 50/25/25
    assert.deepEqual(r.objectives.map(o => o.weight), [50, 25, 25])
  })

  test('模型接口报错 → 不重试, 直接降级, fallbackReason=model_error', async () => {
    let n = 0
    const r = await generateOkrDraft(REPORT, { log: quiet, llm: async () => { n++; throw new Error('大模型接口返回 500') } })
    assert.equal(n, 1)
    assert.equal(r.fallbackReason, 'model_error')
  })

  test('模型超时 → 按时中断并降级, fallbackReason=timeout', async () => {
    const t0 = Date.now()
    let gotTimeout = null
    const r = await generateOkrDraft(REPORT, {
      log: quiet, timeoutMs: 80,
      llm: (o) => { gotTimeout = o.timeoutMs; return new Promise(() => {}) }
    })
    assert.ok(Date.now() - t0 < 1000)
    assert.ok(gotTimeout > 0 && gotTimeout <= 80, '时限也传给了 HTTP 调用')
    assert.equal(r.mode, 'rules')
    assert.equal(r.fallbackReason, 'timeout')
  })

  test('模型返回 0 个可用 O → 改用规则, fallbackReason=model_empty', async () => {
    const r = await generateOkrDraft(REPORT, { log: quiet, llm: async () => ({ objectives: [] }) })
    assert.equal(r.mode, 'rules')
    assert.equal(r.fallbackReason, 'model_empty')
  })

  test('一个目标都识别不出 → 8131 人话提示', async () => {
    await assert.rejects(
      generateOkrDraft('这周主要是跟进各种事情，开了几个会，和客户沟通了一些需求，还有一些零碎的工作需要处理，下周继续推进，争取早点完成。', { llm: notConfigured }),
      e => e.code === 8131 && e.status === 422 && e.message === NO_OBJECTIVE_MESSAGE
    )
  })
})
