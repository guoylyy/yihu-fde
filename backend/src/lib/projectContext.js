// 项目上下文组装器 (v2.0.1 #371) —— 专家开会模式的地基
// 把项目的关键事实组装成一份结构化 Markdown, 注入专家 Agent 的 system prompt。
// 权限约定: 本模块不做权限判断, 调用方必须先用 findScopedProject 等手段确认
// 当前用户对该项目可见 —— 专家看到的 = 会议发起人能看到的。
import prisma from './prisma.js'

const STATUS_CN = { TODO: '收件箱', QUEUED: '等候生产', IN_PROGRESS: '生产中', DONE: '生产完成', VERIFIED: '已验收' }
const MS_STATUS_CN = { PENDING: '未开始', IN_PROGRESS: '进行中', COMPLETED: '已完成', DELAYED: '已延期' }

/** 单板块裁剪: 超出配额的行丢弃并标注省略条数 */
function clipLines(lines, quota) {
  const out = []
  let used = 0
  for (const [i, line] of lines.entries()) {
    if (used + line.length > quota) {
      out.push(`- …(另有 ${lines.length - i} 条省略)`)
      break
    }
    out.push(line)
    used += line.length
  }
  return out
}

/**
 * 组装项目上下文 Markdown。
 * @param {bigint|string|number} projectId
 * @param {{ maxChars?: number }} opts 总量上限(默认 8000 字符), 按板块配额分配
 */
export async function buildProjectContext(projectId, { maxChars = 8000 } = {}) {
  const pid = BigInt(projectId)
  const [project, milestones, tasks, requirements, records, activities] = await Promise.all([
    prisma.project.findUnique({
      where: { id: pid },
      select: { name: true, code: true, description: true, status: true, health: true, progress: true, startDate: true, endDate: true }
    }),
    prisma.milestone.findMany({
      where: { projectId: pid, deletedAt: null },
      orderBy: [{ status: 'asc' }, { plannedDate: 'desc' }],
      select: { name: true, status: true, plannedDate: true, description: true }
    }),
    prisma.task.findMany({
      where: { projectId: pid, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { title: true, status: true, priority: true, assigneeId: true, dueDate: true }
    }),
    prisma.projectRequirement.findMany({
      where: { projectId: pid, deletedAt: null, status: 'CONFIRMED' },
      orderBy: { id: 'desc' }, take: 30,
      select: { title: true, priority: true, taskId: true }
    }),
    prisma.projectRecord.findMany({
      where: { projectId: pid, deletedAt: null, type: { in: ['MEETING', 'COMM'] } },
      orderBy: { occurredAt: 'desc' }, take: 3,
      select: { type: true, title: true, occurredAt: true, content: true }
    }),
    prisma.repoActivity.findMany({
      where: { projectId: pid, type: 'COMMIT' },
      orderBy: { happenedAt: 'desc' }, take: 8,
      select: { title: true, author: true, happenedAt: true }
    })
  ])
  if (!project) throw new Error(`项目 ${projectId} 不存在`)

  // 负责人名字: engineerId -> user.name (一次批量查)
  const engineerIds = [...new Set(tasks.map(t => t.assigneeId).filter(Boolean).map(String))]
  const engineers = engineerIds.length ? await prisma.engineer.findMany({
    where: { id: { in: engineerIds.map(BigInt) } },
    select: { id: true, user: { select: { name: true } } }
  }) : []
  const nameOf = new Map(engineers.map(e => [String(e.id), e.user?.name || '?']))

  const d = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '')
  const statCount = {}
  for (const t of tasks) statCount[t.status] = (statCount[t.status] || 0) + 1

  // 板块配额(占 maxChars 的比例): 概况10% 里程碑15% 任务25% 需求20% 纪要25% 提交5%
  const q = (r) => Math.floor(maxChars * r)

  const overview = [
    `# 项目背景: ${project.name} (${project.code})`,
    '',
    `- 状态: ${project.status} | 健康度: ${project.health || '-'} | 进度: ${project.progress}%${project.startDate ? ` | 周期: ${d(project.startDate)} ~ ${d(project.endDate) || '未定'}` : ''}`,
    project.description ? `- 项目目标: ${project.description.slice(0, q(0.1))}` : null
  ].filter(Boolean)

  const msLines = milestones.map(m =>
    `- [${MS_STATUS_CN[m.status] || m.status}] ${m.name}${m.plannedDate ? `（计划 ${d(m.plannedDate)}）` : ''}`)
  const taskStatLine = ['TODO', 'QUEUED', 'IN_PROGRESS', 'DONE', 'VERIFIED']
    .map(s => `${STATUS_CN[s]} ${statCount[s] || 0}`).join(' / ')
  const taskLines = tasks.slice(0, 20).map(t =>
    `- [${STATUS_CN[t.status] || t.status}] ${t.title}${t.assigneeId ? `（${nameOf.get(String(t.assigneeId)) || '?'}）` : '（未指派）'}${t.dueDate ? ` 截止${d(t.dueDate)}` : ''}`)
  const reqLines = requirements.map(r => `- [${r.priority}] ${r.title}${r.taskId ? '（已转任务）' : ''}`)
  const recBlocks = records.map(r =>
    `### ${r.type === 'MEETING' ? '会议' : '沟通'}·${r.title}（${d(r.occurredAt)}）\n${(r.content || '').replace(/\n{2,}/g, '\n').slice(0, Math.floor(q(0.25) / Math.max(records.length, 1)))}`)
  const actLines = activities.map(a => `- ${d(a.happenedAt)} ${a.title.slice(0, 80)}${a.author ? `（${a.author}）` : ''}`)

  const md = [
    ...overview,
    '',
    `## 里程碑（${milestones.length}）`,
    ...clipLines(msLines, q(0.15)),
    '',
    `## 任务概况（共 ${tasks.length}: ${taskStatLine}）`,
    ...clipLines(taskLines, q(0.25)),
    '',
    `## 已确认需求（${requirements.length}）`,
    ...(reqLines.length ? clipLines(reqLines, q(0.2)) : ['- （暂无已确认需求）']),
    '',
    '## 最近会议/沟通纪要',
    ...(recBlocks.length ? recBlocks : ['（暂无纪要）']),
    '',
    '## 最近代码提交',
    ...(actLines.length ? clipLines(actLines, q(0.05)) : ['（无提交动态或未配置仓库）'])
  ].join('\n')

  return md.length > maxChars ? md.slice(0, maxChars - 20) + '\n…(上下文已截断)' : md
}
