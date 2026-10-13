// v1.5.6 团队归属查询工具
// 人员类接口(用户/工程师/项目成员/个人中心)统一用这里批量带出所属团队,
// 即时消息通知按团队定位接收人也依赖同一口径(仅启用且未删除的团队)。
import prisma from './prisma.js'

/**
 * 批量查用户所属团队
 * @param {Array<BigInt|string|number>} userIds
 * @returns {Promise<Map<string, Array<{id, name}>>>} key 为 userId 字符串
 */
export async function getTeamsByUserIds(userIds) {
  const ids = [...new Set((userIds || []).filter(id => id != null).map(String))]
  if (!ids.length) return new Map()
  const rows = await prisma.teamMembership.findMany({
    where: { userId: { in: ids.map(BigInt) }, team: { deletedAt: null, status: 1 } },
    select: { userId: true, team: { select: { id: true, name: true } } }
  })
  const map = new Map()
  for (const r of rows) {
    const k = r.userId.toString()
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r.team)
  }
  return map
}

/** 单用户版: 返回 [{id, name}] */
export async function getTeamsByUserId(userId) {
  const map = await getTeamsByUserIds([userId])
  return map.get(String(userId)) || []
}
