// 0.5.0 团队负载口径(纯函数, 便于单测)

/** 「手上的活」: 还没做完的任务状态 */
export const OPEN_TASK_STATUSES = ['TODO', 'QUEUED', 'IN_PROGRESS', 'REWORK']

/**
 * 负载档位: IDLE 空闲 / NORMAL 正常 / BUSY 偏满 / OVERLOAD 过载
 * 规则(简单可解释, 第 4 轮再按组长反馈调):
 *   - 逾期 ≥3 或 未完成 ≥12 → OVERLOAD
 *   - 逾期 ≥1 或 未完成 ≥7 或 7 天内到期 ≥4 → BUSY
 *   - 未完成 = 0 → IDLE
 *   - 其余 NORMAL
 */
export function loadLevel({ open = 0, overdue = 0, dueSoon = 0 } = {}) {
  if (overdue >= 3 || open >= 12) return 'OVERLOAD'
  if (overdue >= 1 || open >= 7 || dueSoon >= 4) return 'BUSY'
  if (open === 0) return 'IDLE'
  return 'NORMAL'
}

// ---------------------------------------------------------------- 0.5.0 R4 团队四屏

/** 负载阈值: 手上 5 个未完成任务 = 100% */
export const LOAD_THRESHOLD = 5

/** 负载百分比 = 未完成任务数 / 阈值 × 100(取整) */
export function loadPct(activeTaskCount, threshold = LOAD_THRESHOLD) {
  return Math.round((Number(activeTaskCount) || 0) / threshold * 100)
}

/** 负载档位: ≥150 OVER / ≥100 WARN / 其余 OK */
export function loadBand(pct) {
  if (pct >= 150) return 'OVER'
  if (pct >= 100) return 'WARN'
  return 'OK'
}

/**
 * 承诺 vs 实际的提示标记(只做提示, 不打分不排名)
 *   DRIFT      会话 ≥3 且本周完成任务 = 0(一直在聊, 没落地)
 *   ONLY_WORDS 有 OKR 承诺但本周完成任务 = 0
 *   ELSEWHERE  手上有任务但本周 0 条开发会话(活可能在别处干)
 * 一个人可能同时命中多条: flags 全给, flag 取第一条。DRIFT 排最前 ——
 * 人人每周都交 OKR, 若按 ONLY_WORDS 优先, DRIFT 就几乎不可能出现。
 */
export function promiseFlags({ objectiveCount = 0, completedTasks = 0, activeTaskCount = 0, conversationCount = 0 } = {}) {
  const flags = []
  if (conversationCount >= 3 && completedTasks === 0) flags.push('DRIFT')
  if (objectiveCount > 0 && completedTasks === 0) flags.push('ONLY_WORDS')
  if (activeTaskCount + completedTasks > 0 && conversationCount === 0) flags.push('ELSEWHERE')
  return flags
}

/**
 * 从会话 tags / 标题里找出现过的技能名(只认技能主数据里有的名字, 不凭空造技能)。
 * 英文/数字技能名按单词边界匹配(避免 "Go" 命中 "Google"), 其余(中文等)按子串。
 * @param {{tags?:any, title?:string|null}} conv
 * @param {Array<{id:any, name:string}>} skills
 * @returns {Set<string>} 命中的 skillId(字符串)
 */
export function skillsMentioned(conv, skills) {
  const tags = (Array.isArray(conv?.tags) ? conv.tags : []).map(t => String(t).trim().toLowerCase())
  const title = String(conv?.title || '').toLowerCase()
  const hit = new Set()
  for (const s of skills) {
    const name = String(s.name || '').trim().toLowerCase()
    if (!name) continue
    if (tags.includes(name)) { hit.add(String(s.id)); continue }
    if (!title) continue
    if (/^[\x20-\x7e]+$/.test(name)) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(title)) hit.add(String(s.id))
    } else if (title.includes(name)) {
      hit.add(String(s.id))
    }
  }
  return hit
}
