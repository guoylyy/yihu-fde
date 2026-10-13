// v1.4.x 项目活跃度评分 (主人拍板: 列表按活跃度排序, 不活跃自动沉底)
// v2 模型(主人反馈: 只看 commit 太窄, 里程碑/任务/问题等业务动态也是活跃):
// 总分 0-100 = 代码活跃(≤50) + 业务活跃(≤50), 两条腿走路——
// 纯实施期项目(没提交但在推里程碑/填工时)与纯开发期项目(疯狂提交)都能拿到应有分数。
//
// 代码活跃 (≤50, 来自已同步 Gitee 提交):
//   仓库数量        min(n,3)×3            ≤9
//   近30天提交      min(c30,20)           ≤20
//   近 7天提交      min(c7×2,12)          ≤12
//   最近提交时效    ≤3天9 / ≤7天6 / ≤14天3 / ≤30天1   ≤9
//
// 业务活跃 (≤50, 来自平台操作):
//   任务动态(新建+完成)      30天 min(x,10) + 7天 min(x×2,8)   ≤18
//   里程碑动态(设置+达成)    min(30天 x×3, 10)                  ≤10
//   问题动态(提交+解决)      min(30天 x×2, 8)                   ≤8
//   工时填报                 近30天有填报的天数 min(d,8)         ≤8
//   交付物上传+客户意见      min(30天 x×2, 6)                   ≤6
//   项目记录(纪要/对接/现场) min(30天 x×2, 6)                   ≤6
//
// 档位: ≥60 活跃 / 30-59 一般 / 1-29 低频 / 0 沉寂
// 重算时机: 服务启动后 45s + 每小时 + 每次仓库提交同步完成后
import prisma from '../lib/prisma.js'

export function activityLevel(score) {
  if (score >= 60) return 'HIGH'
  if (score >= 30) return 'MEDIUM'
  if (score >= 1) return 'LOW'
  return 'IDLE'
}

function commitRecencyScore(lastCommitAt, now) {
  if (!lastCommitAt) return 0
  const days = (now - new Date(lastCommitAt)) / 86400000
  if (days <= 3) return 9
  if (days <= 7) return 6
  if (days <= 14) return 3
  if (days <= 30) return 1
  return 0
}

// groupBy 结果 → Map<projectIdStr, count>
const toCountMap = rows => new Map(rows.map(r => [String(r.projectId), r._count._all]))

/**
 * 全量重算所有未删除项目的活跃度评分, 写回 projects.activity_score / activity_meta
 */
export async function computeAllActivityScores() {
  const now = new Date()
  const d7 = new Date(now.getTime() - 7 * 86400000)
  const d30 = new Date(now.getTime() - 30 * 86400000)

  const [
    projects, repoCounts, commits7, commits30, lastCommits,
    tasksCreated30, tasksDone30, tasksCreated7, tasksDone7,
    msCreated30, msDone30,
    issuesCreated30, issuesResolved30,
    timesheetDays30,
    records30
  ] = await Promise.all([
    prisma.project.findMany({ where: { deletedAt: null }, select: { id: true, activityScore: true } }),
    prisma.projectRepository.groupBy({ by: ['projectId'], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.repoActivity.groupBy({ by: ['projectId'], where: { type: 'COMMIT', happenedAt: { gte: d7 } }, _count: { _all: true } }),
    prisma.repoActivity.groupBy({ by: ['projectId'], where: { type: 'COMMIT', happenedAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.repoActivity.groupBy({ by: ['projectId'], where: { type: 'COMMIT' }, _max: { happenedAt: true } }),
    // 任务动态
    prisma.task.groupBy({ by: ['projectId'], where: { deletedAt: null, createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['projectId'], where: { deletedAt: null, completedAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['projectId'], where: { deletedAt: null, createdAt: { gte: d7 } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['projectId'], where: { deletedAt: null, completedAt: { gte: d7 } }, _count: { _all: true } }),
    // 里程碑动态(设置+达成)
    prisma.milestone.groupBy({ by: ['projectId'], where: { deletedAt: null, createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.milestone.groupBy({ by: ['projectId'], where: { deletedAt: null, actualDate: { gte: d30 } }, _count: { _all: true } }),
    // 问题动态(提交+解决)
    prisma.issue.groupBy({ by: ['projectId'], where: { deletedAt: null, createdAt: { gte: d30 } }, _count: { _all: true } }),
    prisma.issue.groupBy({ by: ['projectId'], where: { deletedAt: null, resolvedAt: { gte: d30 } }, _count: { _all: true } }),
    // 工时: 近30天有填报的自然日数(同日多条算一天)
    prisma.timesheet.groupBy({ by: ['projectId', 'workDate'], where: { deletedAt: null, workDate: { gte: d30 } }, _count: { _all: true } }),
    // v1.4.x: 项目记录(会议纪要/对接/现场)也是业务活跃
    prisma.projectRecord.groupBy({ by: ['projectId'], where: { deletedAt: null, createdAt: { gte: d30 } }, _count: { _all: true } })
  ])

  const repoMap = toCountMap(repoCounts)
  const c7Map = toCountMap(commits7)
  const c30Map = toCountMap(commits30)
  const lastMap = new Map(lastCommits.map(r => [String(r.projectId), r._max.happenedAt]))
  const tC30 = toCountMap(tasksCreated30), tD30 = toCountMap(tasksDone30)
  const tC7 = toCountMap(tasksCreated7), tD7 = toCountMap(tasksDone7)
  const mC30 = toCountMap(msCreated30), mD30 = toCountMap(msDone30)
  const iC30 = toCountMap(issuesCreated30), iR30 = toCountMap(issuesResolved30)
  const rC30 = toCountMap(records30)
  // 工时天数: groupBy [projectId, workDate] 的行数 = 每项目的不同填报日数
  const tsDays = new Map()
  for (const r of timesheetDays30) {
    const k = String(r.projectId)
    tsDays.set(k, (tsDays.get(k) || 0) + 1)
  }

  let updated = 0
  for (const p of projects) {
    const k = String(p.id)
    const g = m => m.get(k) || 0

    // ---- 代码活跃 (≤50) ----
    const repoCount = g(repoMap)
    const c7 = g(c7Map), c30 = g(c30Map)
    const lastCommitAt = lastMap.get(k) || null
    const codeScore = Math.min(50,
      Math.min(repoCount, 3) * 3 +
      Math.min(c30, 20) +
      Math.min(c7 * 2, 12) +
      commitRecencyScore(lastCommitAt, now)
    )

    // ---- 业务活跃 (≤50) ----
    const tasks30 = g(tC30) + g(tD30)
    const tasks7 = g(tC7) + g(tD7)
    const milestones30 = g(mC30) + g(mD30)
    const issues30 = g(iC30) + g(iR30)
    const tsDays30 = g(tsDays)
    const records30n = g(rC30)
    const bizScore = Math.min(50,
      Math.min(tasks30, 10) + Math.min(tasks7 * 2, 8) +
      Math.min(milestones30 * 3, 10) +
      Math.min(issues30 * 2, 8) +
      Math.min(tsDays30, 8) +
      Math.min(records30n * 2, 6)
    )

    const score = Math.min(100, codeScore + bizScore)
    const meta = {
      repoCount, commits7: c7, commits30: c30, lastCommitAt,
      tasks30, milestones30, issues30, timesheetDays30: tsDays30, records30: records30n,
      codeScore, bizScore, computedAt: now
    }
    await prisma.project.update({
      where: { id: p.id },
      data: { activityScore: score, activityMeta: meta }
    }).catch(e => console.error(`[activity] 项目 ${p.id} 写入失败:`, e.message))
    if (score !== p.activityScore) updated++
  }
  return { scanned: projects.length, changed: updated }
}
