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

- Node.js 22.15+ for the app (22.19+ for the sandbox runner; 22.17+ recommended for local dev)
- pnpm (root app) and npm (sandbox runner only)
- Cloudflare / GitHub credentials for the configured environment

## Install

Root app (pnpm workspace):

```bash
pnpm install --frozen-lockfile
```

Sandbox runner is a **separate npm package** (not a pnpm workspace member). Install it when working on `sandbox/runner` or before full verification:

```bash
npm ci --prefix sandbox/runner
```

Or: `pnpm runner:install`.

## Development

```bash
pnpm dev
```

Before opening a PR, run the full verification gate (app + runner typecheck/tests/build):

```bash
pnpm verify
```

When you change `sandbox/runner` sources, its `package.json` / lockfile, or the root `Dockerfile`, rebuild the sandbox image so the Docker-baked runner matches local code (for example via your usual Alchemy/Wrangler deploy or container build flow that uses the root `Dockerfile`).

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
- `pnpm typecheck` — root TypeScript (`tsc --noEmit`)
- `pnpm runner:install` — `npm ci` for the sandbox runner
- `pnpm runner:verify` — typecheck, test, and build the sandbox runner
- `pnpm verify` — full pre-PR gate (check, typecheck, test, build, runner verify)

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

- For GitHub-linked projects, the Ditto GitHub App needs **Contents: Read &
  write** and **Pull requests: Read & write** so the Worker can push session
  branches and open pull requests (installation token; never stored in the DB).
- `pnpm deploy` and `pnpm destroy` are managed through Alchemy.
- `src/server.ts` exports the Cloudflare Sandbox binding used by the app.
- `OPENCODE_API_KEY` is required for sandbox agent runs (passed into the harness
  session environment).
- Agent harness architecture: `docs/architecture/agent-harness.md`
- Concurrent agent runs per project are not enforced yet; see the architecture
  doc for deferred concurrency notes.
