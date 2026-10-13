# FDE Platform — backend

Node.js 20 + Express 4 + Prisma 6 (MySQL 8). See the [root README](../README.md) for setup and deployment.

## Commands

```bash
npm run dev                         # start with --watch on :3005
npx prisma migrate deploy           # apply migrations
npx prisma migrate dev --name xyz   # create a migration after editing schema.prisma
node prisma/seed.js                 # roles + demo data
node scripts/seed-instance-admin.mjs --username admin   # roles + first admin, no demo data
RATELIMIT_RELAX=true npm test       # tests (integration tests call the running backend on :3005)
```

## Layout

| Path | Contents |
|---|---|
| `src/index.js` | App bootstrap, route mounting, local upload serving |
| `src/routes/fde/` | Internal console API (`/api/fde/*`, JWT or API key) |
| `src/routes/public/` | Unauthenticated instance info (branding, enabled modules) |
| `src/mcp/` | MCP server (`/api/mcp`) and tool definitions |
| `src/lib/auth.js` | Permission matrix, roles, data scopes |
| `src/config/` | Module switches (`edition.js`) and branding (`brand.js`) |
| `src/lib/storage.js` | File storage: local / S3-compatible / Qiniu |
| `src/lib/chatNotify.js`, `src/lib/webhookBot.js` | Team chat notifications (Slack, Feishu, DingTalk, WeCom, webhook) |
| `src/lib/gitHost.js` | GitHub / GitLab / Gitee commit sync |
| `src/lib/llm.js` | LLM providers configured in the admin UI |
| `src/lib/cron.js` | Background jobs (disable with `ENABLE_CRON=false`) |
| `prisma/` | Schema, migrations, seed |

All configuration is through environment variables; see [`.env.example`](.env.example).
