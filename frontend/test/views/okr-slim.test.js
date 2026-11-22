// 精简第二轮(前端): 周 OKR 页的「本周项目计划」+ 我的今日的「今天的总结」。
// 纯函数直接测; 组件用真实模板 + 手给状态 SSR 渲染(测试语言为 en, 文案用 t() 取; 中文文案另读 zh-CN.json 对照)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileView, renderView, t } from '../helpers/sfc-render.js'
import {
  whenText, weekPlanMeta, hasPlan, planTitleOf, planDirty,
  DIGEST_LIMIT, todayDigest, digestDirty, savedTime
} from '../../src/views/okr/okrSlim.js'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const has = (html, text) => assert.ok(html.includes(esc(text)), `应出现: ${text}`)
const lacks = (html, text) => assert.ok(!html.includes(esc(text)), `不应出现: ${text}`)
const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length
const src = rel => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8')
const zh = JSON.parse(src('locales/zh-CN.json'))
const en = JSON.parse(src('locales/en.json'))
const zt = (key, p = {}) => key.split('.').reduce((a, k) => a[k], zh).replace(/\{(\w+)\}/g, (_, k) => p[k])

// 2026-11-22 18:00 上海
const NOW = new Date('2026-11-22T10:00:00Z')

// ---------------------------------------------------------------- 一、本周项目计划

describe('本周项目计划: 纯函数', () => {
  test('更新时间: 今天 / 昨天 / 更早(上海时区)', () => {
    assert.equal(whenText('2026-11-22T08:20:00Z', zt, NOW), '今天 16:20')
    assert.equal(whenText('2026-11-21T01:05:00Z', zt, NOW), '昨天 09:05')
    assert.equal(whenText('2026-11-18T08:20:00Z', zt, NOW), '11-18 16:20')
    assert.equal(whenText('2026-11-21T17:30:00Z', zt, NOW), '今天 01:30', 'UTC 前一天、上海已是今天')
    assert.equal(whenText(null, zt, NOW), '')
  })
  test('右上小字「张三 今天 16:20 更新」; 没有计划不出', () => {
    assert.equal(weekPlanMeta({ updatedAt: '2026-11-22T08:20:00Z', updatedByName: '张三' }, zt, NOW), '张三 今天 16:20 更新')
    assert.equal(weekPlanMeta({ updatedAt: null, contentMd: null }, zt, NOW), '')
    assert.equal(weekPlanMeta(null, zt, NOW), '')
  })
  test('有没有正文 / 保存可点 / 上传标题', () => {
    assert.equal(hasPlan({ contentMd: '  \n ' }), false)
    assert.equal(hasPlan({ contentMd: '# x' }), true)
    assert.equal(hasPlan(null), false)
    assert.equal(planDirty({ contentMd: 'a' }, 'a'), false, '没改')
    assert.equal(planDirty({ contentMd: 'a' }, 'b'), true)
    assert.equal(planDirty({ contentMd: null }, '   '), false, '空白不让存')
    assert.equal(planTitleOf('前言\n## 第 47 周计划 ##\n- a', 'file'), '第 47 周计划')
    assert.equal(planTitleOf('没有标题', 'W47-计划'), 'W47-计划', '没有 # 标题用文件名')
  })
})

const planRender = compileView('components/okr/OkrWeekPlanCard.vue')
const planState = (over = {}) => ({
  plan: { week: '2026-W47', title: null, contentMd: null, updatedAt: null, updatedByName: null, editable: false },
  loading: false, open: true, editing: false, draft: '', saving: false, uploading: false, fileInput: null,
  weekNo: 47, filled: false, html: '', meta: '', dirty: false, DRAFT_FILE_ACCEPT: '.md,.markdown,.txt,.docx',
  startEdit() {}, cancel() {}, save() {}, onFile() {},
  ...over
})

describe('本周项目计划卡片', () => {
  test('标题: 「本周项目计划 · 第 47 周（整体，不分项目）」', async () => {
    const html = await renderView(planRender, planState())
    has(html, t('okr.slim.plan_title', { p0: 47 }))
    assert.equal(zt('okr.slim.plan_title', { p0: 47 }), '本周项目计划 · 第 47 周（整体，不分项目）')
  })
  test('空态: 工程师只看到「本周还没有项目计划」, 没有按钮', async () => {
    const html = await renderView(planRender, planState())
    assert.ok(html.includes('data-test="wplan-empty"'))
    has(html, t('okr.slim.plan_empty'))
    assert.equal(zh.okr.slim.plan_empty, '本周还没有项目计划')
    assert.ok(!html.includes('data-test="wplan-start"') && !html.includes('data-test="wplan-edit"'))
  })
  test('空态: ADMIN / MANAGER(editable)多一个「粘贴或上传」', async () => {
    const html = await renderView(planRender, planState({ plan: { ...planState().plan, editable: true } }))
    assert.ok(html.includes('data-test="wplan-start"'))
    has(html, t('okr.slim.plan_start'))
    assert.equal(zh.okr.slim.plan_start, '粘贴或上传')
  })
  test('只读: Markdown 渲染成 HTML + 右上「张三 今天 16:20 更新」; 能写的人多一个「编辑」', async () => {
    const plan = { week: '2026-W47', contentMd: '# 计划\n- 巡检', updatedAt: '2026-11-22T08:20:00Z', updatedByName: '张三', editable: true }
    const st = planState({ plan, filled: true, html: '<h1>计划</h1><ul><li>巡检</li></ul>', meta: '张三 今天 16:20 更新' })
    const html = await renderView(planRender, st)
    assert.ok(html.includes('<h1>计划</h1><ul><li>巡检</li></ul>'), 'v-html 原样出')
    assert.match(html, /data-test="wplan-meta">张三 今天 16:20 更新</)
    assert.ok(html.includes('data-test="wplan-edit"'))
    assert.ok(!html.includes('data-test="wplan-empty"'))
    const ro = await renderView(planRender, { ...st, plan: { ...plan, editable: false } })
    assert.ok(!ro.includes('data-test="wplan-edit"'), '工程师 / 已结束的周没有编辑')
  })
  test('编辑态: 文本框 +「上传 .md / .docx」+ 取消 / 保存; 没改动保存置灰', async () => {
    const html = await renderView(planRender, planState({ plan: { ...planState().plan, editable: true }, editing: true, draft: '# x' }))
    for (const k of ['wplan-input', 'wplan-upload', 'wplan-file', 'wplan-cancel', 'wplan-save']) assert.ok(html.includes(`data-test="${k}"`), k)
    has(html, t('okr.slim.plan_upload'))
    assert.match(html, /accept="\.md,\.markdown,\.txt,\.docx"/)
    assert.match(html, /data-test="wplan-save"[^>]*disabled|disabled[^>]*data-test="wplan-save"/)
    assert.ok(!html.includes('data-test="wplan-edit"'), '编辑中不再出「编辑」')
  })
  test('折叠: 只剩标题行', async () => {
    const html = await renderView(planRender, planState({ open: false, filled: true, html: '<p>x</p>', meta: 'm' }))
    assert.ok(html.includes('data-test="wplan-title"'))
    assert.ok(!html.includes('data-test="wplan-md"') && !html.includes('data-test="wplan-empty"'))
  })
  test('接线: 调 GET / PUT /api/okr/week-plan, 上传走 /import 只填文本框(不落库); 随 week 重新拉; 渲染复用 safeMarkdown', () => {
    const api = src('api/index.js')
    assert.ok(api.includes("weekPlan: (week) => request('/api/okr/week-plan?'"))
    assert.match(api, /saveWeekPlan: \(week, \{ title, contentMd \}\) => request\(`\/api\/okr\/week-plan\?week=\$\{encodeURIComponent\(week\)\}`, \{ method: 'PUT'/)
    assert.match(api, /request\('\/api\/okr\/week-plan\/import', \{ method: 'POST', body: fd/)
    const c = src('components/okr/OkrWeekPlanCard.vue')
    assert.match(c, /watch\(\(\) => props\.week, load, \{ immediate: true \}\)/)
    assert.match(c, /import \{ renderSafeMarkdown \} from '@\/utils\/safeMarkdown\.js'/)
    // 上传后只改 draft, 不调保存
    const onFile = c.slice(c.indexOf('async function onFile'), c.indexOf('</script>'))
    assert.match(onFile, /fde\.okr\.importWeekPlan\(file\)/)
    assert.match(onFile, /draft\.value = r\.contentMd/)
    assert.doesNotMatch(onFile, /saveWeekPlan/)
    // 编辑按钮以后端 editable 为准(ADMIN / MANAGER, 已结束的周后端给 false)
    assert.match(c, /v-if="plan\.editable"/)
  })
  test('周 OKR 页: 卡片在页头周切换(OkrWeekBar)正下方, 跟着 weekKeyNow 走', () => {
    const s = src('views/okr/MyOkr.vue')
    const bar = s.indexOf('<OkrWeekBar')
    const card = s.indexOf('<OkrWeekPlanCard :week="weekKeyNow" />')
    assert.ok(bar > 0 && card > bar, '在周切换下面')
    assert.ok(card < s.indexOf('<template v-if="data">'), '在 O 卡之前')
  })
})

// ---------------------------------------------------------------- 二、今天的总结(我的今日)

const item = (n) => ({ text: `O1「巡检」· KR${n}「第 ${n} 项」：0% → 50%` })
const view = (row) => ({ date: '2026-11-22', rows: row ? [row] : [] })
const me = (over = {}) => ({ user: { id: '38', name: '林晓' }, hasOkr: true, autoItems: [], summary: null, hasWritten: false, ...over })

describe('今天的总结: 纯函数', () => {
  test('最多 5 条, 多的出「再看 N 条」; 展开后全给', () => {
    const v = view(me({ autoItems: [1, 2, 3, 4, 5, 6, 7, 8].map(item) }))
    const d = todayDigest(v, '38')
    assert.equal(DIGEST_LIMIT, 5)
    assert.equal(d.items.length, 5)
    assert.equal(d.more, 3)
    assert.equal(d.total, 8)
    const all = todayDigest(v, '38', { expanded: true })
    assert.equal(all.items.length, 8)
    assert.equal(all.more, 0)
    assert.equal(zt('okr.slim.today_more', { p0: 3 }), '再看 3 条')
  })
  test('已写: 输入框初值 = 之前那句, savedAt 给更新时间; 只认自己那一行', () => {
    const v = { rows: [me({ user: { id: '39' }, summary: { summaryMd: '别人的' }, hasWritten: true }), me({ summary: { summaryMd: '巡检二期验收完', updatedAt: '2026-11-22T08:20:00Z' }, hasWritten: true })] }
    const d = todayDigest(v, 38)
    assert.equal(d.summary, '巡检二期验收完')
    assert.equal(d.savedAt, '2026-11-22T08:20:00Z')
    assert.equal(savedTime(d.savedAt), '16:20')
    assert.equal(zt('okr.slim.today_saved_at', { p0: '16:20' }), '已保存 16:20')
  })
  test('本周没交计划(后端不列我) / 没进展: 空列表, 仍可写', () => {
    for (const v of [view(null), view(me()), null]) {
      const d = todayDigest(v, '38')
      assert.deepEqual([d.items.length, d.more, d.summary, d.savedAt], [0, 0, '', null])
    }
  })
  test('保存可点: 写了字且和已存的不一样', () => {
    assert.equal(digestDirty('', ''), false)
    assert.equal(digestDirty('', '  '), false)
    assert.equal(digestDirty('', '今天做完了'), true)
    assert.equal(digestDirty('今天做完了', ' 今天做完了 '), false)
    assert.equal(digestDirty('今天做完了', '今天做完了一半'), true)
  })
})

const tsRender = compileView('components/okr/OkrTodaySummary.vue')
const tsState = (digest, over = {}) => ({
  loading: false, error: '', expanded: false, draft: digest.summary, saving: false, dirty: false,
  digest, savedTime, save() {},
  ...over
})

describe('今天的总结卡片', () => {
  test('标题行「今天的总结」; 进展最多 5 条 +「再看 3 条」; 输入框 + 保存', async () => {
    const d = todayDigest(view(me({ autoItems: [1, 2, 3, 4, 5, 6, 7, 8].map(item) })), '38')
    const html = await renderView(tsRender, tsState(d))
    assert.match(html, new RegExp(`data-test="today-summary-title">${esc(t('okr.slim.today_title'))}<`))
    assert.equal(zh.okr.slim.today_title, '今天的总结')
    assert.equal(count(html, 'KR\\d「第'), 5)
    has(html, item(5).text)
    lacks(html, item(6).text)
    assert.match(html, /data-test="today-summary-more"[^>]*>\s*Show 3 more\s*</)
    assert.ok(html.includes('data-test="today-summary-input"') && html.includes('data-test="today-summary-save"'))
    assert.ok(!html.includes('data-test="today-summary-saved"'), '没写过不出「已保存」')
  })
  test('已写: 右侧「已保存 16:20」; 不到 5 条不出「再看」', async () => {
    const d = todayDigest(view(me({ autoItems: [item(1)], summary: { summaryMd: '巡检二期验收完', updatedAt: '2026-11-22T08:20:00Z' }, hasWritten: true })), '38')
    const html = await renderView(tsRender, tsState(d))
    assert.match(html, /data-test="today-summary-saved">Saved 16:20</)
    assert.ok(!html.includes('data-test="today-summary-more"'))
  })
  test('没有进展: 「今天还没有 OKR 进展」, 输入框仍在', async () => {
    const html = await renderView(tsRender, tsState(todayDigest(view(null), '38')))
    assert.ok(html.includes('data-test="today-summary-none"'))
    has(html, t('okr.slim.today_none'))
    assert.equal(zh.okr.slim.today_none, '今天还没有 OKR 进展')
    assert.ok(html.includes('data-test="today-summary-input"'))
  })
  test('接线: 只取自己(scope=me), 保存走现有 PUT /api/okr/daily; 没有团队视图', () => {
    const c = src('components/okr/OkrTodaySummary.vue')
    assert.match(c, /fde\.okr\.daily\(date, 'me'\)/)
    assert.match(c, /fde\.okr\.saveDaily\(date, draft\.value\.trim\(\)\)/)
    assert.doesNotMatch(c, /scope.*team|dailyMissing/)
    assert.match(src('api/index.js'), /saveDaily: \(date, summaryMd\) => request\('\/api\/okr\/daily', \{ method: 'PUT'/)
  })
  test('我的今日: 卡片放在最上面(在四个区块之前), OKR 模块关了不出', () => {
    const w = src('views/admin/Workbench.vue')
    const card = w.indexOf('<OkrTodaySummary v-if="okrOn" />')
    assert.ok(card > 0)
    assert.ok(card > w.indexOf('</header>') && card < w.indexOf('<div class="grid">'))
  })
})

test('okr.slim 中英文 key 一致', () => {
  assert.deepEqual(Object.keys(zh.okr.slim).sort(), Object.keys(en.okr.slim).sort())
})

test('这轮动过的 SFC: <style> 都能编译(删样式时没留下半截块)', async () => {
  const { parse, compileStyle } = await import('@vue/compiler-sfc')
  for (const f of ['components/okr/OkrWeekPlanCard.vue', 'components/okr/OkrTodaySummary.vue', 'components/okr/OkrObjectiveCard.vue',
    'components/okr/OkrPlanEditor.vue', 'views/okr/TeamOkr.vue', 'views/okr/MyOkr.vue', 'views/admin/Workbench.vue', 'views/admin/AdminLayout.vue']) {
    const { descriptor } = parse(src(f), { filename: f })
    for (const st of descriptor.styles) {
      const r = compileStyle({ source: st.content, filename: f, id: 'data-v-test', scoped: !!st.scoped })
      assert.deepEqual(r.errors.map(e => e.message), [], f)
    }
  }
})
