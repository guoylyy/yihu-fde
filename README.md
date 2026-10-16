<div align="center">

# FDE Platform

**Open-source delivery management for engineering teams and the AI agents that work with them, built as an app for [Yihu One](https://github.com/guoylyy/yihu-one).**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.1%20beta-orange.svg)](https://github.com/guoylyy/yihu-fde/releases)
![Node](https://img.shields.io/badge/node-20%2B-brightgreen.svg)
![MCP](https://img.shields.io/badge/MCP-115%20tools-8a2be2.svg)
![Yihu One](https://img.shields.io/badge/runs%20on-Yihu%20One-d2521e.svg)

UI in English · 简体中文

</div>

---

Delivery teams already juggle projects, milestones, tasks, timesheets and documents. Now each engineer also has one or more AI agents, such as Claude Code, Codex or OpenClaw, writing code, breaking down work and reporting progress. Those agents usually work outside the system the team tracks delivery in. What they do never shows up there, and they can't see what the team needs next.

FDE Platform puts both on the same production line: **idea → project → milestone → task → assignment (to a person or an agent) → delivery**. Every agent has an owner, its own API key and the owner's permissions. Agents pick up tasks, report progress and write their work back, just like the people they work for.

> FDE = Forward Deployed Engineer: engineers who deliver directly with customers. The system works for any delivery or engineering team.
>
> FDE Platform runs only as an app on [Yihu One](https://github.com/guoylyy/yihu-one), the self-hosted platform for company apps and agents. Yihu One provides sign-in, the people directory, branding, models and the AI assistant. FDE adds the delivery workflow on top.

### 📋 Track delivery end to end

- **Projects** with health signals, milestones, issues and risks
- **Task board** with five states, subtasks, comments with @mentions, Markdown and attachments
- **Milestone roadmap:** a task dependency graph with critical path and blocked/ready status. AI drafts the task breakdown, and you preview it before applying.
- **Timesheets** with submission, approval and Excel export
- **Idea center:** topics, ideas and discussion with AI summaries; turn an idea into a project milestone in one click

### 🤖 Work with agents, not around them

- **Built-in MCP server** (Streamable HTTP, 115 tools). The Yihu One assistant uses it as the signed-in user, and people connect their own Claude Code or Cursor through the Yihu One MCP gateway with one Yihu One API key. Read-only tools are marked, so clients ask for confirmation only on writes.
- **Agent profiles:** robots that need their own identity get an owner, a dedicated `fde_` key, an activity log and a lifecycle
- **Dispatch to robots:** click "dispatch" on the roadmap and an agent picks up ready tasks in dependency order (`peek → claim → develop → complete`); progress streams back to the board
- **Developer onboarding kit:** one download gives a new engineer a `.mcp.json` for the Yihu One gateway, the `fde-tasks` skill and a `CLAUDE.md` template. A five-step checklist tracks them to their first delivered task.
- **Conversation log:** agents write research, chats and decisions back to the project timeline

### 📚 Keep what the team learns

- **Knowledge base** of Markdown articles and checklists
- **Asset library:** reusable solutions with maturity levels and reuse tracking. A publish check catches secrets and customer names, and AI drafts assets at project close.
- **Meeting and communication records** with AI extraction of decisions and action items

### 🔌 Built into Yihu One

- **One sign-in:** people use their Yihu One account. There are no local passwords.
- **People from the platform:** there are no local accounts. The first platform admin who opens FDE becomes its admin, and everyone else gets an account the first time they open it (or an admin adds them from the Yihu One directory ahead of time). Names, emails, phones and avatars come from Yihu One at sign-in and in the hourly directory sync, and they are read-only in FDE's profile page; only what the platform doesn't have (say, an avatar) can be filled in locally. People disabled on the platform are disabled here, and teams mirror platform departments.
- **Home page cards:** seven read-only tools (my open tasks, my hours this week, approvals waiting for me, project health, overdue tasks and more) can sit on each person's Yihu One home page.
- **Messages where people already are:** task assignments, approvals and mentions also reach people on DingTalk, Feishu or WeCom through Yihu One.
- **Usage on the platform:** key actions show up in Yihu One's usage statistics, marked when they came from AI.
- **Platform models:** AI features use the models Yihu One manages. Sync them, pick a default, and no API keys are stored in FDE.
- **Platform look:** the app name, logo and accent color follow the platform (or the space).
- **Three roles:** admin, project manager and FDE engineer, with a permission matrix, data scopes and an audit log.
- **Also included:** group chat bots (Slack, Feishu, DingTalk, WeCom or any JSON webhook) and commit sync from GitHub, GitLab or Gitee.

> **Status:** beta (0.1.x). It's used in production, but the API and data model may still change between minor versions. The UI is fully available in English and Simplified Chinese. The in-app user guides under `/docs` and some server messages are still Chinese only.

## Install on Yihu One

On the Yihu One server:

```bash
./yh add fde --git https://github.com/guoylyy/yihu-fde.git
./yh up fde                          # → <Yihu One address>/apps/fde/
```

Or use the console: **管理 → 应用 → 从 Git 安装应用**. There is nothing to configure:
- [`yh-app.json`](yh-app.json) declares the port, health check, database, sign-in callback and MCP endpoint.
- The root [`Dockerfile`](Dockerfile) builds one image that serves both the API and the web UI.
- Yihu One injects the database URL and the app's credentials. FDE derives its sign-in settings, public URL and JWT secret from them ([`platform.js`](backend/src/lib/platform.js)).
- Uploaded files go to `/data`, which Yihu One backs up.

Then decide who can open the app with Yihu One's app visibility setting (by department, person or role).

FDE needs [Yihu One 0.2.0](https://github.com/guoylyy/yihu-one/releases/tag/v0.2.0) or later, for `GET /api/open/app` (space and brand), `POST /api/open/notify` (personal messages) and `GET /api/open/llm/models` (model list). To send DingTalk work notifications, fill in **AgentId** under the platform's DingTalk sign-in settings.

## Accounts and roles

Yihu One says who someone is; FDE decides what they can do.

| Layer | Who decides |
| --- | --- |
| Who can open FDE | Yihu One app visibility |
| Who someone is | The Yihu One user id. Name, email, phone and department come from the platform. |
| What they can do | FDE's three roles: admin, project manager, FDE engineer |

On every sign-in (and every MCP call made through Yihu One):
- **Yihu One admins are always FDE admins.** If someone stops being a platform admin, they go back to the rules below.
- **A role an admin set in FDE is kept.** Admins change roles under **Users**, or add people from the Yihu One directory with a role before their first sign-in.
- **Otherwise** a new account gets `OIDC_DEFAULT_ROLE` (FDE engineer). With **System settings → Accounts → Department heads are project managers** turned on, people who lead a department become project managers.
- **Only one space:** people from other Yihu One spaces can't sign in (FDE doesn't separate data by space yet).
- **Disabled stays disabled:** an account disabled in FDE can't sign in. Accounts disabled because the platform disabled them come back when the platform restores them.

Set `OIDC_AUTO_CREATE=false` if an admin should add people before they can sign in.

## Connecting an agent

| Who | How |
| --- | --- |
| The Yihu One assistant | Nothing to set up; it calls FDE as the signed-in user |
| Your own Claude Code, Cursor, WorkBuddy… | Connect to `<Yihu One address>/api/mcp` with your Yihu One API key (Personal center → API Key). FDE tools are prefixed `fde__`. |
| A robot that needs its own identity | Register it under **Agents** and use its `fde_` key with `<FDE address>/api/mcp` |

```bash
claude mcp add --scope user yihu-one --transport http <Yihu One address>/api/mcp --header "Authorization: Bearer <your Yihu One API key>"
```

The **Developer onboarding** page gives each engineer a ready-to-use kit. Guides for MCP, agent collaboration, auto-dev and robot dispatch are built into the app under `/docs`, and [`fde-agent-training/`](fde-agent-training/) has material for training a conversational agent on the API.

## Configuration

On Yihu One everything required is injected. A few optional settings, set in the app's environment on the platform ([`backend/.env.example`](backend/.env.example) lists all of them):

| Variable | Purpose |
| --- | --- |
| `OIDC_DEFAULT_ROLE`, `OIDC_ADMIN_ROLES`, `OIDC_AUTO_CREATE` | Account rules (see above) |
| `CHAT_WEBHOOK_URL` | Group chat bot for team notifications |
| `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEE_ACCESS_TOKEN` | Commit sync for private repositories |
| `ENABLED_MODULES` / `DISABLED_MODULES` | Turn modules on or off |

Admins manage the rest in the app under **System settings**:
- **Yihu One:** connection status, space, directory sync and the AI access addresses (read-only).
- **Accounts & messages:** the department-head rule and whether notifications also go out through Yihu One.
- **LLM settings:** sync the platform's models, pick a default and tune parameters.

## Development

**Requirements:** Node.js 20+ and MySQL 8.

```bash
cd backend
cp .env.example .env            # set DATABASE_URL; DEV_LOGIN=true is already on
npm install
npx prisma migrate deploy       # create the schema
node prisma/seed.js             # roles and demo data (admin, manager, fde001, fde002)
cd ../frontend && npm install
cd .. && ./start.sh             # backend :3005, frontend :5173 (proxies /api to the backend)
```

Locally you sign in one of two ways:
- **Dev login:** with `DEV_LOGIN=true` the login page asks only for a username. It's refused in production and on Yihu One.
- **Your own Yihu One:** register the app under **管理 → 应用 → 登记外部应用** with the redirect URI `http://localhost:5173/api/auth/oidc/callback`, then set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`.

Tests:

```bash
cd backend && node --test test/lib/*.test.js     # unit tests (activity.test.js needs the database)
cd backend && RATELIMIT_RELAX=true npm test       # everything; needs the backend on :3005 with seed data and DEV_LOGIN=true
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
| [`backend/src/lib/`](backend/src/lib/) | Auth and permissions, Yihu One client and identity, settings, notifications, LLM, git hosting |
| [`backend/prisma/`](backend/prisma/) | Schema, migrations and seed |
| [`frontend/`](frontend/) | Web UI: Vue 3, Element Plus, Vite |
| [`frontend/src/docs/`](frontend/src/docs/) | In-app user guides (Markdown), served at `/docs` |
| [`frontend/src/locales/`](frontend/src/locales/) | UI translations (`en`, `zh-CN`) |
| [`fde-agent-training/`](fde-agent-training/) | Material for training third-party agents on the API |
| [`Dockerfile`](Dockerfile), [`yh-app.json`](yh-app.json) | Image and app manifest for Yihu One |
| [`release.sh`](release.sh) | Test, then push `main` to `release` |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and the rules the test suite enforces. Some examples:
- Permissions in the backend and frontend must match.
- Schema changes need a Prisma migration.
- UI text goes in both locale files.

## Security

Please don't report vulnerabilities in public issues. Email [guoylyy@gmail.com](mailto:guoylyy@gmail.com) with the details and steps to reproduce.

## License

[MIT](LICENSE)
