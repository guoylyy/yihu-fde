// 0.6.5 前端: 管理员自确认(后端已放开 ADMIN 确认任何人, 含自己)。纯函数直接测; 组件 SSR 渲染(测试语言为 en)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { confirmBar, teamConfirmCell, teamCounts } from '../../src/views/okr/okrConfirm.js'
import { pct } from '../../src/views/okr/okrUtils.js'
import { initialOf } from '../../src/views/okr/okrPeople.js'

const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const zh = JSON.parse(src('locales/zh-CN.json'))
const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;')
const zt = (key, p = {}) => String(key.split('.').reduce((a, k) => a?.[k], zh)).replace(/\{(\w+)\}/g, (_, k) => p[k])

const T_OWNER = '2026-11-24T02:12:00Z'
const T_MGR = '2026-11-24T07:20:00Z' // 上海 15:20
const cycle = { key: '2026-W48', status: 'IN_PROGRESS' }
const page = (confirm, can = {}, owner = { id: '188' }) => ({ cycle, confirm, can, owner })
const awaiting = { lockStatus: 'AWAITING_MANAGER', ownerConfirmedAt: T_OWNER, ownerConfirmedBy: { id: '188' } }

describe('我的 OKR 顶部: 管理员自己那份', () => {
  test('ADMIN + 自己 + can.confirmManager → 黄条带「确认并锁定」(self=true)', () => {
    const b = confirmBar(page(awaiting, { confirmManager: true }), { meId: '188', submitted: true, ownerId: '188', isAdmin: true })
    assert.equal(b.kind, 'awaiting')
    assert.equal(b.canManager, true)
    assert.equal(b.self, true)
    assert.equal(zh.okr.confirm.confirm_lock, '确认并锁定')
  })
  test('非 ADMIN 看自己那份: 就算接口误给 can.confirmManager 也不出按钮', () => {
    const b = confirmBar(page(awaiting, { confirmManager: true }), { meId: '188', submitted: true, ownerId: '188', isAdmin: false })
    assert.equal(b.canManager, false)
    assert.equal(b.self, false)
    const none = confirmBar(page(awaiting, { confirmManager: false }), { meId: '188', submitted: true, ownerId: '188', isAdmin: true })
    assert.equal(none.canManager, false, '后端没放就不出')
  })
  test('ADMIN 看别人: 照旧「确认」, 不是自确认', () => {
    const b = confirmBar(page(awaiting, { confirmManager: true }, { id: '38' }), { meId: '188', submitted: true, ownerId: '38', isAdmin: true })
    assert.equal(b.canManager, true)
    assert.equal(b.self, false)
  })
  test('自确认之后: 绿条「本周 OKR 已确认并锁定（管理员自确认 · 15:20）」', () => {
    const c = { lockStatus: 'CONFIRMED', ownerConfirmedAt: T_OWNER, managerConfirmedAt: T_MGR, managerConfirmedBy: { id: '188', name: '老板' } }
    const b = confirmBar(page(c), { meId: '188', submitted: true, ownerId: '188', isAdmin: true })
    assert.equal(b.tone, 'green')
    assert.equal(b.selfConfirm, true)
    assert.equal(zt('okr.confirm.bar_confirmed_self', { p0: b.managerAt }), '本周 OKR 已确认并锁定（管理员自确认 · 15:20）')
    const other = confirmBar(page({ ...c, managerConfirmedBy: { id: '9', name: '张三' } }), { meId: '188', submitted: true, ownerId: '188' })
    assert.equal(other.selfConfirm, false, '别人确认的还是老文案')
  })
})

describe('确认区组件: 自确认按钮 / 绿条', () => {
  const render = compileView('components/okr/OkrConfirmBar.vue')
  const btn = html => (html.match(/<[^>]*data-test="okr-confirm-manager"[^>]*>[^<]*/) || [''])[0]
  test('self → 按钮文案「确认并锁定」; 非 self → 「确认」', async () => {
    const self = await renderView(render, { bar: { kind: 'awaiting', tone: 'yellow', canManager: true, self: true }, otherName: '', busy: false, text: 'T' })
    assert.ok(btn(self).includes('data-self="true"'))
    assert.ok(btn(self).endsWith(esc(t('okr.confirm.confirm_lock'))), btn(self))
    const mgr = await renderView(render, { bar: { kind: 'awaiting', tone: 'yellow', canManager: true, self: false }, otherName: '林晓', busy: false, text: 'T' })
    assert.ok(btn(mgr).endsWith(t('okr.confirm.confirm_manager')))
    const none = await renderView(render, { bar: { kind: 'awaiting', tone: 'yellow', canManager: false, self: false }, otherName: '', busy: false, text: 'T' })
    assert.ok(!none.includes('okr-confirm-manager'), '非 ADMIN 看不到')
  })
  test('源码约束: confirmed + selfConfirm 用「管理员自确认」文案', () => {
    const s = src('components/okr/OkrConfirmBar.vue')
    assert.match(s, /b\.kind === 'confirmed' && b\.selfConfirm/)
    assert.match(s, /okr\.confirm\.bar_confirmed_self'/)
  })
})

describe('团队页: 管理员自己那行', () => {
  const row = (id, submission = 'ON_TIME') => ({ user: { id, name: 'x' }, submission })
  test('ADMIN: 自己那行也给「确认」, self=true; 员工确认是我代点的也能确认', () => {
    const ctx = { meId: '188', canScore: true, isAdmin: true }
    const c = teamConfirmCell(row('188'), awaiting, ctx)
    assert.equal(c.kind, 'confirm')
    assert.equal(c.self, true)
    assert.equal(teamConfirmCell(row('38'), { ...awaiting, ownerConfirmedBy: { id: '188' } }, ctx).kind, 'confirm')
    assert.ok(!('self' in teamConfirmCell(row('38'), awaiting, ctx)), '别人那行照旧')
    assert.equal(zh.okr.confirm.confirm_self, '确认（自）')
  })
  test('MANAGER: 自己那行照旧灰字', () => {
    const c = teamConfirmCell(row('40'), awaiting, { meId: '40', canScore: true, isAdmin: false })
    assert.equal(c.kind, 'await_manager')
  })
  test('「待你确认」计数含管理员自己那份', () => {
    const rows = [row('188'), row('38')]
    const map = { 188: awaiting, 38: { lockStatus: 'DRAFT' } }
    const { toConfirm } = teamCounts(rows, map, [], { meId: '188', canScore: true, isAdmin: true })
    assert.deepEqual(toConfirm.map(r => r.user.id), ['188'])
  })

  const render = compileView('views/okr/TeamOkr.vue')
  const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrWeekStatus: true, OkrExportMenu: true, OkrManagerScorePanel: true, OkrChangeReviewDialog: true }
  const r = (id, name) => ({ user: { id, name }, submission: 'ON_TIME', objectiveCount: 1, completion: 0.5, krDone: 1, krTotal: 2, selfScore: null })
  const rows = [r('188', '老板'), r('38', '林晓')]
  const cells = { 188: { kind: 'confirm', self: true, ownerAt: '11-24 10:12' }, 38: { kind: 'confirm', ownerAt: '11-24 10:12' } }
  const base = (isMobile) => ({
    loading: false, isMobile, meId: '188', me: { id: '188', role: 'ADMIN' }, people: [], canScore: true, anyProxy: false, lead: true,
    weekKeyNow: '2026-W48', weekParts: { year: 2026, weekNo: 48 }, cycleTag: 'info', canCloseWeek: false, mgrOpen: false, mgrChanged: false,
    pct, initialOf, mayProxyRow: () => false, subText: x => x.submission, subClass: () => 'okr-sub', openPerson() {}, openProxy() {}, shift() {}, load() {},
    data: { cycle: { status: 'IN_PROGRESS' }, summary: { expected: 2, submitted: 2, late: 0, avgCompletion: 0.5 }, rows, lowStreak: { people: [], weeks: [] } },
    cellOf: x => cells[x.user.id], counts: { toConfirm: rows, pending: [] }
  })
  for (const mobile of [false, true]) {
    test(`${mobile ? '手机' : '桌面'}: 自己那行「确认（自）」, 别人那行「确认」`, async () => {
      const html = await renderView(render, base(mobile), EXTRA)
      const btns = [...html.matchAll(/<[^>]*data-test="okr-row-confirm"[^>]*>([^<]*)/g)]
      const selfBtn = btns.find(m => m[0].includes('data-self="true"'))
      assert.ok(selfBtn, 'ADMIN 自己那行有按钮')
      assert.equal(selfBtn[1], t('okr.confirm.confirm_self'))
      assert.ok(btns.some(m => !m[0].includes('data-self') && m[1] === t('okr.confirm.confirm_manager')))
    })
  }
  test('源码约束: 自确认弹窗写清「这是你自己的 OKR，确认后本周锁定」; ctx 带 isAdmin', () => {
    const s = src('views/okr/TeamOkr.vue')
    assert.match(s, /const cfCtx = \{ meId, canScore, isAdmin: me\.role === 'ADMIN' \}/)
    assert.match(s, /selfConfirm \? \$t\('okr\.confirm\.self_confirm_body'\)/)
    assert.equal(zh.okr.confirm.self_confirm_body, '这是你自己的 OKR，确认后本周锁定')
    const my = src('views/okr/MyOkr.vue')
    assert.match(my, /isAdmin: me\.role === 'ADMIN'/)
    assert.match(my, /const selfConfirm = !!cfBar\.value\?\.self/)
    assert.match(my, /selfConfirm \? \$t\('okr\.confirm\.self_confirm_body'\)/)
    assert.ok(esc(t('okr.confirm.self_confirm_body')).length > 0)
  })
})
