import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkFile, mergeFiles, formatSize, summaryLead, UPLOAD_MAX_BYTES } from '../../src/components/devlog/uploadUtils.js'

test('checkFile: 扩展名与 50MB 上限', () => {
  assert.equal(checkFile({ name: 'a.JSONL', size: 10 }), null)
  assert.equal(checkFile({ name: 'rollout.jsonl.zst', size: 10 }), null)
  assert.equal(checkFile({ name: 'session.jsonl.gz', size: 10 }), null)
  assert.equal(checkFile({ name: '笔记.md', size: 10 }), null)
  assert.equal(checkFile({ name: 'a.exe', size: 10 }), 'bad_ext')
  assert.equal(checkFile({ name: 'big.jsonl', size: UPLOAD_MAX_BYTES + 1 }), 'too_big')
  assert.equal(checkFile({ name: 'edge.jsonl', size: UPLOAD_MAX_BYTES }), null)
})

test('mergeFiles: 同名同大小去重, 超过上限丢弃并计数', () => {
  const a = { name: 'a.md', size: 1 }
  const b = { name: 'b.md', size: 2 }
  assert.deepEqual(mergeFiles([a], [a, b]), { list: [a, b], dropped: 0 })
  const r = mergeFiles([a], [b, { name: 'c.md', size: 3 }], 2)
  assert.deepEqual(r.list, [a, b])
  assert.equal(r.dropped, 1)
})

test('formatSize / summaryLead', () => {
  assert.equal(formatSize(500), '500 B')
  assert.equal(formatSize(1536), '1.5 KB')
  assert.equal(formatSize(116 * 1024 * 1024), '116.0 MB')
  assert.equal(summaryLead('1. 帮我看下 src/a.js 为什么报错？还有别的\n2. 第二句'), '帮我看下 src/a.js 为什么报错？')
  assert.equal(summaryLead('x'.repeat(100), 10), 'xxxxxxxxxx…')
  assert.equal(summaryLead(null), '')
})
