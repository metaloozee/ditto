# Ditto

Ditto is a TanStack Start app deployed with Alchemy on Cloudflare Workers. It uses:

- Cloudflare D1 + Drizzle for persistence
- better-auth with GitHub OAuth
- GitHub repo import for projects
- `@cloudflare/sandbox` for workspace instantiation
- R2-backed sandbox backup/restore
- agent runs in the Cloudflare sandbox via the PI harness; the client streams
  `POST /api/agent/stream` (SSE)

## Prerequisites

- Node.js 22.15+ (22.17 recommended)
- pnpm
- Cloudflare / GitHub credentials for the configured environment

## Install

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

## Database

Generate migrations after changing `src/db/schema.ts`:

```bash
pnpm db:generate
```

## Scripts

- `pnpm dev` — run the app locally with Alchemy
- `pnpm build` — production build
- `pnpm deploy` — deploy with Alchemy
- `pnpm destroy` — tear down Alchemy resources
- `pnpm check` — Biome check
- `pnpm lint` — Biome lint
- `pnpm format` — Biome format
- `pnpm test` — Vitest

## Environment variables

Set these for local development and deployment:

```env
CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
USE_LOCAL_BUCKET_BACKUPS=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
VITE_GITHUB_APP_INSTALL_URL=
OPENCODE_API_KEY=
```

`BETTER_AUTH_URL` defaults to `http://localhost:5173` if omitted.

## Notes

- `pnpm deploy` and `pnpm destroy` are managed through Alchemy.
- `src/server.ts` exports the Cloudflare Sandbox binding used by the app.
- `OPENCODE_API_KEY` is required for sandbox agent runs (passed into the harness
  session environment).
- Concurrent agent runs per project are not enforced yet; see plan 003 for UI
  streaming and future concurrency notes.
