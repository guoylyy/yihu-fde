// 集成测试 - OKR 4.0: 项目周 OKR 文档、每日进展总结、周评分进度与催交、close-by-score 的 pendingUsers
//
// 测试年份(与其他 OKR 用例错开): 项目文档用 2041–2049 年随机一周(不需要周期);
// 每日总结 / 周状态 / 催交 / 归档用 2024 年随机一周(过去的周 —— 每日总结不能写以后的日期), 周期现建现删, 绝不碰真实周。
// 人物: 团队 T = 经理 M + 工程师 A(交了、有进展、自评完、写总结) / B(交了、没进展、没自评) / C(没交) / E(免提交, 交了);
//       外组工程师 X; 老板 O(ADMIN)。账号、团队、项目、客户都现建现删。
// 免提交名单是全局设置: 只往里加 E, 结束时只把 E 拿掉(不整份覆盖, 免得和 okr-v3 的白名单用例互相踩)。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, sleep, BASE } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'
import { EXEMPT_KEY } from '../../src/services/okrExempt.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const DOC_WEEK = { year: rnd(2041, 2049), weekNo: rnd(2, 50) }
const DOC_WK = weekKey(DOC_WEEK)
const WEEK = { year: 2024, weekNo: rnd(2, 50) }
const WK = weekKey(WEEK)
// 这一周的周三(上海日期)
const { start: WEEK_START, end: WEEK_END } = weekRange(WEEK.year, WEEK.weekNo)
const DAY = new Date(WEEK_START.getTime() + 8 * 3600 * 1000 + 2 * 86400000).toISOString().slice(0, 10)
const DAY_DATE = new Date(`${DAY}T00:00:00Z`)

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const where = { cycleId: c.id }
  const oids = (await prisma.okrObjective.findMany({ where, select: { id: true } })).map(o => o.id)
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

/** 只往全局免提交名单里加 / 减一个人(读改写, 不整份覆盖); 原来没有这行设置的, 拿掉最后一个人时把行也删掉 */
let exemptRowCreated = false
async function setExemptMember(userId, on) {
  const row = await prisma.appSetting.findUnique({ where: { key: EXEMPT_KEY } })
  let ids = []
  try { ids = JSON.parse(row?.value || '[]').map(String) } catch { ids = [] }
  const has = ids.includes(String(userId))
  if (on === has) return
  const next = on ? [...ids, String(userId)] : ids.filter(v => v !== String(userId))
  if (!row) {
    await prisma.appSetting.create({ data: { key: EXEMPT_KEY, value: JSON.stringify(next) } })
    exemptRowCreated = true
  } else if (!next.length && exemptRowCreated) {
    await prisma.appSetting.deleteMany({ where: { key: EXEMPT_KEY } })
  } else {
    await prisma.appSetting.update({ where: { key: EXEMPT_KEY }, data: { value: JSON.stringify(next) } })
  }
}

/** 现拼一个最小的 .docx(一段一行) */
async function makeDocx(lines) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const body = lines.map(l => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function upload(token, path, { name, content, type = 'application/octet-stream', fields = {} }) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  fd.append('file', new Blob([content], { type }), name)
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
  const raw = await r.json().catch(() => null)
  return { status: r.status, code: raw?.code, message: raw?.message, data: raw?.data, raw }
}

async function waitAudit(where) {
  for (let i = 0; i < 20; i++) {
    const a = await prisma.auditLog.findFirst({ where, orderBy: { id: 'desc' } })
    if (a) return a
    await sleep(50)
  }
  return null
}

const rowOf = (rows, u) => rows.find(r => r.user?.id === u.id)

describe('OKR 4.0 项目周 OKR / 每日总结 / 周评分进度与催交', () => {
  let M, A, B, C, E, X, O
  let m, a, b, c, e, x, boss
  let customer, P1, P2
  const teams = []
  const objs = {}

  before(async () => {
    M = await createTestUser('MANAGER', { name: 'unit-test-v4-经理M' })
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v4-工程师A' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v4-工程师B' })
    C = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v4-工程师C' })
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v4-免提交E' })
    X = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v4-外组X' })
    O = await createTestUser('ADMIN', { name: 'unit-test-v4-老板O' })
    m = api(M.token); a = api(A.token); b = api(B.token); c = api(C.token); e = api(E.token); x = api(X.token); boss = api(O.token)

    const t1 = await prisma.team.create({ data: { name: uniqName('v4甲').slice(0, 50) } })
    const t2 = await prisma.team.create({ data: { name: uniqName('v4乙').slice(0, 50) } })
    teams.push(t1.id, t2.id)
    for (const u of [M, A, B, C, E]) await prisma.teamMembership.create({ data: { teamId: t1.id, userId: BigInt(u.id) } })
    await prisma.teamMembership.create({ data: { teamId: t2.id, userId: BigInt(X.id) } })

    // 项目: P1(A 是成员), P2(没人写文档)
    customer = await prisma.customer.create({ data: { name: uniqName('v4客户').slice(0, 200) } })
    const code = () => `UT-V4-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`.slice(0, 50)
    P1 = await prisma.project.create({ data: { code: code(), name: uniqName('v4项目甲'), customerId: customer.id, status: 'IN_PROGRESS', createdBy: BigInt(O.id) } })
    P2 = await prisma.project.create({ data: { code: code(), name: uniqName('v4项目乙'), customerId: customer.id, status: 'IN_PROGRESS', createdBy: BigInt(O.id) } })
    await prisma.projectMember.create({ data: { projectId: P1.id, userId: BigInt(A.id) } })

    // 复盘中的测试周: A / B / E 交计划, C 不交
    await prisma.okrCycle.create({ data: { year: WEEK.year, weekNo: WEEK.weekNo, startDate: WEEK_START, endDate: WEEK_END, status: 'REVIEW' } })
    const submit = async (who, tag, krs) => {
      const r = await who.post(`/api/okr/plan/submit?week=${WK}`, { objectives: [{ title: `unit-test-v4-${tag}-O1`, keyResults: krs }] })
      assert.equal(r.code, 0, r.message)
      return r.data.objectives[0]
    }
    objs.A = await submit(a, 'A', [{ title: 'A-KR1 接口联调完成率', metricType: 'PERCENT', targetValue: 100 }, { title: 'A-KR2 上线', metricType: 'BINARY' }])
    objs.B = await submit(b, 'B', [{ title: 'B-KR1 上线', metricType: 'BINARY' }])
    objs.E = await submit(e, 'E', [{ title: 'E-KR1 上线', metricType: 'BINARY' }])

    // A 当天的进展: KR1 0 → 50 → 70(写说明) → 标完成; KR2 标完成; 然后自评
    const [k1, k2] = objs.A.keyResults
    assert.equal((await a.patch(`/api/okr/krs/${k1.id}`, { currentValue: 50 })).code, 0)
    assert.equal((await a.patch(`/api/okr/krs/${k1.id}`, { currentValue: 70, note: '联调通过' })).code, 0)
    assert.equal((await a.post(`/api/okr/krs/${k1.id}/complete`, { done: true })).code, 0)
    assert.equal((await a.post(`/api/okr/krs/${k2.id}/complete`, { done: true })).code, 0)
    assert.equal((await a.post('/api/okr/self-score', { objectiveId: objs.A.id, score: 80 })).code, 0)
    // 接口按「今天」记进展日期; 挪到测试周的周三
    await prisma.okrUpdate.updateMany({ where: { objectiveId: BigInt(objs.A.id) }, data: { date: DAY_DATE } })
  })

  after(async () => {
    await setExemptMember(E?.id, false).catch(() => {})
    await dropCycle(WEEK)
    const uids = [M, A, B, C, E, X, O].filter(Boolean).map(u => BigInt(u.id))
    await prisma.okrDailySummary.deleteMany({ where: { userId: { in: uids } } })
    const pids = [P1, P2].filter(Boolean).map(p => p.id)
    await prisma.okrProjectDoc.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.projectMember.deleteMany({ where: { projectId: { in: pids } } })
    await prisma.project.deleteMany({ where: { id: { in: pids } } })
    if (customer) await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
    await prisma.teamMembership.deleteMany({ where: { teamId: { in: teams } } })
    await prisma.team.deleteMany({ where: { id: { in: teams } } })
    for (const u of [M, A, B, C, E, X, O]) await u?.cleanup()
  })

  // ---------------------------------------------------------------- 项目周 OKR 文档

  test('项目文档: PUT → GET 取回; 同一周再 PUT 覆盖同一份, updatedBy 变成后写的人; 写审计', async () => {
    const r1 = await a.put(`/api/okr/projects/${P1.id}`, { week: DOC_WK, title: 'unit-test-v4 项目甲本周 OKR', contentMd: '# 项目甲\n\n- O1 交付订单模块' })
    assert.equal(r1.status, 200, r1.message)
    assert.equal(r1.data.created, true)
    assert.equal(r1.data.updatedBy.id, A.id)
    assert.equal(r1.data.sourceFile, null)
    const g1 = await x.get(`/api/okr/projects/${P1.id}?week=${DOC_WK}`)
    assert.equal(g1.code, 0, '登录即可读')
    assert.equal(g1.data.hasDoc, true)
    assert.equal(g1.data.doc.title, 'unit-test-v4 项目甲本周 OKR')
    assert.match(g1.data.doc.contentMd, /O1 交付订单模块/)

    const r2 = await m.put(`/api/okr/projects/${P1.id}`, { week: DOC_WK, title: 'unit-test-v4 改过', contentMd: '# 项目甲 v2\n\n- O1 改成交付支付模块' })
    assert.equal(r2.code, 0, r2.message)
    assert.equal(r2.data.created, false)
    assert.equal(r2.data.id, r1.data.id, '覆盖同一份')
    assert.equal(r2.data.updatedBy.id, M.id)
    assert.equal(r2.data.createdBy.id, A.id, '创建人不变')
    assert.equal(await prisma.okrProjectDoc.count({ where: { projectId: P1.id, year: DOC_WEEK.year, weekNo: DOC_WEEK.weekNo } }), 1)
    const g2 = await a.get(`/api/okr/projects/${P1.id}?week=${DOC_WK}`)
    assert.match(g2.data.doc.contentMd, /支付模块/)
    assert.equal(g2.data.doc.updatedBy.id, M.id)
    const audit = await waitAudit({ action: 'okr.project_doc.save', userId: BigInt(M.id) })
    assert.ok(audit, '写审计 okr.project_doc.save')
    assert.equal(audit.details.projectId, String(P1.id))
    assert.equal(audit.details.week, DOC_WK)
  })

  test('项目文档导入: .md 与 .docx 各一次 → contentMd 非空、sourceFile 正确; >2MB → 400; 非白名单类型 → 400', async () => {
    const path = `/api/okr/projects/${P1.id}/import`
    const md = await upload(A.token, path, { name: '项目甲-W.md', content: '# 项目甲 导入版\n\n- KR1 上线\n', type: 'text/markdown', fields: { week: DOC_WK } })
    assert.equal(md.status, 200, md.message)
    assert.equal(md.data.sourceFile, '项目甲-W.md')
    assert.match(md.data.contentMd, /导入版/)
    assert.equal(md.data.title, '项目甲-W', '没给 title 用文件名')

    const docx = await upload(A.token, path, { name: '项目甲周OKR.docx', content: await makeDocx(['项目甲 本周 OKR', 'O1 订单模块上线']), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fields: { week: DOC_WK, title: 'unit-test-v4 docx 导入' } })
    assert.equal(docx.status, 200, docx.message)
    assert.equal(docx.data.sourceFile, '项目甲周OKR.docx')
    assert.match(docx.data.contentMd, /O1 订单模块上线/, '.docx 中文正文抽出来了')
    assert.equal(docx.data.title, 'unit-test-v4 docx 导入')
    const row = await prisma.okrProjectDoc.findUnique({ where: { projectId_year_weekNo: { projectId: P1.id, year: DOC_WEEK.year, weekNo: DOC_WEEK.weekNo } } })
    assert.equal(row.sourceFile, '项目甲周OKR.docx')

    const big = await upload(A.token, path, { name: 'big.md', content: Buffer.alloc(2 * 1024 * 1024 + 16, 'a'), fields: { week: DOC_WK } })
    assert.equal(big.status, 400)
    assert.equal(big.code, 8133)
    const pdf = await upload(A.token, path, { name: 'x.pdf', content: '%PDF-1.4', fields: { week: DOC_WK } })
    assert.equal(pdf.status, 400)
    assert.equal(pdf.code, 8132)
    assert.equal((await prisma.okrProjectDoc.findUnique({ where: { id: row.id } })).sourceFile, '项目甲周OKR.docx', '失败的上传不改文档')

    // 手写保存会清掉附件名(内容已经不是那份文件了)
    const w = await a.put(`/api/okr/projects/${P1.id}`, { week: DOC_WK, contentMd: '# 手改\n\n正文' })
    assert.equal(w.data.sourceFile, null)
    assert.equal(w.data.title, '手改', '没给 title 取正文第一个标题')
  })

  test('项目文档权限: 非成员工程师 PUT / import → 403; 项目成员可以; 参数不对 → 400', async () => {
    const r = await x.put(`/api/okr/projects/${P1.id}`, { week: DOC_WK, contentMd: '# 越权' })
    assert.equal(r.status, 403)
    assert.equal(r.code, 8152)
    const up = await upload(X.token, `/api/okr/projects/${P1.id}/import`, { name: 'a.md', content: '# 越权', fields: { week: DOC_WK } })
    assert.equal(up.status, 403)
    // A 不是 P2 的成员
    assert.equal((await a.put(`/api/okr/projects/${P2.id}`, { week: DOC_WK, contentMd: '# x' })).status, 403)
    // 加成 P2 成员后可以
    await prisma.projectMember.create({ data: { projectId: P2.id, userId: BigInt(X.id) } })
    const ok2 = await x.put(`/api/okr/projects/${P2.id}`, { week: DOC_WK, contentMd: '# 项目乙' })
    assert.equal(ok2.status, 200, ok2.message)
    await prisma.okrProjectDoc.deleteMany({ where: { projectId: P2.id } })
    await prisma.projectMember.deleteMany({ where: { projectId: P2.id } })
    assert.equal((await a.put(`/api/okr/projects/${P1.id}`, { week: DOC_WK, contentMd: '   ' })).status, 400, '正文不能为空')
    assert.equal((await a.put(`/api/okr/projects/${P1.id}`, { week: 'bad', contentMd: '# x' })).status, 400)
    assert.equal((await a.get('/api/okr/projects/999999999?week=' + DOC_WK)).status, 404)
  })

  test('项目文档列表: 该周没文档的项目也出现(hasDoc=false), 有文档的带更新人', async () => {
    const r = await x.get(`/api/okr/projects?week=${DOC_WK}`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.week, DOC_WK)
    const p1 = r.data.rows.find(row => row.project.id === String(P1.id))
    const p2 = r.data.rows.find(row => row.project.id === String(P2.id))
    assert.ok(p1 && p2)
    assert.equal(p1.hasDoc, true)
    assert.ok(p1.updatedBy?.id)
    assert.ok(p1.updatedAt)
    assert.equal(p2.hasDoc, false)
    assert.equal(p2.updatedBy, null)
    assert.ok(r.data.rows.indexOf(p1) < r.data.rows.indexOf(p2), '有文档的排前面')
  })

  // ---------------------------------------------------------------- 每日总结

  test('每日: 有进展的人 autoItems 按 KR 归并, 文案含 O / KR 标题与变化; 没进展的人 autoItems 为空', async () => {
    const r = await m.get(`/api/okr/daily?date=${DAY}&scope=team`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.date, DAY)
    assert.equal(r.data.week, WK)
    const ra = rowOf(r.data.rows, A)
    const rb = rowOf(r.data.rows, B)
    assert.ok(ra && rb)
    assert.equal(ra.autoItems.length, 2, '两条 KR 各一行(KR1 当天两次改动归并成一行)')
    const k1 = ra.autoItems.find(i => i.krSeq === 1)
    assert.equal(k1.updateCount, 3)
    assert.match(k1.text, /^O1「unit-test-v4-A-O1」 · KR1「A-KR1 接口联调完成率」：0% → 100%（联调通过）$/)
    const k2 = ra.autoItems.find(i => i.krSeq === 2)
    assert.match(k2.text, /KR2「A-KR2 上线」：未定 → 完成/)
    assert.deepEqual(rb.autoItems, [])
    assert.equal(rb.hasWritten, false)
    assert.equal(rb.summary, null)
    assert.ok(!rowOf(r.data.rows, X), 'scope=team 只看本团队')
    // scope=me 只有自己
    const me = await a.get(`/api/okr/daily?date=${DAY}&scope=me`)
    assert.deepEqual(me.data.rows.map(row => row.user.id), [A.id])
    assert.equal((await a.get('/api/okr/daily?date=2024-02-30')).status, 400)
  })

  test('每日: PUT 总结后 hasWritten=true; 同一天再写是覆盖不是新增', async () => {
    const r1 = await a.put('/api/okr/daily', { date: DAY, summaryMd: '今天联调通过' })
    assert.equal(r1.status, 200, r1.message)
    assert.equal(r1.data.created, true)
    assert.equal(r1.data.operatorId, null)
    const r2 = await a.put('/api/okr/daily', { date: DAY, summaryMd: '今天联调通过, 明天上线' })
    assert.equal(r2.data.created, false)
    assert.equal(r2.data.id, r1.data.id)
    assert.equal(await prisma.okrDailySummary.count({ where: { userId: BigInt(A.id), date: DAY_DATE } }), 1, '唯一键生效')
    const v = await a.get(`/api/okr/daily?date=${DAY}&scope=me`)
    assert.equal(v.data.rows[0].hasWritten, true)
    assert.equal(v.data.rows[0].summary.summaryMd, '今天联调通过, 明天上线')
    assert.equal((await a.put('/api/okr/daily', { date: DAY, summaryMd: '  ' })).status, 400)
    assert.equal((await a.put('/api/okr/daily', { date: '2099-01-01', summaryMd: 'x' })).status, 400, '不能写以后的日期')
  })

  test('每日 missing: 只列交了 OKR 却没写总结的人; 没交 OKR 的、免提交名单的不出现', async () => {
    await setExemptMember(E.id, true)
    const r = await m.get(`/api/okr/daily/missing?date=${DAY}`)
    assert.equal(r.code, 0, r.message)
    const ids = r.data.rows.map(row => row.user.id)
    assert.ok(ids.includes(B.id), 'B 交了 OKR 没写')
    assert.ok(!ids.includes(A.id), 'A 写了')
    assert.ok(!ids.includes(C.id), 'C 没交 OKR')
    assert.ok(!ids.includes(E.id), 'E 免提交')
    assert.equal(r.data.count, r.data.rows.length)
    const all = await m.get(`/api/okr/daily?date=${DAY}&scope=team`)
    assert.ok(!rowOf(all.data.rows, E), '免提交名单也不出现在 daily 里')
    assert.equal((await a.get(`/api/okr/daily/missing?date=${DAY}`)).status, 403, '工程师不能看催交名单')
  })

  test('每日代写: 经理带 targetUserId 写本团队成员 → 200 且 operatorId=经理; 工程师代写别人 → 403', async () => {
    const r = await m.put('/api/okr/daily', { date: DAY, summaryMd: '经理代写: B 今天在排查客户问题', targetUserId: B.id })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.userId, B.id)
    assert.equal(r.data.operatorId, M.id)
    assert.deepEqual(r.data.onBehalfOf, { ownerId: B.id, operatorId: M.id })
    const row = await prisma.okrDailySummary.findUnique({ where: { userId_date: { userId: BigInt(B.id), date: DAY_DATE } } })
    assert.equal(String(row.operatorId), M.id)
    const v = await m.get(`/api/okr/daily?date=${DAY}&scope=team`)
    assert.equal(rowOf(v.data.rows, B).summary.onBehalfOf.id, M.id)

    const bad = await x.put('/api/okr/daily', { date: DAY, summaryMd: '越权', targetUserId: A.id })
    assert.equal(bad.status, 403)
    assert.equal(bad.code, 8114)
    // 代写的 B 已经算写了; 删掉, 后面的催交用例要 B 处于「自评没做完」
    await prisma.okrDailySummary.delete({ where: { id: row.id } })
  })

  // ---------------------------------------------------------------- 周评分进度 + 催交

  test('week/status: 没交计划 planSubmitted=false; 自评完成的 selfScored 分子=分母; 免提交标 exempt; 每日总结计数', async () => {
    await setExemptMember(E.id, true)
    const r = await m.get(`/api/okr/week/status?week=${WK}`)
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.selfScoreDue, true, '复盘中的周自评该做了')
    const [ra, rb, rc, re] = [A, B, C, E].map(u => rowOf(r.data.rows, u))
    assert.ok(ra && rb && rc && re)
    assert.equal(rc.planSubmitted, false)
    assert.deepEqual(rc.missing, ['PLAN'])
    assert.equal(ra.planSubmitted, true)
    assert.deepEqual(ra.selfScored, { done: 1, total: 1 })
    assert.deepEqual(ra.managerScored, { done: 0, total: 1 })
    assert.equal(ra.complete, true)
    assert.equal(ra.dailySummaries, 1)
    assert.deepEqual(rb.selfScored, { done: 0, total: 1 })
    assert.deepEqual(rb.missing, ['SELF_SCORE'])
    assert.equal(rb.dailySummaries, 0)
    assert.equal(re.exempt, true)
    assert.equal(re.complete, true)
    assert.ok(!rowOf(r.data.rows, X), '经理只看本团队')
    // ADMIN 看全部(含外组)
    const all = await boss.get(`/api/okr/week/status?week=${WK}`)
    assert.ok(rowOf(all.data.rows, X))
  })

  test('week/remind: 只给未完成的人发 OKR_REMIND, 已完成 / 免提交跳过; 2 小时内重复调用不重复发', async () => {
    await setExemptMember(E.id, true)
    const r = await m.post('/api/okr/week/remind', { week: WK })
    assert.equal(r.code, 0, r.message)
    const reminded = r.data.reminded.map(i => i.user.id).sort()
    assert.deepEqual(reminded, [B.id, C.id].sort())
    assert.ok(r.data.skipped.some(s => s.user?.id === E.id && s.reason === 'EXEMPT'))
    const notes = await prisma.notification.findMany({ where: { type: 'OKR_REMIND', userId: { in: [A, B, C, E].map(u => BigInt(u.id)) } } })
    assert.equal(notes.length, 2)
    const nb = notes.find(n => String(n.userId) === B.id)
    const nc = notes.find(n => String(n.userId) === C.id)
    assert.equal(nb.title, '请补充本周 OKR')
    assert.match(nb.body, /自评/)
    assert.match(nc.body, /计划/)
    assert.equal(nb.link, `/admin/okr?week=${WK}`)

    const again = await m.post('/api/okr/week/remind', { week: WK })
    assert.equal(again.code, 0)
    assert.deepEqual(again.data.reminded, [])
    assert.ok(again.data.skipped.filter(s => s.reason === 'RECENTLY_REMINDED').length === 2)
    // 点名催已完成的 A: 跳过, 不发
    const named = await m.post('/api/okr/week/remind', { week: WK, userIds: [A.id] })
    assert.deepEqual(named.data.reminded, [])
    assert.deepEqual(named.data.skipped.map(s => s.reason), ['COMPLETE'])
    assert.equal(await prisma.notification.count({ where: { type: 'OKR_REMIND', userId: { in: [A, B, C, E].map(u => BigInt(u.id)) } } }), 2, '没有重复提醒')
  })

  test('week/remind 与 week/status: 非 ADMIN/MANAGER → 403', async () => {
    const r = await a.post('/api/okr/week/remind', { week: WK })
    assert.equal(r.status, 403)
    assert.equal(r.code, 8161)
    assert.equal((await x.get(`/api/okr/week/status?week=${WK}`)).status, 403)
    assert.equal((await m.post('/api/okr/week/remind', { week: WK, userIds: 'x' })).status, 400)
  })

  test('close-by-score: 有人没交计划时返回 pendingUsers(不阻断), 免提交的不算', async () => {
    await setExemptMember(E.id, true)
    // 让 B、E 也自评, 老板给交了的 O 都打完主管分
    for (const [who, o] of [[b, objs.B], [e, objs.E]]) {
      assert.equal((await who.post(`/api/okr/krs/${o.keyResults[0].id}/complete`, { done: true })).code, 0)
      assert.equal((await who.post('/api/okr/self-score', { objectiveId: o.id, score: 70 })).code, 0)
    }
    for (const o of [objs.A, objs.B, objs.E]) {
      const s = await boss.post('/api/okr/manager-score', { objectiveId: o.id, score: 75 })
      assert.equal(s.code, 0, s.message)
    }
    const r = await boss.post('/api/okr/cycle/close-by-score', { week: WK })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.status, 'CLOSED')
    assert.ok(Array.isArray(r.data.pendingUsers))
    const ids = r.data.pendingUsers.map(u => u.id)
    assert.ok(ids.includes(C.id), 'C 没交计划')
    assert.ok(!ids.includes(A.id) && !ids.includes(B.id))
    assert.ok(!ids.includes(E.id), '免提交不算')
    // 归档后不再催
    assert.equal((await m.post('/api/okr/week/remind', { week: WK })).status, 409)
  })
})
