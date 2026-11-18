import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { takeTop, relativeTime, skillName, loadBand, loadColor, loadBarPct, promiseFlagsOf, PROMISE_FLAG_TONE, totalWeight } from '../../src/views/admin/team/teamUtils.js'

// 0.5.0 R4b 团队四屏: 用真实模板 + /api/team/* 的返回结构渲染, 看画出来的字

// ---------------------------------------------------------------- 1. 成员卡片

const membersRender = compileView('views/admin/team/TeamMembers.vue')
function membersState(list, extra = {}) {
  return {
    loading: false, error: '', keyword: '', weekText: '2026 week 47 · 11/16–11/22', threshold: 5,
    shown: list, takeTop, skillName, loadBand, loadColor, loadBarPct,
    roleLabel: (r) => r, ago: (at) => (at ? '3 h ago' : t('team.never')), open() {}, load() {}, ...extra
  }
}

test('成员卡: 姓名/角色/等级、技能最多 3 个 +N、承诺最多 2 条带权重、任务数、负载%', async () => {
  const html = await renderView(membersRender, membersState([{
    engineerId: '36', name: '林晓', role: 'FDE_ENGINEER', level: 'SENIOR',
    skills: [{ name: 'Vue' }, { name: 'Go' }, { name: 'MySQL' }, { name: 'K8s' }, { name: 'Rust' }],
    committedObjectives: [{ title: '交付苏州 MES 二期', weight: 60 }, { title: '整理部署手册', weight: 30 }, { title: '第三条不显示', weight: 10 }],
    activeTaskCount: 8, lastConversationAt: '2026-11-18T08:00:00Z', loadPct: 160
  }]))
  assert.equal((html.match(/data-test="member-card"/g) || []).length, 1)
  for (const s of ['林晓', 'FDE_ENGINEER', 'SENIOR', 'Vue', 'Go', 'MySQL', '+2', '交付苏州 MES 二期', 'weight 60', '整理部署手册', '+1', '3 h ago', '160%']) {
    assert.ok(html.includes(s), `缺 ${s}`)
  }
  assert.ok(!html.includes('K8s') && !html.includes('第三条不显示'))
  assert.match(html, /data-test="member-active"[^>]*>8</)
  assert.match(html, /band-OVER/)
})

test('成员卡: 没承诺/没会话/没技能时给说明, 不出空块', async () => {
  const html = await renderView(membersRender, membersState([{
    engineerId: '1', name: 'Sam', role: 'FDE_ENGINEER', level: null, skills: [], committedObjectives: [], activeTaskCount: 0, lastConversationAt: null, loadPct: 0
  }]))
  assert.ok(html.includes(t('team.no_promise')))
  assert.ok(html.includes(t('team.never')))
  assert.ok(!html.includes('data-test="member-skills"'))
  assert.ok(!html.includes('data-test="member-level"'))
  assert.match(html, /band-OK/)
})

test('成员卡: 加载中出骨架, 失败出「加载失败」组件而不是空态', async () => {
  const sk = await renderView(membersRender, membersState([], { loading: true }))
  assert.ok(sk.includes('data-test="members-skeleton"'))
  const err = await renderView(membersRender, membersState([], { error: 'boom' }))
  assert.ok(!err.includes(t('team.no_members')))
})

test('takeTop / relativeTime', () => {
  assert.deepEqual(takeTop(['a', 'b', 'c', 'd'], 3), { shown: ['a', 'b', 'c'], rest: 1 })
  assert.deepEqual(takeTop(null, 2), { shown: [], rest: 0 })
  const now = Date.parse('2026-11-18T12:00:00Z')
  assert.deepEqual(relativeTime(null, now), { unit: 'none' })
  assert.deepEqual(relativeTime('2026-11-18T11:59:30Z', now), { unit: 'just' })
  assert.deepEqual(relativeTime('2026-11-18T11:15:00Z', now), { unit: 'minutes', n: 45 })
  assert.deepEqual(relativeTime('2026-11-18T09:00:00Z', now), { unit: 'hours', n: 3 })
  assert.deepEqual(relativeTime('2026-11-15T12:00:00Z', now), { unit: 'days', n: 3 })
  assert.equal(relativeTime('2026-09-01T12:00:00Z', now).unit, 'date')
  assert.equal(t('team.ago.hours', { n: 3 }), '3 h ago')
})

// ---------------------------------------------------------------- 2. 负载看板

test('负载阈值色: <100 绿, ≥100 黄, ≥150 红(与后端 loadBand 同口径); 进度条封顶 100', () => {
  assert.deepEqual([0, 99, 100, 149, 150, 400].map(loadBand), ['OK', 'OK', 'WARN', 'WARN', 'OVER', 'OVER'])
  assert.equal(loadColor(80), '#2e7d4f')
  assert.equal(loadColor(100), '#d99a1e')
  assert.equal(loadColor(150), '#c2362b')
  assert.equal(loadBarPct(160), 100)
  assert.equal(loadBarPct(null), 0)
})

const loadRender = compileView('views/admin/team/TeamLoad.vue')
test('负载表: 色块 + 数字, 表头写清口径, 计划工时没有就写 —', async () => {
  const rows = [
    { engineerId: '1', name: '甲', activeTaskCount: 8, plannedHours: null, committedWeight: 100, conversationCount: 2, loadPct: 160, level: 'OVER' },
    { engineerId: '2', name: '乙', activeTaskCount: 5, plannedHours: null, committedWeight: 0, conversationCount: 0, loadPct: 100, level: 'WARN' },
    { engineerId: '3', name: '丙', activeTaskCount: 1, plannedHours: null, committedWeight: 0, conversationCount: 0, loadPct: 20, level: 'OK' }
  ]
  const html = await renderView(loadRender, { rows, meta: { week: null }, loading: false, error: '', threshold: 5, loadBand, loadColor, load() {}, TeamWeekHeader: {} })
  assert.ok(html.includes(t('team.load_formula', { n: 5 })), '表头 tooltip 口径')
  assert.ok(html.includes('Load = open tasks ÷ 5'))
  for (const [band, color] of [['OVER', '#c2362b'], ['WARN', '#d99a1e'], ['OK', '#2e7d4f']]) {
    assert.ok(html.includes(`band-${band}`), band)
    assert.ok(html.includes(`background:${color}`), color)
  }
  assert.match(html, /160%/)
  assert.ok(html.includes('—'))
})

// ---------------------------------------------------------------- 3. 承诺 vs 交付

test('promise 标记文案与色调: 只在嘴上=黄 / 可能在别处干=灰 / 方向漂移=红', async () => {
  const zh = (await import('../../src/locales/zh-CN.json', { with: { type: 'json' } })).default
  assert.deepEqual(zh.team.promise.flags, { ONLY_WORDS: '只在嘴上', ELSEWHERE: '可能在别处干', DRIFT: '方向漂移' })
  assert.equal(zh.team.promise.hint, '三个数摆在一起看差异，不排名、不打分')
  assert.deepEqual(PROMISE_FLAG_TONE, { ONLY_WORDS: 'warning', ELSEWHERE: 'info', DRIFT: 'danger' })
  assert.deepEqual(promiseFlagsOf({ flag: 'DRIFT', flags: ['DRIFT', 'ONLY_WORDS'] }), ['DRIFT', 'ONLY_WORDS'])
  assert.deepEqual(promiseFlagsOf({ flag: 'ELSEWHERE' }), ['ELSEWHERE'], '只给 flag 也认')
  assert.deepEqual(promiseFlagsOf({ flags: ['SCORE_LOW'] }), [], '未知标记丢掉')
  assert.equal(totalWeight([{ weight: 60 }, { weight: 40 }, { weight: null }]), 100)
})

const promiseRender = compileView('views/admin/team/TeamPromise.vue')
test('promise 页: 一行一人四列, 标记出文案, 页面上没有分数/排名字样', async () => {
  const rows = [
    { engineerId: '1', name: '甲', objectives: [{ title: 'O1', weight: 60 }, { title: 'O2', weight: 40 }], completedTasks: 0, conversationCount: 4, projectCount: 2, flag: 'DRIFT', flags: ['DRIFT', 'ONLY_WORDS'] },
    { engineerId: '2', name: '乙', objectives: [], completedTasks: 2, conversationCount: 0, projectCount: 1, flag: 'ELSEWHERE', flags: ['ELSEWHERE'] },
    { engineerId: '3', name: '丙', objectives: [], completedTasks: 0, conversationCount: 0, projectCount: 0, flag: null, flags: [] }
  ]
  const html = await renderView(promiseRender, { rows, meta: {}, loading: false, error: '', promiseFlagsOf, PROMISE_FLAG_TONE, totalWeight, load() {} })
  assert.equal((html.match(/data-test="promise-row"/g) || []).length, 3)
  for (const s of ['Drifting', 'Words only', 'Maybe working elsewhere', '2 objectives', 'weight 100', '2 tasks completed', '4 conversations', '2 projects', t('team.promise.hint')]) {
    assert.ok(html.includes(s), s)
  }
  assert.match(html, /type="danger"[^>]*flag-DRIFT|flag-DRIFT[^>]*type="danger"/)
  assert.match(html, /type="warning"[^>]*flag-ONLY_WORDS|flag-ONLY_WORDS[^>]*type="warning"/)
  assert.match(html, /type="info"[^>]*flag-ELSEWHERE|flag-ELSEWHERE[^>]*type="info"/)
  assert.doesNotMatch(html.slice(html.indexOf('role="table"')), /score|rank|分数|排名/i, '表格里不出分数/排名')
  assert.ok(html.indexOf('甲') < html.indexOf('乙') && html.indexOf('乙') < html.indexOf('丙'), '保持接口顺序, 不排序')
})
