// 「我的今日」页的纯逻辑(取数在页面里, 这里只做挑选/排序/状态推导, 便于单测)

/** 进今日页的任务状态: 还没做完的都算(返工/排队也是该我动手的事) */
export const OPEN_STATUSES = ['TODO', 'QUEUED', 'IN_PROGRESS', 'REWORK']
const HOT_PRIORITIES = ['HIGH', 'URGENT']

/** 本地日期 YYYY-MM-DD(不用 toISOString, 免得东八区凌晨算成昨天) */
export function ymd(d = new Date()) {
  const x = new Date(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}

/** dueDate 可能是 '2026-11-18' 或 ISO 时间; 统一取日期部分 */
export function dueDay(task) {
  return task?.dueDate ? String(task.dueDate).slice(0, 10) : null
}

/** 'overdue' | 'today' | 'soon'(3 天内) | '' */
export function dueState(task, today = ymd()) {
  const d = dueDay(task)
  if (!d) return ''
  if (d < today) return 'overdue'
  if (d === today) return 'today'
  if (d <= addDays(today, 3)) return 'soon'
  return ''
}

/**
 * 今日页「我的任务」: 未完成 且 (到期日 ≤ 今天+3 天 或 高优), 按到期日排(没到期日的高优垫底), 最多 limit 条
 */
export function pickTodayTasks(tasks, { today = ymd(), horizonDays = 3, limit = 6 } = {}) {
  const horizon = addDays(today, horizonDays)
  return (tasks || [])
    .filter(t => OPEN_STATUSES.includes(t.status))
    .filter(t => {
      const d = dueDay(t)
      return (d && d <= horizon) || HOT_PRIORITIES.includes(t.priority)
    })
    .sort((a, b) => {
      const da = dueDay(a) || '9999-99-99'
      const db = dueDay(b) || '9999-99-99'
      if (da !== db) return da < db ? -1 : 1
      return (HOT_PRIORITIES.includes(b.priority) ? 1 : 0) - (HOT_PRIORITIES.includes(a.priority) ? 1 : 0)
    })
    .slice(0, limit)
}

/**
 * 本周 OKR 提交状态(/api/okr/my 的返回):
 *   'ON_TIME' 已交 | 'LATE' 迟交 | 'PENDING' 未交(还没过截止) | 'OVERDUE' 未交且已过截止 | null 没有周期
 */
export function okrSubmitState(week) {
  if (!week?.cycle) return null
  const live = (week.objectives || []).filter(o => o.status !== 'DROPPED')
  const submitted = live.length > 0 && live.every(o => o.submittedAt)
  if (!submitted) return week.cycle.deadlinePassed ? 'OVERDUE' : 'PENDING'
  return live.some(o => o.lateSubmit) ? 'LATE' : 'ON_TIME'
}

/** 0–1 或 0–100 的进度统一成 0–100 的整数 */
export function pct100(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)))
}

/** 摘要首句: 到第一个句末标点或换行为止, 太长截断 */
export function firstSentence(text, max = 60) {
  // 规则摘要常以列表开头(「1. 」「- 」「## 」), 先去掉行首标记, 否则首句只剩一个「1.」
  const s = String(text || '').trim().replace(/^(?:[-*•>#]+\s*|\d+(?:[.)]\s+|、\s*))/, '')
  if (!s) return ''
  const m = s.match(/^[^\n。！？!?]*[。！？!?]?/)
  let out = (m ? m[0] : s).trim()
  // 英文句号只在后面跟空白时算句末, 免得把 v1.2、file.js 拦腰截断
  const dot = out.search(/\.\s/)
  if (dot > 0) out = out.slice(0, dot + 1)
  return out.length > max ? out.slice(0, max - 1) + '…' : out
}
