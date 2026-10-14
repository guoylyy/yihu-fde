---
name: fde-tasks
description: FDE 平台任务驱动开发闭环。当用户说"开工/今天做什么/拉任务/取任务"、"收工/回写任务"、"/loop 巡检模式定时自动开发"，或一次开发完成需要把结果写回平台任务系统时使用。经 MCP 读取平台任务→拆分→开发→回写状态与过程记录。
---

# 平台任务驱动工作流（员工版）

团队的标准工作方式：需求在平台任务系统里（由会议梳理生成或经理创建），开发从任务系统取目标，完成后经 MCP 写回，全程留痕。
**开发过程围绕任务转：取任务 → 拆分 → 开发 → 回写。**

## 调用方式

FDE 的工具经以虎 One 接入（`.mcp.json` 里的 `yihu-one`），名称带应用前缀 `{{APP_CODE}}__`，Claude Code 里显示为 `mcp__yihu-one__{{APP_CODE}}__<工具名>`；下文只写工具名。以当前员工身份执行，数据范围按其角色收敛。
所有 id 从工具返回里取，**不要凭猜**。

## 开工（会话开始 / 用户说"开工"）

1. `get_my_workbench` —— 获取本人 engineerId、userId 与在手项目
2. `list_my_tasks {"status":"TODO"}` + `list_my_tasks {"status":"QUEUED"}` + `list_my_tasks {"status":"IN_PROGRESS"}` —— 待办与在途
3. 向用户汇报候选任务（标题/优先级/截止日），用户点了哪个就做哪个
4. 开做前：`update_task_status {"taskId":<id>,"status":"IN_PROGRESS"}`（参数名是 taskId）

任务状态流（五态）：`TODO 收件箱 → QUEUED 等候生产（须带 plannedStartAt/plannedEndAt）→ IN_PROGRESS 生产中 → DONE 生产完成 → VERIFIED 已验收`。
验收（VERIFIED）是经理的动作，不要替经理调 `verify_task`。

## 拆分（目标 → 可执行子任务）

- **拆之前先搜资产库**（v2.7）：`get_task` 返回里的 `suggestedAssets` 先看一眼，或主动 `search_assets {"taskId":<id>}`；有能用的就 `get_asset` 看方案与数据结构，拆分时直接写「复用资产 xxx」。用上了 `record_asset_usage` 登记省了几人天；做出了别的项目也能用的东西，`propose_asset` 登记草稿
- 拿到任务先 `get_task` 读全描述，把实现路径拆成 3-8 个子任务：`create_subtask {"taskId":<id>,"title":"..."}`（已有子任务先 `list_subtasks` 别重复建）
- 每完成一个子任务 `update_subtask` 置完成；拆完在任务下评论一句拆分思路

## 过程记录（全程留痕）

- **进展/决策/踩坑**：`add_task_comment {"taskId":<id>,"content":"..."}` —— 关键节点就写，一次 2-5 句
- 附件（测试报告/截图）走 `upload_file` + `add_task_attachment`

## 收工（开发完成回写）

1. 子任务全部置完成
2. **commit message 末尾带 `#taskId`**（如 `feat: xxx #123`）——平台会自动把提交挂到任务时间线
3. 末评论汇总：做了什么、commit 号、测试结果、遗留项
4. `update_task_status {"taskId":<id>,"status":"DONE"}`
5. 用户要求时 `create_timesheet` 报工时（一天=8 小时，需与用户确认日期/时长/内容后再调）

## 巡检模式（自动开发，进阶）

项目按 [auto-dev 教程](/docs/auto-dev) 接入后（仓库有 CLAUDE.md、发布策略已拍板），用户可用 `/loop <间隔> <巡检prompt>` 把本工作流挂上定时器，AI 每 N 分钟自动取任务开发。巡检 prompt 参数化模板见 auto-dev 教程第 5 节。巡检轮的附加纪律：

1. **只取排队任务**（v2.1.10 #515）：巡检默认只拉 `status=QUEUED`（等候生产）的任务；TODO 是需求收件箱，未经 PM 排队**不自动开发**，无 QUEUED 任务时不要拉 TODO 兜底。例外：用户显式指定任务 ID 或明示「处理收件箱某任务」时照常开发
2. **安静轮**：无排队任务时只回一句「巡检无排队任务」，不展开汇报
3. **只动自己的活**：仅处理「未指派」或「指派给我」的任务，别人的任务不改状态
4. **发布按 CLAUDE.md 发布策略**：自动上线项目走部署脚本+健康检查+写 CHANGELOG；「验收后上线」项目建「生产验收」任务等人点头，**不直接动生产**
5. **连续多轮做不了的任务**（缺依赖/要拍板）：评论标注原因后跳过，不要每轮重复评论刷屏
6. **心跳报备**：每轮巡检开始时调用一次 `report_presence`（MCP 工具），上报 `projectId` + 一句话 `activity`（如「巡检项目64: 无任务」）；轮末无需额外调用——下一轮的心跳会刷新状态；巡检被人为停止时补一次 `status=OFFLINE`。平台在任务看板展示「谁正在巡检」，不上报 = 别人看不到你在干活

## 红线

- 涉及金额/工时/日期的写操作，先把要写的内容复述给用户确认再调
- `delete_*` 等不可逆动作必须拿到用户明确确认
- 403 不要重试，说明这步需要更高角色（经理/管理员），请用户转交
- 生产部署不是员工动作：开发完成到 DONE 为止，发布由经理验收后安排
