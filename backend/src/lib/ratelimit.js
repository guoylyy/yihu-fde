// 简易限频中间件（内存版, 适合单机/单进程）
// 用法: app.post('/api/public/leads', rateLimit({ keyByIp: true, ipLimit: {count:3,windowMs:3600000} }), handler)
// 生产应换 Redis; 当前开发阶段够用

const buckets = new Map() // key -> { count, resetAt }

function gc() {
  // 定期清理 (这里 on-demand)
  const now = Date.now()
  for (const [k, v] of buckets.entries()) {
    if (v.resetAt <= now) buckets.delete(k)
  }
}

function getIp(req) {
  return (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.socket?.remoteAddress
    || req.ip
    || 'unknown').replace(/^::ffff:/, '')
}

/**
 * 限频中间件
 * @param {object} rules
 * @param {boolean} [rules.keyByIp=false]
 * @param {{count:number, windowMs:number}} [rules.ipLimit]
 * @param {function} [rules.keyFn] 自定义 key (req) => string
 * @param {string} [rules.field='body'] 取值字段名, 用于 phone/email 这类
 * @param {{count:number, windowMs:number}} [rules.fieldLimit]
 * @param {string} [rules.scope=''] 计数桶命名空间 (v1.5.0)
 *
 * v1.5.0: 原先桶 key 只有 `ip:xxx`, 所有公开接口共用一个计数器 —— 高频接口
 * (分享页埋点 120次/h) 会把严格接口 (留资表单 5次/h) 的额度提前吃光。
 * 传 scope 即可各算各的; 不传保持原行为, 老调用点不受影响。
 */
// 限流是内存态、按 IP 计数, 跨测试轮次不重置 —— 集成测试反复打同一个后端进程必然撞满。
// 置 RATELIMIT_RELAX=true 时把所有额度放大 100 倍(仅供本地跑测试, 生产绝不要开)。
// 启动时显式打日志, 免得有人开了不自知。
const RELAX = process.env.RATELIMIT_RELAX === 'true'
if (RELAX) console.warn('[ratelimit] ⚠️ RATELIMIT_RELAX=true, 所有公开接口限流额度 ×100 (仅限测试环境)')
const relaxed = (limit) => (RELAX ? { ...limit, count: limit.count * 100 } : limit)

export function rateLimit(rules = {}) {
  const ns = rules.scope ? `${rules.scope}:` : ''
  return (req, res, next) => {
    gc()
    const checks = []

    if (rules.keyByIp && rules.ipLimit) {
      const ip = getIp(req)
      checks.push({ key: `${ns}ip:${ip}`, limit: relaxed(rules.ipLimit) })
    }
    if (rules.fieldLimit && rules.field) {
      const val = (req.body?.[rules.field] || '').toString().trim()
      if (val) checks.push({ key: `${ns}${rules.field}:${val}`, limit: relaxed(rules.fieldLimit) })
    }
    if (rules.keyFn && rules.limit) {
      checks.push({ key: rules.keyFn(req), limit: relaxed(rules.limit) })
    }

    for (const c of checks) {
      const now = Date.now()
      let b = buckets.get(c.key)
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + c.limit.windowMs }
        buckets.set(c.key, b)
      }
      b.count++
      if (b.count > c.limit.count) {
        return res.status(429).json({
          code: 9029,
          message: `请求太频繁, 请稍后再试 (已超 ${c.limit.count} 次 / ${Math.round(c.limit.windowMs/1000)}s)`
        })
      }
    }
    next()
  }
}

// 测试用
export function _reset() { buckets.clear() }
