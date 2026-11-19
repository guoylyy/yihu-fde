// 集成测试 - 0.5.1 上传对话文件 POST /api/devlog/upload(multipart files[])
// 覆盖: 多文件 / 单文件、坏文件不影响好文件、同文件二次上传不新增、zst / gz 解压、无 sessionId 的 jsonl、格式识别失败文案、50MB 上限、
//       通用 markdown / json、阶段与项目、管理员指派、审计 DEVLOG_UPLOAD。账号 / 项目现建现删
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import zlib from 'node:zlib'
import prisma from '../../src/lib/prisma.js'
import { login, api, uniqName, createTestUser, BASE } from './helpers.js'

const UNKNOWN = '识别不出格式：期望 Claude Code 的 .jsonl（每行含 sessionId + type + message）、Codex 的 rollout 日志，或带「用户:/助手:」标记的 .md/.txt'

/** multipart 上传: files = [[文件名, 内容(string|Buffer)]], fields = 其它表单字段 */
async function upload(token, files, fields = {}) {
  const fd = new FormData()
  for (const [name, content] of files) fd.append('files', new Blob([content]), name)
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v))
  const r = await fetch(`${BASE}/api/devlog/upload`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd })
  const text = await r.text()
  let d
  try { d = JSON.parse(text) } catch { d = { message: text } }
  return { status: r.status, code: d.code, message: d.message, data: d.data }
}

const claudeJsonl = (sessionId, run, n = 3) => Array.from({ length: n }, (_, i) => [
  JSON.stringify({ type: 'user', sessionId, timestamp: `2026-11-18T08:0${i}:00.000Z`, cwd: '/tmp/demo', gitBranch: 'feat/upload', message: { role: 'user', content: `${run} 第 ${i + 1} 个问题：帮我看下 src/upload.js 为什么报错` } }),
  JSON.stringify({ type: 'assistant', sessionId, timestamp: `2026-11-18T08:0${i}:30.000Z`, message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: '决定用内存存储，不落盘。' }, { type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'npm test' } }] } })
].join('\n')).join('\n') + '\n'

const codexJsonl = (id, run) => [
  { timestamp: '2026-11-18T09:00:00.000Z', type: 'session_meta', payload: { id, cwd: '/tmp/codex', git: { branch: 'main' } } },
  { timestamp: '2026-11-18T09:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } },
  { timestamp: '2026-11-18T09:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `${run} 给导入脚本加重试` }] } },
  { timestamp: '2026-11-18T09:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已加上三次重试。' }] } }
].map((o) => JSON.stringify(o)).join('\n') + '\n'

const markdown = (run) => `# 排查记录\n\n用户: ${run} 列表页为什么慢？\n助手: 少了索引，加上 (project_id, created_at) 即可。\n用户: 好的\n助手: 已经加好了。\n`

describe('上传对话文件 /api/devlog/upload', () => {
  let adminToken, admin, E, O, customerId, projectId, engineerId
  const RUN = `up${Date.now().toString(36)}${process.pid}`
  const convIds = []
  const track = (r) => { for (const it of r.data?.items || []) convIds.push(BigInt(it.conversationId)) }

  before(async () => {
    adminToken = await login('admin')
    admin = api(adminToken)
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-上传工程师' })
    O = await createTestUser('FDE_ENGINEER', { name: 'unit-test-上传旁人' })
    engineerId = String((await prisma.engineer.findUnique({ where: { userId: BigInt(E.id) } })).id)
    const c = await admin.post('/api/fde/customers', { name: uniqName('上传客户'), industry: 'X' })
    assert.equal(c.code, 0, c.message)
    customerId = c.data.id
    const p = await admin.post('/api/fde/projects', { name: uniqName('上传项目'), customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
  })

  after(async () => {
    const convs = await prisma.devConversation.findMany({
      where: { OR: [{ id: { in: convIds } }, { createdBy: { in: [BigInt(E?.id || 0), BigInt(O?.id || 0)] } }] },
      select: { id: true }
    })
    await prisma.devConversation.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } })
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await E?.cleanup(); await O?.cleanup()
  })

  test('多文件: Claude Code jsonl + markdown 各出一条会话, 自动摘要, 写审计 DEVLOG_UPLOAD', async () => {
    const sid = randomUUID()
    const r = await upload(E.token, [['a.jsonl', claudeJsonl(sid, RUN)], ['笔记.md', markdown(RUN)]])
    track(r)
    assert.equal(r.status, 201, r.message)
    assert.equal(r.data.errors.length, 0, JSON.stringify(r.data.errors))
    assert.equal(r.data.items.length, 2)
    const [a, md] = r.data.items
    assert.equal(a.file, 'a.jsonl')
    assert.equal(a.ok, true)
    assert.equal(a.uid, `claude:${sid}`)
    assert.deepEqual([a.source, a.stage, a.turns, a.truncated], ['CLAUDE_CODE', 'CODING', 3, false])
    assert.match(a.title, new RegExp(RUN))
    assert.ok(a.summary && a.mode, '自动跑了摘要')
    assert.equal(md.file, '笔记.md', '中文文件名不乱码')
    assert.equal(md.source, 'PASTE')
    assert.match(md.uid, /^upload:[0-9a-f]{24}$/)
    assert.equal(md.turns, 2)
    const mdRow = await prisma.devConversation.findUnique({ where: { id: BigInt(md.conversationId) } })
    assert.ok(mdRow.startedAt && Date.now() - mdRow.startedAt.getTime() < 120_000, '没有时间戳的文本记上传时间, 列表里排在前面')

    const row = await prisma.devConversation.findUnique({ where: { id: BigInt(a.conversationId) }, include: { events: true } })
    assert.equal(String(row.createdBy), E.id)
    assert.equal(String(row.engineerId), engineerId)
    assert.equal(row.branch, 'feat/upload')
    assert.ok(row.summary, 'summary 写回了')
    assert.ok(row.events.some((e) => e.kind === 'COMMAND' && e.text === 'npm test'))

    const audit = await prisma.auditLog.findFirst({ where: { action: 'DEVLOG_UPLOAD', userId: BigInt(E.id) }, orderBy: { id: 'desc' } })
    assert.ok(audit, '有审计')
    const d = typeof audit.details === 'string' ? JSON.parse(audit.details) : audit.details
    assert.deepEqual(d.files, ['a.jsonl', '笔记.md'])
    assert.equal(d.items, 2)
    assert.deepEqual(d.sources.sort(), ['CLAUDE_CODE', 'PASTE'])
  })

  test('单文件: Codex rollout jsonl 认成 CODEX, uid=codex:<会话 id>; 带 stage/projectId 时按传入的', async () => {
    const id = randomUUID()
    const r = await upload(adminToken, [[`rollout-${RUN}.jsonl`, codexJsonl(id, RUN)]], { stage: 'test', projectId })
    track(r)
    assert.equal(r.status, 201, r.message)
    assert.equal(r.data.items.length, 1)
    const it = r.data.items[0]
    assert.deepEqual([it.uid, it.source, it.stage, it.turns], [`codex:${id}`, 'CODEX', 'TEST', 1])
    const row = await prisma.devConversation.findUnique({ where: { id: BigInt(it.conversationId) } })
    assert.equal(String(row.projectId), String(projectId))
    assert.equal(row.status, 'LINKED')
    assert.equal(row.model, 'gpt-5-codex')
  })

  test('坏文件不影响好文件: 认不出的 .log、不支持的扩展名、坏 json 各自报错, 好文件照常入库', async () => {
    const r = await upload(E.token, [
      ['bad.log', `${RUN} 这只是一段随便写的文字\n没有任何角色标记\n`],
      ['good.json', JSON.stringify({ messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: `${RUN} json 问题` }, { role: 'assistant', content: 'json 回答' }] })],
      ['virus.exe', 'MZ...'],
      ['empty.txt', '   \n']
    ])
    track(r)
    assert.equal(r.status, 201, r.message)
    assert.deepEqual(r.data.items.map((i) => [i.file, i.source, i.turns]), [['good.json', 'PASTE', 1]])
    const errs = Object.fromEntries(r.data.errors.map((e) => [e.file, e.message]))
    assert.equal(errs['bad.log'], `${UNKNOWN}。当前文件首行不是 JSON 对象：${RUN} 这只是一段随便写的文字`)
    assert.match(errs['virus.exe'], /不支持的文件类型 \.exe/)
    assert.equal(errs['empty.txt'], '文件是空的')
  })

  test('同一文件二次上传: 只更新不新增(Claude 按 sessionId, markdown 按内容哈希), 不覆盖人改过的阶段', async () => {
    const sid = randomUUID()
    const files = [['s.jsonl', claudeJsonl(sid, RUN, 2)], ['again.md', markdown(`${RUN}-again`)]]
    const r1 = await upload(E.token, files)
    track(r1)
    assert.equal(r1.status, 201, r1.message)
    assert.ok(r1.data.items.every((i) => i.created))
    const mdId = r1.data.items[1].conversationId
    await prisma.devConversation.update({ where: { id: BigInt(mdId) }, data: { stage: 'DESIGN' } })

    const r2 = await upload(E.token, files)
    assert.equal(r2.status, 200, r2.message)
    assert.deepEqual(r2.data.items.map((i) => i.created), [false, false])
    assert.deepEqual(r2.data.items.map((i) => i.conversationId), r1.data.items.map((i) => i.conversationId))
    assert.equal(await prisma.devConversation.count({ where: { uid: { in: r1.data.items.map((i) => i.uid) } } }), 2)
    assert.equal(r2.data.items[1].stage, 'DESIGN', '没指定阶段时保留原阶段')
    // 别人上传同一份内容: uid 被占用, 只报这一个文件的错
    const r3 = await upload(O.token, [files[1]])
    assert.equal(r3.data.items.length, 0)
    assert.match(r3.data.errors[0].message, /占用/)
  })

  test('zst: 内存解压后按内容识别; 解不开报「不支持该压缩格式」', async (t) => {
    if (typeof zlib.zstdCompressSync !== 'function') return t.skip('当前 Node 不带 zstd')
    const id = randomUUID()
    const zst = zlib.zstdCompressSync(Buffer.from(codexJsonl(id, `${RUN}-zst`)))
    const r = await upload(E.token, [['rollout.jsonl.zst', zst], ['broken.zst', Buffer.from('not zstd at all')]])
    track(r)
    assert.equal(r.status, 201, r.message)
    assert.deepEqual(r.data.items.map((i) => [i.file, i.uid, i.source]), [['rollout.jsonl.zst', `codex:${id}`, 'CODEX']])
    assert.equal(r.data.errors[0].file, 'broken.zst')
    assert.match(r.data.errors[0].message, /^不支持该压缩格式/)
  })

  test('格式识别失败: 给明确文案; 不认识的 jsonl 也一样', async () => {
    const r = await upload(E.token, [
      ['notes.txt', '今天天气不错\n明天开会\n'],
      ['other.jsonl', '{"foo":1}\n{"bar":2}\n']
    ])
    assert.equal(r.status, 200)
    assert.equal(r.data.items.length, 0)
    assert.deepEqual(r.data.errors, [
      { file: 'notes.txt', message: `${UNKNOWN}。当前文件首行不是 JSON 对象：今天天气不错` },
      { file: 'other.jsonl', message: `${UNKNOWN}。当前文件首行字段：foo` }
    ])
  })

  // 从 Claude Code 会话里截一段贴成 .jsonl: 没有 sessionId、content 是字符串
  const anonJsonl = (run) => [
    { type: 'user', timestamp: '2026-11-18T10:00:00Z', message: { role: 'user', content: `${run} 帮我看下这个报错` } },
    { type: 'assistant', timestamp: '2026-11-18T10:00:05Z', message: { role: 'assistant', content: '是空指针，第 42 行改一下就行' } },
    { type: 'user', timestamp: '2026-11-18T10:01:00Z', message: { role: 'user', content: '改完了，谢谢' } }
  ].map((o) => JSON.stringify(o)).join('\n') + '\n'

  test('无 sessionId 的 Claude Code 风格 jsonl: 聚成一条会话, uid=upload:<内容哈希>, 记 CLAUDE_CODE / CODING', async () => {
    const r = await upload(E.token, [['small.jsonl', anonJsonl(`${RUN}-anon`)]])
    track(r)
    assert.equal(r.status, 201, r.message)
    assert.deepEqual(r.data.errors, [])
    const [it] = r.data.items
    assert.ok(it.ok)
    assert.match(it.uid, /^upload:[0-9a-f]{24}$/)
    assert.ok(it.turns >= 1 && it.turns <= 2, `turns=${it.turns}`)
    assert.equal(it.source, 'CLAUDE_CODE')
    const c = await prisma.devConversation.findUnique({ where: { id: BigInt(it.conversationId) } })
    assert.equal(c.startedAt.toISOString(), '2026-11-18T10:00:00.000Z')
    assert.equal(c.endedAt.toISOString(), '2026-11-18T10:01:00.000Z')
  })

  test('无 sessionId 的同一文件传两次: 只更新不新增', async () => {
    const file = ['twice.jsonl', anonJsonl(`${RUN}-twice`)]
    const r1 = await upload(E.token, [file])
    track(r1)
    assert.equal(r1.status, 201, r1.message)
    assert.equal(r1.data.items[0].created, true)
    const r2 = await upload(E.token, [file])
    assert.equal(r2.status, 200, r2.message)
    assert.equal(r2.data.items[0].created, false)
    assert.equal(r2.data.items[0].conversationId, r1.data.items[0].conversationId)
    assert.equal(await prisma.devConversation.count({ where: { uid: r1.data.items[0].uid } }), 1)
  })

  test('gz: 内存解压后按内容识别; 解不开报「不支持该压缩格式」', async () => {
    const sid = randomUUID()
    const gz = zlib.gzipSync(Buffer.from(claudeJsonl(sid, `${RUN}-gz`, 2)))
    const r = await upload(E.token, [['session.jsonl.gz', gz], ['broken.gz', Buffer.from('not gzip at all')]])
    track(r)
    assert.equal(r.status, 201, r.message)
    assert.deepEqual(r.data.items.map((i) => [i.file, i.ok, i.uid, i.source, i.turns]), [['session.jsonl.gz', true, `claude:${sid}`, 'CLAUDE_CODE', 2]])
    assert.equal(r.data.errors[0].file, 'broken.gz')
    assert.match(r.data.errors[0].message, /^不支持该压缩格式/)
  })

  test('超过 50MB: 只拒这一个文件, 提示用 CLI import; 其它文件照常', async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 10, 0x61)
    const r = await upload(E.token, [['huge.jsonl', big], ['ok.md', markdown(`${RUN}-big`)]])
    track(r)
    assert.equal(r.data.items.length, 1)
    assert.equal(r.data.items[0].file, 'ok.md')
    assert.equal(r.data.errors[0].file, 'huge.jsonl')
    assert.match(r.data.errors[0].message, /超过 50\.0MB 上限.*yh-devlog import/)
  })

  test('权限与参数: 未登录 401; 没文件 / 坏 stage 400; 工程师不能指派给别人, 管理员可以', async () => {
    assert.equal((await upload(null, [['a.md', markdown(RUN)]])).status, 401)
    assert.equal((await upload(E.token, [])).status, 400)
    assert.equal((await upload(E.token, [['a.md', markdown(RUN)]], { stage: 'nope' })).status, 400)
    assert.equal((await upload(O.token, [['a.md', markdown(RUN)]], { engineerId })).status, 403)
    const r = await upload(adminToken, [['assign.md', markdown(`${RUN}-assign`)]], { engineerId })
    track(r)
    assert.equal(r.status, 201, r.message)
    const row = await prisma.devConversation.findUnique({ where: { id: BigInt(r.data.items[0].conversationId) } })
    assert.equal(String(row.engineerId), engineerId)
    const many = Array.from({ length: 21 }, (_, i) => [`m${i}.md`, 'x'])
    const tooMany = await upload(E.token, many)
    assert.equal(tooMany.status, 400)
    assert.match(tooMany.message, /最多上传 20 个/)
  })
})
