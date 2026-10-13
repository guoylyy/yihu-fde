// 集成测试 - v2.7 项目资产库 (#1140)
// 覆盖: 登记(工程师进草稿) / 可见性 / 口径约束(RESTRICTED 不能 L2) / 发布扫描(密钥必拦、客户名需确认) /
//       复用登记(数据范围) / 关联 / 版本 / 匹配推荐 + 任务详情内联 / 项目收尾起草 / 权限
// 数据带 unit-test- 前缀, 自建专属客户与项目, after 钩子清理
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, request, uniqName } from './helpers.js'

describe('v2.7 项目资产库', () => {
  let admin, fde, fde2
  let customerId, customerName, projectId, taskId
  const slug = `unit-test-asset-${Date.now()}`
  let assetId, draftId
  const created = []

  before(async () => {
    admin = api(await login('admin'))
    fde = api(await login('fde001'))
    fde2 = api(await login('fde002'))
    customerName = uniqName('资产测试客户')
    const c = await admin.post('/api/fde/customers', { name: customerName, shortName: customerName.slice(-8) })
    assert.equal(c.code, 0, c.message)
    customerId = String(c.data.id)
    const p = await admin.post('/api/fde/projects', { name: uniqName('资产测试项目'), customerId })
    assert.equal(p.code, 0)
    projectId = String(p.data.id)
    const t = await admin.post('/api/fde/tasks', { projectId, title: uniqName('接入快递比价给仓库发货用'), description: '需要按运费比价，寄件前查哪家快递便宜' })
    assert.equal(t.code, 0, t.message)
    taskId = String(t.data.id)
  })

  after(async () => {
    for (const id of created) await admin.del(`/api/fde/assets/${id}`).catch(() => {})
    if (taskId) await admin.del(`/api/fde/tasks/${taskId}`).catch(() => {})
    if (projectId) await admin.del(`/api/fde/projects/${projectId}`).catch(() => {})
    if (customerId) await admin.del(`/api/fde/customers/${customerId}`).catch(() => {})
  })

  test('未登录 401', async () => {
    assert.equal((await request('GET', '/api/fde/assets', null, null)).status, 401)
  })

  test('参数校验: slug 格式 / layer / RESTRICTED 不能标 L2', async () => {
    assert.equal((await admin.post('/api/fde/assets', { slug: 'Bad Slug', name: 'x', summary: 'x', layer: 'BIZ' })).status, 400)
    assert.equal((await admin.post('/api/fde/assets', { slug, name: 'x', summary: 'x', layer: 'NOPE' })).status, 400)
    const r = await admin.post('/api/fde/assets', { slug, name: 'x', summary: 'x', layer: 'BIZ', maturity: 'L2', authorization: 'RESTRICTED' })
    assert.equal(r.status, 400)
    assert.match(r.message, /L2\/L3/)
  })

  test('经理登记 → 草稿; slug 重复 400', async () => {
    const r = await admin.post('/api/fde/assets', {
      slug, name: uniqName('测试资产'), summary: '一句话说明', layer: 'BIZ', maturity: 'L1', authorization: 'INTERNAL',
      keywords: '单测资产词甲, 单测资产词乙', industries: ['测试行业'], techStack: ['node'],
      readme: '## 解决什么问题\n测试', ontology: '{"objects":[{"name":"X","properties":{}}]}', estSavedDays: 2.5
    })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.status, 'DRAFT')
    assert.deepEqual(r.data.keywords, ['单测资产词甲', '单测资产词乙'])
    assert.equal(r.data.ontology.objects[0].name, 'X')
    assetId = String(r.data.id); created.push(assetId)
    assert.equal((await admin.post('/api/fde/assets', { slug, name: 'y', summary: 'y', layer: 'BIZ' })).status, 400)
  })

  test('工程师登记一律草稿, 且不能设状态; 能改自己的草稿; 别人看不到', async () => {
    const r = await fde.post('/api/fde/assets', { slug: `${slug}-fde`, name: uniqName('工程师登记'), summary: '工程师提的', layer: 'ARCH', status: 'DEPRECATED' })
    assert.equal(r.code, 0, r.message)
    assert.equal(r.data.status, 'DRAFT')
    draftId = String(r.data.id); created.push(draftId)
    assert.equal((await fde.put(`/api/fde/assets/${draftId}`, { summary: '改过了' })).code, 0)
    // 别的工程师看不到他人的草稿
    assert.equal((await fde2.get(`/api/fde/assets/${draftId}`)).status, 404)
    const list = await fde2.get('/api/fde/assets?page_size=100')
    assert.ok(!list.data.list.some(a => String(a.id) === draftId))
    // 经理的草稿对工程师不可见(404), 发布后可见但不可改(403, 见发布用例)
    assert.equal((await fde.put(`/api/fde/assets/${assetId}`, { summary: 'x' })).status, 404)
    // 工程师不能发布
    assert.equal((await fde.post(`/api/fde/assets/${draftId}/publish`, {})).status, 403)
  })

  test('发布扫描: 含密钥一律拦; 含客户名需 force; 发布后全员可见', async () => {
    await admin.put(`/api/fde/assets/${assetId}`, { readme: '配置示例 api_key: "abcdefghijklmnop1234567890"' })
    const s1 = await admin.post(`/api/fde/assets/${assetId}/publish`, {})
    assert.equal(s1.status, 400)
    assert.match(s1.message, /密钥/)
    const s1f = await admin.post(`/api/fde/assets/${assetId}/publish`, { force: true })
    assert.equal(s1f.status, 400, '密钥不给强制通过')

    await admin.put(`/api/fde/assets/${assetId}`, { readme: `这是给「${customerName}」做的` })
    const s2 = await admin.post(`/api/fde/assets/${assetId}/publish`, {})
    assert.equal(s2.status, 400)
    assert.ok(s2.data.customers.includes(customerName))

    await admin.put(`/api/fde/assets/${assetId}`, { readme: '## 解决什么问题\n已脱敏的方案' })
    const ok = await admin.post(`/api/fde/assets/${assetId}/publish`, {})
    assert.equal(ok.code, 0, ok.message)
    const seen = await fde2.get(`/api/fde/assets/${assetId}`)
    assert.equal(seen.code, 0)
    assert.equal(seen.data.canEdit, false)
    const bySlug = await fde.get(`/api/fde/assets/${slug}`)
    assert.equal(String(bySlug.data.id), assetId)
    assert.equal((await fde.put(`/api/fde/assets/${assetId}`, { summary: 'x' })).status, 403, '已发布资产只有经理能改')
  })

  test('列表筛选: 层/成熟度/行业/关键词; meta 带筛选项与统计', async () => {
    const byIndustry = await admin.get('/api/fde/assets?industry=测试行业')
    assert.ok(byIndustry.data.list.some(a => String(a.id) === assetId))
    const byLayer = await admin.get('/api/fde/assets?layer=FRAMEWORK&page_size=100')
    assert.ok(!byLayer.data.list.some(a => String(a.id) === assetId))
    const byKw = await admin.get(`/api/fde/assets?keyword=${encodeURIComponent('已脱敏的方案')}`)
    assert.ok(byKw.data.list.some(a => String(a.id) === assetId), '关键词能搜方案全文')
    const meta = await admin.get('/api/fde/assets/meta')
    assert.ok(meta.data.industries.includes('测试行业'))
    assert.ok(meta.data.stats.total >= 1)
  })

  test('复用登记: 数据范围外项目 404; 登记后计数与节省人天; 撤销', async () => {
    assert.equal((await fde.post(`/api/fde/assets/${assetId}/usages`, { projectId })).status, 404, '工程师不在该项目')
    assert.equal((await admin.post(`/api/fde/assets/${draftId}/usages`, { projectId })).status, 400, '草稿不能登记复用')
    assert.equal((await admin.post(`/api/fde/assets/${assetId}/usages`, { projectId, taskId: '999999999' })).status, 400)
    const r = await admin.post(`/api/fde/assets/${assetId}/usages`, { projectId, taskId, mode: 'COPY', savedDays: 1.5, feedback: '好用' })
    assert.equal(r.code, 0, r.message)
    const d = await admin.get(`/api/fde/assets/${assetId}`)
    assert.equal(d.data.usageCount, 1)
    assert.equal(d.data.savedDaysTotal, 1.5)
    assert.equal(String(d.data.usages[0].project.id), projectId)
    const byProject = await admin.get(`/api/fde/assets/by-project/${projectId}`)
    assert.ok(byProject.data.usages.some(u => String(u.asset.id) === assetId))
    const del = await admin.del(`/api/fde/assets/${assetId}/usages/${r.data.id}`)
    assert.equal(del.code, 0)
    assert.equal((await admin.get(`/api/fde/assets/${assetId}`)).data.usageCount, 0)
  })

  test('关联: 资产↔资产 / 不能关联自己 / 不存在的对象 400; 版本号唯一', async () => {
    assert.equal((await admin.post(`/api/fde/assets/${assetId}/links`, { targetType: 'ASSET', targetId: assetId })).status, 400)
    assert.equal((await admin.post(`/api/fde/assets/${assetId}/links`, { targetType: 'KNOWLEDGE', targetId: '999999999' })).status, 400)
    const l = await admin.post(`/api/fde/assets/${assetId}/links`, { targetType: 'ASSET', targetId: draftId, note: '依赖' })
    assert.equal(l.code, 0)
    const d = await admin.get(`/api/fde/assets/${assetId}`)
    assert.equal(d.data.links.length, 1)
    assert.match(d.data.links[0].label, /工程师登记/)
    assert.equal((await admin.del(`/api/fde/assets/${assetId}/links/${l.data.id}`)).code, 0)
    const targets = await admin.get('/api/fde/assets/link-targets?type=ASSET&keyword=unit-test-asset')
    assert.ok(targets.data.list.length >= 1)
    assert.equal((await admin.post(`/api/fde/assets/${assetId}/versions`, { version: '0.1.0', changelog: '首版' })).code, 0)
    assert.equal((await admin.post(`/api/fde/assets/${assetId}/versions`, { version: '0.1.0' })).status, 400)
    assert.equal((await admin.get(`/api/fde/assets/${assetId}`)).data.currentVersion, '0.1.0')
  })

  test('匹配推荐: 命中关键词才推, 任务详情内联 suggestedAssets, 无关文本返空', async () => {
    const hit = await admin.get(`/api/fde/assets/suggest?text=${encodeURIComponent('这个需求涉及单测资产词甲和单测资产词乙')}`)
    const mine = hit.data.list.find(a => String(a.id) === assetId)
    assert.ok(mine, '命中两个触发词应推荐')
    assert.deepEqual(mine.matchedOn.sort(), ['单测资产词乙', '单测资产词甲'].sort())
    assert.match(mine.loadHint, /get_asset/)
    const none = await admin.get(`/api/fde/assets/suggest?text=${encodeURIComponent('完全无关的一句话 zzqqxx')}`)
    assert.ok(!none.data.list.some(a => String(a.id) === assetId))
    const task = await admin.get(`/api/fde/tasks/${taskId}`)
    assert.ok(Array.isArray(task.data.suggestedAssets), '任务详情带 suggestedAssets')
    assert.ok(task.data.suggestedAssets.length <= 3)
  })

  test('项目收尾起草: 生成草稿(AI 或骨架), 一律 DRAFT + RESTRICTED', async () => {
    const r = await admin.post(`/api/fde/assets/draft-from-project/${projectId}`, {})
    assert.equal(r.code, 0, r.message)
    assert.ok(['AI', 'SKELETON'].includes(r.data.mode))
    for (const a of r.data.created) {
      created.push(String(a.id))
      assert.equal(a.status, 'DRAFT')
      assert.equal(a.authorization, 'RESTRICTED')
      assert.equal(a.aiGenerated, true)
    }
    assert.equal((await admin.post('/api/fde/assets/draft-from-project/999999999', {})).status, 404)
  })

  test('软删释放 slug', async () => {
    const tmp = await admin.post('/api/fde/assets', { slug: `${slug}-tmp`, name: 'tmp', summary: 'tmp', layer: 'ARCH' })
    assert.equal((await admin.del(`/api/fde/assets/${tmp.data.id}`)).code, 0)
    const again = await admin.post('/api/fde/assets', { slug: `${slug}-tmp`, name: 'tmp2', summary: 'tmp', layer: 'ARCH' })
    assert.equal(again.code, 0, '同名 slug 可以重建')
    created.push(String(again.data.id))
  })
})
