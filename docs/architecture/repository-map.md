# Repository map

This reference maps stable areas of the repository to their responsibilities. It does not list every file.

## Root

| Path | Responsibility |
|---|---|
| `package.json` | Root commands and the pnpm workspace toolchain |
| `pnpm-workspace.yaml` | The `apps/*` pnpm workspace and dependency policy |
| `alchemy.run.ts` | Cloudflare Worker, D1, R2, Sandbox, bindings, and preview route |
| `Dockerfile` | Sandbox image and the baked `ditto-runner` commands |
| `README.md` | Installation, development, commands, and configuration |
| `PRODUCT.md` | Current product and product direction |
| `CONTEXT.md` | Canonical domain language |
| `AGENTS.md` | Repository instructions for coding agents |
| `CLAUDE.md` | Claude Code import of `AGENTS.md` |

Alchemy is the only deployment owner. Wrangler configuration under `apps/web/.alchemy/` is generated for local development and deployment.

## Web application

`apps/web` is the `@ditto/web` TanStack Start application.

| Path | Responsibility |
|---|---|
| `apps/web/src/routes/` | Browser routes and direct HTTP entry points |
| `apps/web/src/components/` | Product UI and reusable presentation |
| `apps/web/src/components/ui/` | Base UI and shadcn-derived controls |
| `apps/web/src/integrations/trpc/` | tRPC context, root router, browser client, and routers |
| `apps/web/src/integrations/tanstack-query/` | Query client and SSR integration |
| `apps/web/src/lib/` | Shared product policy and multi-step workflows |
| `apps/web/src/db/schema.ts` | Current D1 schema |
| `apps/web/migrations/` | Generated D1 migration history |
| `apps/web/src/server.ts` | Worker entry point and preview proxy |
| `apps/web/src/styles.css` | Tailwind theme and global styles |
| `apps/web/vite.config.ts` | Build, test, React, Tailwind, and local preview configuration |

Routes and components orchestrate. Shared ownership checks, lifecycle rules, security policy, and cross-entry-point behavior belong in `apps/web/src/lib`.

## Sandbox runner

`packages/sandbox-runner` is an independent npm package. It is not a pnpm workspace member.

| Path | Responsibility |
|---|---|
| `src/cli.ts` and `src/agent-job.ts` | Agent job boundary and CLI |
| `src/run-agent.ts` | PI session creation, events, follow-ups, and Stop |
| `src/runner-model.ts` | Model lookup and the in-memory credential store |
| `src/control-channel.ts` | Run-scoped control socket protocol |
| `src/protocol.ts` | Versioned NDJSON runner protocol |
| `src/ditto-git-*` | Agent Git tool definitions and Worker callback client |
| `src/provider-auth*` | Provider catalog, login, refresh, and control commands |
| `src/git-metadata-*` and `src/run-git-metadata.ts` | Isolated commit and pull-request metadata generation |

The root `Dockerfile` installs this package into the sandbox image. Rebuild the image after changing the runner, its package files, or the Dockerfile.

## Documentation

| Path | Responsibility |
|---|---|
| `docs/architecture/` | Implemented cross-file behavior and current limits |
| `docs/adr/` | Durable architectural decisions |
| `docs/specs/` | Proposed or required behavior with explicit status |
| `docs/research/` | Historical investigation and cited platform facts |
| `docs/development/` | Human-managed development workflow |

## Generated and local paths

| Path | Meaning |
|---|---|
| `apps/web/src/routeTree.gen.ts` | Generated TanStack Router tree |
| `apps/web/dist/`, `packages/sandbox-runner/dist/` | Build output |
| `.alchemy/`, `apps/web/.alchemy/`, `.wrangler/` | Local Cloudflare and Alchemy state |
| `node_modules/` and package-level `node_modules/` | Installed dependencies |
| `.scratch/` | Ignored local specifications and tickets |
| `plans/` | Ignored execution plans owned by the maintainer |

## Change routing

- Product behavior starts in `PRODUCT.md` and the system overview.
- Domain terminology starts in `CONTEXT.md`.
- UI and chat changes start in the frontend page.
- API, schema, and persistence changes start in the server page.
- Agent, worktree, backup, preview, and Git changes start in the harness page.
- Authentication, credentials, output, environment values, and Git egress changes require the security page.
- Infrastructure changes go through `alchemy.run.ts`. Do not add another deployment path.
