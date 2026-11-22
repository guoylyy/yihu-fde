// OKR 8.0: 按周导出 Word / Excel —— 取数与权限(文件格式在 okrExportFormat.js)。
//
// GET /api/okr/export?week=&scope=team|person|project&format=xlsx|docx&userId=&projectId=
//
// 权限(只读, 不改任何 OKR 业务规则):
//   scope=person  本人可导自己; ADMIN 任何人; MANAGER 只能导本团队成员(teammateIds); 其余导别人 403(8181)
//   scope=team    仅 ADMIN(全部) / MANAGER(本团队成员); 其余 403
//   scope=project 仅 ADMIN / MANAGER; 只含挂了该项目的 O, MANAGER 再按本团队收敛
// 免提交名单: team / project 不出现(与 /team、/by-project 同口径); person 明确指定某人时照导。
// 主管分 / 主管评语: 按查看人裁剪(canSeeManagerScore), 看不到的写 '-' / 不写。
//
// 口径:
//   - 明细每行一个 KR(O 没有 KR 时出一行, KR 列为空); DROPPED 的 O 照样列出(O 状态 = 已放弃)
//   - 汇总每人一行: O 数 / KR 数与 /team 的 objectiveCount / krTotal 一致(DROPPED 不计);
//     平均完成率 = 按 O 权重加权(personProgress), 平均自评 / 主管分 = 按 O 权重加权(weightedScore)
//   - team: 人 = /team 的那些人(participants ∩ 可见范围); project: 人 = 挂该项目 O 的负责人, 汇总只按导出的 O 算
//   - 空周(范围内一条 O 都没有, 含这周没有周期): 只出表头 / 标题, 不报错。读接口不建周期
import prisma from '../lib/prisma.js'
import { getDataScope } from '../lib/auth.js'
import { getCycle, participants } from './okr.js'
import { OkrRuleError, weekKey, shanghaiDateKey, objectiveProgress, krProgress, personProgress, weightedScore } from './okrRules.js'
import { teammateIds, managerScoreScope, canSeeManagerScore } from './okrAccess.js'
import { projectsByObjective, objectiveIdsOfProject, projectBrief } from './okrObjectiveProjects.js'
import { blockerOwnerNames, blockerView, riskSummary } from './okrBlockers.js'
import { summaryCounts, weekDates } from './okrDaily.js'
import { loadProject } from './okrProjectDocs.js'

export const EXPORT_SCOPES = ['team', 'person', 'project']
export const EXPORT_FORMATS = ['xlsx', 'docx']

const r4 = n => (n == null ? null : Math.round(n * 10000) / 10000)
const forbidden = msg => new OkrRuleError(msg, { status: 403, code: 8181 })
const badRequest = msg => new OkrRuleError(msg, { status: 400, code: 8100 })

const isAdmin = user => getDataScope(user?.role) === 'ALL'
const isManager = user => user?.role === 'MANAGER'
const uid = user => String(user?.id ?? user?.userId)

/** 导出的人员范围: null = 不限(ADMIN), Set = 只能这些人; 无权 → 403 */
async function exportAudience(user, scope, targetId) {
  if (scope === 'person') {
    if (targetId === uid(user) || isAdmin(user)) return null
    if (isManager(user) && (await teammateIds(user)).has(targetId)) return null
    throw forbidden(isManager(user) ? '只能导出自己团队成员的 OKR' : '只能导出自己的 OKR')
  }
  if (isAdmin(user)) return null
  if (isManager(user)) return teammateIds(user)
  throw forbidden(scope === 'team' ? '只有管理员或经理能导出团队 OKR' : '只有管理员或经理能导出项目 OKR')
}

async function loadUser(id) {
  const u = await prisma.user.findFirst({ where: { id: BigInt(id), deletedAt: null }, select: { id: true, name: true, username: true } })
  if (!u) throw new OkrRuleError('用户不存在', { status: 404, code: 8108 })
  return { id: String(u.id), name: u.name || u.username }
}

/**
 * 校验参数 + 权限, 取一周的导出数据。
 * @returns {{ week, scope, subject, people: [{ user, objectives, summary }], exportedAt, today }}
 *   subject: team → null; person → { id, name }; project → { id, name, code }
 */
export async function exportData(user, { week, scope, userId, projectId, now = new Date() }) {
  if (!EXPORT_SCOPES.includes(scope)) throw badRequest('scope 只能是 team / person / project')
  let subject = null
  let targetId = null
  if (scope === 'person') {
    targetId = userId == null || userId === '' ? uid(user) : String(userId)
    if (!/^\d+$/.test(targetId)) throw badRequest('userId 不合法')
  }
  if (scope === 'project' && (projectId == null || projectId === '')) throw badRequest('scope=project 要带 projectId')
  // 先看权限再查人 / 项目: 没权限的人不该借 404 / 403 的差别探测谁存在
  const audience = await exportAudience(user, scope, targetId)
  if (scope === 'person') subject = await loadUser(targetId)
  let project = null
  if (scope === 'project') {
    project = await loadProject(projectId)
    subject = projectBrief(project)
  }

  const today = shanghaiDateKey(now)
  const base = { week: weekKey(week), scope, subject, people: [], exportedAt: now, today }
  const cycle = await getCycle(week, { now })
  if (!cycle) return base

  // 人: person 就是这一个人(免提交也照导); team / project 是 participants(已去掉免提交) ∩ 可见范围
  const ids = scope === 'person'
    ? [targetId]
    : (await participants(cycle.id)).filter(id => !audience || audience.has(id))
  if (!ids.length) return base

  let objs = await prisma.okrObjective.findMany({
    where: { cycleId: cycle.id, ownerId: { in: ids.map(BigInt) } },
    orderBy: [{ ownerId: 'asc' }, { seq: 'asc' }],
    include: { keyResults: true }
  })
  if (project) {
    const inProject = await objectiveIdsOfProject(project.id, objs.map(o => o.id))
    objs = objs.filter(o => inProject.has(String(o.id)))
  }
  if (!objs.length) return base

  const byOwner = new Map()
  for (const o of objs) {
    const k = String(o.ownerId)
    if (!byOwner.has(k)) byOwner.set(k, [])
    byOwner.get(k).push(o)
  }
  const peopleIds = scope === 'team' ? ids : [...byOwner.keys()]
  const users = await prisma.user.findMany({ where: { id: { in: peopleIds.map(BigInt) } }, select: { id: true, name: true, username: true } })
  const names = new Map(users.map(u => [String(u.id), u.name || u.username]))

  const krIds = objs.flatMap(o => o.keyResults.map(k => k.id))
  const updateRows = krIds.length
    ? await prisma.okrUpdate.groupBy({ by: ['krId'], where: { cycleId: cycle.id, krId: { in: krIds } }, _count: { _all: true } })
    : []
  const updatesByKr = new Map(updateRows.map(r => [String(r.krId), r._count._all]))
  const projects = await projectsByObjective(objs.map(o => o.id))
  const blockerNames = await blockerOwnerNames(objs)
  const { from, to } = weekDates(cycle.startDate)
  const daily = await summaryCounts(peopleIds.filter(id => names.has(id)), from, to)
  const scoreScope = await managerScoreScope(user)

  const people = peopleIds.filter(id => names.has(id)).map((id) => {
    const mine = (byOwner.get(id) || []).sort((a, b) => a.seq - b.seq)
    const showManager = canSeeManagerScore(user, id, scoreScope)
    const live = mine.filter(o => o.status !== 'DROPPED')
    const risk = riskSummary(mine, today)
    const submittedAll = live.length > 0 && live.every(o => o.submittedAt)
    return {
      user: { id, name: names.get(id) },
      showManager,
      objectives: mine.map(o => objectiveRow(o, { projects, blockerNames, updatesByKr, today, showManager })),
      summary: {
        objectiveCount: live.length,
        krCount: live.reduce((s, o) => s + o.keyResults.length, 0),
        completion: r4(personProgress(mine)),
        selfScore: weightedScore(mine, 'selfScore'),
        managerScore: showManager ? weightedScore(mine, 'managerScore') : null,
        // NONE(没交完) / LATE / ON_TIME, 与 /team 的 submission 同口径
        submission: submittedAll ? (live.some(o => o.lateSubmit) ? 'LATE' : 'ON_TIME') : 'NONE',
        dailySummaries: daily.get(id) || 0,
        highRiskCount: live.filter(o => o.riskLevel === 'HIGH').length,
        blockerOverdueCount: risk.blockerOverdueCount
      }
    }
  })
  people.sort((a, b) => String(a.user.name).localeCompare(String(b.user.name), 'zh') || a.user.id.localeCompare(b.user.id))
  return { ...base, people }
}

function objectiveRow(o, { projects, blockerNames, updatesByKr, today, showManager }) {
  const krs = [...o.keyResults].sort((a, b) => a.seq - b.seq)
  return {
    id: String(o.id), seq: o.seq, title: o.title, weight: o.weight, status: o.status,
    riskLevel: o.riskLevel || 'LOW',
    blocker: blockerView(o, blockerNames, today),
    projects: (projects.get(String(o.id)) || []).map(p => p.name),
    progress: r4(objectiveProgress({ keyResults: krs })),
    selfScore: o.selfScore,
    managerScore: showManager ? o.managerScore : null,
    managerComment: showManager ? (o.managerComment || null) : null,
    keyResults: krs.map(k => ({
      id: String(k.id), seq: k.seq, title: k.title, metricType: k.metricType, unit: k.unit,
      targetValue: k.metricType === 'BINARY' ? 1 : k.targetValue, currentValue: k.currentValue,
      progress: r4(krProgress(k)), weight: k.weight, status: k.status, blockers: k.blockers || null,
      updates: updatesByKr.get(String(k.id)) || 0
    }))
  }
}

// ---------------------------------------------------------------- 文件名

const SCOPE_ASCII = { team: 'team', person: 'person', project: 'project' }

/** 去掉文件名里不能出现的字符 */
const safeName = s => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)

/** { ascii, utf8 }: OKR-2026-W48-team.xlsx / OKR-2026-W48-团队.xlsx */
export function exportFileNames(data, format) {
  const head = `OKR-${data.week}`
  let ascii = `${head}-${SCOPE_ASCII[data.scope]}`
  let utf8 = `${head}-团队`
  if (data.scope === 'person') {
    ascii += `-${data.subject.id}`
    utf8 = `${head}-${safeName(data.subject.name) || data.subject.id}`
  } else if (data.scope === 'project') {
    ascii += `-${data.subject.id}`
    utf8 = `${head}-项目-${safeName(data.subject.name) || data.subject.id}`
  }
  return { ascii: `${ascii}.${format}`, utf8: `${utf8}.${format}` }
}

/** RFC 6266 / 5987: ASCII 回退 + filename*=UTF-8'' */
export function contentDisposition({ ascii, utf8 }) {
  const enc = encodeURIComponent(utf8).replace(/['()*!]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`
}
