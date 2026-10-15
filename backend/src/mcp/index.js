// MCP Server (Streamable HTTP, 无状态模式) — FDE 工程师智能体对接入口
// 鉴权 (Authorization: Bearer xxx 或 X-API-Key), 凭证任选:
//   ① 以虎 One 转发的 access_token → 平台 AI 助手 / 用户的以虎 One 个人 API Key 经平台 MCP 网关调用(主要入口)
//   ② Agent 专属 Key (fde_ 前缀, 旧版 yhk_; 老的个人 Key 也照常认) → Key 绑定的用户 + Agent 身份
//   ③ 本系统登录 JWT (Agent 平台透传模式) → Token 里的用户身份
// 工具实现: 内部签发短期 JWT, 回调本机 REST API, 完全复用角色权限与数据范围逻辑
import express from 'express'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { signToken } from '../lib/auth.js'
import { mcpAuth } from '../lib/apiKey.js'
import { TOOLS } from './tools.js'
import { standardTools } from './standardTools.js'
import prisma from '../lib/prisma.js'
import { APP_VERSION } from '../lib/version.js'

const SELF_BASE = () => `http://127.0.0.1:${process.env.PORT || 3005}`

/** 以指定用户身份调用本机 REST API */
async function callApi(user, { method, path, query, body }) {
  const token = signToken({
    type: 'internal',
    userId: user.userId,
    username: user.username,
    role: user.role,
    engineerId: user.engineerId,
    // v1.6.0: Agent 专属 Key 进来的调用带上 Agent 身份, 业务层写入时记归属
    agentProfileId: user.agentProfileId,
    // 经 MCP 来的调用: 使用数据上报时标 via=ai
    via: 'mcp'
  })
  const url = new URL(path, SELF_BASE())
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { httpStatus: res.status, ...json }
}

/** 以 multipart 形式把文件 POST 到本机某个上传端点, 返回响应 JSON */
async function postMultipart(user, path, { fileBase64, fileUrl, fileName }) {
  let buffer
  if (fileBase64) {
    buffer = Buffer.from(fileBase64, 'base64')
  } else if (fileUrl) {
    const r = await fetch(fileUrl)
    if (!r.ok) throw new Error(`下载源文件失败: HTTP ${r.status}`)
    buffer = Buffer.from(await r.arrayBuffer())
  } else {
    throw new Error('fileBase64 与 fileUrl 至少提供一个')
  }
  const token = signToken({
    type: 'internal',
    userId: user.userId,
    username: user.username,
    role: user.role,
    engineerId: user.engineerId,
    agentProfileId: user.agentProfileId
  })
  const form = new FormData()
  form.append('file', new Blob([buffer]), fileName || 'upload.bin')
  const res = await fetch(new URL(path, SELF_BASE()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  })
  const text = await res.text()
  try { return { httpStatus: res.status, ...JSON.parse(text) } } catch { return { httpStatus: res.status, raw: text } }
}

/**
 * v1.6.0 Agent 活动审计: 注册 Agent(专属 Key)的成功调用逐条留痕
 * 一张表通吃, 异步写不阻塞; 目录页活跃度/流水的数据源
 */
function logAgentActivity(user, action, built, data) {
  if (!user.agentProfileId) return
  if (data.httpStatus >= 400 || (data.code !== undefined && data.code !== 0)) return
  const entityType = /^\/api\/fde\/([a-z-]+)/.exec(built?.path || '')?.[1] || null
  const rawId = data?.data?.id
  const entityId = rawId != null && /^\d+$/.test(String(rawId)) ? BigInt(rawId) : null
  prisma.agentActivityLog.create({
    data: { agentProfileId: BigInt(user.agentProfileId), action, entityType, entityId }
  }).catch(() => {})
}

/** card: 首页卡片工具, 成功时把 data 作为 structuredContent 返回(以虎 One 的数据卡片直接用它) */
function toToolResult(data, { card = false } = {}) {
  const isError = data.httpStatus >= 400 || (data.code !== undefined && data.code !== 0)
  if (card && !isError && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    return { content: [{ type: 'text', text: JSON.stringify(data.data) }], structuredContent: data.data }
  }
  let text = JSON.stringify(data, null, 2)
  if (isError && data.httpStatus === 403) {
    text += '\n\n提示: 403 表示该操作超出工程师权限（通常需要项目经理/管理员），不要重试，向用户解释并建议转交对应角色。'
  }
  return { content: [{ type: 'text', text }], isError }
}

/** 为一次请求构建 McpServer（无状态: 每请求新实例, 工具闭包携带用户身份） */
function buildServer(user) {
  const server = new McpServer(
    { name: 'fde-platform', version: APP_VERSION },
    { instructions: [
      'FDE 平台工具集。当前已绑定用户身份（经以虎 One、Agent 专属 Key 或用户 Token），所有操作以该用户身份执行，数据范围与权限完全按其角色收敛（工程师只看得到自己/自己参与的项目，经理能看到名下项目全量）。',
      '使用约定:',
      '① 会话开始先调 get_my_workbench 获取 engineerId、userId 与项目列表, 后面所有 id 参数都从这里或 list_* 工具解析, 不要凭猜。',
      '② 涉及工时/日期的写操作, 先把要写的内容复述给用户确认再调。',
      '③ delete_* 这些是不可逆的动作, 必须拿到用户明确确认才调, 不要顺手执行。',
      '④ 403 不要重试, 向用户说明这一步需要什么角色(经理/管理员), 请其转交。',
      '⑤ 对外通道(邮件/群通知)一律不由智能体触发; send_notification 只进站内信箱, 不会外发。',
      '⑥ 日期一律 YYYY-MM-DD。',
      '⑦ 干完活把过程沉淀回系统(v1.6.0 Agent 协作): 与用户围绕某项目的重要对话用 log_agent_conversation 回传; 调研结论用 add_research_note 归档; 客户聊天记录/会议沟通用 add_project_record(类型 CHAT/MEETING/COMM)。'
    ].join('\n') }
  )

  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.schema, annotations: annotationsOf(def) },
      async (args) => {
        try {
          const built = def.build(args || {})
          const data = await callApi(user, built)
          logAgentActivity(user, def.name, built, data)
          return toToolResult(data, { card: def.card })
        } catch (e) {
          return { content: [{ type: 'text', text: `工具执行失败: ${e.message}` }], isError: true }
        }
      }
    )
  }

  // 以虎 One 的标准工具(老板简报、管理层首页): 只读, 组合已有接口(见 standardTools.js)
  for (const def of standardTools(callApi)) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.schema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
      async (args) => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(await def.run(user, args || {})) }] }
        } catch (e) {
          return { content: [{ type: 'text', text: `工具执行失败: ${e.message}` }], isError: true }
        }
      }
    )
  }

  // 文件上传特殊工具（multipart 代理, 走不了 TOOLS 的 JSON 通道）
  server.registerTool(
    'upload_file',
    {
      description: '通用文件上传, 返回文件 URL。附件先走这里拿 url。提供 fileBase64（内容 base64）或 fileUrl（可公网下载的源地址）之一。',
      inputSchema: {
        fileBase64: z.string().optional().describe('文件内容 base64（二选一）'),
        fileUrl: z.string().optional().describe('源文件 URL, 服务端代为下载（二选一）'),
        fileName: z.string().optional().describe('文件名（含扩展名）, 如 screenshot.png')
      }
    },
    async (args) => {
      try {
        const data = await postMultipart(user, '/api/fde/uploads', args || {})
        logAgentActivity(user, 'upload_file', { path: '/api/fde/uploads' }, data)
        return toToolResult(data)
      } catch (e) {
        return { content: [{ type: 'text', text: `上传失败: ${e.message}` }], isError: true }
      }
    }
  )

  return server
}

// MCP 工具注解: 客户端据此决定要不要先让用户确认(以虎 One 的助手对没声明只读的工具一律弹确认卡片)。
// 工具是 REST 的薄代理, 按 HTTP 方法判断: GET 只读, DELETE 不可逆; 少数只算草稿不落库的 POST 在 READ_ONLY_POST 里单列
const READ_ONLY_POST = new Set(['validate_decomposition_draft', 'generate_decomposition_draft', 'draft_idea_milestone'])
export function annotationsOf(def) {
  let method = 'POST'
  try {
    // build 只拼请求, 用占位参数调一次拿到 HTTP 方法
    method = def.build(new Proxy({}, { get: (_, k) => (k === Symbol.iterator ? undefined : 'x'), ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }))?.method || 'POST'
  } catch { /* 拼不出来按写操作算 */ }
  const readOnly = method === 'GET' || READ_ONLY_POST.has(def.name)
  return { readOnlyHint: readOnly, destructiveHint: method === 'DELETE', idempotentHint: readOnly || method === 'PUT' }
}

/**
 * 挂载 MCP 端点。须在全局 express.json() 之前调用（自带更大 body 限额, 支持 base64 文件）
 */
export function mountMcp(app) {
  const jsonParser = express.json({ limit: '20mb' })

  app.post('/api/mcp', jsonParser, mcpAuth, async (req, res) => {
    const server = buildServer(req.user)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 无状态模式
      enableJsonResponse: true // 纯 JSON 响应, 兼容不吃 SSE 的智能体平台
    })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      console.error('[mcp]', e)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        })
      }
    }
  })

  // 无状态模式不支持 SSE 长连接与会话终止
  const methodNotAllowed = (req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: 本 MCP 端点为无状态模式, 仅支持 POST' },
      id: null
    })
  }
  app.get('/api/mcp', methodNotAllowed)
  app.delete('/api/mcp', methodNotAllowed)
}
