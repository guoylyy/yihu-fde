# 04 · 数据字典（FDE 工程师视角）

> 说明：所有 ID 为 BigInt（JSON 中序列化为字符串）；金额为 Decimal(12,2)，单位元；大多数表软删（`deletedAt` 非空 = 已删除）。

## 身份类

### User（登录账号）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BigInt | 用户 ID（userId） |
| username | String | 登录名，唯一 |
| name | String | 真实姓名 |
| phone / email | String? | 联系方式 |
| status | Int | 1=激活 0=禁用 |
| mustChangePassword | Boolean | 首登强制改密 |

### Engineer（工程师档案）— 与 User 一对一
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | BigInt | 关联 User（裸字段） |
| level | String? | JUNIOR / MIDDLE / SENIOR / EXPERT |
| skills | Json? | 技能冗余（主数据在 EngineerSkill） |
| city | String? | 常驻城市 |
| dailyRate | Decimal? | 日费率（元）— 敏感，管理侧维护 |
| bio | String? | 简介 |
| available | Int | 1=可派工 0=不可 |

### EngineerSkill / Skill（技能）
- Skill：`name`(唯一)、`category`(FRONTEND/BACKEND/DEVOPS/DATA/PM/MOBILE...)
- EngineerSkill：`engineerId` + `skillId` 唯一，`level`(1-5)、`yearsExp`(年数)

## 项目类

### Project（项目）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | BigInt | 项目 ID |
| code | String | 唯一编号 `FDE-2026-0001` |
| name | String | 项目名 |
| customerId | BigInt | 客户 |
| type | String? | NEW / UPGRADE / MAINTENANCE / TRAINING |
| status | enum | DRAFT → PROPOSAL → APPROVED → IN_PROGRESS → ACCEPTED → CLOSED（另 CANCELLED）⚠️ 验收态叫 ACCEPTED 不是 DELIVERED |
| managerId | BigInt? | 项目经理（User） |
| startDate / endDate | Date? | 起止 |
| budget / actualCost | Decimal | 预算/实际成本（1.2.5 起对 FDE_ENGINEER 接口直接不返回该字段） |
| health | String | GREEN / YELLOW / RED |
| progress | Int | 0-100 |

### ProjectMember（项目成员）
| 字段 | 说明 |
|---|---|
| projectId + userId | 唯一约束 |
| engineerId? | 已弃用，兼容保留 |
| roleInProject | PM / ARCHITECT / DEV / QA / OBSERVER / FDE / CLIENT（默认 MEMBER） |
| joinDate / leaveDate | **leaveDate=null 表示在职**（本表无软删字段） |

### Milestone（里程碑）
`name`、`goal`(v2.8.0 完成定义, 路径图终点上展示)、`plannedDate`、`actualDate`、`status`(PENDING/IN_PROGRESS/COMPLETED/DELAYED)、`sortOrder`

### Task（任务）
| 字段 | 说明 |
|---|---|
| projectId / milestoneId? | 归属 |
| title / description | 内容 |
| assigneeId | 负责人（userId） |
| status | TODO / QUEUED / IN_PROGRESS / DONE / VERIFIED / REWORK |
| priority | LOW / MEDIUM / HIGH / URGENT |
| dueDate / completedAt | 截止/完成时间 |
| source | CUSTOMER / REVIEW / PATROL / SELF / AI(v2.8.0 路径图 AI 面板落库) |

Subtask（子任务）：`taskId`、`title`、`done`(Boolean)、`order`

### TaskDependency（任务依赖边，v2.8.0）
| 字段 | 说明 |
|---|---|
| predecessorId → successorId | 前置(先做) → 后继(后做)，同一项目内 |
| type | BLOCKS 硬依赖(前置未 DONE/VERIFIED 则后继 blocked；BLOCKS 边构成的图必须无环) / FEEDBACK 回环软边(只表达迭代意图, 不阻塞不参与环检测) |
| note | 说明 |

派生量（不落库，`roadmap` 接口实时算）：`blocked` = 未完成且有未完成的 BLOCKS 前置；`ready` = TODO/QUEUED/REWORK 且不 blocked；`criticalPath` = 未完成节点按 plannedStart~End 天数(缺省 1 天)加权的最长链。

### Issue（问题）
`title`、`description`、`severity`(LOW/MEDIUM/HIGH/CRITICAL)、`status`(OPEN/IN_PROGRESS/RESOLVED/CLOSED)、`reporterId`、`assigneeId?`、`resolvedAt?`

### Risk（风险）
`title`、`description`、`probability`(LOW/MEDIUM/HIGH)、`impact`(LOW/MEDIUM/HIGH)、`status`(IDENTIFIED/MONITORING/MITIGATED/CLOSED)、`mitigation`(缓解措施)、`ownerId?`

### ProjectRepository（代码仓库）
`name`、`url`、`provider`(GITEE/GITHUB/GITLAB/OTHER)、`defaultBranch?`、`description?`

## 工时类

### Timesheet（工时）⭐ 最高频
| 字段 | 类型 | 说明 |
|---|---|---|
| projectId | BigInt | 项目 |
| engineerId | BigInt | 工程师 |
| workDate | Date | ⚠️ 字段叫 workDate 不是 date |
| hours | Decimal | 小时数，0.25 步进 |
| workContent | Text | 工作内容（必填、要具体） |
| location | String? | 工作地点 |
| status | String | DRAFT / SUBMITTED / APPROVED / REJECTED |
| approvedBy / approvedAt | | 审批人/时间 |

## 交付类

### KnowledgeArticle（知识库文章）
`title`、`content`(Markdown 长文本)、`category?`、`tags`(Json 数组)、`projectId?`、`viewCount`、`createdBy`。

### Notification（站内通知）
`userId`(接收人)、`type`(如 TASK_ASSIGNED / TIMESHEET_APPROVED)、`title`、`body?`、`link?`、`readAt?`(null=未读)

### Activity（操作流水，系统自动记）
`actorId`、`entity`(project/task/timesheet/...)、`entityId`、`action`(created/updated/status_changed/approved/...)、`summary`(一句话)。写操作会自动生成，智能体无需主动写。

## 序列化注意事项（给平台对接方）

1. **BigInt ID 在 JSON 里是字符串**（后端做了 `BigInt.toJSON → string`），传参时字符串或数字均可被解析，但比较时注意类型。
2. Decimal 金额返回也是字符串形式（如 `"380.00"`）。
3. Date 字段返回 ISO 格式，入参用 `YYYY-MM-DD`。
4. 软删记录不会出现在列表里；`ProjectMember` 例外——用 `leaveDate` 判断在职。
