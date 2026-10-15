# MCP 智能体接入指南

FDE 系统内置 MCP Server（Model Context Protocol，Streamable HTTP 传输）。任何支持 MCP 的智能体平台，配一个端点、带一个凭证即可接入，自动获得全部工具及参数说明——无需逐个配置 REST 接口。

## 三种接入方式

FDE 作为以虎 One 的应用运行，智能体都经以虎 One 拿到身份：

| 谁在用 | 怎么接 | 地址 | 凭证 |
|---|---|---|---|
| 以虎 One 的 AI 助手 | 不用配置，用户对助手说话即可 | — | 平台自动带上当前用户身份 |
| 个人的 AI 工具（Claude Code、Cursor、WorkBuddy 等） | 连以虎 One 的 MCP 网关 | `<以虎 One 地址>/api/mcp` | 本人在以虎 One「个人中心 → API Key」生成的 Key |
| 机器人（看板派工、巡检，需要独立身份） | 直连 FDE | `<FDE 地址>/api/mcp` | 在「Agent 协作」注册 Agent 后发的专属 Key（`fde_` 前缀） |

- 经以虎 One 网关时，FDE 的工具名带应用前缀 `fde__`（如 `fde__list_my_tasks`），平台按用户可见范围汇总、带上用户身份转发。一个以虎 One Key 通用平台上所有应用。
- 无论哪种方式，都以对应用户的身份执行，角色权限与数据范围自动生效；只读工具标了 `readOnlyHint`，以虎 One 助手调写操作前会先让用户确认。
- 本系统**不再签发个人 API Key**；已有的个人 Key 吊销前照常可用。Agent 专属 Key 的写入会标注该 Agent 为来源、留活动审计，可单独停用/换 Key，详见《Agent 协作与数据沉淀》。

## 连接信息

| 项 | 值 |
|---|---|
| 传输 | MCP Streamable HTTP，无状态模式（仅 POST，无需会话管理；返回纯 JSON，兼容不支持 SSE 的平台） |
| 协议版本 | 2025-03-26 |
| 工具数量 | 115 个（`tools/list` 自描述，含参数 JSON Schema） |
| 首页卡片 | `get_my_open_task_count`、`list_my_open_tasks`、`get_my_week_hours`、`list_my_weekly_hours`、`list_pending_timesheet_approvals`、`list_project_health`、`list_overdue_tasks` 返回结构化结果，可以直接放到以虎 One 首页的数据卡片上 |

## 快速开始

> 💡 最省事的是在「开发上手」页下载配置包：`.mcp.json` 已经填好以虎 One 网关地址，只要把你的以虎 One Key 填进去。

Claude Code 一条命令接入（个人 AI 工具）：

```bash
claude mcp add --scope user yihu-one --transport http <以虎 One 地址>/api/mcp --header "Authorization: Bearer <你的以虎 One API Key>"
```

用 curl 验证连通性：

```bash
curl -s <以虎 One 地址>/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <你的以虎 One API Key>' \
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
