// OKR 5.0: 按项目看 O(只读)。
//   byProject(week)              → 按项目分组, 无项目的 O 归「未挂项目」组; 挂多个项目的 O 在每个项目组里各出现一次
//   projectObjectives(project, week) → 某项目某周的全部 O
// 范围: OKR 全员可见, 不按团队裁剪; 只排除免提交名单里的人(与团队 / 统计同一口径)。DROPPED 的 O 照样列出, 但不进完成度。
// 主管分 / 主管评语这里一律算出来, 由路由按查看人逐条裁剪(okrAccess.canSeeManagerScore)。
// 读接口不建周期: 那一周没有周期就返回空。
import prisma from '../lib/prisma.js'
import { weekKey, shanghaiDateKey } from './okrRules.js'
import { blockerOwnerNames } from './okrBlockers.js'
import { getCycle, participants } from './okr.js'
import {
  projectsByObjective, objectiveIdsOfProject, projectObjectiveView, groupSummary, unassignedProject, projectBrief
} from './okrObjectiveProjects.js'

const USER_SELECT = { id: true, name: true, username: true, avatarUrl: true }

async function weekObjectives(week, { onlyIds = null } = {}) {
  const cycle = await getCycle(week)
  if (!cycle) return { cycle: null, objs: [], users: new Map(), risk: {} }
  const allowed = new Set(await participants(cycle.id))
  const objs = (await prisma.okrObjective.findMany({
    where: { cycleId: cycle.id, ...(onlyIds ? { id: { in: [...onlyIds].map(BigInt) } } : {}) },
    orderBy: [{ ownerId: 'asc' }, { seq: 'asc' }],
    include: { keyResults: true }
  })).filter(o => allowed.has(String(o.ownerId)))
  const ownerIds = [...new Set(objs.map(o => String(o.ownerId)))]
  const rows = ownerIds.length ? await prisma.user.findMany({ where: { id: { in: ownerIds.map(BigInt) } }, select: USER_SELECT }) : []
  const users = new Map(rows.map(u => [String(u.id), { id: String(u.id), name: u.name, username: u.username, avatarUrl: u.avatarUrl }]))
  // 6.0: 卡点人名字 + 今天(算卡点逾期)
  const risk = { blockerNames: await blockerOwnerNames(objs), today: shanghaiDateKey() }
  return { cycle, objs, users, risk }
}

const ownerOf = (users, o) => users.get(String(o.ownerId)) || { id: String(o.ownerId) }

/** 负责人名字, 再按 seq */
function sortObjectives(list) {
  return list.sort((a, b) => String(a.owner?.name ?? '').localeCompare(String(b.owner?.name ?? ''), 'zh') || a.owner.id.localeCompare(b.owner.id) || a.seq - b.seq)
}

/** [{ project, objectives, ownerCount, completion }]; 项目按名称排, 「未挂项目」垫底 */
export async function byProject(week) {
  const { objs, users, risk } = await weekObjectives(week)
  if (!objs.length) return []
  const projects = await projectsByObjective(objs.map(o => o.id))
  const groups = new Map()
  const unassigned = []
  for (const o of objs) {
    const ps = projects.get(String(o.id)) || []
    const view = projectObjectiveView(o, ownerOf(users, o), ps, risk)
    if (!ps.length) { unassigned.push(view); continue }
    for (const p of ps) {
      if (!groups.has(p.id)) groups.set(p.id, { project: p, objectives: [] })
      groups.get(p.id).objectives.push(view)
    }
  }
  const out = [...groups.values()]
    .sort((a, b) => String(a.project.name).localeCompare(String(b.project.name), 'zh') || a.project.id.localeCompare(b.project.id))
    .map(g => ({ project: g.project, objectives: sortObjectives(g.objectives), ...groupSummary(g.objectives) }))
  if (unassigned.length) out.push({ project: unassignedProject(), objectives: sortObjectives(unassigned), ...groupSummary(unassigned) })
  return out
}

/** 某项目某周的全部 O; project 由路由 loadProject 查好(不存在已 404) */
export async function projectObjectives(project, week) {
  const cycle = await getCycle(week)
  const base = { project: projectBrief(project), week: weekKey(week), cycleStatus: cycle?.status ?? null }
  if (!cycle) return { ...base, objectives: [], ownerCount: 0, completion: null, riskLevel: null, blockerCount: 0, blockerOverdueCount: 0 }
  const cycleObjIds = (await prisma.okrObjective.findMany({ where: { cycleId: cycle.id }, select: { id: true } })).map(o => String(o.id))
  const ids = await objectiveIdsOfProject(project.id, cycleObjIds)
  if (!ids.size) return { ...base, objectives: [], ownerCount: 0, completion: null, riskLevel: null, blockerCount: 0, blockerOverdueCount: 0 }
  const { objs, users, risk } = await weekObjectives(week, { onlyIds: ids })
  const projects = await projectsByObjective(objs.map(o => o.id))
  const list = sortObjectives(objs.map(o => projectObjectiveView(o, ownerOf(users, o), projects.get(String(o.id)) || [], risk)))
  return { ...base, objectives: list, ...groupSummary(list) }
}
