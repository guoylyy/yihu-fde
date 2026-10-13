// v1.3.0 交付健康度自动红绿灯
// 四个自动信号: 工时超投 / 里程碑延期 / 问题积压 / 长期无提交
// 只对进行中(APPROVED/IN_PROGRESS)项目计算; 灯色 = 信号最差值(任一 RED 即 RED)
// 同时是 v1.3.1 巡检 Agent 的数据源(先有指标, 才有巡检)
import prisma from '../lib/prisma.js'

export const HEALTH_ACTIVE_STATUSES = ['APPROVED', 'IN_PROGRESS']

const DAY = 24 * 60 * 60 * 1000

/**
 * 批量计算若干项目的交付健康度
 * @param {Array<BigInt>} projectIds
 * @returns {Promise<Map<string, {light: 'GREEN'|'YELLOW'|'RED', signals: Array}>>}
 */
export async function computeHealthForProjects(projectIds) {
  const result = new Map()
  if (!projectIds.length) return result
  const ids = projectIds.map(id => BigInt(id))
  const now = new Date()
  const today = new Date(new Date().toDateString())

  const [projects, hourSums, timesheetByEng, delayedMilestones, openIssues, repos, lastCommits] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, budget: true }
    }),
    prisma.timesheet.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, deletedAt: null, status: 'APPROVED' },
      _sum: { hours: true }
    }),
    prisma.timesheet.groupBy({
      by: ['projectId', 'engineerId'],
      where: { projectId: { in: ids }, deletedAt: null, status: 'APPROVED' },
      _sum: { hours: true }
    }),
    prisma.milestone.findMany({
      where: {
        projectId: { in: ids }, deletedAt: null,
        status: { not: 'COMPLETED' }, plannedDate: { lt: today, not: null }
      },
      select: { projectId: true, name: true, plannedDate: true }
    }),
    prisma.issue.findMany({
      where: { projectId: { in: ids }, deletedAt: null, status: { notIn: ['RESOLVED', 'CLOSED'] } },
      select: { projectId: true, severity: true }
    }),
    prisma.projectRepository.findMany({
      where: { projectId: { in: ids }, deletedAt: null },
      select: { projectId: true, createdAt: true }
    }),
    prisma.repoActivity.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, type: 'COMMIT' },
      _max: { happenedAt: true }
    })
  ])

  // 工时成本 = Σ 小时 × 工程师日薪/8 (缺日薪的工程师按 0 计, 只作预警参考)
  const engIds = [...new Set(timesheetByEng.map(t => String(t.engineerId)))]
  const engineers = engIds.length
    ? await prisma.engineer.findMany({ where: { id: { in: engIds.map(BigInt) } }, select: { id: true, dailyRate: true } })
    : []
  const rateMap = new Map(engineers.map(e => [String(e.id), Number(e.dailyRate || 0)]))
  const laborCostMap = new Map()
  for (const t of timesheetByEng) {
    const k = String(t.projectId)
    const cost = Number(t._sum.hours || 0) * (rateMap.get(String(t.engineerId)) || 0) / 8
    laborCostMap.set(k, (laborCostMap.get(k) || 0) + cost)
  }
  const hoursMap = new Map(hourSums.map(h => [String(h.projectId), Number(h._sum.hours || 0)]))

  const delayMap = new Map()
  for (const m of delayedMilestones) {
    const k = String(m.projectId)
    if (!delayMap.has(k)) delayMap.set(k, [])
    delayMap.get(k).push(m)
  }
  const issueMap = new Map()
  for (const i of openIssues) {
    const k = String(i.projectId)
    if (!issueMap.has(k)) issueMap.set(k, [])
    issueMap.get(k).push(i)
  }
  const repoMap = new Map()
  for (const r of repos) {
    const k = String(r.projectId)
    if (!repoMap.has(k) || r.createdAt < repoMap.get(k)) repoMap.set(k, r.createdAt)
  }
  const commitMap = new Map(lastCommits.map(c => [String(c.projectId), c._max.happenedAt]))

  for (const p of projects) {
    const k = String(p.id)
    if (!HEALTH_ACTIVE_STATUSES.includes(p.status)) {
      result.set(k, null) // 非进行中项目不亮灯
      continue
    }
    const signals = []

    // 1) 工时超投: 人力成本 vs 预算 (无预算则跳过)
    const budget = Number(p.budget || 0)
    if (budget > 0) {
      const laborCost = Math.round(laborCostMap.get(k) || 0)
      const ratio = laborCost / budget
      if (ratio >= 0.8) {
        signals.push({
          key: 'hoursOver',
          level: ratio >= 1 ? 'RED' : 'YELLOW',
          label: '工时超投',
          detail: `人力成本约 ¥${laborCost.toLocaleString()}, 已达预算的 ${Math.round(ratio * 100)}%（累计工时 ${hoursMap.get(k) || 0}h）`
        })
      }
    }

    // 2) 里程碑延期: 计划日期已过仍未完成
    const delayed = delayMap.get(k) || []
    if (delayed.length) {
      const worstDays = Math.max(...delayed.map(m => Math.floor((today - new Date(m.plannedDate)) / DAY)))
      signals.push({
        key: 'milestoneDelay',
        level: delayed.length >= 2 || worstDays > 7 ? 'RED' : 'YELLOW',
        label: '里程碑延期',
        detail: `${delayed.length} 个里程碑逾期未完成, 最久已延 ${worstDays} 天（${delayed.map(m => m.name).slice(0, 3).join('、')}）`
      })
    }

    // 3) 问题积压: 未解决 Issue 数量 / 严重度
    const issues = issueMap.get(k) || []
    const critical = issues.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH').length
    if (issues.length >= 3 || critical > 0) {
      signals.push({
        key: 'issueBacklog',
        level: issues.length >= 8 || critical >= 2 ? 'RED' : 'YELLOW',
        label: '问题积压',
        detail: `${issues.length} 个问题未解决${critical ? `, 其中 ${critical} 个高危` : ''}`
      })
    }

    // 4) 长期无提交: 配置了仓库才判定
    const repoSince = repoMap.get(k)
    if (repoSince) {
      const last = commitMap.get(k) || repoSince
      const idleDays = Math.floor((now - new Date(last)) / DAY)
      if (idleDays > 14) {
        signals.push({
          key: 'noCommit',
          level: idleDays > 30 ? 'RED' : 'YELLOW',
          label: '长期无提交',
          detail: commitMap.get(k)
            ? `已连续 ${idleDays} 天没有代码提交`
            : `仓库配置 ${idleDays} 天以来未同步到任何提交`
        })
      }
    }

    const light = signals.some(s => s.level === 'RED') ? 'RED'
      : signals.some(s => s.level === 'YELLOW') ? 'YELLOW' : 'GREEN'
    result.set(k, { light, signals })
  }
  return result
}

/** 单项目健康度 */
export async function computeProjectHealth(projectId) {
  const map = await computeHealthForProjects([projectId])
  return map.get(String(projectId)) ?? null
}
