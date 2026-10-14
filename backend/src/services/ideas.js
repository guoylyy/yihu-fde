// v2.10.0(#1180) 创意中心 —— 想法的 AI 辅助与「转里程碑」
//
// 生产流程最前端: idea → 立项/里程碑 → 任务 → 分配到人或机器。
// 这里只管两件事: ① 让 AI 把一串讨论收拢成结论、起草里程碑; ② 把想法落成某个项目的里程碑。
// 里程碑建好之后的任务拆解沿用路径图那一套(services/decompositionDraft.js), 不在这里重复。
import prisma from '../lib/prisma.js'
import { chatJSON } from '../lib/llm.js'
import { recordActivity } from '../lib/activity.js'
import { pushNotification } from '../lib/notify.js'

export const IDEA_STATUSES = ['OPEN', 'ADOPTED', 'PARKED', 'ARCHIVED']
export const IDEA_STATUS_LABEL = { OPEN: '讨论中', ADOPTED: '已转里程碑', PARKED: '搁置' }

const MAX_DISCUSSION_CHARS = 12000

function err(message, code) {
  const e = new Error(message)
  e.code = code
  return e
}

/** 解析评论里的 @姓名 / @username, 返回命中的用户(口径同 routes/fde/comments.js) */
export { resolveMentions } from '../lib/mentions.js'

/** 想法 + 讨论拼成给大模型看的文本; 讨论太长只留最近的 */
export function renderIdeaForLlm(idea, comments = [], authorNames = new Map()) {
  const lines = [`# 想法：${idea.title}`, '', idea.content.trim()]
  if (comments.length) {
    lines.push('', '## 讨论')
    const rows = comments.map(c => `- ${authorNames.get(String(c.authorId)) || '同事'}：${c.content.trim().replace(/\n+/g, ' ')}`)
    let text = rows.join('\n')
    if (text.length > MAX_DISCUSSION_CHARS) text = '（更早的讨论已省略）\n' + text.slice(-MAX_DISCUSSION_CHARS)
    lines.push(text)
  }
  return lines.join('\n')
}

async function loadIdeaWithDiscussion(ideaId) {
  const idea = await prisma.idea.findFirst({ where: { id: BigInt(ideaId), deletedAt: null } })
  if (!idea) throw err('想法不存在', 2004)
  const comments = await prisma.comment.findMany({
    where: { entity: 'idea', entityId: idea.id, deletedAt: null },
    orderBy: { createdAt: 'asc' }
  })
  const userIds = [...new Set([idea.authorId, ...comments.map(c => c.authorId)])]
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
  return { idea, comments, authorNames: new Map(users.map(u => [String(u.id), u.name])) }
}

export const IDEA_SUMMARY_SYSTEM_PROMPT = `你是团队讨论的记录员。读一条想法和它下面的讨论，收拢成结论。只输出 JSON，不要 Markdown 或解释文字。
只根据给到的内容写，不要补充讨论里没有的观点，不要臆造负责人、工期或金额。没有内容的数组给空数组。
输出结构：{"summary":"两三句话说清这个想法是什么、讨论到了哪一步","consensus":["大家已经达成一致的点"],"disagreements":["还有分歧的点"],"openQuestions":["还没人回答的问题"],"nextStep":"建议的下一步(一句话)"}`

/** AI 输出 → 存库展示用的 Markdown */
export function renderSummaryMarkdown(s) {
  const out = [String(s.summary || '').trim()]
  const section = (title, items) => {
    const list = (Array.isArray(items) ? items : []).map(x => String(x).trim()).filter(Boolean)
    if (list.length) out.push('', `**${title}**`, ...list.map(x => `- ${x}`))
  }
  section('已有共识', s.consensus)
  section('仍有分歧', s.disagreements)
  section('待回答', s.openQuestions)
  if (s.nextStep) out.push('', `**建议下一步**：${String(s.nextStep).trim()}`)
  return out.join('\n').trim()
}

/** AI 总结讨论, 结果落在想法上(后来的人不用爬楼) */
export async function summarizeIdea(ideaId, { llm = chatJSON } = {}) {
  const { idea, comments, authorNames } = await loadIdeaWithDiscussion(ideaId)
  const result = await llm({
    system: IDEA_SUMMARY_SYSTEM_PROMPT,
    user: renderIdeaForLlm(idea, comments, authorNames),
    maxTokens: 2000
  })
  const markdown = renderSummaryMarkdown(result || {})
  if (!markdown) throw err('AI 没有给出有效的总结，请重试', 9001)
  const now = new Date()
  await prisma.idea.update({ where: { id: idea.id }, data: { aiSummary: markdown, aiSummaryAt: now } })
  return { aiSummary: markdown, aiSummaryAt: now, commentCount: comments.length }
}

export const IDEA_MILESTONE_SYSTEM_PROMPT = `你是 FDE 项目经理的助手。把一条想法和它的讨论，起草成项目里的一个里程碑。只输出 JSON，不要 Markdown 或解释文字。
里程碑要能验收：goal 是一句话的完成定义(做到什么算完)，description 用 Markdown 写清背景、范围、不做什么。
只根据给到的内容写，不要臆造客户承诺、金额、工期或负责人；拿不准的放进 openQuestions。
如果给了项目上下文，名称与范围要和已有里程碑区分开，不要重复已有的工作。
输出结构：{"name":"里程碑名称(30字内)","goal":"一句话完成定义","description":"Markdown：背景/范围/不做什么","openQuestions":["动工前要先问清的事"]}`

/** AI 起草里程碑: 只返回草稿不落库, 人看过改过再转 */
export async function draftMilestoneFromIdea(ideaId, { projectContext = '', llm = chatJSON } = {}) {
  const { idea, comments, authorNames } = await loadIdeaWithDiscussion(ideaId)
  const user = [projectContext && `## 项目上下文\n${projectContext}`, renderIdeaForLlm(idea, comments, authorNames)]
    .filter(Boolean).join('\n\n')
  const r = await llm({ system: IDEA_MILESTONE_SYSTEM_PROMPT, user, maxTokens: 3000 }) || {}
  const name = String(r.name || '').trim().slice(0, 200)
  if (!name) throw err('AI 没有给出有效的里程碑草稿，请重试', 9001)
  return {
    name,
    goal: String(r.goal || '').trim().slice(0, 2000),
    description: String(r.description || '').trim(),
    openQuestions: (Array.isArray(r.openQuestions) ? r.openQuestions : []).map(x => String(x).trim()).filter(Boolean).slice(0, 20)
  }
}

/** 里程碑描述末尾的出处标记(口径同会议纪要转需求的「—— 来源: …」) */
export function ideaSourceLine(idea) {
  return `—— 来源: 创意中心想法 #${idea.id}「${idea.title}」`
}

/**
 * 想法 → 项目里程碑
 * 两种去向: 新建里程碑(给 name), 或并入已有里程碑(给 milestoneId)。
 * 想法置 ADOPTED 并记下去向, 讨论区留一条系统说明, 通知作者。
 * @returns {{ idea, milestone, project, created: boolean }}
 */
export async function convertIdeaToMilestone({ ideaId, projectId, milestoneId, name, goal, description, plannedDate, ownerId, userId }) {
  const idea = await prisma.idea.findFirst({ where: { id: BigInt(ideaId), deletedAt: null } })
  if (!idea) throw err('想法不存在', 2004)
  if (idea.status === 'ADOPTED') throw err('这条想法已经转过里程碑了', 9003)
  const project = await prisma.project.findFirst({
    where: { id: BigInt(projectId), deletedAt: null },
    select: { id: true, code: true, name: true }
  })
  if (!project) throw err('项目不存在', 2004)

  const result = await prisma.$transaction(async tx => {
    let milestone
    let created = false
    if (milestoneId) {
      milestone = await tx.milestone.findFirst({ where: { id: BigInt(milestoneId), projectId: project.id, deletedAt: null } })
      if (!milestone) throw err('里程碑不存在或不属于该项目', 2004)
    } else {
      const finalName = String(name || idea.title).trim().slice(0, 200)
      const maxOrder = await tx.milestone.aggregate({ where: { projectId: project.id, deletedAt: null }, _max: { sortOrder: true } })
      milestone = await tx.milestone.create({
        data: {
          projectId: project.id,
          name: finalName,
          description: [String(description || idea.content).trim(), ideaSourceLine(idea)].join('\n\n'),
          goal: goal ? String(goal).slice(0, 2000) : null,
          plannedDate: plannedDate ? new Date(plannedDate) : null,
          ownerId: ownerId ? BigInt(ownerId) : null,
          status: 'PENDING',
          sortOrder: (maxOrder._max.sortOrder || 0) + 1
        }
      })
      created = true
    }
    const now = new Date()
    const updated = await tx.idea.update({
      where: { id: idea.id },
      data: {
        status: 'ADOPTED', projectId: project.id, milestoneId: milestone.id,
        adoptedBy: BigInt(userId), adoptedAt: now, lastActivityAt: now,
        commentCount: { increment: 1 }
      }
    })
    await tx.comment.create({
      data: {
        entity: 'idea', entityId: idea.id, authorId: BigInt(userId),
        // 讨论区全员可见, 这里不带项目名(项目只对范围内的人可见); 去向详情由接口按权限展开
        content: `✅ 已${created ? '转为' : '并入'}里程碑「${milestone.name}」`
      }
    })
    return { idea: updated, milestone, created }
  })

  recordActivity({
    actorId: BigInt(userId), entity: 'milestone', entityId: result.milestone.id,
    action: result.created ? 'created' : 'idea_merged',
    summary: `想法「${idea.title}」${result.created ? '转为' : '并入'}里程碑 "${result.milestone.name}"`,
    data: { ideaId: String(idea.id), projectId: String(project.id) }
  })
  pushNotification({
    userId: idea.authorId, actorId: userId, type: 'IDEA_ADOPTED',
    title: '💡 你的想法被采纳了',
    body: `「${idea.title}」已${result.created ? '转为' : '并入'}项目「${project.name}」的里程碑「${result.milestone.name}」`,
    link: `/admin/ideas?idea=${idea.id}`,
    data: { ideaId: String(idea.id), projectId: String(project.id), milestoneId: String(result.milestone.id) }
  }).catch(() => {})

  return { ...result, project }
}
