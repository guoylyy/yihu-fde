// OKR 前端第四批: 阶段型 KR / 卡点与风险 / 复制上周 / 批量导入 / 模板。
// 纯函数直接测; 组件用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  milestoneRows, milestoneCount, milestoneClick, milestonesWithDone, applyMilestonePatch, setMilestoneDone, blankMilestone,
  editorKrPayload, blockerFormState, blockerForm, blockerPatch, blockerPeople, overdueDays, planWithPatch, RISK_LEVELS,
  copySourceWeeks, skipReasonKey, copyResultText, planToMarkdown, previewKrMeta, planSnapshot
} from '../../src/views/okr/okrFe4.js'
import { OBJ_TAG, pct, krValueText, toDraft, planProblems, parseProgress } from '../../src/views/okr/okrUtils.js'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)
const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length

const ms3 = (done = 0) => [
  { name: '方案评审', dueDate: '2026-11-18', done: done > 0 },
  { name: '联调', dueDate: '2026-11-20', done: done > 1 },
  { name: '上线', dueDate: '2026-11-27', done: done > 2 }
]
const msKr = (done = 0, over = {}) => ({
  id: '11', seq: 1, title: '园区巡检上线', metricType: 'MILESTONE', targetValue: 3, currentValue: done, weight: 100,
  status: done >= 3 ? 'DONE' : 'ON_TRACK', progress: done / 3, milestones: ms3(done), blockers: null, ...over
})

// ---------------------------------------------------------------- 一、阶段型 KR

describe('阶段型 KR: 纯函数', () => {
  test('阶段行: 早于今天且没完成 = 逾期; 完成的、今天到期的、没日期的都不算', () => {
    const rows = milestoneRows(msKr(1, { milestones: [...ms3(1), { name: '复盘', dueDate: null, done: false }] }), '2026-11-20')
    assert.deepEqual(rows.map(r => [r.done, r.overdue]), [[true, false], [false, false], [false, false], [false, false]])
    const later = milestoneRows(msKr(1), '2026-11-21')
    assert.deepEqual(later.map(r => r.overdue), [false, true, false], '第 1 个已完成不算逾期, 第 2 个过了日期')
    assert.deepEqual(milestoneRows({ milestones: null }), [])
  })
  test('阶段 2/3: 明细为准, 没明细用数值; KR 值展示同口径', () => {
    assert.deepEqual(milestoneCount(msKr(2)), { done: 2, total: 3 })
    assert.deepEqual(milestoneCount({ currentValue: 1, targetValue: 4, milestones: [] }), { done: 1, total: 4 })
    assert.equal(krValueText(msKr(2), t), t('okr.ms.progress', { p0: 2, p1: 3 }))
    assert.equal(krValueText(msKr(2), t), 'Stage 2/3')
  })
  test('点阶段按顺序推进: 点未完成 = 到它为止都完成; 点已完成 = 它和之后都取消; 最后一个走 complete', () => {
    assert.deepEqual(milestoneClick(msKr(0), 0), { kind: 'patch', value: 1 })
    assert.deepEqual(milestoneClick(msKr(0), 1), { kind: 'patch', value: 2 }, '跳着点也把前面的一起完成')
    assert.deepEqual(milestoneClick(msKr(1), 2), { kind: 'complete' }, '全部完成 → /complete done=true')
    assert.deepEqual(milestoneClick(msKr(2), 1), { kind: 'patch', value: 1 }, '取消第 2 个')
    assert.deepEqual(milestoneClick(msKr(2), 0), { kind: 'patch', value: 0 })
    assert.deepEqual(milestoneClick(msKr(3), 2), { kind: 'patch', value: 2 }, '全部完成后取消最后一个 = PATCH 2')
    assert.equal(milestoneClick(msKr(1), 5), null, '越界不动')
    assert.equal(milestoneClick(msKr(1), -1), null)
  })
  test('PATCH 成功后就地更新: KR 值 / 阶段 done / 状态 / 进度 + O 完成度 + 整周完成度', () => {
    const data = {
      completion: 0,
      objectives: [
        { id: '1', weight: 50, status: 'ON_TRACK', progress: 0, keyResults: [msKr(0, { weight: 50 }), { id: '12', metricType: 'BINARY', status: 'DONE', weight: 50, currentValue: 1, targetValue: 1 }] },
        { id: '2', weight: 50, status: 'ON_TRACK', progress: 0, keyResults: [{ id: '13', metricType: 'NUMBER', status: 'ON_TRACK', weight: 100, currentValue: 0, targetValue: 4 }] }
      ]
    }
    const o = applyMilestonePatch(data, '11', { valueAfter: 2, statusAfter: 'ON_TRACK' })
    const kr = o.keyResults[0]
    assert.equal(kr.currentValue, 2)
    assert.deepEqual(kr.milestones.map(m => m.done), [true, true, false])
    assert.equal(kr.progress, 0.6667)
    assert.equal(o.progress, 0.8333, '(2/3·50 + 1·50) / 100')
    assert.equal(data.completion, 0.4167, 'O2 还是 0')
    assert.equal(applyMilestonePatch(data, '404', { valueAfter: 1 }), null)
  })
  test('milestonesWithDone 与后端同口径(前 N 个 done)', () => {
    assert.deepEqual(milestonesWithDone(ms3(0), 2).map(m => m.done), [true, true, false])
    assert.equal(milestonesWithDone(ms3(0), 2)[0].dueDate, '2026-11-18')
  })
  test('编辑器勾选也按顺序: 勾第 3 个 = 前面都勾; 取消第 1 个 = 全部取消', () => {
    const list = [blankMilestone(), blankMilestone(), blankMilestone()]
    assert.deepEqual(setMilestoneDone(list, 2, true).map(m => m.done), [true, true, true])
    assert.deepEqual(setMilestoneDone(list, 1, false).map(m => m.done), [true, false, false])
    assert.deepEqual(setMilestoneDone(list, 0, false).map(m => m.done), [false, false, false])
  })
  test('提交前检查: 阶段型至少 1 个阶段、每个阶段有名字', () => {
    const plan = (milestones) => [{ title: 'O', weight: 100, status: 'ON_TRACK', keyResults: [{ title: 'K', metricType: 'MILESTONE', weight: 100, milestones }] }]
    assert.deepEqual(planProblems(plan([{ name: 'a' }]), t), [])
    assert.deepEqual(planProblems(plan([]), t), [t('okr.ms.need_one', { p0: 'K' })])
    assert.deepEqual(planProblems(plan([{ name: 'a' }, { name: ' ' }]), t), [t('okr.ms.need_name', { p0: 'K' })])
    assert.deepEqual(planProblems(plan(Array.from({ length: 21 }, (_, i) => ({ name: 'm' + i }))), t), [t('okr.ms.too_many', { p0: 'K', p1: 20 })])
  })
  test('提交载荷: 阶段型目标值 = 阶段数、带阶段明细、无单位; 其他类型不带 milestones; 卡点空 = null', () => {
    const k = editorKrPayload({ _k: 3, _blk: true, id: '11', title: 'K', metricType: 'MILESTONE', unit: '个', targetValue: 9, weight: 100, blockers: '  ', milestones: [{ name: ' 评审 ', dueDate: '2026-11-20', done: true }, { name: '上线', dueDate: '', done: false }] })
    assert.deepEqual(k, { id: '11', title: 'K', metricType: 'MILESTONE', unit: null, targetValue: 2, weight: 100, blockers: null, milestones: [{ name: '评审', dueDate: '2026-11-20', done: true }, { name: '上线', dueDate: null, done: false }] })
    const n = editorKrPayload({ _k: 4, title: 'N', metricType: 'NUMBER', unit: '', targetValue: 5, weight: 100, blockers: '等硬件', milestones: [{ name: '旧阶段' }] })
    assert.equal(n.milestones, undefined, '换走阶段型后不带阶段')
    assert.equal(n.blockers, '等硬件')
    assert.equal(n.unit, null)
  })
  test('toDraft 带上阶段明细和 KR 卡点; 已完成数只能是整数', () => {
    const d = toDraft([{ id: '1', title: 'O', weight: 100, status: 'ON_TRACK', keyResults: [msKr(1, { blockers: '等客户' })] }])
    assert.deepEqual(d[0].keyResults[0].milestones.map(m => m.done), [true, false, false])
    assert.equal(d[0].keyResults[0].blockers, '等客户')
    assert.equal(parseProgress('1.5', msKr(0)), null)
    assert.equal(parseProgress('2', msKr(0)), 2)
    assert.equal(parseProgress('4', msKr(0)), null, '超过阶段数')
  })
})

const card = compileView('components/okr/OkrObjectiveCard.vue')
const cardState = (obj, over = {}) => ({
  obj, canEdit: false, canMiss: false, canManagerScore: false, canComplete: false, closed: false, krBusy: '', busy: false,
  open: false, form: { krId: '' }, mScore: null, mComment: '', hasPanel: false, toggleText: '', pickedKr: null, showActs: false, actsDisabled: true,
  OBJ_TAG, pct, krValueText, round: n => n, shDate: s => s, toggle() {}, send() {}, complete() {},
  today: '2026-11-21', milestoneRows, overdueDays, msClickable: false, clickMilestone() {},
  canEditBlocker: false, people: [], compact: false, RISK_LEVELS,
  blkOpen: false, blkEditing: false, blkBusy: false, blk: { blockers: '', blockerOwnerId: '', blockerDueDate: '', riskLevel: 'LOW' }, blkState: 'empty',
  startBlk() {}, saveBlk() {},
  ...over
})
const sobj = (over = {}) => ({
  id: '1', seq: 1, title: '园区巡检', weight: 100, status: 'ON_TRACK', progress: 0.67, submittedAt: 'x', riskLevel: 'LOW', blocker: null,
  keyResults: [msKr(2)], ...over
})
const ext = { 'el-tooltip': true }

describe('O 卡: 阶段型 KR 展示', () => {
  test('「阶段 2/3」+ 三个阶段: 完成打勾, 逾期的红色日期(带「逾期」), 未完成灰', async () => {
    const html = await renderView(card, cardState(sobj()), ext)
    has(html, 'Stage 2/3')
    assert.ok(html.includes('data-test="okr-ms-11"'))
    assert.equal(count(html, 'class="okr-ms-item done'), 2)
    assert.equal(count(html, '✓'), 2)
    has(html, '方案评审')
    has(html, '上线')
    assert.equal(count(html, 'data-test="okr-ms-overdue"'), 0, '没完成的「上线」11-27 还没到')
    const late = await renderView(card, cardState(sobj({ keyResults: [msKr(1)] })), ext)
    assert.equal(count(late, 'data-test="okr-ms-overdue"'), 1, '「联调」11-20 过期未完成')
    has(late, t('okr.ms.overdue', { p0: '11-20' }))
    assert.ok(late.includes('okr-ms-item overdue'))
  })
  test('不能动手时阶段按钮置灰; 能动手时可点', async () => {
    const ro = await renderView(card, cardState(sobj()), ext)
    assert.equal(count(ro, 'data-test="okr-ms-11-\\d" disabled'), 0) // 属性顺序无关, 下面直接数 disabled
    assert.equal(count(ro, '<button type="button" class="okr-ms-item[^"]*" disabled'), 3)
    const rw = await renderView(card, cardState(sobj(), { msClickable: true }), ext)
    assert.equal(count(rw, '<button type="button" class="okr-ms-item[^"]*" disabled'), 0)
  })
})

// ---------------------------------------------------------------- 二、卡点与风险

describe('卡点: 纯函数', () => {
  test('三项要么都空要么都填: 填一半 = partial(禁止保存)', () => {
    assert.equal(blockerFormState({ blockers: '', blockerOwnerId: '', blockerDueDate: '' }), 'empty')
    assert.equal(blockerFormState({ blockers: '  ', blockerOwnerId: null, blockerDueDate: null }), 'empty')
    assert.equal(blockerFormState({ blockers: '等客户开权限', blockerOwnerId: '39', blockerDueDate: '2026-11-25' }), 'complete')
    assert.equal(blockerFormState({ blockers: '等客户开权限', blockerOwnerId: '39', blockerDueDate: '' }), 'partial', '不填截止日')
    assert.equal(blockerFormState({ blockers: '', blockerOwnerId: '39', blockerDueDate: '' }), 'partial')
  })
  test('表单初值来自 blocker 摘要; 提交时空 = 三件套一起清空; 风险只认 LOW/MEDIUM/HIGH', () => {
    const f = blockerForm({ riskLevel: 'HIGH', blocker: { text: '等硬件', ownerId: 39, ownerName: '周舟', dueDate: '2026-11-25' } })
    assert.deepEqual(f, { blockers: '等硬件', blockerOwnerId: '39', blockerDueDate: '2026-11-25', riskLevel: 'HIGH' })
    assert.deepEqual(blockerForm({ riskLevel: 'WHAT' }), { blockers: '', blockerOwnerId: '', blockerDueDate: '', riskLevel: 'LOW' })
    assert.deepEqual(blockerPatch(f), { blockers: '等硬件', blockerOwnerId: '39', blockerDueDate: '2026-11-25', riskLevel: 'HIGH' })
    assert.deepEqual(blockerPatch({ blockers: '', blockerOwnerId: '', blockerDueDate: '', riskLevel: 'MEDIUM' }), { blockers: '', blockerOwnerId: null, blockerDueDate: null, riskLevel: 'MEDIUM' })
  })
  test('逾期天数', () => {
    assert.equal(overdueDays('2026-11-18', '2026-11-21'), 3)
    assert.equal(overdueDays('2026-11-21', '2026-11-21'), 0)
    assert.equal(overdueDays('2026-11-30', '2026-11-21'), 0)
    assert.equal(overdueDays(null, '2026-11-21'), 0)
  })
  test('只改一个 O 的卡点: 整份计划里只有它带卡点字段; KR 带阶段明细 / 卡点说明, 去掉只读的 projects', () => {
    const objs = [
      sobj({ id: '1', projects: [{ id: 7, name: '园区' }], keyResults: [msKr(1, { blockers: '等客户' })] }),
      sobj({ id: '2', title: 'B', blocker: { text: '旧卡点', ownerId: '9', dueDate: '2026-11-01' }, keyResults: [{ id: '21', title: 'b', metricType: 'BINARY', weight: 100, status: null }] })
    ]
    const plan = planWithPatch(objs, '1', { blockers: '等硬件', blockerOwnerId: '39', blockerDueDate: '2026-11-25', riskLevel: 'HIGH' })
    assert.equal(plan[0].blockers, '等硬件')
    assert.equal(plan[0].riskLevel, 'HIGH')
    assert.deepEqual(plan[0].projectIds, ['7'])
    assert.equal(plan[0].projects, undefined)
    assert.ok(!('blockers' in plan[1]) && !('riskLevel' in plan[1]), '其他 O 不带 = 后端不动')
    assert.equal(plan[0].keyResults[0].milestones.length, 3)
    assert.equal(plan[0].keyResults[0].blockers, '等客户')
    assert.equal(plan[1].keyResults[0].milestones, undefined)
  })
  test('卡点人候选: 在职用户 + 当前卡点人(不在列表里时补上)', () => {
    const list = [{ id: 38, name: '林晓', username: 'a' }, { id: 39, name: '周舟' }, { id: 38, name: '重复' }]
    assert.deepEqual(blockerPeople(list).map(p => p.id), ['38', '39'])
    assert.deepEqual(blockerPeople(list, { ownerId: '77', ownerName: '已离职' }).at(-1), { id: '77', name: '已离职', username: '' })
    assert.equal(blockerPeople(list, { ownerId: 39, ownerName: '周舟' }).length, 2)
  })
})

describe('O 卡: 风险圆点 + 卡点区', () => {
  test('头部按 riskLevel 出红 / 黄 / 绿圆点', async () => {
    for (const r of RISK_LEVELS) {
      const html = await renderView(card, cardState(sobj({ riskLevel: r })), ext)
      assert.ok(html.includes(`data-test="okr-risk-${r}"`), r)
      has(html, t('okr.blk.risk.' + r))
    }
  })
  test('没卡点、不能改: 不出卡点区; 能改: 出「没有卡点」', async () => {
    const none = await renderView(card, cardState(sobj()), ext)
    lacks(none, 'data-test="okr-blocker"')
    const rw = await renderView(card, cardState(sobj(), { canEditBlocker: true }), ext)
    assert.ok(rw.includes('data-test="okr-blocker"'))
    has(rw, t('okr.blk.none'))
  })
  test('有卡点: 全员可见(只读也出); 逾期在顶部出红条「依赖已逾期 N 天」', async () => {
    const blocker = { text: '等客户开 VPN', ownerId: '39', ownerName: '周舟', dueDate: '2026-11-18', overdue: true }
    const html = await renderView(card, cardState(sobj({ riskLevel: 'HIGH', blocker }), { blkOpen: true }), ext)
    assert.ok(html.includes('data-test="okr-blocker-overdue"'))
    has(html, t('okr.blk.overdue', { p0: 3 }))
    has(html, '等客户开 VPN')
    assert.ok(html.includes('data-test="okr-blocker-owner"'))
    has(html, '周舟')
    lacks(html, 'data-test="okr-blocker-edit"')
    assert.ok(html.indexOf('okr-blocker-overdue') < html.indexOf('okr-blocker-toggle'), '红条在卡点区顶部')
    const fine = await renderView(card, cardState(sobj({ blocker: { ...blocker, dueDate: '2026-11-30', overdue: false } })), ext)
    lacks(fine, 'data-test="okr-blocker-overdue"')
  })
  test('手机窄屏: 「卡在谁」人名折叠展示', async () => {
    const blocker = { text: '等客户', ownerId: '39', ownerName: '周舟', dueDate: '2026-11-30', overdue: false }
    const html = await renderView(card, cardState(sobj({ blocker }), { blkOpen: true, compact: true }), ext)
    assert.ok(html.includes('data-test="okr-blocker-owner-fold"'))
    assert.ok(html.includes('<details'))
    lacks(html, 'data-test="okr-blocker-owner"')
  })
  test('编辑卡点: 填一半时出提示(与后端 8120 同文案)且保存置灰', async () => {
    const html = await renderView(card, cardState(sobj(), {
      canEditBlocker: true, blkOpen: true, blkEditing: true, blkState: 'partial',
      blk: { blockers: '等客户', blockerOwnerId: '39', blockerDueDate: '', riskLevel: 'MEDIUM' }
    }), ext)
    assert.ok(html.includes('data-test="okr-blocker-partial"'))
    has(html, t('okr.blk.incomplete'))
    assert.match(html, /data-test="okr-blocker-save"[^>]*disabled|disabled[^>]*data-test="okr-blocker-save"/)
    assert.equal(count(html, 'data-test="okr-risk-pick-'), 3)
    const zh = JSON.parse(readFileSync(new URL('../../src/locales/zh-CN.json', import.meta.url), 'utf8'))
    assert.equal(zh.okr.blk.incomplete, '填了卡点就要写清卡在谁、什么时候要', '与后端 BLOCKER_INCOMPLETE_MSG 一致')
  })
  test('KR 卡点说明单独一行', async () => {
    const html = await renderView(card, cardState(sobj({ keyResults: [msKr(0, { blockers: '等测试环境' })] })), ext)
    assert.ok(html.includes('data-test="okr-kr-blk-11"'))
    has(html, t('okr.blk.kr_line', { p0: '等测试环境' }))
  })
})

describe('编辑器: 阶段型 + KR 卡点', () => {
  const render = compileView('components/okr/OkrPlanEditor.vue')
  const st = (krs) => ({
    draft: [{ _k: 1, title: 'A', description: '', weight: 100, projectIds: [], keyResults: krs }],
    manualWeights: false, problems: [], MAX_KRS: 10, MAX_MILESTONES: 20, busy: '', submitted: false, cancellable: false, lateHint: false, submitLabel: '',
    bulk: { visible: false, obj: null }, roomFor: () => 10, projOptions: [], projectLabel: p => p.name,
    addObjective() {}, addKr() {}, removeObjective() {}, removeKr() {}, openBulk() {}, insertBulk() {}, emitPlan() {},
    onTypeChange() {}, setMilestoneDone() {}, blankMilestone
  })
  const extra = { 'el-input-number': true, OkrBulkKrDialog: true }
  test('选「阶段型」才出阶段编辑区(名称 + 日期 + 勾选), 不出目标值', async () => {
    const html = await renderView(render, st([
      { _k: 2, title: 'k', metricType: 'MILESTONE', weight: 50, milestones: [{ name: '评审', dueDate: null, done: false }, { name: '上线', dueDate: null, done: false }] },
      { _k: 3, title: 'b', metricType: 'BINARY', weight: 50, milestones: [] }
    ]), extra)
    assert.ok(html.includes('data-test="okr-ms-ed-0-0"'))
    assert.ok(!html.includes('data-test="okr-ms-ed-0-1"'))
    assert.equal(count(html, 'class="okr-ms-ed-row"'), 2)
    assert.ok(html.includes('data-test="okr-ms-add-0-0"'))
    has(html, t('okr.metric.MILESTONE'))
  })
  test('KR 卡点: 有内容直接出输入框, 没内容出「+ 卡点」', async () => {
    const html = await renderView(render, st([
      { _k: 2, title: 'k', metricType: 'BINARY', weight: 50, blockers: '等硬件', milestones: [] },
      { _k: 3, title: 'b', metricType: 'BINARY', weight: 50, blockers: '', milestones: [] }
    ]), extra)
    assert.ok(html.includes('data-test="okr-ed-kr-blk-0-0"'))
    assert.ok(html.includes('data-test="okr-ed-kr-blk-open-0-1"'))
    assert.ok(!html.includes('data-test="okr-ed-kr-blk-0-1"'))
  })
  test('有没有没保存的改动: 只看计划字段', () => {
    const a = toDraft([{ id: '1', title: 'O', weight: 100, status: 'ON_TRACK', keyResults: [msKr(1)] }])
    const s = planSnapshot(a)
    assert.equal(planSnapshot(a.map(o => ({ ...o, _k: 9 }))), s, '内部 key 不算')
    a[0].keyResults[0].milestones[2].name = '正式上线'
    assert.notEqual(planSnapshot(a), s)
  })
})

// ---------------------------------------------------------------- 三、编计划提效

describe('复制上周 / 批量导入 / 模板: 纯函数', () => {
  test('来源周: 目标周之前的 8 周, 默认第一个 = 上一周(跨年也对)', () => {
    const w = copySourceWeeks('2026-W48')
    assert.equal(w.length, 8)
    assert.equal(w[0], '2026-W47')
    assert.equal(w[7], '2026-W40')
    assert.equal(copySourceWeeks('2027-W01', 1)[0], '2026-W53')
  })
  test('toast 数字与接口一致: 「已复制 2 个 O / 5 个 KR，跳过 1 个（同名）」+ 跳过明细', () => {
    const zhT = (k, p) => {
      const zh = JSON.parse(readFileSync(new URL('../../src/locales/zh-CN.json', import.meta.url), 'utf8'))
      let s = k.split('.').reduce((o, x) => o?.[x], zh)
      for (const [kk, v] of Object.entries(p || {})) s = s.replace(`{${kk}}`, v)
      return s
    }
    const r = { createdObjectives: 2, createdKrs: 5, skipped: [{ objectiveId: '9', title: '周会', reason: '2026-W48 已有同名 O' }] }
    const m = copyResultText(r, zhT)
    assert.equal(m.text, '已复制 2 个 O / 5 个 KR，跳过 1 个（同名）')
    assert.deepEqual(m.lines, ['周会：2026-W48 已有同名 O'])
    assert.equal(m.level, 'warning')
    assert.equal(copyResultText({ createdObjectives: 3, createdKrs: 7, skipped: [] }, zhT).text, '已复制 3 个 O / 7 个 KR')
    assert.equal(copyResultText({ createdObjectives: 3, createdKrs: 7, skipped: [] }, zhT).level, 'success')
    const two = copyResultText({ createdObjectives: 0, createdKrs: 0, skipped: [{ title: 'a', reason: '已有同名 O' }, { title: 'b', reason: '超过每周 3 个 O 的上限' }] }, zhT)
    assert.equal(two.text, '已复制 0 个 O / 0 个 KR，跳过 2 个（同名、超上限）')
  })
  test('跳过原因分类', () => {
    assert.equal(skipReasonKey('2026-W48 已有同名 O'), 'same')
    assert.equal(skipReasonKey('同一段文字里重复的 O'), 'same')
    assert.equal(skipReasonKey('超过每周 3 个 O 的上限'), 'limit')
    assert.equal(skipReasonKey('不是此人 2026-W47 的 O'), 'other')
  })
  test('当前计划 → 模板 Markdown(批量导入能解析的格式); DROPPED / 空标题不进', () => {
    const md = planToMarkdown([
      { title: '上线巡检', weight: 60, status: 'ON_TRACK', keyResults: [
        { title: '接口联调', metricType: 'NUMBER', targetValue: 5, unit: '个', weight: 50 },
        { title: '覆盖率', metricType: 'PERCENT', targetValue: 90, weight: 25 },
        { title: '验收', metricType: 'BINARY', weight: 25 }
      ] },
      { title: '旧的', weight: 0, status: 'DROPPED', keyResults: [{ title: 'x', metricType: 'BINARY', weight: 100 }] },
      { title: '文档', weight: 40, status: 'ON_TRACK', keyResults: [{ title: '阶段', metricType: 'MILESTONE', targetValue: 2, weight: 100 }, { title: ' ', metricType: 'BINARY' }] }
    ])
    assert.equal(md, [
      '## O1：上线巡检（权重 60）',
      '- 接口联调（目标：5个）（权重 50）',
      '- 覆盖率（目标：90%）（权重 25）',
      '- 验收（权重 25）',
      '',
      '## O2：文档（权重 40）',
      '- 阶段（权重 100）'
    ].join('\n'))
    assert.equal(planToMarkdown([]), '')
  })
  test('预览里 KR 类型说明', () => {
    assert.equal(previewKrMeta({ metricType: 'NUMBER', targetValue: 5, unit: '个' }, t), `${t('okr.metric.NUMBER')} 5个`)
    assert.equal(previewKrMeta({ metricType: 'PERCENT', targetValue: 90 }, t), `${t('okr.metric.PERCENT')} 90%`)
    assert.equal(previewKrMeta({ metricType: 'BINARY' }, t), t('okr.metric.BINARY'))
  })
})

describe('批量导入弹窗', () => {
  const render = compileView('components/okr/OkrPlanImportDialog.vue')
  const base = (over = {}) => ({
    modelValue: true, text: '## O1：a\n- k', preview: null, busy: '', limits: { maxObjectives: 3, maxKrsPerObjective: 6 },
    krTotal: 0, canApply: true, round: n => n, previewKrMeta, run() {}, ...over
  })
  test('预览: O/KR 树 + 未识别行(红字) + 截断提示 + 跳过', async () => {
    const preview = {
      submitted: false, truncated: true,
      objectives: [
        { title: '上线巡检', weight: 50, keyResults: [{ title: '接口联调', metricType: 'NUMBER', targetValue: 5, unit: '个' }, { title: '验收', metricType: 'BINARY' }] },
        { title: '文档', weight: 50, keyResults: [{ title: '手册', metricType: 'BINARY' }] }
      ],
      skipped: [{ title: '周会', reason: '本周已有同名 O' }],
      unparsed: [{ line: 3, text: '随便一句话' }]
    }
    const html = await renderView(render, base({ preview, krTotal: 3 }))
    has(html, t('okr.plan.bulk_summary', { p0: 2, p1: 3 }))
    assert.equal(count(html, 'class="okr-imp-o"'), 2)
    assert.equal(count(html, 'class="okr-imp-kr"'), 3)
    assert.ok(html.includes('data-test="okr-imp-truncated"'))
    assert.ok(html.includes('data-test="okr-imp-unparsed"'))
    has(html, '随便一句话')
    assert.ok(html.includes('data-test="okr-imp-skipped"'))
    lacks(html, 'data-test="okr-imp-submitted"')
  })
  test('目标周已提交: 预览里明说, 导入置灰', async () => {
    const html = await renderView(render, base({ preview: { submitted: true, truncated: false, objectives: [], skipped: [], unparsed: [] }, canApply: false }))
    assert.ok(html.includes('data-test="okr-imp-submitted"'))
    // el-dialog 的 footer 插槽测试替身不渲染: 看源码里「导入」的置灰条件
    const src = readFileSync(new URL('../../src/components/okr/OkrPlanImportDialog.vue', import.meta.url), 'utf8')
    assert.match(src, /:disabled="!canApply"[^>]*data-test="okr-imp-apply"/)
    assert.match(src, /preview\.value\.objectives\.length > 0 && !preview\.value\.submitted/)
  })
  test('预览 / 导入分别调 mode=preview / apply', () => {
    const src = readFileSync(new URL('../../src/components/okr/OkrPlanImportDialog.vue', import.meta.url), 'utf8')
    assert.match(src, /run\('preview'\)/)
    assert.match(src, /run\('apply'\)/)
    assert.match(src, /fde\.okr\.bulkImport\(\{ week: props\.week, text: text\.value, mode \}/)
  })
})

describe('模板弹窗 + 我的 OKR 页头入口', () => {
  const render = compileView('components/okr/OkrTemplateDialog.vue')
  test('列表: 名称 + 使用 + 删除; 空态; 编辑器没内容时不能存', async () => {
    const list = [{ id: '5', name: '常规交付周', contentMd: '## O1：a\n- k\n## O2：b\n- k' }]
    const html = await renderView(render, { modelValue: true, list, loading: false, busy: '', name: '', currentMd: '## O1：a\n- k', countObjectives: () => 2, save() {}, remove() {} })
    has(html, '常规交付周')
    has(html, t('okr.plan.tpl_meta', { p0: 2 }))
    assert.ok(html.includes('data-test="okr-tpl-use-5"') && html.includes('data-test="okr-tpl-del-5"'))
    const empty = await renderView(render, { modelValue: true, list: [], loading: false, busy: '', name: '', currentMd: '', countObjectives: () => 0, save() {}, remove() {} })
    assert.ok(empty.includes('data-test="okr-tpl-none"'))
    has(empty, t('okr.plan.tpl_empty_plan'))
  })
  test('我的 OKR: 三个入口只在编辑模式下出; 复制调 copy-from-week(带代管 targetUserId)', () => {
    const src = readFileSync(new URL('../../src/views/okr/MyOkr.vue', import.meta.url), 'utf8')
    assert.match(src, /<div v-if="editorOpen" class="okr-plan-tools"/)
    assert.match(src, /fde\.okr\.copyFromWeek\(\{ fromWeek: copy\.from, toWeek: weekKeyNow\.value \}, proxyTarget\.value \|\| undefined\)/)
    assert.match(src, /:target-user-id="proxyTarget"/)
    assert.match(src, /fde\.okr\.patchKr\(kr\.id, \{ currentValue: act\.value, milestones:/)
  })
})
