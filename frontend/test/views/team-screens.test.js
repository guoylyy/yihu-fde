import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { takeTop, relativeTime, skillName, loadBand, loadColor, loadBarPct, buildSkillMatrix, levelDots } from '../../src/views/admin/team/teamUtils.js'

// 0.5.0 R4b 团队屏(精简第二轮后剩成员卡 + 能力矩阵): 用真实模板 + /api/team/* 的返回结构渲染, 看画出来的字

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
  assert.equal((html.match(/data-test="member-promise-label"/g) || []).length, 1)
  assert.ok(!html.includes(t('team.no_promise')))
  assert.match(html, /band-OVER/)
})

test('成员卡: 没承诺/没会话/没技能时给说明, 不出空块', async () => {
  const html = await renderView(membersRender, membersState([{
    engineerId: '1', name: 'Sam', role: 'FDE_ENGINEER', level: null, skills: [], committedObjectives: [], activeTaskCount: 0, lastConversationAt: null, loadPct: 0
  }]))
  assert.equal(html.split(t('team.no_promise')).length - 1, 1, '没承诺的说明只出现一次')
  assert.ok(!html.includes('data-test="member-promise-label"'), '没承诺时不再同时出「本周承诺」标题')
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

test('精简第二轮: 负载页 / 承诺 vs 交付页下线, 成员卡上的负载% 仍在(阈值色同一套)', async () => {
  const { existsSync } = await import('node:fs')
  for (const f of ['TeamLoad.vue', 'TeamPromise.vue', 'TeamWeekHeader.vue']) {
    assert.ok(!existsSync(new URL(`../../src/views/admin/team/${f}`, import.meta.url)), f)
  }
  const utils = await import('../../src/views/admin/team/teamUtils.js')
  for (const k of ['promiseFlagsOf', 'PROMISE_FLAG_TONE', 'totalWeight', 'shiftWeek']) assert.equal(utils[k], undefined, k)
  const zh = (await import('../../src/locales/zh-CN.json', { with: { type: 'json' } })).default
  assert.equal(zh.team.promise, undefined)
  assert.equal(zh.team.load_page, undefined)
  assert.equal(zh.nav.team_load, undefined)
})

// ---------------------------------------------------------------- 3. 能力矩阵

const SKILLS = {
  skills: [{ id: '1', name: 'Go' }, { id: '2', name: 'Vue' }, { id: '3', name: 'Rust' }],
  members: [{ engineerId: '10', name: '甲' }, { engineerId: '11', name: '乙' }],
  cells: [
    { engineerId: '10', skillId: '1', level: 4, source: 'MANUAL' },
    { engineerId: '10', skillId: '2', level: 3, source: 'MANUAL' },
    { engineerId: '11', skillId: '2', level: 2, source: 'MANUAL' },
    { engineerId: '11', skillId: '3', level: null, source: 'DERIVED', candidate: true, hits: 4 }
  ],
  singlePoints: ['1']
}

test('矩阵: 行技能列人; 只有 1 人会的技能标单点风险, 候选不算人头', () => {
  const m = buildSkillMatrix(SKILLS)
  assert.deepEqual(m.map(r => [r.skill.name, r.holders, r.candidates, r.singlePoint]), [['Go', 1, 0, true], ['Vue', 2, 0, false], ['Rust', 0, 1, false]])
  assert.equal(m[0].cells[1], null, '乙不会 Go: 空格')
  assert.equal(m[2].cells[1].source, 'DERIVED')
  // 后端没给 singlePoints 时按人工标注人数兜底
  assert.deepEqual(buildSkillMatrix({ ...SKILLS, singlePoints: undefined }).map(r => r.singlePoint), [true, false, false])
  assert.deepEqual(levelDots(3), [true, true, true, false, false])
  assert.deepEqual(levelDots(null), [false, false, false, false, false])
})

const skillsRender = compileView('views/admin/team/TeamSkills.vue')
test('矩阵页: 实心点数 = 等级, 候选出灰点 + 确认, 单点风险只出在那一行', async () => {
  const pick = { visible: false }
  const add = { visible: false }
  const html = await renderView(skillsRender, {
    loading: false, error: '', meta: { derivedWindowDays: 90 }, members: SKILLS.members, skills: SKILLS.skills,
    matrix: buildSkillMatrix(SKILLS), levelDots, pick, add, pickTitle: '', openPick() {}, openAdd() {}, savePick() {}, saveAdd() {}, load() {}
  })
  const rows = html.split('data-test="skill-row"').slice(1)
  assert.equal(rows.length, 3)
  const filled = (r) => (r.match(/class="dot on"/g) || []).length
  assert.equal(filled(rows[0]), 4, 'Go: 甲 4 级')
  assert.equal(filled(rows[1]), 5, 'Vue: 3 + 2')
  assert.ok(rows[0].includes('data-test="single-point"'))
  assert.ok(!rows[1].includes('data-test="single-point"') && !rows[2].includes('data-test="single-point"'))
  assert.ok(rows[2].includes('data-test="skill-candidate"') && rows[2].includes('data-test="skill-confirm"'))
  assert.ok(rows[2].includes('Mentioned 4 times'))
})
