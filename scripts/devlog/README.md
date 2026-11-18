# yh-devlog：把 Claude Code / Codex 会话推进 FDE

`yh-devlog` 读本机的 AI 编码会话记录，整理成 FDE 的「开发会话」，上报到 `POST /api/devlog/conversations`。上报的会话带 `source=CLAUDE_CODE|CODEX`、`stage=CODING`。

- 按 `uid` 幂等：同一个会话报多少次，平台上都只有一条，内容取最新一次。uid 是 `claude:<sessionId>` 或 `codex:<会话 id>`。
- 正文（用户 / 助手的文字）一定会上报。发出去之前客户端先脱敏一遍（规则见 `redact.js`），服务端入库前再脱敏一遍。
- 只读会话记录，不读代码文件。执行过的命令记为 `COMMAND` 事件，改过的文件只记路径，记为 `ARTIFACT` 事件。
- 不依赖任何 npm 包，Node ≥ 18 即可。解压 Codex 的 `.jsonl.zst` 需要系统里有 `zstd`。

## 安装

```bash
cd scripts/devlog
npm link            # 把 yh-devlog 装到 PATH 上；不想装就用 node /绝对路径/scripts/devlog/cli.js 代替下文的 yh-devlog
yh-devlog --help
```

## 配置 `~/.fde-devlog.json`

```json
{ "baseUrl": "https://yihuone.mm.yihukeji.cn/apps/fde/api", "apiKey": "yh_xxx", "stage": "CODING" }
```

```bash
chmod 600 ~/.fde-devlog.json   # 文件里有 Key。权限不是 600 时，每次运行都会提示
```

| 字段 | 说明 | 覆盖方式（优先级从高到低） |
| --- | --- | --- |
| `baseUrl` | FDE 的 API 地址。末尾没写 `/api` 时会自动补上，所以 `http://127.0.0.1:3010` 也能用 | `--base` > `FDE_DEVLOG_BASE` > 配置文件 |
| `apiKey` | 以虎 One 个人 API Key（个人中心 → API Key，形如 `yh_xxx`）、FDE 签发的 `fde_` Key，或登录 Token 都可以 | `--token` > `FDE_DEVLOG_KEY` > 配置文件 |
| `stage` | 会话阶段，默认 `CODING` | `--stage` > `FDE_DEVLOG_STAGE` > 配置文件 |

没配 `apiKey` 时只打一条警告，命令照常往下跑。本地调试可以临时用 `--token` 传进去。

不要把真实 Key 写进仓库或贴进文档。

## 三条命令

### `yh-devlog hook`：Claude Code 每轮结束时自动上报

从 stdin 读 Claude Code `Stop` hook 传进来的 JSON（含 `transcript_path`、`session_id`），解析这份 jsonl 里**最近一个会话**并上报。

- 会话先写进队列再发送。hook 中途被 Claude Code 超时杀掉也不会丢，下次 hook 或 sync 时会补发。
- 不管出什么错都 `exit 0`，日志只写 stderr，不会挡住 Claude Code。

在 `~/.claude/settings.json` 里加上：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "yh-devlog hook", "timeout": 60 }
        ]
      }
    ]
  }
}
```

没有 `npm link` 的话，把 `command` 换成 `node /绝对路径/scripts/devlog/cli.js hook`。

`Stop` 在每轮回答结束时都会触发。因为 uid 幂等，同一会话反复上报只会更新那一条，正文会越来越完整。

### `yh-devlog import <文件...>`：导入指定会话文件

```bash
yh-devlog import ~/.claude/projects/-Users-me-proj/0df0042b-....jsonl          # Claude Code
yh-devlog import ~/.codex/sessions/2026/11/01/rollout-....jsonl                 # Codex（.jsonl.zst 也行）
yh-devlog import ./codex-session.log                                           # Codex 纯文本日志
yh-devlog import a.jsonl b.jsonl --dry-run                                     # 只解析不上报
```

- Claude Code 的一个 jsonl 里如果有多个 `sessionId`（比如 resume 过），每个 sessionId 各报一条。
- 全部成功时退出码是 0。有失败或写进了队列时是 1。

### `yh-devlog sync [--days 3]`：批量增量上报

```bash
yh-devlog sync              # 扫 ~/.claude/projects/**/*.jsonl，报最近 3 天改过的
yh-devlog sync --days 1
yh-devlog sync --force      # 忽略状态文件，全部重报（uid 幂等，不会重复建会话）
```

- 先按文件 mtime 过滤。大小、mtime、行数都没变的文件跳过。`subagents/` 目录下的子代理会话不单独上报。
- 状态写在 `~/.fde-devlog-state.json`，记录每个文件路径对应的已上报 sessionId、行数、大小和 mtime。
- 每次运行先把失败队列里的会话补发掉。

### 通用选项

`--base <url>`、`--token <key>`、`--stage <STAGE>`、`--dry-run`（配合 `--json` 打印完整上报 JSON）、`-q/--quiet`。

## 上报内容

```json
{ "uid": "claude:<sessionId>", "source": "CLAUDE_CODE", "stage": "CODING",
  "model": "claude-opus-5-5", "startedAt": "...", "endedAt": "...", "turns": 12,
  "branch": "feat/x", "cwd": "/path/to/repo", "title": "首条用户消息前 60 字",
  "summary": "1. 第一条用户消息首句\n2. ...\n3. ...",
  "commitShas": ["abc1234"],
  "body": { "messages": [ { "role": "user", "text": "..." }, { "role": "assistant", "text": "..." } ] },
  "events": [ { "seq": 1, "kind": "COMMAND", "text": "npm test", "occurredAt": "..." },
              { "seq": 2, "kind": "ARTIFACT", "text": "修改 src/a.js", "files": ["src/a.js"] } ] }
```

| 字段 | 怎么来的 |
| --- | --- |
| `body.messages` | 用户输入 + 助手文字。工具调用和工具结果、系统注入（`<system-reminder>` 等）、meta 消息和子代理消息都不收。同一轮里助手被工具调用切开的几段文字合成一条。单条超过 3 万字时截断 |
| `turns` | `messages` 里 `user` 的条数 |
| `title` / `summary` | 第一条用户消息的前 60 字；前 3 条用户消息各取首句 |
| `commitShas` | ① 助手文字里的 7~40 位十六进制串，且前后 80 字内出现 commit 或「提交」；② 带 `git commit` 的命令输出里的 sha。最多 10 个 |
| `events` | Bash 命令记为 `COMMAND`。Write/Edit 记为 `ARTIFACT`，同一文件只记第一次。最多 500 条 |
| 截断 | 单个文件超过 2MB 时，每个会话只保留最后 200 条消息，并加上 `"truncated": true`（顶层和 `body` 里各一份） |

因为客户端已经脱过敏，服务端那一遍通常不会再命中，所以平台上 `bodyRedacted` 一般是 `false`。这不代表正文里有密钥没盖住。

## 失败重试与队列

每一批请求失败后最多重试 3 次，间隔分别是 0.5s、1s、2s。单次请求超时 15s（hook 里是 8s）。

| 情况 | 处理 |
| --- | --- |
| 连不上、超时、5xx、429 | 重试，仍失败就写进 `~/.fde-devlog-queue.jsonl`（权限 600，同一 uid 只留最新一份） |
| 401 / 403 / 404 | 不重试，直接入队。修好 Key 或地址后，下次运行会自动补发 |
| 400 或单条数据错误 | 不入队（重发也没用），打印出原因 |

如果开头补发队列时就发现连不上，这次新解析出的会话不再逐批重试，直接入队。

## 常见报错

| 提示 | 原因 / 处理 |
| --- | --- |
| `没配置 apiKey` | 在 `~/.fde-devlog.json` 写 `apiKey`，或者用 `--token` / `FDE_DEVLOG_KEY` 传入 |
| `HTTP 401：API Key 无效或已吊销` | Key 填错了或已经吊销。`fde_` Key 在 FDE「API Key」页管理，`yh_` Key 在以虎 One 个人中心 |
| `HTTP 401：AGENT 级 API Key 已停用` | 改用个人 Key |
| `HTTP 401：凭证无效…` | 传的 token 既不是 FDE 登录 Token，也不是以虎 One 的 access_token / 个人 Key |
| `HTTP 404` | `baseUrl` 路径不对。经以虎 One 访问时是 `…/apps/fde/api`，直连 FDE 时是 `http://host:port`（会自动补 `/api`） |
| `连不上 …：ECONNREFUSED` / `超时` | 网络或服务没起来。会话已经进了队列，下次会自动补发 |
| `连不上 …：bad port` | Node 的 fetch 会拒绝 9、25 这类端口，换个端口 |
| `这个 uid 已被别人的会话占用` | 同一会话之前被别的账号报过。非管理员只能更新自己报过的会话 |
| `解压 … 需要 zstd 命令` | `brew install zstd` |
| `不认识的会话格式` | 只支持 Claude Code jsonl、Codex rollout jsonl（含 `.zst`），以及按 `user` / `codex` 分段的纯文本日志 |
| 配置文件权限提示 | `chmod 600 ~/.fde-devlog.json` |

排查时加 `DEBUG=1` 可以打印调用栈。设置 `FDE_DEVLOG_HOME=/tmp/x` 可以把配置、状态和队列文件整体换到别的目录，便于测试。
