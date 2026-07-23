# Repository map

## Purpose

This is the exhaustive map of version-controlled and currently untracked, non-ignored files in the working tree. It gives humans and coding agents a stable starting point before changing a subsystem. Runtime/build directories such as `.git`, `node_modules`, `dist`, `.alchemy`, and `.wrangler`, plus local secret files such as `.env.local`, are intentionally excluded because they are generated, external, or private rather than source architecture.

The current behavior is authoritative in source and schema files. Files under `plans/` describe implementation history and may contain superseded designs. Drizzle snapshots, lockfiles, and `apps/web/src/routeTree.gen.ts` are generated artifacts and should not be edited by hand.

## Ownership

| Area | Path | Owns |
|---|---|---|
| Root orchestration | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `biome.json`, `lefthook.yml`, root scripts | Workspace install, quality gates, runner proxies, deploy entrypoints |
| Alchemy deploy graph | `alchemy.run.ts`, root `Dockerfile`, `.dockerignore` | Sole deployment owner: Worker, D1, R2, Sandbox container, bindings, secrets wiring. No SST or Wrangler deploy boundary. |
| Application (`@ditto/web`) | `apps/web/**` | TanStack Start UI, Worker routes, domain services, D1 schema, migrations, Vite/Drizzle/app package config |
| Sandbox runner (independent npm) | `packages/sandbox-runner/**` | PI harness CLI baked into the sandbox image; own lockfile, TypeScript, and Vitest. Not a pnpm workspace member. |
| Documentation | `docs/**`, `PRODUCT.md`, `README.md` | Product intent and architecture maps |
| Implementation history | `plans/**` | Historical plans only; not current specs |
| Agent tooling | `.agents/**`, `.claude/**`, `.cursor/**` | Coding-agent skills and hooks |

Generated under `apps/web` during local Alchemy/Vite: `apps/web/.alchemy/`, `apps/web/src/routeTree.gen.ts`, `apps/web/dist/`. Root may also hold `.alchemy/` state for the Alchemy app stage.

## Inventory

### Documentation

| File | Responsibility |
|---|---|
| `docs/README.md` | Documentation index and reading paths for humans and coding agents. |
| `docs/architecture/agent-harness.md` | Deep runtime path for sandbox execution, backups, worktrees, concurrency, and Git export. |
| `docs/architecture/frontend.md` | Frontend routes, data flow, chat model, UI layering, and testing architecture. |
| `docs/architecture/overview.md` | System context, units, flows, state ownership, boundaries, and architecture navigation. |
| `docs/architecture/repository-map.md` | This exhaustive working-tree file inventory and ownership map. |
| `docs/architecture/security.md` | Authentication, authorization, encryption, redaction, credential, and Git-egress boundaries. |
| `docs/architecture/server-and-data.md` | Worker APIs, domain services, schema, lifecycles, persistence, and infrastructure. |

### Application foundation (`apps/web/src`)

| File | Responsibility |
|---|---|
| `apps/web/src/env.ts` | Validates public/server configuration with t3-env and Zod. |
| `apps/web/src/hooks/use-mobile.ts` | Reactive mobile-breakpoint hook used by responsive primitives. |
| `apps/web/src/routeTree.gen.ts` | Generated TanStack Router route tree and route type registry; never edit manually. |
| `apps/web/src/router.tsx` | Creates the TanStack Router, SSR query integration, and application data-provider wrapper. |
| `apps/web/src/server.ts` | Cloudflare Worker entry: TanStack Start fetch handler and Sandbox Durable Object export. |
| `apps/web/src/styles.css` | Tailwind v4 imports, theme tokens, dark palette, typography, and global application styles. |

### Frontend components (`apps/web`)

| File | Responsibility |
|---|---|
| `apps/web/src/components/ai-chat.test.tsx` | Regression tests for `apps/web/src/components/ai-chat.tsx` behavior and edge cases. |
| `apps/web/src/components/ai-chat.tsx` | Chat timeline, message normalization, history loading, optimistic overlay, queued follow-up projection, assistant-part rendering, and responsive session tools pane composition. |
| `apps/web/src/components/chat-navbar.tsx` | Chat top bar: branch, git actions slot, right-sidebar tools trigger. |
| `apps/web/src/components/session-tools-pane.tsx` | Right tools container (`bg-muted`, `rounded-lg`) with Preview/Terminal/Code header; Terminal/Code disabled. |
| `apps/web/src/components/session-tools-pane.test.tsx` | Tools pane chrome, disabled tabs, close control. |
| `apps/web/src/components/chat-navbar.test.tsx` | Tools trigger placement, independence from git actions, and open-state toggle. |
| `apps/web/src/components/session-preview-pane.tsx` | Ephemeral session website preview pane (start/restart/stop + sandboxed iframe). |
| `apps/web/src/components/session-preview-pane.test.tsx` | Preview pane state, public warning, iframe policy, retry/restart/stop, stale-session suppression. |
| `apps/web/src/components/ai-elements/model-selector.tsx` | Composable model selection dialog/command components. |
| `apps/web/src/components/ai-elements/task.tsx` | Composable task/progress presentation components. |
| `apps/web/src/components/app-shell.tsx` | Composes sidebar, content inset, toasts, and global tooltip provider. |
| `apps/web/src/components/app-sidebar.test.tsx` | Regression tests for `apps/web/src/components/app-sidebar.tsx` behavior and edge cases. |
| `apps/web/src/components/app-sidebar.tsx` | Project/session navigation, search, creation/settings launchers, archival, and account footer. |
| `apps/web/src/components/assistant-markdown.tsx` | Safe styled Markdown/code rendering for assistant text. |
| `apps/web/src/components/composer.test.tsx` | Regression tests for `apps/web/src/components/composer.tsx` behavior and edge cases. |
| `apps/web/src/components/composer.tsx` | Prompt/model input, browser-side SSE lifecycle, multi-turn commits, follow-up queueing, and Stop controls. |
| `apps/web/src/components/edit-tool-diff.tsx` | Lazy visual diff renderer for PI edit-tool calls. |
| `apps/web/src/components/nav-user.tsx` | Authenticated user menu and sign-out behavior. |
| `apps/web/src/components/new-project-dialog.test.tsx` | Regression tests for `apps/web/src/components/new-project-dialog.tsx` behavior and edge cases. |
| `apps/web/src/components/new-project-dialog.tsx` | GitHub repository picker, project env-var editor, and provisioning mutation. |
| `apps/web/src/components/project-settings-dialog.tsx` | Project rename/delete and write-only environment-variable management. |
| `apps/web/src/components/session-git-actions.test.tsx` | Regression tests for `apps/web/src/components/session-git-actions.tsx` behavior and edge cases. |
| `apps/web/src/components/session-git-actions.tsx` | Renders and executes the server-derived sync/commit/push/PR workflow. |
| `apps/web/src/components/tool-call-group.test.tsx` | Regression tests for `apps/web/src/components/tool-call-group.tsx` behavior and edge cases. |
| `apps/web/src/components/tool-call-group.tsx` | Collapsible grouped tool-call activity with elapsed duration. |
| `apps/web/src/components/ui/alert-dialog.tsx` | Confirmation modal primitive. |
| `apps/web/src/components/ui/avatar.tsx` | User image/fallback primitive. |
| `apps/web/src/components/ui/badge.tsx` | Compact status-label primitive. |
| `apps/web/src/components/ui/bubble.tsx` | Chat bubble layout primitive. |
| `apps/web/src/components/ui/button.tsx` | Button variants and styling primitive. |
| `apps/web/src/components/ui/collapsible.tsx` | Base UI collapsible wrapper. |
| `apps/web/src/components/ui/command.tsx` | Search/command palette primitives. |
| `apps/web/src/components/ui/dialog.tsx` | Base UI dialog wrapper. |
| `apps/web/src/components/ui/dropdown-menu.tsx` | Dropdown menu primitives. |
| `apps/web/src/components/ui/field.tsx` | Accessible field, label, description, and error composition. |
| `apps/web/src/components/ui/grainient.tsx` | WebGL animated gradient background. |
| `apps/web/src/components/ui/input-group.tsx` | Compound textarea/input with addons and actions. |
| `apps/web/src/components/ui/input.tsx` | Styled input primitive. |
| `apps/web/src/components/ui/label.tsx` | Styled Base UI label. |
| `apps/web/src/components/ui/message-scroller.tsx` | Chat scroll context, viewport, anchor preservation, and jump button. |
| `apps/web/src/components/ui/message.tsx` | Chat message layout primitive. |
| `apps/web/src/components/ui/scroll-area.tsx` | Base UI scroll-area wrapper. |
| `apps/web/src/components/ui/select.tsx` | Select primitive used for model thinking-level choices. |
| `apps/web/src/components/ui/separator.tsx` | Semantic visual separator. |
| `apps/web/src/components/ui/sheet.tsx` | Slide-over sheet primitive. |
| `apps/web/src/components/ui/sidebar.tsx` | Responsive/collapsible sidebar state and component system. |
| `apps/web/src/components/ui/skeleton.tsx` | Loading placeholder primitive. |
| `apps/web/src/components/ui/sonner.tsx` | Theme-aware toast viewport. |
| `apps/web/src/components/ui/spinner.tsx` | Accessible SVG loading spinner. |
| `apps/web/src/components/ui/textarea.tsx` | Styled textarea primitive. |
| `apps/web/src/components/ui/tooltip.tsx` | Base UI tooltip primitives. |

### Routes and API entry points (`apps/web`)

| File | Responsibility |
|---|---|
| `apps/web/src/routes/__root.tsx` | Root document metadata, global shell selection, CSS, scripts, and lazy development tools. |
| `apps/web/src/routes/api.agent.control.test.ts` | Regression tests for authenticated follow-up/Stop routing and error mapping. |
| `apps/web/src/routes/api.agent.control.ts` | Cookie-authenticated endpoint controlling one active PI agent session. |
| `apps/web/src/routes/api.agent.git.test.ts` | Regression tests for `apps/web/src/routes/api.agent.git.ts` behavior and edge cases. |
| `apps/web/src/routes/api.agent.git.ts` | JWT-authenticated callback endpoint for sandbox agent Git tools. |
| `apps/web/src/routes/api.agent.stream.test.ts` | Regression tests for `apps/web/src/routes/api.agent.stream.ts` behavior and edge cases. |
| `apps/web/src/routes/api.agent.stream.ts` | Cookie-authenticated SSE endpoint that prepares and executes an agent run. |
| `apps/web/src/routes/api.auth.$.ts` | Mounts the better-auth HTTP handler. |
| `apps/web/src/routes/api.trpc.$.tsx` | Mounts the Worker tRPC fetch adapter. |
| `apps/web/src/routes/index.tsx` | Authentication-aware dashboard with project list, status, and creation entry point. |
| `apps/web/src/routes/installation.completed.tsx` | GitHub App installation popup completion notifier. |
| `apps/web/src/routes/project.$projectId.index.tsx` | New-conversation child route for a project. |
| `apps/web/src/routes/project.$projectId.session.$sessionId.tsx` | Existing-conversation child route for a project session. |
| `apps/web/src/routes/project.$projectId.tsx` | Project workspace coordinator: project readiness, restore, selected session, history, and chat. |
| `apps/web/src/routes/sign-in.tsx` | GitHub OAuth sign-in UI and authenticated redirect. |

### Client/server integrations (`apps/web`)

| File | Responsibility |
|---|---|
| `apps/web/src/integrations/tanstack-query/devtools-bundle.tsx` | Lazy development-only React Query and Router devtools bundle. |
| `apps/web/src/integrations/tanstack-query/devtools.tsx` | Compatibility entry for development query/router devtools. |
| `apps/web/src/integrations/tanstack-query/root-context.ts` | Creates Query Client, tRPC client, SuperJSON transport, and typed query options proxy. |
| `apps/web/src/integrations/tanstack-query/root-provider.tsx` | Provides tRPC and React Query to the route tree. |
| `apps/web/src/integrations/trpc/init.ts` | Builds tRPC context, SuperJSON transformer, and authenticated procedure middleware. |
| `apps/web/src/integrations/trpc/react.ts` | Exports the typed React tRPC context/provider hook. |
| `apps/web/src/integrations/trpc/router.ts` | Combines all application tRPC routers into the public API type. |
| `apps/web/src/integrations/trpc/routers/github.ts` | Authenticated GitHub import-state and branch-listing procedures. |
| `apps/web/src/integrations/trpc/routers/health.ts` | Minimal public liveness procedure. |
| `apps/web/src/integrations/trpc/routers/projects.ts` | Project CRUD, sandbox provisioning, encrypted environment-variable management, and project listing. |
| `apps/web/src/integrations/trpc/routers/provider-auth.ts` | Authenticated provider catalog, connection, model-capability, and disconnect queries/mutations. |
| `apps/web/src/integrations/trpc/routers/session-git.test.ts` | Router tests for generated vs explicit commit/PR metadata delegation and error mapping. |
| `apps/web/src/integrations/trpc/routers/session-git.ts` | Authenticated UI API for session Git status, sync, commit, push, and pull requests. |
| `apps/web/src/integrations/trpc/routers/workspace.test.ts` | Regression tests for `apps/web/src/integrations/trpc/routers/workspace.ts` behavior and edge cases. |
| `apps/web/src/integrations/trpc/routers/workspace.ts` | Workspace ensure/retry, active-session reads, keyset message pagination, and session archival. |

### Domain libraries (`apps/web`)

| File | Responsibility |
|---|---|
| `apps/web/src/lib/account-provider-credentials.ts` | Encrypted account credentials, safe model catalogs, runtime projection, and refresh leases. |
| `apps/web/src/lib/agent-control-service.test.ts` | Regression tests for ownership, safe control jobs, cleanup, and stale targets. |
| `apps/web/src/lib/agent-control-service.ts` | Validates and dispatches run-scoped follow-up/Stop jobs to the sandbox control CLI. |
| `apps/web/src/lib/agent-delta-batcher.test.ts` | Regression tests for `apps/web/src/lib/agent-delta-batcher.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-delta-batcher.ts` | Batches contiguous text deltas while preserving text/tool event order. |
| `apps/web/src/lib/agent-git-handler.test.ts` | Regression tests for `apps/web/src/lib/agent-git-handler.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-git-handler.ts` | Resolves signed callback claims to current resources and dispatches shared Git operations. |
| `apps/web/src/lib/agent-git-jwt.test.ts` | Regression tests for `apps/web/src/lib/agent-git-jwt.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-git-jwt.ts` | Mints and verifies short-lived scoped agent callback JWTs. |
| `apps/web/src/lib/agent-message-parts.test.ts` | Regression tests for `apps/web/src/lib/agent-message-parts.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-message-parts.ts` | Canonical ordered assistant text/tool model and PI event reducers. |
| `apps/web/src/lib/agent-message-storage.test.ts` | Regression tests for `apps/web/src/lib/agent-message-storage.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-message-storage.ts` | Bounds, serializes, migrates, and parses durable assistant parts. |
| `apps/web/src/lib/agent-models.test.ts` | Regression tests for canonical thinking levels, capability clamping, and model specifiers. |
| `apps/web/src/lib/agent-models.ts` | Canonical Pi thinking levels, capability clamping, model-specifier validation, and fallback model metadata. |
| `apps/web/src/lib/agent-run-service.test.ts` | Regression tests for `apps/web/src/lib/agent-run-service.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-run-service.ts` | Request/model/capability validation, agent preparation, multi-turn streaming lifecycle, terminal D1 persistence, and post-run backup. |
| `apps/web/src/lib/agent-run.test.ts` | Regression tests for `apps/web/src/lib/agent-run.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-run.ts` | Sandbox shell/job execution, runner protocol bridge, streaming redaction, lock, and cleanup. |
| `apps/web/src/lib/agent-stream-client.test.ts` | Regression tests for `apps/web/src/lib/agent-stream-client.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-stream-client.ts` | Browser SSE request/parser, typed turn handlers, optional thinking-level request field, and JSON agent-control client. |
| `apps/web/src/lib/agent-stream-protocol.test.ts` | Regression tests for `apps/web/src/lib/agent-stream-protocol.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-stream-protocol.ts` | Worker-side runner NDJSON parsing and SSE encoding helpers. |
| `apps/web/src/lib/agent-tool-presentation.test.ts` | Regression tests for `apps/web/src/lib/agent-tool-presentation.ts` behavior and edge cases. |
| `apps/web/src/lib/agent-tool-presentation.ts` | Tool labels/details, edit extraction, grouping, and timing presentation rules. |
| `apps/web/src/lib/auth.client.ts` | Browser better-auth client. |
| `apps/web/src/lib/auth.functions.ts` | Server function that reads the current auth session for routes. |
| `apps/web/src/lib/auth.ts` | Configures better-auth, Drizzle adapter, GitHub OAuth, and TanStack cookies. |
| `apps/web/src/lib/chat-session-cache.test.ts` | Regression tests for `apps/web/src/lib/chat-session-cache.ts` behavior and edge cases. |
| `apps/web/src/lib/chat-session-cache.ts` | Bounded in-memory optimistic message cache keyed by workspace session. |
| `apps/web/src/lib/crypto.ts` | Versioned PBKDF2/AES-GCM text encryption used for project secrets. |
| `apps/web/src/lib/ditto-git-identity.ts` | Canonical Git author identity and shell environment. |
| `apps/web/src/lib/env-vars.test.ts` | Regression tests for `apps/web/src/lib/env-vars.ts` behavior and edge cases. |
| `apps/web/src/lib/env-vars.ts` | Environment-variable key normalization and validation copy. |
| `apps/web/src/lib/git-secret-policy.test.ts` | Regression tests for `apps/web/src/lib/git-secret-policy.ts` behavior and edge cases. |
| `apps/web/src/lib/git-secret-policy.ts` | Fail-closed outgoing Git range/path/content secret scanner. |
| `apps/web/src/lib/github-app.ts` | GitHub App construction and short-lived installation-token minting. |
| `apps/web/src/lib/github-authorization.ts` | Proves the signed-in user can access a repository through an installation. |
| `apps/web/src/lib/github-export.test.ts` | Regression tests for `apps/web/src/lib/github-export.ts` behavior and edge cases. |
| `apps/web/src/lib/github-export.ts` | Branch, commit, PR metadata, shell quoting, diff summary, and redacted export-output helpers. |
| `apps/web/src/lib/github-repositories.test.ts` | Regression tests for `apps/web/src/lib/github-repositories.ts` behavior and edge cases. |
| `apps/web/src/lib/github-repositories.ts` | Lists and normalizes user-visible GitHub App installations/repositories. |
| `apps/web/src/lib/message-cursor.test.ts` | Regression tests for `apps/web/src/lib/message-cursor.ts` behavior and edge cases. |
| `apps/web/src/lib/message-cursor.ts` | Opaque validated `(createdAt,rowid)` cursor codec and comparison helpers. |
| `apps/web/src/lib/project-env-vars.ts` | Sanitizes, encrypts, decrypts, and hides project environment values. |
| `apps/web/src/lib/project-sandbox.test.ts` | Regression tests for `apps/web/src/lib/project-sandbox.ts` behavior and edge cases. |
| `apps/web/src/lib/project-sandbox.ts` | Connects/restores/recreates project sandboxes and versions backup writes. |
| `apps/web/src/lib/provider-auth-service.ts` | Provider catalog discovery, auth/refresh sandbox orchestration, connection persistence, and account model discovery. |
| `apps/web/src/lib/sandbox-backup.test.ts` | Regression tests for `apps/web/src/lib/sandbox-backup.ts` behavior and edge cases. |
| `apps/web/src/lib/sandbox-backup.ts` | Backup handle codec, R2/local options, TTL, and exclusion policy. |
| `apps/web/src/lib/sandbox-bootstrap.test.ts` | Regression tests for `apps/web/src/lib/sandbox-bootstrap.ts` behavior and edge cases. |
| `apps/web/src/lib/sandbox-bootstrap.ts` | Low-level Sandbox SDK, Git clone/fetch, dependency install, health, backup, and restore operations. |
| `apps/web/src/lib/secret-redaction.test.ts` | Regression tests for `apps/web/src/lib/secret-redaction.ts` behavior and edge cases. |
| `apps/web/src/lib/secret-redaction.ts` | Concrete/pattern/streaming secret redaction for text and structured output. |
| `apps/web/src/lib/session-git-backup.test.ts` | Regression tests for `apps/web/src/lib/session-git-backup.ts` behavior and edge cases. |
| `apps/web/src/lib/session-git-backup.ts` | Wraps successful Git mutations with best-effort versioned workspace backup. |
| `apps/web/src/lib/session-git-metadata.test.ts` | Regression tests for bounded snapshot collection and metadata runner bridge. |
| `apps/web/src/lib/session-git-metadata.ts` | Collects redacted Git snapshots and runs the one-shot metadata CLI bridge. |
| `apps/web/src/lib/session-git-trpc-errors.test.ts` | Regression tests for `apps/web/src/lib/session-git-trpc-errors.ts` behavior and edge cases. |
| `apps/web/src/lib/session-git-trpc-errors.ts` | Maps shared Git mutation errors to stable tRPC errors. |
| `apps/web/src/lib/session-git-ui-actions.test.ts` | Regression tests for lock/generate/mutate/backup ordering of UI git actions. |
| `apps/web/src/lib/session-git-ui-actions.ts` | UI Commit/Open PR orchestration under one session workspace lock. |
| `apps/web/src/lib/session-git.test.ts` | Regression tests for `apps/web/src/lib/session-git.ts` behavior and edge cases. |
| `apps/web/src/lib/session-git.ts` | Session Git/GitHub state machine and sync/commit/push/pull-request implementation. |
| `apps/web/src/lib/session-workspace-lock-error.ts` | Shared typed busy error for concurrent session workspace writes. |
| `apps/web/src/lib/session-workspace-lock.test.ts` | Regression tests for `apps/web/src/lib/session-workspace-lock.ts` behavior and edge cases. |
| `apps/web/src/lib/session-workspace-lock.ts` | Atomic per-session sandbox `/tmp` lock with stale-lock recovery. |
| `apps/web/src/lib/session-worktree.test.ts` | Regression tests for `apps/web/src/lib/session-worktree.ts` behavior and edge cases. |
| `apps/web/src/lib/session-worktree.ts` | Creates or restores a session branch/worktree and links shared dependencies. |
| `apps/web/src/lib/user-preferences-store.ts` | Validated persisted browser model and abstract thinking-level preferences. |
| `apps/web/src/lib/utils.ts` | Shared Tailwind class merge helper. |
| `apps/web/src/lib/workspace-policy.test.ts` | Regression tests for `apps/web/src/lib/workspace-policy.ts` behavior and edge cases. |
| `apps/web/src/lib/workspace-policy.ts` | Canonical workspace paths, session statuses, branch/lock naming, and title policy. |
| `apps/web/src/lib/workspace-session.test.ts` | Regression tests for `apps/web/src/lib/workspace-session.ts` behavior and edge cases. |
| `apps/web/src/lib/workspace-session.ts` | Owned active-session loading, creation resolution, archival, and recency update. |

### Database (`apps/web`)

| File | Responsibility |
|---|---|
| `apps/web/src/db/index.ts` | Constructs the typed Drizzle D1 client. |
| `apps/web/src/db/schema.ts` | Current D1 schema for auth, projects, workspace sessions, messages, provider credentials/attempts, and starter todos. |

### Sandbox runner (`packages/sandbox-runner`)

| File | Responsibility |
|---|---|
| `packages/sandbox-runner/.gitignore` | Excludes runner build output and dependencies. |
| `packages/sandbox-runner/package-lock.json` | Generated pinned dependency graph for the independent runner package. |
| `packages/sandbox-runner/package.json` | Independent npm package manifest for the baked PI runner. |
| `packages/sandbox-runner/src/agent-job.test.ts` | Regression tests for sandbox job validation and canonical thinking levels. |
| `packages/sandbox-runner/src/agent-job.ts` | Validates sandbox agent job JSON, including the canonical optional thinking level. |
| `packages/sandbox-runner/src/cli.ts` | Reads validated job files, invokes the harness, and writes protocol NDJSON to stdout. |
| `packages/sandbox-runner/src/control-channel.test.ts` | Regression tests for run-scoped Unix control framing, serialization, validation, and cleanup. |
| `packages/sandbox-runner/src/control-channel.ts` | Run-scoped Unix socket protocol for serialized PI follow-up and Stop commands. |
| `packages/sandbox-runner/src/control-cli.ts` | Reads one JSON control job, contacts the live runner socket, and prints one response. |
| `packages/sandbox-runner/src/ditto-git-callback.ts` | Posts signed push/PR tool actions back to the Worker and scrubs callback tokens. |
| `packages/sandbox-runner/src/ditto-git-guidance.ts` | Prompt guidance and descriptions for Ditto-specific Git tools. |
| `packages/sandbox-runner/src/ditto-git-tools.test.ts` | Regression tests for `packages/sandbox-runner/src/ditto-git-tools.ts` behavior and edge cases. |
| `packages/sandbox-runner/src/ditto-git-tools.ts` | Defines PI custom tools for pushing and opening pull requests through the Worker. |
| `packages/sandbox-runner/src/git-metadata-cli.test.ts` | Regression tests for the one-shot metadata CLI entrypoint. |
| `packages/sandbox-runner/src/git-metadata-cli.ts` | Reads a bounded job file, runs metadata drafting, prints one protocol line. |
| `packages/sandbox-runner/src/git-metadata-job.test.ts` | Regression tests for the closed git-metadata job/result protocol. |
| `packages/sandbox-runner/src/git-metadata-job.ts` | Versioned job/result unions, size caps, and safe error encoding for metadata drafting. |
| `packages/sandbox-runner/src/protocol.test.ts` | Regression tests for `packages/sandbox-runner/src/protocol.ts` behavior and edge cases. |
| `packages/sandbox-runner/src/protocol.ts` | Versioned runner output union, PI event normalization, and terminal text fallback helpers. |
| `packages/sandbox-runner/src/provider-auth.test.ts` | Regression tests for provider capability projection and runtime credential handling. |
| `packages/sandbox-runner/src/provider-auth.ts` | Provider login/refresh runner, safe model capability projection, auth events, and runtime credential projection. |
| `packages/sandbox-runner/src/run-agent.test.ts` | Regression tests for PI follow-up FIFO, Stop ordering, expected abort, and socket cleanup. |
| `packages/sandbox-runner/src/run-agent.ts` | Resolves model credentials, creates/resumes PI sessions with optional thinking level, binds controls, emits events, and settles a run. |
| `packages/sandbox-runner/src/run-git-metadata.test.ts` | Regression tests for the isolated one-shot metadata PI session. |
| `packages/sandbox-runner/src/run-git-metadata.ts` | In-memory PI session with a single terminating typed metadata tool and two-turn cap. |
| `packages/sandbox-runner/src/runner-model.test.ts` | Regression tests for shared in-memory credential/model bootstrap. |
| `packages/sandbox-runner/src/runner-model.ts` | Parses model specifiers, seeds `InMemoryCredentialStore`, scrubs credential env vars. |
| `packages/sandbox-runner/tsconfig.json` | Runner TypeScript/build settings. |
| `packages/sandbox-runner/vitest.config.ts` | Runner Vitest configuration. |

### Migrations (`apps/web/migrations`)

| File | Responsibility |
|---|---|
| `apps/web/migrations/0000_wet_giant_girl.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0001_jazzy_firelord.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0002_sparkling_agent_zero.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0003_material_ghost_rider.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0004_same_stellaris.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0005_illegal_invisible_woman.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0006_late_wonder_man.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0007_amused_shinobi_shaw.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0008_chunky_sunset_bain.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0009_worthless_young_avengers.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `apps/web/migrations/0010_worthless_george_stacy.sql` | Ordered Drizzle SQL migration adding account provider credentials and auth attempts. |
| `apps/web/migrations/meta/0000_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0001_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0002_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0003_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0004_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0005_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0006_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0007_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0008_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0009_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/0010_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `apps/web/migrations/meta/_journal.json` | Generated Drizzle migration journal and ordering metadata. |

### Root orchestration and Alchemy

| File | Responsibility |
|---|---|
| `.cursorrules` | Repository guidance loaded by Cursor. |
| `.dockerignore` | Removes local/generated files from the sandbox image build context; keeps `packages/sandbox-runner` sources. |
| `.github/workflows/ci.yml` | CI installation and full root/runner verification workflow. |
| `.gitignore` | Excludes dependencies, builds, local state, secrets, and generated deployment artifacts. |
| `.vscode/settings.json` | Workspace editor defaults for TypeScript, Tailwind, and formatting. |
| `Dockerfile` | Builds the Cloudflare Sandbox image from repo root and installs the independent Ditto runner CLI. |
| `PRODUCT.md` | Canonical product purpose, users, brand, interaction principles, and accessibility intent. |
| `README.md` | Root developer quick start, monorepo layout, environment, scripts, and operational notes. |
| `alchemy.run.ts` | Sole deployment owner: Worker (cwd `apps/web`), Sandbox container, D1, R2, bindings, and secrets. |
| `biome.json` | Biome formatter/linter policy and generated/vendor exclusions. |
| `lefthook.yml` | Runs formatting/lint hooks around Git operations. |
| `package.json` | Root scripts (dev/deploy/verify/db/runner proxies), Alchemy dependency, and shared toolchain. |
| `pnpm-lock.yaml` | Generated, pinned dependency graph for the root pnpm workspace. |
| `pnpm-workspace.yaml` | Workspace/install policy, including the scoped Streamdown 2.5.0 type-peer metadata patch; remove it when upstream declares the peer. |
| `skills-lock.json` | Pins installed coding-agent skills and their source revisions. |

### Application package (`apps/web`)

| File | Responsibility |
|---|---|
| `apps/web/.cta.json` | Cloudflare/TanStack agent-tooling metadata. |
| `apps/web/components.json` | shadcn component registry, aliases, icon set, and styling configuration. |
| `apps/web/drizzle.config.ts` | Points Drizzle Kit at the D1 schema and `apps/web/migrations` output. |
| `apps/web/package.json` | `@ditto/web` scripts, app dependencies, and `#/*` import map. |
| `apps/web/tsconfig.json` | Application TypeScript settings and path aliases. |
| `apps/web/types/env.d.ts` | Cloudflare binding types for D1, Sandbox, R2, GitHub, auth, and provider configuration. |
| `apps/web/vite.config.ts` | Composes Vite, TanStack Start, Tailwind, React Compiler, devtools, tests, root `envDir`, and conditional Alchemy integration. |

### Public assets

| File | Responsibility |
|---|---|
| `apps/web/public/favicon.ico` | Browser favicon binary. |
| `apps/web/public/robots.txt` | Crawler policy for the deployed website. |

### Implementation history

| File | Responsibility |
|---|---|
| `plans/001-ai-harness-runner.md` | Historical implementation plan: Plan 001: Bake PI AI harness into sandbox image. |
| `plans/002-agent-run-orchestration.md` | Historical implementation plan: Plan 002: Worker agent run + SSE stream + post-run backup. |
| `plans/003-sse-streaming-ui.md` | Historical implementation plan: Plan 003: Stream agent events in chat UI + architecture docs. |
| `plans/004-react-effect-deslop.md` | Historical implementation plan: Plan 004: Remove Effect anti-patterns and deslop chat UI. |
| `plans/005-session-worktrees-and-branches.md` | Historical implementation plan: Plan 005: Session worktrees + branch lifecycle for concurrent agents. |
| `plans/006-worker-git-export-and-ui.md` | Historical implementation plan: Plan 006: Worker-owned commit / push / open PR + UI. |
| `plans/007-agent-worker-git-tools.md` | Historical implementation plan: Plan 007: Agent chat tools for push / open PR via Worker callback. |
| `plans/008-pr-title-body-from-commits.md` | Historical implementation plan: Plan 008: Craft PR title/body from branch commits. |
| `plans/009-stale-composer-git-status-after-export.md` | Historical implementation plan: Plan 009: Fix stale composer git status after commit/push (missing sandbox backup). |
| `plans/010-sync-primary-before-session-worktree.md` | Historical implementation plan: Plan 010: Sync the primary repository before creating a session worktree. |
| `plans/011-establish-verification-baseline.md` | Historical implementation plan: Plan 011: Establish one clean repository verification baseline. |
| `plans/012-redact-agent-output-boundaries.md` | Historical implementation plan: Plan 012: Redact agent output before streaming or persistence. |
| `plans/013-harden-git-secret-egress.md` | Historical implementation plan: Plan 013: Block secret-bearing commits before local commit or GitHub export. |
| `plans/014-version-and-deduplicate-backups.md` | Historical implementation plan: Plan 014: Version workspace backups and snapshot only after mutations. |
| `plans/015-enforce-session-archive-lifecycle.md` | Historical implementation plan: Plan 015: Make session archival consistent across server and client state. |
| `plans/016-reject-malformed-agent-jwts.md` | Historical implementation plan: Plan 016: Return 401 for every malformed agent callback JWT. |
| `plans/017-extract-agent-run-lifecycle.md` | Historical implementation plan: Plan 017: Make the agent-run lifecycle transactional and testable. |
| `plans/018-bound-streaming-work.md` | Historical implementation plan: Plan 018: Bound stderr memory and batch streaming updates. |
| `plans/019-trim-production-bundle.md` | Historical implementation plan: Plan 019: Remove unused dependencies and lazy-load diagnostic chat code. |
| `plans/020-paginate-and-virtualize-chat-history.md` | Historical implementation plan: Plan 020: Infinite-scroll conversation history (cursor + virtualize). |
| `plans/021-align-worktree-environment-docs.md` | Historical implementation plan: Plan 021: Document process-injected project environment variables accurately. |
| `plans/022-timed-tool-call-groups.md` | Historical implementation plan: Plan 022: Make tool-call groups durable, timed, and polished. |
| `plans/023-pi-follow-up-and-stop-controls.md` | Historical implementation plan: Plan 023: Queue PI follow-ups and stop the active agent from the composer. |
| `plans/024-conservative-sst-monorepo-migration.md` | Historical implementation plan: Plan 024: Reorganize Ditto into an Alchemy-owned monorepo (`apps/web` + `packages/sandbox-runner`). |
| `plans/README.md` | Index, status, and context for the repository implementation-plan history. |

### Agent tooling

| File | Responsibility |
|---|---|
| `.agents/skills/baseline-ui/SKILL.md` | Primary coding-agent copy of baseline-ui coding-agent instructions: Baseline UI. |
| `.agents/skills/caveman-commit/README.md` | Primary coding-agent copy of caveman-commit coding-agent instructions: caveman-commit. |
| `.agents/skills/caveman-commit/SKILL.md` | Primary coding-agent copy of caveman-commit coding-agent instructions. |
| `.agents/skills/caveman-review/README.md` | Primary coding-agent copy of caveman-review coding-agent instructions: caveman-review. |
| `.agents/skills/caveman-review/SKILL.md` | Primary coding-agent copy of caveman-review coding-agent instructions. |
| `.agents/skills/caveman/README.md` | Primary coding-agent copy of caveman coding-agent instructions: caveman. |
| `.agents/skills/caveman/SKILL.md` | Primary coding-agent copy of caveman coding-agent instructions. |
| `.agents/skills/deslop/SKILL.md` | Primary coding-agent copy of deslop coding-agent instructions: Code Simplification Specialist. |
| `.agents/skills/diagnose/SKILL.md` | Primary coding-agent copy of diagnose coding-agent instructions: Diagnose. |
| `.agents/skills/diagnose/scripts/hitl-loop.template.sh` | Primary coding-agent copy of an executable/template helper for the diagnose skill. |
| `.agents/skills/durable-objects/SKILL.md` | Primary coding-agent copy of durable-objects coding-agent instructions: Durable Objects. |
| `.agents/skills/durable-objects/references/rules.md` | Primary coding-agent copy of supporting reference material for the durable-objects skill. |
| `.agents/skills/durable-objects/references/testing.md` | Primary coding-agent copy of supporting reference material for the durable-objects skill. |
| `.agents/skills/durable-objects/references/workers.md` | Primary coding-agent copy of supporting reference material for the durable-objects skill. |
| `.agents/skills/emil-design-eng/SKILL.md` | Primary coding-agent copy of emil-design-eng coding-agent instructions: Design Engineering. |
| `.agents/skills/find-similar-functions/SKILL.md` | Primary coding-agent copy of find-similar-functions coding-agent instructions: Similar Function Finder. |
| `.agents/skills/find-skills/SKILL.md` | Primary coding-agent copy of find-skills coding-agent instructions: Find Skills. |
| `.agents/skills/fixing-accessibility/SKILL.md` | Primary coding-agent copy of fixing-accessibility coding-agent instructions: fixing-accessibility. |
| `.agents/skills/grill-me/SKILL.md` | Primary coding-agent copy of grill-me coding-agent instructions. |
| `.agents/skills/grill-with-docs/ADR-FORMAT.md` | Primary coding-agent copy of grill-with-docs coding-agent instructions: ADR Format. |
| `.agents/skills/grill-with-docs/CONTEXT-FORMAT.md` | Primary coding-agent copy of grill-with-docs coding-agent instructions: CONTEXT.md Format. |
| `.agents/skills/grill-with-docs/SKILL.md` | Primary coding-agent copy of grill-with-docs coding-agent instructions. |
| `.agents/skills/handoff/SKILL.md` | Primary coding-agent copy of handoff coding-agent instructions. |
| `.agents/skills/improve-codebase-architecture/DEEPENING.md` | Primary coding-agent copy of improve-codebase-architecture coding-agent instructions: Deepening. |
| `.agents/skills/improve-codebase-architecture/HTML-REPORT.md` | Primary coding-agent copy of improve-codebase-architecture coding-agent instructions: HTML Report Format. |
| `.agents/skills/improve-codebase-architecture/INTERFACE-DESIGN.md` | Primary coding-agent copy of improve-codebase-architecture coding-agent instructions: Interface Design. |
| `.agents/skills/improve-codebase-architecture/LANGUAGE.md` | Primary coding-agent copy of improve-codebase-architecture coding-agent instructions: Language. |
| `.agents/skills/improve-codebase-architecture/SKILL.md` | Primary coding-agent copy of improve-codebase-architecture coding-agent instructions: Improve Codebase Architecture. |
| `.agents/skills/improve/SKILL.md` | Primary coding-agent copy of improve coding-agent instructions: Improve. |
| `.agents/skills/improve/references/audit-playbook.md` | Primary coding-agent copy of supporting reference material for the improve skill. |
| `.agents/skills/improve/references/closing-the-loop.md` | Primary coding-agent copy of supporting reference material for the improve skill. |
| `.agents/skills/improve/references/plan-template.md` | Primary coding-agent copy of supporting reference material for the improve skill. |
| `.agents/skills/product-thinking/SKILL.md` | Primary coding-agent copy of product-thinking coding-agent instructions: Product Thinking. |
| `.agents/skills/react-doctor/SKILL.md` | Primary coding-agent copy of react-doctor coding-agent instructions: React Doctor. |
| `.agents/skills/react-doctor/references/explain.md` | Primary coding-agent copy of supporting reference material for the react-doctor skill. |
| `.agents/skills/request-refactor-plan/SKILL.md` | Primary coding-agent copy of request-refactor-plan coding-agent instructions. |
| `.agents/skills/review/SKILL.md` | Primary coding-agent copy of review coding-agent instructions: Review. |
| `.agents/skills/sandbox-sdk/SKILL.md` | Primary coding-agent copy of sandbox-sdk coding-agent instructions: Cloudflare Sandbox SDK. |
| `.agents/skills/sandbox-sdk/references/api-quick-ref.md` | Primary coding-agent copy of supporting reference material for the sandbox-sdk skill. |
| `.agents/skills/sandbox-sdk/references/examples.md` | Primary coding-agent copy of supporting reference material for the sandbox-sdk skill. |
| `.agents/skills/shadcn/SKILL.md` | Primary coding-agent copy of shadcn coding-agent instructions: shadcn/ui. |
| `.agents/skills/shadcn/agents/openai.yml` | Primary coding-agent copy of agent metadata for the shadcn skill. |
| `.agents/skills/shadcn/assets/shadcn-small.png` | Primary coding-agent copy of the shadcn skill binary asset. |
| `.agents/skills/shadcn/assets/shadcn.png` | Primary coding-agent copy of the shadcn skill binary asset. |
| `.agents/skills/shadcn/cli.md` | Primary coding-agent copy of shadcn coding-agent instructions: shadcn CLI Reference. |
| `.agents/skills/shadcn/customization.md` | Primary coding-agent copy of shadcn coding-agent instructions: Customization & Theming. |
| `.agents/skills/shadcn/evals/evals.json` | Primary coding-agent copy of evaluation cases for the shadcn skill. |
| `.agents/skills/shadcn/mcp.md` | Primary coding-agent copy of shadcn coding-agent instructions: shadcn MCP Server. |
| `.agents/skills/shadcn/registry.md` | Primary coding-agent copy of shadcn coding-agent instructions: Registry Authoring and Addresses. |
| `.agents/skills/shadcn/rules/base-vs-radix.md` | Primary coding-agent copy of a detailed rule module for the shadcn skill. |
| `.agents/skills/shadcn/rules/composition.md` | Primary coding-agent copy of a detailed rule module for the shadcn skill. |
| `.agents/skills/shadcn/rules/forms.md` | Primary coding-agent copy of a detailed rule module for the shadcn skill. |
| `.agents/skills/shadcn/rules/icons.md` | Primary coding-agent copy of a detailed rule module for the shadcn skill. |
| `.agents/skills/shadcn/rules/styling.md` | Primary coding-agent copy of a detailed rule module for the shadcn skill. |
| `.agents/skills/web-design-guidelines/SKILL.md` | Primary coding-agent copy of web-design-guidelines coding-agent instructions: Web Interface Guidelines. |
| `.agents/skills/web-perf/SKILL.md` | Primary coding-agent copy of web-perf coding-agent instructions: Web Performance Audit. |
| `.agents/skills/workers-best-practices/SKILL.md` | Primary coding-agent copy of workers-best-practices coding-agent instructions: Fetch latest workers types. |
| `.agents/skills/workers-best-practices/references/review.md` | Primary coding-agent copy of supporting reference material for the workers-best-practices skill. |
| `.agents/skills/workers-best-practices/references/rules.md` | Primary coding-agent copy of supporting reference material for the workers-best-practices skill. |
| `.agents/skills/wrangler/SKILL.md` | Primary coding-agent copy of wrangler coding-agent instructions: Wrangler CLI. |
| `.agents/skills/writing-guidelines/SKILL.md` | Primary coding-agent copy of writing-guidelines coding-agent instructions: Writing Guidelines. |
| `.agents/skills/writing-plans/SKILL.md` | Primary coding-agent copy of writing-plans coding-agent instructions: Writing Plans. |
| `.agents/skills/writing-plans/plan-document-reviewer-prompt.md` | Primary coding-agent copy of writing-plans coding-agent instructions: Plan Document Reviewer Prompt Template. |
| `.claude/hooks/react-doctor.sh` | Claude hook that runs React Doctor after relevant edits. |
| `.claude/settings.json` | Registers Claude hooks and project permissions/settings. |
| `.claude/skills/baseline-ui/SKILL.md` | Claude-compatible copy of baseline-ui coding-agent instructions: Baseline UI. |
| `.claude/skills/fixing-accessibility/SKILL.md` | Claude-compatible copy of fixing-accessibility coding-agent instructions: fixing-accessibility. |
| `.claude/skills/react-doctor/SKILL.md` | Claude-compatible copy of react-doctor coding-agent instructions: React Doctor. |
| `.claude/skills/shadcn/SKILL.md` | Claude-compatible copy of shadcn coding-agent instructions: shadcn/ui. |
| `.claude/skills/shadcn/agents/openai.yml` | Claude-compatible copy of agent metadata for the shadcn skill. |
| `.claude/skills/shadcn/assets/shadcn-small.png` | Claude-compatible copy of the shadcn skill binary asset. |
| `.claude/skills/shadcn/assets/shadcn.png` | Claude-compatible copy of the shadcn skill binary asset. |
| `.claude/skills/shadcn/cli.md` | Claude-compatible copy of shadcn coding-agent instructions: shadcn CLI Reference. |
| `.claude/skills/shadcn/customization.md` | Claude-compatible copy of shadcn coding-agent instructions: Customization & Theming. |
| `.claude/skills/shadcn/evals/evals.json` | Claude-compatible copy of evaluation cases for the shadcn skill. |
| `.claude/skills/shadcn/mcp.md` | Claude-compatible copy of shadcn coding-agent instructions: shadcn MCP Server. |
| `.claude/skills/shadcn/registry.md` | Claude-compatible copy of shadcn coding-agent instructions: Registry Authoring and Addresses. |
| `.claude/skills/shadcn/rules/base-vs-radix.md` | Claude-compatible copy of a detailed rule module for the shadcn skill. |
| `.claude/skills/shadcn/rules/composition.md` | Claude-compatible copy of a detailed rule module for the shadcn skill. |
| `.claude/skills/shadcn/rules/forms.md` | Claude-compatible copy of a detailed rule module for the shadcn skill. |
| `.claude/skills/shadcn/rules/icons.md` | Claude-compatible copy of a detailed rule module for the shadcn skill. |
| `.claude/skills/shadcn/rules/styling.md` | Claude-compatible copy of a detailed rule module for the shadcn skill. |
| `.cursor/hooks.json` | Registers Cursor hooks, including React diagnostics. |
| `.cursor/hooks/react-doctor.sh` | Cursor hook that runs React Doctor after relevant edits. |

## Generated and ignored runtime paths

| Path | Meaning |
|---|---|
| `node_modules/`, `apps/web/node_modules/`, `packages/sandbox-runner/node_modules/` | Installed dependencies; package manifests and lockfiles are authoritative |
| `dist/`, `apps/web/dist/`, `packages/sandbox-runner/dist/` | Vite and TypeScript build output |
| `.alchemy/`, `apps/web/.alchemy/`, `.wrangler/`, `.flue-vite.wrangler.jsonc` | Local Alchemy/Cloudflare state (including generated `apps/web/.alchemy/local/wrangler.jsonc`) |
| `.env`, `.env.local`, `.env.*` | Local secrets at repo root; never architecture documentation or backup inputs |
| `coverage/` | Generated test coverage |
| `apps/web/src/routeTree.gen.ts` | Generated TanStack route tree; never hand-edit |

## Change routing

- Product behavior or terminology: start with `PRODUCT.md` and [System architecture](overview.md).
- UI/chat behavior: start with [Frontend architecture](frontend.md), then the route and product component under `apps/web`.
- API/data behavior: start with [Server and data architecture](server-and-data.md), then the tRPC router and domain service under `apps/web/src`.
- Agent/sandbox/Git behavior: start with [Agent harness architecture](agent-harness.md); runner sources live under `packages/sandbox-runner`.
- Credentials, output, environment variables, or export: read [Security and trust boundaries](security.md) before editing.
- Schema changes: edit `apps/web/src/db/schema.ts`, generate a migration under `apps/web/migrations`, and keep generated migration metadata together.
- Deploy/infra changes: edit root `alchemy.run.ts` (sole deployment owner). Do not add SST or Wrangler deploy scripts.

## Account provider credentials (Plan 025)

- Credentials are account-scoped in D1 (`ai_provider_credentials`), encrypted with `AI_CREDENTIALS_ENCRYPTION_KEY` + user/provider AAD.
- Login/refresh runs in auth-only sandboxes under `/tmp`; no `auth.json`, no project env, no R2 backup of secrets.
- Project runners receive `DITTO_PI_CREDENTIAL` (runtime projection only; OAuth refresh stripped) and delete it before session/tools.
- Fallback model is exactly `opencode/deepseek-v4-flash-free` via operator `OPENCODE_API_KEY`.
- Account Settings UI connects providers; composer lists fallback + connected models.
