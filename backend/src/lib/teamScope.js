// 0.5.0 R4 组长层: 团队视图(/api/team/*)的数据范围
//
//   ADMIN(dataScope=ALL)  → 全部人
//   TEAM_LEAD(dataScope=TEAM) → 本人 TeamMembership 覆盖的团队(外加本人挂名 leaderId 的团队)里的所有人
//   其他                  → 只有自己(engineerId = 自己)
//
// 按角色的 dataScope 判断而不是角色字面量, 与 lib/auth.js buildScopeWhere 同一套路:
// 后台新建一个 dataScope=TEAM 的自定义角色, 自动得到组长的口径。
import prisma from './prisma.js'
import { getDataScope } from './auth.js'

/**
 * @returns {Promise<{kind:'ALL'|'TEAM'|'SELF', teamIds:bigint[]|null, userIds:bigint[]|null, engineerIds:bigint[]|null}>}
 *   kind=ALL 时 teamIds/userIds/engineerIds 都是 null(不过滤);
 *   其余是明确的名单(可能为空数组 —— 组长还没挂任何团队时只看得到空)。
 */
export async function resolveTeamScope(user) {
  if (!user) return { kind: 'SELF', teamIds: [], userIds: [], engineerIds: [] }
  const scope = getDataScope(user.role)
  if (scope === 'ALL') return { kind: 'ALL', teamIds: null, userIds: null, engineerIds: null }

  const uid = BigInt(user.id ?? user.userId)
  if (scope === 'TEAM') {
    const teams = await prisma.team.findMany({
      where: {
        deletedAt: null, status: 1,
        OR: [{ members: { some: { userId: uid } } }, { leaderId: uid }]
      },
      select: { id: true }
    })
    const teamIds = teams.map(t => t.id)
    const memberships = teamIds.length
      ? await prisma.teamMembership.findMany({ where: { teamId: { in: teamIds } }, select: { userId: true } })
      : []
    const userIds = uniq([uid, ...memberships.map(m => m.userId)])
    return { kind: 'TEAM', teamIds, userIds, engineerIds: await engineerIdsOf(userIds) }
  }

  return { kind: 'SELF', teamIds: [], userIds: [uid], engineerIds: await engineerIdsOf([uid]) }
}

/** 范围转成 prisma user where 片段(ALL 时为空对象) */
export function userWhereOf(scope) {
  return scope.kind === 'ALL' ? {} : { id: { in: scope.userIds } }
}

async function engineerIdsOf(userIds) {
  if (!userIds.length) return []
  const rows = await prisma.engineer.findMany({ where: { userId: { in: userIds }, deletedAt: null }, select: { id: true } })
  return rows.map(r => r.id)
}

function uniq(ids) {
  return [...new Set(ids.map(String))].map(BigInt)
}
