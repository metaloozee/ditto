# Plan 001: Bake PI AI harness into sandbox image

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 61532eb..HEAD -- Dockerfile .dockerignore sandbox/ tsconfig.json package.json alchemy.run.ts src/server.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `61532eb`, 2026-07-09
- **Review**: tightened 2026-07-09 (Dockerfile install order, PI session path,
  wire contract, Alchemy/layout notes)
- **Executed**: 2026-07-09 — commit `7959594` on branch `advisor/001-ai-harness-runner`
  (worktree: `.worktrees/advisor-001-ai-harness-runner`)

## Why this matters

Ditto's composer still returns a stub assistant message. The product goal
(`PRODUCT.md`) is an AI harness that edits project code **inside** the
Cloudflare sandbox. The agent must run in the container (real filesystem +
bash tools), not in the Worker. This plan adds a PI coding-agent runner to
the sandbox Docker image and a versioned NDJSON event protocol that plan 002
will relay over SSE.

## Current state

### Sandbox binding via Alchemy (already correct — do not rework)

The Worker ↔ Sandbox binding is **already wired**. Plan 001 only changes the
**image contents** that Alchemy builds; it does **not** change bindings.

`alchemy.run.ts` today:

```ts
const sandbox = await Container("sandbox", {
	className: "Sandbox",
	build: {
		context: ".",
		dockerfile: "Dockerfile",
	},
	instanceType: "lite",
	maxInstances: 1,
});

export const website = await TanStackStart("website", {
	// ...
	bindings: {
		// ...
		Sandbox: sandbox,
		BACKUP_BUCKET: sandboxBackups,
		// ...
	},
	wrangler: {
		main: "src/server.ts",
		transform: (spec) => ({
			...spec,
			containers: [
				{
					class_name: "Sandbox",
					image: "../../Dockerfile",
					instance_type: "lite",
					max_instances: 1,
				},
			],
			durable_objects: {
				...spec.durable_objects,
				bindings: [
					{ class_name: "Sandbox", name: "Sandbox" },
				],
			},
			migrations: [{ new_sqlite_classes: ["Sandbox"], tag: "v1" }],
		}),
	},
});
```

`src/server.ts` re-exports the DO class (required by Sandbox SDK):

```ts
export { Sandbox } from "@cloudflare/sandbox";
```

App code obtains instances with `getSandbox(env.Sandbox, sandboxId, options)`
in `src/lib/sandbox-bootstrap.ts` (`getProjectSandbox`).

**What rebuilds the image**: any change under the Docker build context (`.`)
that affects `Dockerfile` or `COPY` sources, then `pnpm dev` / `pnpm deploy`
(Alchemy `Container` resource). No Alchemy API change is required for plan 001.

### Dockerfile / package layout today

- `Dockerfile` is a bare sandbox base image:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.12.1

WORKDIR /workspace
```

- `tsconfig.json` already excludes `sandbox/runner` from the app typecheck:

```json
"exclude": ["node_modules", "dist", ".alchemy", ".wrangler", "sandbox/runner"]
```

- Root `package.json` has `@cloudflare/sandbox` `^0.12.1` but **no** PI package.
- There is **no** `sandbox/` directory yet.
- Root `pnpm-workspace.yaml` does **not** list workspace packages (it only
  configures `allowBuilds` / release-age excludes). This is a **single app
  package**, not a multi-package monorepo.
- Workspace path constant: `WORKSPACE_PATH = "/workspace"` in
  `src/lib/workspace-policy.ts`.
- Product models are OpenCode Go IDs in `src/lib/agent-models.ts`, e.g.
  `opencode-go/deepseek-v4-flash`. PI (`@earendil-works/pi-coding-agent@0.80.3`)
  has a built-in `opencode-go` provider; auth via `OPENCODE_API_KEY` (injected
  by plan 002 into the shell session env — runner only *reads* the env).
- Backup excludes skip caches/env; session files under `/workspace/.ditto/`
  **must not** be excluded. Do not add `.ditto` to `SANDBOX_BACKUP_EXCLUDES`.

### Package layout decision (not a monorepo migration)

**Do not convert the repo to a multi-package monorepo for this work.**

| Approach | Verdict |
|----------|---------|
| Full monorepo (`packages/web`, `packages/runner`, turbo, shared libs) | **No** — premature. One deployable Worker + one Docker image. Shared types would pull PI into the Worker graph. |
| Root pnpm workspace member for runner | **No** — risks workspace hoisting of `@earendil-works/pi-*` into the app install / Vite graph. |
| **Isolated nested package** `sandbox/runner` with its own `package.json` + **npm** lockfile, excluded from root `tsconfig` | **Yes** — already anticipated by `tsconfig` exclude. Image `COPY`s only this tree into `/opt/ditto-runner`. |

Rules for the executor:

1. Install runner deps only with `npm` **inside** `sandbox/runner/` (not
   `pnpm add` at repo root).
2. Never add `@earendil-works/pi-coding-agent` to the root `package.json`.
3. Never add `sandbox/runner` to a pnpm `packages:` workspace list.
4. Root app continues to use `pnpm` as today.

### Conventions to match

- TypeScript, ESM, strict mode.
- Prefer no comments unless required for non-obvious CLI flags.
- Shell safety: never interpolate untrusted strings into shell commands
  (Worker writes a job file; runner reads the file).

### Wire contract for plan 002 (stable field names)

`sandbox/runner/src/protocol.ts` is the **source of truth** for NDJSON kinds
and field names. Plan 002 **duplicates** the type shapes in the Worker under
`src/lib/agent-stream-protocol.ts` (Worker cannot import `sandbox/runner`).
**Do not rename** `kind` values or `assistantText` / `delta` / `sessionId`
fields after this plan lands without updating plan 002 in the same change.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install runner deps | `cd sandbox/runner && npm install` | exit 0; creates `package-lock.json` |
| Build runner | `cd sandbox/runner && npm run build` | `dist/cli.js` exists |
| Typecheck runner | `cd sandbox/runner && npx tsc --noEmit` | exit 0 |
| Unit tests | `cd sandbox/runner && npm test` | all pass |
| App tests | `pnpm test` (repo root) | exit 0 |
| App check | `pnpm check` (repo root) | exit 0 if root files changed |
| Image build (preferred if Docker available) | `docker build -t ditto-sandbox:test .` | exit 0 |

## Suggested executor toolkit

- Skill `sandbox-sdk` if available (image extension patterns).
- PI SDK docs: https://pi.dev/docs/latest/sdk
- Package: `@earendil-works/pi-coding-agent@0.80.3` (pin exactly; STOP if install fails).

## Scope

**In scope** (the only files you should create/modify):

- `Dockerfile`
- `.dockerignore` (create)
- `sandbox/runner/package.json` (create)
- `sandbox/runner/package-lock.json` (create via npm install; commit it)
- `sandbox/runner/tsconfig.json` (create)
- `sandbox/runner/vitest.config.ts` (create)
- `sandbox/runner/src/cli.ts` (create)
- `sandbox/runner/src/run-agent.ts` (create)
- `sandbox/runner/src/protocol.ts` (create)
- `sandbox/runner/src/protocol.test.ts` (create)
- `sandbox/runner/.gitignore` (create — ignore `node_modules`, `dist`)
- `plans/README.md` status row only

**Out of scope**:

- `src/**` Worker/app code (plan 002)
- `alchemy.run.ts` / env bindings / `OPENCODE_API_KEY` (plan 002) — binding
  already works; do not “fix” Alchemy in this plan
- Chat UI / SSE client (plan 003)
- Concurrency locks
- Changing backup excludes
- Installing PI into the **root** `package.json`
- Converting the repo to a pnpm monorepo / adding workspace packages
- Changing `src/server.ts` Sandbox re-export

## Git workflow

- Branch: `advisor/001-ai-harness-runner`
- Commit style (from recent log): conventional, e.g. `feat(sandbox): add pi harness runner to image`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create runner package skeleton

Create `sandbox/runner/` as a **standalone Node ESM package** that builds to
`dist/cli.js`. Use **npm**, not pnpm.

`sandbox/runner/package.json` (exact shape):

```json
{
  "name": "ditto-sandbox-runner",
  "private": true,
  "type": "module",
  "bin": {
    "ditto-runner": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.80.3"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

Notes:

- Pin PI to **`0.80.3`** exactly (no `^`). If `npm install` fails on that
  version, STOP (do not float to latest).
- Add `@earendil-works/pi-ai` **only** if TypeScript reports a missing peer
  after install; otherwise leave it out (coding-agent re-exports / depends).
- Use vitest **only** (no Node built-in test runner alternative).

`sandbox/runner/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`sandbox/runner/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

`sandbox/runner/.gitignore`:

```
node_modules
dist
```

Run `npm install` inside `sandbox/runner` and **commit** `package-lock.json`.

**Verify**:

```bash
test -f sandbox/runner/package.json && test -f sandbox/runner/package-lock.json && test -f sandbox/runner/tsconfig.json
```

→ all three exist; `grep -q '"@earendil-works/pi-coding-agent": "0.80.3"' sandbox/runner/package.json`

### Step 2: Define the NDJSON protocol

Create `sandbox/runner/src/protocol.ts`.

Every **stdout** line is one JSON object (NDJSON). **stderr** is diagnostics
only (never protocol).

```ts
export const PROTOCOL_VERSION = 1 as const;

/**
 * Wire contract for plan 002. Field names are stable.
 * `sessionId` in events ALWAYS equals the job's `conversationId`
 * (Ditto workspace session id), not a PI-internal random id.
 */
export type RunnerOut =
  | { v: 1; kind: "ready"; sessionId: string; model: string }
  | { v: 1; kind: "agent_event"; event: unknown }
  | { v: 1; kind: "assistant_delta"; delta: string }
  | { v: 1; kind: "error"; message: string }
  | {
      v: 1;
      kind: "done";
      sessionId: string;
      assistantText: string;
      ok: boolean;
    };

export function encodeLine(msg: RunnerOut): string {
  return `${JSON.stringify(msg)}\n`;
}

export function extractTextDelta(event: unknown): string | null {
  // PI shape:
  // { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: string } }
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;
  if (e.type !== "message_update") return null;
  const ame = e.assistantMessageEvent;
  if (!ame || typeof ame !== "object") return null;
  const a = ame as Record<string, unknown>;
  if (a.type !== "text_delta" || typeof a.delta !== "string") return null;
  return a.delta;
}

export function extractAssistantTextFromMessages(messages: unknown): string {
  // Walk array of messages; for last role==="assistant", join text content blocks.
  // Content may be string or array of { type: "text", text: string }.
  // Return "" if nothing found.
}
```

Also export a small helper used by `run-agent` for final text:

```ts
export function pickAssistantText(
  accumulatedDeltas: string,
  sessionMessages: unknown,
): string {
  const fromDeltas = accumulatedDeltas.trim();
  if (fromDeltas.length > 0) return accumulatedDeltas;
  return extractAssistantTextFromMessages(sessionMessages);
}
```

Unit tests in `sandbox/runner/src/protocol.test.ts` (vitest `describe`/`it`/`expect`):

1. `encodeLine` ends with `\n` and `JSON.parse`s back
2. `extractTextDelta` returns `"Hello"` for the fixture below
3. `extractTextDelta` returns `null` for `{ type: "agent_start" }`
4. `extractAssistantTextFromMessages` joins assistant text blocks
5. `pickAssistantText` prefers deltas when non-empty

Fixture:

```json
{
  "type": "message_update",
  "assistantMessageEvent": { "type": "text_delta", "delta": "Hello" }
}
```

**Verify**: `cd sandbox/runner && npm test` → all protocol tests pass

### Step 3: Implement `run-agent.ts`

Create `sandbox/runner/src/run-agent.ts`.

#### Imports (preferred)

```ts
import fs from "node:fs";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  resolveCliModel,
} from "@earendil-works/pi-coding-agent";
```

If `resolveCliModel` is not exported in 0.80.3 types, fall back to
`ModelRegistry.find(provider, modelId)` after splitting the specifier on the
first `/`. Do not invent other packages.

#### Function signature

```ts
export type RunAgentOptions = {
  cwd: string; // default "/workspace"
  conversationId: string;
  modelSpecifier: string; // e.g. "opencode-go/deepseek-v4-flash"
  prompt: string;
  agentDir: string; // default "/workspace/.ditto/pi-agent"
  sessionsDir: string; // default "/workspace/.ditto/sessions"
  onEvent: (msg: RunnerOut) => void;
};

export async function runAgent(options: RunAgentOptions): Promise<{
  ok: boolean;
  assistantText: string;
}>;
```

#### Required control flow

1. `fs.mkdirSync(agentDir, { recursive: true })` and same for `sessionsDir`.
2. **Auth + model** (exact preferred sequence):
   ```ts
   const authPath = path.join(agentDir, "auth.json");
   const authStorage = AuthStorage.create(authPath);
   if (process.env.OPENCODE_API_KEY) {
     authStorage.setRuntimeApiKey("opencode-go", process.env.OPENCODE_API_KEY);
   }
   const modelRegistry = ModelRegistry.create(authStorage);
   const resolved = resolveCliModel({
     cliModel: options.modelSpecifier,
     modelRegistry,
   });
   if (resolved.error || !resolved.model) {
     options.onEvent({
       v: 1,
       kind: "error",
       message: resolved.error ?? `Unknown model: ${options.modelSpecifier}`,
     });
     return { ok: false, assistantText: "" };
   }
   const model = resolved.model;
   ```
   If `resolveCliModel` return shape differs, adapt to **actual** types in
   `node_modules` after install — keep the same behavior (fail closed with
   `error` event + `{ ok: false }`).
3. **Session file** (persistent under workspace so backups include history):
   ```ts
   const sessionFile = path.join(
     options.sessionsDir,
     `${options.conversationId}.jsonl`,
   );
   let sessionManager: SessionManager;
   if (fs.existsSync(sessionFile)) {
     sessionManager = SessionManager.open(sessionFile);
   } else {
     // Documented API: SessionManager.open(path) for a specific file.
     // For a brand-new conversation, open the target path so PI writes there.
     sessionManager = SessionManager.open(sessionFile);
   }
   ```
   If `SessionManager.open` throws on a missing file, STOP and report — do
   not invent header formats. (If types show a `create` overload that accepts
   an explicit file path, use that instead of open for the missing-file case
   only.)
4. Settings: use `SettingsManager.inMemory({ compaction: { enabled: true } })`
   so the runner does not depend on `~/.pi` inside the container.
5. Create agent session:
   ```ts
   const { session } = await createAgentSession({
     cwd: options.cwd,
     agentDir: options.agentDir,
     model,
     authStorage,
     modelRegistry,
     sessionManager,
     settingsManager: SettingsManager.inMemory({
       compaction: { enabled: true },
     }),
     tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
   });
   ```
   Built-in tool names are documented as exactly those strings.
6. Emit **ready** immediately after session construction:
   ```ts
   options.onEvent({
     v: 1,
     kind: "ready",
     sessionId: options.conversationId,
     model: options.modelSpecifier,
   });
   ```
7. Subscribe and accumulate deltas:
   ```ts
   let deltas = "";
   const unsubscribe = session.subscribe((event) => {
     options.onEvent({ v: 1, kind: "agent_event", event });
     const delta = extractTextDelta(event);
     if (delta) {
       deltas += delta;
       options.onEvent({ v: 1, kind: "assistant_delta", delta });
     }
   });
   ```
   Forward full `agent_event` payloads (plan 002 may filter client-side). Do
   not strip events in the runner.
8. `try { await session.prompt(options.prompt); } catch (err) { ... }`
9. Build `assistantText = pickAssistantText(deltas, session.messages)`.
10. Always:
    ```ts
    unsubscribe();
    session.dispose();
    ```
    in `finally`.
11. Terminal events:
    - **Success**: emit
      `{ v:1, kind:"done", sessionId: conversationId, assistantText, ok: true }`
      and return `{ ok: true, assistantText }`.
    - **Failure** (model resolve failed already returned; prompt throw;
      dispose errors are logged to stderr only):
      - emit `{ v:1, kind:"error", message: <redacted short message> }` if not
        already emitted
      - emit
        `{ v:1, kind:"done", sessionId: conversationId, assistantText, ok: false }`
        (assistantText may be partial deltas)
      - return `{ ok: false, assistantText }`

Never throw past `runAgent` without emitting `done` with `ok: false` (CLI
depends on a terminal `done` line).

**Verify**: `cd sandbox/runner && npm run typecheck` → exit 0

### Step 4: Implement CLI entrypoint

Create `sandbox/runner/src/cli.ts`:

```ts
#!/usr/bin/env node
```

- Parse argv for `--job <path>` only (required).
- Missing `--job` → stdout
  `encodeLine({ v:1, kind:"error", message:"--job is required" })` then
  `process.exit(2)`.
- Read job file as UTF-8 JSON:
  ```ts
  type Job = {
    conversationId: string;
    model: string;
    prompt: string;
    cwd?: string;
  };
  ```
- Validate non-empty strings for `conversationId`, `model`, `prompt`. On
  invalid/missing file → `error` NDJSON + exit `2`.
- Call `runAgent` with `onEvent: (msg) => process.stdout.write(encodeLine(msg))`.
- Exit code: `0` if `result.ok`, else `1`.
- **Never** write non-JSON to stdout. Use `console.error` for diagnostics.

**Verify**:

```bash
cd sandbox/runner && npm run build
node dist/cli.js 2>/dev/null | head -1 | grep -q '"kind":"error"'
test "${PIPESTATUS[0]}" -eq 2 || test $? -eq 2
node dist/cli.js --job /nonexistent-job-ditto.json 2>/dev/null | head -1 | grep -q '"kind":"error"'
```

→ both invocations print a JSON error line on stdout and exit non-zero.

### Step 5: Add `.dockerignore` and extend Dockerfile

Create root `.dockerignore` so Alchemy/Docker build context stays small
(`build.context` is `"."` in `alchemy.run.ts`):

```
node_modules
dist
.alchemy
.wrangler
.git
.env
.env.*
src
migrations
public
plans
.agents
**/*.md
!sandbox/runner/**
sandbox/runner/node_modules
sandbox/runner/dist
```

Adjust only if a required COPY path is excluded — the Dockerfile must still
see `sandbox/runner/package.json` + sources.

Update root `Dockerfile`:

```dockerfile
FROM docker.io/cloudflare/sandbox:0.12.1

# Harness lives outside /workspace so project clone/clear does not delete it.
COPY sandbox/runner /opt/ditto-runner
WORKDIR /opt/ditto-runner

# Install WITH devDependencies so `tsc` can build, then prune for a lean image.
RUN npm ci \
  && npm run build \
  && npm prune --omit=dev \
  && chmod +x dist/cli.js \
  && ln -sf /opt/ditto-runner/dist/cli.js /usr/local/bin/ditto-runner

WORKDIR /workspace
```

Critical rules:

1. **Do not** use `npm ci --omit=dev` before `npm run build` — `typescript` is
   a devDependency; build would fail.
2. Prefer `npm ci` (requires committed lockfile from Step 1).
3. Base tag stays `0.12.1` (matches `@cloudflare/sandbox`).
4. Binary path for plan 002: `/opt/ditto-runner/dist/cli.js` or `ditto-runner`.

**Verify**:

```bash
grep -q 'npm ci' Dockerfile && grep -q 'npm prune --omit=dev' Dockerfile
grep -q 'ditto-runner' Dockerfile
test -f .dockerignore
```

If Docker is available:

```bash
docker build -t ditto-sandbox:test .
```

→ exit 0. If Docker is unavailable, note that in the status update; still
require the Dockerfile layer order above to be correct on paper.

### Step 6: Guardrails against monorepo/workspace mistakes

Confirm:

```bash
# runner is NOT a pnpm workspace package
! grep -q 'sandbox/runner' pnpm-workspace.yaml
# PI is NOT in root app deps
! grep -q 'pi-coding-agent' package.json
# root tsconfig still excludes runner
grep -q 'sandbox/runner' tsconfig.json
```

All three checks must pass.

**Verify**: `pnpm test` at repo root → exit 0

## Test plan

- `sandbox/runner/src/protocol.test.ts` cases listed in Step 2.
- CLI smoke checks in Step 4 (no API key required).
- Pattern: vitest like root `src/lib/sandbox-backup.test.ts` (`describe`/`it`/`expect`).

## Done criteria

- [ ] `sandbox/runner` builds: `cd sandbox/runner && npm run build` → `dist/cli.js` exists
- [ ] `cd sandbox/runner && npm test` exits 0
- [ ] `cd sandbox/runner && npm run typecheck` exits 0
- [ ] Dockerfile installs with **full** `npm ci`, then `build`, then `npm prune --omit=dev`
- [ ] `.dockerignore` exists and excludes root `node_modules`
- [ ] CLI missing `--job` prints NDJSON `error` on stdout and exits 2
- [ ] Protocol emits `ready` and always ends with `done` (`ok` true/false)
- [ ] Session files target `/workspace/.ditto/sessions/<conversationId>.jsonl`
- [ ] Root `tsconfig.json` still excludes `sandbox/runner`
- [ ] PI not added to root `package.json`; runner not added to pnpm workspace
- [ ] No Worker/app runtime code changed under `src/`
- [ ] `alchemy.run.ts` unchanged (binding already correct)
- [ ] `plans/README.md` status for 001 set to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- `@earendil-works/pi-coding-agent@0.80.3` cannot be installed.
- Public API lacks `createAgentSession` / `SessionManager` / `AuthStorage` /
  `ModelRegistry`.
- `SessionManager.open(sessionFile)` cannot target
  `/workspace/.ditto/sessions/<id>.jsonl` for both new and existing files
  (no documented path-based create).
- Dockerfile base image lacks Node/npm or `npm ci` + `tsc` build fails for a
  reason you cannot fix inside `sandbox/runner` alone.
- Someone requires adding the runner as a pnpm workspace package or installing
  PI at the repo root — that is out of scope; report instead of complying.
- Drift check shows `Dockerfile` / harness already implemented differently.
- Alchemy binding appears broken in the repo (missing `export { Sandbox }` or
  missing `Sandbox: sandbox` binding) — report; do not redesign IaC in 001
  unless the fix is a one-line restore of the existing pattern.

## Maintenance notes

- Bump `@earendil-works/pi-coding-agent` and rebuild the image when models or
  tool APIs change; keep Dockerfile base tag in sync with
  `@cloudflare/sandbox`.
- Reviewers: session files under `/workspace` (backed up); runner under
  `/opt` (survives `clearSandboxWorkspace`).
- Plan 002 assumes binary `/opt/ditto-runner/dist/cli.js`, NDJSON kinds in
  this plan, and `sessionId === conversationId`.
- **Alchemy**: image rebuilds automatically when Container build context
  inputs change; no monorepo required.
- Deferred: custom tools; skills; concurrency locks; monorepo extraction if
  a second deployable Node service appears later.
