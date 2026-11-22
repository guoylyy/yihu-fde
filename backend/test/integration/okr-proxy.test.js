// 集成测试 - OKR 2.0 第一轮: 主管代管 / 替员工导入文档 / 全员可见(主管分不外露) / 个人统计
//
// 用远期测试周(2081–2089 年随机一周, 与 okr.test.js 的 2091–2097 错开, 并行跑互不清理对方的周期);
// 迟交用 2001–2009 年一个被重开的过去周。团队与账号现建现删。
//
// 人物: 团队甲 = 经理 M + 组长 L + 工程师 A、B; 团队乙 = 工程师 X(M 管不到); 老板 O(ADMIN)
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, BASE, uniqName, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const WEEK = { year: rnd(2081, 2089), weekNo: rnd(2, 50) }
const WK = weekKey(WEEK)
const PAST = { year: rnd(2001, 2009), weekNo: rnd(2, 50) }
const createdCycles = []

async function makeCycle(week, data = {}) {
  const { start, end } = weekRange(week.year, week.weekNo)
  const c = await prisma.okrCycle.upsert({
    where: { year_weekNo: { year: week.year, weekNo: week.weekNo } },
    update: data,
    create: { year: week.year, weekNo: week.weekNo, startDate: start, endDate: end, status: 'PLANNING', ...data }
  })
  createdCycles.push(c.id)
  return c
}

const setStatus = (week, status) => prisma.okrCycle.update({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } }, data: { status } })

async function dropCycles(ids) {
  const where = { cycleId: { in: ids } }
  const oids = (await prisma.okrObjective.findMany({ where, select: { id: true } })).map(o => o.id)
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await dropPlanTrail(ids)
  await prisma.okrCycle.deleteMany({ where: { id: { in: ids } } })
}

const plan = (n = 2, tag = 'proxy') => Array.from({ length: n }, (_, i) => ({
  title: `unit-test-${tag}-O${i + 1}`,
  keyResults: [
    { title: `O${i + 1}-KR1 交付件数`, metricType: 'NUMBER', targetValue: 4, unit: '个' },
    { title: `O${i + 1}-KR2 上线`, metricType: 'BINARY' }
  ]
}))

const REPORT = [
  '# 本周计划 · 第 47 周',
  '## 一、本周目标',
  '- 【P0】订单模块上线并交试点门店试用 ｜ 项目：示例甲 ｜ 完成标准：周三开发自测走通全流程；周四上线交试点门店实际跑一轮。',
  '- 【P1】客户问题收口 ｜ 项目：示例乙 ｜ 完成标准：群内问题逐条回应，本周遗留项清零。'
]

/** 现拼一个最小的 .docx(一段一行), 正文就是 lines */
async function makeDocx(lines) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = lines.map(l => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** multipart 上传到 draft-from-file */
async function upload(token, { name, content, type = 'application/octet-stream', fields = {} }) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  fd.append('file', new Blob([content], { type }), name)
  const r = await fetch(`${BASE}/api/okr/plan/draft-from-file`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
  const raw = await r.json().catch(() => null)
  return { status: r.status, code: raw?.code, message: raw?.message, data: raw?.data, raw }
}

const noManagerScore = body => !JSON.stringify(body).includes('managerScore') && !JSON.stringify(body).includes('managerComment')

describe('OKR 2.0 第一轮: 主管代管 / 导入 / 全员可见 / 统计', () => {
  let M, L, A, B, X, O, m, l, a, b, x, boss
  const teams = []

  before(async () => {
    M = await createTestUser('MANAGER', { name: 'unit-test-经理M' })
    L = await createTestUser('TEAM_LEAD', { name: 'unit-test-组长L' })
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-工程师A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-工程师B' })
    X = await createTestUser('FDE_ENGINEER', { name: 'unit-test-外组X' })
    O = await createTestUser('ADMIN', { name: 'unit-test-老板O' })
    m = api(M.token); l = api(L.token); a = api(A.token); b = api(B.token); x = api(X.token); boss = api(O.token)
    const t1 = await prisma.team.create({ data: { name: uniqName('okr甲').slice(0, 50) } })
    const t2 = await prisma.team.create({ data: { name: uniqName('okr乙').slice(0, 50) } })
    teams.push(t1.id, t2.id)
    for (const u of [M, L, A, B]) await prisma.teamMembership.create({ data: { teamId: t1.id, userId: BigInt(u.id) } })
    await prisma.teamMembership.create({ data: { teamId: t2.id, userId: BigInt(X.id) } })
    await makeCycle(WEEK)
  })

  after(async () => {
    await dropCycles(createdCycles)
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: teams } } })
    await prisma.team.deleteMany({ where: { id: { in: teams } } })
    for (const u of [M, L, A, B, X, O]) await u?.cleanup()
  })

  describe('代管: 计划 / 进展 / 自评', () => {
    test('MANAGER 用 targetUserId 替下属建计划、改计划、代提交 → 200, operatorId=经理, 下属自己能看到', async () => {
      const saved = await m.post(`/api/okr/plan?week=${WK}`, { targetUserId: A.id, objectives: plan(2) })
      assert.equal(saved.code, 0, saved.message)
      assert.equal(saved.data.owner.id, A.id)
      assert.deepEqual(saved.data.onBehalfOf, { ownerId: A.id, operatorId: M.id })
      // 改: 改标题再提交
      const objs = saved.data.objectives.map(o => ({ ...o, title: o.title + '-经理改' }))
      const sub = await m.post(`/api/okr/plan/submit?week=${WK}`, { targetUserId: A.id, objectives: objs })
      assert.equal(sub.code, 0, sub.message)
      assert.equal(sub.data.submittedByOperator, true)
      const rows = await prisma.okrObjective.findMany({ where: { ownerId: BigInt(A.id), cycle: { year: WEEK.year, weekNo: WEEK.weekNo } } })
      assert.equal(rows.length, 2)
      for (const r of rows) {
        assert.equal(String(r.operatorId), M.id)
        assert.equal(r.submittedByOperator, true)
        assert.ok(r.submittedAt)
        assert.match(r.title, /-经理改$/)
      }
      assert.equal(await prisma.okrObjective.count({ where: { ownerId: BigInt(M.id), cycle: { year: WEEK.year, weekNo: WEEK.weekNo } } }), 0, '没写到经理自己名下')
      const mine = await a.get(`/api/okr/my?week=${WK}`)
      assert.equal(mine.data.objectives.length, 2)
      assert.equal(mine.data.objectives[0].onBehalfOf.id, M.id)
      assert.equal(mine.data.objectives[0].submittedByOperator, true)
      assert.match(mine.data.objectives[0].title, /-经理改$/)
    })

    test('MANAGER 代追加进展 / 改 KR / 改自评 → 记 operatorId, 自评仍记在本人名下', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const u = await m.post(`/api/okr/objectives/${o.id}/updates`, { targetUserId: A.id, content: '经理代填: 已交付 2 个', krId: o.keyResults[0].id, valueAfter: 2 })
      assert.equal(u.code, 0, u.message)
      assert.equal(u.data.operatorId, M.id)
      assert.deepEqual(u.data.onBehalfOf, { ownerId: A.id, operatorId: M.id })
      const k = await m.patch(`/api/okr/krs/${o.keyResults[1].id}`, { targetUserId: A.id, status: 'DONE' })
      assert.equal(k.code, 0, k.message)
      assert.equal(k.data.operatorId, M.id)
      await setStatus(WEEK, 'IN_PROGRESS')
      // OKR 3.0 自评前置: 这周每条 KR 都要处理完 —— 第二个 O 的 KR 由经理代标「未完成」
      const o2 = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[1]
      for (const kr of o2.keyResults) assert.equal((await m.post(`/api/okr/krs/${kr.id}/complete`, { targetUserId: A.id, done: false })).code, 0)
      const s = await m.post('/api/okr/self-score', { targetUserId: A.id, objectiveId: o.id, score: 77 })
      assert.equal(s.code, 0, s.message)
      const row = await prisma.okrScore.findUnique({ where: { id: BigInt(s.data.id) } })
      assert.equal(String(row.scorerId), A.id)
      assert.equal(String(row.operatorId), M.id)
      const detail = await a.get(`/api/okr/cycle?week=${WK}`)
      const od = detail.data.objectives.find(v => v.id === o.id)
      assert.equal(od.selfScore, 77)
      assert.equal(od.keyResults[0].currentValue, 2)
      assert.ok(od.updates.length >= 2)
      assert.ok(od.updates.every(v => v.onBehalfOf?.id === M.id))
      assert.equal(od.scores.find(v => v.role === 'SELF').onBehalfOf.id, M.id)
    })

    test('组长(TEAM_LEAD)代管本组成员 → 200; 能力位 can.proxy=true', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[1]
      const u = await l.post(`/api/okr/objectives/${o.id}/updates`, { targetUserId: A.id, content: '组长代填一条' })
      assert.equal(u.code, 0, u.message)
      assert.equal(u.data.operatorId, L.id)
      const view = await l.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
      assert.equal(view.data.can.proxy, true)
      assert.equal(view.data.can.edit, true)
    })

    test('FDE_ENGINEER 用 targetUserId 改别人的 → 403', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const r1 = await b.post(`/api/okr/plan?week=${WK}`, { targetUserId: A.id, objectives: plan(1) })
      assert.equal(r1.status, 403)
      assert.equal(r1.code, 8114)
      assert.match(r1.message, /无权操作他人的 OKR/)
      assert.equal((await b.post(`/api/okr/objectives/${o.id}/updates`, { targetUserId: A.id, content: 'x' })).status, 403)
      assert.equal((await b.patch(`/api/okr/krs/${o.keyResults[0].id}`, { targetUserId: A.id, currentValue: 3 })).status, 403)
      assert.equal((await b.post('/api/okr/self-score', { targetUserId: A.id, objectiveId: o.id, score: 10 })).status, 403)
      // 不带 targetUserId 直接改别人的 O 也照旧 403
      assert.equal((await b.post(`/api/okr/objectives/${o.id}/updates`, { content: 'x' })).status, 403)
      const view = await b.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
      assert.equal(view.data.can.proxy, false)
      assert.equal(view.data.can.edit, false)
    })

    test('MANAGER 改别的团队成员的 OKR → 403', async () => {
      const r = await m.post(`/api/okr/plan?week=${WK}`, { targetUserId: X.id, objectives: plan(1) })
      assert.equal(r.status, 403)
      assert.equal(r.code, 8114)
      assert.equal(await prisma.okrObjective.count({ where: { ownerId: BigInt(X.id) } }), 0)
      // X 自己交了之后, 经理也改不了他的进展
      assert.equal((await x.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan(1, 'x') })).code, 0)
      const xo = (await x.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      assert.equal((await m.post(`/api/okr/objectives/${xo.id}/updates`, { targetUserId: X.id, content: 'x' })).status, 403)
    })

    test('targetUserId 与 O 的主人对不上 → 403; 助手不能代管 → 403', async () => {
      const xo = (await x.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      // 经理拿下属 A 的身份去改外组 X 的 O
      const r = await m.post(`/api/okr/objectives/${xo.id}/updates`, { targetUserId: A.id, content: 'x' })
      assert.equal(r.status, 403)
      const { signToken } = await import('../../src/lib/auth.js')
      const asAssistant = api(signToken({ type: 'internal', userId: M.id, username: M.username, role: 'MANAGER', via: 'mcp' }))
      const ao = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const r2 = await asAssistant.post(`/api/okr/objectives/${ao.id}/updates`, { targetUserId: A.id, content: 'x' })
      assert.equal(r2.status, 403)
      assert.equal(r2.code, 8120)
    })

    // 0.5.8 起 MANAGER 可给本团队成员打主管分(见 okr-manager-score.test.js); 组长仍不放开
    test('TEAM_LEAD 调 manager-score → 403(组长能看不能评)', async () => {
      const o = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0]
      const lr = await l.post('/api/okr/manager-score', { objectiveId: o.id, score: 90 })
      assert.equal(lr.status, 403, '组长也不能打主管分')
      const row = await prisma.okrObjective.findUnique({ where: { id: BigInt(o.id) } })
      assert.equal(row.managerScore, null)
    })

    test('MANAGER 能提交自己的计划(主管也要交 OKR)', async () => {
      const r = await m.post(`/api/okr/plan/submit?week=${WK}`, { objectives: plan(1, 'mgr') })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.owner.id, M.id)
      assert.equal(r.data.onBehalfOf, null)
      assert.equal(r.data.submittedByOperator, false)
      assert.ok(r.data.objectives[0].submittedAt)
      const row = await prisma.okrObjective.findFirst({ where: { ownerId: BigInt(M.id) } })
      assert.equal(row.operatorId, null)
      assert.equal(row.submittedByOperator, false)
    })

    test('代提交过了截止 → 迟交按被操作人记在他的 O 上', async () => {
      const { start, end } = weekRange(PAST.year, PAST.weekNo)
      await makeCycle(PAST, { status: 'IN_PROGRESS', closedAt: end, reopenedAt: new Date(), startDate: start, endDate: end })
      const r = await m.post(`/api/okr/plan/submit?week=${weekKey(PAST)}`, { targetUserId: B.id, objectives: plan(1, 'late') })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.lateSubmit, true)
      assert.equal(r.data.owner.id, B.id)
      const row = await prisma.okrObjective.findFirst({ where: { ownerId: BigInt(B.id), cycle: { year: PAST.year, weekNo: PAST.weekNo } } })
      assert.equal(row.lateSubmit, true)
      assert.equal(row.submittedByOperator, true)
    })
  })

  describe('替员工导入本周文档(draft-from-file)', () => {
    test('上传 .md 与 .docx → 都返回草稿结构; .docx 中文不乱码; 不落库', async () => {
      const before = await prisma.okrObjective.count({ where: { ownerId: BigInt(A.id) } })
      const md = await upload(A.token, { name: '本周计划.md', content: REPORT.join('\n'), type: 'text/markdown' })
      assert.equal(md.code, 0, md.message)
      assert.equal(md.data.fileName, '本周计划.md')
      assert.ok(['model', 'rules'].includes(md.data.mode))
      assert.equal(typeof md.data.truncated, 'boolean')
      assert.ok(md.data.objectives.length >= 1)
      assert.equal(md.data.objectives.reduce((s, o) => s + o.weight, 0), 100)
      assert.equal(md.data.target.id, A.id)
      assert.equal(md.data.onBehalfOf, null)

      const docx = await upload(A.token, { name: '周报.docx', content: await makeDocx(REPORT), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      assert.equal(docx.code, 0, docx.message)
      assert.equal(docx.data.fileName, '周报.docx')
      assert.ok(docx.data.objectives.length >= 1)
      const text = JSON.stringify(docx.data.objectives)
      assert.ok(!text.includes('�'), '不含替换字符')
      if (docx.data.mode === 'rules') assert.equal(docx.data.objectives[0].title, '订单模块上线并交试点门店试用')
      else assert.match(text, /[一-鿿]/)
      assert.equal(await prisma.okrObjective.count({ where: { ownerId: BigInt(A.id) } }), before)
    })

    test('超过 2MB → 400; 非 md/txt/docx → 400; 没带文件 → 400', async () => {
      const big = await upload(A.token, { name: 'big.md', content: Buffer.alloc(2 * 1024 * 1024 + 10, 'a') })
      assert.equal(big.status, 400)
      assert.equal(big.code, 8133)
      const pdf = await upload(A.token, { name: 'plan.pdf', content: '%PDF-1.4 x' })
      assert.equal(pdf.status, 400)
      assert.equal(pdf.code, 8132)
      const r = await fetch(`${BASE}/api/okr/plan/draft-from-file`, { method: 'POST', headers: { Authorization: `Bearer ${A.token}` }, body: new FormData() })
      assert.equal(r.status, 400)
    })

    test('带 targetUserId: 草稿标注目标人; 无代管权限 → 403', async () => {
      const r = await upload(M.token, { name: 'a-week.md', content: REPORT.join('\n'), fields: { targetUserId: A.id } })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.target.id, A.id)
      assert.equal(r.data.target.name, 'unit-test-工程师A')
      assert.deepEqual(r.data.onBehalfOf, { ownerId: A.id, operatorId: M.id })
      const denied = await upload(B.token, { name: 'a-week.md', content: REPORT.join('\n'), fields: { targetUserId: A.id } })
      assert.equal(denied.status, 403)
      const outside = await upload(M.token, { name: 'x-week.md', content: REPORT.join('\n'), fields: { targetUserId: X.id } })
      assert.equal(outside.status, 403)
      // 贴文本的老接口同样支持 targetUserId
      const rep = await m.post('/api/okr/plan/draft-from-report', { text: REPORT.join('\n'), targetUserId: A.id })
      assert.equal(rep.code, 0, rep.message)
      assert.equal(rep.data.target.id, A.id)
      assert.equal((await b.post('/api/okr/plan/draft-from-report', { text: REPORT.join('\n'), targetUserId: A.id })).status, 403)
    })
  })

  describe('全员可见: 主管分只给本人、ADMIN 与本团队的经理', () => {
    let oid
    before(async () => {
      oid = (await a.get(`/api/okr/my?week=${WK}`)).data.objectives[0].id
      const r = await boss.post('/api/okr/manager-score', { objectiveId: oid, score: 88, comment: 'unit-test-主管评语' })
      assert.equal(r.code, 0, r.message)
    })

    test('ENGINEER 调 /team → 200, 响应里不含 managerScore', async () => {
      const r = await b.get(`/api/okr/team?week=${WK}`)
      assert.equal(r.status, 200)
      assert.equal(r.code, 0)
      const rowA = r.data.rows.find(v => v.user.id === A.id)
      assert.ok(rowA, '同组的 A 在列表里')
      assert.equal(rowA.objectiveCount, 2)
      assert.ok(!r.data.rows.some(v => v.user.id === X.id), '外组 X 不在本团队列表里')
      assert.ok(!JSON.stringify(r.raw).includes('managerScore'))
      assert.ok(!JSON.stringify(r.raw).includes('unit-test-主管评语'))
    })

    test('ADMIN 调 /team → 含 managerScore', async () => {
      const r = await boss.get(`/api/okr/team?week=${WK}`)
      assert.equal(r.code, 0)
      assert.ok(JSON.stringify(r.raw).includes('managerScore'))
      const rowA = r.data.rows.find(v => v.user.id === A.id)
      assert.ok(rowA.managerScore != null)
      assert.ok(r.data.rows.some(v => v.user.id === X.id), '老板看全部')
    })

    test('他人看详情不带主管分与主管评分记录; 本人与 ADMIN 带', async () => {
      const other = await b.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
      assert.equal(other.code, 0)
      assert.ok(noManagerScore(other.raw))
      assert.ok(!other.data.objectives.some(o => o.scores.some(s => s.role === 'MANAGER')))
      assert.equal(other.data.objectives.find(o => o.id === oid).selfScore, 77, '自评分照常可见')
      const mgr = await m.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
      assert.equal(mgr.data.objectives.find(o => o.id === oid).managerScore, 88, '0.5.8: 同团队经理能评也能看主管分')
      const lead = await l.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
      assert.ok(noManagerScore(lead.raw), '组长看不到主管分')
      const self = await a.get(`/api/okr/cycle?week=${WK}`)
      assert.equal(self.data.objectives.find(o => o.id === oid).managerScore, 88)
      const admin = await boss.get(`/api/okr/cycle?week=${WK}&ownerId=${A.id}`)
      assert.equal(admin.data.objectives.find(o => o.id === oid).managerComment, 'unit-test-主管评语')
    })
  })

  describe('个人汇总与统计', () => {
    test('stats scope=week: 字段齐, 数值与 /my 一致; 非本人非 ADMIN 无 managerScore', async () => {
      const my = (await a.get(`/api/okr/my?week=${WK}`)).data
      const r = await a.get(`/api/okr/stats?scope=week&week=${WK}`)
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.scope, 'week')
      assert.equal(r.data.week, WK)
      assert.equal(r.data.user.id, A.id)
      for (const k of ['submitted', 'late', 'updateCount', 'selfScore', 'managerScore', 'completion', 'objectiveCount', 'krTotal', 'krDone']) {
        assert.ok(k in r.data.summary, `summary.${k}`)
      }
      assert.equal(r.data.summary.selfScore, my.selfScore)
      assert.equal(r.data.summary.completion, my.completion)
      assert.equal(r.data.summary.late, false)
      assert.ok(r.data.summary.updateCount >= 3)
      assert.equal(r.data.objectives.length, my.objectives.length)
      for (const o of r.data.objectives) {
        const mo = my.objectives.find(v => v.id === o.id)
        assert.equal(o.selfScore, mo.selfScore)
        assert.equal(o.managerScore, mo.managerScore)
        assert.equal(typeof o.updateCount, 'number')
        for (const k of o.keyResults) {
          const mk = mo.keyResults.find(v => v.id === k.id)
          assert.equal(k.currentValue, mk.currentValue)
          assert.equal(k.targetValue, mk.targetValue)
        }
      }
      assert.equal(r.data.objectives.find(o => o.selfScore === 77).managerScore, 88)
      const other = await b.get(`/api/okr/stats?userId=${A.id}&scope=week&week=${WK}`)
      assert.equal(other.code, 0)
      assert.ok(noManagerScore(other.raw))
      assert.equal(other.data.summary.selfScore, my.selfScore)
      const admin = await boss.get(`/api/okr/stats?userId=${A.id}&scope=week&week=${WK}`)
      assert.equal(admin.data.summary.managerScore, my.managerScore)
    })

    test('stats scope=year: 按周聚合 + 年度汇总, 同一周自评与 /my 相等', async () => {
      const my = (await a.get(`/api/okr/my?week=${WK}`)).data
      const r = await a.get(`/api/okr/stats?userId=${A.id}&scope=year&year=${WEEK.year}`)
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.scope, 'year')
      assert.equal(r.data.year, WEEK.year)
      const w = r.data.weeks.find(v => v.key === WK)
      assert.ok(w, '有这一周')
      assert.equal(w.weekNo, WEEK.weekNo)
      assert.equal(w.selfScore, my.selfScore)
      assert.equal(w.committed, 4)
      assert.equal(w.done, my.objectives.flatMap(o => o.keyResults).filter(k => k.status === 'DONE').length)
      for (const k of ['weeksParticipated', 'avgSelfScore', 'committed', 'done', 'completionRate']) assert.ok(k in r.data.summary, `summary.${k}`)
      assert.equal(r.data.summary.weeksParticipated, 1)
      assert.equal(r.data.summary.avgSelfScore, my.selfScore)
      assert.equal(r.data.summary.completionRate, Math.round(w.done / w.committed * 10000) / 10000)
      const other = await b.get(`/api/okr/stats?userId=${A.id}&scope=year&year=${WEEK.year}`)
      assert.ok(noManagerScore(other.raw))
      assert.equal((await a.get('/api/okr/stats?scope=month')).status, 400)
      assert.equal((await a.get('/api/okr/stats?scope=year&year=abc')).status, 400)
    })

    test('person overview: 基本信息 / 当前周五项 / 8 周趋势 / 按年; 他人不带 managerScore', async () => {
      const r = await b.get(`/api/okr/person/${A.id}/overview`)
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.user.id, A.id)
      assert.ok(r.data.user.teams.some(t => t.id === String(teams[0])), '带所属团队')
      for (const k of ['objectiveCount', 'krCount', 'avgSelfScore', 'lateCount', 'updateCount']) assert.ok(k in r.data.current, `current.${k}`)
      assert.equal(r.data.trend.length, 8)
      const y = r.data.years.find(v => v.year === WEEK.year)
      assert.ok(y, '远期测试周所在年份也在按年聚合里')
      assert.equal(y.weeksParticipated, 1)
      assert.ok(noManagerScore(r.raw))
      const admin = await boss.get(`/api/okr/person/${A.id}/overview`)
      assert.ok('managerScore' in admin.data.current)
      assert.equal((await b.get('/api/okr/person/999999999999/overview')).status, 404)
    })
  })
})
