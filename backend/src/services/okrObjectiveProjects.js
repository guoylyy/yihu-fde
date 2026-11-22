// OKR 5.0: O 结构化挂项目(okr_objective_projects)。一个 O 可挂多个项目, 空 = 个人发展类 O。
//
// - 写: 随 POST /plan(/submit) 的 objectives[i].projectIds 全量替换该 O 的关联;
//   不传(undefined / null)= 不动已有关联(老调用方 / 还没升级的前端保存时不会把关联冲掉), [] = 清空
// - 校验: 都是真实存在的项目(deletedAt=null), 去重后最多 10 个
// - 读: 只返回仍存在的项目(项目被删时关联行保留, 这里过滤掉)
// - 统计口径不变(仍按人); 这里只提供「O 属于哪些项目」以及按项目汇总的读视图
import prisma from '../lib/prisma.js'
import { OkrRuleError, objectiveProgress } from './okrRules.js'

export const MAX_PROJECTS_PER_OBJECTIVE = 10
export const UNASSIGNED_NAME = '未挂项目'

const r4 = n => (n == null ? null : Math.round(n * 10000) / 10000)
const bad = (msg, code = 8170) => new OkrRuleError(msg, { status: 400, code })

/**
 * 解析单个 O 的 projectIds。
 * @returns {string[]|null} null = 没传(不动已有关联); 数组 = 去重后的项目 id
 */
export function normalizeProjectIds(raw, label = 'O') {
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) throw bad(`「${label}」的 projectIds 必须是数组`)
  const ids = []
  for (const v of raw) {
    const s = String(v ?? '').trim()
    if (!/^\d+$/.test(s) || (typeof v !== 'string' && typeof v !== 'number')) throw bad(`「${label}」的 projectIds 里有不合法的项目 id: ${JSON.stringify(v)}`)
    if (!ids.includes(s)) ids.push(s)
  }
  if (ids.length > MAX_PROJECTS_PER_OBJECTIVE) throw bad(`「${label}」最多挂 ${MAX_PROJECTS_PER_OBJECTIVE} 个项目, 现在是 ${ids.length} 个`)
  return ids
}

/** 校验这些项目都存在且未删除; 不存在 → 400 8171(带 missing 列表) */
export async function assertProjectsExist(ids, db = prisma) {
  const uniq = [...new Set(ids.map(String))]
  if (!uniq.length) return
  const rows = await db.project.findMany({ where: { id: { in: uniq.map(BigInt) }, deletedAt: null }, select: { id: true } })
  const have = new Set(rows.map(r => String(r.id)))
  const missing = uniq.filter(id => !have.has(id))
  if (missing.length) {
    throw new OkrRuleError(`项目不存在或已删除: ${missing.join(', ')}`, { status: 400, code: 8171, data: { missing } })
  }
}

/**
 * 全量替换某个 O 的项目关联。要在已持有该 O 行锁的事务里调用(savePlan 先 update O 再调这里),
 * 并发保存同一个 O 时第二个事务会等第一个提交后再删再插, 最终只留后提交的那一份
 */
export async function replaceObjectiveProjects(tx, objectiveId, projectIds, by) {
  await tx.okrObjectiveProject.deleteMany({ where: { objectiveId: BigInt(objectiveId) } })
  if (!projectIds.length) return
  await tx.okrObjectiveProject.createMany({
    data: projectIds.map(pid => ({ objectiveId: BigInt(objectiveId), projectId: BigInt(pid), createdBy: BigInt(by) })),
    skipDuplicates: true
  })
}

/** 删 O 时一并删它的关联 */
export async function deleteObjectiveProjects(tx, objectiveId) {
  await tx.okrObjectiveProject.deleteMany({ where: { objectiveId: BigInt(objectiveId) } })
}

/** 复制关联(未达成顺延到下周时, 新 O 带上原 O 的项目) */
export async function copyObjectiveProjects(tx, fromObjectiveId, toObjectiveId, by) {
  const rows = await tx.okrObjectiveProject.findMany({ where: { objectiveId: BigInt(fromObjectiveId) }, select: { projectId: true } })
  if (!rows.length) return
  await tx.okrObjectiveProject.createMany({
    data: rows.map(r => ({ objectiveId: BigInt(toObjectiveId), projectId: r.projectId, createdBy: BigInt(by) })),
    skipDuplicates: true
  })
}

export const projectBrief = p => ({ id: String(p.id), name: p.name, code: p.code })

/**
 * 一批 O 的项目: Map<objectiveId, [{id,name,code}]>(只含仍存在的项目, 按项目名排序)。
 * 没有关联的 O 不在 Map 里, 取的时候用 `|| []`
 */
export async function projectsByObjective(objectiveIds, db = prisma) {
  const ids = [...new Set(objectiveIds.map(String))]
  const out = new Map()
  if (!ids.length) return out
  const links = await db.okrObjectiveProject.findMany({ where: { objectiveId: { in: ids.map(BigInt) } }, select: { objectiveId: true, projectId: true } })
  if (!links.length) return out
  const projects = await db.project.findMany({
    where: { id: { in: [...new Set(links.map(l => l.projectId))] }, deletedAt: null },
    select: { id: true, name: true, code: true }
  })
  const byId = new Map(projects.map(p => [String(p.id), projectBrief(p)]))
  for (const l of links) {
    const p = byId.get(String(l.projectId))
    if (!p) continue
    const k = String(l.objectiveId)
    if (!out.has(k)) out.set(k, [])
    out.get(k).push(p)
  }
  for (const list of out.values()) list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh') || a.id.localeCompare(b.id))
  return out
}

/** 挂了某项目的 O id 集合(限定在给定的 O 范围里) */
export async function objectiveIdsOfProject(projectId, objectiveIds, db = prisma) {
  if (!objectiveIds.length) return new Set()
  const rows = await db.okrObjectiveProject.findMany({
    where: { projectId: BigInt(projectId), objectiveId: { in: objectiveIds.map(o => BigInt(o)) } },
    select: { objectiveId: true }
  })
  return new Set(rows.map(r => String(r.objectiveId)))
}

/**
 * 一组 O 的完成度: 逐条 O 完成度按 O 权重加权(DROPPED 不计); 权重全为 0 时取平均; 没有 O → null
 * @param items [{ weight, progress, status }]
 */
export function groupCompletion(items) {
  const live = items.filter(o => o.status !== 'DROPPED' && o.progress != null)
  if (!live.length) return null
  const wsum = live.reduce((s, o) => s + (Number(o.weight) || 0), 0)
  if (wsum > 0) return r4(live.reduce((s, o) => s + (Number(o.weight) || 0) * o.progress, 0) / wsum)
  return r4(live.reduce((s, o) => s + o.progress, 0) / live.length)
}

/** 按项目视图里的一条 O(含负责人、权重、完成度、自评 / 主管分; 主管分由路由按查看人裁剪) */
export function projectObjectiveView(o, owner, projects) {
  const krs = [...(o.keyResults || [])].sort((a, b) => a.seq - b.seq)
  return {
    id: String(o.id), seq: o.seq, title: o.title, weight: o.weight, status: o.status,
    submitted: !!o.submittedAt, lateSubmit: o.lateSubmit,
    owner,
    progress: r4(objectiveProgress({ keyResults: krs })),
    krTotal: krs.length, krDone: krs.filter(k => k.status === 'DONE').length,
    selfScore: o.selfScore, managerScore: o.managerScore, managerComment: o.managerComment,
    projects
  }
}

export function groupSummary(objectives) {
  return {
    ownerCount: new Set(objectives.map(o => o.owner?.id)).size,
    completion: groupCompletion(objectives)
  }
}

export const unassignedProject = () => ({ id: null, name: UNASSIGNED_NAME, code: null })

