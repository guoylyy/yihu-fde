// 集成测试 - 0.5.0 第 2 轮: 经验条目(自动草稿/详情/修改) + AI 摘要规则降级 + Obsidian 单向同步
// vault 指向 os.tmpdir()/fde-vault-test/<本次运行>(经系统设置 obsidianVaultPath), 跑完恢复默认并删目录。
// 要求后端以 FDE_LLM_STUB=1 启动(与 assistant/devlog 一致), 摘要必走规则。账号 / 项目现建现删
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import prisma from '../../src/lib/prisma.js'
import { login, api, uniqName, createTestUser } from './helpers.js'

const RUN = `ux${Date.now().toString(36)}`
// 每次运行一个子目录: 并行的另一次运行(别的工作区/会话)清理时不会删掉本次的文件
const VAULT_PARENT = path.join(os.tmpdir(), 'fde-vault-test')
const VAULT = path.join(VAULT_PARENT, RUN)
const listMd = async (dir) => (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.md'))

describe('经验条目 + Obsidian 同步', () => {
  let admin, E, e, O, o, customerId, projectId, projectName
  const setVault = (v) => admin.put('/api/fde/system-settings', { values: { obsidianVaultPath: v } })
  const report = (conversations) => e.post('/api/devlog/conversations', { conversations })
  const projectDir = () => path.join(VAULT, '07.FDE经验', projectName)

  const BODY = [
    { role: 'user', content: `${RUN} 华丰日期解析报错了，帮我看下 src/main/DateUtil.java。` },
    { role: 'assistant', content: '报错原因是 SimpleDateFormat 线程不安全。\n决定改成 DateTimeFormatter，因为它不可变。' },
    { role: 'user', content: '好，跑测试再提交' },
    { role: 'assistant', content: '已提交 commit 1a2b3c4d，测试用例全过。' }
  ]

  before(async () => {
    admin = api(await login('admin'))
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-经验工程师' })
    O = await createTestUser('FDE_ENGINEER', { name: 'unit-test-经验旁人' })
    e = api(E.token); o = api(O.token)
    const c = await admin.post('/api/fde/customers', { name: uniqName('经验客户'), industry: 'X' })
    assert.equal(c.code, 0, c.message)
    customerId = c.data.id
    projectName = uniqName('经验项目')
    const p = await admin.post('/api/fde/projects', { name: projectName, customerId })
    assert.equal(p.code, 0, p.message)
    projectId = p.data.id
    projectName = p.data.name
    const m = await admin.post(`/api/fde/projects/${projectId}/members`, { userId: E.id, roleInProject: 'DEV' })
    assert.equal(m.code, 0, m.message)
    await fs.rm(VAULT, { recursive: true, force: true })
    const s = await setVault(VAULT)
    assert.equal(s.code, 0, s.message)
  })

  after(async () => {
    await setVault(null)
    const users = [BigInt(E?.id || 0), BigInt(O?.id || 0)]
    await prisma.devExperience.deleteMany({ where: { OR: [{ createdBy: { in: users } }, { projectId: projectId ? BigInt(projectId) : -1n }] } })
    await prisma.devConversation.deleteMany({ where: { OR: [{ uid: { startsWith: RUN } }, { createdBy: { in: users } }] } })
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
    await E?.cleanup(); await O?.cleanup()
    await fs.rm(VAULT, { recursive: true, force: true })
    await fs.rmdir(VAULT_PARENT).catch(() => {})   // 别的运行还在用就留着
  })

  async function newConv(suffix, extra = {}) {
    const r = await report([{ uid: `${RUN}-${suffix}`, source: 'CLAUDE_CODE', projectId, title: `${RUN} ${suffix}`, body: BODY, ...extra }])
    assert.equal(r.data.created, 1, JSON.stringify(r.data.errors))
    return r.data.items[0].id
  }

  test('summarize: 模型不可用走 rules, summary 非空; 决策/坑/产出按句首关键词抽; GENERAL 才回填阶段建议', async () => {
    const id = await newConv('sum')
    const s = await e.post(`/api/dev/conversations/${id}/summarize`)
    assert.equal(s.code, 0, s.message)
    assert.equal(s.data.mode, 'rules')
    assert.ok(s.data.summary.trim(), 'summary 非空')
    assert.ok(s.data.reason, '规则模式带降级原因')
    assert.deepEqual(s.data.decisions, ['决定改成 DateTimeFormatter，因为它不可变。'])
    assert.deepEqual(s.data.pitfalls, ['报错原因是 SimpleDateFormat 线程不安全。'])
    assert.ok(s.data.artifacts.includes('src/main/DateUtil.java') && s.data.artifacts.includes('commit 1a2b3c4d'), s.data.artifacts.join(','))
    assert.equal(s.data.stageSuggestion, 'TEST')
    assert.equal(s.data.stageApplied, true)
    const row = await prisma.devConversation.findUnique({ where: { id: BigInt(id) } })
    assert.equal(row.stage, 'TEST', 'GENERAL 按建议回填')
    assert.equal(row.summary, s.data.summary)
    assert.deepEqual(row.decisions, s.data.decisions)
    assert.deepEqual(row.pitfalls, s.data.pitfalls)

    // 人选过阶段的不覆盖
    const id2 = await newConv('sum-coding', { stage: 'DESIGN' })
    const s2 = await e.post(`/api/dev/conversations/${id2}/summarize`)
    assert.equal(s2.data.stageSuggestion, 'TEST')
    assert.equal(s2.data.stageApplied, false)
    assert.equal((await prisma.devConversation.findUnique({ where: { id: BigInt(id2) } })).stage, 'DESIGN')
  })

  let expId
  test('from-conversation auto: 由摘要生成草稿并回指 conversationId; preview 不落库; 人填的字段优先', async () => {
    const convId = await newConv('auto')
    const before = await prisma.devExperience.count({ where: { conversationId: BigInt(convId) } })
    const pv = await e.post('/api/experience/from-conversation', { conversationId: convId, auto: true, preview: true })
    assert.equal(pv.code, 0, pv.message)
    assert.equal(pv.data.conversationId, convId)
    assert.equal(await prisma.devExperience.count({ where: { conversationId: BigInt(convId) } }), before, 'preview 不落库')
    assert.equal(pv.data.title, `${RUN} 华丰日期解析报错了，帮我看下 src/main/DateUtil.java`)
    assert.equal(pv.data.kind, 'EXPERIENCE', '既有决策又有坑')
    assert.match(pv.data.body, /## 决策\n\n- 决定改成 DateTimeFormatter/)
    assert.match(pv.data.body, /## 踩坑\n\n- 报错原因是/)
    assert.match(pv.data.body, /## 产出\n\n- `src\/main\/DateUtil\.java`/)

    const c = await e.post('/api/experience/from-conversation', { conversationId: convId, auto: true, kind: 'pitfall', tags: ['日期解析', 'spring-boot'] })
    assert.equal(c.status, 201, c.message)
    expId = c.data.id
    assert.equal(c.data.auto, true)
    assert.equal(String(c.data.conversationId), convId, '回指会话')
    assert.equal(String(c.data.projectId), String(projectId))
    assert.equal(c.data.kind, 'PITFALL', '人填的 kind 优先')
    assert.equal(c.data.title, pv.data.title)
    assert.equal(c.data.body, pv.data.body)

    const d = await e.get(`/api/experience/${expId}`)
    assert.equal(d.code, 0, d.message)
    assert.equal(d.data.conversation.id, convId, '详情能点回会话')
    assert.equal(d.data.conversation.visible, true)
    assert.ok(d.data.conversation.summary, '带来源会话摘要')
    assert.equal(d.data.projectName, projectName)
    assert.equal(d.data.obsidianPath, null)
    assert.equal(d.data.canEdit, true)
    // 旁人看得到经验, 但看不到别人会话的摘要
    const od = await o.get(`/api/experience/${expId}`)
    assert.deepEqual(od.data.conversation, { id: convId, visible: false })
    assert.equal(od.data.canEdit, false)
    assert.equal((await e.get('/api/experience/999999999999')).status, 404)
  })

  test('sync-obsidian: 生成文件, frontmatter 字段齐全; 再同步不增文件; 改标题后仍只有一个文件', async () => {
    const r = await e.post(`/api/experience/${expId}/sync-obsidian`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.ok, true, r.data.error)
    const exp = await prisma.devExperience.findUnique({ where: { id: BigInt(expId) } })
    const day = new Date(exp.createdAt.getTime() + 8 * 3600e3).toISOString().slice(0, 10)
    assert.equal(path.dirname(r.data.path), projectDir())
    assert.ok(path.basename(r.data.path).startsWith(`${day}-${RUN}-华丰日期解析报错了`), r.data.path)
    assert.ok([...path.basename(r.data.path, '.md').slice(11)].length <= 60, '标题 slug 截 60 字')
    assert.equal(exp.obsidianPath, r.data.path)
    assert.ok(exp.syncedAt)

    const md = await fs.readFile(r.data.path, 'utf8')
    const fm = md.match(/^---\n([\s\S]*?)\n---\n/)[1]
    const fields = Object.fromEntries(fm.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
    assert.deepEqual(Object.keys(fields), ['fde_id', 'kind', 'project', 'conversation_id', 'tags', 'reusable_level', 'created_at'])
    assert.equal(fields.fde_id, String(expId))
    assert.equal(fields.kind, 'PITFALL')
    assert.equal(fields.project, projectName.includes(' ') || /[:#]/.test(projectName) ? JSON.stringify(projectName) : projectName)
    assert.equal(fields.conversation_id, String(exp.conversationId))
    assert.equal(fields.tags, '[日期解析, spring-boot]')
    assert.equal(fields.reusable_level, '2')
    assert.match(fields.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+08:00$/)
    assert.ok(md.includes(`\n# ${exp.title}\n`))
    assert.match(md, /\n## 来源\n- 会话：.+（Claude Code \/ 测试 \/ \d{4}-\d\d-\d\d \d\d:\d\d）\n- 项目：/)

    const n1 = (await listMd(projectDir())).length
    const again = await e.post(`/api/experience/${expId}/sync-obsidian`)
    assert.equal(again.data.ok, true)
    assert.equal(again.data.path, r.data.path)
    assert.equal((await listMd(projectDir())).length, n1, '再同步一次文件数不增加')

    const p = await e.patch(`/api/experience/${expId}`, { title: `${RUN} 改过的标题`, reusableLevel: 4 })
    assert.equal(p.code, 0, p.message)
    const r3 = await e.post(`/api/experience/${expId}/sync-obsidian`)
    assert.equal(r3.data.ok, true)
    assert.notEqual(r3.data.path, r.data.path)
    assert.equal((await listMd(projectDir())).length, n1, '换了文件名也不留旧副本')
    assert.match(await fs.readFile(r3.data.path, 'utf8'), /reusable_level: 4\n/)
    assert.equal((await e.get(`/api/experience/${expId}`)).data.obsidianPath, r3.data.path)

    // 只有本人/管理员能改和同步
    assert.equal((await o.post(`/api/experience/${expId}/sync-obsidian`)).status, 403)
    assert.equal((await o.patch(`/api/experience/${expId}`, { title: 'x' })).status, 403)
  })

  test('同日同名的两条经验各写各的文件, 不互相覆盖', async () => {
    const convId = await newConv('dup')
    const mk = () => e.post('/api/experience/from-conversation', { conversationId: convId, title: `${RUN} 同名`, body: 'b' })
    const [a, b] = [await mk(), await mk()]
    const ra = await e.post(`/api/experience/${a.data.id}/sync-obsidian`)
    const rb = await e.post(`/api/experience/${b.data.id}/sync-obsidian`)
    assert.ok(ra.data.ok && rb.data.ok)
    assert.notEqual(ra.data.path, rb.data.path)
    assert.ok(rb.data.path.endsWith(`-${b.data.id}.md`), rb.data.path)
    assert.match(await fs.readFile(ra.data.path, 'utf8'), new RegExp(`^---\\nfde_id: ${a.data.id}\\n`))
    // 再同步 a 仍是原文件
    assert.equal((await e.post(`/api/experience/${a.data.id}/sync-obsidian`)).data.path, ra.data.path)
  })

  test('写入失败返回 ok:false, 数据库记录不回滚', async () => {
    const convId = await newConv('fail')
    const c = await e.post('/api/experience/from-conversation', { conversationId: convId, title: `${RUN} 失败`, body: 'b' })
    const blocker = path.join(os.tmpdir(), `fde-vault-blocker-${RUN}`)
    await fs.writeFile(blocker, 'x')   // vault 指向一个文件, mkdir 必失败
    try {
      assert.equal((await setVault(blocker)).code, 0)
      const r = await e.post(`/api/experience/${c.data.id}/sync-obsidian`)
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.ok, false)
      assert.ok(r.data.error)
      const row = await prisma.devExperience.findUnique({ where: { id: BigInt(c.data.id) } })
      assert.ok(row && !row.deletedAt, '记录还在')
      assert.equal(row.obsidianPath, null)
      assert.equal(row.syncedAt, null)
    } finally {
      await setVault(VAULT)
      await fs.rm(blocker, { force: true })
    }
  })

  test('sync-all(管理员): 返回 { synced, skipped, failed }, 已是最新的跳过', async () => {
    assert.equal((await e.post('/api/experience/sync-all', { projectId })).status, 403)
    const r1 = await admin.post('/api/experience/sync-all', { projectId })
    assert.equal(r1.code, 0, r1.message)
    const total = await prisma.devExperience.count({ where: { projectId: BigInt(projectId), deletedAt: null } })
    assert.equal(r1.data.failed, 0, JSON.stringify(r1.data.errors))
    assert.equal(r1.data.synced + r1.data.skipped, total)
    assert.ok(r1.data.synced >= 1, '上一条写失败的会被补同步')
    const files = (await listMd(projectDir())).length
    assert.equal(files, total, '每条经验一个文件')
    const r2 = await admin.post('/api/experience/sync-all', { projectId })
    assert.deepEqual([r2.data.synced, r2.data.skipped, r2.data.failed], [0, total, 0])
    // 改过的条目再补同步
    await e.patch(`/api/experience/${expId}`, { body: '改了正文' })
    const r3 = await admin.post('/api/experience/sync-all', { projectId })
    assert.deepEqual([r3.data.synced, r3.data.skipped], [1, total - 1])
    assert.equal((await listMd(projectDir())).length, files)
  })

  test('只写 07.FDE经验/ 之下', async () => {
    const top = await fs.readdir(VAULT)
    assert.deepEqual(top, ['07.FDE经验'])
  })
})
