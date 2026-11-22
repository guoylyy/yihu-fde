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
