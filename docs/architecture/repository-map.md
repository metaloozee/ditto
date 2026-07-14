# Repository map

## Purpose

This is the exhaustive map of version-controlled and currently untracked, non-ignored files in the working tree. It gives humans and coding agents a stable starting point before changing a subsystem. Runtime/build directories such as `.git`, `node_modules`, `dist`, `.alchemy`, and `.wrangler`, plus local secret files such as `.env.local`, are intentionally excluded because they are generated, external, or private rather than source architecture.

The current behavior is authoritative in source and schema files. Files under `plans/` describe implementation history and may contain superseded designs. Drizzle snapshots, lockfiles, and `src/routeTree.gen.ts` are generated artifacts and should not be edited by hand.

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

### Application foundation

| File | Responsibility |
|---|---|
| `src/env.ts` | Validates public/server configuration with t3-env and Zod. |
| `src/hooks/use-mobile.ts` | Reactive mobile-breakpoint hook used by responsive primitives. |
| `src/routeTree.gen.ts` | Generated TanStack Router route tree and route type registry; never edit manually. |
| `src/router.tsx` | Creates the TanStack Router, SSR query integration, and application data-provider wrapper. |
| `src/server.ts` | Cloudflare Worker entry: TanStack Start fetch handler and Sandbox Durable Object export. |
| `src/styles.css` | Tailwind v4 imports, theme tokens, dark palette, typography, and global application styles. |

### Frontend components

| File | Responsibility |
|---|---|
| `src/components/ai-chat.test.tsx` | Regression tests for `src/components/ai-chat.tsx` behavior and edge cases. |
| `src/components/ai-chat.tsx` | Chat timeline, message normalization, history loading, optimistic overlay, and assistant-part rendering. |
| `src/components/ai-elements/model-selector.tsx` | Composable model selection dialog/command components. |
| `src/components/ai-elements/task.tsx` | Composable task/progress presentation components. |
| `src/components/app-shell.tsx` | Composes sidebar, content inset, toasts, and global tooltip provider. |
| `src/components/app-sidebar.test.tsx` | Regression tests for `src/components/app-sidebar.tsx` behavior and edge cases. |
| `src/components/app-sidebar.tsx` | Project/session navigation, search, creation/settings launchers, archival, and account footer. |
| `src/components/assistant-markdown.tsx` | Safe styled Markdown/code rendering for assistant text. |
| `src/components/composer.test.tsx` | Regression tests for `src/components/composer.tsx` behavior and edge cases. |
| `src/components/composer.tsx` | Prompt/model input and complete browser-side SSE stream lifecycle. |
| `src/components/edit-tool-diff.tsx` | Lazy visual diff renderer for PI edit-tool calls. |
| `src/components/nav-user.tsx` | Authenticated user menu and sign-out behavior. |
| `src/components/new-project-dialog.test.tsx` | Regression tests for `src/components/new-project-dialog.tsx` behavior and edge cases. |
| `src/components/new-project-dialog.tsx` | GitHub repository picker, project env-var editor, and provisioning mutation. |
| `src/components/project-settings-dialog.tsx` | Project rename/delete and write-only environment-variable management. |
| `src/components/session-git-actions.test.tsx` | Regression tests for `src/components/session-git-actions.tsx` behavior and edge cases. |
| `src/components/session-git-actions.tsx` | Renders and executes the server-derived sync/commit/push/PR workflow. |
| `src/components/tool-call-group.test.tsx` | Regression tests for `src/components/tool-call-group.tsx` behavior and edge cases. |
| `src/components/tool-call-group.tsx` | Collapsible grouped tool-call activity with elapsed duration. |
| `src/components/ui/alert-dialog.tsx` | Confirmation modal primitive. |
| `src/components/ui/avatar.tsx` | User image/fallback primitive. |
| `src/components/ui/badge.tsx` | Compact status-label primitive. |
| `src/components/ui/bubble.tsx` | Chat bubble layout primitive. |
| `src/components/ui/button.tsx` | Button variants and styling primitive. |
| `src/components/ui/collapsible.tsx` | Base UI collapsible wrapper. |
| `src/components/ui/command.tsx` | Search/command palette primitives. |
| `src/components/ui/dialog.tsx` | Base UI dialog wrapper. |
| `src/components/ui/dropdown-menu.tsx` | Dropdown menu primitives. |
| `src/components/ui/field.tsx` | Accessible field, label, description, and error composition. |
| `src/components/ui/grainient.tsx` | WebGL animated gradient background. |
| `src/components/ui/input-group.tsx` | Compound textarea/input with addons and actions. |
| `src/components/ui/input.tsx` | Styled input primitive. |
| `src/components/ui/label.tsx` | Styled Base UI label. |
| `src/components/ui/message-scroller.tsx` | Chat scroll context, viewport, anchor preservation, and jump button. |
| `src/components/ui/message.tsx` | Chat message layout primitive. |
| `src/components/ui/scroll-area.tsx` | Base UI scroll-area wrapper. |
| `src/components/ui/separator.tsx` | Semantic visual separator. |
| `src/components/ui/sheet.tsx` | Slide-over sheet primitive. |
| `src/components/ui/sidebar.tsx` | Responsive/collapsible sidebar state and component system. |
| `src/components/ui/skeleton.tsx` | Loading placeholder primitive. |
| `src/components/ui/sonner.tsx` | Theme-aware toast viewport. |
| `src/components/ui/spinner.tsx` | Accessible SVG loading spinner. |
| `src/components/ui/textarea.tsx` | Styled textarea primitive. |
| `src/components/ui/tooltip.tsx` | Base UI tooltip primitives. |

### Routes and API entry points

| File | Responsibility |
|---|---|
| `src/routes/__root.tsx` | Root document metadata, global shell selection, CSS, scripts, and lazy development tools. |
| `src/routes/api.agent.git.test.ts` | Regression tests for `src/routes/api.agent.git.ts` behavior and edge cases. |
| `src/routes/api.agent.git.ts` | JWT-authenticated callback endpoint for sandbox agent Git tools. |
| `src/routes/api.agent.stream.test.ts` | Regression tests for `src/routes/api.agent.stream.ts` behavior and edge cases. |
| `src/routes/api.agent.stream.ts` | Cookie-authenticated SSE endpoint that prepares and executes an agent run. |
| `src/routes/api.auth.$.ts` | Mounts the better-auth HTTP handler. |
| `src/routes/api.trpc.$.tsx` | Mounts the Worker tRPC fetch adapter. |
| `src/routes/index.tsx` | Authentication-aware dashboard with project list, status, and creation entry point. |
| `src/routes/installation.completed.tsx` | GitHub App installation popup completion notifier. |
| `src/routes/project.$projectId.index.tsx` | New-conversation child route for a project. |
| `src/routes/project.$projectId.session.$sessionId.tsx` | Existing-conversation child route for a project session. |
| `src/routes/project.$projectId.tsx` | Project workspace coordinator: project readiness, restore, selected session, history, and chat. |
| `src/routes/sign-in.tsx` | GitHub OAuth sign-in UI and authenticated redirect. |

### Client/server integrations

| File | Responsibility |
|---|---|
| `src/integrations/tanstack-query/devtools-bundle.tsx` | Lazy development-only React Query and Router devtools bundle. |
| `src/integrations/tanstack-query/devtools.tsx` | Compatibility entry for development query/router devtools. |
| `src/integrations/tanstack-query/root-context.ts` | Creates Query Client, tRPC client, SuperJSON transport, and typed query options proxy. |
| `src/integrations/tanstack-query/root-provider.tsx` | Provides tRPC and React Query to the route tree. |
| `src/integrations/trpc/init.ts` | Builds tRPC context, SuperJSON transformer, and authenticated procedure middleware. |
| `src/integrations/trpc/react.ts` | Exports the typed React tRPC context/provider hook. |
| `src/integrations/trpc/router.ts` | Combines all application tRPC routers into the public API type. |
| `src/integrations/trpc/routers/github.ts` | Authenticated GitHub import-state and branch-listing procedures. |
| `src/integrations/trpc/routers/health.ts` | Minimal public liveness procedure. |
| `src/integrations/trpc/routers/projects.ts` | Project CRUD, sandbox provisioning, encrypted environment-variable management, and project listing. |
| `src/integrations/trpc/routers/session-git.ts` | Authenticated UI API for session Git status, sync, commit, push, and pull requests. |
| `src/integrations/trpc/routers/workspace.test.ts` | Regression tests for `src/integrations/trpc/routers/workspace.ts` behavior and edge cases. |
| `src/integrations/trpc/routers/workspace.ts` | Workspace ensure/retry, active-session reads, keyset message pagination, and session archival. |

### Domain libraries

| File | Responsibility |
|---|---|
| `src/lib/agent-delta-batcher.test.ts` | Regression tests for `src/lib/agent-delta-batcher.ts` behavior and edge cases. |
| `src/lib/agent-delta-batcher.ts` | Batches contiguous text deltas while preserving text/tool event order. |
| `src/lib/agent-git-handler.test.ts` | Regression tests for `src/lib/agent-git-handler.ts` behavior and edge cases. |
| `src/lib/agent-git-handler.ts` | Resolves signed callback claims to current resources and dispatches shared Git operations. |
| `src/lib/agent-git-jwt.test.ts` | Regression tests for `src/lib/agent-git-jwt.ts` behavior and edge cases. |
| `src/lib/agent-git-jwt.ts` | Mints and verifies short-lived scoped agent callback JWTs. |
| `src/lib/agent-message-parts.test.ts` | Regression tests for `src/lib/agent-message-parts.ts` behavior and edge cases. |
| `src/lib/agent-message-parts.ts` | Canonical ordered assistant text/tool model and PI event reducers. |
| `src/lib/agent-message-storage.test.ts` | Regression tests for `src/lib/agent-message-storage.ts` behavior and edge cases. |
| `src/lib/agent-message-storage.ts` | Bounds, serializes, migrates, and parses durable assistant parts. |
| `src/lib/agent-models.ts` | Allowlisted project-coder models and default model. |
| `src/lib/agent-run-service.test.ts` | Regression tests for `src/lib/agent-run-service.ts` behavior and edge cases. |
| `src/lib/agent-run-service.ts` | Agent preparation, streaming lifecycle, terminal D1 persistence, and post-run backup. |
| `src/lib/agent-run.test.ts` | Regression tests for `src/lib/agent-run.ts` behavior and edge cases. |
| `src/lib/agent-run.ts` | Sandbox shell/job execution, runner protocol bridge, streaming redaction, lock, and cleanup. |
| `src/lib/agent-stream-client.test.ts` | Regression tests for `src/lib/agent-stream-client.ts` behavior and edge cases. |
| `src/lib/agent-stream-client.ts` | Browser SSE request/parser and typed event handlers. |
| `src/lib/agent-stream-protocol.test.ts` | Regression tests for `src/lib/agent-stream-protocol.ts` behavior and edge cases. |
| `src/lib/agent-stream-protocol.ts` | Worker-side runner NDJSON parsing and SSE encoding helpers. |
| `src/lib/agent-tool-presentation.test.ts` | Regression tests for `src/lib/agent-tool-presentation.ts` behavior and edge cases. |
| `src/lib/agent-tool-presentation.ts` | Tool labels/details, edit extraction, grouping, and timing presentation rules. |
| `src/lib/auth.client.ts` | Browser better-auth client. |
| `src/lib/auth.functions.ts` | Server function that reads the current auth session for routes. |
| `src/lib/auth.ts` | Configures better-auth, Drizzle adapter, GitHub OAuth, and TanStack cookies. |
| `src/lib/chat-session-cache.test.ts` | Regression tests for `src/lib/chat-session-cache.ts` behavior and edge cases. |
| `src/lib/chat-session-cache.ts` | Bounded in-memory optimistic message cache keyed by workspace session. |
| `src/lib/crypto.ts` | Versioned PBKDF2/AES-GCM text encryption used for project secrets. |
| `src/lib/ditto-git-identity.ts` | Canonical Git author identity and shell environment. |
| `src/lib/env-vars.test.ts` | Regression tests for `src/lib/env-vars.ts` behavior and edge cases. |
| `src/lib/env-vars.ts` | Environment-variable key normalization and validation copy. |
| `src/lib/git-secret-policy.test.ts` | Regression tests for `src/lib/git-secret-policy.ts` behavior and edge cases. |
| `src/lib/git-secret-policy.ts` | Fail-closed outgoing Git range/path/content secret scanner. |
| `src/lib/github-app.ts` | GitHub App construction and short-lived installation-token minting. |
| `src/lib/github-authorization.ts` | Proves the signed-in user can access a repository through an installation. |
| `src/lib/github-export.test.ts` | Regression tests for `src/lib/github-export.ts` behavior and edge cases. |
| `src/lib/github-export.ts` | Branch, commit, PR metadata, shell quoting, diff summary, and redacted export-output helpers. |
| `src/lib/github-repositories.test.ts` | Regression tests for `src/lib/github-repositories.ts` behavior and edge cases. |
| `src/lib/github-repositories.ts` | Lists and normalizes user-visible GitHub App installations/repositories. |
| `src/lib/message-cursor.test.ts` | Regression tests for `src/lib/message-cursor.ts` behavior and edge cases. |
| `src/lib/message-cursor.ts` | Opaque validated `(createdAt,rowid)` cursor codec and comparison helpers. |
| `src/lib/project-env-vars.ts` | Sanitizes, encrypts, decrypts, and hides project environment values. |
| `src/lib/project-sandbox.test.ts` | Regression tests for `src/lib/project-sandbox.ts` behavior and edge cases. |
| `src/lib/project-sandbox.ts` | Connects/restores/recreates project sandboxes and versions backup writes. |
| `src/lib/sandbox-backup.test.ts` | Regression tests for `src/lib/sandbox-backup.ts` behavior and edge cases. |
| `src/lib/sandbox-backup.ts` | Backup handle codec, R2/local options, TTL, and exclusion policy. |
| `src/lib/sandbox-bootstrap.test.ts` | Regression tests for `src/lib/sandbox-bootstrap.ts` behavior and edge cases. |
| `src/lib/sandbox-bootstrap.ts` | Low-level Sandbox SDK, Git clone/fetch, dependency install, health, backup, and restore operations. |
| `src/lib/secret-redaction.test.ts` | Regression tests for `src/lib/secret-redaction.ts` behavior and edge cases. |
| `src/lib/secret-redaction.ts` | Concrete/pattern/streaming secret redaction for text and structured output. |
| `src/lib/session-git-backup.test.ts` | Regression tests for `src/lib/session-git-backup.ts` behavior and edge cases. |
| `src/lib/session-git-backup.ts` | Wraps successful Git mutations with best-effort versioned workspace backup. |
| `src/lib/session-git-trpc-errors.test.ts` | Regression tests for `src/lib/session-git-trpc-errors.ts` behavior and edge cases. |
| `src/lib/session-git-trpc-errors.ts` | Maps shared Git mutation errors to stable tRPC errors. |
| `src/lib/session-git.test.ts` | Regression tests for `src/lib/session-git.ts` behavior and edge cases. |
| `src/lib/session-git.ts` | Session Git/GitHub state machine and sync/commit/push/pull-request implementation. |
| `src/lib/session-workspace-lock-error.ts` | Shared typed busy error for concurrent session workspace writes. |
| `src/lib/session-workspace-lock.test.ts` | Regression tests for `src/lib/session-workspace-lock.ts` behavior and edge cases. |
| `src/lib/session-workspace-lock.ts` | Atomic per-session sandbox `/tmp` lock with stale-lock recovery. |
| `src/lib/session-worktree.test.ts` | Regression tests for `src/lib/session-worktree.ts` behavior and edge cases. |
| `src/lib/session-worktree.ts` | Creates or restores a session branch/worktree and links shared dependencies. |
| `src/lib/user-preferences-store.ts` | Validated persisted browser preference for selected model. |
| `src/lib/utils.ts` | Shared Tailwind class merge helper. |
| `src/lib/workspace-policy.test.ts` | Regression tests for `src/lib/workspace-policy.ts` behavior and edge cases. |
| `src/lib/workspace-policy.ts` | Canonical workspace paths, session statuses, branch/lock naming, and title policy. |
| `src/lib/workspace-session.test.ts` | Regression tests for `src/lib/workspace-session.ts` behavior and edge cases. |
| `src/lib/workspace-session.ts` | Owned active-session loading, creation resolution, archival, and recency update. |

### Database

| File | Responsibility |
|---|---|
| `src/db/index.ts` | Constructs the typed Drizzle D1 client. |
| `src/db/schema.ts` | Current D1 schema for auth, projects, workspace sessions, messages, and starter todos. |

### Sandbox runner

| File | Responsibility |
|---|---|
| `sandbox/runner/.gitignore` | Excludes runner build output and dependencies. |
| `sandbox/runner/package-lock.json` | Generated pinned dependency graph for the independent runner package. |
| `sandbox/runner/package.json` | Independent npm package manifest for the baked PI runner. |
| `sandbox/runner/src/cli.ts` | Validates job files, invokes the harness, and writes protocol NDJSON to stdout. |
| `sandbox/runner/src/ditto-git-callback.ts` | Posts signed push/PR tool actions back to the Worker and scrubs callback tokens. |
| `sandbox/runner/src/ditto-git-guidance.ts` | Prompt guidance and descriptions for Ditto-specific Git tools. |
| `sandbox/runner/src/ditto-git-tools.test.ts` | Regression tests for `sandbox/runner/src/ditto-git-tools.ts` behavior and edge cases. |
| `sandbox/runner/src/ditto-git-tools.ts` | Defines PI custom tools for pushing and opening pull requests through the Worker. |
| `sandbox/runner/src/protocol.test.ts` | Regression tests for `sandbox/runner/src/protocol.ts` behavior and edge cases. |
| `sandbox/runner/src/protocol.ts` | Versioned runner output union, PI event normalization, and terminal text fallback helpers. |
| `sandbox/runner/src/run-agent.ts` | Creates/resumes PI sessions, selects models/tools, emits normalized text/tool events, and settles a run. |
| `sandbox/runner/tsconfig.json` | Runner TypeScript/build settings. |
| `sandbox/runner/vitest.config.ts` | Runner Vitest configuration. |

### Migrations

| File | Responsibility |
|---|---|
| `migrations/0000_wet_giant_girl.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0001_jazzy_firelord.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0002_sparkling_agent_zero.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0003_material_ghost_rider.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0004_same_stellaris.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0005_illegal_invisible_woman.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0006_late_wonder_man.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0007_amused_shinobi_shaw.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0008_chunky_sunset_bain.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/0009_worthless_young_avengers.sql` | Ordered Drizzle SQL migration in the D1 schema history. |
| `migrations/meta/0000_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0001_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0002_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0003_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0004_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0005_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0006_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0007_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0008_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/0009_snapshot.json` | Generated Drizzle schema snapshot corresponding to the numbered migration. |
| `migrations/meta/_journal.json` | Generated Drizzle migration journal and ordering metadata. |

### Repository configuration

| File | Responsibility |
|---|---|
| `.cta.json` | Cloudflare/TanStack agent-tooling metadata. |
| `.cursorrules` | Repository guidance loaded by Cursor. |
| `.dockerignore` | Removes local/generated files from the sandbox image build context. |
| `.github/workflows/ci.yml` | CI installation and full root/runner verification workflow. |
| `.gitignore` | Excludes dependencies, builds, local state, secrets, and generated deployment artifacts. |
| `.vscode/settings.json` | Workspace editor defaults for TypeScript, Tailwind, and formatting. |
| `Dockerfile` | Builds the Cloudflare Sandbox image and installs the independent Ditto runner CLI. |
| `PRODUCT.md` | Canonical product purpose, users, brand, interaction principles, and accessibility intent. |
| `README.md` | Root developer quick start, environment, scripts, and operational notes. |
| `alchemy.run.ts` | Declares the Worker, Sandbox container, D1 database, R2 bucket, bindings, and deployment with Alchemy. |
| `biome.json` | Biome formatter/linter policy and generated/vendor exclusions. |
| `components.json` | shadcn component registry, aliases, icon set, and styling configuration. |
| `drizzle.config.ts` | Points Drizzle Kit at the D1 schema and migration output. |
| `lefthook.yml` | Runs formatting/lint hooks around Git operations. |
| `package.json` | Root app scripts, runtime dependencies, and development toolchain. |
| `pnpm-lock.yaml` | Generated, pinned dependency graph for the root pnpm package. |
| `pnpm-workspace.yaml` | Defines the root pnpm workspace and build-dependency policy; the runner remains separate. |
| `skills-lock.json` | Pins installed coding-agent skills and their source revisions. |
| `tsconfig.json` | Root TypeScript settings and `#/*`/`@/*` source aliases. |
| `types/env.d.ts` | Cloudflare binding types for D1, Sandbox, R2, GitHub, auth, and provider configuration. |
| `vite.config.ts` | Composes Vite, TanStack Start, Tailwind, React Compiler, devtools, tests, and conditional Alchemy integration. |

### Public assets

| File | Responsibility |
|---|---|
| `public/favicon.ico` | Browser favicon binary. |
| `public/robots.txt` | Crawler policy for the deployed website. |

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
| `node_modules/`, `sandbox/runner/node_modules/` | Installed dependencies; package manifests and lockfiles are authoritative |
| `dist/`, `sandbox/runner/dist/` | Vite and TypeScript build output |
| `.alchemy/`, `.wrangler/`, `.flue-vite.wrangler.jsonc` | Local/deployed Cloudflare and Alchemy state |
| `.env`, `.env.local`, `.env.*` | Local secrets; never architecture documentation or backup inputs |
| `coverage/` | Generated test coverage |

## Change routing

- Product behavior or terminology: start with `PRODUCT.md` and [System architecture](overview.md).
- UI/chat behavior: start with [Frontend architecture](frontend.md), then the route and product component.
- API/data behavior: start with [Server and data architecture](server-and-data.md), then the tRPC router and domain service.
- Agent/sandbox/Git behavior: start with [Agent harness architecture](agent-harness.md).
- Credentials, output, environment variables, or export: read [Security and trust boundaries](security.md) before editing.
- Schema changes: edit `src/db/schema.ts`, generate a migration, and keep generated migration metadata together.
