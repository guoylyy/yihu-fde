import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { takeTop, relativeTime, skillName, loadBand, loadColor, loadBarPct, buildSkillMatrix, levelDots, skillsMode, skillCards } from '../../src/views/admin/team/teamUtils.js'

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
// 0.6.4: 按形态给 setup 状态(与 TeamSkills.vue 里的计算一致)
function renderSkills(mode, payload, extra = {}) {
  const matrix = buildSkillMatrix(payload)
  const cards = skillCards(payload.members, matrix)
  const hint = { admin: 'team.skills.hint', self: 'team.skills.hint_self', team: 'team.skills.hint_team' }[mode]
  return renderView(skillsRender, {
    loading: false, error: '', meta: { derivedWindowDays: 90, scope: mode === 'self' ? 'SELF' : 'TEAM' },
    members: payload.members, skills: payload.skills, matrix, levelDots,
    mode, editable: mode === 'admin', hintText: hint, cards, selfCard: cards[0] || null, selfLevel: '',
    levelLabel: (v) => v, levelTitle: (v) => `${v}`, candTip: (c) => `Mentioned ${c.hits} times`,
    pick: { visible: false }, add: { visible: false }, pickTitle: '', openPick() {}, openAdd() {}, savePick() {}, saveAdd() {}, load() {},
    ...extra
  })
}
test('矩阵页: 实心点数 = 等级, 候选出灰点 + 确认, 单点风险只出在那一行', async () => {
  const pick = { visible: false }
  const add = { visible: false }
  const html = await renderSkills('admin', SKILLS)
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

// ---------------------------------------------------------------- 0.6.4 人人能看自己, 只有 ADMIN 能改

test('skillsMode: 能不能改只看 role === ADMIN; 组长有 team.view 也只读, 只读时按后端 scope 分自己 / 本团队', () => {
  assert.equal(skillsMode('ADMIN', 'ALL'), 'admin')
  assert.equal(skillsMode('ADMIN', 'SELF'), 'admin')
  assert.equal(skillsMode('TEAM_LEAD', 'TEAM'), 'team')
  assert.equal(skillsMode('MANAGER', 'SELF'), 'self')
  assert.equal(skillsMode('FDE_ENGINEER', 'SELF'), 'self')
  assert.equal(skillsMode(undefined, undefined), 'team', '拿不到 role 也绝不进可改态')
})

test('skillCards: 每人一张卡, 只列这个人有的格子, 人工标注按等级降序、候选垫底', () => {
  const cards = skillCards(SKILLS.members, buildSkillMatrix(SKILLS))
  assert.deepEqual(cards.map(c => [c.member.name, c.items.map(i => i.skill.name)]), [['甲', ['Go', 'Vue']], ['乙', ['Vue', 'Rust']]])
  assert.deepEqual(skillCards([], []), [])
})

const SELF = {
  skills: [{ id: '1', name: 'Go' }, { id: '3', name: 'Rust' }],
  members: [{ engineerId: '10', name: '甲' }],
  cells: [
    { engineerId: '10', skillId: '1', level: 4, source: 'MANUAL' },
    { engineerId: '10', skillId: '3', level: null, source: 'DERIVED', candidate: true, hits: 2 }
  ],
  singlePoints: []
}

test('工程师只看自己: 一张卡 + 说明, 没有矩阵 / 添加 / 确认 / 可点格子 / 单点风险', async () => {
  const html = await renderSkills('self', SELF, { selfLevel: 'SENIOR' })
  assert.ok(html.includes('team.skills.hint_self'))
  assert.ok(html.includes('data-test="skills-self-card"'))
  assert.equal((html.match(/data-test="skill-item"/g) || []).length, 2)
  const card = html.split('data-test="skills-self-card"')[1].split('</article>')[0]
  assert.equal((card.match(/class="dot on"/g) || []).length, 4, 'Go 4 级')
  assert.ok(html.includes('data-test="skill-candidate"'), '候选只读展示')
  assert.ok(html.includes('data-test="skills-self-level"') && html.includes('SENIOR'))
  for (const t of ['skills-matrix', 'skill-add', 'skill-confirm', 'skill-cell"', 'single-point', 'skills-cards']) {
    assert.ok(!html.includes(`data-test="${t.replace('"', '')}"`), `不该有 ${t}`)
  }
  assert.ok(!/<button[^>]*class="dots/.test(html), '只读卡里没有可点的等级按钮(弹窗模板是桩, 不算)')
  assert.ok(!html.includes('/admin/team/members/'), '不链到成员页(工程师进不去)')
})

test('工程师还没被标注: 空态「管理员还没给你标注技能」', async () => {
  for (const p of [{ skills: [], members: [{ engineerId: '10', name: '甲' }], cells: [], singlePoints: [] }, { skills: [], members: [], cells: [], singlePoints: [] }]) {
    const html = await renderSkills('self', p)
    assert.ok(html.includes('data-test="skills-self-empty"'))
    assert.ok(!html.includes('data-test="skills-self-card"'))
  }
  const zh = JSON.parse(readFileSync(new URL('../../src/locales/zh-CN.json', import.meta.url), 'utf8'))
  assert.equal(zh.team.skills.self_empty, '管理员还没给你标注技能')
  assert.equal(zh.team.skills.hint_self, '能力矩阵由管理员维护，这里看到的是你自己的技能等级')
  assert.equal(zh.team.skills.hint_team, '能力矩阵由管理员维护，你可以查看本团队')
})

test('组长只读: 看得到本团队矩阵与手机卡, 但格子不可点、无确认 / 添加', async () => {
  const html = await renderSkills('team', SKILLS)
  assert.ok(html.includes('team.skills.hint_team'))
  assert.equal(html.split('data-test="skill-row"').length - 1, 3)
  assert.equal(html.split('data-test="skill-card"').length - 1, 2, '手机每人一张卡')
  assert.ok(html.includes('data-test="skill-cell-ro"'))
  assert.ok(html.includes('data-test="skill-candidate"'))
  for (const t of ['skill-add', 'skill-confirm', 'skill-cell']) assert.ok(!html.includes(`data-test="${t}"`), `不该有 ${t}`)
  assert.ok(!/<button[^>]*class="dots/.test(html), '只读态没有任何可点的格子')
})

test('管理员: 矩阵与手机卡都能点(格子按钮 + 确认 + 添加)', async () => {
  const html = await renderSkills('admin', SKILLS)
  assert.ok(html.includes('data-test="skill-add"') && html.includes('data-test="skill-confirm"'))
  assert.equal((html.match(/data-test="skill-cell"/g) || []).length, 5, "3 技能 × 2 人 - 1 个候选")
  assert.ok(!html.includes('data-test="skill-cell-ro"'))
  assert.ok(html.split('data-test="skill-card"').length - 1 === 2)
})

test('只读态样式: 没有 pointer 光标与悬停框; 手机隐藏矩阵改卡片', () => {
  const src = readFileSync(new URL('../../src/views/admin/team/TeamSkills.vue', import.meta.url), 'utf8')
  assert.match(src, /\.dots\.ro \{ cursor: default;/)
  assert.match(src, /\.dots\.ro:hover \{ border-color: transparent; background: none; \}/)
  assert.match(src, /@media \(max-width: 640px\) \{\s*\.matrix-wrap \{ display: none; \}\s*\.cards \{ display: flex; \}/)
})
