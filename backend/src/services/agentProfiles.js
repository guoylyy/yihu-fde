// v2.13.0(#1277) 机器人档案生命周期: 状态字典 / 校验 / 僵尸阈值
// 三态语义(唯一权威定义, 路由与前端字典都从这里派生):
//   1  在用     — 正常可用, Key 有效
//   0  已禁用   — 可恢复的停用(disable→enable), Key 立即失效
//   -1 已注销   — 终态(deregister), 不再出现在任何列表, 历史记录保留
import prisma from '../lib/prisma.js'

export const AGENT_STATUS = {
  ACTIVE: 1,
  DISABLED: 0,
  DEREGISTERED: -1
}

export const AGENT_STATUS_LABELS = {
  [AGENT_STATUS.ACTIVE]: '在用',
  [AGENT_STATUS.DISABLED]: '已禁用',
  [AGENT_STATUS.DEREGISTERED]: '已注销'
}

/**
 * #1280 被禁/注销档案的调用拒绝: 三大机器人入口(report_presence / claim_dev_run /
 * report_dev_run_progress)先过这道闸。返回 null=放行; 否则返回拒绝响应体
 * (code 9030, 文案明确告知停手不重试)。
 * 注: Agent 专属 Key 在 resolveApiKey 已被 401 挡住, 这里兜的是
 * 用户 Token 透传路径(默认档案被禁时透传仍能进系统)与未来的内部调用。
 */
export async function agentDisabledRejection(agentProfileId) {
  if (!agentProfileId) return null
  let id
  try { id = BigInt(agentProfileId) } catch { return null }
  const p = await prisma.agentProfile.findUnique({ where: { id }, select: { status: true, name: true } })
  if (!p || p.status === AGENT_STATUS.ACTIVE) return null
  const what = p.status === AGENT_STATUS.DEREGISTERED ? '已注销' : '已被管理员或主人禁用'
  return {
    status: 403,
    body: {
      code: 9030,
      message: `机器人档案「${p.name}」${what}，调用被拒绝。请立即停止本轮工作并退出，不要重试（恢复需主人或管理员在平台上重新启用）。`
    }
  }
}

/**
 * #1280 生命周期动作审计写入。fire-and-forget 用法: writeAgentAudit({...}).catch(()=>{})
 */
export async function writeAgentAudit({ agentProfileId, profileName, action, operatorId, operatorName, reason }) {
  return prisma.agentProfileAudit.create({
    data: {
      agentProfileId: BigInt(agentProfileId),
      profileName: String(profileName || '').slice(0, 100),
      action,
      operatorId: BigInt(operatorId),
      operatorName: String(operatorName || '').slice(0, 50),
      reason: reason ? String(reason).slice(0, 500) : null
    }
  })
}

/** 校验 status 取值合法(写接口用) */
export function isValidAgentStatus(v) {
  return Object.values(AGENT_STATUS).includes(Number(v))
}

const ZOMBIE_THRESHOLD_KEY = 'agent.zombieThresholdDays'
const DEFAULT_ZOMBIE_THRESHOLD_DAYS = 30

/**
 * 僵尸判定阈值(天): app_settings 可覆盖, 缺省 30。
 * 读取失败(表不存在/连接抖动)回落默认值, 不阻塞调用方。
 */
export async function getZombieThresholdDays() {
  const row = await prisma.appSetting.findUnique({ where: { key: ZOMBIE_THRESHOLD_KEY } }).catch(() => null)
  const n = row ? parseInt(row.value, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ZOMBIE_THRESHOLD_DAYS
}

/**
 * 单档案僵尸判定: lastActiveAt 距今超过阈值天数(从未活跃的按 createdAt 起算)。
 * 注销档不判僵尸(终态另有标签)。
 */
export function isZombie(profile, thresholdDays) {
  if (!profile || profile.status === AGENT_STATUS.DEREGISTERED) return false
  const base = profile.lastActiveAt || profile.createdAt
  if (!base) return false
  return Date.now() - new Date(base).getTime() > thresholdDays * 86400000
}
