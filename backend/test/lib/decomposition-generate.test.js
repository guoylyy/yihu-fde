import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateDecompositionDraft } from '../../src/services/decompositionDraft.js'

test('AI decomposition uses SOP prompt and validates the returned draft before review', async () => {
  let call
  const result = await generateDecompositionDraft('请为客户门户增加账号登录、订单查询和管理员导出能力，要求可测试并分阶段交付。', {
    llm: async options => { call = options; return { summary: '客户门户能力', openQuestions: ['是否需要单点登录'], milestones: [{ name: '账户', tasks: [{ title: '实现登录接口', role: 'DEV', acceptanceCriteria: [{ acNo: 'AC-1', text: '错误密码返回401', level: 'L1_API' }], dependencies: [] }] }] } }
  })
  assert.match(call.system, /1-3天|1-3天可完成/)
  assert.match(call.system, /人工审核/)
  assert.equal(result.reviewRequired, true)
  assert.equal(result.taskCount, 1)
})

test('AI decomposition rejects short requirements before calling the model', async () => {
  await assert.rejects(() => generateDecompositionDraft('太短', { llm: async () => { throw new Error('must not call') } }), /至少20个字符/)
})
