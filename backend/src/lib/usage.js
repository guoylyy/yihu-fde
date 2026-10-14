// 使用数据上报到以虎 One(「管理 → 应用 → 使用数据」): 谁在用、用来干什么
// 一个中间件按「方法 + 路径」认出关键操作, 请求成功后入队; 每 3 秒批量发一次, 失败只打日志, 不影响业务。
// 经 MCP 调用(平台助手 / 个人 Agent)的带 via: 'ai'。只报动作和对象 id, 不报内容。
import prisma from './prisma.js'
import { postEvents, platformEnabled } from './yihuOne.js'

/** [方法, 路径正则(相对 /api/fde), 动作, 从请求取 detail] */
const ACTIONS = [
  ['POST', /^\/projects$/, 'project.create'],
  ['POST', /^\/projects\/(\d+)\/milestones$/, 'milestone.create', (m) => ({ projectId: m[1] })],
  ['POST', /^\/projects\/(\d+)\/(issues|risks)$/, 'project.report', (m) => ({ projectId: m[1], kind: m[2] })],
  ['POST', /^\/tasks$/, 'task.create'],
  ['POST', /^\/tasks\/(\d+)\/status$/, 'task.status', (m, req) => ({ taskId: m[1], status: req.body?.status })],
  ['POST', /^\/timesheets$/, 'timesheet.create'],
  ['POST', /^\/timesheets\/(\d+)\/submit$/, 'timesheet.submit'],
  ['POST', /^\/timesheets\/submit-batch$/, 'timesheet.submit'],
  ['POST', /^\/timesheets\/(\d+)\/approve$/, 'timesheet.approve', (m, req) => ({ approved: req.body?.approved !== false })],
  ['POST', /^\/dev-dispatches$/, 'dispatch.create'],
  ['POST', /^\/dev-dispatches\/runs\/(\d+)\/complete$/, 'dispatch.complete'],
  ['POST', /^\/ideas$/, 'idea.create'],
  ['POST', /^\/ideas\/(\d+)\/convert$/, 'idea.convert'],
  ['POST', /^\/knowledge$/, 'knowledge.create'],
  ['POST', /^\/assets$/, 'asset.propose'],
  ['POST', /^\/comments$/, 'comment.create']
]

/** 认出一次请求对应的动作(纯函数); 不是关键操作返回 null */
export function matchAction(method, path, body = {}) {
  for (const [m, re, action, detailOf] of ACTIONS) {
    if (m !== method) continue
    const hit = re.exec(path)
    if (hit) return { action, detail: detailOf ? detailOf(hit, { body }) : {} }
  }
  return null
}

const queue = []
const subjectCache = new Map()   // 本系统 userId → 平台用户 id(没绑定为 null)
let timer = null

async function platformIdOf(userId) {
  const k = String(userId)
  if (subjectCache.has(k)) return subjectCache.get(k)
  const u = await prisma.user.findUnique({ where: { id: BigInt(userId) }, select: { oidcSubject: true } }).catch(() => null)
  const id = u?.oidcSubject ? Number(u.oidcSubject) : null
  if (subjectCache.size > 5000) subjectCache.clear()
  subjectCache.set(k, id)
  return id
}

async function flush() {
  timer = null
  const batch = queue.splice(0, 200)
  if (!batch.length) return
  try {
    const r = await postEvents(batch)
    if (r?.rejected?.length) console.warn('[usage] 平台拒收', r.rejected.length, '条:', r.rejected[0]?.reason)
  } catch (e) {
    console.warn('[usage] 上报失败:', e.message)
  }
  if (queue.length) timer = setTimeout(flush, 3000)
}

/** 记一条使用数据(异步, 不抛) */
export async function track(userId, action, detail = {}) {
  if (!platformEnabled() || !userId) return
  const uid = await platformIdOf(userId)
  if (!uid) return
  queue.push({ userId: uid, action, detail, at: new Date().toISOString() })
  if (queue.length > 2000) queue.splice(0, queue.length - 2000)
  if (!timer) timer = setTimeout(flush, 3000)
}

/** 挂在 /api/fde 上: 写请求成功(2xx 且业务 code=0)后按动作表上报 */
export function usageMiddleware(req, res, next) {
  if (req.method === 'GET' || !platformEnabled()) return next()
  const hit = matchAction(req.method, req.path, req.body)
  if (!hit) return next()
  const json = res.json.bind(res)
  res.json = (payload) => {
    if (res.statusCode < 400 && (payload?.code === undefined || payload.code === 0) && req.user?.userId) {
      const detail = { ...hit.detail, ...(req.user.via === 'mcp' ? { via: 'ai' } : {}) }
      track(req.user.userId, hit.action, detail).catch(() => {})
    }
    return json(payload)
  }
  next()
}
