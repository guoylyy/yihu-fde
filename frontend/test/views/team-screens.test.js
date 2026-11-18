import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { takeTop, relativeTime, skillName, loadBand, loadColor, loadBarPct } from '../../src/views/admin/team/teamUtils.js'

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
