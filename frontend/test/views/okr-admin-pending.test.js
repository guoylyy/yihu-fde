// 0.6.6 补: 管理员看不到「变更待批」—— 三处修掉
//   1. 团队页计数条只看 canScore(团队数据为空也出), 弹窗挪到 v-if="data" 外面
//   2. 计数 / 弹窗拉全部 PENDING(不传 week), 弹窗每条带周次 +「谁提的 · 谁的计划」, 点周次改 ?week= 并关弹窗
//   3. 我的 OKR 给 ADMIN 一条蓝条「有 N 条变更申请待你审批」→ 同一个弹窗
// 纯函数直接测; 组件用真实模板 + 手给状态 SSR 渲染(测试语言为 en)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import { changeRow, teamCounts } from '../../src/views/okr/okrConfirm.js'
import { pct } from '../../src/views/okr/okrUtils.js'

const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const zh = JSON.parse(src('locales/zh-CN.json'))
const en = JSON.parse(src('locales/en.json'))
const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const zt = (key, p = {}) => {
  const v = key.split('.').reduce((a, k) => (a == null ? a : a[k]), zh)
  return v == null ? key : String(v).replace(/\{(\w+)\}/g, (_, k) => p[k])
}

// 员工林晓(38)的计划, 王牡丹(41)代提, 上一周; 周舟(39)自己提的, 本周
const proxied = { id: '91', week: '2026-W46', status: 'PENDING', owner: { id: '38', name: '林晓' }, requestedBy: { id: '41', name: '王牡丹' }, reason: '客户改期', diffCount: 1, diffs: [], createdAt: '2026-11-15T02:00:00Z' }
const own = { id: '92', week: '2026-W47', status: 'PENDING', owner: { id: '39', name: '周舟' }, requestedBy: { id: '39', name: '周舟' }, reason: '范围调整', diffCount: 2, diffs: [], createdAt: '2026-11-20T02:00:00Z' }

describe('changeRow: 周次 + 申请人 → 负责人', () => {
  test('代提: 「王牡丹 提的 · 林晓 的计划」; 自己提的: 「周舟 自己提的」; 周次原样带出', () => {
    const a = changeRow(proxied, zt)
    assert.equal(a.week, '2026-W46')
    assert.equal(a.relation, '王牡丹 提的 · 林晓 的计划')
    const b = changeRow(own, zt)
    assert.equal(b.week, '2026-W47')
    assert.equal(b.relation, '周舟 自己提的')
    assert.equal(changeRow({ ...own, week: undefined }, zt).week, '')
  })
  test('文案: 空态「没有待审批的变更申请」; 中英 key 齐', () => {
    assert.equal(zh.okr.confirm.pending_empty, '没有待审批的变更申请')
    assert.equal(zh.okr.confirm.admin_pending_bar, '有 {p0} 条变更申请待你审批')
    for (const k of ['relation', 'relation_self', 'goto_week', 'admin_pending_bar', 'pending_empty']) {
      assert.ok(zh.okr.confirm[k], `zh ${k}`)
      assert.ok(en.okr.confirm[k], `en ${k}`)
    }
  })
  test('ADMIN 计数: 跨周的两条都算', () => {
    const { pending } = teamCounts(undefined, {}, [proxied, own], { meId: '188', canScore: true, isAdmin: true })
    assert.deepEqual(pending.map(c => c.id), ['91', '92'])
  })
})

describe('变更待批弹窗: 周次按钮 + 关系', () => {
  const dialog = compileView('components/okr/OkrChangeReviewDialog.vue')
  const state = changes => ({ modelValue: true, mobile: false, changes, rows: changes.map(c => changeRow(c, t)), open: {}, busy: '' })
  test('每条: 周次按钮(可点, 带 title) + 「filed by 王牡丹 · 林晓\'s plan」+ 批准 / 拒绝', async () => {
    const html = await renderView(dialog, state([proxied, own]))
    const btn = (html.match(/<button[^>]*data-test="okr-change-week-91"[^>]*>[^<]*<\/button>/) || [''])[0]
    assert.ok(btn, html)
    assert.ok(btn.includes('>2026-W46</button>'), btn)
    assert.ok(btn.includes(`title="${esc(t('okr.confirm.goto_week', { p0: '2026-W46' }))}"`), btn)
    assert.ok(html.includes('data-test="okr-change-week-92"'))
    assert.ok(html.includes(esc(t('okr.confirm.relation', { p0: '王牡丹', p1: '林晓' }))))
    assert.ok(html.includes(esc(t('okr.confirm.relation_self', { p0: '周舟' }))))
    assert.ok(html.includes('data-test="okr-change-approve-91"') && html.includes('data-test="okr-change-reject-92"'))
  })
  test('空列表 → 空态文案', async () => {
    const html = await renderView(dialog, state([]))
    assert.ok(html.includes('data-test="okr-changes-empty"'))
    assert.ok(html.includes(esc(t('okr.confirm.pending_empty'))))
  })
  test('源码: 点周次 emit goto-week({ week, ownerId })', () => {
    const s = src('components/okr/OkrChangeReviewDialog.vue')
    assert.match(s, /@click="\$emit\('goto-week', \{ week: r\.week, ownerId: r\.owner\?\.id \|\| '' \}\)"/)
    assert.match(s, /defineEmits\(\['update:modelValue', 'decided', 'goto-week'\]\)/)
  })
})

describe('团队页: 团队数据为空计数条也在; 拉全部 PENDING', () => {
  const render = compileView('views/okr/TeamOkr.vue')
  const dialogStub = { props: ['changes', 'modelValue'], setup: p => () => Vue.h('div', { 'data-test': 'review-dialog', 'data-n': String(p.changes?.length ?? 0), 'data-open': String(!!p.modelValue) }) }
  const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrWeekStatus: true, OkrExportMenu: true, OkrManagerScorePanel: true, OkrChangeReviewDialog: dialogStub }
  const base = (over = {}) => ({
    loading: false, isMobile: false, meId: '188', me: { id: '188', role: 'ADMIN' }, people: [], canScore: true, anyProxy: false, lead: true,
    weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 }, cycleTag: 'info', canCloseWeek: true, mgrOpen: false, mgrChanged: false,
    pct, initialOf: n => String(n || '').slice(0, 1), mayProxyRow: () => false, subText: r => r.submission, subClass: () => 'okr-sub', openPerson() {}, openProxy() {}, shift() {}, load() {},
    data: null, counts: { toConfirm: [], pending: [proxied] },
    ...over
  })
  test('data = null(团队数据拉失败)→ 计数条仍在, 「Changes pending 1」, 弹窗也在', async () => {
    const html = await renderView(render, base(), EXTRA)
    assert.ok(html.includes('data-test="okr-cf-counts"'), html)
    const counts = html.split('data-test="okr-cf-counts"')[1].split('</div>')[0]
    assert.ok(counts.includes(esc(t('okr.confirm.pending_n', { p0: 1 }))), counts)
    assert.ok(!html.includes('data-test="okr-team-table"'), '团队表格本来就不出')
    assert.ok(html.includes('data-test="review-dialog" data-n="1"'), '弹窗不依赖 data')
  })
  test('非主管(canScore=false)→ 计数条、弹窗都不出', async () => {
    const html = await renderView(render, base({ canScore: false }), EXTRA)
    assert.ok(!html.includes('data-test="okr-cf-counts"'))
    assert.ok(!html.includes('data-test="review-dialog"'))
  })
  test('源码: v-if 只看 canScore; 不传 week; 弹窗在 v-if="data" 外; 点周次改 ?week= 并关弹窗', () => {
    const s = src('views/okr/TeamOkr.vue')
    assert.match(s, /<div v-if="canScore" class="okr-cf-counts"/)
    assert.ok(!/canScore && data" class="okr-cf-counts"/.test(s))
    assert.match(s, /fde\.okr\.changes\(\{ status: 'PENDING' \}\)/)
    assert.ok(!/fde\.okr\.changes\(\{ week/.test(s), '不再按周拉')
    const tpl = s.split('<script setup>')[0]
    const dataBlockEnd = tpl.lastIndexOf('</template>\n    <!-- 0.6.6')
    assert.ok(dataBlockEnd > 0 && tpl.indexOf('<OkrChangeReviewDialog') > dataBlockEnd, '弹窗在 v-if="data" 块之后')
    assert.match(s, /@goto-week="gotoWeek"/)
    assert.match(s, /function gotoWeek\(\{ week \}\) \{\n  changesOpen\.value = false\n  if \(week && week !== route\.query\.week\) router\.push\(\{ query: \{ \.\.\.route\.query, week \} \}\)/)
    // 换周时也重拉(变更待批与团队数据各拉各的, 团队数据失败不影响)
    assert.match(s, /watch\(\(\) => route\.query\.week, \(\) => \{ load\(\); loadChanges\(\) \}, \{ immediate: true \}\)/)
  })
})

describe('我的 OKR: 管理员蓝条「有 N 条变更申请待你审批」', () => {
  const render = compileView('views/okr/MyOkr.vue')
  const dialogStub = { props: ['changes', 'modelValue'], setup: p => () => Vue.h('div', { 'data-test': 'review-dialog', 'data-n': String(p.changes?.length ?? 0) }) }
  const EXTRA = { OkrPersonPicker: true, OkrWeekBar: true, OkrObjectiveCard: true, OkrPlanEditor: true, OkrReportDraftDialog: true, OkrConfirmBar: true, OkrAuditDrawer: true, OkrWeekPlanCard: true, OkrRiskBars: true, OkrExportMenu: true, OkrManagerScorePanel: true, OkrPlanImportDialog: true, OkrTemplateDialog: true, OkrChangeReviewDialog: dialogStub, 'el-drawer': true, 'el-input-number': true }
  const base = (over = {}) => ({
    loading: false, isMobile: false, busy: '', editing: false, editorOpen: false, draftInit: [], editorRef: null, reportOpen: false, reportSource: 'text',
    empty: null, nav: { prev: true, next: true }, weekDates: {}, backfillTag: '', isPastWeek: false, deadlinePassed: false, weekLabel: '', startBackfill() {},
    self: { visible: false, rows: [] }, handling: { total: 0, handled: 0, missing: [] }, scoresComplete: () => false, miss: { visible: false, reason: '' }, copy: { visible: false, from: '' }, imp: { visible: false, text: '' }, tpl: { visible: false, md: '' }, copyWeeks: [], copyWeekLabel: w => w, blockerPeople: () => [], blkUsers: [],
    scorable: [], showSelfBtn: false, selfAllDone: false, selfBtnText: '', isClosed: false, krBusy: '', mgr: { visible: false },
    pickedId: '188', people: [], meId: '188', meName: '老板', ownerId: '', ownerName: '老板',
    viewingOther: false, proxyMode: false, proxyTarget: '', canAct: true, canEditPlan: false, canScoreManager: true,
    submittedOnce: false, canTeam: true, tagText: '', tagType: 'info', weekKeyNow: '2026-W47', weekParts: { year: 2026, weekNo: 47 },
    pct, shift() {}, pickPerson() {}, openDraft() {}, startEdit() {}, savePlan() {}, addUpdate() {}, managerScore() {}, openMiss() {}, fillFromReport() {},
    data: null, cfBar: null,
    isAdmin: true, adminPending: [proxied],
    ...over
  })
  const bar = html => (html.split('data-test="okr-admin-pending-bar"')[1] || '').split('</div>')[0]
  test('ADMIN + 1 条 → 蓝条「1 change request(s) awaiting your approval」+「View」; 弹窗挂着同一份列表', async () => {
    const html = await renderView(render, base(), EXTRA)
    const b = bar(html)
    assert.ok(b, html)
    assert.ok(b.includes(esc(t('okr.confirm.admin_pending_bar', { p0: 1 }))), b)
    assert.ok(b.includes('data-test="okr-admin-pending-view"') && b.includes(esc(t('common.view'))), b)
    assert.ok(html.includes('data-test="review-dialog" data-n="1"'))
    assert.equal(zt('okr.confirm.admin_pending_bar', { p0: 1 }), '有 1 条变更申请待你审批')
  })
  test('N=0 → 不出; 非 ADMIN → 蓝条、弹窗都不出', async () => {
    assert.ok(!(await renderView(render, base({ adminPending: [] }), EXTRA)).includes('okr-admin-pending-bar'))
    const mgr = await renderView(render, base({ isAdmin: false }), EXTRA)
    assert.ok(!mgr.includes('okr-admin-pending-bar'))
    assert.ok(!mgr.includes('data-test="review-dialog"'))
  })
  test('源码: 只给 ADMIN 拉、不传 week、随 load 刷新; 点周次带上负责人跳过去', () => {
    const s = src('views/okr/MyOkr.vue')
    assert.match(s, /const isAdmin = me\.role === 'ADMIN'/)
    assert.match(s, /async function loadAdminPending\(\) \{\n  if \(!isAdmin\) return/)
    assert.match(s, /fde\.okr\.changes\(\{ status: 'PENDING' \}\)/)
    assert.match(s, /async function load\(\) \{\n  loadAdminPending\(\)/)
    assert.match(s, /<div v-if="isAdmin && adminPending\.length" class="okr-admin-pending-bar"/)
    assert.match(s, /@click="adminChangesOpen = true"/)
    assert.match(s, /router\.push\(\{ query: \{ \.\.\.queryForPerson\(route\.query, owner \|\| meId, meId\), week \} \}\)/)
    assert.match(s, /\.okr-admin-pending-bar \{[^}]*background: #eaf2fd/)
  })
})
