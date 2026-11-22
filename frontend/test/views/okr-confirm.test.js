// 0.6.2 前端: 二级确认 / 变更申请 / 修改记录。纯函数直接测; 组件用真实模板 + 手给状态 SSR 渲染
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  shortTime, clock, isLocked, reasonOk, confirmBar, teamConfirmCell, decidable,
  splitRef, compactChange, auditRow, changeRow, teamCounts, LOCKED_CODE
} from '../../src/views/okr/okrConfirm.js'

const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const zh = JSON.parse(src('locales/zh-CN.json'))
const en = JSON.parse(src('locales/en.json'))
const zt = (key, p = {}) => {
  const v = key.split('.').reduce((a, k) => (a == null ? a : a[k]), zh)
  return v == null ? key : String(v).replace(/\{(\w+)\}/g, (_, k) => p[k])
}

// 11-24 10:12 / 15:20 上海
const T_OWNER = '2026-11-24T02:12:00Z'
const T_MGR = '2026-11-24T07:20:00Z'
const cycle = { key: '2026-W48', status: 'IN_PROGRESS' }
const page = (confirm, can = {}) => ({ cycle, confirm, can })

describe('时间 / 小工具', () => {
  test('上海时间「11-24 10:12」与「10:12」; 空值返回空串', () => {
    assert.equal(shortTime(T_OWNER), '11-24 10:12')
    assert.equal(clock(T_MGR), '15:20')
    assert.equal(shortTime('2026-11-23T17:30:00Z'), '11-24 01:30', 'UTC 前一天、上海已是第二天')
    assert.equal(shortTime(null), '')
    assert.equal(clock('bad'), '')
  })
  test('原因至少 4 个字(去空白、按字符)', () => {
    assert.equal(reasonOk('客户改'), false)
    assert.equal(reasonOk('  客户改期  '), true)
    assert.equal(reasonOk('    '), false)
    assert.equal(reasonOk(null), false)
  })
  test('锁定 = CONFIRMED; 8201 是锁定错误码', () => {
    assert.equal(isLocked(page({ lockStatus: 'CONFIRMED' })), true)
    assert.equal(isLocked(page({ lockStatus: 'AWAITING_MANAGER' })), false)
    assert.equal(isLocked(null), false)
    assert.equal(LOCKED_CODE, 8201)
  })
})

describe('我的 OKR 顶部确认区', () => {
  test('DRAFT: 没提交过不出; 提交后灰条 + 能确认时出「我确认这份 OKR」', () => {
    assert.equal(confirmBar(page({ lockStatus: 'DRAFT' }), { submitted: false }), null)
    const b = confirmBar(page({ lockStatus: 'DRAFT' }, { confirmOwner: true }), { submitted: true })
    assert.deepEqual(b, { kind: 'draft', tone: 'gray', canConfirm: true })
    assert.equal(zh.okr.confirm.bar_draft, '计划已提交，等你自己确认')
    assert.equal(zh.okr.confirm.confirm_mine, '我确认这份 OKR')
  })
  test('AWAITING_MANAGER: 黄条带员工确认时间; 主管看时出确认', () => {
    const b = confirmBar(page({ lockStatus: 'AWAITING_MANAGER', ownerConfirmedAt: T_OWNER }, { confirmManager: true }), { submitted: true })
    assert.equal(b.kind, 'awaiting')
    assert.equal(b.tone, 'yellow')
    assert.equal(b.canManager, true)
    assert.equal(zt('okr.confirm.bar_awaiting', { p0: b.at }), '你已确认（11-24 10:12），等主管确认')
  })
  test('CONFIRMED: 绿条「本周 OKR 已确认并锁定（你 10:12 · 主管 张三 15:20）」, 不再出确认按钮', () => {
    const b = confirmBar(page({
      lockStatus: 'CONFIRMED', ownerConfirmedAt: T_OWNER, managerConfirmedAt: T_MGR, managerConfirmedBy: { id: '9', name: '张三' }
    }, { confirmOwner: false }), { submitted: true })
    assert.equal(b.kind, 'confirmed')
    assert.equal(b.tone, 'green')
    assert.ok(!('canConfirm' in b))
    assert.equal(zt('okr.confirm.bar_confirmed', { p0: b.ownerAt, p1: b.manager, p2: b.managerAt }), '本周 OKR 已确认并锁定（你 10:12 · 主管 张三 15:20）')
  })
  test('锁定 + 有待批申请: 蓝条; 申请人本人能撤回, 别人不能', () => {
    const c = { lockStatus: 'CONFIRMED', pendingChange: { id: '5', requestedBy: { id: '38', name: '林晓' }, createdAt: T_MGR } }
    const mine = confirmBar(page(c), { meId: '38', submitted: true })
    assert.equal(mine.kind, 'pending')
    assert.equal(mine.tone, 'blue')
    assert.equal(mine.changeId, '5')
    assert.equal(mine.cancellable, true)
    assert.equal(confirmBar(page(c), { meId: '40', submitted: true }).cancellable, false)
    assert.equal(zh.okr.confirm.bar_pending, '变更申请已提交，等主管批准')
  })
  test('没有周期 / 没有 confirm → 不出', () => {
    assert.equal(confirmBar({ cycle: null, confirm: { lockStatus: 'DRAFT' } }, { submitted: true }), null)
    assert.equal(confirmBar({ cycle }, { submitted: true }), null)
  })
})

describe('团队页「确认」列', () => {
  const row = (id, submission = 'ON_TIME') => ({ user: { id, name: 'x' }, submission })
  const ctx = { meId: '1', canScore: true }
  test('未提交 → -; 已提交待员工确认 → 等员工确认', () => {
    assert.equal(teamConfirmCell(row('38', 'NONE'), { lockStatus: 'DRAFT' }, ctx).kind, 'none')
    assert.equal(teamConfirmCell(row('38'), undefined, ctx).kind, 'none', '还没拉到状态先不画')
    assert.equal(teamConfirmCell(row('38'), { lockStatus: 'DRAFT' }, ctx).kind, 'await_owner')
    assert.equal(zh.okr.confirm.await_owner, '等员工确认')
  })
  test('待主管确认: 主管 → 按钮; 自己的 / 员工确认是我代点的 / 不是主管 → 灰字', () => {
    const s = { lockStatus: 'AWAITING_MANAGER', ownerConfirmedAt: T_OWNER, ownerConfirmedBy: { id: '38' } }
    assert.equal(teamConfirmCell(row('38'), s, ctx).kind, 'confirm')
    assert.equal(teamConfirmCell(row('1'), s, ctx).kind, 'await_manager')
    assert.equal(teamConfirmCell(row('38'), { ...s, ownerConfirmedBy: { id: '1' } }, ctx).kind, 'await_manager')
    assert.equal(teamConfirmCell(row('38'), s, { meId: '1', canScore: false }).kind, 'await_manager')
    assert.equal(teamConfirmCell(row('38', 'NONE'), s, ctx).kind, 'confirm', '没提交但已确认的也照样能确认')
  })
  test('已确认: 绿字 + 两个时间', () => {
    const c = teamConfirmCell(row('38'), { lockStatus: 'CONFIRMED', ownerConfirmedAt: T_OWNER, managerConfirmedAt: T_MGR, managerConfirmedBy: { name: '张三' } }, ctx)
    assert.deepEqual(c, { kind: 'done', ownerAt: '11-24 10:12', manager: '张三', managerAt: '11-24 15:20' })
    assert.equal(zt('okr.confirm.done_tip', { p0: c.ownerAt, p1: c.manager, p2: c.managerAt }), '员工 11-24 10:12 · 主管 张三 11-24 15:20')
  })
  test('计数: 待你确认 / 变更待批(只算我能批的)', () => {
    const rows = [row('38'), row('39'), row('1')]
    const map = {
      38: { lockStatus: 'AWAITING_MANAGER', ownerConfirmedBy: { id: '38' } },
      39: { lockStatus: 'CONFIRMED' },
      1: { lockStatus: 'AWAITING_MANAGER', ownerConfirmedBy: { id: '1' } }
    }
    const changes = [
      { id: 'a', status: 'PENDING', owner: { id: '39' }, requestedBy: { id: '39' } },
      { id: 'b', status: 'PENDING', owner: { id: '1' }, requestedBy: { id: '1' } },
      { id: 'c', status: 'PENDING', owner: { id: '38' }, requestedBy: { id: '1' } }
    ]
    const r = teamCounts(rows, map, changes, ctx)
    assert.deepEqual(r.toConfirm.map(x => x.user.id), ['38'])
    assert.deepEqual(r.pending.map(x => x.id), ['a'], '自己的、自己提的都不算')
    assert.equal(zt('okr.confirm.to_confirm_n', { p0: 3 }), '待你确认 3')
    assert.equal(zt('okr.confirm.pending_n', { p0: 2 }), '变更待批 2')
    assert.equal(decidable({ status: 'APPROVED', owner: { id: '39' }, requestedBy: { id: '39' } }, '1'), false)
  })
})

describe('修改记录行', () => {
  const ctx = { meId: '38', ownerId: '38' }
  test('引用拆分 / 前缀合并「目标值 3 → 5」', () => {
    assert.deepEqual(splitRef('O2.KR1 客户现场复测'), { code: 'O2.KR1', title: '客户现场复测' })
    assert.deepEqual(splitRef('O1 园区巡检'), { code: 'O1', title: '园区巡检' })
    assert.deepEqual(splitRef('变更申请 #5'), { code: '', title: '变更申请 #5' })
    assert.equal(compactChange('目标值 3', '目标值 5'), '目标值 3 → 5')
    assert.equal(compactChange('旧标题', '新标题'), '旧标题 → 新标题')
  })
  test('我改 KR 目标值: 11-24 09:41  我  改 KR 目标值  O2.KR1  目标值 3 → 5', () => {
    const r = auditRow({
      id: 1, action: 'TARGET_EDIT', actionLabel: '修改目标值', actorId: '38', actorName: '林晓', targetType: 'KR',
      targetRef: 'O2.KR1 客户复测', field: 'targetValue', before: '目标值 3', after: '目标值 5', source: 'DIRECT', createdAt: '2026-11-24T01:41:00Z'
    }, ctx, zt)
    assert.equal(r.when, '11-24 09:41')
    assert.equal(r.who, '我')
    assert.equal(r.manager, false)
    assert.equal(r.label, '改 KR 目标值')
    assert.equal(r.code, 'O2.KR1')
    assert.equal(r.summary, '目标值 3 → 5')
    assert.equal(r.fromChange, false)
    assert.equal(r.expandable, true)
  })
  test('新增 KR: 「客户现场复测通过」; 主管确认: 张三（主管）确认本周计划, 没有摘要', () => {
    const add = auditRow({ id: 2, action: 'KR_ADD', actorId: '38', targetType: 'KR', targetRef: 'O2.KR3 客户现场复测通过', before: null, after: 'KR3「客户现场复测通过」…', createdAt: T_OWNER }, ctx, zt)
    assert.equal(add.label, '新增 KR')
    assert.equal(add.summary, '「客户现场复测通过」')
    const mc = auditRow({ id: 3, action: 'MANAGER_CONFIRM', actorId: '9', actorName: '张三', targetType: 'PLAN', targetRef: null, before: '待主管确认', after: '已确认(锁定)', source: 'CONFIRM', createdAt: T_MGR }, ctx, zt)
    assert.equal(mc.who, '张三')
    assert.equal(mc.manager, true)
    assert.equal(mc.label, '确认本周计划')
    assert.equal(mc.summary, '')
  })
  test('来自变更申请的改动标 fromChange; 不认识的动作用后端 actionLabel', () => {
    const r = auditRow({ id: 4, action: 'KR_EDIT', actorId: '9', actorName: '张三', targetType: 'KR', targetRef: 'O1.KR1 a', before: 'a', after: 'b', reason: '客户改期', source: 'CHANGE_APPLY', createdAt: T_MGR }, ctx, zt)
    assert.equal(r.fromChange, true)
    assert.equal(r.reason, '客户改期')
    assert.equal(auditRow({ id: 5, action: 'NEW_THING', actionLabel: '新动作', actorId: '38', createdAt: T_MGR }, ctx, zt).label, '新动作')
  })
})

describe('变更待批行', () => {
  test('申请人 / 代提 / 原因 / 条数 / 差异', () => {
    const r = changeRow({
      id: 7, owner: { id: '38', name: '林晓' }, requestedBy: { id: '40', name: '王主管' }, reason: '客户改期', diffCount: 1,
      diffs: [{ action: 'TARGET_EDIT', actionLabel: '修改目标值', targetRef: 'O2.KR1 复测', before: '目标值 3', after: '目标值 5' }], createdAt: T_OWNER
    }, zt)
    assert.equal(r.ownerName, '林晓')
    assert.equal(r.requester, '王主管')
    assert.equal(r.count, 1)
    assert.deepEqual(r.diffs[0], { key: 0, label: '改 KR 目标值', code: 'O2.KR1', title: '复测', before: '目标值 3', after: '目标值 5' })
    assert.equal(changeRow({ id: 8, owner: { id: '38' }, requestedBy: { id: '38' }, diffs: [] }).requester, '')
  })
})

describe('文案: 中英 key 一致', () => {
  test('okr.confirm 两份 key 相同', () => {
    const keys = o => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v).map(x => `${k}.${x}`) : [k])).sort()
    assert.deepEqual(keys(zh.okr.confirm), keys(en.okr.confirm))
  })
})

// ---------------------------------------------------------------- 组件 / 页面渲染(测试语言 en)
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { pct, toDraft } from '../../src/views/okr/okrUtils.js'
import { initialOf, mayProxyRow } from '../../src/views/okr/okrPeople.js'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)
const drawer = { props: ['modelValue', 'size'], setup: (p, { slots }) => () => Vue.h('aside', { 'data-size': p.size }, slots.default?.()) }

describe('确认区组件 OkrConfirmBar', () => {
  const render = compileView('components/okr/OkrConfirmBar.vue')
  const st = (bar, over = {}) => ({ bar, otherName: '', busy: false, text: 'TEXT', ...over })
  test('draft: 灰条 + 「我确认这份 OKR」; 代管时「替 X 确认」', async () => {
    const html = await renderView(render, st({ kind: 'draft', tone: 'gray', canConfirm: true }))
    assert.match(html, /class="okr-cf-bar is-gray"/)
    assert.ok(html.includes('data-test="okr-confirm-owner"'))
    has(html, t('okr.confirm.confirm_mine'))
    const proxy = await renderView(render, st({ kind: 'draft', tone: 'gray', canConfirm: true }, { otherName: '林晓' }))
    has(proxy, t('okr.confirm.confirm_for', { p0: '林晓' }))
  })
  test('awaiting: 黄条; 员工本人没有按钮, 主管有「确认」', async () => {
    const own = await renderView(render, st({ kind: 'awaiting', tone: 'yellow', canManager: false }))
    assert.match(own, /is-yellow/)
    assert.ok(!own.includes('data-test="okr-confirm-owner"') && !own.includes('data-test="okr-confirm-manager"'))
    const mgr = await renderView(render, st({ kind: 'awaiting', tone: 'yellow', canManager: true }))
    assert.ok(mgr.includes('data-test="okr-confirm-manager"'))
  })
  test('confirmed: 绿条, 不再出确认按钮(不能取消); pending: 蓝条, 申请人有「撤回申请」', async () => {
    const ok = await renderView(render, st({ kind: 'confirmed', tone: 'green' }))
    assert.match(ok, /is-green/)
    assert.ok(!/okr-confirm-(owner|manager)|okr-change-cancel/.test(ok))
    const pend = await renderView(render, st({ kind: 'pending', tone: 'blue', cancellable: true, changeId: '5' }))
    assert.match(pend, /is-blue/)
    assert.ok(pend.includes('data-test="okr-change-cancel"'))
    has(pend, t('okr.confirm.cancel_change'))
  })
  test('没有 bar 不出', async () => {
    assert.ok(!(await renderView(render, st(null))).includes('okr-cf-bar'))
  })
  test('手机: 确认按钮 ≥44px、占满一行', () => {
    const c = src('components/okr/OkrConfirmBar.vue')
    assert.match(c, /@media \(max-width: 640px\) \{\s*\.okr-cf-btn \{ min-height: 44px; flex: 1 1 100%; \}/)
  })
})

describe('修改记录抽屉 OkrAuditDrawer', () => {
  const render = compileView('components/okr/OkrAuditDrawer.vue')
  const items = [
    { id: 3, action: 'MANAGER_CONFIRM', actorId: '9', actorName: '张三', targetType: 'PLAN', before: '待主管确认', after: '已确认(锁定)', source: 'CONFIRM', createdAt: T_MGR },
    { id: 2, action: 'TARGET_EDIT', actorId: '9', actorName: '张三', targetType: 'KR', targetRef: 'O2.KR1 复测', before: '目标值 3', after: '目标值 5', reason: '客户改期', source: 'CHANGE_APPLY', createdAt: T_OWNER }
  ]
  const st = (over = {}) => {
    const s = { modelValue: true, mobile: false, loading: false, open: {}, ...over }
    s.rows = (over.items || items).map(i => auditRow(i, { meId: '38', ownerId: '38' }, t))
    return s
  }
  test('倒序一行一条: 时间 / 谁(主管) / 动作 / O2.KR1 / 目标值 3 → 5 / 「变更申请」来源', async () => {
    const html = await renderView(render, st(), { 'el-drawer': drawer })
    assert.ok(html.indexOf('okr-audit-3') < html.indexOf('okr-audit-2'), '按给的顺序(后端已倒序)')
    has(html, '11-24 15:20')
    has(html, '张三' + t('okr.confirm.manager_tag'))
    has(html, t('okr.confirm.act.TARGET_EDIT'))
    assert.ok(html.includes('>O2.KR1<'))
    has(html, '目标值 3 → 5')
    assert.equal((html.match(/data-test="okr-audit-from-change"/g) || []).length, 1)
    assert.ok(!html.includes('okr-au-detail'), '默认收起')
    lacks(html, t('okr.manager_score'))
  })
  test('展开: 改前 / 改后全文 + 原因', async () => {
    const html = await renderView(render, st({ open: { 2: true } }), { 'el-drawer': drawer })
    assert.ok(html.includes('okr-au-detail'))
    has(html, t('okr.confirm.before')); has(html, '目标值 3')
    has(html, t('okr.confirm.reason')); has(html, '客户改期')
    has(html, t('okr.confirm.collapse'))
  })
  test('空态「本周还没有修改记录」; 宽屏 520px / 手机全屏', async () => {
    const html = await renderView(render, st({ items: [] }), { 'el-drawer': drawer })
    assert.ok(html.includes('data-test="okr-audit-empty"'))
    assert.equal(zh.okr.confirm.audit_empty, '本周还没有修改记录')
    assert.ok(html.includes('data-size="520px"'))
    assert.ok((await renderView(render, st({ mobile: true }), { 'el-drawer': drawer })).includes('data-size="100%"'))
  })
  test('接线: 打开就拉 /plan/audit(带周和人)', () => {
    const c = src('components/okr/OkrAuditDrawer.vue')
    assert.match(c, /fde\.okr\.audit\(\{ week: props\.week, userId: props\.ownerId \|\| undefined/)
    assert.match(c, /watch\(\(\) => props\.modelValue, v => \{ if \(v\) load\(\) \}\)/)
    const api = src('api/index.js')
    assert.ok(api.includes("audit: (params = {}) => request('/api/okr/plan/audit?'"))
  })
})

describe('变更待批 OkrChangeReviewDialog', () => {
  const render = compileView('components/okr/OkrChangeReviewDialog.vue')
  const change = {
    id: 7, status: 'PENDING', owner: { id: '38', name: '林晓' }, requestedBy: { id: '38', name: '林晓' }, reason: '客户改期', diffCount: 1,
    diffs: [{ action: 'TARGET_EDIT', targetRef: 'O2.KR1 复测', before: '目标值 3', after: '目标值 5' }], createdAt: T_OWNER
  }
  const st = (over = {}) => ({ modelValue: true, mobile: false, busy: '', open: {}, rows: [changeRow(change, t)], ...over })
  test('申请人 / 原因 / 改了几条 / 查看差异 / 批准 / 拒绝', async () => {
    const html = await renderView(render, st())
    has(html, '林晓'); has(html, '客户改期')
    has(html, t('okr.confirm.diff_n', { p0: 1 }))
    for (const k of ['okr-change-diff-7', 'okr-change-approve-7', 'okr-change-reject-7']) assert.ok(html.includes(`data-test="${k}"`), k)
    assert.ok(!html.includes('okr-change-diffs-7'), '差异默认收起')
    const open = await renderView(render, st({ open: { 7: true } }))
    assert.ok(open.includes('data-test="okr-change-diffs-7"'))
    has(open, '目标值 3'); has(open, '目标值 5')
  })
  test('空态; 套不上的申请批准置灰并给原因', async () => {
    assert.ok((await renderView(render, st({ rows: [] }))).includes('data-test="okr-changes-empty"'))
    const bad = await renderView(render, st({ rows: [changeRow({ ...change, previewError: '权重之和须为 100' }, t)] }))
    has(bad, t('okr.confirm.preview_error', { p0: '权重之和须为 100' }))
    assert.match(bad, /disabled[^>]*data-test="okr-change-approve-7"|data-test="okr-change-approve-7"[^>]*disabled/)
  })
  test('接线: 拒绝必须填原因; 批准 / 拒绝后通知父组件移除并刷新那个人', () => {
    const c = src('components/okr/OkrChangeReviewDialog.vue')
    assert.match(c, /inputValidator: v => !!String\(v \|\| ''\)\.trim\(\) \|\| \$t\('okr\.confirm\.reject_need'\)/)
    assert.match(c, /fde\.okr\.rejectChange\(r\.id, note\)/)
    assert.match(c, /fde\.okr\.approveChange\(r\.id\)/)
    assert.equal((c.match(/emit\('decided'/g) || []).length, 2)
  })
})

describe('团队页: 确认列 / 两个计数', () => {
  const render = compileView('views/okr/TeamOkr.vue')
  const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrWeekStatus: true, OkrExportMenu: true, OkrManagerScorePanel: true, OkrChangeReviewDialog: true }
  const row = (id, name, submission = 'ON_TIME') => ({ user: { id, name }, submission, objectiveCount: 1, completion: 0.5, krDone: 1, krTotal: 2, selfScore: null })
  const rows = [row('38', '林晓'), row('39', '周舟'), row('4', 'Riley'), row('3', 'Sam', 'NONE')]
  const cells = {
    38: { kind: 'confirm', ownerAt: '11-24 10:12' },
    39: { kind: 'done', ownerAt: '11-24 10:12', manager: '张三', managerAt: '11-24 15:20' },
    4: { kind: 'await_owner' },
    3: { kind: 'none' }
  }
  const base = (over = {}) => ({
    loading: false, isMobile: false, meId: '1', me: { id: '1', role: 'ADMIN' }, people: [], canScore: true, anyProxy: false, lead: true,
    weekKeyNow: '2026-W48', weekParts: { year: 2026, weekNo: 48 }, cycleTag: 'info', canCloseWeek: false, mgrOpen: false, mgrChanged: false,
    pct, initialOf, mayProxyRow: () => false, subText: r => r.submission, subClass: () => 'okr-sub', openPerson() {}, openProxy() {}, shift() {}, load() {},
    data: { cycle: { status: 'IN_PROGRESS' }, summary: { expected: 4, submitted: 3, late: 0, avgCompletion: 0.5 }, rows, lowStreak: { people: [], weeks: [] } },
    cellOf: r => cells[r.user.id], counts: { toConfirm: [rows[0]], pending: [{ id: 'a' }, { id: 'b' }] },
    ...over
  })
  test('确认列: 待主管确认 → 「确认」按钮; 已确认绿字 + 两个时间; 等员工确认灰字; 未提交 -', async () => {
    const html = await renderView(render, base(), EXTRA)
    has(html, t('okr.confirm.col'))
    const cell = id => html.split(`data-test="okr-cf-cell-${id}"`)[1].split('</span>')[0]
    assert.ok(html.split('data-test="okr-cf-cell-38"')[1].slice(0, 400).includes('data-test="okr-row-confirm"'))
    assert.ok(html.split('data-test="okr-cf-cell-39"')[1].slice(0, 400).includes(esc(t('okr.confirm.done'))))
    has(html, t('okr.confirm.done_tip', { p0: '11-24 10:12', p1: '张三', p2: '11-24 15:20' }))
    assert.ok(cell('4').includes(esc(t('okr.confirm.await_owner'))))
    assert.ok(html.split('data-test="okr-cf-cell-3"')[1].slice(0, 120).includes('>-<'))
    assert.equal((html.match(/data-test="okr-row-confirm"/g) || []).length, 1)
  })
  test('计数: 「待你确认 1」「变更待批 2」, 只给主管', async () => {
    const html = await renderView(render, base(), EXTRA)
    has(html, t('okr.confirm.to_confirm_n', { p0: 1 }))
    has(html, t('okr.confirm.pending_n', { p0: 2 }))
    const eng = await renderView(render, base({ canScore: false, lead: false, me: { id: '38', role: 'FDE_ENGINEER' } }), EXTRA)
    assert.ok(!eng.includes('data-test="okr-cf-counts"'))
  })
  test('手机卡片也有确认按钮(≥44px)', async () => {
    const html = await renderView(render, base({ isMobile: true }), EXTRA)
    assert.ok(html.includes('class="okr-m-cf-btn"') || /okr-m-cf-btn/.test(html))
    assert.match(src('views/okr/TeamOkr.vue'), /\.okr-m-cf-btn \{ min-height: 44px;/)
  })
  test('接线: 行确认带二次确认弹窗; 逐人拉 confirm-status; 主管拉 PENDING 变更; 批准后移除并刷新', () => {
    const s = src('views/okr/TeamOkr.vue')
    assert.match(s, /async function confirmRow[\s\S]{0,200}ElMessageBox\.confirm\(\$t\('okr\.confirm\.manager_confirm_body'\)/)
    assert.equal(zh.okr.confirm.manager_confirm_body, '确认后这周 OKR 锁定，改动需走变更申请')
    assert.match(s, /fde\.okr\.confirmStatus\(week, userId\)/)
    assert.match(s, /fde\.okr\.changes\(\{ week, status: 'PENDING' \}\)/)
    assert.match(s, /changes\.value = changes\.value\.filter\(c => String\(c\.id\) !== String\(id\)\)/)
  })
})

describe('我的 OKR: 锁定 / 申请变更 / 修改记录', () => {
  const render = compileView('views/okr/MyOkr.vue')
  const cardStub = { props: ['obj'], setup: p => () => Vue.h('section', { class: 'card' }, p.obj.title) }
  const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrObjectiveCard: cardStub, OkrPlanEditor: { props: ['submitLabel', 'submitted'], setup: p => () => Vue.h('div', { 'data-test': 'editor', 'data-label': p.submitLabel, 'data-submitted': String(!!p.submitted) }) }, OkrReportDraftDialog: true, OkrConfirmBar: { props: ['bar'], setup: p => () => Vue.h('div', { 'data-test': 'cfbar', 'data-kind': p.bar?.kind || '' }) }, OkrAuditDrawer: true, OkrWeekPlanCard: true, OkrRiskBars: true, OkrExportMenu: true, OkrManagerScorePanel: true, OkrPlanImportDialog: true, OkrTemplateDialog: true, 'el-drawer': true, 'el-input-number': true }
  const obj = { id: '1', seq: 1, title: 'O-上线', weight: 100, status: 'ON_TRACK', progress: 0.4, submittedAt: '2026-11-16T02:00:00Z', keyResults: [], updatedKey: '0' }
  const base = (over = {}) => {
    const s = {
      loading: false, isMobile: false, busy: '', editing: false, draftInit: [], editorRef: null, reportOpen: false, reportSource: 'text',
      empty: null, nav: { prev: true, next: true }, weekDates: {}, backfillTag: '', isPastWeek: false, deadlinePassed: false, weekLabel: '', startBackfill() {},
      self: { visible: false, rows: [] }, handling: { total: 0, handled: 0, missing: [] }, scoresComplete: () => false, miss: { visible: false, reason: '' }, copy: { visible: false, from: '' }, imp: { visible: false, text: '' }, tpl: { visible: false, md: '' }, copyWeeks: [], copyWeekLabel: w => w, blockerPeople: () => [], blkUsers: [],
      scorable: [obj], showSelfBtn: false, selfAllDone: false, selfBtnText: '', isClosed: false, krBusy: '', mgr: { visible: false },
      pickedId: '38', people: [], meId: '38', meName: '林晓', ownerId: '', ownerName: '林晓',
      viewingOther: false, proxyMode: false, proxyTarget: '', canAct: true, canEditPlan: false, canScoreManager: false,
      submittedOnce: true, canTeam: true, tagText: '', tagType: 'info', weekKeyNow: '2026-W48', weekParts: { year: 2026, weekNo: 48 },
      pct, shift() {}, pickPerson() {}, openDraft() {}, startEdit() {}, savePlan() {}, addUpdate() {}, managerScore() {}, openMiss() {}, fillFromReport() {},
      data: { owner: { id: '38', name: '林晓' }, completion: 0.4, cycle: { status: 'IN_PROGRESS' }, can: { edit: false, viewAudit: true }, objectives: [obj] },
      locked: true, showChangeBtn: true, showAuditBtn: true, cfBar: { kind: 'confirmed', tone: 'green' },
      ...over
    }
    if (!('editorOpen' in s)) s.editorOpen = !!s.editing && !!s.data?.cycle
    return s
  }
  test('锁定: 「改计划」置灰 + tooltip「已确认，改动请申请变更」; 页头「申请变更」「修改记录」', async () => {
    const html = await renderView(render, base(), EXTRA)
    assert.ok(html.includes('data-test="okr-edit-locked"'))
    assert.match(html, /<button type="button" class="okr-edit-link" disabled/)
    has(html, t('okr.confirm.locked_tip'))
    assert.equal(zh.okr.confirm.locked_tip, '已确认，改动请申请变更')
    assert.ok(html.includes('data-test="okr-change-open"') && html.includes('data-test="okr-audit-open"'))
    assert.ok(html.includes('data-kind="confirmed"'))
  })
  test('没锁: 改计划正常可点, 没有置灰版 / 申请变更', async () => {
    const html = await renderView(render, base({ locked: false, canEditPlan: true, showChangeBtn: false, showAuditBtn: false, cfBar: { kind: 'draft' } }), EXTRA)
    assert.ok(!html.includes('data-test="okr-edit-locked"') && !html.includes('data-test="okr-change-open"'))
    has(html, t('okr.edit_plan'))
  })
  test('变更申请编辑态: 蓝色说明条; 保存按钮文案「提交变更申请」(没有存草稿); 复制 / 导入 / 贴周报入口不出; 确认区先收起', async () => {
    const html = await renderView(render, base({ editing: true, changeMode: true }), EXTRA)
    assert.ok(html.includes('data-test="okr-change-bar"'))
    assert.ok(html.includes(`data-label="${esc(t('okr.confirm.submit_change'))}"`))
    assert.ok(html.includes('data-submitted="true"'), 'submitted=true → 编辑器不出「存草稿」')
    assert.ok(!html.includes('data-test="okr-plan-tools"') && !html.includes('data-test="report-open"'))
    assert.ok(!html.includes('data-test="cfbar"'))
  })
  test('源码约束: 锁定时不放行保存 —— 编辑器提交在变更态只走 submitChange, 原因 ≥4 字; 8201 重拉', () => {
    const s = src('views/okr/MyOkr.vue')
    assert.match(s, /function onEditorSubmit\(objs\) \{\s*if \(changeMode\.value\) return submitChange\(objs\)\s*return savePlan\(objs, true\)/)
    const sc = s.slice(s.indexOf('async function submitChange'), s.indexOf('async function', s.indexOf('async function submitChange') + 10))
    assert.match(sc, /inputValidator: v => reasonOk\(v\) \|\| \$t\('okr\.confirm\.reason_short'\)/)
    assert.match(sc, /fde\.okr\.requestChange\(\{ week: weekKeyNow\.value, reason, objectives \}, proxyTarget\.value \|\| undefined\)/)
    assert.doesNotMatch(sc, /savePlan|submitPlan/)
    assert.match(s, /if \(e\.code === LOCKED_CODE\) await load\(\)/)
    // 待批时再点「申请变更」: 只提示 + 撤回
    assert.match(s, /const pend = pendingChangeOf\(data\.value\)[\s\S]{0,400}okr\.confirm\.pending_exists_body/)
    // 确认区紧跟周切换
    const bar = s.indexOf('<OkrWeekBar'); const cf = s.indexOf('<OkrConfirmBar')
    assert.ok(bar > 0 && cf > bar && cf < s.indexOf('<OkrWeekPlanCard'))
    assert.equal(toDraft([obj])[0].id, '1', '变更申请带整份计划(含 id, 后端按 id 对齐 diff)')
  })
})
