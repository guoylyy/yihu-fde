# OpenClaw 接入 MCP 教程

本文演示把FDE 系统接入 OpenClaw，让你在任何 OpenClaw 频道（终端、微信桥接等）里直接指挥系统：查项目、填工时、报工单。

> 端点、鉴权方式、工具清单等通用信息见《MCP 智能体接入指南》，本文只讲 OpenClaw 侧的配置。

## 前提

- 已安装 OpenClaw（`openclaw --version` 能出版本号）
- 已准备好凭证，二选一：
  - **以虎 One API Key**：在以虎 One「个人中心 → API Key」生成，连以虎 One 的 MCP 网关 `<以虎 One 地址>/api/mcp`（FDE 工具名带 `fde__` 前缀）；机器人用「Agent 协作」里注册后发的 Agent 专属 Key（`fde_` 前缀）直连 `<FDE 地址>/api/mcp`
  - **登录 Token**：`POST /api/auth/login` 返回的 JWT

OpenClaw 是长期挂机形态，推荐 API Key。

## 方式一：直接发给智能体（最省事）

OpenClaw 的智能体自己就能执行命令——把端点和凭证发给它，让它自己完成接入。在你的 OpenClaw 私聊频道里发：

```text
帮我接入FDE 系统的 MCP 服务：
- 端点：<以虎 One 地址>/api/mcp
- 凭证：你的以虎 One API Key（或机器人的 Agent 专属 Key）

用 openclaw mcp add 添加（server 名叫 fde，transport 用 streamable-http，
凭证放 Authorization: Bearer 请求头），添加时会自动探活。
成功后调用 get_my_workbench 验证身份，告诉我你看到的是谁的工作台。
```

智能体应回报探活成功、并说出你的名字和待办——身份对上就接完了。

> ⚠️ **只在自己的私聊频道发**。桥接的群聊/对外频道里发 Key，等于把你的账号交给群里所有人。
> 对话记录会留存这个 Key，介意的话事后到「API Key 管理」吊销重签一个。

## 方式二：CLI 一条命令

`openclaw mcp add` 会在保存前先探活，配置错了当场就知道：

```bash
openclaw mcp add fde \
  --url <以虎 One 地址>/api/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer <你的以虎 One API Key>" \
  --connect-timeout 5 --timeout 30
```

常用配套命令：

```bash
openclaw mcp list        # 看已配置的 server
openclaw mcp probe       # 连一遍所有 server, 列出能拿到的工具
openclaw mcp doctor      # 静态体检配置问题
openclaw mcp reload      # 改完配置后让下一轮对话生效, 不用重启
```

## 方式三：直接编辑配置文件

`~/.openclaw/openclaw.json` 的 `mcp.servers` 里加一项：

```json
{
  "mcp": {
    "servers": {
      "fde": {
        "url": "<以虎 One 地址>/api/mcp",
        "transport": "streamable-http",
        "headers": {
          "Authorization": "Bearer <你的以虎 One API Key>"
        },
        "connectTimeout": 5,
        "timeout": 30
      }
    }
  }
}
```

改完执行 `openclaw mcp reload`（或重启 gateway）生效。

## 验证

```bash
openclaw mcp probe
```

应能看到 `fde` 下列出 100 个工具。然后在任意频道对话验证：

> 「看下我的工作台，今天有什么待办」

智能体应调用 `get_my_workbench` 返回你本人的数据；`list_projects` 只会看到你参与的项目——权限与数据范围由服务端按凭证身份兜底。

## 排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `mcp add` 探活失败 | URL 不通 / 凭证无效 | 先 `curl` 端点（见接入指南）；确认 Key 未吊销 |
| probe 拿不到工具 | 传输类型不对 | `--transport streamable-http`（不是 sse） |
| 调用返回 401 | Key 被吊销 / Token 过期 | 换新凭证后 `openclaw mcp reload` |
| 调用返回 403 | 操作超出角色权限 | 正常行为——转交对应角色，不要重试 |
| 改了配置不生效 | 运行时缓存 | `openclaw mcp reload` |

## 安全提醒

- API Key 等同你的账号身份：不要提交进仓库或贴到群聊；OpenClaw 桥接了对外频道（如微信）时，注意谁能对它说话——**能对话的人就能以你的身份操作系统**，建议用 `--include`/`--exclude` 收窄暴露的工具面。
- 怀疑泄露立即去系统「API Key 管理」吊销。
- 删除类、签收类等不可逆动作，智能体会先跟你确认——确认前想清楚。
