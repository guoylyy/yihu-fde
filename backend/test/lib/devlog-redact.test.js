// 会话正文脱敏 + 规则摘要(纯函数)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { redact, redactString, MASK } from '../../src/services/devlog/redact.js'
import { normalizeItem, ruleSummary, detectFiles, firstSentence, InputError } from '../../src/services/devlog/conversations.js'

describe('devlog redact', () => {
  const cases = [
    ['key sk-abc123 here', `key ${MASK} here`],
    ['Authorization: Bearer eyJhbGciOi.abc-def', `Authorization: Bearer ${MASK}`],
    ['login password=hunter2&x=1', `login password=${MASK}&x=1`],
    ['{"password":"hunter2","token":"t0k"}', `{"password":"${MASK}","token":"${MASK}"}`],
    ['curl "https://x/?token=abc123"', `curl "https://x/?token=${MASK}"`],
    ['DB=mysql://root:okrdev@127.0.0.1:3326/fde', `DB=mysql://${MASK}@127.0.0.1:3326/fde`],
    ['aws AKIAIOSFODNN7EXAMPLE ok', `aws ${MASK} ok`],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIE\nabc\n-----END RSA PRIVATE KEY-----\ntail', `${MASK}\ntail`]
  ]
  for (const [input, want] of cases) {
    test(`替换: ${input.slice(0, 30)}`, () => assert.deepEqual(redactString(input), { text: want, hit: true }))
  }

  test('不误伤普通文本, 不截断', () => {
    for (const s of ['max_tokens=100 task-abc desk-lamp', '忘记密码 password reset 流程', 'x'.repeat(100000)]) {
      assert.deepEqual(redactString(s), { text: s, hit: false })
    }
  })

  test('递归处理对象/数组, 键名是秘密的直接盖值, 不改入参', () => {
    const input = { messages: [{ role: 'user', content: 'sk-abc123' }, { role: 'tool', args: { password: 'x', n: 1 } }] }
    const r = redact(input)
    assert.equal(r.redacted, true)
    assert.deepEqual(r.value, { messages: [{ role: 'user', content: MASK }, { role: 'tool', args: { password: MASK, n: 1 } }] })
    assert.equal(input.messages[0].content, 'sk-abc123')
    assert.equal(redact([{ role: 'user', content: 'hi' }]).redacted, false)
  })

  test('normalizeItem: body 脱敏并置 bodyRedacted; 空字段不出现在 data 里', () => {
    const n = normalizeItem({ uid: 'u1', source: 'codex', body: [{ role: 'user', content: 'password=hunter2' }], title: '', branch: null })
    assert.equal(n.data.source, 'CODEX')
    assert.equal(n.data.bodyRedacted, true)
    assert.equal(n.data.turns, 1)
    assert.ok(!('title' in n.data) && !('branch' in n.data))
    assert.throws(() => normalizeItem({ source: 'CODEX' }), InputError)
    assert.throws(() => normalizeItem({ uid: 'x', stage: 'LATER' }), /stage/)
  })

  test('规则摘要: 前 3 条 user 首句 + 文件路径', () => {
    assert.equal(firstSentence('先改 a.js。再改 b.js'), '先改 a.js。')
    assert.deepEqual(detectFiles(['看 src/lib/auth.js:42 和 package.json, 不是 1.2.3 也不是 https://x.com/a.html']), ['src/lib/auth.js', 'package.json'])
    const s = ruleSummary({ body: [{ role: 'user', content: '一。' }, { role: 'user', content: '二' }, { role: 'user', content: '三' }, { role: 'user', content: '四' }] }, [{ kind: 'DECISION', text: 'd' }])
    assert.equal(s.summary, '1. 一。\n2. 二\n3. 三')
    assert.deepEqual(s.decisions, ['d'])
  })
})
