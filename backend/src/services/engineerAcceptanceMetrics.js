// First-pass metrics use each task's earliest non-shadow attempt across its history.
// Filtering to the reporting window before deduplication would misclassify retries.
export function engineerAcceptanceMetrics(records, from, through) {
  const start = from.getTime()
  const end = through.getTime()
  const first = new Map()
  const period = []
  for (const record of records) {
    if (record.shadow) continue
    const time = new Date(record.createdAt).getTime()
    if (!Number.isFinite(time) || time > end) continue
    const key = String(record.taskId)
    const previous = first.get(key)
    if (!previous || time < previous.time || (time === previous.time && BigInt(record.id) < BigInt(previous.record.id))) {
      first.set(key, { time, record })
    }
    if (time >= start) period.push(record)
  }
  const firstInPeriod = [...first.values()].filter(item => item.time >= start)
  const firstPass = firstInPeriod.filter(item => item.record.conclusion === 'PASS').length
  const midpoint = start + (end - start) / 2
  const rate = list => list.length ? Math.round(list.filter(item => item.record.conclusion === 'PASS').length / list.length * 1000) / 10 : null
  const earlier = firstInPeriod.filter(item => item.time < midpoint)
  const recent = firstInPeriod.filter(item => item.time >= midpoint)
  const earlierRate = rate(earlier); const recentRate = rate(recent)
  return {
    total: period.length,
    pass: period.filter(record => record.conclusion === 'PASS').length,
    firstTotal: firstInPeriod.length,
    firstPass,
    firstPassRate: firstInPeriod.length ? Math.round(firstPass / firstInPeriod.length * 1000) / 10 : null,
    trend: { earlierRate, recentRate, delta: earlierRate != null && recentRate != null ? Math.round((recentRate - earlierRate) * 10) / 10 : null }
  }
}
