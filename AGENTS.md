# Ditto agent instructions

## What Ditto is

Ditto is a web-based AI coding workspace for GitHub repositories. A user imports a repository, works with an agent in an isolated project workspace, previews the result, and exports changes through Git.

The web app runs on Cloudflare. It keeps durable product state in D1, runs repositories and coding agents in Cloudflare Sandboxes, and stores workspace recovery backups in R2.

## Repository map

- `apps/web` contains the TanStack Start UI, Worker routes, domain services, D1 schema, and migrations.
- `packages/sandbox-runner` contains the independent Node.js runner baked into the sandbox image. It uses npm, not the pnpm workspace.
- `docs/architecture` explains the implemented system and its trust boundaries.
- `docs/adr` records architectural decisions that remain in force.
- `docs/specs` contains behavioral requirements and proposed changes. Read each spec's status before treating it as implemented.
- `CONTEXT.md` defines Ditto's domain terms.

## Sources of truth

- Product intent: `PRODUCT.md`
- Domain terminology: `CONTEXT.md`
- Current behavior: source code, tests, and `apps/web/src/db/schema.ts`
- Architecture: `docs/architecture/`
- Decisions: `docs/adr/`
- Behavioral requirements: `docs/specs/`

When sources disagree, current code defines implemented behavior. Fix stale durable documentation in the same change.

## Core invariants

- The Worker is the control plane and the only issuer of GitHub installation tokens.
- D1 owns durable product records. The sandbox filesystem owns live repository and Git state. R2 backups provide recovery.
- A workspace session owns one chat thread, branch, and runtime. New sessions use a dedicated sandbox and `/workspace` checkout; legacy sessions may still share a project sandbox with Git worktrees.
- Every project and workspace operation checks the authenticated user's ownership.
- Secrets stay encrypted at rest, enter sandbox processes only when needed, and are redacted before output. Project secrets never enter worktree `.env` files.
- Every settled agent run leaves its assistant message in `complete` or `failed`, never `pending`.
- Alchemy owns deployment. Do not add another deployment path through Wrangler or SST.

## Working rules

- Make the smallest coherent change. Add an abstraction or dependency only when the current change needs it.
- Keep routes and UI focused on orchestration. Put shared policy and lifecycle behavior in `apps/web/src/lib`.
- In TypeScript, use `unknown` until runtime checks or control flow establish a narrower type. Avoid `any`.
- Test behavior that can regress. Prefer the nearest existing test seam.
- Comment only when the code cannot express a constraint or reason on its own.
- Preserve unrelated worktree changes.

## Verification

Run the narrowest relevant test while working.

- Web test: `pnpm --filter @ditto/web test -- <test-file>`
- Web type check: `pnpm typecheck`
- Runner test: `npm test --prefix packages/sandbox-runner -- <test-file>`
- Runner verification: `pnpm runner:verify`
- Final repository gate: `pnpm verify`

## Documentation

Update durable docs when behavior, architecture, security boundaries, or domain terminology changes. Keep implementation detail out of `CONTEXT.md`. Record an ADR only for a decision that is costly to reverse, surprising without context, and based on a real tradeoff.

## Further development workflow

For optional planning, review, writing, and skill workflows, see `docs/development/agent-workflow.md`.
