// AI 助手的日期口语解析: 模型和用户给的日期常是「下周三」「周五前」「11/20」「明天」, 统一换成 YYYY-MM-DD
//
// 时区: 业务按北京时间(UTC+8, 无夏令时)算「今天」「本周」, 与周 OKR(services/okrRules.js)同一口径, 不依赖运行机器的 TZ。
// 内部把「某一天」表示成该日 UTC 零点的 Date, 加减天数、取星期都用 UTC 方法, 所以和机器时区无关。
// 纯函数; 周一为一周第一天。认不出返回 null(由草稿标成「待补充」, 不瞎猜)

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 某个时刻在北京时间是哪一天 → 该日 UTC 零点的 Date(传入已是「某一天」的 Date 也不变) */
export function businessDay(at = new Date()) {
  const wall = new Date(new Date(at).getTime() + TZ_OFFSET_MS)
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()))
}

/** 「某一天」→ 'YYYY-MM-DD' */
export const fmt = (d) => new Date(d).toISOString().slice(0, 10)
/** 数据库里的 DATE 列(截止日、工作日期)→ 'YYYY-MM-DD'; 空返回 null */
export const dbDay = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null)
/** 时间戳(完成时间等)按北京时间落在哪天 → 'YYYY-MM-DD' */
export const tsDay = (v) => (v ? fmt(businessDay(v)) : null)

const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS)
const fromStr = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }

/** 所在周的周一 */
export function mondayOf(d) {
  const x = businessDay(d)
  return addDays(x, -((x.getUTCDay() + 6) % 7))
}

/** 某周的 [周一, 周日]; offset=0 本周, -1 上周, 1 下周 */
export function weekRange(today = new Date(), offset = 0) {
  const mon = addDays(mondayOf(today), offset * 7)
  return { from: fmt(mon), to: fmt(addDays(mon, 6)) }
}

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 }
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function validDate(y, m, d) {
  const x = new Date(Date.UTC(y, m - 1, d))
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : null
}

/**
 * 口语日期 → 'YYYY-MM-DD' | null
 * 认: 2026-11-20 / 2026/11/20 / 11-20 / 11/20 / 11月20日(号) / 20号 / 今天 明天 后天 大后天 昨天 /
 *     周五 星期五 礼拜五(本周那天) / 这周五 本周五 / 下周三 下下周一 / 上周五 / 本周 下周(取周五) / 周末 / 月底 下月底 / 3天后
 * 「周五前」「周五之前」「下周三截止」「明天下午」这类后缀忽略
 */
export function parseDate(input, today = new Date()) {
  if (input == null) return null
  let s = String(input).trim()
  if (!s) return null
  s = s.replace(/[（(].*?[)）]/g, '').replace(/(之前|以前|前|截止|为止|之内|内|当天|下班前|中午|上午|下午|晚上)$/, '').trim()
  const base = businessDay(today)
  let m

  if ((m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/))) {
    const d = validDate(+m[1], +m[2], +m[3]); return d ? fmt(d) : null
  }
  if ((m = s.match(/^(\d{1,2})[-/.月](\d{1,2})[日号]?$/))) {
    // 没写年: 取今年; 已经过去超过 60 天的当成明年(12 月说「1/5」指明年)
    let y = base.getUTCFullYear()
    let d = validDate(y, +m[1], +m[2])
    if (d && (base - d) / DAY_MS > 60) d = validDate(++y, +m[1], +m[2])
    return d ? fmt(d) : null
  }
  if ((m = s.match(/^(\d{1,2})[日号]$/))) {
    let d = validDate(base.getUTCFullYear(), base.getUTCMonth() + 1, +m[1])
    if (d && d < base) d = validDate(base.getUTCFullYear() + (base.getUTCMonth() === 11 ? 1 : 0), (base.getUTCMonth() + 1) % 12 + 1, +m[1])
    return d ? fmt(d) : null
  }
  const rel = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3, 昨天: -1, 前天: -2 }
  if (s in rel) return fmt(addDays(base, rel[s]))
  if ((m = s.match(/^([0-9一二两三四五六七八九十]+)\s*天[以之]?后$/))) {
    const n = /^\d+$/.test(m[1]) ? +m[1] : CN_NUM[m[1]]
    return n ? fmt(addDays(base, n)) : null
  }
  if (/^(本|这个?)?月(底|末)$/.test(s)) return fmt(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)))
  if (/^下个?月(底|末)$/.test(s)) return fmt(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 2, 0)))
  if ((m = s.match(/^(下下|下|上|这|本)?\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])$/))) {
    const offset = { 下下: 2, 下: 1, 上: -1, 这: 0, 本: 0 }[m[1] || '本']
    return fmt(addDays(mondayOf(base), offset * 7 + WEEKDAY[m[2]] - 1))
  }
  // 「这周」「下周」当截止日 = 那周周五; 「周末」= 周日
  if ((m = s.match(/^(本|这|下)?\s*(?:个)?\s*(周|星期|礼拜)(末)?$/))) {
    const offset = m[1] === '下' ? 1 : 0
    return fmt(addDays(mondayOf(base), offset * 7 + (m[3] ? 6 : 4)))
  }
  return null
}

/** 「这周」「本周」「下周」「上周」「2026-11-16」→ 周区间; 认不出用本周 */
export function parseWeek(input, today = new Date()) {
  const s = String(input || '').trim()
  if (!s || /^(本|这)(个)?(周|星期|礼拜)$/.test(s) || s === 'this_week') return weekRange(today, 0)
  if (/^上(个)?(周|星期|礼拜)$/.test(s) || s === 'last_week') return weekRange(today, -1)
  if (/^下(个)?(周|星期|礼拜)$/.test(s) || s === 'next_week') return weekRange(today, 1)
  const d = parseDate(s, today)
  return weekRange(d ? fromStr(d) : today, 0)
}

/** 星期几(一~日) */
export const weekdayCn = (d) => '日一二三四五六'[businessDay(d).getUTCDay()]
