# Repository map

Status: target architecture. Implementation and validation pending. Requirements live in [trusted-session-runtime.md](../specs/trusted-session-runtime.md). Paths below are the current tree. The second Worker service and trusted brain image are not in the tree until cutover.

This reference maps stable areas of the repository to their responsibilities. It does not list every file.

## Root

| Path | Responsibility |
|---|---|
| `package.json` | Root commands and the pnpm workspace toolchain |
| `pnpm-workspace.yaml` | The `apps/*` pnpm workspace and dependency policy |
| `alchemy.run.ts` | Both Worker services, D1, R2, container images, bindings, and preview route |
| `Dockerfile` | Execution sandbox image. A second image pins Pi and Ditto-owned adapters. |
| `README.md` | Installation, development, commands, and configuration |
| `PRODUCT.md` | Current shipped product and product direction |
| `CONTEXT.md` | Canonical domain language for the architecture this spec ships |
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
| `apps/web/src/server.ts` | Product Worker entry point and preview origin. Container classes live on the runtime Worker. |
| `apps/web/src/styles.css` | Tailwind theme and global styles |
| `apps/web/vite.config.ts` | Build, test, React, Tailwind, and local preview configuration |

Routes and components orchestrate. Shared ownership checks, lifecycle rules, security policy, and cross-entry-point behavior belong in `apps/web/src/lib`.

## Agent and execution images

`packages/sandbox-runner` is an independent npm package. It is not a pnpm workspace member. Today it is the in-sandbox runner. After cutover, Pi and Ditto-owned adapters live in the trusted brain image; the execution image keeps repository tools and the remote-tool endpoint.

| Path | Responsibility |
|---|---|
| `src/cli.ts` and `src/agent-job.ts` | Current agent job boundary and CLI |
| `src/run-agent.ts` | Current PI session creation, events, follow-ups, and Stop |
| `src/runner-model.ts` | Model lookup and the in-memory public placeholder |
| `src/control-channel.ts` | Current run-scoped control socket protocol |
| `src/protocol.ts` | Versioned NDJSON runner protocol |
| `src/ditto-git-*` | Agent Git tool definitions and synthetic-origin Git-action client |
| `src/git-metadata-*` and `src/run-git-metadata.ts` | Isolated commit and pull-request metadata generation |

Rebuild the relevant image after changing runner code, package files, or Dockerfiles.

## Documentation

| Path | Responsibility |
|---|---|
| `docs/architecture/` | Target cross-file behavior with a pending-implementation status until cutover |
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

- Product behavior that already ships starts in `PRODUCT.md`.
- Target system behavior starts in the spec, then the system overview.
- Domain terminology starts in `CONTEXT.md`.
- UI and chat changes start in the frontend page.
- API, schema, and persistence changes start in the server page.
- Agent, execution, backup, preview, and Git changes start in the harness page.
- Authentication, credentials, output, environment values, and Git egress changes require the security page.
- Infrastructure changes go through `alchemy.run.ts`. Do not add another deployment path.
