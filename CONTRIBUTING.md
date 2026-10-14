# Contributing

Thanks for helping improve FDE Platform. Issues and pull requests are welcome.

FDE runs only as an app on [Yihu One](https://github.com/guoylyy/yihu-one): sign-in, people, branding, models and personal messages come from the platform (`backend/src/lib/yihuOne.js`). Don't add a second way to do those here; if FDE needs something the platform doesn't offer yet, add it to Yihu One's open API. Yihu One rolls back code but not the database, so migrations must stay backward compatible: add columns first, drop them in a later release.

## Workflow

1. Open an issue (or comment on one) describing the change.
2. Branch from `main` with a prefix: `feat/`, `fix/`, `refactor/`, `docs/` or `chore/`.
3. Develop and test locally (see the README for setup).
4. Open a pull request. Keep it to a single purpose; don't mix in unrelated formatting.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`, for example `feat(tasks): add bulk assign`.

## Rules the test suite enforces

- **Permissions**: `backend/src/lib/auth.js` (`PERMISSIONS`) and `frontend/src/api/permissions.js` must list the same roles for every permission the frontend uses. Every permission prefix must be mapped to a module in `backend/src/config/edition.js`.
- **MCP tools**: tool descriptions must only reference tools that exist, and `fde-agent-training/08-tool-definitions.json` must not list tools the server no longer provides.
- **Notifications**: every notification type must be registered in `backend/src/lib/notificationCatalog.js`.

## Database changes

Edit `backend/prisma/schema.prisma`, then create a migration:

```bash
cd backend
npx prisma migrate dev --name short_description
```

Commit the generated folder under `prisma/migrations/`. Never edit a migration that has already been released.

## UI text

The frontend is translated with vue-i18n. Add new strings to `frontend/src/locales/en.json` and `frontend/src/locales/zh-CN.json` instead of hardcoding text in components.

## Tests

```bash
cd backend && RATELIMIT_RELAX=true npm test   # integration tests call the backend on :3005 (seeded, DEV_LOGIN=true)
cd frontend && npm test
```

Integration tests create their data with a `unit-test-` prefix.

## Reporting security issues

Please don't open a public issue for security vulnerabilities. Use the repository's private vulnerability reporting (GitHub: Security → Report a vulnerability) instead.
