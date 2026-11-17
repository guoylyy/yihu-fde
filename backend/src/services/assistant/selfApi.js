// AI 助手的「工具即接口」: 工具内部一律以当前用户身份调本系统自己的 REST 接口, 权限与数据范围由接口层收敛, 不另开后门。
// 用的 token 是按当前登录态现签的短期 token: 身份、角色与用户本人完全相同, 只多一个 via: 'ai'(使用数据上报据此标 AI 来源)
import { signToken } from '../../lib/auth.js'

const SELF_BASE = () => `http://127.0.0.1:${process.env.PORT || 3005}`

/** 当前用户的 AI 调用凭证(10 分钟有效, 一次对话 / 一次确认内用完) */
export function aiToken(user) {
  return signToken({
    type: 'internal',
    userId: user.userId ?? user.id,
    username: user.username,
    role: user.role,
    engineerId: user.engineerId,
    via: 'ai'
  }, '10m')
}

/**
 * 造一个绑定当前用户的接口调用器: api(method, path, { query, body }) → { status, code, message, data }
 * 不抛业务错误(由调用方按 code 判断), 只在网络异常时抛
 */
export function makeSelfApi(user) {
  const token = aiToken(user)
  return async function api(method, path, { query, body } = {}) {
    const url = new URL(path, SELF_BASE())
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = { code: 9001, message: `HTTP ${res.status}: ${text.slice(0, 200)}` } }
    return { status: res.status, code: json.code, message: json.message, data: json.data }
  }
}
