# FDE Platform

An open-source delivery management system for teams of engineers **and the AI agents that work with them**.

It covers the whole production line of a delivery team: **idea → project → milestone → task → assignment (to a person or an agent) → delivery**, with time tracking, a knowledge base and reusable assets along the way. Every engineer can register their own agents (Claude Code, Codex, OpenClaw, WorkBuddy or any MCP client); agents get their own API keys, act with the owner's permissions, pick up tasks, report progress and write their work back into the system.

> FDE = Forward Deployed Engineer: engineers who deliver directly with customers. The system works for any delivery or engineering team.

## Features

**Work tracking**
- Projects with health signals, milestones, issues and risks
- Task board (five states, subtasks, comments with @mentions, Markdown, attachments)
- Milestone roadmap: task dependency graph, critical path, AI-assisted task breakdown
- Timesheets with submission/approval and Excel export
- Idea center: topics, ideas, discussion, one-click conversion into milestones

**Engineers and agents**
- Engineer pool with skill profiles and teams
- Agent profiles: each agent has an owner, a dedicated API key, an activity log and a lifecycle
- Built-in **MCP server** (Streamable HTTP, ~130 tools) so any MCP client can query and operate the platform as its user
- Auto-dev dispatch: agents pick up "ready" tasks from the board (`peek → claim → develop → complete`)
- Skill packages (shared `SKILL.md` files that agents load through MCP) and a developer onboarding kit
- Agent conversation log written back to project timelines

**Knowledge**
- Knowledge base (Markdown articles), reusable asset library, meeting/communication records with AI extraction

**Platform**
- Role-based permissions editable in the admin UI (permission matrix + data scopes), audit log
- Multiple LLM providers (Anthropic, OpenAI, DeepSeek, Qwen, Zhipu, Moonshot or any OpenAI-compatible endpoint), configured in the UI
- Pluggable integrations: local / S3-compatible / Qiniu storage; Slack / Feishu / DingTalk / WeCom / generic webhook notifications; GitHub / GitLab / Gitee commit sync; SMTP email
- Per-instance module switches and branding (name, logo, color)
- UI in English and Simplified Chinese (switch from the globe icon; defaults to the browser language)

## Quick start (Docker)

Requirements: Docker with Compose v2.

```bash
cp .env.example .env
# edit .env: set MYSQL_PASSWORD and JWT_SECRET (openssl rand -hex 32)
docker compose up -d --build
docker compose exec backend node prisma/seed.js   # optional: roles + demo data
```

Open http://localhost:8080/admin/login. With the demo seed the accounts are `admin`, `manager`, `fde001` and `sales`, all with password `123456` (change them).

Without the demo seed, create the first admin with:

```bash
docker compose exec backend node scripts/seed-instance-admin.mjs --username admin --name Admin
```

## Local development

Requirements: Node.js 20+, MySQL 8.

```bash
cd backend
cp .env.example .env            # set DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate deploy       # create the schema
node prisma/seed.js             # roles + demo data
cd ../frontend && npm install
cd .. && ./start.sh             # backend :3005, frontend :5173
```

Tests:

```bash
cd backend && RATELIMIT_RELAX=true npm test    # needs the backend running on :3005 with seed data
cd frontend && npm test
```

## Connecting an agent

1. In the admin UI, open **Agents** and register your agent. You get an API key starting with `fde_`.
2. Point your MCP client at `https://<your-domain>/api/mcp` with header `Authorization: Bearer fde_...`.

For Claude Code:

```bash
claude mcp add --scope user fde --transport http https://<your-domain>/api/mcp --header "Authorization: Bearer fde_xxx"
```

The **Developer onboarding** page can also generate a ready-to-use kit (`.mcp.json`, the `fde-tasks` skill and a `CLAUDE.md` template). Full guides for MCP, agent collaboration and auto-dev are built into the app under `/docs`, and `fde-agent-training/` contains material for training a conversational agent on the API.

## Configuration

Everything is configured through environment variables; see [`backend/.env.example`](backend/.env.example) for the full list. The most common ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `JWT_SECRET` | Required |
| `PUBLIC_BASE_URL` | Public URL, used in emails and MCP kits |
| `BRAND_NAME`, `BRAND_LOGO_URL`, `BRAND_PRIMARY_COLOR` | Branding |
| `STORAGE_DRIVER` (`local` / `s3` / `qiniu`) + `S3_*` | File storage |
| `CHAT_WEBHOOK_URL` | Team chat notifications (Slack, Feishu, DingTalk, WeCom, any JSON webhook) |
| `SMTP_*` | Email |
| `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEE_ACCESS_TOKEN` | Repository commit sync |
| `ENABLED_MODULES` / `DISABLED_MODULES` | Turn modules on or off per instance |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Single sign-on with Yihu One or another OIDC provider |
| `PASSWORD_LOGIN` | Set to `false` to allow only single sign-on |

LLM providers and keys are configured in the admin UI under **LLM settings**.

### Run on Yihu One

[Yihu One](https://github.com/guoylyy/yihu-one) can host this platform as an app: one container, a database it creates, sign-in through Yihu One, and every tool available to the Yihu One AI assistant. On the Yihu One server:

```bash
./yh add fde --git https://github.com/guoylyy/yihu-fde.git
./yh up fde                      # → <Yihu One address>/apps/fde/
```

Or in the Yihu One console: **管理 → 应用 → 从 Git 安装应用**. Nothing to configure: `yh-app.json` declares the port, health check, database and MCP endpoint, and the root `Dockerfile` builds a single image that serves the API and the web UI. Yihu One injects the database URL and its own credentials; the app derives its OIDC settings, public URL and JWT secret from them (`backend/src/lib/platform.js`). Password login is off, so everyone signs in with Yihu One; Yihu One admins become admins here on first sign-in. Uploaded files go to `/data`, which Yihu One backs up.

The app is served under a path prefix (`/apps/fde/`): the backend writes the prefix into the page's `<base href>` and the frontend routes, API calls and stored asset paths follow it (`frontend/src/utils/base.js`). Standalone deployments are unaffected.

### Sign in with Yihu One

Any OpenID Connect provider works; these steps use Yihu One as the example.

1. In Yihu One, go to **管理 → 应用 → 登记外部应用** and register the app with the redirect URI `<PUBLIC_BASE_URL>/api/auth/oidc/callback`.
2. Set `OIDC_ISSUER` (the Yihu One address, e.g. `https://one.example.com`), `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`, then restart the backend.
3. The login page now shows **Sign in with 以虎 One** (rename it with `OIDC_NAME`).

On first sign-in, an account is matched by the Yihu One user id. If there is no match, it is linked to an existing account with the same verified email. Otherwise a new account is created with `OIDC_DEFAULT_ROLE`. Users whose Yihu One roles include `OIDC_ADMIN_ROLES` become admins. Disabled accounts cannot sign in.

The MCP endpoint (`/api/mcp`) also accepts Yihu One access tokens, so the Yihu One assistant can call the platform as the signed-in user. Register `<PUBLIC_BASE_URL>/api/mcp` as the app's MCP address.

## Project structure

```
backend/                 Node.js 20 + Express 4 + Prisma 6 (MySQL)
  src/routes/fde/        internal console API
  src/routes/public/     unauthenticated instance info (branding, enabled modules)
  src/mcp/               MCP server and tool definitions
  src/lib/               auth/permissions, storage, notifications, LLM, git hosting, cron
  prisma/                schema, migrations, seed
frontend/                Vue 3 + Element Plus + Vite
  src/views/admin/       internal console
  src/docs/              in-app user documentation (Markdown)
fde-agent-training/      material for training third-party agents on the API
```

Permission changes must keep `backend/src/lib/auth.js` and `frontend/src/api/permissions.js` in sync (a test enforces it). Schema changes need a Prisma migration.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
