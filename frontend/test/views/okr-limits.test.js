// 0.6.5 前端: OKR 计划上限(系统设置可配)。纯函数直接测; 设置块用真实模板 + 手给状态 SSR 渲染(测试语言为 en)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  normalizeLimits, loadLimits, limitError, limitsPatch, liveObjectiveCount, FALLBACK_LIMITS
} from '../../src/views/okr/okrLimits.js'
import { mergeDraft } from '../../src/views/okr/okrPeople.js'

const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const zh = JSON.parse(src('locales/zh-CN.json'))
const en = JSON.parse(src('locales/en.json'))
const esc = s => String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;')
const btnTag = (html, dt) => (html.match(new RegExp(`<[^>]*data-test="${dt}"[^>]*>`)) || [''])[0]
const API = { maxObjectives: 5, maxKrsPerObjective: 8, defaults: { maxObjectives: 3, maxKrsPerObjective: 10 }, ranges: { maxObjectives: [1, 10], maxKrsPerObjective: [1, 20] } }

describe('上限: 接口值归一 / 回退', () => {
  test('接口值原样用(含 defaults / ranges)', () => {
    assert.deepEqual(normalizeLimits(API), API)
  })
  test('拿不到 / 坏值 → 逐项回退 3 / 10 与默认范围', () => {
    const fb = normalizeLimits(null)
    assert.equal(fb.maxObjectives, 3)
    assert.equal(fb.maxKrsPerObjective, 10)
    assert.deepEqual(fb.ranges, { maxObjectives: [1, 10], maxKrsPerObjective: [1, 20] })
    const half = normalizeLimits({ maxObjectives: 6, maxKrsPerObjective: '7', ranges: { maxObjectives: [5, 1] } })
    assert.equal(half.maxObjectives, 6)
    assert.equal(half.maxKrsPerObjective, 10, '字符串不认, 回退')
    assert.deepEqual(half.ranges.maxObjectives, [1, 10], '倒过来的范围不认')
    assert.equal(normalizeLimits({ maxObjectives: 0 }).maxObjectives, 3)
    assert.deepEqual(FALLBACK_LIMITS, { maxObjectives: 3, maxKrsPerObjective: 10 })
  })
  test('loadLimits: 接口成功用接口值; 抛错不往外抛, 回退默认', async () => {
    assert.equal((await loadLimits(async () => API)).maxObjectives, 5)
    const fb = await loadLimits(async () => { throw new Error('500') })
    assert.equal(fb.maxObjectives, 3)
    assert.equal(fb.maxKrsPerObjective, 10)
  })
})

describe('上限: 设置页校验 / 只提交改了的字段', () => {
  test('整数且在范围内才放行; 文案带范围', () => {
    assert.equal(limitError('5', [1, 10]), null)
    assert.equal(limitError(10, [1, 10]), null)
    assert.equal(limitError(' 1 ', [1, 10]), null)
    assert.equal(limitError('11', [1, 10]).key, 'okr.limits.err_range')
    assert.equal(limitError('0', [1, 10]).key, 'okr.limits.err_range')
    assert.equal(limitError('2.5', [1, 10]).key, 'okr.limits.err_int')
    assert.equal(limitError('', [1, 20]).key, 'okr.limits.err_int')
    assert.equal(limitError('abc', [1, 20]).key, 'okr.limits.err_int')
    const e = limitError('30', [1, 20])
    assert.equal(t(e.key, e.p), 'Out of range, must be between 1 and 20')
    assert.equal(zh.okr.limits.err_range.replace('{p0}', 1).replace('{p1}', 20), '超出范围，要在 1–20 之间')
  })
  test('limitsPatch: 只带变了的字段, 值转数字', () => {
    const saved = { maxObjectives: 3, maxKrsPerObjective: 10 }
    assert.deepEqual(limitsPatch({ maxObjectives: '3', maxKrsPerObjective: '10' }, saved), {})
    assert.deepEqual(limitsPatch({ maxObjectives: ' 5 ', maxKrsPerObjective: '10' }, saved), { maxObjectives: 5 })
    assert.deepEqual(limitsPatch({ maxObjectives: '5', maxKrsPerObjective: '12' }, saved), { maxObjectives: 5, maxKrsPerObjective: 12 })
  })
  test('活着的 O 不算 DROPPED(与后端同口径)', () => {
    assert.equal(liveObjectiveCount([{ status: 'ON_TRACK' }, { status: 'DROPPED' }, {}]), 2)
    assert.equal(liveObjectiveCount(null), 0)
  })
})

describe('设置 · 计划上限', () => {
  const render = compileView('components/okr/OkrLimitSettings.vue')
  const fields = [{ key: 'maxObjectives', label: 'okr.limits.max_o' }, { key: 'maxKrsPerObjective', label: 'okr.limits.max_kr' }]
  const state = (over = {}) => ({
    loading: false, saving: false, editable: true, fields,
    saved: { maxObjectives: 3, maxKrsPerObjective: 10 }, ranges: API.ranges, defaults: API.defaults,
    form: { maxObjectives: '5', maxKrsPerObjective: '10' }, errors: { maxObjectives: '', maxKrsPerObjective: '' },
    hasError: false, dirty: true, save() {}, ...over
  })

  test('ADMIN: 标题 / 说明 / 两个输入框(带范围与默认值)/ 保存按钮', async () => {
    const html = await renderView(render, state())
    assert.ok(html.includes(esc(t('okr.limits.title'))))
    assert.ok(html.includes(esc(t('okr.limits.desc'))))
    assert.ok(html.includes('data-test="okr-limits-maxObjectives"'))
    assert.ok(html.includes('data-test="okr-limits-maxKrsPerObjective"'))
    assert.ok(html.includes(esc(t('okr.limits.range_hint', { p0: 1, p1: 10, p2: 3 }))))
    assert.ok(html.includes(esc(t('okr.limits.range_hint', { p0: 1, p1: 20, p2: 10 }))))
    assert.doesNotMatch(btnTag(html, 'okr-limits-save'), /disabled/)
    assert.ok(!html.includes('data-test="okr-limits-readonly"'))
  })

  test('ADMIN: 越界时出错误文案, 保存置灰; 没改动也置灰', async () => {
    const bad = await renderView(render, state({ errors: { maxObjectives: '超出范围', maxKrsPerObjective: '' }, hasError: true }))
    assert.ok(bad.includes('data-test="okr-limits-err-maxObjectives"'))
    assert.match(btnTag(bad, 'okr-limits-save'), /disabled/)
    const clean = await renderView(render, state({ dirty: false }))
    assert.match(btnTag(clean, 'okr-limits-save'), /disabled/)
  })

  test('非 ADMIN: 只读显示当前值, 没有输入框和保存按钮', async () => {
    const html = await renderView(render, state({ editable: false, saved: { maxObjectives: 5, maxKrsPerObjective: 8 } }))
    assert.ok(!html.includes('data-test="okr-limits-save"'))
    assert.ok(html.includes('data-test="okr-limits-readonly"'))
    assert.match(html, /data-test="okr-limits-maxObjectives"[^>]*>5</)
    assert.match(html, /data-test="okr-limits-maxKrsPerObjective"[^>]*>8</)
  })

  test('源码约束: GET/PUT /settings/limits; 只 ADMIN 可改; 成功 toast「已保存」并刷成后端值; 失败原样用后端 message', () => {
    const api = src('api/index.js')
    assert.match(api, /limits: \(\) => request\('\/api\/okr\/settings\/limits'\)/)
    assert.match(api, /saveLimits: \(patch\) => request\('\/api\/okr\/settings\/limits', \{ method: 'PUT', body: JSON\.stringify\(patch\) \}\)/)
    const s = src('components/okr/OkrLimitSettings.vue')
    assert.match(s, /const editable = currentUser\(\)\.role === 'ADMIN'/)
    assert.match(s, /fill\(await fde\.okr\.saveLimits\(patch\)\)/)
    assert.match(s, /ElMessage\.success\(\$t\('okr\.limits\.saved'\)\)/)
    assert.match(s, /catch \(e\) \{[^}]*ElMessage\.error\(e\.message\)/)
    assert.equal(zh.okr.limits.saved, '已保存')
    assert.equal(zh.okr.limits.title, '计划上限')
    assert.equal(zh.okr.limits.desc, '每人每周最多填几个 O、每个 O 最多几条 KR。改完立即生效，已提交的周不受影响。')
    // 放在免提交名单上面
    const page = src('views/admin/SystemSettings.vue')
    assert.ok(page.indexOf('<OkrLimitSettings />') > 0 && page.indexOf('<OkrLimitSettings />') < page.indexOf('<OkrExemptSettings />'))
  })

  test('手机: 输入框竖排, 输入框 / 按钮 44px', () => {
    const s = src('components/okr/OkrLimitSettings.vue')
    const m = s.slice(s.indexOf('@media (max-width: 640px)'))
    assert.match(m, /\.okr-lm-fields \{ flex-direction: column;/)
    assert.match(m, /min-height: 44px/)
    assert.match(m, /\.okr-lm-save \{ min-height: 44px;/)
  })
})

describe('上限: 贴周报追加用配置值', () => {
  const o = (title, n) => ({ title, status: 'ON_TRACK', keyResults: Array.from({ length: n }, (_, i) => ({ title: `${title}-kr${i}` })) })
  test('max=5: 2 + 4 → 放 3 个, 丢 1 个', () => {
    const r = mergeDraft([o('a', 1), o('b', 1)], [o('c', 1), o('d', 1), o('e', 1), o('f', 1)], 'append', { max: 5 })
    assert.deepEqual(r.objectives.map(x => x.title), ['a', 'b', 'c', 'd', 'e'])
    assert.equal(r.dropped, 1)
  })
  test('文案带上限', () => {
    assert.equal(zh.okr.import.dropped.replace('{p0}', 1).replace('{p1}', 5), '已追加；最多 5 个 O，有 1 个没放进去')
    assert.ok(en.okr.import.mode_append_sub.includes('{p0}'))
  })
})
