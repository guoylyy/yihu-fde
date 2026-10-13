# MCP 智能体接入指南

FDE 系统内置 MCP Server（Model Context Protocol，Streamable HTTP 传输）。任何支持 MCP 的智能体平台，配一个端点、带一个凭证即可接入，自动获得全部工具及参数说明——无需逐个配置 REST 接口。

## 连接信息

| 项 | 值 |
|---|---|
| 端点 | `POST https://<系统域名>/api/mcp` |
| 传输 | MCP Streamable HTTP，无状态模式（仅 POST，无需会话管理；返回纯 JSON，兼容不支持 SSE 的平台） |
| 协议版本 | 2025-03-26 |
| 鉴权 | 个人 API Key 或用户登录 Token，二选一（见下） |
| 工具数量 | 104 个（`tools/list` 自描述，含参数 JSON Schema） |

## 鉴权

端点接受两种凭证，服务端按前缀自动识别（`fde_` 开头按 API Key 处理，否则按用户 JWT 处理）：

### 方式一：用户登录 Token 透传（平台级对接推荐）

平台把用户自己的登录 JWT 原样放进请求头调用 MCP：

```
POST /api/mcp
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

- Token 来源：`POST /api/auth/login` 返回的 `data.token`（有效期 7 天，勾选「下次自动登录」为 30 天）。
- 服务端验签后以该用户身份执行，角色权限与数据范围自动生效。不需要签发任何 Key，一个 Agent 服务全体用户天然成立。
- 服务端逐次核验用户状态：Token 有效但用户已被禁用/删除 → 401。

### 方式二：个人 API Key（单人/长期挂机对接）

`fde_` 前缀的 Key 绑定到具体用户——智能体拿着某个用户的 Key，就以该用户身份操作，权限与数据隔离自动生效。

> **v1.6.0 推荐：Agent 专属 Key**。在控制台「Agent 协作」注册 Agent 后发放（一 Agent 一 Key，同为 `fde_` 前缀）。权限与普通个人 Key 一致，但写入会标注该 Agent 为来源、留活动审计，且可单独停用/换 Key。给自己的 Agent 配 Key 一律用这种，详见《Agent 协作与数据沉淀》文档。

```
POST /api/mcp
Authorization: Bearer fde_xxxxxxxx        # 或 X-API-Key: fde_xxxxxxxx
```

**Key 的获取与管理**（在系统内完成，也可走以下接口）：

| 操作 | 接口 | 说明 |
|---|---|---|
| 创建 | `POST /api/fde/api-keys`，body `{name}` | 任何内部用户给自己创建；**明文只返回这一次** |
| 给他人签发 | 同上，body `{name, userId}` | 仅管理员 |
| 列表 | `GET /api/fde/api-keys` | 只展示前缀，不能找回明文 |
| 吊销 | `POST /api/fde/api-keys/:id/revoke` | 本人或管理员，立即失效 |

服务端只存 Key 的 sha256 哈希；每次使用记录 `lastUsedAt` 便于审计。

## 快速开始

> 💡 如果你的智能体本身就能执行命令或读写配置（如 OpenClaw、WorkBuddy），最省事的接法是**把端点和凭证直接发给它，让它自己完成接入**——话术模板见左侧「接入教程」两篇。

1. 准备凭证（Token 透传或个人 Key，见上）。
2. 在平台的 MCP / 插件配置里添加：
   - **Server URL**：`https://<系统域名>/api/mcp`
   - **认证**：自定义 Header `Authorization: Bearer <用户JWT 或 fde_xxx>`
3. 平台会自动完成 `initialize` + `tools/list`，拉取全部工具及参数 Schema。

用 curl 验证连通性：

```bash
curl -s https://<系统域名>/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <凭证>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 工具清单（按域分组）

| 域 | 工具 |
|---|---|
| 工作台/项目 | `get_my_workbench` `list_projects` `get_project_detail` `create_project` `update_project` `add_project_member` `remove_project_member` |
| 里程碑 | `list_milestones` `create_milestone` `update_milestone` `close_milestone` `delete_milestone` |
| 工时 | `create_timesheet` `list_timesheets` `update_timesheet` `submit_timesheet` `approve_timesheet` |
| 任务 | `list_my_tasks` `list_project_tasks` `get_task` `create_task` `update_task` `assign_task` `update_task_status` `verify_task` `delete_task` `add_task_attachment` `list_task_comments` `add_task_comment` `list_subtasks` `create_subtask` `update_subtask` `delete_subtask` |
| 派工(v2.9.0) | `claim_dev_run` `report_dev_run_progress` `complete_dev_run` `fail_dev_run` `list_dev_dispatches` `create_dev_dispatch`（详见「开发机器人接入」文档） |
| 路径图(v2.8.0) | `get_milestone_roadmap` `add_task_dependency` `remove_task_dependency` `apply_decomposition_draft`（`create_task` 支持 `dependsOn`，`get_task` 返回 `blocked/blockedBy`；详见「里程碑路径图」文档） |
| 问题/风险 | `list_issues` `report_issue` `update_issue` `delete_issue` `list_risks` `report_risk` `update_risk` `delete_risk` |
| 创意中心（v2.10.0） | `list_idea_topics` `create_idea_topic` `list_ideas` `get_idea` `create_idea` `add_idea_comment` `summarize_idea`（AI 总结讨论） `draft_idea_milestone`（AI 起草里程碑） `convert_idea_to_milestone`（想法 → 项目里程碑） |
| 项目记录 | `add_project_record`（v1.6.0 起类型含 CHAT/RESEARCH） `list_project_records` |
| Agent 协作（v1.6.0） | `log_agent_conversation`（对话回传留存） `add_research_note`（研究记录归档） `get_my_agent_profile` |
| 知识库 | `search_knowledge` `get_knowledge_article` `create_knowledge_article` `update_knowledge_article` `delete_knowledge_article` |
| 通知 | `list_notifications` `mark_notification_read` `mark_all_notifications_read` `delete_notification` `send_notification` |
| 汇总 | `get_timesheet_summary` `get_team_utilization` |

## 行为约定与边界

这些约定已内置在 MCP 的 `instructions` 字段里，接入方的系统提示词建议再强调一遍：

- **对外通道不由模型触发**。没有 `send_email` 工具；`send_notification` 只走站内信箱（不外发），且需经理及以上权限。唯一例外：v1.7.5 工程师邀请（`create_engineer_invite` / `review_engineer_application` 的 `sendEmail`）——用户明示才发的一对一邀请函，不属于客户营销触达。
- **权限由服务端兜底**。工具暴露给谁不等于谁都能用：无权限的调用一律 403，模型收到 403 不应重试，应转交对应角色处理。

## 错误语义

| 情况 | 表现 | 建议处理 |
|---|---|---|
| 业务错误 | 工具返回 `isError: true`，文本含 `httpStatus` 与后端错误信息 | 直接转述给用户 |
| 无权限 | 403，附「不要重试、转交对应角色」提示 | 不重试 |
| 参数不合法 | MCP 层 JSON Schema 校验拦截（-32602），不会打到后端 | 修正参数 |
| 凭证无效/过期/被吊销 | HTTP 401（JSON） | 重新配置 Key 或引导用户重新登录 |

## FAQ

**Q：一个智能体要服务多个用户，用哪种凭证？**
A：Token 透传。每个用户带自己的登录 Token 调用，身份、权限、数据范围全部自动对号入座。

**Q：Key 泄露了怎么办？**
A：在系统「API Key 管理」里吊销，立即失效。服务端只存哈希，数据库泄露不等于 Key 泄露。

**Q：工具行为和系统页面不一致？**
A：不会。MCP 工具在服务端以你的身份回调同一套业务接口，页面能做什么、工具就能做什么，页面不允许的、工具同样被拒。
