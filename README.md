<div align="center">

# FDE Platform

**Open-source delivery management for engineering teams and the AI agents that work with them.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.1%20beta-orange.svg)](https://github.com/guoylyy/yihu-fde/releases)
![Node](https://img.shields.io/badge/node-20%2B-brightgreen.svg)
![MCP](https://img.shields.io/badge/MCP-110%20tools-8a2be2.svg)

UI in English · 简体中文

</div>

---

Delivery teams already juggle projects, milestones, tasks, timesheets and documents. Now each engineer also has one or more AI agents, such as Claude Code, Codex or OpenClaw, writing code, breaking down work and reporting progress. Those agents usually work outside the system the team tracks delivery in. What they do never shows up there, and they can't see what the team needs next.

FDE Platform puts both on the same production line: **idea → project → milestone → task → assignment (to a person or an agent) → delivery**. Every agent has an owner, its own API key and the owner's permissions. Agents pick up tasks, report progress and write their work back, just like the people they work for.

> FDE = Forward Deployed Engineer: engineers who deliver directly with customers. The system works for any delivery or engineering team.

### 📋 Track delivery end to end

- **Projects** with health signals, milestones, issues and risks
- **Task board** with five states, subtasks, comments with @mentions, Markdown and attachments
- **Milestone roadmap:** a task dependency graph with critical path and blocked/ready status. AI drafts the task breakdown, and you preview it before applying.
- **Timesheets** with submission, approval and Excel export
- **Idea center:** topics, ideas and discussion with AI summaries; turn an idea into a project milestone in one click

### 🤖 Work with agents, not around them

- **Built-in MCP server** (Streamable HTTP, 110 tools) at `/api/mcp`. Any MCP client can query and operate the platform as its user. Read-only tools are marked so clients only ask for confirmation on writes.
- **Agent profiles:** each agent has an owner, a dedicated `fde_` API key, an activity log and a lifecycle
- **Dispatch to robots:** click "dispatch" on the roadmap and an agent picks up ready tasks in dependency order (`peek → claim → develop → complete`); progress streams back to the board
- **Developer onboarding kit:** one download gives a new engineer `.mcp.json`, the `fde-tasks` skill and a `CLAUDE.md` template. A five-step checklist tracks them to their first delivered task.
- **Skill packages:** shared `SKILL.md` files that agents load through MCP
- **Conversation log:** agents write research, chats and decisions back to the project timeline

### 📚 Keep what the team learns

- **Knowledge base** of Markdown articles and checklists
- **Asset library:** reusable solutions with maturity levels and reuse tracking. A publish check catches secrets and customer names, and AI drafts assets at project close.
- **Meeting and communication records** with AI extraction of decisions and action items

### 🔌 Fit into your company

- **Sign in with [Yihu One](https://github.com/guoylyy/yihu-one) or any OpenID Connect provider:**
  - Accounts are linked or created on first sign-in.
  - Password login can be turned off.
  - The MCP endpoint also accepts the provider's access tokens.
- **Runs as a hosted app on Yihu One** with one command: sign-in, database and all tools are wired up automatically
- **Bring your own models:** Anthropic, OpenAI, DeepSeek, Qwen, Zhipu, Moonshot or any OpenAI-compatible endpoint. You can also sync the models your Yihu One already manages.
- **Your brand, set in the UI:** name, logo, primary color and public URLs under **System settings**, no restart needed
- **Three roles:** admin, project manager and FDE engineer, with a permission matrix and data scopes you can edit in the UI, plus an audit log
- **Pluggable services:**
  - storage: local, S3-compatible or Qiniu
  - notifications: Slack, Feishu, DingTalk, WeCom or any JSON webhook
  - commit sync: GitHub, GitLab or Gitee
  - SMTP email

> **Status:** beta (0.1.x). It's used in production, but the API and data model may still change between minor versions. The UI is fully available in English and Simplified Chinese. The in-app user guides under `/docs` and some server messages are still Chinese only.

## Quick start

**Requirements:** Docker with Compose v2.

```bash
git clone https://github.com/guoylyy/yihu-fde.git
cd yihu-fde
cp .env.example .env                 # set MYSQL_PASSWORD and JWT_SECRET (openssl rand -hex 32)
docker compose up -d --build         # MySQL + backend + web UI; migrations run on start
docker compose exec backend node prisma/seed.js   # optional: demo project and accounts
```

Open http://localhost:8080/admin/login. The demo seed creates `admin`, `manager`, `fde001` and `fde002`, all with the password `123456`. Change these passwords before anyone else can reach the instance.

Without the demo seed, create the first admin yourself:

```bash
docker compose exec backend node scripts/seed-instance-admin.mjs --username admin --name Admin
```

### Run on Yihu One

[Yihu One](https://github.com/guoylyy/yihu-one) can host FDE Platform as an app. On the Yihu One server:

```bash
./yh add fde --git https://github.com/guoylyy/yihu-fde.git
./yh up fde                          # → <Yihu One address>/apps/fde/
```

Or use the console: **管理 → 应用 → 从 Git 安装应用**. There is nothing to configure:
- [`yh-app.json`](yh-app.json) declares the port, health check, database and MCP endpoint.
- The root [`Dockerfile`](Dockerfile) builds one image that serves both the API and the web UI.
- Yihu One injects the database URL and the app's credentials. The app derives its sign-in settings, public URL and JWT secret from them ([`platform.js`](backend/src/lib/platform.js)).
- Everyone signs in with their Yihu One account, and Yihu One admins become admins here.
- Uploaded files go to `/data`, which Yihu One backs up.

## Connecting an agent

1. In the web UI, open **Agents** and register your agent. You get an API key that starts with `fde_`.
2. Point your MCP client at `https://<your-domain>/api/mcp` with the header `Authorization: Bearer fde_...`.

For Claude Code:

```bash
claude mcp add --scope user fde --transport http https://<your-domain>/api/mcp --header "Authorization: Bearer fde_xxx"
```

The **Developer onboarding** page generates the same setup as a ready-to-use kit. The MCP address it uses is set under **System settings → Addresses**. Guides for MCP, agent collaboration, auto-dev and robot dispatch are built into the app under `/docs`. [`fde-agent-training/`](fde-agent-training/) has material for training a conversational agent on the API.

## Configuration

Settings come from environment variables. [`backend/.env.example`](backend/.env.example) lists them all; with Docker, put them in `.env`. The most common ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `JWT_SECRET` | Required (Docker builds `DATABASE_URL` from `MYSQL_PASSWORD`) |
| `PUBLIC_BASE_URL`, `PUBLIC_MCP_URL` | Public addresses used in emails, file links, sign-in callbacks and agent kits |
| `BRAND_NAME`, `BRAND_TAGLINE`, `BRAND_LOGO_URL`, `BRAND_PRIMARY_COLOR` | Branding |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Single sign-on (see below) |
| `PASSWORD_LOGIN` | `false` allows only single sign-on |
| `STORAGE_DRIVER` (`local` / `s3` / `qiniu`) + `S3_*` | File storage |
| `CHAT_WEBHOOK_URL` | Team chat notifications |
| `SMTP_*` | Email |
| `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEE_ACCESS_TOKEN` | Commit sync for private repositories |
| `ENABLED_MODULES` / `DISABLED_MODULES` | Turn modules on or off per instance |

Admins can change the common settings at runtime under **System settings** (基础配置 → 系统设置). The page has four tabs:
- **Branding:** name, tagline, logo and primary color.
- **Addresses:** public URL and MCP URL.
- **LLM settings:** providers, models and keys.
- **Sign-in:** a read-only view of how sign-in is configured.

A value saved there overrides the matching environment variable. Clearing it falls back to the environment variable, then to the default. Sign-in credentials stay in the environment and are never stored in the database.

### Single sign-on with Yihu One

Any OpenID Connect provider works. These steps use Yihu One:

1. In Yihu One, open **管理 → 应用 → 登记外部应用**. Register the app with the redirect URI `<PUBLIC_BASE_URL>/api/auth/oidc/callback` and, optionally, the MCP address `<PUBLIC_BASE_URL>/api/mcp`.
2. Set `OIDC_ISSUER` (the Yihu One address), `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`, then restart the backend.
3. The login page now shows **Sign in with 以虎 One** (rename it with `OIDC_NAME`).

What happens on first sign-in:
- An existing account is matched by the Yihu One user id.
- Otherwise it's linked to an existing account with the same verified email, but only if exactly one account has that email.
- Otherwise a new account is created with `OIDC_DEFAULT_ROLE`, and Yihu One admins become admins.

Set `OIDC_AUTO_CREATE=false` if an admin should create accounts first. After the first sign-in, roles are managed in FDE Platform.

The MCP endpoint also accepts Yihu One access tokens, so the Yihu One assistant can call FDE tools as the signed-in user. To use the models Yihu One manages, open **System settings → LLM settings → Sync from 以虎 One**. The app's credentials are used, so no API key is stored here.

## Development

**Requirements:** Node.js 20+ and MySQL 8.

```bash
cd backend
cp .env.example .env            # set DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate deploy       # create the schema
node prisma/seed.js             # roles and demo data
cd ../frontend && npm install
cd .. && ./start.sh             # backend :3005, frontend :5173 (proxies /api to the backend)
```

Tests:

```bash
cd backend && node --test test/lib/*.test.js     # unit tests (activity.test.js needs the database)
cd backend && RATELIMIT_RELAX=true npm test       # everything; needs the backend running on :3005 with seed data
cd frontend && npm test
```

### Releasing

Develop on `main`. To publish, run:

```bash
./release.sh
```

It checks the branch and working tree, then runs the tests that don't need a database: backend unit tests, frontend tests and the build. If they pass, it pushes `main` to `release`. Yihu One deploys from `release` (`deploy` in `yh-app.json`). In `manual` mode, an admin then clicks **发布** in the console. Run the full backend suite locally before releasing.

## Repository layout

| Path | Contents |
| --- | --- |
| [`backend/`](backend/) | API: Node 20, Express 4, Prisma 6, MySQL 8 |
| [`backend/src/routes/fde/`](backend/src/routes/fde/) | Web UI API |
| [`backend/src/mcp/`](backend/src/mcp/) | MCP server and tool definitions |
| [`backend/src/lib/`](backend/src/lib/) | Auth and permissions, sign-in (OIDC), settings, storage, notifications, LLM, git hosting |
| [`backend/prisma/`](backend/prisma/) | Schema, migrations and seed |
| [`frontend/`](frontend/) | Web UI: Vue 3, Element Plus, Vite |
| [`frontend/src/docs/`](frontend/src/docs/) | In-app user guides (Markdown), served at `/docs` |
| [`frontend/src/locales/`](frontend/src/locales/) | UI translations (`en`, `zh-CN`) |
| [`fde-agent-training/`](fde-agent-training/) | Material for training third-party agents on the API |
| [`docker-compose.yml`](docker-compose.yml) | Standalone deployment: MySQL, backend and nginx |
| [`Dockerfile`](Dockerfile), [`yh-app.json`](yh-app.json) | Single-image build and manifest for Yihu One |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and the rules the test suite enforces. Some examples:
- Permissions in the backend and frontend must match.
- Schema changes need a Prisma migration.
- UI text goes in both locale files.

## Security

Please don't report vulnerabilities in public issues. Use GitHub's private vulnerability reporting instead (**Security → Report a vulnerability** on the repository).

## License

[MIT](LICENSE)
