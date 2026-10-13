import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'

process.env.JWT_SECRET = 'checklist-route-test-only'
const saved = new Map()
const article = { id: 15n, content: '# Module\n- [ ] first\n```md\n- [ ] ignored\n```', deletedAt: null }
globalThis.__prisma = {
  knowledgeArticle: { findFirst: async () => article },
  knowledgeChecklistProgress: {
    findMany: async ({ where }) => [...saved.values()].filter(row => String(row.userId) === String(where.userId)),
    upsert: async ({ create, update }) => { const key = `${create.userId}:${create.articleId}:${create.itemKey}`; const row = { ...(saved.get(key) || create), ...update }; saved.set(key, row); return row }
  }
}
const { default: router } = await import('../../src/routes/fde/knowledge-checklists.js')
const { signToken } = await import('../../src/lib/auth.js')
let server, base
before(async () => { const app = express(); app.use(express.json()); app.use('/checklists', router); server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/checklists` })
after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }))
function headers(role = 'MANAGER', userId = '15') { return { Authorization: `Bearer ${signToken({ type: 'internal', userId, role })}`, 'content-type': 'application/json' } }
test('returns only parsed checklist items and persists per authenticated user', async () => {
  const first = await fetch(`${base}/15`, { headers: headers() }); assert.equal(first.status, 200)
  const data = await first.json(); assert.equal(data.data.items.length, 1); const key = data.data.items[0].itemKey
  const save = await fetch(`${base}/15/${key}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ checked: true }) }); assert.equal(save.status, 200)
  const again = await (await fetch(`${base}/15`, { headers: headers() })).json(); assert.equal(again.data.items[0].checked, true)
  const other = await (await fetch(`${base}/15`, { headers: headers('MANAGER', '16') })).json(); assert.equal(other.data.items[0].checked, false)
})
test('rejects query spoofing, malformed input, unknown key and unauthenticated access', async () => {
  assert.equal((await fetch(`${base}/15?userId=16`, { headers: headers() })).status, 400)
  assert.equal((await fetch(`${base}/15`)).status, 401)
  assert.equal((await fetch(`${base}/15/not-a-key`, { method: 'PUT', headers: headers(), body: '{}' })).status, 400)
})
