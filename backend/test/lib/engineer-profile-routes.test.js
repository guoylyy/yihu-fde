import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'

// Isolated HTTP tests: use only fixture data; never connect to a database or start cron.
process.env.JWT_SECRET = 'profile-route-test-only'
let queries = []
let failDatabase = false
const engineer = { id: 1n, userId: 2n, available: 1, skills: [], user: { name: 'Fixture', role: 'FDE_ENGINEER', status: 1 } }
globalThis.__prisma = {
  engineer: {
    async findMany(args) { queries.push(args); if (failDatabase) throw new Error('private-db-details'); return [engineer] },
    async findFirst(args) { queries.push(args); return args.where.id === 1n ? engineer : null }
  },
  projectMember: { findMany: async () => [] },
  timesheet: { findMany: async () => [] },
  task: { findMany: async () => [] }
}
const { default: router } = await import('../../src/routes/fde/engineer-profiles.js')
const { signToken } = await import('../../src/lib/auth.js')
let server, base
before(async () => {
  const app = express(); app.use('/profiles', router)
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/profiles`
})
after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve) }))
async function request(path = '', role = 'MANAGER') {
  const headers = role ? { Authorization: `Bearer ${signToken({ type: 'internal', userId: '15', role })}` } : {}
  return fetch(base + path, { headers, signal: AbortSignal.timeout(3000) })
}
test('authentication and engineer permission are required', async () => {
  assert.equal((await request('', null)).status, 401)
  assert.equal((await request('', 'FDE_ENGINEER')).status, 403)
})
test('malformed limits, repeated criteria and IDs return 400 before reading data', async () => {
  for (const path of ['?limit=-1', '?limit=2.5', '?limit=Infinity', '?limit=201', '/suggest?limit=51', '/suggest?skill[x]=a', '/suggest?role=a&role=b', '/0', '/-1', '/1.5', '/9223372036854775808']) {
    queries = []
    assert.equal((await request(path)).status, 400, path)
    assert.equal(queries.length, 0, path)
  }
})
test('list, detail and suggestions consistently exclude deleted, disabled and non-engineer accounts', async () => {
  for (const path of ['', '/1', '/suggest?skill=Vue&limit=1']) {
    queries = []
    const res = await request(path)
    assert.equal(res.status, 200)
    const where = queries[0].where
    assert.equal(where.deletedAt, null)
    assert.equal(where.user.deletedAt, null)
    assert.equal(where.user.status, 1)
    assert.deepEqual(where.user.role.in, ['FDE_ENGINEER', 'MANAGER', 'PLATFORM', 'SALES'])
    const body = await res.json()
    assert.ok(path === '/1' ? body.data.engineerId === '1' : body.data.list.length === 1)
  }
  assert.equal((await request('/99')).status, 404)
})
test('database errors are not returned to clients', async () => {
  failDatabase = true
  try {
    const res = await request()
    assert.equal(res.status, 500)
    assert.doesNotMatch(await res.text(), /private-db-details/)
  } finally { failDatabase = false }
})
