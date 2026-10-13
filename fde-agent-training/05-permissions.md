# 05 · FDE_ENGINEER 权限矩阵与数据范围

> 来源：`backend/src/lib/auth.js`（PERMISSIONS 常量 + buildScopeWhere）。
> 用途：让智能体知道哪些操作能做、哪些必然 403，避免发起注定失败的调用，并能向用户正确解释。

## 功能权限矩阵（✓=有权限 ✗=无权限）

### 工时
| 权限 | FDE_ENGINEER | 无权限时找谁 |
|---|:---:|---|
| timesheet.view / create / edit / submit | ✓ | — |
| timesheet.approve | ✗ | 经理/管理员 |
| timesheet.delete | ✗ | 经理/管理员 |

### 项目
| 权限 | FDE_ENGINEER | 说明 |
|---|:---:|---|
| project.view | ✓ | 仅自己参与的项目 |
| project.create / edit / delete | ✗ | 经理/销售创建，经理编辑 |
| project.manageMembers | ✗ | 经理 |

### 任务（v1.4.x 起工程师可自建）
| 权限 | FDE_ENGINEER | 说明 |
|---|:---:|---|
| task.view / edit / changeStatus | ✓ | 状态流转到 DONE 为止，VERIFIED 由经理验收 |
| **task.create** | **✓（v1.4.x 放开）** | 个人任务管理/MCP 智能体场景，可给自己建任务（assigneeUserId=本人） |
| task.delete | ✗ | 经理/销售 |
| 子任务增删改 / 评论 / 附件 | ✓ | 附件先 upload_file 传七牛拿 url |

> ⚠️ 里程碑/Issue/Risk/仓库的增改接口分别挂 `milestone.manage`/`issue.manage`/`risk.manage`/`project.edit` 权限——**默认工程师调用会 403**。智能体应先尝试，403 后解释"该项目操作需经理权限"。（Issue/Risk 上报如果实际业务需要工程师可写，需要后端调整权限位——见 09-open-questions。）

### 知识库
| 权限 | FDE_ENGINEER | |
|---|:---:|---|
| knowledge.view / create / edit | ✓ | |
| knowledge.delete | ✗ | 经理 |

### 其他
| 权限 | FDE_ENGINEER | |
|---|:---:|---|
| me.view（个人工作台） | ✓ | |
| report.export | ✓ | |
| engineer.view（工程师列表） | ✗ | 但可看/改自己档案 |
| skill.manage | ✗ | |
| user.view（用户管理） | ✗ | |
| team.manage（团队管理, v1.5.6） | ✗ | ADMIN/PLATFORM；团队清单 `GET /api/fde/teams` 登录即可（只读），归属由管理员在用户管理/团队管理设置，本人不可自改 |

## 数据范围（buildScopeWhere，后端强制）

> **v1.3.2 角色入库**：角色清单不再硬编码，来自 `roles` 表（`GET /api/fde/roles`），管理员可在
> 后台「基础配置 → 角色管理」新建角色。数据范围由角色的 `dataScope` 属性决定：
> `OWN_RECORDS`（个人型，FDE_ENGINEER 即此档）。SALES 在 OWN_RECORDS 之上保留「自己创建的」特判。
> 权限矩阵（role_permissions）可给任意角色配权限点；智能体遇到未知角色 code 时按其 dataScope 推断可见面。
> 下表为 FDE_ENGINEER（OWN_RECORDS）的具体行为，v1.3.2 前后不变：

| 数据 | FDE_ENGINEER 可见范围 | 实现方式 |
|---|---|---|
| 项目 | 自己是成员的项目 | ProjectMember 中 userId/engineerId 匹配 |
| 任务 | 自己参与项目的任务（1.2.5 起，之前误放全量） | 任务列表/详情套项目范围过滤 |
| 工时 | 自己的 | engineerId 匹配 |

## 智能体错误话术模板

| 场景 | 建议回复 |
|---|---|
| 403 项目编辑类 | "这个操作需要项目经理权限，我帮你不了，建议在群里@项目经理处理。需要我帮你整理一段说明文字发给经理吗？" |

## 管理侧工具的权限门槛（MCP 工具补全）

工具集里现在也暴露了经理/管理员才做得了的动作。**工具能看见 ≠ 能调用**，后端一律按角色兜底：

| 权限 | FDE_ENGINEER | 用到它的工具 |
| --- | :---: | --- |
| project.create / project.edit | ✗ | `create_project`、`update_project` |
| project.manageMembers | ✗ | `add_project_member`、`remove_project_member` |
| milestone.manage | ✗ | `create_milestone`、`update_milestone`、`close_milestone`、`delete_milestone` |
| issue.manage / risk.manage | ✗ | `report_issue`、`update_issue`、`delete_issue`、`report_risk`、`update_risk`、`delete_risk` |
| task.delete | ✗ | `delete_task` |
| timesheet.approve | ✗ | `approve_timesheet` |
| notification.send | ✗ | `send_notification`（ADMIN/PLATFORM/MANAGER） |
| asset.manage（v2.7） | ✗ | 资产发布/删除/关联走 REST；工程师有 asset.view / asset.create / asset.use，所以 `search_assets`、`get_asset`、`propose_asset`（进草稿）、`record_asset_usage` 都能调 |

只读类的 `list_milestones` / `list_issues` / `list_risks` / `list_project_tasks` / `get_timesheet_summary`
跟随 `project.view` 与数据范围：工程师查得到，但只查得到自己参与的项目。
