// 集成测试 - OKR 0.6.5: O / KR 数量上限进系统设置(app_settings 的 okr.maxObjectives / okr.maxKrsPerObjective)
//
// 测试年份(与其他 OKR 用例错开): 2181–2189 年连续的几周(以后的周, 周期由 prisma 现建为 IN_PROGRESS), 现建现删, 绝不碰真实周。
// 上限是全局设置: 每个改上限的用例都在 lockOkrLimits() 里做, 结束前把两个键恢复成测试前的原样(原来没有就删掉);
// 依赖默认上限 3 的别的用例(okr / v5 / v6 / v7)也拿同一把锁, 不会撞上这里临时改成的 2 / 5。
// 人物: 工程师 A(主角, 非 ADMIN) / 老板 O(ADMIN, 改设置); 账号现建现删。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../../src/lib/prisma.js'
import { createTestUser, api, dropPlanTrail, lockOkrLimits } from './helpers.js'
import { weekRange, weekKey } from '../../src/services/okrRules.js'
import { LIMIT_KEYS } from '../../src/services/okrLimits.js'

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const YEAR = rnd(2181, 2189)
const BASE = rnd(2, 40)
const wk = i => ({ year: YEAR, weekNo: BASE + i })
const SAVE = wk(0)  // 2: 上限 5 存 5 个 O / 6 个 O
const BULK = wk(1)  // 6: 上限 2 批量导入 3 个 O
const FROM = wk(2)  // 7: 复制来源(3 个 O)
const TO = wk(3)    // 7: 复制目标
const KRS = wk(4)   // 2b: KR 上限
const WEEKS = [SAVE, BULK, FROM, TO, KRS]
const K = w => weekKey(w)
const KEYS = Object.values(LIMIT_KEYS)

async function dropCycle(week) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return
  const oids = (await prisma.okrObjective.findMany({ where: { cycleId: c.id }, select: { id: true } })).map(o => o.id)
  await prisma.okrObjectiveProject.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrUpdate.deleteMany({ where: { OR: [{ cycleId: c.id }, { objectiveId: { in: oids } }] } })
  await prisma.okrScore.deleteMany({ where: { OR: [{ cycleId: c.id }, { objectiveId: { in: oids } }] } })
  await prisma.okrMiss.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrKeyResult.deleteMany({ where: { objectiveId: { in: oids } } })
  await prisma.okrObjective.deleteMany({ where: { id: { in: oids } } })
  await dropPlanTrail([c.id])
  await prisma.okrCycle.delete({ where: { id: c.id } })
}

async function objsInDb(week, ownerId) {
  const c = await prisma.okrCycle.findUnique({ where: { year_weekNo: { year: week.year, weekNo: week.weekNo } } })
  if (!c) return []
  return prisma.okrObjective.findMany({ where: { cycleId: c.id, ownerId: BigInt(ownerId) }, include: { keyResults: true }, orderBy: { seq: 'asc' } })
}

/** n 个 O, 每个 1 条 KR, 权重不填(均分) */
const plan = (n, tag) => Array.from({ length: n }, (_, i) => ({
  title: `unit-test-limits ${tag} O${i + 1}`,
  keyResults: [{ title: `${tag} KR${i + 1}`, metricType: 'BINARY' }]
}))

/** 两个键的原值(没有就 null) */
async function snapshot() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: KEYS } } })
  return Object.fromEntries(KEYS.map(k => [k, rows.find(r => r.key === k) || null]))
}

async function restore(snap) {
  for (const k of KEYS) {
    const row = snap[k]
    if (row) await prisma.appSetting.upsert({ where: { key: k }, update: { value: row.value, updatedBy: row.updatedBy }, create: { key: k, value: row.value, updatedBy: row.updatedBy } })
    else await prisma.appSetting.deleteMany({ where: { key: k } })
  }
}

/** 持锁 → 先把两个键清掉(回到「没设过」) → fn → 恢复原样 → 放锁 */
async function withLimits(fn) {
  const release = await lockOkrLimits()
  const snap = await snapshot()
  try {
    await prisma.appSetting.deleteMany({ where: { key: { in: KEYS } } })
    return await fn()
  } finally {
    await restore(snap).catch(e => console.error('[okr-limits] 恢复上限设置失败', e))
    release()
  }
}

describe('OKR 0.6.5 O / KR 数量上限可配置', () => {
  let A, O
  let a, boss

  before(async () => {
    A = await createTestUser('FDE_ENGINEER', { name: 'unit-test-limits-工程师A' })
    O = await createTestUser('ADMIN', { name: 'unit-test-limits-老板O' })
    a = api(A.token); boss = api(O.token)
    for (const w of WEEKS) {
      const { start, end } = weekRange(w.year, w.weekNo)
      await prisma.okrCycle.create({ data: { year: w.year, weekNo: w.weekNo, startDate: start, endDate: end, status: 'IN_PROGRESS' } })
    }
  })

  after(async () => {
    for (const w of WEEKS) await dropCycle(w).catch(() => {})
    const uids = [A, O].filter(Boolean).map(u => BigInt(u.id))
    await prisma.auditLog.deleteMany({ where: { userId: { in: uids } } }).catch(() => {})
    for (const u of [A, O]) await u?.cleanup()
  })

  test('1. 没设过 → GET /settings/limits 返回默认 3 / 10, 带默认值与范围', async () => {
    await withLimits(async () => {
      const r = await a.get('/api/okr/settings/limits')
      assert.equal(r.status, 200, r.message)
      assert.deepEqual(r.data, {
        maxObjectives: 3, maxKrsPerObjective: 10,
        defaults: { maxObjectives: 3, maxKrsPerObjective: 10 },
        ranges: { maxObjectives: [1, 10], maxKrsPerObjective: [1, 20] }
      })
    })
  })

  test('2. 设成 5 → 5 个 O 能保存; 6 个 O → 400, 文案「每周最多 5 个 O」', async () => {
    await withLimits(async () => {
      const put = await boss.put('/api/okr/settings/limits', { maxObjectives: 5 })
      assert.equal(put.status, 200, put.message)
      assert.equal(put.data.maxObjectives, 5)
      assert.equal(put.data.maxKrsPerObjective, 10, '只传一个字段, 另一个不动')

      const ok5 = await a.post(`/api/okr/plan?week=${K(SAVE)}`, { objectives: plan(5, 'save') })
      assert.equal(ok5.status, 200, ok5.message)
      assert.equal(ok5.data.objectives.length, 5)
      console.log(`ℹ 5 个 O 保存: ${JSON.stringify({ status: ok5.status, code: ok5.code, objectives: ok5.data.objectives.map(o => ({ seq: o.seq, title: o.title, weight: o.weight })) })}`)

      const bad6 = await a.post(`/api/okr/plan?week=${K(SAVE)}`, { objectives: plan(6, 'save') })
      assert.equal(bad6.status, 400)
      assert.equal(bad6.code, 8101)
      assert.equal(bad6.message, '每周最多 5 个 O')
      console.log(`ℹ 6 个 O 保存: ${JSON.stringify({ status: bad6.status, ...bad6.raw })}`)
      assert.equal((await objsInDb(SAVE, A.id)).length, 5, '被拒的那次不落库')
    })
  })

  test('2b. KR 上限设成 2 → 3 条 KR 的 O 被拒, 文案用实际上限; 提交时的权重 / 每 O 至少 1 个 KR 校验照旧', async () => {
    await withLimits(async () => {
      assert.equal((await boss.put('/api/okr/settings/limits', { maxKrsPerObjective: 2 })).status, 200)
      const title = 'unit-test-limits krs O1'
      const r = await a.post(`/api/okr/plan?week=${K(KRS)}`, {
        objectives: [{ title, keyResults: [{ title: 'k1' }, { title: 'k2' }, { title: 'k3' }] }]
      })
      assert.equal(r.status, 400)
      assert.equal(r.code, 8102)
      assert.equal(r.message, `「${title}」的 KR 超过 2 条`)
      const noKr = await a.post(`/api/okr/plan/submit?week=${K(KRS)}`, { objectives: [{ title, keyResults: [] }] })
      assert.equal(noKr.code, 8102, '每 O 至少 1 个 KR 不变')
      const w = await a.post(`/api/okr/plan/submit?week=${K(KRS)}`, {
        objectives: [{ title, weight: 50, keyResults: [{ title: 'k1' }] }, { title: `${title}-2`, weight: 40, keyResults: [{ title: 'k1' }] }]
      })
      assert.equal(w.code, 8103, 'O 权重合计 100 不变')
      assert.match(w.message, /要等于 100/)
    })
  })

  test('3. 设成 5 后 GET 回 5; 把键手工删掉 → 回到 3; 库里是坏值 / 越界值 → 也回默认', async () => {
    await withLimits(async () => {
      assert.equal((await boss.put('/api/okr/settings/limits', { maxObjectives: 5 })).status, 200)
      assert.equal((await a.get('/api/okr/settings/limits')).data.maxObjectives, 5)
      await prisma.appSetting.deleteMany({ where: { key: LIMIT_KEYS.maxObjectives } })
      assert.equal((await a.get('/api/okr/settings/limits')).data.maxObjectives, 3, '缺失即默认')
      await prisma.appSetting.create({ data: { key: LIMIT_KEYS.maxObjectives, value: 'abc' } })
      await prisma.appSetting.create({ data: { key: LIMIT_KEYS.maxKrsPerObjective, value: '99' } })
      const g = await a.get('/api/okr/settings/limits')
      assert.equal(g.data.maxObjectives, 3, '坏值回默认')
      assert.equal(g.data.maxKrsPerObjective, 10, '越界值回默认')
    })
  })

  test('4. 越界: maxObjectives = 0 / 11 / "abc" → 400(8103); maxKrsPerObjective = 0 / 21 → 400; 都不改库', async () => {
    await withLimits(async () => {
      const cases = [{ maxObjectives: 0 }, { maxObjectives: 11 }, { maxObjectives: 'abc' }, { maxKrsPerObjective: 0 }, { maxKrsPerObjective: 21 }, { maxObjectives: 2.5 }, {}]
      for (const body of cases) {
        const r = await boss.put('/api/okr/settings/limits', body)
        assert.equal(r.status, 400, JSON.stringify(body))
        assert.equal(r.code, 8103, JSON.stringify(body))
        console.log(`ℹ PUT ${JSON.stringify(body)} → ${JSON.stringify({ status: r.status, ...r.raw })}`)
      }
      assert.match((await boss.put('/api/okr/settings/limits', { maxObjectives: 11 })).message, /1–10 的整数/)
      assert.match((await boss.put('/api/okr/settings/limits', { maxKrsPerObjective: 21 })).message, /1–20 的整数/)
      // 一个合法一个越界: 整体拒, 合法的那个也不写
      assert.equal((await boss.put('/api/okr/settings/limits', { maxObjectives: 4, maxKrsPerObjective: 0 })).status, 400)
      assert.equal(await prisma.appSetting.count({ where: { key: { in: KEYS } } }), 0, '越界不落库')
    })
  })

  test('5. 非 ADMIN 调 PUT → 403; GET → 200', async () => {
    await withLimits(async () => {
      const r = await a.put('/api/okr/settings/limits', { maxObjectives: 5 })
      assert.equal(r.status, 403)
      assert.equal(r.code, 8143)
      assert.equal((await a.get('/api/okr/settings/limits')).status, 200)
      assert.equal(await prisma.appSetting.count({ where: { key: { in: KEYS } } }), 0)
    })
  })

  test('6. 批量导入: 上限设 2, 3 个 O 的 Markdown → 入库 2 个, truncated 且文案用 2', async () => {
    await withLimits(async () => {
      assert.equal((await boss.put('/api/okr/settings/limits', { maxObjectives: 2 })).status, 200)
      const text = [1, 2, 3].map(i => `## unit-test-limits 导入 O${i}\n- 交付物 ${i}`).join('\n\n')
      const r = await a.post('/api/okr/plan/bulk-import', { week: K(BULK), mode: 'apply', text })
      assert.equal(r.status, 200, r.message)
      assert.equal(r.data.createdObjectives, 2)
      assert.equal(r.data.truncated, true)
      assert.equal(r.data.limits.maxObjectives, 2, '返回的上限是实际生效的 2')
      assert.deepEqual(r.data.truncatedReasons, ['超过每周 2 个 O 的上限, 只导入前 2 个'])
      assert.equal((await objsInDb(BULK, A.id)).length, 2)
    })
  })

  test('7. 复制上周: 上限设 2、上周 3 个 O → 复制 2 个, skipped 1 条「超过每周 2 个 O 的上限」', async () => {
    await withLimits(async () => {
      const src = await a.post(`/api/okr/plan?week=${K(FROM)}`, { objectives: plan(3, 'copy') })
      assert.equal(src.status, 200, src.message)
      assert.equal((await boss.put('/api/okr/settings/limits', { maxObjectives: 2 })).status, 200)
      const r = await a.post('/api/okr/plan/copy-from-week', { fromWeek: K(FROM), toWeek: K(TO) })
      assert.equal(r.status, 200, r.message)
      assert.equal(r.data.createdObjectives, 2)
      assert.equal(r.data.skipped.length, 1)
      assert.equal(r.data.skipped[0].title, 'unit-test-limits copy O3')
      assert.equal(r.data.skipped[0].reason, '超过每周 2 个 O 的上限')
      assert.equal((await objsInDb(TO, A.id)).length, 2)
    })
  })

  test('8. 改配置写审计 okr.settings.limits, details 含 before / after', async () => {
    await withLimits(async () => {
      assert.equal((await boss.put('/api/okr/settings/limits', { maxObjectives: 4 })).status, 200)
      assert.equal((await boss.put('/api/okr/settings/limits', { maxObjectives: 6, maxKrsPerObjective: 12 })).status, 200)
      const audits = await prisma.auditLog.findMany({ where: { action: 'okr.settings.limits', userId: BigInt(O.id) }, orderBy: { id: 'desc' }, take: 2 })
      assert.equal(audits.length, 2)
      assert.deepEqual(audits[1].details, { before: { maxObjectives: 3, maxKrsPerObjective: 10 }, after: { maxObjectives: 4, maxKrsPerObjective: 10 } })
      assert.deepEqual(audits[0].details, { before: { maxObjectives: 4, maxKrsPerObjective: 10 }, after: { maxObjectives: 6, maxKrsPerObjective: 12 } })
      assert.equal(audits[0].resourceType, 'appSetting')
    })
  })
})
