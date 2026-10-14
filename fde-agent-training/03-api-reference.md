# 03 · API 接口参考（FDE 工程师视角）

> 本文档面向第三方智能体平台的工具（Tool/Plugin/Action）配置。
> 每个接口可直接注册为智能体的一个"工具"，参数说明可直接用于工具的 JSON Schema 描述。

## 通用约定

- **Base URL**：`http://<后端地址>:3005`（生产环境经 nginx/frp 转发，前缀不变）
- **认证方式**：JWT Bearer Token。登录后在请求头携带：
  ```
  Authorization: Bearer <token>
  ```
- **响应包裹格式**：所有接口统一返回 `{ "code": 0, "message": "ok", "data": {...} }`；`code=0` 表示成功，非 0 为业务错误码（如 1001 参数错误、2003 账号密码错误、9001 服务器异常），同时配合 HTTP 状态码（400/401/403/404/500）。
- **分页约定**：列表接口通用参数 `page`（从 1 开始）、`page_size`（部分接口为 `pageSize`，以下表格中已注明）。
- **日期格式**：`YYYY-MM-DD`（如 `2026-07-14`）。

### 认证与基础接口

> 本系统只用以虎 One 账号登录（`GET /api/auth/oidc/login` 跳转平台授权），没有账号密码登录。智能体经以虎 One 接入或用 Agent 专属 Key，见 10 文档。

| 方法 | 路径 | 功能 | 说明 |
|---|---|---|---|
| GET | `/api/auth/me` | 当前登录用户信息 | 需 Bearer token |
| GET | `/api/fde/me` | 个人工作台聚合 | FDE_ENGINEER 返回：个人档案+技能、我的在职项目（含客户）、本月工时汇总、待办任务、可用性。v1.5.6 起 `profile.teams` 带出所属团队（即时消息通知按团队定位，未设置会收不到团队群通知）。**智能体会话开始时建议先调这个接口获取上下文。** |
| GET | `/api/fde/teams` | 团队清单（v1.5.6） | 登录即可（只读）；返回启用中团队 `{ list: [{id, name, leader, memberCount, ...}] }`。`?all=1` 含停用团队（需 team.manage）。`GET /api/fde/teams/:id` 返回详情含成员清单。**团队归属由管理员设置**（用户管理 `PUT /api/fde/users/:id` 的 `teamIds` 字段，或团队管理 `PUT /api/fde/teams/:id/members`），本人不可自改。用户报「收不到通知」时检查其 `profile.teams` 是否为空，为空则提醒找管理员设置。 |

---

## 1. 工时（Timesheet）— 使用频率最高

来源：`backend/src/routes/fde/timesheets.js`

| 方法 | 路径 | 功能 | 主要参数 | 权限 |
|---|---|---|---|---|
| GET | `/api/fde/timesheets` | 工时列表（分页+筛选, 过滤服务端生效） | `page`, `page_size`(或 `pageSize`), `projectId`(或 `project_id`), `engineerId`(或 `engineer_id`), `status`(DRAFT/SUBMITTED/APPROVED/REJECTED), `from`, `to`, `offset`(与 page 二选一, 优先) —— v1.6.3 起驼峰/snake 均可 | 登录即可，工程师只见自己的 |
| GET | `/api/fde/timesheets/_meta/summary` | 工时汇总（周报/团队投入统计的主力接口） | `from`, `to`, `groupBy`(PROJECT默认/ENGINEER/DAY), `projectId`, `status`(默认 APPROVED，传 ALL 含待审批)。返回 `{groupBy, totalHours, list}`，list 每项含 `key`/`name`/`totalHours`/`recordCount` | 同上 |
| GET | `/api/fde/timesheets/_meta/pending` | 待审批工时列表 | `page`, `page_size` | 审批人用 |
| POST | `/api/fde/timesheets` | 创建工时 | body: `projectId`(必), `workDate`(必), `hours`(必), `workContent`(必,工作内容描述), `location`, `status`; `engineerId` 可省略（默认记本人） | timesheet.create |
| PUT | `/api/fde/timesheets/:id` | 修改工时 | 同创建字段 | timesheet.edit，仅本人未审批的 |
| DELETE | `/api/fde/timesheets/:id` | 删除工时 | — | timesheet.delete |
| POST | `/api/fde/timesheets/:id/submit` | 提交工时（草稿→待审批） | — | timesheet.submit |
| POST | `/api/fde/timesheets/:id/approve` | 审批工时 | body: `approved`(true/false) | timesheet.approve（经理侧） |

> ⚠️ 字段名是 `workDate` 不是 `date`。系统当前默认创建即 SUBMITTED（提交状态），详见业务流程文档。

## 2. 任务（Task / Subtask）

来源：`backend/src/routes/fde/tasks.js`、`subtasks.js`

| 方法 | 路径 | 功能 | 主要参数 | 权限 |
|---|---|---|---|---|
| GET | `/api/fde/tasks` | 任务列表（含子项进度；1.2.5 起非管理层只返回自己参与项目的任务） | `projectId`, `assigneeId`, `mine=true`(只看我的), `status`(TODO/IN_PROGRESS/DONE/VERIFIED), `priority`(LOW/MEDIUM/HIGH/URGENT), `keyword`, `page`, `page_size` | 登录即可 |
| GET | `/api/fde/tasks/:id` | 任务详情（1.2.5 起范围外项目的任务返回 404；v2.8.0 带 `predecessors/successors/blocked/blockedBy`） | — | 同上 |
| POST | `/api/fde/tasks` | 创建任务 | body: `projectId`(必), `title`(必), `description`, `milestoneId`, `assigneeUserId`, `status`, `priority`, `dueDate`, `dependsOn`(v2.8.0 前置任务 id 数组) | project.edit |
| PUT | `/api/fde/tasks/:id` | 更新任务 | 同创建字段 | 登录即可 |
| POST | `/api/fde/tasks/:id/status` | 快速改状态 | body: `status`(必) | ADMIN/PLATFORM/MANAGER/任务负责人本人 |
| DELETE | `/api/fde/tasks/:id` | 删除任务 | — | project.edit |
| GET | `/api/fde/subtasks?taskId=` | 子任务清单 | `taskId`(必) | 登录即可 |
| POST | `/api/fde/subtasks` | 创建子任务 | body: `taskId`(必), `title`(必), `order` | 同上 |
| PUT | `/api/fde/subtasks/:id` | 勾选/改名子任务 | body: `title`, `done`(true/false), `order` | 同上 |
| DELETE | `/api/fde/subtasks/:id` | 删除子任务 | — | 同上 |

### 2.1 任务依赖与里程碑路径图（v2.8.0）

来源：`backend/src/routes/fde/task-dependencies.js`、`projects.js`、`decomposition.js`、`services/roadmap.js`

边 = `predecessorId`(前置, 先做) → `successorId`(后继, 后做)；`type` BLOCKS(硬依赖, 由 BLOCKS 边构成的图必须无环) / FEEDBACK(回环软边, 不参与阻塞与环检测)。依赖只能建在同一项目的任务之间。

| 方法 | 路径 | 功能 | 主要参数 / 返回 | 权限 |
|---|---|---|---|---|
| GET | `/api/fde/projects/:projectId/roadmap` | 里程碑路径图聚合 | query `milestoneId`(id / `none` 未挂 / 不传=整项目)。返回 `nodes[]`(含 status/assignee/blocked/blockedBy/ready/predecessors/successors/external)、`edges[]`、`topoOrder`、`ready`、`blocked`、`entries`、`terminals`、`criticalPath{taskIds,totalDays}`、`mermaid`、`stats`、`milestones[].stats` | task.view |
| GET | `/api/fde/task-dependencies?taskId=` | 单任务上下游 | `{predecessors[], successors[], blockedBy[]}` | task.view |
| POST | `/api/fde/task-dependencies` | 建边 | body `predecessorId`(必) `successorId`(必) `type` `note`。成环 → 400 `code 9006` + `cyclePath`；重复 → 409 `code 9005` | task.edit |
| PUT | `/api/fde/task-dependencies/:id` | 改类型/说明 | body `type` `note`（FEEDBACK→BLOCKS 重新过环检测） | task.edit |
| DELETE | `/api/fde/task-dependencies/:id` | 删边 | — | task.edit |
| DELETE | `/api/fde/task-dependencies/pair` | 按对删边 | query `predecessorId` `successorId` | task.edit |
| POST | `/api/fde/decomposition/generate` | AI 拆解草案 | body `requirement`(必, ≥20 字) `projectId` `milestoneId`（带项目上下文） | project.access |
| POST | `/api/fde/decomposition/apply` | 草案落库(事务) | body `projectId`(必) `draft`(必) `milestoneId`。返回 `{milestones[], tasks[], edgeCount, skippedDependencies[]}` | task.create |
| POST | `/api/fde/decomposition/suggest-dependencies` | AI 补依赖建议 | body `projectId` `milestoneId` → `{suggestions[], rejected[]}`（只建议不落库） | task.edit |
| POST | `/api/fde/decomposition/explain` | 大白话解读路径 | body `projectId` `milestoneId` → `{text, stats, criticalPath}` | project.access |

任务删除 / 跨项目移动时其所有边自动软删并在评论留痕。

### 2.2 已下线的自动验收接口（v2.8.5）

`POST /tasks/:id/accept`、`/tasks/_meta/acceptance-stats|acceptance-samples|regression-cases|regression-run|regression-runs|feedback-stats`、`/tasks/:id/acceptance-records` 统一返回 410（`Deprecation: true`）。任务验收只剩经理把 DONE 置为 VERIFIED（`verify_task` / `POST /tasks/:id/status`）。`create_task`/`update_task` 的 `acceptanceCriteria`/`reviewLevel` 仍被接受但不再展示，新对接请勿依赖。

### 2.3 看板派工自动开发（v2.9.0）

来源：`backend/src/routes/fde/dev-dispatch.js`、`services/devDispatch.js`。派工单(RUNNING/PAUSED/DONE/CANCELLED) → 运行(PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED) → 事件。

| 方法 | 路径 | 功能 | 主要参数 / 返回 | 权限 |
|---|---|---|---|---|
| POST | `/api/fde/dev-dispatches` | 启动派工单 | `projectId`(必) `milestoneId` `scope`(MILESTONE/READY/TASKS) `taskIds` `agentProfileId`(空=任意) `title` `note` → `{id, runCount, taskIds, skippedBusy}` | task.edit |
| GET | `/api/fde/dev-dispatches?projectId=&includeDone=` | 派工单列表(带运行计数) | — | task.view |
| GET | `/api/fde/dev-dispatches/:id` | 详情(含全部运行) | — | task.view |
| POST | `/api/fde/dev-dispatches/:id/pause|resume|cancel` | 暂停/继续/取消 | — | task.edit |
| GET | `/api/fde/dev-dispatches/robots` | 机器人清单(在线态/当前活) | — | task.view |
| GET | `/api/fde/dev-dispatches/runs/:runId?events=` | 运行详情 + 事件 | — | task.view |
| POST | `/api/fde/dev-dispatches/runs/:runId/cancel|redispatch` | 取消 / 重派 | — | task.edit |
| POST | `/api/fde/dev-dispatches/runs/claim` | **机器人领活**(Agent Key 身份; 经理可传 `agentProfileId` 代领) | `projectId?` → `{run, context, resumed}` 或 `run:null` | task.edit |
| POST | `/api/fde/dev-dispatches/runs/:runId/progress` | 进度 + 心跳 | `progress`(0-99) `phase` `message` `level` `data`；409/9009=已取消或释放 | task.edit |
| POST | `/api/fde/dev-dispatches/runs/:runId/complete` | 完成 | `summary`(必) `commits[]` `branch` `prUrl` `testResult` | task.edit |
| POST | `/api/fde/dev-dispatches/runs/:runId/fail` | 放弃 | `error`(必) `retryable` | task.edit |

`GET /projects/:id/roadmap` 追加 `runs`(taskId → 最新运行摘要, 含 `stale`)、`dispatches`、`activeDispatchCount`。

## 3. 项目（Project 及其子资源）

来源：`backend/src/routes/fde/projects.js`

| 方法 | 路径 | 功能 | 主要参数 | 权限 |
|---|---|---|---|---|
| GET | `/api/fde/projects` | 项目列表 | `page`, `page_size`, `keyword`, `status`, `health`, `customer_id` | 工程师只见自己参与的 |
| GET | `/api/fde/projects/:id` | 项目详情（成员/里程碑/工时/任务/风险/问题一次带回） | — | 同上 |
| GET | `/api/fde/projects/_meta/stats` | 项目统计 | — | 同上 |
| PUT | `/api/fde/projects/:id` | 更新项目（进度/健康度等） | body: `progress`, `health`, `status`, ... | project.edit |

### 3.1 里程碑 Milestone

| 方法 | 路径 | body 字段 |
|---|---|---|
| GET | `/api/fde/projects/:projectId/milestones` | query: `status`(可选过滤)。返回 `{total, list}`，按 sortOrder 排 |
| POST | `/api/fde/projects/:projectId/milestones` | `name`(必), `description`, `goal`(v2.8.0 完成定义), `plannedDate`, `actualDate`, `status`(PENDING/IN_PROGRESS/COMPLETED/DELAYED) |
| PUT | `/api/fde/projects/:projectId/milestones/:id` | 同上 |
| DELETE | `/api/fde/projects/:projectId/milestones/:id` | — |

### 3.2 问题 Issue

| 方法 | 路径 | body 字段 |
|---|---|---|
| GET | `/api/fde/projects/:projectId/issues` | query: `status`, `severity`, `page`, `page_size`。返回 `{total, list}` |
| POST | `/api/fde/projects/:projectId/issues` | `title`(必), `description`, `severity`(LOW/MEDIUM/HIGH/CRITICAL), `status`(OPEN/IN_PROGRESS/RESOLVED/CLOSED) |
| PUT | `/api/fde/projects/:projectId/issues/:id` | 同上 |
| DELETE | `/api/fde/projects/:projectId/issues/:id` | — |

### 3.3 风险 Risk

| 方法 | 路径 | body 字段 |
|---|---|---|
| GET | `/api/fde/projects/:projectId/risks` | query: `status`, `page`, `page_size`。返回 `{total, list}` |
| POST | `/api/fde/projects/:projectId/risks` | `title`(必), `description`, `probability`(LOW/MEDIUM/HIGH), `impact`(LOW/MEDIUM/HIGH), `status`(IDENTIFIED/MONITORING/MITIGATED/CLOSED), `mitigation`(缓解措施) |
| PUT | `/api/fde/projects/:projectId/risks/:id` | 同上 |
| DELETE | `/api/fde/projects/:projectId/risks/:id` | — |

### 3.4 代码仓库

| 方法 | 路径 | body 字段 |
|---|---|---|
| POST | `/api/fde/projects/_meta/parse-repo` | `url`(必) — 解析仓库地址 |
| POST | `/api/fde/projects/:projectId/repositories` | `name`(必), `url`(必), `provider`(GITEE/GITHUB/GITLAB/OTHER), `defaultBranch`, `description` |
| PUT | `/api/fde/projects/:projectId/repositories/:id` | 同上 |
| DELETE | `/api/fde/projects/:projectId/repositories/:id` | — |

## 6. 工程师档案

来源：`backend/src/routes/fde/engineers.js`

| 方法 | 路径 | 功能 | 主要参数 | 权限 |
|---|---|---|---|---|
| GET | `/api/fde/engineers/:id` | 查看工程师档案 | — | engineer.view |
| PATCH | `/api/fde/engineers/:id` | 更新档案 | body: `level`, `skills`(字符串数组), `city`, `dailyRate`, `bio`, `available` | engineer.edit |

## 7. 通知（Notification）

来源：`backend/src/routes/fde/notifications.js`

| 方法 | 路径 | 功能 | 参数 |
|---|---|---|---|
| GET | `/api/fde/notifications` | 通知列表 | `unread`(true/false), `type`, `page`, `page_size` |
| GET | `/api/fde/notifications/unread-count` | 未读数 | — |
| POST | `/api/fde/notifications/:id/read` | 单条已读 | — |
| POST | `/api/fde/notifications/read-all` | 全部已读 | — |
| DELETE | `/api/fde/notifications/:id` | 删除通知（只能删自己的） | — |
| POST | `/api/fde/notifications` | 发一条**站内**通知给同事（写死只走站内信箱，不外发飞书/邮件） | body: `toUserId`(必), `title`(必), `content`, `link`；需 `notification.send` |

## 8. 知识库（Knowledge）

来源：`backend/src/routes/fde/knowledge.js`

| 方法 | 路径 | 功能 | 主要参数 | 权限 |
|---|---|---|---|---|
| GET | `/api/fde/knowledge` | 文章列表/搜索 | `keyword`, `category`, `project_id`, `page`, `page_size` | 登录即可 |
| GET | `/api/fde/knowledge/categories` | 分类字典 | — | 同上 |
| GET | `/api/fde/knowledge/:id` | 文章详情 | — | 同上 |
| POST | `/api/fde/knowledge/:id/view` | 浏览计数 | — | 同上 |
| POST | `/api/fde/knowledge` | 新建文章 | body: `title`(必), `content`(必, Markdown), `category`, `tags`, `projectId` | knowledge.create |
| PUT | `/api/fde/knowledge/:id` | 编辑文章 | 同上 | knowledge.edit |
| DELETE | `/api/fde/knowledge/:id` | 删除文章 | — | knowledge.delete |

## 9.1 交付健康度

项目列表/详情接口同步返回 `autoHealth: { light, signals[] }`；无 `project.viewFinance` 权限的角色不返「工时超投」信号。

## 12. Agent 协作（v1.6.0）

员工在后台注册自己的 Agent（一体一专属 Key），Agent 干活时把过程资源沉淀回系统。经专属 Key 的写入自动标注 Agent 来源并留活动审计。

### 12.1 Agent 注册档案 AgentProfile

| 接口 | 说明 |
| --- | --- |
| `GET /api/fde/agent-profiles` | 我的 Agent 列表（含 keyPrefix / lastActiveAt / 沉淀计数）；ADMIN 可 `?all=true` 看全员目录 |
| `POST /api/fde/agent-profiles` | 注册，body `{name, platform?, capabilities?, description?}`；**响应带专属 Key 明文，仅此一次** |
| `PATCH /api/fde/agent-profiles/:id` | 编辑基本信息 / `{status: 0\|1}` 启停（停用即 Key 失效）；本人或 ADMIN |
| `POST /api/fde/agent-profiles/:id/rotate-key` | 换 Key：旧 Key 全部吊销、发新 Key（明文仅此一次） |
| `GET /api/fde/agent-profiles/:id/activities` | 活动审计流水（该 Agent 经 MCP 的成功调用），分页 |
| `DELETE /api/fde/agent-profiles/:id` | 软删，连带吊销 Key；已沉淀资源保留 |

platform 枚举：`OPENHEX / CLAUDE_CODE / COZE / CUSTOM / OTHER`。

### 12.2 对话回传（智能助手会话扩展）

| 接口 | 说明 |
| --- | --- |
| `POST /api/fde/agent-conversations/log` | **对话整段回传**：body `{conversationId?, title?, projectId?, customerId?, messages:[{role: USER\|ASSISTANT, text, ts?}]}`；不带 conversationId 新建（source=EXTERNAL），带则续写自己名下 EXTERNAL 会话；单次 ≤500 条；挂 projectId 未给 customerId 时客户随项目带出 |
| `GET /api/fde/agent-conversations?projectId=&source=` | 我的会话列表（source: INTERNAL 站内助手 / EXTERNAL 回传） |
| `GET /api/fde/agent-conversations/project/:projectId` | 项目下全部关联会话（跨归属人，走项目数据范围）——项目详情「记录 → Agent 对话」的数据源 |
| `PATCH /api/fde/agent-conversations/:id` | 挂/摘项目、客户，改标题（仅本人；projectId 传 null 摘除） |
| `GET /api/fde/agent-conversations/:id` | 详情含消息；本人可看，或会话已挂项目且调用者有该项目数据范围 |

### 12.3 过程记录类型扩展

`ProjectRecord.type` 新增 `CHAT`（客户聊天记录）与 `RESEARCH`（研究记录），创建/列表接口不变（`/api/fde/project-records/...`）。经 Agent 专属 Key 创建的记录带 `createdByAgentId`，列表响应附 `agentName`。

## 14. 项目资产库（v2.7，#1140）

资产 = 做好了、别的项目能直接拿走用的东西（项目框架 FRAMEWORK / 架构能力 ARCH / 业务能力 BIZ），带三类产物：数据（ontology 本体）、方案（README）、界面。成熟度 L0 线索 / L1 可参考 / L2 可复制（代码在 资产仓库）/ L3 可安装。授权 RESTRICTED = 只能参考思路，不得拷贝客户代码。

**工作方式**：拆任务/开发前先 `search_assets(taskId=…)`；`get_task` 返回体里已内联 `suggestedAssets`（top3，含 loadHint）；用上了调 `record_asset_usage` 登记节省人天。

| 接口 | 说明 | 权限 |
|---|---|---|
| `GET /api/fde/assets?keyword=&layer=&maturity=&status=&authorization=&industry=&tech=&sort=usage\|updated` | 列表（非经理只看已发布 + 自己的草稿） | asset.view |
| `GET /api/fde/assets/meta` | 枚举 + 行业/技术栈筛选项 + 统计（总数/草稿/复用次数/节省人天） | asset.view |
| `GET /api/fde/assets/suggest?taskId=\|text=&limit=` | 匹配推荐：关键词命中为主，低于阈值返空，异常返空 | asset.view |
| `GET /api/fde/assets/:idOrSlug` | 详情：readme / ontology / 出处 / 版本 / 复用记录 / 关联（能力包、商城模块…） | asset.view |
| `POST /api/fde/assets` | 登记（工程师一律进 DRAFT）。RESTRICTED 不能标 L2/L3 | asset.create |
| `PUT /api/fde/assets/:id` | 修改（经理任意；登记人只能改自己的草稿） | asset.create |
| `POST /api/fde/assets/:id/publish { force? }` | 发布：扫描方案/本体，密钥样式一律拦；客户名命中需 force（记审计） | asset.manage |
| `DELETE /api/fde/assets/:id` | 软删（释放 slug） | asset.manage |
| `POST /api/fde/assets/:id/usages { projectId, taskId?, mode, savedDays?, feedback? }` | 登记复用（项目须在本人数据范围内） | asset.use |
| `DELETE /api/fde/assets/:id/usages/:usageId` | 撤销（经理或登记人） | asset.use |
| `POST /api/fde/assets/:id/versions { version, changelog?, commitSha? }` | 记一次升版 | asset.manage |
| `GET /api/fde/assets/by-project/:projectId` | 项目页：出自本项目的资产 + 本项目的复用记录 | asset.view |
| `POST /api/fde/assets/draft-from-project/:projectId { hint? }` | 项目收尾起草资产草稿（配了大模型 AI 起草 ≤3 个，否则生成骨架），一律 DRAFT | asset.create |

## 15. 创意中心（v2.10.0，#1180）

来源：`backend/src/routes/fde/ideas.js`、`backend/src/services/ideas.js`

面向全公司的想法与需求广场，不绑定项目：话题 → 想法 → 讨论 → 分配到项目转成里程碑。**工程师可以看、发、评论、点赞、让 AI 总结；转里程碑是经理/管理员动作（403 不重试）。**

| 接口 | 说明 | 权限 |
|---|---|---|
| `GET /api/fde/ideas/topics` | 话题列表 + 各自想法数（`archived=true` 不能再发新想法） | idea.view |
| `POST /api/fde/ideas/topics { name, description?, icon? }` | 开话题（同名返回 9003） | idea.create |
| `PUT /api/fde/ideas/topics/:id { name?, description?, icon?, archived? }` | 改话题 / 归档（创建人或管理者） | idea.create |
| `DELETE /api/fde/ideas/topics/:id` | 只能删空话题（有想法返回 9003） | idea.create |
| `GET /api/fde/ideas?topicId=&status=&keyword=&mine=true&sort=active\|new\|hot&page=&page_size=` | 想法列表，返回摘要 `excerpt` 不含全文；status: OPEN/ADOPTED/PARKED | idea.view |
| `POST /api/fde/ideas { topicId, title, content, attachments? }` | 发想法；content 为 Markdown，`@姓名` 通知同事 | idea.create |
| `GET /api/fde/ideas/:id` | 全文 + `comments[]` + `aiSummary` + 去向 `project`/`milestone`（项目不在调用者数据范围内时为 null）+ `can{edit,manage,convert}` | idea.view |
| `PUT /api/fde/ideas/:id` | 作者或管理者改 title/content/topicId/attachments；仅管理者可改 `status`(OPEN/PARKED) 与 `pinned` | idea.create |
| `DELETE /api/fde/ideas/:id` | 软删（作者或管理者） | idea.create |
| `POST /api/fde/ideas/:id/like` | 点赞开关，返回 `{ liked, likeCount }` | idea.create |
| `POST /api/fde/ideas/:id/comments { content, parentId? }` | 评论 / 回复（讨论只有两层） | idea.create |
| `DELETE /api/fde/ideas/:id/comments/:commentId` | 删评论（评论作者或管理者） | idea.create |
| `POST /api/fde/ideas/:id/ai-summary` | AI 总结讨论并存到想法上；未配大模型返回 400 `code=4101` | idea.create |
| `POST /api/fde/ideas/:id/ai-milestone-draft { projectId? }` | AI 起草里程碑 `{ name, goal, description, openQuestions }`，不落库 | idea.convert |
| `POST /api/fde/ideas/:id/convert { projectId, milestoneId? \| name?, goal?, description?, plannedDate?, ownerId? }` | 想法 → 里程碑（新建或并入已有）；想法置 ADOPTED；已转过返回 9003；还需 milestone.manage 且项目在数据范围内 | idea.convert |

## 错误处理建议（给智能体的兜底策略）

| HTTP 状态 | 含义 | 智能体应对 |
|---|---|---|
| 400 | 参数缺失/非法 | 检查必填字段后重试，或向用户追问缺失信息 |
| 401 | 未登录/token 过期 | 提示用户重新登录 |
| 403 | 无权限/越权访问 | 告知用户该操作需要经理/管理员权限，不要重试 |
| 404 | 资源不存在 | 先用列表接口按关键词重新查找确认 ID |
| 409/422 | 状态机冲突（如修改已审批的工时） | 向用户解释当前状态不允许该操作 |
