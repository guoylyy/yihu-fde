# 开发机器人接入：看板派工自动开发

> v2.9.0 · 需求与开发解耦：人在路径图上点「派工」，机器人领活干，进度实时推回画布。
> 配套阅读：[里程碑路径图](/docs/roadmap)（派工的对象就是路径图上的任务）、[多项目自动开发模式](/docs/auto-dev)（旧的「巡检拉 QUEUED」模式仍作兜底）。

## 1. 它和以前的自动开发有什么不同

| | 巡检模式（v2.0） | 派工模式（v2.9） |
|---|---|---|
| 谁决定做什么 | 机器每 10 分钟自己拉 QUEUED 任务 | 人在路径图上选范围点「▶ 派工」 |
| 顺序 | 按优先级随机 | 按路径图**拓扑序**，前置没完成的不会被领 |
| 多台机器 | 各自拉，可能撞 | 服务端**原子领取**，一台一次只干一件，天然并行 |
| 进度 | 只有任务状态 | 阶段 + 百分比 + 事件流，画布节点上实时可见 |
| 失败 | 任务卡在生产中 | 任务回等候生产，可重试/重派/换机器人 |
| 失联 | 无感知 | 30 分钟标失联，2 小时自动释放给别的机器人 |

## 2. 概念

- **机器人** = 「Agent 协作」里的一个 Agent 档案（平台选 `CLAUDE_CODE`，能力标签写 `dev-robot`）+ 它的专属 API Key。在线态靠心跳。
- **派工单** = 一次「启动」：项目 + 里程碑 + 一批任务 + 指定机器人（或任意）+ 给机器人的备注。
- **运行** = 派工单里每个任务一条：谁领的、进度、阶段、事件、结果（commit / PR / 测试）、失败原因。

## 3. 三步接入一台机器

**① 建档拿 Key**：管理后台 → Agent 协作 → 注册 Agent：名字（如「开发机器人 A」）、平台 `CLAUDE_CODE`、能力标签 `dev-robot`。Key 明文只显示一次。

**② 配 MCP**：在那台机器的 Claude Code 里把平台 MCP 加上，鉴权头用这把 Key：

```bash
claude mcp add --scope user fde --transport http https://<your-domain>/api/mcp --header "Authorization: Bearer fde_xxx"
```

**③ 起循环**：仓库里有现成的 prompt `.claude/skills/fde-tasks/robot-prompt.md`。在项目仓库目录下：

```bash
/loop 2m 按 .claude/skills/fde-tasks/robot-prompt.md 跑一轮派工
```

或者交给系统定时器：

```bash
*/2 * * * * cd /path/to/repo && claude -p "$(cat .claude/skills/fde-tasks/robot-prompt.md)" >> /var/log/robot.log 2>&1
```

机器人每一轮：`report_presence` → `claim_dev_run` → 有活就开发并按阶段 `report_dev_run_progress` → `complete_dev_run` / `fail_dev_run` → 结束本轮。没活就结束。

## 4. 人这边怎么用

1. 打开项目 → 规划 Tab → 右上「▶ 派工」。
2. 选范围：**里程碑全部未完成**（按拓扑序全部入队）/ **只派可开始的** / **勾选的任务**（列表视图勾选）。
3. 选机器人：指定某一台，或留空「任意在线机器人可领」。写备注（只改哪个目录、接口风格照哪个文件、完成后不要发布……机器人会把备注当最高优先级约束）。
4. 点启动。画布上任务节点出现「⏳ 排队待机器人」，机器人领走后变「🤖 名字 · 阶段 45%」带进度条，完成变「🤖✅」，失败「🤖❌」，失联「📡」。
5. 点节点看侧栏：进度、阶段消息、事件时间线、结果（commit 链接、PR、测试）、「取消运行」「重派」。
6. 右上「🤖 机器人」抽屉：本项目派工单（暂停 / 继续 / 取消、运行明细）、在线机器人及其当前活。派工单全部到终态后发起人会收到站内通知。

**边界**：机器人不改任务负责人（任务仍归人），不发生产，不替经理点「已验收」。完成后走原来的 DONE → 经理验收 → 发布。

## 5. 机器人侧 MCP 工具

| 工具 | 作用 |
|---|---|
| `claim_dev_run {projectId?}` | 领活：服务端挑第一条 PENDING 且前置都完成的运行，任务置 IN_PROGRESS，返回 `run` + `context`（项目/里程碑完成定义/仓库/任务与子任务/上下游/派工备注/howto） |
| `report_dev_run_progress {runId, progress, phase, message}` | 进度 + 心跳；409/9009 表示运行已取消或释放 |
| `complete_dev_run {runId, summary, commits, branch, prUrl, testResult}` | 任务 DONE，评论写摘要与提交，派工单收口 |
| `fail_dev_run {runId, error, retryable}` | 任务回 QUEUED；`retryable` 且尝试少于 3 次自动重排 |
| `list_dev_dispatches` / `create_dev_dispatch` | 人在聊天里看进展 / 启动派工（调用前复述范围） |

REST 对应 `/api/fde/dev-dispatches`（人侧：`GET /`、`POST /`、`GET /:id`、`POST /:id/pause|resume|cancel`、`GET /runs/:id`、`POST /runs/:id/cancel|redispatch`、`GET /robots`；机器人侧：`POST /runs/claim`、`POST /runs/:id/progress|complete|fail`）。经理/管理员可在 `claim` 时传 `agentProfileId` 代某台机器人领活，用于演练。

## 6. 数据口径

`dev_dispatches`（RUNNING/PAUSED/DONE/CANCELLED）→ `dev_runs`（PENDING/RUNNING/SUCCEEDED/FAILED/CANCELLED，含 progress/phase/message/result/error/attempts/heartbeat_at）→ `dev_run_events`（每次上报一条）。路径图接口 `GET /projects/:id/roadmap` 返回 `runs`（taskId → 最新运行摘要，含 `stale`）与 `dispatches`。
