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

describe('编辑器跟着配置变', () => {
  const render = compileView('components/okr/OkrPlanEditor.vue')
  const obj = (i) => ({ _k: i, title: `O${i}`, description: '', weight: 20, status: 'ON_TRACK', keyResults: [{ _k: 100 + i, title: 'k', metricType: 'BINARY', weight: 100, milestones: [] }] })
  const st = (n, over = {}) => ({
    draft: Array.from({ length: n }, (_, i) => obj(i + 1)),
    manualWeights: false, problems: [], MAX_MILESTONES: 20, busy: '', submitted: false, cancellable: false, lateHint: false, submitLabel: '',
    bulk: { visible: false, obj: null }, roomFor: () => 1,
    addObjective() {}, addKr() {}, removeObjective() {}, removeKr() {}, openBulk() {}, insertBulk() {}, emitPlan() {},
    onTypeChange() {}, setMilestoneDone() {}, blankMilestone: () => ({}), ...over
  })
  const extra = { 'el-input-number': true, OkrBulkKrDialog: true }
  const addTag = html => (html.match(/<[^>]*data-test="okr-ed-add-o"[^>]*>/) || [''])[0]

  test('页头动态「1–N 个 O」', async () => {
    const html = await renderView(render, st(2, { maxObjectives: 5, maxKrs: 8 }), extra)
    assert.ok(html.includes(esc(t('okr.limits.editor_head', { p0: 5, p1: 8 }))))
    assert.equal(zh.okr.limits.editor_head.replace('{p0}', 5).replace('{p1}', 8), '本周计划：1–5 个 O，每个 O 最多 8 条 KR')
  })
  test('没到上限: 「+ O」可点; 到上限: 置灰 + tooltip 文案带 N', async () => {
    const open = await renderView(render, st(4, { maxObjectives: 5, objectivesFull: false }), extra)
    assert.doesNotMatch(addTag(open), /disabled/)
    const full = await renderView(render, st(5, { maxObjectives: 5, objectivesFull: true }), extra)
    assert.match(addTag(full), /disabled/)
    assert.equal(zh.okr.limits.o_full.replace('{p0}', 5), '每人每周最多 5 个 O（可在系统设置里改）')
    assert.ok(full.includes(esc(t('okr.limits.o_full', { p0: 5 }))) || src('components/okr/OkrPlanEditor.vue').includes(":content=\"$t('okr.limits.o_full', { p0: maxObjectives })\""))
  })
  test('源码约束: 编辑器不再写死 3 / 10, 只用 props; O 满了 = 活着的 O ≥ 上限', () => {
    const s = src('components/okr/OkrPlanEditor.vue')
    assert.doesNotMatch(s, /draft\.length < 3|const MAX_KRS = 10/)
    assert.match(s, /const objectivesFull = computed\(\(\) => liveObjectiveCount\(draft\.value\) >= props\.maxObjectives\)/)
    assert.match(s, /:disabled="o\.keyResults\.length >= maxKrs"/)
    assert.match(s, /insertKrs\(o, titles, \{ max: props\.maxKrs,/)
    assert.doesNotMatch(s, /1–3 个 O/)
  })
  test('我的 OKR: 进页面读一次上限, 传给编辑器 / 贴周报 / 批量导入; 追加按配置截', () => {
    const s = src('views/okr/MyOkr.vue')
    assert.equal((s.match(/fde\.okr\.limits/g) || []).length, 1, '只读一次')
    assert.match(s, /loadLimits\(fde\.okr\.limits\)\.then/)
    const loadFn = s.slice(s.indexOf('async function load('), s.indexOf('\n}\n', s.indexOf('async function load(')))
    assert.ok(loadFn.length > 0 && !loadFn.includes('limits'), '周切换时的 load() 里不重拉上限')
    assert.match(s, /:max-objectives="limits\.maxObjectives" :max-krs="limits\.maxKrsPerObjective"/)
    assert.match(s, /<OkrReportDraftDialog[^>]*:max-objectives="limits\.maxObjectives"/)
    assert.match(s, /<OkrPlanImportDialog[^>]*:limits="limits"/)
    assert.match(s, /mergeDraft\(editorRef\.value\.getPlan\(\), objectives, 'append', \{ max: limits\.value\.maxObjectives \}\)/)
    const imp = src('components/okr/OkrPlanImportDialog.vue')
    assert.doesNotMatch(imp, /maxObjectives: 3, maxKrsPerObjective: 6/)
    assert.match(imp, /limits\.value = pickLimits\(props\.limits\)/)
    assert.match(src('components/okr/OkrReportDraftDialog.vue'), /\$t\('okr\.import\.mode_append_sub', \{ p0: maxObjectives \}\)/)
  })
  test('批量导入弹窗: 打开时先用配置值出「最多 N 个」', async () => {
    const r = compileView('components/okr/OkrPlanImportDialog.vue')
    const html = await renderView(r, {
      text: '', preview: null, busy: '', limits: { maxObjectives: 5, maxKrsPerObjective: 8 }, krTotal: 0, canApply: false, round: n => n,
      previewKrMeta: () => '', run() {}, close() {}, modelValue: true
    }, { 'el-alert': true })
    assert.ok(html.includes(esc(t('okr.plan.bulk_help_rules', { p0: 5, p1: 8 }))))
  })
})
