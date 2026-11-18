// 0.5.0 团队四屏共用的纯逻辑(取数在页面里, 这里只做口径/格式/矩阵整形, 便于单测)

/** engineer.skills 存量里有字符串也有 { name, level } 对象 */
export function skillName(s) {
  if (typeof s === 'string') return s
  return s?.name || s?.skill || ''
}

// ---------------------------------------------------------------- 负载

/** 与后端 lib/teamLoad.js 同口径: 手上 5 个未完成任务 = 100%; ≥100 偏满(黄), ≥150 过载(红) */
export const LOAD_THRESHOLD = 5
export const LOAD_WARN_PCT = 100
export const LOAD_OVER_PCT = 150

/** 'OK' | 'WARN' | 'OVER'(与后端 loadBand 一致) */
export function loadBand(pct) {
  const n = Number(pct) || 0
  if (n >= LOAD_OVER_PCT) return 'OVER'
  if (n >= LOAD_WARN_PCT) return 'WARN'
  return 'OK'
}

/** 档位色: 绿 / 黄 / 红 */
export const LOAD_BAND_COLOR = { OK: '#2e7d4f', WARN: '#d99a1e', OVER: '#c2362b' }
export const loadColor = (pct) => LOAD_BAND_COLOR[loadBand(pct)]

/** 进度条长度: 封顶 100(超出的部分靠颜色和数字表达) */
export const loadBarPct = (pct) => Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))

// ---------------------------------------------------------------- 卡片

/** 前 n 个 + 剩余个数(技能标签「最多 3 个 +N」、承诺「最多 2 条」) */
export function takeTop(list, n) {
  const arr = Array.isArray(list) ? list : []
  return { shown: arr.slice(0, n), rest: Math.max(0, arr.length - n) }
}

/**
 * 相对时间: { unit: 'none'|'just'|'minutes'|'hours'|'days'|'date', n?, date? }
 * 页面按 unit 拿文案(「3 小时前」); 超过 30 天直接给日期
 */
export function relativeTime(at, now = Date.now()) {
  if (!at) return { unit: 'none' }
  const t = new Date(at).getTime()
  if (!Number.isFinite(t)) return { unit: 'none' }
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return { unit: 'just' }
  if (sec < 3600) return { unit: 'minutes', n: Math.floor(sec / 60) }
  if (sec < 86400) return { unit: 'hours', n: Math.floor(sec / 3600) }
  if (sec < 30 * 86400) return { unit: 'days', n: Math.floor(sec / 86400) }
  return { unit: 'date', date: ymdLocal(new Date(t)) }
}

// ---------------------------------------------------------------- 周切换

const pad = (n) => String(n).padStart(2, '0')
function ymdLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/** 'YYYY-MM-DD' 前后挪 n 周; 不传起点就是今天 */
export function shiftWeek(dateStr, n) {
  const base = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date()
  base.setDate(base.getDate() + n * 7)
  return ymdLocal(base)
}

/** 后端 meta.week 的起止(上海时区的周一 0 点 ~ 周日 24 点) → '11/16–11/22' */
export function weekRangeText(week) {
  if (!week?.start || !week?.end) return ''
  const md = (iso) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).formatToParts(new Date(iso))
    const get = (t) => parts.find(p => p.type === t)?.value
    return `${get('month')}/${get('day')}`
  }
  return `${md(week.start)}–${md(week.end)}`
}

// ---------------------------------------------------------------- 承诺 vs 实际

/** 标记 → 色调(只做提示, 不打分不排名): 只在嘴上=黄, 可能在别处干=灰, 方向漂移=红 */
export const PROMISE_FLAG_TONE = { ONLY_WORDS: 'warning', ELSEWHERE: 'info', DRIFT: 'danger' }
export const PROMISE_FLAGS = Object.keys(PROMISE_FLAG_TONE)

/** 行上要显示的标记: flags 优先, 兼容只给 flag 的老返回; 未知标记丢掉 */
export function promiseFlagsOf(row) {
  const list = Array.isArray(row?.flags) && row.flags.length ? row.flags : (row?.flag ? [row.flag] : [])
  return [...new Set(list)].filter(f => PROMISE_FLAG_TONE[f])
}

export const totalWeight = (objectives) => (objectives || []).reduce((s, o) => s + (Number(o.weight) || 0), 0)

// ---------------------------------------------------------------- 能力矩阵

/**
 * /api/team/skills → 行=技能, 列=人
 * @returns {Array<{ skill:{id,name}, cells: Array<null|{level, source, candidate, hits}>, holders:number, candidates:number, singlePoint:boolean }>}
 *   holders = 人工标注且 level>0 的人数; singlePoint 以后端 singlePoints 为准, 后端没给时按 holders===1 兜底
 */
export function buildSkillMatrix(payload) {
  const skills = payload?.skills || []
  const members = payload?.members || []
  const cells = payload?.cells || []
  const sp = Array.isArray(payload?.singlePoints) ? new Set(payload.singlePoints.map(String)) : null
  const at = new Map(cells.map(c => [`${c.skillId}:${c.engineerId}`, c]))
  return skills.map(skill => {
    const row = members.map(m => at.get(`${skill.id}:${m.engineerId}`) || null)
    const holders = row.filter(c => c && c.source === 'MANUAL' && c.level > 0).length
    const candidates = row.filter(c => c && c.source === 'DERIVED').length
    return { skill, cells: row, holders, candidates, singlePoint: sp ? sp.has(String(skill.id)) : holders === 1 }
  })
}

/** 1–5 级 → 5 个点(true 实心) */
export function levelDots(level) {
  const n = Math.max(0, Math.min(5, Number(level) || 0))
  return [1, 2, 3, 4, 5].map(i => i <= n)
}
