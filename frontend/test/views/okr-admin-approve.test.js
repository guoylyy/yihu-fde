// 0.6.6 前端: 管理员也能批准 OKR 变更申请(含自己计划上的、自己提的)。纯函数直接测; 组件 SSR 渲染(测试语言为 en)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { confirmBar, decidable, teamCounts } from '../../src/views/okr/okrConfirm.js'

const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const zh = JSON.parse(src('locales/zh-CN.json'))
const en = JSON.parse(src('locales/en.json'))
const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;')

const cycle = { key: '2026-W48', status: 'IN_PROGRESS' }
const pendingBy = (id, name = '老板') => ({
  cycle, owner: { id: '188' }, can: {},
  confirm: { lockStatus: 'CONFIRMED', pendingChange: { id: '77', requestedBy: { id, name }, createdAt: '2026-11-24T02:12:00Z' } }
})

describe('decidable / 团队页「变更待批」', () => {
  const own = { id: 'a', status: 'PENDING', owner: { id: '188' }, requestedBy: { id: '188' } }
  const proxied = { id: 'b', status: 'PENDING', owner: { id: '38' }, requestedBy: { id: '188' } }
  const onMine = { id: 'c', status: 'PENDING', owner: { id: '188' }, requestedBy: { id: '40' } }
  const others = { id: 'd', status: 'PENDING', owner: { id: '39' }, requestedBy: { id: '39' } }
  const done = { id: 'e', status: 'APPROVED', owner: { id: '188' }, requestedBy: { id: '188' } }
  const all = [own, proxied, onMine, others, done]

  test('ADMIN: 自己提的 / 自己计划上的也算能批; 已处理的不算', () => {
    for (const c of [own, proxied, onMine, others]) assert.equal(decidable(c, '188', { isAdmin: true }), true, c.id)
    assert.equal(decidable(done, '188', { isAdmin: true }), false)
    const { pending } = teamCounts([], {}, all, { meId: '188', canScore: true, isAdmin: true })
    assert.deepEqual(pending.map(c => c.id), ['a', 'b', 'c', 'd'])
  })
  test('非 ADMIN 不变: 自己的、自己提的都不算(默认参数也一样)', () => {
    const mgr = all.map(c => ({ ...c, owner: { id: c.owner.id === '188' ? '40' : c.owner.id }, requestedBy: { id: c.requestedBy.id === '188' ? '40' : c.requestedBy.id } }))
    const { pending } = teamCounts([], {}, mgr, { meId: '40', canScore: true, isAdmin: false })
    assert.deepEqual(pending.map(c => c.id), ['d'])
    assert.equal(decidable(mgr[0], '40'), false)
  })
  test('源码约束: 团队页 ctx 带 isAdmin; teamCounts 把 isAdmin 传给 decidable', () => {
    assert.match(src('views/okr/TeamOkr.vue'), /const cfCtx = \{ meId, canScore, isAdmin: me\.role === 'ADMIN' \}/)
    assert.match(src('views/okr/okrConfirm.js'), /decidable\(c, ctx\?\.meId, \{ isAdmin: !!ctx\?\.isAdmin \}\)/)
  })

  const dialog = compileView('components/okr/OkrChangeReviewDialog.vue')
  test('变更待批弹窗: 管理员自己提的那条也有「批准 / 驳回」', async () => {
    const ctx = { modelValue: true, mobile: false, changes: [{ ...own, reason: '客户要求提前', owner: { id: '188', name: '老板' }, requestedBy: { id: '188', name: '老板' }, diffCount: 1, diffs: [] }] }
    const html = await renderView(dialog, { ...ctx, rows: ctx.changes.map(c => ({ id: c.id, ownerName: '老板', requester: '', reason: c.reason, count: 1, diffs: [], error: '', at: '' })), open: {}, busy: '' })
    assert.ok(html.includes('data-test="okr-change-approve-a"'), html)
    assert.ok(html.includes('data-test="okr-change-reject-a"'))
  })
})

describe('我的 OKR 顶部蓝条: 管理员自己提的变更申请', () => {
  test('ADMIN + 自己提的 → canApprove=true, 仍能撤回', () => {
    const b = confirmBar(pendingBy('188'), { meId: '188', submitted: true, ownerId: '188', isAdmin: true })
    assert.equal(b.kind, 'pending')
    assert.equal(b.canApprove, true)
    assert.equal(b.cancellable, true)
    assert.equal(b.changeId, '77')
  })
  test('非 ADMIN 自己提的 → 不给批准(只能撤回); ADMIN 但申请是别人提的 → 不给(走团队页)', () => {
    const m = confirmBar(pendingBy('188'), { meId: '188', submitted: true, ownerId: '188', isAdmin: false })
    assert.equal(m.canApprove, false)
    assert.equal(m.cancellable, true)
    const o = confirmBar(pendingBy('40', '主管'), { meId: '188', submitted: true, ownerId: '188', isAdmin: true })
    assert.equal(o.canApprove, false)
    assert.equal(o.cancellable, false)
  })

  const render = compileView('components/okr/OkrConfirmBar.vue')
  const approveBtn = html => (html.match(/<[^>]*data-test="okr-change-approve-self"[^>]*>[^<]*/) || [''])[0]
  test('组件: canApprove → 文案「你是管理员，可以自己批准这条变更」+「批准」按钮; 否则老文案、无按钮', async () => {
    const yes = await renderView(render, { bar: { kind: 'pending', tone: 'blue', changeId: '77', canApprove: true, cancellable: true }, otherName: '', busy: false, text: t('okr.confirm.bar_pending_admin') })
    assert.ok(approveBtn(yes), yes)
    assert.ok(approveBtn(yes).endsWith(esc(t('okr.confirm.approve'))), approveBtn(yes))
    assert.ok(yes.includes('data-test="okr-change-cancel"'), '撤回还在')
    const no = await renderView(render, { bar: { kind: 'pending', tone: 'blue', changeId: '77', canApprove: false, cancellable: true }, otherName: '', busy: false, text: t('okr.confirm.bar_pending') })
    assert.ok(!no.includes('okr-change-approve-self'))
  })
  test('文案与源码约束', () => {
    assert.equal(zh.okr.confirm.bar_pending_admin, '你是管理员，可以自己批准这条变更')
    assert.ok(en.okr.confirm.bar_pending_admin)
    for (const k of ['self_approve_title', 'self_approve_body', 'self_approved_ok']) {
      assert.ok(zh.okr.confirm[k], `zh ${k}`)
      assert.ok(en.okr.confirm[k], `en ${k}`)
    }
    const bar = src('components/okr/OkrConfirmBar.vue')
    assert.match(bar, /b\.canApprove \? \$t\('okr\.confirm\.bar_pending_admin'\) : \$t\('okr\.confirm\.bar_pending'\)/)
    assert.match(bar, /\$emit\('approve-change', bar\.changeId\)/)
    const my = src('views/okr/MyOkr.vue')
    assert.match(my, /@approve-change="approveOwnChange"/)
    assert.match(my, /await fde\.okr\.approveChange\(id\)/)
    assert.match(my, /self_approve_body/)
  })
})
