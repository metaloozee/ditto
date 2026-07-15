# Ditto documentation

This directory is the architecture map for Ditto. Read it before changing a
cross-cutting flow so product terms, state ownership, security boundaries, and
runtime behavior remain consistent.

## Start here

| Document | Read when you need to understand |
|---|---|
| [System architecture](architecture/overview.md) | Product goal, system context, major units, primary flows, state ownership, dependency direction, and limits |
| [Frontend architecture](architecture/frontend.md) | Routes, React Query/tRPC state, chat streaming, assistant parts, navigation, and UI layers |
| [Server and data architecture](architecture/server-and-data.md) | Worker entry points, tRPC routers, domain services, D1 schema, lifecycles, pagination, and infrastructure |
| [Agent harness architecture](architecture/agent-harness.md) | Sandbox wake/restore, PI runner execution, SSE, live session controls, session worktrees, concurrency, Git export, and backups |
| [Security and trust boundaries](architecture/security.md) | Authentication, authorization, encrypted env vars, redaction, callback JWTs, Git credentials, and egress policy |
| [Repository map](architecture/repository-map.md) | Responsibility of every source, test, migration, plan, configuration, and agent-tooling file |

## Recommended reading paths

### New maintainer or coding agent

1. Read [`PRODUCT.md`](../PRODUCT.md) for users, purpose, and design principles.
2. Read [System architecture](architecture/overview.md).
3. Follow the subsystem document for the files you will change.
4. Use the [Repository map](architecture/repository-map.md) to locate owners,
   adjacent tests, generated files, and historical plans.

### Chat or agent-runtime change

1. [Frontend architecture](architecture/frontend.md)
2. [Agent harness architecture](architecture/agent-harness.md)
3. [Security and trust boundaries](architecture/security.md)
4. Trace new runs through `apps/web/src/components/composer.tsx` →
   `apps/web/src/routes/api.agent.stream.ts` → `apps/web/src/lib/agent-run-service.ts` →
   `apps/web/src/lib/agent-run.ts` → `packages/sandbox-runner`.
5. Trace follow-up and Stop requests through `apps/web/src/components/composer.tsx` →
   `apps/web/src/routes/api.agent.control.ts` → `apps/web/src/lib/agent-control-service.ts` →
   `packages/sandbox-runner/src/control-channel.ts`.

### Project, sandbox, or persistence change

1. [Server and data architecture](architecture/server-and-data.md)
2. [Agent harness architecture](architecture/agent-harness.md)
3. `apps/web/src/integrations/trpc/routers/projects.ts` →
   `apps/web/src/lib/project-sandbox.ts` → `apps/web/src/lib/sandbox-bootstrap.ts` →
   `apps/web/src/lib/sandbox-backup.ts`

### Git or GitHub change

1. [Agent harness architecture](architecture/agent-harness.md#git-export)
2. [Security and trust boundaries](architecture/security.md)
3. `apps/web/src/integrations/trpc/routers/session-git.ts` and
   `apps/web/src/lib/agent-git-handler.ts` → `apps/web/src/lib/session-git.ts` → GitHub helpers

### Schema or message-history change

1. [Server and data architecture](architecture/server-and-data.md)
2. `apps/web/src/db/schema.ts`
3. The relevant domain service and tRPC router
4. Generated `apps/web/migrations/*` and colocated regression tests

## Sources of truth

When documents and code disagree, use this order while correcting the drift:

1. `PRODUCT.md` for product intent and vocabulary.
2. Current source code and `apps/web/src/db/schema.ts` for implemented behavior.
3. `docs/architecture/*` for the intended cross-file model.
4. `plans/*` for historical rationale only.

Implementation plans are not current specifications. Generated route trees,
Drizzle snapshots, lockfiles, and build output are not hand-edited architecture
sources.

## Architecture invariants

- The Worker is the control plane and the only GitHub installation-token issuer.
- D1 is authoritative for users, projects, workspace sessions, and chat history.
- The sandbox filesystem is authoritative for live repository and Git state.
- R2 backups provide recovery; they are not a mounted live workspace.
- A workspace session owns one chat thread, branch, and worktree.
- UI Git and agent Git paths reuse the same domain services and security policy.
- Project environment values are encrypted at rest, process-injected at run
  time, redacted at output boundaries, and never written to worktree `.env`.
- An assistant message reaches `complete` or `failed`; it must not remain
  `pending` after a settled server run.
- Routes and UI should orchestrate; shared policy belongs in `apps/web/src/lib`.

## Keeping these documents current

Update architecture documentation in the same change when you alter:

- a product concept or ownership boundary;
- a route/API, durable table, lifecycle state, or event protocol;
- sandbox persistence, worktree layout, concurrency, or backup behavior;
- authentication, authorization, credential flow, redaction, or Git egress; or
- the responsibility or generated status of a repository file.

Prefer editing the narrow subsystem document and its repository-map entry over
copying the same explanation into multiple files. Keep
`architecture/agent-harness.md` as the detailed execution-path reference and
link to it from broader documents.
