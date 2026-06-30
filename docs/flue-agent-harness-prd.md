# Flue Agent Harness PRD

**Owner:** Ayan
**Status:** Draft
**Date:** 2026-06-30

## 1. Overview

Build Ditto's AI harness on Flue so a user can open an existing GitHub-backed project, send an instruction, and have a durable coding agent inspect, edit, run, verify, and explain work inside the project's Cloudflare Sandbox.

Flue should provide the programmable TypeScript agent harness: agent identity, model configuration, sessions, tools, skills, sandbox access, durable execution, event streaming, and deployment portability. Ditto should continue to own the product model: users, projects, GitHub authorization, Cloudflare Sandbox identity, D1 persistence, workspace sessions, agent runs, run events, UI state, and explicit outside-world actions.

The result should be a repo-native agent workspace, not a generic chatbot and not a blank-slate app generator.

## 2. Source Material Reviewed

- Flue start guide: `https://flueframework.com/start.md`
- Flue homepage: `https://flueframework.com/`
- Flue quickstart: `https://flueframework.com/docs/getting-started/quickstart/index.md`
- Context7 Flue docs for agents, routing, React client, and deployment concepts
- Product brief: `PRODUCT.md`
- Existing repo workspace PRD: `docs/repo-sandbox-coding-workspace-prd.md`
- D1 start-run fix PRD: `docs/d1-start-run-atomic-write-fix-prd.md`
- Implementation plan index: `plans/README.md`
- Relevant plans: `plans/008-project-scoped-agent-run-foundation.md`, `plans/009-scope-workspace-events-to-session.md`, `plans/010-replace-start-run-d1-transaction.md`, `plans/013-authorize-github-installation-use-server-side.md`, `plans/014-validate-sandbox-env-var-keys-before-provisioning.md`, `plans/015-persist-and-restore-project-sandboxes.md`
- Current Flue touchpoints: `package.json`, `src/lib/flue-client.ts`, `src/routes/__root.tsx`
- Current workspace domain model: `src/db/schema.ts`, `src/lib/workspace-policy.ts`, `src/integrations/trpc/routers/workspace.ts`

## 3. Problem Statement

Ditto already has the product foundation for project-scoped agent work: workspace sessions, agent runs, append-only run events, project-level mutating-run locks, cancellation, and a draft UI. However, the current run path only records that the LLM/tool runner will be connected later. It does not execute a real agent.

The app also has `@flue/react` and `@flue/sdk` installed and wraps the root UI in `FlueProvider`, but there is no Flue backend mount, Flue config, authored agent module, workflow module, or runner that connects Flue execution back to Ditto's D1 event log and sandbox model.

Without a real harness, Ditto cannot deliver its core promise: a safe, inspectable, repo-native AI coding workspace where the agent can make and verify changes in an isolated environment.

## 4. Product Goals

1. Connect Ditto's project composer to a real Flue-powered coding agent.
2. Preserve Ditto's existing project/session/run/event model as the durable product record.
3. Execute all repo-inspection, edit, command, and verification work inside the project's Cloudflare Sandbox.
4. Stream or persist agent progress as inspectable events: messages, tool starts, tool finishes, command output, file changes, diffs, questions, completion, and errors.
5. Keep the user in control of outside-world effects such as GitHub push/PR, production deploy, or sandbox destruction.
6. Support interruption, cancellation, and recovery without losing accepted work or leaving stale locks.
7. Keep the initial implementation narrow enough to ship: one primary project coding agent, one sandbox per project, one mutating run at a time.

## 5. Non-Goals

- Building a full browser IDE.
- Replacing GitHub as the source of truth.
- Replacing Ditto's D1 project/session/run/event model with Flue's internal state.
- Adding generic per-tool approval UX for sandbox-internal actions in v1.
- Adding multi-user real-time collaboration in v1.
- Adding multi-agent swarms in v1.
- Adding per-session sandboxes in v1.
- Automatically pushing commits, opening PRs, deploying, destroying sandboxes, or mutating external systems without explicit user action.
- Supporting every possible repository setup pattern before the core loop works reliably.

## 6. Target Users

### Primary

- Founders, indie developers, and small teams importing existing web application repos.
- Engineers who want a browser-based coding harness for debugging, feature work, and repo onboarding.
- Low-code builders who need guided changes with visible evidence and less local setup.

### Secondary

- Product or design teammates making small safe changes without local environment setup.
- Agencies or contractors working across many client repositories.

## 7. Flue Product Implications

Flue is a TypeScript framework for building AI agents and workflows with a programmable harness. Relevant concepts for Ditto:

- **Agents** are continuing assistants with identity, sessions, instructions, tools, skills, model configuration, and sandbox access. Ditto's project coding assistant is an agent.
- **Workflows** are bounded, result-oriented operations around agents. Ditto should not add workflows merely to test an agent. Candidate future workflows include repo health summaries, diff summaries, CI triage, and PR description generation.
- **Harness sessions** are the Flue execution surface for prompting an agent. Ditto must map them to its own `workspace_sessions` and `agent_runs` without losing product-level authorization and locking.
- **Source layouts** can be `.flue`, `src`, or root. Because Ditto is an existing TanStack Start app with a large `src` tree, the Flue-authored source should use a self-contained `.flue` layout rather than mixing app routes and agent definitions.
- **HTTP exposure** requires mounting Flue's `flue()` sub-app, commonly through an `app.route('/api/flue', flue())`-style prefix. Browser clients may use a relative `baseUrl` such as `/api/flue`.
- **Deployment targets** include Node.js and Cloudflare. Ditto's product target is Cloudflare Workers, so the PRD assumes Cloudflare-compatible Flue runtime and local development paths.
- **LLM providers** are configured by model specifiers and provider credentials. The default should align with the current project and Flue examples: `anthropic/claude-sonnet-4-6`, configurable later.
- **Secrets** must be supplied by the operator through environment bindings. The implementation must never invent, commit, log, or echo provider keys.

## 8. Existing Ditto Decisions To Preserve

These decisions are binding for the Flue harness unless a later product decision explicitly changes them:

1. v1 uses one long-lived Cloudflare Sandbox per project.
2. Sessions, chats, and branches are logical records inside the project workspace; they do not create new sandboxes in v1.
3. A durable workspace session is created only when the first accepted user message starts a real conversation.
4. Only one mutating agent run may operate on a project at a time.
5. Read-only runs may become concurrent later, but mutating writes remain serialized by `projects.activeAgentRunId`.
6. The agent has broad permission inside its sandbox.
7. Generic per-tool approvals are not part of v1.
8. `needs_input` is a clarification/resume mechanism, not an approval mechanism.
9. Outside-world effects remain explicit user actions.
10. Local project memory should live under `/workspace/.ditto/`; D1 `agent_run_events` are the durable product event log.
11. D1 explicit SQL transactions are not available in this path; start-run persistence must remain D1-compatible through conditional updates and `db.batch(...)`.
12. Workspace events shown in the UI must be scoped to the selected session.
13. Environment variables are encrypted at rest and values are never returned to the client.
14. Server-side GitHub installation/repo authorization is required before using installation-scoped access.
15. Sandbox readiness must eventually verify workspace hydration, not only `status === "ready" && sandboxId`.

## 9. Current State

### Implemented Foundation

- `projects` store ownership, GitHub repo metadata, sandbox identity, encrypted env vars, status, and the active mutating run lock.
- `workspace_sessions` represent logical project conversations.
- `agent_runs` represent accepted user instructions and their lifecycle.
- `agent_run_events` provide an append-only, schema-versioned event log.
- `workspace.startRun` creates sessions/runs/events and enforces the project-level mutating lock.
- `workspace.cancelRun` cancels runs and clears the lock.
- `workspace.answerRunQuestion` reserves the future question/resume path.
- `FlueProvider` is already present in `src/routes/__root.tsx`.
- `@flue/react` and `@flue/sdk` are already dependencies.

### Gaps

- No `@flue/runtime` dependency is present.
- No `@flue/cli` dev dependency is present.
- No `flue.config.ts` exists.
- No `.flue/agents/*` or `.flue/workflows/*` authored source exists.
- No `/api/flue` server mount exists.
- `src/lib/flue-client.ts` does not currently use the recommended same-origin browser form for the intended `/api/flue` mount.
- No Flue execution adapter writes back to `agent_run_events`.
- No sandbox file, command, diff, preview, memory, cancellation, or backup hooks are connected to a real agent run.

## 10. Target Experience

1. User signs in with GitHub.
2. User imports or opens a GitHub-backed project.
3. Ditto verifies the user is authorized for the GitHub repo and installation.
4. Ditto ensures the project's Cloudflare Sandbox is ready and hydrated.
5. User sends a prompt from the project composer.
6. Ditto creates or reuses a workspace session and creates an `agent_runs` row.
7. Ditto acquires the mutating run lock if the instruction can edit files or run mutating commands.
8. Ditto dispatches the run to the Flue coding agent.
9. The Flue agent reads files, runs commands, edits files, requests clarification if needed, and verifies results inside `/workspace`.
10. Ditto streams and persists progress into `agent_run_events`.
11. User sees messages, command output, changed files, diffs, preview links, and verification status.
12. User can stop the active run.
13. On completion, Ditto marks the run terminal, releases the lock, persists final events, and refreshes any sandbox backup hook when available.
14. User reviews changes before any GitHub push/PR or production deploy action.

## 11. Functional Requirements

### 11.1 Flue App Surface

- Ditto must expose a same-origin Flue route under `/api/flue`.
- The Flue route must be protected by Better Auth or an equivalent server-side auth boundary.
- Requests to project-scoped Flue resources must verify the authenticated user owns the project and run/session being accessed.
- The browser Flue client must point at the same-origin `/api/flue` mount.
- The Flue route must not expose unauthenticated public agents.
- The implementation must support Cloudflare Workers deployment.
- The implementation must keep local development compatible with the repo's `pnpm dev` flow and Flue's Cloudflare target.

### 11.2 Source Layout And Dependencies

- Add Flue-authored source under `.flue/` so agent code is isolated from the TanStack app's `src/` tree.
- Use `.flue/agents/project-coder.ts` as the primary v1 agent module name unless a later plan selects a better name.
- Do not create a workflow for the basic chat loop.
- Add workflows only for bounded jobs that run once and return a result.
- Add `@flue/runtime` and `@flue/cli` only when implementing the harness.
- Keep TypeScript strictness and editor support for `.flue/**/*.ts`.

### 11.3 Primary Agent

- The primary agent must be a project coding agent, not a general chat assistant.
- The agent must know the current project, repo, sandbox workspace path, selected session, run id, and allowed action boundaries.
- The agent must default to working inside `/workspace`.
- The agent must use a configurable model specifier, initially `anthropic/claude-sonnet-4-6` unless the operator selects another supported model.
- The agent must have instructions that emphasize repo-native work, evidence, concise communication, verification, and no outside-world side effects without explicit product actions.
- The agent must be able to ask for clarification through `needs_input` instead of guessing when required context is missing.

### 11.4 Run Lifecycle

- `workspace.startRun` remains the product boundary for accepting a user instruction.
- A Flue run must not bypass Ditto's authorization, session creation, run creation, event creation, or mutating lock acquisition.
- A run must transition through explicit statuses: `pending`, `running`, `needs_input`, `completed`, `failed`, or `canceled`.
- Terminal states must set `agent_runs.finishedAt`.
- Terminal states must release `projects.activeAgentRunId` only when the run owns the lock.
- Cancellation must stop or detach the Flue execution path as soon as the runtime supports it and must always record a durable `done` or `error` event.
- Failed Flue execution must surface a stable product error and must not leak provider keys, GitHub tokens, encrypted env vars, or raw private keys.

### 11.5 Event Mapping

Flue execution must be adapted into Ditto's existing event vocabulary.

| Agent activity | Ditto event type | Required payload fields |
|---|---|---|
| User prompt accepted | `message` | `role: "user"`, `text`, `schemaVersion: 1` |
| Agent response chunk or final response | `message` | `role: "assistant"`, `text`, `schemaVersion: 1` |
| Tool starts | `tool_started` | `toolName`, optional `label`, `schemaVersion: 1` |
| Tool succeeds | `tool_finished` | `toolName`, `status: "success"`, optional summary, `schemaVersion: 1` |
| Tool fails | `tool_finished` or `error` | `toolName`, `status: "failed"`, stable message, `schemaVersion: 1` |
| Shell output | `command_output` | command label, stdout/stderr excerpt, exit code when known, `schemaVersion: 1` |
| File write or edit | `file_changed` | relative path, operation, `schemaVersion: 1` |
| Diff is available | `diff_ready` | changed file count and optional diff reference, `schemaVersion: 1` |
| Clarification needed | `needs_input` | question, optional recommended answer, `schemaVersion: 1` |
| Concurrent lock rejection | `lock_rejected` | reason, `schemaVersion: 1` |
| Completion or cancellation | `done` | status, optional summary, `schemaVersion: 1` |
| Runtime failure | `error` | stable message, optional code, `schemaVersion: 1` |

### 11.6 Tool Capabilities

The v1 Flue agent should expose a small, controlled tool set:

- Read files under `/workspace`.
- Write or patch files under `/workspace`.
- Run shell commands in `/workspace` with explicit timeout and output limits.
- Inspect git status and diffs without printing secrets.
- Produce a diff summary for the UI.
- Detect common package manager commands and run install/build/test scripts when appropriate.
- Surface preview URL metadata when the sandbox exposes a running app.
- Read and update local project memory under `/workspace/.ditto/` when that file exists.

Tool constraints:

- Tools must reject paths outside `/workspace` unless a later security review explicitly allows them.
- Tools must redact secrets from command output and event payloads.
- Tools must not run host-level Docker, D1, R2, Alchemy, Wrangler destructive commands, or GitHub mutation commands through the agent in v1.
- Tools must avoid long-running commands without timeout and cancellation handling.
- Tools must record enough evidence for the UI to explain what happened.

### 11.7 Sandbox Integration

- The harness must use the project's existing `sandboxId`.
- The harness must not create a new sandbox per session.
- The harness must call the same sandbox readiness or ensure path used by the workspace router before execution.
- Once Plan 015 lands, successful mutating runs must refresh the project sandbox backup after writes are complete.
- The harness must re-sync `.env` from encrypted D1 env vars after restore paths; backups must not include `.env`.
- The harness must treat `/workspace/.git` as the GitHub-backed hydration sentinel once sandbox restore is implemented.

### 11.8 GitHub Boundaries

- GitHub-backed project creation and branch listing must be server-authorized against the authenticated user's visible installations.
- The Flue agent may inspect local git state inside the sandbox.
- The Flue agent may prepare commit messages or PR summaries.
- The Flue agent must not push, create branches on GitHub, open PRs, modify issues, or call installation-scoped GitHub write APIs unless the user invokes an explicit product action outside the sandbox-internal agent loop.

### 11.9 UI Requirements

- The project workspace remains dark, compact, code-review oriented, and project-native.
- The composer must show when a run is active and provide a Stop action.
- The UI must show event activity from the selected session only.
- The UI must distinguish queued, running, waiting-for-input, completed, failed, and canceled states.
- The UI must render real changed-file and diff data only; it must not fake changed files.
- The UI must provide a focused answer surface for `needs_input` rather than treating an answer as an unrelated new run.
- The UI must surface stable, actionable error messages.
- The UI must preserve accessibility expectations from `PRODUCT.md`: keyboard access, visible focus, accessible names, readable contrast, and clear disabled/loading/error states.

### 11.10 Observability And Metrics

Track these metrics as product events, logs, or future telemetry:

- Time from prompt submit to first agent event.
- Time from prompt submit to terminal run state.
- Run completion, failure, cancellation, and `needs_input` rates.
- `lock_rejected` rate per project.
- Tool failure rate by tool name.
- Build/test command success rate after agent edits.
- Percentage of mutating runs with non-empty diffs.
- Percentage of successful mutating runs followed by user review/export action.
- Sandbox restore/recreate state before run execution once Plan 015 lands.

## 12. Data Requirements

The existing schema should remain the canonical product model.

### Existing Tables To Use

- `projects`
- `workspace_sessions`
- `agent_runs`
- `agent_run_events`

### Likely Additions

Only add fields when the implementation plan proves they are necessary. Candidate additions:

- A Flue session or stream id on `agent_runs` if needed to resume or attach to Flue durable execution.
- Tool-call correlation ids on event payloads if needed for UI grouping.
- Diff artifact references if full diffs become too large for `agent_run_events.payload`.
- Model specifier on `agent_runs` if model selection becomes user-configurable per run.

### Data Rules

- Do not store provider API keys in D1.
- Do not store plaintext env-var values in event payloads.
- Do not return `projects.envVars` to the client.
- Do not return sandbox backup handles to the client.
- Keep event payloads schema-versioned with `schemaVersion: 1`.
- Keep event payloads compact; large outputs should be summarized or stored as referenced artifacts later.

## 13. Plan Dependency Matrix

| Plan | Current status | Flue harness implication |
|---|---|---|
| 001 GitHub App auth flow | BLOCKED | Do not rely on stale assumptions from this plan. Use current split router reality. |
| 002 Database schema and tRPC projects | DONE | Project persistence is available. |
| 003 Sandbox provisioning/bootstrap | BLOCKED | Verify live sandbox behavior in the target environment before depending on full bootstrap reliability. |
| 004 GitHub App helper restore | TODO | Confirm helper behavior before adding new GitHub-dependent agent features. |
| 005 Dead project-route cleanup | TODO | Avoid coupling Flue work to stale route assumptions. |
| 006 Yarn bootstrap restore | TODO | Agent install/build tools must preserve lockfile-aware behavior. |
| 007 Private-key newline normalization | REJECTED | Do not normalize escaped GitHub App private-key newlines. |
| 008 Project-scoped agent run foundation | DONE | Flue execution must integrate with this model. |
| 009 Session-scoped workspace events | DONE | Flue events must be scoped to selected sessions. |
| 010 D1-compatible startRun | DONE | Do not reintroduce unsupported D1 transactions. |
| 011 GitHub import tests | DONE | Use the test baseline when changing GitHub import paths. |
| 012 GitHub import/branch pagination | DONE | Authorization must validate against the full paginated import state. |
| 013 Server-side GitHub authorization | TODO | Security prerequisite before trusted GitHub-backed Flue work. |
| 014 Env-var key validation | TODO | Should land before depending on `.env` sync during agent execution. |
| 015 Persist and restore sandboxes | TODO | Important before treating agent edits as durable across sandbox restarts. |

## 14. Release Phases

### Phase 0: Prerequisite Hardening

Goal: close security and durability gaps that would make a real agent unsafe.

Scope:

- Complete Plan 013 server-side GitHub repo/install authorization.
- Complete Plan 014 env-var key validation.
- Complete or explicitly sequence Plan 015 sandbox backup/restore.
- Confirm current `workspace.startRun` preserves D1-compatible lock and batch behavior.

Exit criteria:

- GitHub-backed project operations are server-authorized.
- Invalid env-var keys cannot poison `.env` generation.
- Sandbox readiness and restore behavior are understood before mutating agent work depends on it.

### Phase 1: Flue Foundation

Goal: mount Flue and run a minimal authenticated project coding agent without mutating files.

Scope:

- Add Flue runtime/CLI dependencies and config.
- Add `.flue/agents/project-coder.ts`.
- Mount `/api/flue` with authentication.
- Correct the browser Flue client base URL to the same-origin mount.
- Dispatch a run from Ditto's existing `workspace.startRun` lifecycle.
- Persist assistant messages and terminal status into `agent_run_events`.

Exit criteria:

- A user can submit a project prompt and receive a real Flue agent response.
- The run appears in the existing workspace UI.
- No file writes or shell commands are exposed yet.

### Phase 2: Read-Only Repo Inspection

Goal: let the agent inspect the repository and explain findings with evidence.

Scope:

- Add safe file-read, directory-list, git-status, and bounded command tools.
- Record tool activity into `agent_run_events`.
- Add output redaction and output limits.
- Allow read-only mode where no mutating lock is required if the product path supports it.

Exit criteria:

- User can ask about the codebase and receive grounded answers with file references and command evidence.
- Tool events are visible and session-scoped.

### Phase 3: Mutating Coding Loop

Goal: let the agent edit files, run verification, and produce diffs.

Scope:

- Add file patch/write tools under `/workspace`.
- Enforce project-level mutating lock for writes.
- Generate `file_changed` and `diff_ready` events.
- Run package-manager-aware build/test commands.
- Support cancellation and terminal cleanup.
- Add `needs_input` pause/resume behavior.

Exit criteria:

- A user can request a small code change and review the resulting diff and verification output.
- Terminal states release locks reliably.
- Failed runs leave stable events and clear user-facing errors.

### Phase 4: Durability And Review Polish

Goal: make agent edits trustworthy across restarts and reviewable in the UI.

Scope:

- Hook successful mutating runs into sandbox backup refresh once backup support exists.
- Improve diff rendering and changed-file summaries.
- Add focused question-answer UI for `needs_input`.
- Add manual verification around restore/reopen behavior after an agent edit.

Exit criteria:

- Reopening a project after sandbox restart preserves or restores the latest accepted workspace state.
- The user can understand exactly what changed and what verification ran.

### Phase 5: Explicit Export Actions

Goal: add outside-world actions after the sandbox-internal loop is reliable.

Scope:

- Commit creation.
- Branch creation.
- PR creation.
- Optional PR description workflow.

Exit criteria:

- User explicitly approves every GitHub write action.
- Agent-prepared summaries are reviewable before submission.

## 15. Acceptance Criteria

### MVP Acceptance Criteria

- `/api/flue` exists and is authenticated.
- The browser Flue client targets the correct same-origin mount.
- A Flue project coding agent exists under `.flue/agents/`.
- `workspace.startRun` remains the only path that accepts project composer prompts.
- A prompt creates or reuses the correct Ditto workspace session and agent run.
- Mutating runs respect `projects.activeAgentRunId`.
- Flue agent output is persisted to `agent_run_events` with `schemaVersion: 1` payloads.
- Session route UI shows only events for the selected session.
- Run completion, failure, cancellation, and clarification states are represented in D1 and UI.
- No provider secret, GitHub token, private key, encrypted env var, or `.env` value is logged or persisted in event payloads.
- The harness can run on the Cloudflare target.

### Mutating Loop Acceptance Criteria

- File tools reject paths outside `/workspace`.
- Shell tools enforce timeouts and bounded output.
- File writes create `file_changed` events.
- Diffs create `diff_ready` events backed by real git diff data.
- Verification commands create visible command output and final status.
- Successful mutating runs release the project lock and refresh sandbox backup when backup support exists.
- Failed mutating runs release the project lock when owned by that run.
- Canceled mutating runs stop future writes and release the project lock when owned by that run.

## 16. Success Metrics

### Activation

- Percentage of imported projects that reach a ready workspace.
- Percentage of ready workspaces where the user submits a first prompt.
- Median time from prompt submit to first agent event.

### Engagement

- Percentage of sessions with at least one completed agent run.
- Percentage of sessions with at least one meaningful repo-inspection tool call.
- Percentage of mutating sessions with a non-empty diff.

### Value

- Median time from prompt submit to verified change.
- Percentage of build/test failures resolved inside the sandbox.
- Percentage of successful mutating runs followed by review/export intent.

### Quality

- Run failure rate.
- Cancellation rate.
- `needs_input` resolution rate.
- `lock_rejected` rate.
- User trust feedback after reviewing agent changes.

## 17. Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Flue beta API changes | Pin versions, use installed CLI docs after installation, keep Flue integration isolated under `.flue` and a small route adapter. |
| Agent bypasses Ditto locks | Dispatch only after `workspace.startRun`; enforce tool access through run/project context. |
| D1 transaction regression | Preserve Plan 010's conditional lock plus `db.batch(...)`; do not add explicit SQL `BEGIN`/`COMMIT`. |
| Secret leakage | Redact tool output, never include env values in event payloads, avoid printing tokenized Git remotes. |
| Lost edits after sandbox restart | Complete Plan 015 and refresh backups after successful mutating runs. |
| GitHub authorization gap | Complete Plan 013 before trusted GitHub-backed agent operations. |
| Invalid `.env` generation | Complete Plan 014 before relying on env sync in agent execution. |
| Long-running commands | Enforce command timeouts, output caps, cancellation checks, and visible status. |
| UI overpromises capability | Render only real events, diffs, and preview links; use honest empty and disabled states. |
| Lock contention blocks users | Track `lock_rejected`; if common, consider git worktrees inside one sandbox before per-session sandboxes. |

## 18. Open Questions

1. Should the first Flue implementation use only Ditto's tRPC stream/polling UI, or should the UI consume Flue's client streaming directly for agent activity while D1 remains canonical?
2. What is the first supported model/provider in production: Anthropic, Cloudflare Workers AI, OpenAI, or user-selectable providers?
3. Should model selection be stored per project, per session, or per run?
4. Which command categories should be blocked by default inside the sandbox despite broad sandbox permission?
5. How should large diffs and long command outputs be stored when they exceed event-payload limits?
6. Should read-only repo-inspection runs be allowed concurrently in v1, or should all runs use the same single-run project lock until the tool boundary is proven?
7. What is the minimum explicit GitHub export flow: commit only, branch plus commit, or branch plus PR?
8. Should Flue workflows be introduced for bounded operations like PR summary generation after the main agent is stable?

## 19. Implementation Planning Notes

When this PRD is converted into implementation plans, each plan should be small and independently verifiable.

Recommended first implementation plan:

- Add Flue runtime/CLI/config.
- Add authenticated `/api/flue` mount.
- Add `.flue/agents/project-coder.ts` with a minimal route-free agent.
- Fix `src/lib/flue-client.ts` to use a same-origin base URL.
- Connect one `workspace.startRun` path to a non-mutating Flue prompt.
- Persist assistant response and terminal state to `agent_run_events`.
- Verify with typecheck, lint, tests, and one local run command if credentials are available.

Standard verification commands from the existing plans:

- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm test`
- `git diff --check`

Flue-specific verification should additionally use the installed Flue CLI once present:

- `npx flue docs search <topic>` for installed-version docs
- `npx flue docs read <page>` for installed-version docs
- `npx flue run project-coder --input '{"message":"..."}' --server /api/flue` or the equivalent command selected by the final route shape

Do not commit provider credentials, generated local Alchemy state, `.env`, or secret-bearing command output.
