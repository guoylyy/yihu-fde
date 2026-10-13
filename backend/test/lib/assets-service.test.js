// 单元测试 - v2.7 项目资产库 (#1140): 匹配打分 / 首批数据口径 / 接入能力包生成
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { scoreAsset, SUGGEST_THRESHOLD, customerCoreName } from '../../src/services/assets.js'

const base = { name: '快递比价', keywords: ['快递', '运费', '寄件', '比价'], tags: ['物流'], industries: ['制造'], maturity: 'L2', usageCount: 0 }

describe('匹配打分', () => {
  test('命中越多分越高, 命中 3 个触发词 K 满分', () => {
    const one = scoreAsset(base, '看下快递').score
    const three = scoreAsset(base, '快递运费寄件怎么算').score
    assert.ok(three > one)
    assert.ok(three >= SUGGEST_THRESHOLD)
  })
  test('一个触发词都没中、名称也没出现 → 0 分(成熟资产不能刷屏)', () => {
    assert.equal(scoreAsset({ ...base, maturity: 'L3', usageCount: 99 }, '修复登录页样式').score, 0)
  })
  test('同样相关时更成熟、复用更多的排前面', () => {
    const text = '快递运费寄件'
    assert.ok(scoreAsset({ ...base, maturity: 'L3', usageCount: 5 }, text).score > scoreAsset({ ...base, maturity: 'L0' }, text).score)
  })
  test('大小写不敏感, 空文本 0 分', () => {
    assert.ok(scoreAsset({ ...base, keywords: ['MCP'] }, '接入 mcp 服务').matched.length === 1)
    assert.equal(scoreAsset(base, '').score, 0)
  })
})

describe('客户核心名(发布扫描用)', () => {
  test('去地区前缀/括号/公司与行业后缀, 抓住口头简称', () => {
    assert.equal(customerCoreName('星河电梯装饰有限公司'), '星河')
    assert.equal(customerCoreName('上海青松科技有限公司'), '青松')
    assert.equal(customerCoreName('云帆智联（上海）科技有限公司'), '云帆智联')
    assert.equal(customerCoreName('江苏博远机电科技有限公司'), '博远')
    assert.equal(customerCoreName('同济大学'), '同济大学')
  })
  test('太短或通用词不用, 避免误伤', () => {
    assert.equal(customerCoreName('示范科技有限公司'), null)
    assert.equal(customerCoreName('A公司'), null)
    assert.equal(customerCoreName(''), null)
  })
})

describe('单个顺口提到的词不推荐', () => {
  test('只命中一个触发词、名字没出现 → 低于阈值', () => {
    const wechat = { name: '微信生态套件', keywords: ['微信', '公众号', '网页授权', 'openid', '支付'], tags: ['微信'], maturity: 'L2', usageCount: 0 }
    assert.ok(scoreAsset(wechat, '业务员把客户微信里的寄件信息贴进来').score < SUGGEST_THRESHOLD)
    assert.ok(scoreAsset(wechat, '公众号网页授权拿 openid').score >= SUGGEST_THRESHOLD)
  })
})
