# 06 · 业务流程与状态机

> 智能体必须理解每个业务对象"当前处于什么状态、还能做什么操作"。所有状态转换都由对应接口触发，非法转换后端会拒绝。

## 1. 工时流程

```
创建(默认即 SUBMITTED 提交态)
SUBMITTED ──经理 approve(approved=true)──▶ APPROVED   （终态，不可再改）
SUBMITTED ──经理 approve(approved=false)─▶ REJECTED  ──工程师修改(PUT)后重新提交──▶ SUBMITTED
```
- 工程师能做：创建、修改（未审批的）、提交
- 智能体查询话术：SUBMITTED=等经理审、APPROVED=已通过、REJECTED=被驳回（读 rejectReason 类信息并建议修改重提）

## 4. 任务流程

```
TODO ──▶ IN_PROGRESS ──▶ DONE ──经理验收──▶ VERIFIED
```
- 工程师可改自己名下任务的状态（快捷接口 `/tasks/:id/status`）
- 子任务独立勾选 done，全部 done 不自动完成父任务，需显式改状态
- v2.9.0 派工模式（机器人身份）：每轮 `report_presence` → `claim_dev_run`（服务端按路径图前置给活）→ 分阶段 `report_dev_run_progress` → `complete_dev_run` / `fail_dev_run`；没活再巡检 QUEUED 兜底
- v2.8.0 路径图：开工前先 `get_milestone_roadmap` 读图，从 `ready`（前置都完成的）里挑任务；`blocked` 的任务要开始需说明原因（阻塞是提醒不是锁）；做完置 DONE 后再读图看解锁了谁

## 5. 项目状态（工程师只读理解）

```
DRAFT → PROPOSAL → APPROVED → IN_PROGRESS → ACCEPTED → CLOSED
                                    └──▶ CANCELLED
```
- 工时/任务一般发生在 IN_PROGRESS 阶段
- health：GREEN 正常 / YELLOW 预警 / RED 告警；progress：0-100

## 6. Issue / Risk 生命周期

```
Issue: OPEN → IN_PROGRESS → RESOLVED → CLOSED
Risk:  IDENTIFIED → MONITORING → MITIGATED → CLOSED
```

## 7. 典型"一天"的端到端流程（可作为多轮对话训练场景）

```
早：  "我今天要干嘛" → GET /me + 通知 → 汇总播报
      "开始做数据清洗任务" → tasks/:id/status IN_PROGRESS
下午："客户环境接口超时，记个问题，比较严重" → projects/:id/issues (HIGH)
晚：  "数据清洗做完了" → tasks/:id/status DONE
      "记今天工时 8小时 XX项目 内容:数据清洗与接口联调" → POST timesheets
```

## 8. 典型"一次出差"的端到端流程

```
出差中： 每日记工时(location=客户现场) + 现场问题/风险随手上报
出差后： 补齐项目记录(会议纪要/对接沟通) → 沉淀知识库文章
```
