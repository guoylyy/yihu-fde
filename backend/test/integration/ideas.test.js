// 集成测试 - /api/fde/ideas 创意中心 (v2.10.0 #1180)
// 覆盖: 话题 CRUD 与归档 / 发想法、列表、详情 / 点赞开关 / 评论与回复(两层)、@通知 /
//       权限(工程师不能改别人的、不能置顶、不能转里程碑) / 转里程碑(新建与重复转) / AI 草稿与总结(注入假模型)
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { login, api, uniqName } from './helpers.js'
import prisma from '../../src/lib/prisma.js'
import { summarizeIdea, draftMilestoneFromIdea } from '../../src/services/ideas.js'

describe('API: /api/fde/ideas 创意中心', () => {
  let a                         // admin
  let adminName
  let engUser, engApi           // FDE_ENGINEER: 能发能评, 不能转里程碑
  let customerId, projectId
  let topicId, emptyTopicId
  let ideaId, engIdeaId
  let commentId
  const createdUserIds = []

  before(async () => {
    a = api(await login())
    adminName = (await a.get('/api/auth/me')).data.name
    const username = uniqName('idea').toLowerCase().replace(/[^a-z0-9]/g, 'x')
    const u = await a.post('/api/fde/users', {
      username, name: uniqName('想法工程师').replace(/[^\w一-龥]/g, ''),
      password: 'Test123456', role: 'FDE_ENGINEER', email: `${username}@test.local`
    })
    assert.equal(u.code, 0, `建用户失败: ${u.message}`)
    engUser = u.data
    createdUserIds.push(u.data.id)
    engApi = api(await login(username, '123456'))

    const c = await a.post('/api/fde/customers', { name: uniqName('客户') })
    assert.equal(c.code, 0, `建客户失败: ${c.message}`)
    customerId = c.data.id
    const p = await a.post('/api/fde/projects', { name: uniqName('项目'), customerId, status: 'IN_PROGRESS' })
    assert.equal(p.code, 0, `建项目失败: ${p.message}`)
    projectId = p.data.id
  })

  after(async () => {
    try {
      const topicIds = [topicId, emptyTopicId].filter(Boolean).map(BigInt)
      const ideas = topicIds.length ? await prisma.idea.findMany({ where: { topicId: { in: topicIds } }, select: { id: true } }) : []
      const ideaIds = ideas.map(i => i.id)
      if (ideaIds.length) {
        await prisma.comment.deleteMany({ where: { entity: 'idea', entityId: { in: ideaIds } } }).catch(() => {})
        await prisma.ideaLike.deleteMany({ where: { ideaId: { in: ideaIds } } }).catch(() => {})
        await prisma.activity.deleteMany({ where: { entity: 'idea', entityId: { in: ideaIds } } }).catch(() => {})
        await prisma.idea.deleteMany({ where: { id: { in: ideaIds } } }).catch(() => {})
      }
      if (topicIds.length) await prisma.ideaTopic.deleteMany({ where: { id: { in: topicIds } } }).catch(() => {})
      if (projectId) {
        await prisma.milestone.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
        await prisma.projectMember.deleteMany({ where: { projectId: BigInt(projectId) } }).catch(() => {})
        await prisma.project.delete({ where: { id: BigInt(projectId) } }).catch(() => {})
      }
      if (customerId) {
        await prisma.contact.deleteMany({ where: { customerId: BigInt(customerId) } }).catch(() => {})
        await prisma.customer.delete({ where: { id: BigInt(customerId) } }).catch(() => {})
      }
      if (createdUserIds.length) {
        const ids = createdUserIds.map(BigInt)
        await prisma.engineer.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
        await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
        await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
      }
    } finally {
      await prisma.$disconnect().catch(() => {})
    }
  })

  describe('话题', () => {
    test('工程师也能开话题; 名称必填; 同名被拒', async () => {
      const bad = await engApi.post('/api/fde/ideas/topics', { name: '  ' })
      assert.equal(bad.status, 400)
      const name = uniqName('话题')
      const r = await engApi.post('/api/fde/ideas/topics', { name, description: '测试用', icon: '🧪' })
      assert.equal(r.code, 0, r.message)
      topicId = r.data.id
      assert.equal(r.data.ideaCount, 0)
      const dup = await a.post('/api/fde/ideas/topics', { name })
      assert.equal(dup.code, 9003)

      const e = await a.post('/api/fde/ideas/topics', { name: uniqName('空话题') })
      emptyTopicId = e.data.id
    })

    test('列表带想法数; 别人的话题工程师改不了, 管理员可以', async () => {
      const list = await a.get('/api/fde/ideas/topics')
      assert.equal(list.code, 0)
      assert.ok(list.data.list.some(t => String(t.id) === String(topicId)))
      const forbidden = await engApi.put(`/api/fde/ideas/topics/${emptyTopicId}`, { description: 'x' })
      assert.equal(forbidden.status, 403)
      const ok = await a.put(`/api/fde/ideas/topics/${topicId}`, { description: '管理员改的' })
      assert.equal(ok.code, 0)
      assert.equal(ok.data.description, '管理员改的')
    })
  })

  describe('想法', () => {
    test('话题/标题/内容必填', async () => {
      const r = await a.post('/api/fde/ideas', { topicId, title: '', content: 'x' })
      assert.equal(r.status, 400)
      assert.equal(r.code, 9002)
    })

    test('发想法; 列表返回摘要不返回全文; 详情带讨论与操作权限', async () => {
      const r = await a.post('/api/fde/ideas', {
        topicId, title: uniqName('想法'), content: '# 背景\n' + '很长的正文'.repeat(120),
        attachments: [{ filename: 'a.png', fileUrl: 'https://example.com/a.png', fileSize: 10 }, { filename: '没有地址' }]
      })
      assert.equal(r.code, 0, r.message)
      ideaId = r.data.id
      assert.equal(r.data.status, 'OPEN')
      assert.equal(r.data.attachments.length, 1, '没有 fileUrl 的附件被丢掉')

      const mine = await engApi.post('/api/fde/ideas', { topicId, title: uniqName('工程师的想法'), content: '工程师发的' })
      assert.equal(mine.code, 0, mine.message)
      engIdeaId = mine.data.id

      const list = await a.get(`/api/fde/ideas?topicId=${topicId}`)
      assert.equal(list.code, 0)
      assert.equal(list.data.total, 2)
      const row = list.data.list.find(i => String(i.id) === String(ideaId))
      assert.equal(row.content, undefined)
      assert.ok(row.excerpt.length <= 401)
      assert.equal(row.author.name, adminName)

      const onlyMine = await engApi.get(`/api/fde/ideas?topicId=${topicId}&mine=true`)
      assert.equal(onlyMine.data.total, 1)

      const detail = await engApi.get(`/api/fde/ideas/${ideaId}`)
      assert.equal(detail.code, 0)
      assert.ok(detail.data.content.startsWith('# 背景'))
      assert.deepEqual(detail.data.can, { edit: false, manage: false, convert: false })
      assert.deepEqual(detail.data.comments, [])
    })

    test('工程师改不了别人的想法、不能置顶; 自己的可以改', async () => {
      const forbidden = await engApi.put(`/api/fde/ideas/${ideaId}`, { title: '改别人的' })
      assert.equal(forbidden.status, 403)
      const pin = await engApi.put(`/api/fde/ideas/${engIdeaId}`, { pinned: true })
      assert.equal(pin.status, 403)
      const ok = await engApi.put(`/api/fde/ideas/${engIdeaId}`, { content: '改过的内容' })
      assert.equal(ok.code, 0)
      assert.equal(ok.data.content, '改过的内容')
    })

    test('管理员可置顶与搁置; 置顶的排在最前', async () => {
      const r = await a.put(`/api/fde/ideas/${engIdeaId}`, { pinned: true, status: 'PARKED' })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.pinned, 1)
      const list = await a.get(`/api/fde/ideas?topicId=${topicId}&sort=new`)
      assert.equal(String(list.data.list[0].id), String(engIdeaId))
      const parked = await a.get(`/api/fde/ideas?topicId=${topicId}&status=PARKED`)
      assert.equal(parked.data.total, 1)
      const bad = await a.put(`/api/fde/ideas/${engIdeaId}`, { status: 'ADOPTED' })
      assert.equal(bad.status, 400, '已采纳只能通过转里程碑得到')
    })

    test('点赞是开关: 点一次加一, 再点一次取消', async () => {
      const on = await engApi.post(`/api/fde/ideas/${ideaId}/like`)
      assert.deepEqual(on.data, { liked: true, likeCount: 1 })
      const detail = await engApi.get(`/api/fde/ideas/${ideaId}`)
      assert.equal(detail.data.liked, true)
      const off = await engApi.post(`/api/fde/ideas/${ideaId}/like`)
      assert.deepEqual(off.data, { liked: false, likeCount: 0 })
    })

    test('不存在或非数字 id 返回 404', async () => {
      assert.equal((await a.get('/api/fde/ideas/999999999')).status, 404)
      assert.equal((await a.get('/api/fde/ideas/abc')).status, 404)
    })
  })

  describe('讨论', () => {
    test('评论后想法计数加一; @ 到的人收到必看通知', async () => {
      const r = await a.post(`/api/fde/ideas/${ideaId}/comments`, { content: `这个可以做 @${engUser.name}` })
      assert.equal(r.code, 0, r.message)
      commentId = r.data.id
      const detail = await a.get(`/api/fde/ideas/${ideaId}`)
      assert.equal(detail.data.commentCount, 1)
      assert.equal(detail.data.comments[0].author.name, adminName)
      const n = await prisma.notification.findFirst({ where: { userId: BigInt(engUser.id), type: 'MENTIONED' }, orderBy: { id: 'desc' } })
      assert.ok(n, '被 @ 的人应收到通知')
      assert.equal(n.link, `/admin/ideas?idea=${ideaId}`)
    })

    test('回复只做两层: 回复的回复也挂到楼主那条下面', async () => {
      const reply = await engApi.post(`/api/fde/ideas/${ideaId}/comments`, { content: '同意', parentId: commentId })
      assert.equal(String(reply.data.parentId), String(commentId))
      const nested = await a.post(`/api/fde/ideas/${ideaId}/comments`, { content: '那就排期', parentId: reply.data.id })
      assert.equal(String(nested.data.parentId), String(commentId))
      const missing = await a.post(`/api/fde/ideas/${ideaId}/comments`, { content: 'x', parentId: '999999999' })
      assert.equal(missing.status, 404)
    })

    test('别人的评论工程师删不了; 自己的可以, 删后计数减一', async () => {
      const forbidden = await engApi.del(`/api/fde/ideas/${ideaId}/comments/${commentId}`)
      assert.equal(forbidden.status, 403)
      const own = await engApi.post(`/api/fde/ideas/${ideaId}/comments`, { content: '发错了' })
      const before = (await a.get(`/api/fde/ideas/${ideaId}`)).data.commentCount
      const del = await engApi.del(`/api/fde/ideas/${ideaId}/comments/${own.data.id}`)
      assert.equal(del.code, 0)
      const detail = await a.get(`/api/fde/ideas/${ideaId}`)
      assert.equal(detail.data.commentCount, before - 1)
      assert.ok(!detail.data.comments.some(c => String(c.id) === String(own.data.id)))
    })
  })

  describe('AI 辅助(注入假模型, 不真调大模型)', () => {
    test('总结讨论: 把想法和评论喂给模型, 结果存在想法上', async () => {
      let call
      const r = await summarizeIdea(ideaId, {
        llm: async opts => { call = opts; return { summary: '大家同意做', consensus: ['先排期'], disagreements: [], openQuestions: [], nextStep: '立项' } }
      })
      assert.match(call.user, /这个可以做/)
      assert.match(r.aiSummary, /大家同意做/)
      const detail = await a.get(`/api/fde/ideas/${ideaId}`)
      assert.match(detail.data.aiSummary, /\*\*建议下一步\*\*：立项/)
    })

    test('起草里程碑: 带上项目上下文, 只返回草稿不落库', async () => {
      let call
      const draft = await draftMilestoneFromIdea(ideaId, {
        projectContext: '项目：测试项目',
        llm: async opts => { call = opts; return { name: '  进度看板一期 ', goal: '客户能自己看进度', description: '## 范围\n只读', openQuestions: ['数据源'] } }
      })
      assert.match(call.user, /## 项目上下文\n项目：测试项目/)
      assert.deepEqual(draft, { name: '进度看板一期', goal: '客户能自己看进度', description: '## 范围\n只读', openQuestions: ['数据源'] })
      const count = await prisma.milestone.count({ where: { projectId: BigInt(projectId) } })
      assert.equal(count, 0)
    })

    test('模型没给名称时报错, 不返回空草稿', async () => {
      await assert.rejects(() => draftMilestoneFromIdea(ideaId, { llm: async () => ({}) }), /有效的里程碑草稿/)
    })
  })

  describe('转里程碑', () => {
    test('工程师没有转化权限', async () => {
      const r = await engApi.post(`/api/fde/ideas/${ideaId}/convert`, { projectId })
      assert.equal(r.status, 403)
    })

    test('必须选项目; 项目不存在返回 404', async () => {
      assert.equal((await a.post(`/api/fde/ideas/${ideaId}/convert`, {})).status, 400)
      assert.equal((await a.post(`/api/fde/ideas/${ideaId}/convert`, { projectId: '999999999' })).status, 404)
    })

    test('新建里程碑: 想法置已采纳并记下去向, 里程碑描述带出处, 讨论区留痕, 作者收到通知', async () => {
      // 用工程师发的那条: 作者≠操作人, 才会发采纳通知
      await a.put(`/api/fde/ideas/${engIdeaId}`, { status: 'OPEN' })
      const r = await a.post(`/api/fde/ideas/${engIdeaId}/convert`, {
        projectId, name: '进度看板一期', goal: '客户能自己看进度', plannedDate: '2026-12-31'
      })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.created, true)
      assert.equal(r.data.milestone.name, '进度看板一期')
      assert.match(r.data.milestone.description, /改过的内容[\s\S]*—— 来源: 创意中心想法 #\d+/)
      assert.equal(String(r.data.milestone.projectId), String(projectId))

      const detail = await engApi.get(`/api/fde/ideas/${engIdeaId}`)
      assert.equal(detail.data.status, 'ADOPTED')
      assert.equal(detail.data.comments.at(-1).content, '✅ 已转为里程碑「进度看板一期」')
      // 作者不在这个项目里: 知道想法被采纳了, 但看不到项目与里程碑
      assert.equal(detail.data.project, null)
      assert.equal(detail.data.milestone, null)
      const asAdmin = await a.get(`/api/fde/ideas/${engIdeaId}`)
      assert.equal(String(asAdmin.data.project.id), String(projectId))
      assert.equal(asAdmin.data.milestone.name, '进度看板一期')

      const n = await prisma.notification.findFirst({ where: { userId: BigInt(engUser.id), type: 'IDEA_ADOPTED' } })
      assert.ok(n, '作者应收到采纳通知')
    })

    test('同一条想法不能转两次; 已采纳后不能再改状态', async () => {
      const again = await a.post(`/api/fde/ideas/${engIdeaId}/convert`, { projectId })
      assert.equal(again.code, 9003)
      const park = await a.put(`/api/fde/ideas/${engIdeaId}`, { status: 'PARKED' })
      assert.equal(park.code, 9003)
    })

    test('并入已有里程碑: 不新建, 想法指向那个里程碑', async () => {
      const ms = await prisma.milestone.findFirst({ where: { projectId: BigInt(projectId) } })
      const r = await a.post(`/api/fde/ideas/${ideaId}/convert`, { projectId, milestoneId: String(ms.id) })
      assert.equal(r.code, 0, r.message)
      assert.equal(r.data.created, false)
      assert.equal(await prisma.milestone.count({ where: { projectId: BigInt(projectId) } }), 1)
      const list = await a.get(`/api/fde/ideas?topicId=${topicId}&status=ADOPTED`)
      assert.equal(list.data.total, 2)
    })
  })

  describe('话题收尾', () => {
    test('有想法的话题不能删, 可以归档; 归档后不能再发新想法', async () => {
      const del = await a.del(`/api/fde/ideas/topics/${topicId}`)
      assert.equal(del.code, 9003)
      const arch = await a.put(`/api/fde/ideas/topics/${topicId}`, { archived: true })
      assert.equal(arch.data.archived, true)
      const post = await a.post('/api/fde/ideas', { topicId, title: 'x', content: 'y' })
      assert.equal(post.code, 9003)
    })

    test('空话题可以删', async () => {
      const del = await a.del(`/api/fde/ideas/topics/${emptyTopicId}`)
      assert.equal(del.code, 0)
      const list = await a.get('/api/fde/ideas/topics')
      assert.ok(!list.data.list.some(t => String(t.id) === String(emptyTopicId)))
    })

    test('作者可以删自己的想法, 删后列表里没有', async () => {
      const tmp = await prisma.ideaTopic.update({ where: { id: BigInt(topicId) }, data: { archivedAt: null } })
      const mine = await engApi.post('/api/fde/ideas', { topicId: String(tmp.id), title: uniqName('要删的'), content: 'x' })
      const del = await engApi.del(`/api/fde/ideas/${mine.data.id}`)
      assert.equal(del.code, 0)
      assert.equal((await a.get(`/api/fde/ideas/${mine.data.id}`)).status, 404)
    })
  })
})
