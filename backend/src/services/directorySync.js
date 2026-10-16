// 以虎 One 通讯录同步: 人以平台为准
//   - 已在本系统开通的人: 姓名、邮箱、手机、头像按平台更新(平台提供了哪些记在 platformFields, 个人中心里只读); 平台上停用 → 本系统停用(platformDisabled), 恢复 → 自动启用
//   - 团队 = 平台部门(只建有本系统成员的部门): 名称取部门路径, 成员按平台部门归属; 平台上没有了的团队停用
//     以前手建的团队: 同名的认领为对应部门, 其余不动(管理员可在团队页删除)
// 每小时增量(updatedSince), 每天一次全量(全量才重建团队, 部门归属要看全体)
import prisma from '../lib/prisma.js'
import { listDirectory, platformEnabled } from '../lib/yihuOne.js'
import { platformProfile } from '../lib/identity.js'

const LAST_KEY = 'directory.lastSyncAt'
const TEAM_NAME_MAX = 50
let last = null   // 最近一次结果, 给设置页看

export const lastDirectorySync = () => last

/** 部门 → 团队名(纯函数): 用完整路径, 太长时保留末段; 重名时带部门 id */
export function teamNameFor(dept, taken) {
  let name = dept.path || dept.name || `部门 ${dept.id}`
  if (name.length > TEAM_NAME_MAX) name = `…/${dept.name || dept.id}`.slice(0, TEAM_NAME_MAX)
  if (taken.has(name)) name = `${name.slice(0, TEAM_NAME_MAX - 8)} #${dept.id}`
  taken.add(name)
  return name
}

/** 一个平台用户对本系统账号要做的改动(纯函数); 不用改返回 null */
export function userChanges(user, pu) {
  const data = {}
  const p = platformProfile({ ...pu, username: null })
  for (const k of ['name', 'email', 'phone', 'avatarUrl']) if (p.data[k] !== undefined && p.data[k] !== user[k]) data[k] = p.data[k]
  // 老版本平台的通讯录不带头像: 不知道就不动(头像和它的只读标记都留着登录时的)
  const known = 'avatar' in pu ? p.fields : [...p.fields, ...((user.platformFields || []).includes('avatarUrl') ? ['avatarUrl'] : [])]
  const fields = ['name', 'email', 'phone', 'avatarUrl'].filter(k => known.includes(k))
  const cur = Array.isArray(user.platformFields) ? user.platformFields : []
  if (fields.join() !== ['name', 'email', 'phone', 'avatarUrl'].filter(k => cur.includes(k)).join()) data.platformFields = fields
  if (!pu.active && user.status === 1) Object.assign(data, { status: 0, platformDisabled: true })
  if (pu.active && user.platformDisabled) Object.assign(data, { status: 1, platformDisabled: false })
  return Object.keys(data).length ? data : null
}

async function syncTeams(list, userBySub) {
  const depts = new Map()   // platformDeptId → { dept, members: Set(userId) }
  for (const pu of list) {
    const u = userBySub.get(String(pu.id))
    if (!u || !pu.active) continue
    for (const d of pu.depts || []) {
      if (!depts.has(d.id)) depts.set(d.id, { dept: d, members: new Set() })
      depts.get(d.id).members.add(u.id)
    }
  }
  const existing = await prisma.team.findMany({ where: { deletedAt: null } })
  const byDept = new Map(existing.filter(t => t.platformDeptId != null).map(t => [t.platformDeptId, t]))
  const byName = new Map(existing.map(t => [t.name, t]))
  const taken = new Set(existing.filter(t => t.platformDeptId == null).map(t => t.name))
  let teams = 0
  for (const [deptId, { dept, members }] of depts) {
    let team = byDept.get(deptId)
    const name = team ? team.name : teamNameFor(dept, taken)
    if (!team) {
      // 管理员以前手建的同名团队: 认领为这个部门, 保留它的群机器人
      const same = byName.get(dept.path) || byName.get(dept.name)
      team = same && same.platformDeptId == null
        ? await prisma.team.update({ where: { id: same.id }, data: { platformDeptId: deptId, status: 1 } })
        : await prisma.team.create({ data: { name, platformDeptId: deptId, status: 1 } })
    } else if (team.status !== 1) {
      await prisma.team.update({ where: { id: team.id }, data: { status: 1 } })
    }
    const ids = [...members]
    await prisma.$transaction([
      prisma.teamMembership.deleteMany({ where: { teamId: team.id, userId: { notIn: ids } } }),
      ...ids.map(userId => prisma.teamMembership.upsert({
        where: { teamId_userId: { teamId: team.id, userId } }, update: {}, create: { teamId: team.id, userId }
      }))
    ])
    teams++
  }
  // 平台上没有对应部门(或部门里已没有本系统成员)的团队: 停用。手建的团队不归同步管
  const live = new Set([...depts.keys()])
  const stale = existing.filter(t => t.status === 1 && t.platformDeptId != null && !live.has(t.platformDeptId))
  if (stale.length) await prisma.team.updateMany({ where: { id: { in: stale.map(t => t.id) } }, data: { status: 0 } })
  return { teams, disabledTeams: stale.length }
}

/** full=true 时拉全量并重建团队; 否则按上次同步时间增量 */
export async function syncDirectory({ full = false } = {}) {
  if (!platformEnabled()) return null
  const startedAt = new Date()
  const lastRow = await prisma.appSetting.findUnique({ where: { key: LAST_KEY } }).catch(() => null)
  // 往前多取 5 分钟, 防止两边时钟有偏差漏掉
  const since = !full && lastRow?.value ? new Date(new Date(lastRow.value).getTime() - 300_000) : null
  try {
    const { list } = await listDirectory({ updatedSince: since })
    const users = await prisma.user.findMany({
      where: { oidcSubject: { in: list.map(p => String(p.id)) }, deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, avatarUrl: true, platformFields: true, status: true, platformDisabled: true, oidcSubject: true }
    })
    const userBySub = new Map(users.map(u => [u.oidcSubject, u]))
    let updated = 0, disabled = 0, enabled = 0
    for (const pu of list) {
      const u = userBySub.get(String(pu.id))
      const data = u && userChanges(u, pu)
      if (!data) continue
      await prisma.user.update({ where: { id: u.id }, data })
      updated++
      if (data.platformDisabled === true) disabled++
      if (data.platformDisabled === false) enabled++
    }
    const teamResult = full ? await syncTeams(list, userBySub) : {}
    await prisma.appSetting.upsert({
      where: { key: LAST_KEY }, update: { value: startedAt.toISOString() }, create: { key: LAST_KEY, value: startedAt.toISOString() }
    })
    last = { at: startedAt, full, checked: list.length, updated, disabled, enabled, ...teamResult }
    if (updated || teamResult.teams) console.log('[directory] 同步', JSON.stringify(last))
    return last
  } catch (e) {
    last = { at: startedAt, full, error: e.message }
    console.warn('[directory] 同步失败:', e.message)
    return last
  }
}
