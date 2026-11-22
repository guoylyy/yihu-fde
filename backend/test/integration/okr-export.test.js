// 集成测试 - OKR 8.0: 按周导出 Excel / Word(GET /api/okr/export)
//
// 测试年份(与其他 OKR 用例错开): 2121–2129 年里随机一周(以后的周, 周期由 prisma 现建为 IN_PROGRESS), 现建现删, 绝不碰真实周;
// 空周用同一年的另一周, 不建周期。
// 人物: 团队甲 = M(MANAGER) + 工程师 A / B / C; 团队乙 = 工程师 X; ADMIN 现建。账号、团队、项目现建现删(客户借最老的现有客户)。
// 数据(都在 WK, 都已提交):
//   A: O1 权重 60 挂项目 P、卡点在 B 且昨天截止(逾期 1 天)、风险高 —— KR: NUMBER 4/10 家 + BINARY
//      O2 权重 40 不挂项目 —— KR: PERCENT 30/80 + BINARY;  O1 自评 78 / 主管分 82(直接写库)
//   B: O1 不挂项目 —— 1 条 KR
//   C: O1 挂项目 P —— 2 条 KR
// 下载下来的 xlsx / docx 落到系统临时目录(诊断里打印路径与大小), 用例结束删掉。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, uniqName, acquireTestLock, BASE } from './helpers.js'
import { weekRange, weekKey, shanghaiDateKey } from '../../src/services/okrRules.js'
import { EXEMPT_KEY } from '../../src/services/okrExempt.js'
import { DETAIL_HEADERS } from '../../src/services/okrExportFormat.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2121, 2129)
const WEEK_NO = rnd(2, 40)
const W = { year: YEAR, weekNo: WEEK_NO }
const EMPTY_W = { year: YEAR, weekNo: WEEK_NO + 5 }
const WK = weekKey(W)
const EMPTY_WK = weekKey(EMPTY_W)

const DAY = 24 * 3600 * 1000
const TODAY = shanghaiDateKey()
const YESTERDAY = new Date(Date.parse(`${TODAY}T00:00:00Z`) - DAY).toISOString().slice(0, 10)

const A_O1 = 'unit-test-v8 A-O1 采购模块应用'
const A_O2 = 'unit-test-v8 A-O2 客户回访'
const B_O1 = 'unit-test-v8 B-O1 文档收口'
const C_O1 = 'unit-test-v8 C-O1 订单联调'
const BLOCKER = '技术/工艺 11/24 前必出统一模板'

const OUT_DIR = mkdtempSync(join(tmpdir(), 'okr8-export-'))

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const where = { cycleId: c.id }
  const oids = (await prisma.okrObjective.findMany({ where, select: { id: true } })).map(o => o.id)
  await prisma.okrObjectiveProject.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrUpdate.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [where, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

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

/** 下载: 返回状态、头、二进制; 出错时 json 解析出 code */
async function download(token, query) {
  const r = await fetch(`${BASE}/api/okr/export?${new URLSearchParams(query)}`, { headers: { Authorization: `Bearer ${token}` } })
  const buf = Buffer.from(await r.arrayBuffer())
  let json = null
  if ((r.headers.get('content-type') || '').includes('json')) json = JSON.parse(buf.toString('utf8'))
  return { status: r.status, type: r.headers.get('content-type') || '', disposition: r.headers.get('content-disposition') || '', buf, code: json?.code }
}

/** 落盘到临时目录(报告里看路径与大小) */
function keep(t, name, buf) {
  const p = join(OUT_DIR, name)
  writeFileSync(p, buf)
  t.diagnostic(`exported ${p} ${statSync(p).size} bytes`)
}

async function readXlsx(buf) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const rows = name => {
    const ws = wb.getWorksheet(name)
    assert.ok(ws, `缺少 sheet ${name}`)
    const out = []
    ws.eachRow({ includeEmpty: false }, r => out.push(r.values.slice(1)))
    return { ws, rows: out }
  }
  return { detail: rows('明细'), summary: rows('汇总') }
}

const docText = async buf => (await mammoth.extractRawText({ buffer: buf })).value

describe('OKR 8.0 按周导出 Excel / Word', () => {
  let A, B, C, X, M, ADMIN
  let teams = []
  let customer, P
  const objIds = {}

  before(async () => {
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v8-吕哲远' })
    B = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v8-赵伟荣' })
    C = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v8-工程师C' })
    X = await createTestUser('FDE_ENGINEER', { name: 'unit-test-v8-外组X' })
    M = await createTestUser('MANAGER', { name: 'unit-test-v8-主管M' })
    ADMIN = await createTestUser('ADMIN', { name: 'unit-test-v8-老板' })
    const t1 = await prisma.team.create({ data: { name: uniqName('v8甲').slice(0, 50) } })
    const t2 = await prisma.team.create({ data: { name: uniqName('v8乙').slice(0, 50) } })
    teams = [t1.id, t2.id]
    for (const u of [M, A, B, C]) await prisma.teamMembership.create({ data: { teamId: t1.id, userId: BigInt(u.id) } })
    await prisma.teamMembership.create({ data: { teamId: t2.id, userId: BigInt(X.id) } })
    customer = await prisma.customer.findFirst({ where: { deletedAt: null }, orderBy: { id: 'asc' } })
    assert.ok(customer, '库里至少要有一个客户')
    P = await prisma.project.create({
      data: { code: `UT-V8-${process.pid}-${Date.now()}`.slice(0, 50), name: uniqName('v8项目'), customerId: customer.id, status: 'IN_PROGRESS', createdBy: BigInt(M.id) }
    })
    const { start, end } = weekRange(W.year, W.weekNo)
    await prisma.okrCycle.create({ data: { year: W.year, weekNo: W.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS' } })

    const submit = async (u, objectives) => {
      const r = await api(u.token).post(`/api/okr/plan/submit?week=${WK}`, { objectives })
      assert.equal(r.code, 0, r.message)
      return r.data.objectives
    }
    const a = await submit(A, [
      {
        title: A_O1, weight: 60, projectIds: [String(P.id)], riskLevel: 'HIGH',
        blockers: BLOCKER, blockerOwnerId: B.id, blockerDueDate: YESTERDAY,
        keyResults: [
          { title: 'KR 完整采购流程跑通', metricType: 'NUMBER', targetValue: 10, unit: '家', weight: 50 },
          { title: 'KR 采购实际使用并反馈', metricType: 'BINARY', weight: 50 }
        ]
      },
      {
        title: A_O2, weight: 40,
        keyResults: [
          { title: 'KR 覆盖率', metricType: 'PERCENT', targetValue: 80, weight: 50 },
          { title: 'KR 纪要', metricType: 'BINARY', weight: 50 }
        ]
      }
    ])
    objIds.A_O1 = a.find(o => o.title === A_O1).id
    const kr = a.flatMap(o => o.keyResults).find(k => k.title === 'KR 完整采购流程跑通')
    const p = await api(A.token).patch(`/api/okr/krs/${kr.id}`, { currentValue: 4 })
    assert.equal(p.code, 0, p.message)
    await prisma.okrObjective.update({ where: { id: BigInt(objIds.A_O1) }, data: { selfScore: 78, managerScore: 82, managerComment: '推进扎实' } })
    await submit(B, [{ title: B_O1, keyResults: [{ title: 'KR B-1', metricType: 'BINARY' }] }])
    await submit(C, [{
      title: C_O1, projectIds: [String(P.id)],
      keyResults: [{ title: 'KR C-1', metricType: 'BINARY', weight: 50 }, { title: 'KR C-2', metricType: 'NUMBER', targetValue: 5, weight: 50 }]
    }])
  })

  after(async () => {
    await dropCycle(W).catch(() => {})
    await dropCycle(EMPTY_W).catch(() => {})
    const users = [A, B, C, X, M, ADMIN].filter(Boolean)
    if (P) {
      await prisma.okrObjectiveProject.deleteMany({ where: { projectId: P.id } })
      await prisma.project.delete({ where: { id: P.id } }).catch(() => {})
    }
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map(u => BigInt(u.id)) } } }).catch(() => {})
    if (teams.length) {
      await prisma.teamMembership.deleteMany({ where: { teamId: { in: teams } } })
      await prisma.team.deleteMany({ where: { id: { in: teams } } })
    }
    for (const u of users) await u.cleanup()
    rmSync(OUT_DIR, { recursive: true, force: true })
  })

  test('1. person xlsx: 200 + sheet 类型; 明细行数 = KR 数 + 1, 表头 24 列顺序一致; 完成率 / 分数是数值', async (t) => {
    const r = await download(A.token, { week: WK, scope: 'person', format: 'xlsx' })
    assert.equal(r.status, 200, r.buf.toString('utf8').slice(0, 200))
    assert.match(r.type, /sheet/)
    keep(t, 'person.xlsx', r.buf)
    const { detail, summary } = await readXlsx(r.buf)
    assert.equal(detail.rows.length, 4 + 1)
    assert.deepEqual(detail.rows[0], DETAIL_HEADERS)
    assert.equal(DETAIL_HEADERS.length, 24)
    assert.deepEqual(DETAIL_HEADERS, [
      '周', '负责人', '所属项目', 'O序号', 'O标题', 'O权重', 'O状态', '卡点', '卡在谁', '依赖截止日', '风险',
      'KR序号', 'KR标题', '度量类型', '目标值', '当前值', '完成率', 'KR权重', 'KR状态', 'KR卡点', '自评分', '主管分', '主管评语', '本周进展条数'
    ])
    // 表头加粗 + 冻结首行
    assert.equal(detail.ws.getRow(1).getCell(1).font?.bold, true)
    assert.equal(detail.ws.views[0].state, 'frozen')
    assert.equal(detail.ws.views[0].ySplit, 1)
    const col = h => DETAIL_HEADERS.indexOf(h)
    const num = detail.rows.find(row => row[col('KR标题')] === 'KR 完整采购流程跑通')
    assert.equal(num[col('O标题')], A_O1)
    assert.equal(num[col('所属项目')], P.name)
    assert.equal(num[col('完成率')], 0.4)
    assert.equal(typeof num[col('完成率')], 'number')
    assert.equal(num[col('自评分')], 78)
    assert.equal(num[col('主管分')], 82, '本人看得到自己的主管分')
    assert.equal(num[col('卡点')], BLOCKER)
    assert.equal(num[col('卡在谁')], B.name)
    assert.equal(num[col('依赖截止日')], YESTERDAY)
    assert.equal(num[col('风险')], '高')
    assert.equal(num[col('本周进展条数')], 1)
    const o2 = detail.rows.find(row => row[col('O标题')] === A_O2)
    assert.equal(o2[col('所属项目')], '-', '空值写 -')
    assert.equal(o2[col('卡点')], '-')
    assert.equal(o2[col('自评分')], '-')
    // 汇总: 一人一行
    assert.equal(summary.rows.length, 2)
    assert.equal(summary.rows[1][0], A.name)
    assert.equal(summary.rows[1][1], 2)
    assert.equal(summary.rows[1][2], 4)
    assert.equal(typeof summary.rows[1][3], 'number')
  })

  test('2. team xlsx(MANAGER 本团队): 汇总行数 = /team 人数 + 1; 每人 O 数 / KR 数与 /team 一致', async (t) => {
    const r = await download(M.token, { week: WK, scope: 'team', format: 'xlsx' })
    assert.equal(r.status, 200)
    keep(t, 'team.xlsx', r.buf)
    const { detail, summary } = await readXlsx(r.buf)
    const team = await api(M.token).get(`/api/okr/team?week=${WK}`)
    assert.equal(team.code, 0, team.message)
    const rows = team.data.rows
    assert.deepEqual(rows.map(x => x.user.name).sort(), [A.name, B.name, C.name].sort())
    assert.equal(summary.rows.length, rows.length + 1)
    const byName = new Map(summary.rows.slice(1).map(x => [x[0], x]))
    for (const row of rows) {
      const s = byName.get(row.user.name)
      assert.ok(s, `汇总缺 ${row.user.name}`)
      assert.equal(s[1], row.objectiveCount, `${row.user.name} O 数`)
      assert.equal(s[2], row.krTotal, `${row.user.name} KR 数`)
    }
    assert.equal(detail.rows.length, rows.reduce((n, x) => n + x.krTotal, 0) + 1)
    assert.ok(!detail.rows.some(x => x[1] === X.name), '外组的人不出现')
    // A 的逾期卡点 / 高风险计入汇总
    const a = byName.get(A.name)
    assert.equal(a[8], 1)
    assert.equal(a[9], 1)
  })

  test('3. person docx: mammoth 读回含人名、每个 O 标题、卡点文案', async (t) => {
    const r = await download(A.token, { week: WK, scope: 'person', format: 'docx' })
    assert.equal(r.status, 200)
    assert.match(r.type, /wordprocessingml/)
    keep(t, 'person.docx', r.buf)
    const text = await docText(r.buf)
    assert.ok(text.includes(A.name))
    assert.ok(text.includes(A_O1) && text.includes(A_O2))
    assert.ok(text.includes(`卡点：${BLOCKER}（卡在 ${B.name}，截止 ${YESTERDAY}，已逾期 1 天）`), text)
    assert.ok(text.includes('KR1 KR 完整采购流程跑通〔数值 4/10 家〕完成 40%'), text)
    assert.ok(text.includes('〔二元 未完成〕'))
    assert.ok(text.includes('自评 78 / 主管分 82（评语：推进扎实）'))
    assert.ok(text.includes('（O 2 个 / KR 4 条 / 平均完成率'))
    // 标题层级: Heading1 / 2 / 3
    const html = (await mammoth.convertToHtml({ buffer: r.buf })).value
    assert.match(html, /<h1>[^<]*OKR（导出时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2}）<\/h1>/)
    assert.ok(html.includes(`<h2>${A.name}（`))
    assert.ok(html.includes(`<h3>O1 ${A_O1}（权重 60% · 状态 进行中 · 风险 高）</h3>`))
  })

  test('4. 权限: ENGINEER 导 team / project → 403; 导别人 → 403; MANAGER 导外组 → 403、本组 → 200; ADMIN 任意 → 200', async () => {
    assert.equal((await download(A.token, { week: WK, scope: 'team', format: 'xlsx' })).status, 403)
    assert.equal((await download(A.token, { week: WK, scope: 'project', projectId: String(P.id), format: 'xlsx' })).status, 403)
    const other = await download(A.token, { week: WK, scope: 'person', userId: B.id, format: 'xlsx' })
    assert.equal(other.status, 403)
    assert.equal(other.code, 8181)
    const out = await download(M.token, { week: WK, scope: 'person', userId: X.id, format: 'docx' })
    assert.equal(out.status, 403)
    assert.equal(out.code, 8181)
    assert.equal((await download(M.token, { week: WK, scope: 'person', userId: A.id, format: 'docx' })).status, 200)
    for (const q of [
      { scope: 'person', userId: X.id, format: 'xlsx' },
      { scope: 'person', userId: A.id, format: 'docx' },
      { scope: 'team', format: 'xlsx' },
      { scope: 'project', projectId: String(P.id), format: 'docx' }
    ]) {
      const r = await download(ADMIN.token, { week: WK, ...q })
      assert.equal(r.status, 200, JSON.stringify(q))
    }
    // 参数不合法
    assert.equal((await download(ADMIN.token, { week: WK, scope: 'team', format: 'pdf' })).status, 400)
    assert.equal((await download(ADMIN.token, { week: WK, scope: 'all', format: 'xlsx' })).status, 400)
    assert.equal((await download(ADMIN.token, { week: WK, scope: 'project', format: 'xlsx' })).status, 400)
    assert.equal((await download(ADMIN.token, { week: 'W99', scope: 'team', format: 'xlsx' })).status, 400)
    assert.equal((await download(ADMIN.token, { week: WK, scope: 'person', userId: '999999999999', format: 'xlsx' })).status, 404)
  })

  test('5. 免提交名单里的人不出现在 team 导出; person 明确指定照导', async () => {
    const before = await readXlsx((await download(M.token, { week: WK, scope: 'team', format: 'xlsx' })).buf)
    const unlock = await acquireTestLock('okr-exempt')
    try {
      await setExemptMember(C.id, true)
      const r = await download(M.token, { week: WK, scope: 'team', format: 'xlsx' })
      assert.equal(r.status, 200)
      const after = await readXlsx(r.buf)
      assert.equal(after.summary.rows.length, before.summary.rows.length - 1)
      assert.equal(after.detail.rows.length, before.detail.rows.length - 2, 'C 的 2 条 KR 不在明细里')
      assert.ok(!after.summary.rows.some(x => x[0] === C.name))
      assert.ok(!after.detail.rows.some(x => x[1] === C.name))
      // project 导出同样去掉
      const proj = await readXlsx((await download(M.token, { week: WK, scope: 'project', projectId: String(P.id), format: 'xlsx' })).buf)
      assert.ok(!proj.detail.rows.some(x => x[1] === C.name))
      // 明确指定这个人 → 照导
      const one = await readXlsx((await download(M.token, { week: WK, scope: 'person', userId: C.id, format: 'xlsx' })).buf)
      assert.equal(one.detail.rows.length, 2 + 1)
    } finally {
      await setExemptMember(C.id, false)
      unlock()
    }
  })

  test('6. project 导出: 只含挂该项目的 O, 未挂项目的 O 不出现', async () => {
    for (const who of [M, ADMIN]) {
      const r = await download(who.token, { week: WK, scope: 'project', projectId: String(P.id), format: 'xlsx' })
      assert.equal(r.status, 200)
      const { detail, summary } = await readXlsx(r.buf)
      const titles = new Set(detail.rows.slice(1).map(x => x[4]))
      assert.deepEqual([...titles].sort(), [A_O1, C_O1].sort())
      assert.equal(detail.rows.length, 2 + 2 + 1)
      assert.deepEqual(summary.rows.slice(1).map(x => x[0]).sort(), [A.name, C.name].sort())
      // 汇总按导出的 O 算: A 只算 O1 的 2 条 KR
      assert.equal(summary.rows.find(x => x[0] === A.name)[2], 2)
      const doc = await docText((await download(who.token, { week: WK, scope: 'project', projectId: String(P.id), format: 'docx' })).buf)
      assert.ok(doc.includes(`项目「${P.name}」`))
      assert.ok(doc.includes(A_O1) && doc.includes(C_O1))
      assert.ok(!doc.includes(A_O2) && !doc.includes(B_O1))
    }
    // 项目不存在 → 404
    assert.equal((await download(ADMIN.token, { week: WK, scope: 'project', projectId: '999999999999', format: 'xlsx' })).status, 404)
  })

  test('7. 空周(没有任何 OKR): 200, 文件里只有表头 / 标题', async () => {
    for (const [who, q] of [[ADMIN, { scope: 'team' }], [A, { scope: 'person' }], [ADMIN, { scope: 'project', projectId: String(P.id) }]]) {
      const x = await download(who.token, { week: EMPTY_WK, format: 'xlsx', ...q })
      assert.equal(x.status, 200, JSON.stringify(q))
      const { detail, summary } = await readXlsx(x.buf)
      assert.equal(detail.rows.length, 1)
      assert.deepEqual(detail.rows[0], DETAIL_HEADERS)
      assert.equal(summary.rows.length, 1)
      const d = await download(who.token, { week: EMPTY_WK, format: 'docx', ...q })
      assert.equal(d.status, 200)
      const lines = (await docText(d.buf)).split('\n').filter(l => l.trim())
      assert.equal(lines.length, 1, lines.join(' | '))
      assert.match(lines[0], /OKR（导出时间 /)
    }
    // 读接口不建周期
    assert.equal(await prisma.okrCycle.count({ where: { year: EMPTY_W.year, weekNo: EMPTY_W.weekNo } }), 0)
  })

  test("8. 中文文件名: Content-Disposition 带 filename*=UTF-8'' 或 ASCII 回退", async () => {
    const cases = [
      [M, { scope: 'team', format: 'xlsx' }, `OKR-${WK}-团队.xlsx`, `OKR-${WK}-team.xlsx`],
      [A, { scope: 'person', format: 'docx' }, `OKR-${WK}-${A.name}.docx`, `OKR-${WK}-person-${A.id}.docx`],
      [M, { scope: 'project', projectId: String(P.id), format: 'xlsx' }, `OKR-${WK}-项目-${P.name}.xlsx`, `OKR-${WK}-project-${P.id}.xlsx`]
    ]
    for (const [who, q, utf8, ascii] of cases) {
      const r = await download(who.token, { week: WK, ...q })
      assert.equal(r.status, 200)
      const d = r.disposition
      assert.ok(/filename\*=UTF-8''/.test(d) || /filename="[\x20-\x7e]+"/.test(d), d)
      assert.ok(d.startsWith('attachment;'))
      assert.ok(d.includes(`filename="${ascii}"`), d)
      const enc = /filename\*=UTF-8''([^;]+)/.exec(d)
      assert.ok(enc, d)
      assert.equal(decodeURIComponent(enc[1]), utf8)
    }
  })
})
