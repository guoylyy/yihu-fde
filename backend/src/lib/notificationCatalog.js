// 站内通知目录与分档（v2.5.5 #912 精简通知体系）
//
// 每种通知类型归入三档之一, 档位决定「默认怎么送」:
//   MUST     必看   —— 默认即时送达。判据: 收件人需要在平台内做动作/决策(被指派、被 @、待审批、被打回、账号变更、生产事故)
//   OPTIONAL 可选   —— 默认关闭, 用户可按类型开启。判据: 只是进展告知, 不看也不影响工作(审批通过、已入驻、客户评价)
//   NOISE    噪音   —— 默认不单独送, 合并进每日一条「动态摘要」。判据: 角色群发的动态/统计/已下线模块的提醒, 逐条推没人看
//
// 用户偏好 users.notification_prefs: { [type]: { enabled?: boolean, site?: boolean, chat?: boolean, platform?: boolean } }
//   enabled=false 一律不送; enabled=true 强制即时送(覆盖档位默认); 不设则按档位默认。
//   site/chat/platform 是按通道开关(见 notify.js resolveChannels; 旧数据的 feishu 视同 chat, mail 视同 platform)。
// 未登记的类型: 默认按 MUST 即时送并打一条 warn, 保证新增/漏登类型不会被静默吞掉。

export const TIERS = {
  MUST: { code: 'MUST', label: '必看', defaultDelivery: 'on' },
  OPTIONAL: { code: 'OPTIONAL', label: '可选', defaultDelivery: 'off' },
  NOISE: { code: 'NOISE', label: '噪音', defaultDelivery: 'digest' }
}

export const DAILY_DIGEST_TYPE = 'DAILY_DIGEST'

// group: 设置页分组; label: 用户可读名; reason: 分档判据(写入清单文档)
const M = (label, group, reason) => ({ tier: 'MUST', label, group, reason })
const O = (label, group, reason) => ({ tier: 'OPTIONAL', label, group, reason })
const N = (label, group, reason) => ({ tier: 'NOISE', label, group, reason })

export const NOTIFICATION_CATALOG = {
  // ===== 任务 / 协作 =====
  TASK_ASSIGNED:        M('新任务分配给我', '任务协作', '被指派即要动手; 自己建任务派给自己不发(actorId 去重)'),
  MENTIONED:            M('评论中被 @', '任务协作', '点名找你, 需要回应'),
  IDEA_ADOPTED:         M('我的想法被采纳转为里程碑', '任务协作', '想法落地成了正式工作, 作者要知道去向'),   // v2.10.0(#1180)
  IDEA_COMMENTED:       N('我参与的想法有新讨论', '任务协作', '讨论往来频繁, 逐条推会刷屏; 被 @ 另走必看'),
  TASK_ACCEPTANCE:      M('任务验收打回 / 需人工终审', '任务协作', '打回要修, 终审要点头, 都是本人动作'),   // v2.8.5 验收下线后不再触发, 留档
  DEV_DISPATCH_DONE:    M('派工单全部完成', '任务协作', 'v2.9.0 机器人把一批活干完了, 该人验收/发布'),
  DEV_RUN_FAILED:       M('机器人执行任务失败', '任务协作', 'v2.9.0 机器人做不了, 需要人接手或重派'),
  MANUAL:               M('同事手动发给我的消息', '任务协作', '真人主动发的, 不做过滤'),
  TASK_STATUS_CHANGED:  N('我的任务完成 / 已验收', '任务协作', '结果告知, 自己置 DONE 时不发; 经理验收的合并进每日摘要即可'),
  PROJECT_MEMBER_ADDED: O('被加入项目', '任务协作', '一次性告知, 进项目后自然会看到, 默认关'),
  PROJECT_MEMBER_REMOVED: O('被移出项目', '任务协作', '一次性告知'),
  PROJECT_ROLE_CHANGED: O('项目内角色变更', '任务协作', '一次性告知'),
  PROJECT_STATUS_CHANGED: N('项目状态变更', '任务协作', '按角色群发的动态, 逐条推没人看, 进摘要'),
  DAILY_DIGEST:         M('每日动态摘要', '任务协作', '噪音类合并后的唯一出口, 每天最多一条'),
  // 通道矩阵里的旧别名(代码里已改用 *_CHANGED / MENTIONED, 登记只为不漏)
  PROJECT_STATUS:       N('项目状态变更(旧别名)', '任务协作', '同 PROJECT_STATUS_CHANGED, 进摘要'),
  COMMENT_MENTION:      M('评论中被 @(旧别名)', '任务协作', '同 MENTIONED'),
  COMMENT_REPLY:        O('评论被回复', '任务协作', '进展告知'),
  // ===== 工时(审批链) =====
  TIMESHEET_PENDING:    M('工时待我审批', '审批', '经理需要决策'),
  TIMESHEET_REJECTED:   M('我的工时被驳回', '审批', '要改要重提'),
  TIMESHEET_APPROVED:   N('我的工时已批准', '审批', '天天填天天批, 逐条推是最大噪音源之一, 进每日摘要'),
  // ===== 客户 / 交付 =====
  CUSTOMER_CREATED:     N('新客户创建', '客户交付', '群发动态, 进摘要'),
  // ===== 销售 =====
  SYSTEM:               M('系统 / 客户留言等综合提醒', '销售', '含客户对方案的留言、需求单提醒等需人跟进的事项, 保留'),
  system:               O('后台异常告警(如文件上传失败)', '系统', '仅管理员, 默认关, 排障时开'),
  // ===== 账号 / 人事 =====
  USER_INVITED:         M('欢迎加入 / 账号开通', '账号', '一次性, 含初始信息'),
  ROLE_CHANGED:         M('我的角色变更', '账号', '影响权限'),
  ACCOUNT_DISABLED:     M('账号被停用', '账号', '安全事件'),
  ENGINEER_APPLICATION: M('新的工程师申请待审核', '账号', '管理员要审核'),
  ENGINEER_JOINED:      O('我邀请的工程师已入驻', '账号', '进展告知'),
}

export const GROUP_ORDER = ['任务协作', '审批', '客户交付', '销售', '账号', '系统']

export function getCatalogEntry(type) {
  return NOTIFICATION_CATALOG[type] || null
}

export function getTier(type) {
  return getCatalogEntry(type)?.tier || null
}

/**
 * 决定一条通知怎么送: 'on' 即时 / 'off' 不送 / 'digest' 合并进每日摘要
 * @param {string} type
 * @param {object|null} userPrefs users.notification_prefs 解析后的对象
 */
export function resolveDelivery(type, userPrefs) {
  const pref = userPrefs?.[type]
  if (pref && typeof pref === 'object') {
    if (pref.enabled === false) return 'off'
    if (pref.enabled === true) return 'on'
  }
  const entry = getCatalogEntry(type)
  if (!entry) return 'on'
  return TIERS[entry.tier].defaultDelivery
}

/** 设置页用: 目录按分组展开, 带默认送达方式 */
export function listCatalogForSettings() {
  return Object.entries(NOTIFICATION_CATALOG).map(([type, e]) => ({
    type, label: e.label, group: e.group, tier: e.tier, tierLabel: TIERS[e.tier].label,
    defaultDelivery: TIERS[e.tier].defaultDelivery, reason: e.reason
  })).sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
}

/**
 * 校验并规范化用户提交的偏好: 只接受目录内类型, 只保留 enabled/site/chat/platform 四个布尔(feishu / mail 作为旧名照收)
 * @returns {{ prefs: object, rejected: string[] }}
 */
export function normalizePrefsInput(input, existing = null) {
  const base = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {}
  const rejected = []
  if (!input || typeof input !== 'object') return { prefs: base, rejected }
  for (const [type, v] of Object.entries(input)) {
    if (!NOTIFICATION_CATALOG[type]) { rejected.push(type); continue }
    if (v === null) { delete base[type]; continue }
    if (typeof v !== 'object') { rejected.push(type); continue }
    const next = { ...(base[type] || {}) }
    for (const k of ['enabled', 'site', 'chat', 'platform', 'feishu', 'mail']) {
      if (k in v) {
        const key = k === 'feishu' ? 'chat' : k
        if (typeof v[k] === 'boolean') next[key] = v[k]
        else if (v[k] === null) delete next[key]
        else rejected.push(`${type}.${k}`)
      }
    }
    if (Object.keys(next).length) base[type] = next
    else delete base[type]
  }
  return { prefs: base, rejected }
}
