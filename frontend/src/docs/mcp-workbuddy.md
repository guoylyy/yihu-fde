# WorkBuddy 接入 MCP 教程

本文演示把FDE 系统接入 WorkBuddy 桌面端，让 WorkBuddy 里的智能体直接查项目、填工时、报工单。

> 端点、鉴权方式、工具清单等通用信息见《MCP 智能体接入指南》，本文只讲 WorkBuddy 侧的配置。

## 前提

- 已安装 WorkBuddy 桌面端（配置目录为 `~/.workbuddy/`）
- 已准备好凭证，二选一：
  - **个人 API Key**（`fde_` 前缀）：在系统「API Key 管理」里创建，明文只显示一次
  - **登录 Token**：`POST /api/auth/login` 返回的 JWT（有效期 7 天，勾选自动登录为 30 天）

长期挂机使用推荐 API Key——Token 过期后要手动换，Key 不吊销就一直有效。

## 方式一：直接发给智能体（最省事）

WorkBuddy 的智能体能读写本机文件——把端点和凭证发给它，让它自己把配置写好。在 WorkBuddy 对话里发：

```text
帮我接入FDE 系统的 MCP 服务：
- 端点：https://<系统域名>/api/mcp
- 凭证：fde_你的Key

请把它写进 ~/.workbuddy/.mcp.json 的 mcpServers（条目名 fde，type 用 http，
凭证放 headers 的 Authorization: Bearer）。注意只新增条目、别动已有的 server，
写完校验一下 JSON 语法，然后提醒我重启 WorkBuddy。
```

重启后再发一句「看下我的工作台」验证——智能体调用 `get_my_workbench` 返回你本人的待办，就接完了。

> ⚠️ 只在自己的对话里发 Key，别发进群聊。对话记录会留存这个 Key，介意的话事后到「API Key 管理」吊销重签一个。

## 方式二：手动配置

### 1. 编辑 MCP 配置文件

打开（没有就新建）`~/.workbuddy/.mcp.json`，在 `mcpServers` 里加一个条目：

```json
{
  "mcpServers": {
    "fde": {
      "type": "http",
      "url": "https://<系统域名>/api/mcp",
      "headers": {
        "Authorization": "Bearer fde_你的Key"
      },
      "description": "FDE 平台（项目/工时/任务）"
    }
  }
}
```

- 已有其他 server（如 `connector-proxy`、`notion`）时**只增不删**，在同级并列加一项即可。
- `type` 用 `http`（平台端是 Streamable HTTP 无状态模式，纯 POST + JSON 返回）。

### 2. 重启 WorkBuddy

配置文件在启动时读取，改完重启桌面端生效。

### 3. 验证

在对话里问一句需要动工具的话，例如：

> 「看下我的工作台，今天有什么待办」

智能体应调用 `get_my_workbench` 并返回你本人的数据。首次调用如弹出工具授权提示，允许即可。

## 排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 工具列表里没有平台的工具 | 配置文件 JSON 语法错误，或没重启 | 校验 JSON（注意逗号），重启 WorkBuddy |
| 调用返回 401 | Key 被吊销 / Token 过期 / Header 格式不对 | 确认 `Authorization: Bearer fde_xxx` 完整；换新凭证 |
| 调用返回 403 | 该操作超出你的角色权限 | 正常行为——转交对应角色处理，不要重试 |
| 连接超时 | 域名不通或走了内网地址 | 用生产域名；先 `curl` 端点验证连通性（见接入指南） |

## 安全提醒

- API Key 等同你的账号身份：**不要**提交进代码仓库、贴到群聊或共享配置里。
- 怀疑泄露时，去系统「API Key 管理」立即吊销并换新——服务端只存哈希，吊销即失效。
- 智能体以你的身份操作，删除类、签收类等不可逆动作在确认前想清楚。
