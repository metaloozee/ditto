# Ditto

Ditto starts with the single-page TanStack Start template. The pnpm workspace contains the React and Tailwind app in `apps/web` and the Alchemy stack at the repository root.

## Getting started

Use Node.js 24, the pnpm version pinned in `package.json`, and Docker for the Cloudflare Sandbox.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec alchemy login
pnpm dev
```

`pnpm dev` runs the Worker and its bindings locally through Alchemy. Edit `apps/web/src/routes/index.tsx` to change the homepage. The root route owns Ditto’s document metadata.

## Verification

```sh
pnpm verify
```

This runs Biome, type-checks the app and stack, and builds the client and server. Run `pnpm preview` after the build to serve the web app locally.

## Cloudflare infrastructure

`alchemy.run.ts` defines the website Worker and its bindings for the `dev` stage.

| Binding | Resource |
| --- | --- |
| `DB` | D1 database `ditto-ayan-db` |
| `BACKUP_BUCKET` | R2 bucket `ditto-ayan-sandbox-backups` |
| `Sandbox` | Container-backed Durable Object using the stock Cloudflare Sandbox image |
| `AppState` | Application Durable Object namespace |

`apps/web/src/worker.ts` exports the Durable Object classes and delegates HTTP requests to TanStack Start. The Sandbox SDK and container image use the same version.

For deployment, authenticate Alchemy with Cloudflare and run `pnpm deploy`. Alchemy tracks the stack in local state under `.alchemy/`. Use the checkout with the existing state when updating an existing deployment. Applying this reset retires the trusted Git executor and wildcard preview route.
