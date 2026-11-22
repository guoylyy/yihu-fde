// 集成测试 - 精简第一轮: 本周项目整体计划(/api/okr/week-plan)
//
// 测试年份(与其他 OKR 用例错开): 可写周 = 2151–2159 年里随机一周(以后的周, 不建周期);
// 已结束周 = 2000 年里随机三周(过去的周, 周期由 prisma 现建: CLOSED / IN_PROGRESS+主管评分 / IN_PROGRESS 无评分), 绝不碰真实周。
// 人物: ADMIN、M(MANAGER)、工程师 E。账号现建现删; okr_week_plans 只本文件写, 按测试周硬删。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, BASE, dropPlanTrail } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const W = { year: rnd(2151, 2159), weekNo: rnd(2, 50) }
const WK = weekKey(W)
const pastNo = rnd(2, 47)
const PAST_CLOSED = { year: 2000, weekNo: pastNo }
const PAST_SCORED = { year: 2000, weekNo: pastNo + 1 }
const PAST_OPEN = { year: 2000, weekNo: pastNo + 2 }
const ALL_WEEKS = [W, PAST_CLOSED, PAST_SCORED, PAST_OPEN]

async function upload(token, path, { name, content, type = 'application/octet-stream' }) {
  const fd = new FormData()
  fd.append('file', new Blob([content], { type }), name)
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
  const raw = await r.json().catch(() => null)
  return { status: r.status, code: raw?.code, message: raw?.message, data: raw?.data }
}

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const oids = (await prisma.okrObjective.findMany({ where: { cycleId: c.id }, select: { id: true } })).map(o => o.id)
  await prisma.okrScore.deleteMany({ where: { OR: [{ cycleId: c.id }, { objectiveId: { in: oids } }] } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await dropPlanTrail([c.id])
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

const mkCycle = (week, status) => {
  const { start, end } = weekRange(week.year, week.weekNo)
  return prisma.okrCycle.create({ data: { year: week.year, weekNo: week.weekNo, startDate: start, endDate: end, status } })
}

const planWhere = week => ({ year: week.year, weekNo: week.weekNo })

describe('精简第一轮 本周项目整体计划', () => {
  let ADMIN, M, E

  const get = (u, wk) => api(u.token).get(`/api/okr/week-plan?week=${encodeURIComponent(wk)}`)
  const put = (u, body) => api(u.token).put('/api/okr/week-plan', body)

  before(async () => {
    ADMIN = await createTestUser('ADMIN', { name: 'unit-test-wp-老板' })
    M = await createTestUser('MANAGER', { name: 'unit-test-wp-主管M' })
    E = await createTestUser('FDE_ENGINEER', { name: 'unit-test-wp-工程师' })
    for (const w of ALL_WEEKS) {
      await prisma.okrWeekPlan.deleteMany({ where: planWhere(w) })
      await dropCycle(w)
    }
    await mkCycle(PAST_CLOSED, 'CLOSED')
    await mkCycle(PAST_OPEN, 'IN_PROGRESS')
    const scored = await mkCycle(PAST_SCORED, 'IN_PROGRESS')
    const o = await prisma.okrObjective.create({ data: { cycleId: scored.id, ownerId: BigInt(E.id), title: 'unit-test-wp O' } })
    await prisma.okrScore.create({ data: { cycleId: scored.id, objectiveId: o.id, scorerId: BigInt(M.id), role: 'MANAGER', score: 80 } })
  })

  after(async () => {
    for (const w of ALL_WEEKS) {
      await prisma.okrWeekPlan.deleteMany({ where: planWhere(w) }).catch(() => {})
      await dropCycle(w).catch(() => {})
    }
    const users = [ADMIN, M, E].filter(Boolean)
    await prisma.auditLog.deleteMany({ where: { userId: { in: users.map(u => BigInt(u.id)) } } }).catch(() => {})
    for (const u of users) await u.cleanup()
  })

  test('没有就是空: GET → 200 + contentMd null', async () => {
    const r = await get(E, WK)
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.week, WK)
    assert.equal(r.data.contentMd, null)
  })

  test('PUT 再 GET → 内容一致, updatedByName 正确, 留痕 okr.weekplan.update', async () => {
    const md = '# W 项目整体计划\n\n- 项目甲: 订单模块上线\n- 项目乙: 验收\n'
    const p = await put(M, { week: WK, title: '本周整体计划', contentMd: md })
    assert.equal(p.status, 200, p.message)
    assert.equal(p.data.created, true)
    const r = await get(E, WK)
    assert.equal(r.status, 200)
    assert.equal(r.data.contentMd, md)
    assert.equal(r.data.title, '本周整体计划')
    assert.equal(r.data.updatedByName, 'unit-test-wp-主管M')
    assert.ok(r.data.updatedAt)
    assert.equal(r.data.editable, false, '工程师看到的不可编辑')
    const audit = await prisma.auditLog.findFirst({ where: { action: 'okr.weekplan.update', resourceId: BigInt(p.data.id) } })
    assert.ok(audit, '应有 okr.weekplan.update 留痕')
  })

  test('同周再 PUT → 覆盖, 不新增行', async () => {
    const p = await put(ADMIN, { week: WK, contentMd: '覆盖后的内容' })
    assert.equal(p.status, 200, p.message)
    assert.equal(p.data.created, false)
    assert.equal(await prisma.okrWeekPlan.count({ where: planWhere(W) }), 1)
    const r = await get(M, WK)
    assert.equal(r.data.contentMd, '覆盖后的内容')
    assert.equal(r.data.title, null, '不传 title 就清空')
    assert.equal(r.data.updatedByName, 'unit-test-wp-老板')
    assert.equal(r.data.editable, true)
  })

  test('.md 导入 → 返回 contentMd, 不落库; 工程师导入 → 403; 非白名单格式 → 400', async () => {
    const before = await prisma.okrWeekPlan.count()
    const md = '# 导入版整体计划\r\n\r\n- 项目甲\r\n'
    const r = await upload(M.token, '/api/okr/week-plan/import', { name: '整体计划.md', content: md, type: 'text/markdown' })
    assert.equal(r.status, 200, r.message)
    assert.equal(r.data.contentMd, '# 导入版整体计划\n\n- 项目甲\n')
    assert.equal(r.data.fileName, '整体计划.md')
    assert.equal(await prisma.okrWeekPlan.count(), before, '导入不落库')
    assert.equal((await get(M, WK)).data.contentMd, '覆盖后的内容')

    const e = await upload(E.token, '/api/okr/week-plan/import', { name: 'a.md', content: '# x' })
    assert.equal(e.status, 403)
    const pdf = await upload(M.token, '/api/okr/week-plan/import', { name: 'x.pdf', content: '%PDF-1.4' })
    assert.equal(pdf.status, 400)
  })

  test('ENGINEER 写 → 403; 读 → 200', async () => {
    const w = await put(E, { week: WK, contentMd: '越权' })
    assert.equal(w.status, 403)
    assert.equal(w.code, 8195)
    const r = await get(E, WK)
    assert.equal(r.status, 200)
    assert.equal(r.data.contentMd, '覆盖后的内容')
  })

  test('已结束周(已归档 / 已有主管评分)写 → 400「只能看不能改」; 读 → 200; 过去但未归档未评分仍可写', async () => {
    for (const wk of [PAST_CLOSED, PAST_SCORED].map(weekKey)) {
      const w = await put(ADMIN, { week: wk, contentMd: '补一份' })
      assert.equal(w.status, 400, wk)
      assert.match(w.message, /只能看不能改/)
      const r = await get(E, wk)
      assert.equal(r.status, 200)
      assert.equal(r.data.contentMd, null)
      assert.equal((await get(ADMIN, wk)).data.editable, false)
    }
    assert.equal(await prisma.okrWeekPlan.count({ where: planWhere(PAST_CLOSED) }), 0)
    const open = await put(M, { week: weekKey(PAST_OPEN), contentMd: '复盘中还能改' })
    assert.equal(open.status, 200, open.message)
  })

  test('week 格式非法 → 400; contentMd 不是字符串 → 400', async () => {
    for (const wk of ['2026-48', 'abc', '2026-W99']) {
      assert.equal((await get(E, wk)).status, 400, `GET ${wk}`)
      assert.equal((await put(ADMIN, { week: wk, contentMd: 'x' })).status, 400, `PUT ${wk}`)
    }
    assert.equal((await put(ADMIN, { week: WK, contentMd: 123 })).status, 400)
  })
})
