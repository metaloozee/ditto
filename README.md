# Ditto

Ditto is a TanStack Start app deployed with Alchemy on Cloudflare Workers. It uses:

- Cloudflare D1 and Drizzle for durable product state
- better-auth with GitHub OAuth
- GitHub repository import through a GitHub App
- one isolated `@cloudflare/sandbox` runtime per workspace session
- immutable project seeds and workspace-session recovery archives in R2
- one fixed model, `opencode/deepseek-v4-flash-free`
- the PI harness inside the sandbox, streamed through `POST /api/agent/stream`

The Worker brokers model and Git traffic. Sandboxes receive no OpenCode key, GitHub installation token, R2 capability, or internal bearer token. User-owned project environment values enter only the agent command and remain subject to output redaction and Git secret preflight.

## Repository layout

| Path | Ownership |
|---|---|
| Root | Workspace orchestration, Alchemy deployment graph, and sandbox image |
| `apps/web` | TanStack Start UI, Worker routes, domain services, and D1 schema |
| `packages/sandbox-runner` | Independent npm package baked into the sandbox image |

Alchemy is the sole deployment owner. Do not add a Wrangler or SST deployment path.

## Prerequisites

- Node.js 22.19 or newer
- pnpm for the root workspace and `apps/web`
- npm for `packages/sandbox-runner`
- Cloudflare and GitHub credentials for the chosen local or deployment environment
- Cloudflare Sandbox capacity for container-backed integration runs

## Install

```bash
pnpm install --frozen-lockfile
npm ci --prefix packages/sandbox-runner
```

`pnpm runner:install` runs the second command.

## Development

```bash
pnpm dev
```

Alchemy generates local Wrangler configuration under `apps/web/.alchemy/local/` and starts Vite with the repository root as its environment directory. Rebuild or restart the sandbox image after runner, runner package, or `Dockerfile` changes.

Run the repository gate before review:

```bash
pnpm verify
```

## Database

Generate a migration after changing `apps/web/src/db/schema.ts`:

```bash
pnpm db:generate
```

Migrations live in `apps/web/migrations`. The plan 012 cutover migration is an explicit destructive pre-launch reset. Never apply that reset as a production deletion workflow.

## Commands

- `pnpm dev` runs local Alchemy and Vite
- `pnpm build` builds `@ditto/web`
- `pnpm check` runs Biome
- `pnpm test` runs web tests
- `pnpm typecheck` checks web TypeScript
- `pnpm runner:verify` checks, tests, and builds the runner
- `pnpm verify` runs the complete local gate
- `pnpm db:generate` generates Drizzle migrations
- `pnpm deploy` and `pnpm destroy` use Alchemy only

## Environment variables

Set these in a root `.env.local` for local development or through the deployment environment:

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
```

`BETTER_AUTH_URL` defaults to `http://localhost:5173` when omitted. `OPENCODE_API_KEY` stays in the Worker and authorizes only the fixed model through the outbound broker.

The GitHub App needs Contents read/write and Pull requests read/write. Product push remains disabled until the non-fast-forward feasibility gate passes, but the permissions remain required for the approved Git export path and pull-request operations.

See `CONTEXT.md` for domain terms and `docs/README.md` for the documentation index.
