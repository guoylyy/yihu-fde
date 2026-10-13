# 02 · FDE 工程师职责清单与数据记录规范（核心文档）

> 本文档回答两个问题：**FDE 工程师在系统里要干哪些事？每件事必须记录哪些数据？**
> 每项职责都标注了对应的 API（详细参数见 `03-api-reference.md`）。
> 智能体的目标：用户用自然语言说一句话，智能体收集齐必填数据 → 调对应接口完成操作。

---

## 职责总览（按使用频率排序）

| # | 职责 | 频率 | 核心接口 |
|---|---|---|---|
| 1 | 填报工时 | 每天 | `POST /api/fde/timesheets` |
| 2 | 更新任务状态 / 勾选子任务 | 每天 | `POST /api/fde/tasks/:id/status` |
| 3 | 查看我的项目 / 任务 / 通知 | 每天 | `GET /api/fde/me` 等 |
| 5 | 上报项目问题（Issue） | 遇到即报 | `POST /api/fde/projects/:id/issues` |
| 6 | 上报项目风险（Risk） | 遇到即报 | `POST /api/fde/projects/:id/risks` |
| 9 | 沉淀知识库文章 | 项目结束/踩坑后 | `POST /api/fde/knowledge` |
| 10 | 维护个人档案与技能 | 偶尔 | `PATCH /api/fde/engineers/:id` |
| 11 | 更新里程碑进度 | 里程碑节点 | `PUT .../milestones/:id` |
| 13 | 登记项目代码仓库 | 项目启动时 | `POST .../repositories` |

---

## 1. 填报工时（最高频，每日必做）

**业务场景**：工程师每个工作日结束后记录当天在哪个项目干了什么、干了几小时。工时是项目成本核算与人力投入统计的依据，**必须真实、及时、内容具体**。

**必须记录的数据**：

| 字段 | 必填 | 类型/格式 | 说明与采集话术 |
|---|---|---|---|
| `projectId` | ✅ | 数字 ID | 用户通常说项目名，智能体先 `GET /api/fde/projects?keyword=` 查 ID；如果用户只参与一个项目可默认 |
| `workDate` | ✅ | YYYY-MM-DD | 用户说"今天/昨天/周五"要换算成具体日期 |
| `hours` | ✅ | 数字，0.25 步进，一般 ≤ 12 | "干了一天"= 8；"半天"= 4 |
| `workContent` | ✅ | 文本 | 工作内容描述，要具体（做了什么模块/解决了什么问题），不能只写"开发" |
| `location` | ❌ | 文本 | 如"客户现场-上海"、"远程"；出差时建议填 |
| `engineerId` | ❌ | 数字 ID | 不传默认记本人，智能体不要传 |

**流程**：创建后状态为 SUBMITTED（当前系统默认创建即提交），等项目经理审批 → APPROVED / REJECTED。被驳回后可修改重提。

**智能体注意**：
- 已审批（APPROVED）的工时不能改，用户要改需联系经理。
- 一天可以给多个项目分别记工时，但要提醒用户当日总时长是否合理（>12h 提示确认）。
- 补录多天工时时，逐天调接口创建。

**典型用户表达**："帮我记一下今天的工时，在 XX 项目干了 8 小时，主要做数据对接调试" / "上周三到周五都在客户现场部署，每天 8 小时"

---

## 2. 任务管理（每日）

**业务场景**：工程师查看分配给自己的任务、推进状态、拆解并勾选子任务。

**状态机**：`TODO → IN_PROGRESS → DONE → VERIFIED`（VERIFIED 由经理验收）
**优先级**：LOW / MEDIUM / HIGH / URGENT

**关键操作与数据**：

| 操作 | 接口 | 必填数据 |
|---|---|---|
| 查我的任务 | `GET /api/fde/tasks?mine=true&status=` | — |
| 开始做某任务 | `POST /api/fde/tasks/:id/status` | `status: "IN_PROGRESS"` |
| 完成任务 | 同上 | `status: "DONE"` |
| 更新任务描述/截止日 | `PUT /api/fde/tasks/:id` | 变更字段 |
| 拆子任务 | `POST /api/fde/subtasks` | `taskId`, `title` |
| 勾选子任务完成 | `PUT /api/fde/subtasks/:id` | `done: true` |

**智能体注意**：工程师只能改自己名下任务的状态；创建/删除任务需要 project.edit 权限（工程师没有），用户要新建任务时告知需请经理创建，或引导用户在项目里提 Issue。

**典型用户表达**："我今天有哪些任务" / "把数据清洗那个任务标记为完成" / "给部署任务加三个子任务：装环境、导数据、冒烟测试"

---

## 3. 查看个人工作台 / 项目 / 通知（每日）

**业务场景**：了解"我现在有什么活、项目进展如何、有没有新通知"。

| 需求 | 接口 |
|---|---|
| 我的整体情况（项目+本月工时+待办+可用性） | `GET /api/fde/me` |
| 我参与的项目列表 | `GET /api/fde/projects` |
| 某项目详情（成员/里程碑/任务/问题/风险） | `GET /api/fde/projects/:id` |
| 未读通知 | `GET /api/fde/notifications?unread=true`，读后 `POST /:id/read` |
| 本月工时统计 | `GET /api/fde/timesheets?from=&to=` 或 `_meta/summary` |

**智能体注意**：会话开始或用户问"我今天要干嘛"时，先拉 `/api/fde/me` + 未读通知，汇总成一段话（今日任务 X 个、待审工时 X 条、未读通知 X 条）。

---

## 5. 上报项目问题 Issue（遇到即报）

**业务场景**：实施中发现缺陷、阻塞、客户投诉等，记录到项目问题清单，供团队跟踪解决。

**必须记录的数据**（`POST /api/fde/projects/:projectId/issues`）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 问题标题，一句话 |
| `description` | ❌(建议) | 复现步骤/影响范围/期望结果 |
| `severity` | ❌ | LOW/MEDIUM(默认)/HIGH/CRITICAL — 智能体根据描述建议级别，CRITICAL 要跟用户确认 |
| `status` | ❌ | 默认 OPEN；解决后更新为 RESOLVED |

**后续操作**：`PUT .../issues/:id` 更新状态（OPEN → IN_PROGRESS → RESOLVED → CLOSED）。

**典型用户表达**："记个问题：客户环境的接口老是超时，影响挺大的" / "把上次那个超时问题标记为已解决"

---

## 6. 上报项目风险 Risk

**业务场景**：识别到可能影响交付的隐患（客户数据没准备好、关键人员请假、需求蔓延等），提前登记并给出缓解措施。

**必须记录的数据**（`POST /api/fde/projects/:projectId/risks`）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 风险名 |
| `description` | ❌(建议) | 风险详情 |
| `probability` | ❌ | 发生概率 LOW/MEDIUM/HIGH |
| `impact` | ❌ | 影响程度 LOW/MEDIUM/HIGH |
| `mitigation` | ❌(建议) | 缓解措施 — 智能体应主动追问"打算怎么应对？" |
| `status` | ❌ | IDENTIFIED(默认) → MONITORING → MITIGATED → CLOSED |

**典型用户表达**："记个风险：客户的测试数据到现在还没给，可能拖延验收，概率挺高的"

---

## 9. 知识库沉淀（项目结束/踩坑后）

**业务场景**：把项目经验、故障排查、客户案例写成文章沉淀，供团队检索复用。

**必须记录的数据**（`POST /api/fde/knowledge`）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✅ | 文章标题 |
| `content` | ✅ | 正文，Markdown |
| `category` | ❌ | 分类（先 `GET /api/fde/knowledge/categories` 拿字典） |
| `tags` | ❌ | 标签数组 |
| `projectId` | ❌ | 关联项目 |

**智能体加分项**：可以根据用户口述的踩坑经过，帮用户起草结构化文章（背景/现象/排查/解决/预防）再确认发布。查资料场景：`GET /api/fde/knowledge?keyword=`。

**典型用户表达**："把这次 XX 客户数据库迁移的坑整理成知识库文章" / "知识库里搜一下有没有人写过飞书对接"

---

## 10. 个人档案与技能维护（低频）

**接口**：`PATCH /api/fde/engineers/:id`（本人的 engineerId）

| 字段 | 说明 |
|---|---|
| `level` | JUNIOR/MIDDLE/SENIOR/EXPERT（一般由管理侧定） |
| `skills` | 技能数组 |
| `city` | 常驻城市 |
| `bio` | 个人简介 |
| `available` | 1=可派工 / 0=不可派工 |

**典型用户表达**："给我的档案加一个 Kubernetes 技能" / "我常驻城市改成杭州"

---

## 11. 里程碑进度更新

**业务场景**：里程碑完成时更新实际日期和状态（通常经理做，工程师有 project.edit 才行——默认没有，智能体遇到 403 时告知用户请经理操作）。

**数据**（`PUT .../milestones/:id`）：`status`(PENDING/IN_PROGRESS/COMPLETED/DELAYED), `actualDate`。

## 12. 登记项目代码仓库

**数据**（`POST .../repositories`）：`name`, `url`, `provider`(GITEE/GITHUB/GITLAB/OTHER), `defaultBranch`。同样需要 project.edit 权限，403 时引导找经理。

---

## 工程师"只读"关注项（智能体可查询但不可操作）

| 事项 | 接口 | 说明 |
|---|---|---|

## 工程师做不了的事（智能体必须婉拒并指路）

- 创建/删除项目、增删项目成员 → 找项目经理
