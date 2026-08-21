# Ditto

Ditto is a TanStack Start app deployed with Alchemy on Cloudflare Workers. It uses:

- Cloudflare D1 + Drizzle for persistence
- better-auth with GitHub OAuth
- GitHub repo import for projects
- `@cloudflare/sandbox` for workspace instantiation
- R2-backed sandbox backup/restore
- account-level AI provider connections and model catalogs
- conversation-specific Git worktrees, session previews, and GitHub export
- agent runs in the Cloudflare sandbox through the PI harness, streamed to the
  client from `POST /api/agent/stream`

## Repository layout

| Path | Ownership |
|---|---|
| Root (`package.json`, `alchemy.run.ts`, `Dockerfile`, `pnpm-workspace.yaml`) | Workspace orchestration, Alchemy deploy graph, sandbox image |
| `apps/web` | TanStack Start application (`@ditto/web`): UI, Worker routes, domain services, D1 schema/migrations |
| `packages/sandbox-runner` | Independent npm package baked into the sandbox image (not a pnpm workspace member) |

Alchemy is the sole deployment owner (`pnpm dev` / `pnpm deploy` / `pnpm destroy`). This monorepo layout does not introduce SST, Wrangler-as-deploy, or any other deployment boundary.

## Prerequisites

- Node.js 22.19+ for the full repository
- pnpm (workspace root + `apps/web`) and npm (`packages/sandbox-runner` only)
- Cloudflare / GitHub credentials for the configured environment

## Install

Root workspace (pnpm; includes `apps/web`):

```bash
pnpm install --frozen-lockfile
```

Sandbox runner is a **separate npm package** (not a pnpm workspace member). Install it when working on `packages/sandbox-runner` or before full verification:

```bash
npm ci --prefix packages/sandbox-runner
```

Or: `pnpm runner:install`.

## Development

From the repository root:

```bash
pnpm dev
```

Alchemy runs from the root, generates local Wrangler config under
`apps/web/.alchemy/local/`, and starts Vite with `apps/web` as cwd (env files
resolve from the repo root via `envDir`).

Before opening a PR, run the full verification gate (app + runner typecheck/tests/build):

```bash
pnpm verify
```

When you change `packages/sandbox-runner` sources, its `package.json` / lockfile,
or the root `Dockerfile`, rebuild the sandbox image so the Docker-baked runner
matches local code (restart `pnpm dev` or redeploy with Alchemy so the root
`Dockerfile` is rebuilt).

## Database

Generate migrations after changing `apps/web/src/db/schema.ts`:

```bash
pnpm db:generate
```

Migrations live under `apps/web/migrations`. Root `pnpm db:*` scripts forward to
`@ditto/web`.

## Scripts

- `pnpm dev` — local Alchemy + Vite (root)
- `pnpm build` — production build of `@ditto/web`
- `pnpm deploy` — deploy with Alchemy (sole deploy owner)
- `pnpm destroy` — tear down Alchemy resources
- `pnpm check` — Biome check (repo root)
- `pnpm lint` — Biome lint
- `pnpm format` — Biome format
- `pnpm test` — Vitest for `@ditto/web`
- `pnpm typecheck` — TypeScript for `@ditto/web` (`tsc --noEmit`)
- `pnpm runner:install` — `npm ci` for `packages/sandbox-runner`
- `pnpm runner:verify` — typecheck, test, and build the sandbox runner
- `pnpm verify` — full pre-PR gate (check, typecheck, test, build, runner verify)
- `pnpm db:generate` / `db:migrate` / `db:push` / `db:pull` / `db:studio` — Drizzle via `@ditto/web`

## Docker / sandbox image

The root `Dockerfile` copies `packages/sandbox-runner` into the Cloudflare sandbox
image and installs the `ditto-runner` CLI. Build context is the repository root
(see `.dockerignore`).

## Environment variables

Set these for local development and deployment (typically `.env.local` at the
repo root; Vite `envDir` is the monorepo root):

```env
CLOUDFLARE_ACCOUNT_ID=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
VITE_GITHUB_APP_INSTALL_URL=
OPENCODE_API_KEY=
AI_CREDENTIALS_ENCRYPTION_KEY=
```

`BETTER_AUTH_URL` defaults to `http://localhost:5173` if omitted.
`AI_CREDENTIALS_ENCRYPTION_KEY` must be nonempty and distinct from
`BETTER_AUTH_SECRET`. It remains bound for leftover `ai_provider_credentials`
rows and is pending removal. `OPENCODE_API_KEY` is the operator credential for
the only supported model, `opencode/deepseek-v4-flash-free`.

## Notes

- For GitHub-linked projects, the Ditto GitHub App needs **Contents: Read &
  write** and **Pull requests: Read & write** so the Worker can push session
  branches and open pull requests. Installation tokens are short-lived and are
  never stored in D1 or workspace files.
- `pnpm deploy` and `pnpm destroy` are managed through Alchemy only.
- `apps/web/src/server.ts` exports the Cloudflare Sandbox binding used by the app.
- `OPENCODE_API_KEY` is required for `opencode/deepseek-v4-flash-free`. The
  operator credential is injected ephemerally via `DITTO_PI_CREDENTIAL` and
  deleted inside the runner before tools start.
- Domain terminology: `CONTEXT.md`
- Documentation index: `docs/README.md`
- Agent-assisted development workflow: `docs/development/agent-workflow.md`
- Workspace sessions use separate Git worktrees but share one project sandbox.
  See `docs/architecture/agent-harness.md` for concurrency limits.
