# 10 · MCP Server 对接指南（推荐对接方式）

> 2026-07-14 起，后端内置了 MCP Server（Model Context Protocol，Streamable HTTP 传输）。
> **第三方智能体平台如支持 MCP，直接连这个端点即可，无需再逐个配置 REST 工具**（03/08 文档降级为参考资料）。

## 连接信息

| 项 | 值 |
|---|---|
| 端点 | `POST http://<后端地址>:3005/api/mcp`（生产走 HTTPS 反代后为 `https://<域名>/api/mcp`） |
| 传输 | MCP Streamable HTTP，**无状态模式**（仅 POST；不需要会话管理，`enableJsonResponse` 已开启，返回纯 JSON，兼容不支持 SSE 的平台） |
| 协议版本 | 2025-03-26（SDK @modelcontextprotocol/sdk 1.29） |
| 鉴权 | 两种凭证任选：个人 API Key（`Authorization: Bearer fde_xxx` 或 `X-API-Key: fde_xxx`）；或**用户登录 Token 透传**（`Authorization: Bearer <JWT>`，2026-07-29 起推荐 Agent 平台用这种） |
| 工具数量 | 139 个（tools/list 自描述，含参数 JSON Schema；含 2 个 multipart 上传工具） |

## 鉴权：两种凭证

MCP 端点接受两种凭证，服务端按前缀自动识别（`fde_` 开头按 API Key 处理，否则按用户 JWT 处理）：

  - **Agent 专属 Key（v1.6.0 推荐）**：员工在后台「Agent 协作」注册 Agent 后发放（`POST /api/fde/agent-profiles`，一 Agent 一 Key，同为 `fde_` 前缀）。权限与普通个人 Key 完全一致，但经此 Key 的写入会**标注该 Agent 为来源**（记录/会话的归属展示、活动审计留痕、目录页活跃度），且可单独停用/换 Key 而不影响主人其他凭证。给自己的 Agent 配 Key 一律用这种。
- **用户登录 Token 透传（2026-07-29 起，Agent 平台推荐模式）**：平台把**用户自己的登录 JWT** 原样放进 `Authorization: Bearer <token>` 调用 MCP，服务端验签后自动解析出是哪个用户在调用，以该用户身份执行。不需要签发任何 Key，"一个 Agent 服务全体用户"天然成立。

> 原 AGENT 平台共享 Key + 手机号路由（`X-User-Phone` / `?phone=`）已于 2026-07-29 **下线**：存量 AGENT Key 调用会收到 401，提示改用 Token 透传；`POST /api/fde/api-keys` 也不再接受 `scope: "AGENT"`。

### 用户 Token 透传模式

```
POST /api/mcp
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...   ← 用户登录后拿到的 JWT 原样透传
```

规则与边界：

- Token 来源：用户用以虎 One 账号登录本系统后拿到的 `data.token`（有效期 7 天）。本系统没有账号密码登录。
- 服务端逐次落库核验：Token 有效但用户已被禁用/删除 → 401。
- Token 无效/过期/非内部用户 Token → 401，消息说明两种凭证的传法。
- 解析成功后行为与个人 Key 完全一致：内部签发该用户 JWT 回调 REST，权限矩阵与数据范围自动生效。

## 凭证

本系统作为以虎 One 的应用运行，**个人 API Key 由以虎 One 签发**（个人中心 → API Key），一个 Key 通用平台上所有应用的工具：

- 外部智能体连以虎 One 的 MCP 网关 `<平台地址>/api/mcp`，FDE 的工具名带 `fde__` 前缀，以用户本人身份执行
- 以虎 One 的 AI 助手调用 FDE 时自动带上用户身份，不用配置
- 需要独立身份的机器人（看板派工自动开发）在 FDE「Agent 协作」里注册 Agent，签发 Agent 专属 Key（`fde_` 前缀），直连 FDE 的 `/api/mcp`

| 操作 | 接口 | 说明 |
|---|---|---|
| 签发 Agent 专属 Key | `POST /api/fde/agent-profiles` / `.../:id/rotate-key` | 明文只返回这一次 |
| 列表 | `GET /api/fde/api-keys` | 只展示前缀与 scope，不能找回明文 |
| 吊销 | `POST /api/fde/api-keys/:id/revoke` | 本人或 ADMIN；立即失效 |
| 个人 Key | `POST /api/fde/api-keys` | 已停止签发（410），请用以虎 One 个人中心的 API Key |

存储安全：库里只存 sha256 哈希（`api_keys` 表），泄露库不泄露 Key；每次使用更新 `lastUsedAt` 便于审计。

## 平台配置步骤（以支持 MCP 的智能体平台为例）

1. 凭证二选一：
   - **以虎 One 个人 API Key（推荐）**：用户在以虎 One 个人中心生成，连平台 MCP 网关。
   - **Agent 专属 Key**：机器人在 FDE「Agent 协作」里注册后签发。
2. 平台的 MCP/插件配置里添加：
   - Server URL：以虎 One 个人 Key 用 `<以虎 One 地址>/api/mcp`；Agent 专属 Key 用 `<FDE 地址>/api/mcp`
   - 认证：自定义 Header `Authorization: Bearer <Key>`
4. 系统提示词仍建议采用本材料包 01（行为准则）+ 07（槽位归一化）内容；MCP 的 `instructions` 字段已内置七条核心约定（先调工作台/写前确认/不可逆动作要确认/403 不重试/对外通道不由模型触发/日期格式/干完活把过程沉淀回系统）。

## 工具清单（112 个，与 REST 对照见 03 文档）

- 工作台/档案：`get_my_workbench`、`get_engineer_profile`、`suggest_engineers_for_task`、`update_my_profile`
- 客户：`list_customers`、`get_customer`、`add_customer_contact`、`update_customer_contact`、`delete_customer_contact`
- 项目：`list_projects`、`get_project_detail`、`create_project`、`update_project`、`add_project_member`、`remove_project_member`
- 代码仓库：`list_project_repos`、`add_project_repo`、`remove_project_repo`
- AI 拆解：`generate_decomposition_draft`、`validate_decomposition_draft`、`apply_decomposition_draft`
- 里程碑：`list_milestones`、`create_milestone`、`update_milestone`、`close_milestone`、`delete_milestone`
- 工时：`create_timesheet`、`list_timesheets`、`update_timesheet`、`submit_timesheet`、`approve_timesheet`
- 任务：`list_my_tasks`、`list_project_tasks`、`get_task`、`create_task`、`update_task`、`assign_task`、`update_task_status`、`verify_task`、`delete_task`、`add_task_attachment`、`list_task_comments`、`add_task_comment`、`list_subtasks`、`create_subtask`、`update_subtask`、`delete_subtask`
- 路径图/依赖：`get_milestone_roadmap`、`add_task_dependency`、`remove_task_dependency`
- 派工/机器人：`list_dev_dispatches`、`create_dev_dispatch`、`claim_dev_run`、`peek_dev_runs`、`report_dev_run_progress`、`complete_dev_run`、`fail_dev_run`、`report_presence`
- 问题/风险：`list_issues`、`report_issue`、`update_issue`、`delete_issue`、`list_risks`、`report_risk`、`update_risk`、`delete_risk`
- 项目记录：`add_project_record`（v1.6.0 起类型含 CHAT 聊天记录 / RESEARCH 研究记录）、`list_project_records`、`add_research_note`
- **Agent 协作（v1.6.0）**：`log_agent_conversation`（对话整段回传留存，挂项目进时间线）、`get_my_agent_profile`（查自己的注册档案与沉淀计数）
- **创意中心（v2.10.0）**：`list_idea_topics`、`create_idea_topic`、`list_ideas`、`get_idea`、`create_idea`、`add_idea_comment`、`summarize_idea`（AI 总结讨论）、`draft_idea_milestone`（AI 起草里程碑）、`convert_idea_to_milestone`（想法 → 项目里程碑，调用前需用户确认）
- 知识库：`search_knowledge`、`get_knowledge_article`、`create_knowledge_article`、`update_knowledge_article`、`delete_knowledge_article`
- 技能：已改到以虎 One 的 Skill 中心（平台 MCP 的 `list_skills` / `get_skill` 等），本系统不再提供
- 资产库：`search_assets`、`get_asset`、`propose_asset`、`record_asset_usage`
- 团队：`list_teams`
- 通知：`list_notifications`、`mark_notification_read`、`mark_all_notifications_read`、`delete_notification`、`send_notification`
- 汇总：`get_timesheet_summary`、`get_team_utilization`

> ⚠️ **对外通道的边界（主人拍板）**：智能体只能**查询 / 记录 / 起草**，**没有 `send_email`**。
> `send_notification` 是**站内**通知，写死只走站内信箱（不外发飞书/邮件），且需经理及以上权限。
> 工程师邀请函的 sendEmail 是唯一例外（用户明示的一对一事务邮件）。

> ⚠️ **不可逆动作**：`delete_*`、
> 调用前必须拿到用户明确确认；接入方的系统提示词建议再强调一遍。

> 权限仍由后端角色矩阵兜底：工程师调 `approve_*`、`create_project`、`send_notification` 一律 403，
> 工具暴露给谁不等于谁都能用。

## 错误语义

- 工具返回 `isError: true` 时，文本里包含 `httpStatus` 和后端业务错误信息；403 会附带一句"不要重试、转交对应角色"的提示，模型可直接转述。
- 参数不合法在 MCP 层就被 JSON Schema 校验拦截（-32602），不会打到后端。
- API Key 无效/吊销、用户 Token 无效/过期 → HTTP 401（JSON），平台应提示重新配置凭证或引导用户重新登录。

## 实现位置（后端代码）

| 文件 | 职责 |
|---|---|
| `backend/src/mcp/index.js` | MCP 端点挂载、无状态 transport、内部 JWT 代发与 REST 回调 |
| `backend/src/mcp/tools.js` | 137 个工具的声明式定义（zod schema → REST 映射） |
| `backend/src/lib/apiKey.js` | Key 生成/哈希/校验、用户 Token 解析（`resolveUserToken`）、`mcpAuth` 中间件 |
| `backend/src/routes/fde/api-keys.js` | Key 管理接口 |
| `backend/prisma/migrations/20260714000000_add_api_keys/` | `api_keys` 表迁移 |
| `backend/prisma/migrations/20260714100000_add_api_key_scope/` | `scope` 列迁移（历史遗留：AGENT 已停用，仅 PERSONAL 在用） |

架构说明：MCP 工具不直接查库，而是以 Key 绑定用户的身份**内部签发 JWT 回调本机 REST API**——所有权限矩阵（PERMISSIONS）、数据范围（buildScopeWhere）、业务校验与审计（Activity）逻辑零重复地完全复用；REST API 改行为，MCP 自动跟随。

## 验证记录（2026-07-14 本地联调，测试数据已清理）

- initialize / tools/list / tools/call 全通过（curl 直连）
- 身份绑定：工程师 Key → get_my_workbench 返回本人档案；list_projects 只见本人参与的 1 个项目
- 写操作：create_timesheet 成功（创建即 SUBMITTED）
- 参数校验：缺 workContent 被 -32602 拦截
- 权限边界：report_issue 返回 403（印证 09-A-1 的权限缺口，待产品决策）
- 错误 Key → 401；回归测试与 master 基线一致（193 通过 / 5 个存量失败，均为本地数据环境问题）
