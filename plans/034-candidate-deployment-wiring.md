# Plan 034: Candidate sessions are wired into the Alchemy graph behind an opt-in, local-only flag

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat dfc27dd..HEAD -- alchemy.run.ts package.json apps/web/src/server.ts apps/web/src/server.test.ts apps/web/types/env.d.ts apps/web/src/lib/candidate-lifecycle.ts apps/web/src/lib/session-command-candidate.ts apps/web/src/lib/candidate-branch-fetch.ts apps/web/src/lib/model-product-transport.ts apps/web/src/lib/configuration-product-authority.ts apps/runtime/src/pi-durable-product-session.ts apps/runtime/src/pi-durable-execution-session.ts apps/runtime/src/pi-durable-preview-fetch.ts apps/credential-tests/vitest.config.ts apps/credential-tests/src/model-entry.ts apps/credential-tests/src/product-commands.worker.test.ts packages/runtime-contracts/src README.md`
> If any of these changed, compare the "Current state" excerpts against the live code. On a mismatch, STOP.

## Status

- **Priority**: P1. It is the only thing blocking 019.
- **Effort**: L
- **Risk**: MED. It changes the public Worker's exports and the deployment graph. Every new binding sits behind `DITTO_CANDIDATE_RUNTIME=1`, and Alchemy refuses that flag on any non-local stage, so a default `pnpm dev` or `pnpm deploy` produces the same graph as before.
- **Depends on**: 025, 029, 030 and 031–033 (all DONE). The base must contain `5a0ce1b` (feat(web): route candidate preview hosts).
- **Category**: direction (L6 prerequisite). This closes open maintainer decision 5.
- **Planned at**: commit `dfc27dd`, 2026-10-30

## Why this matters

Every candidate-session (Pi Durable runtime) module exists and is tested in fixtures. Nothing deploys them. `alchemy.run.ts` does not bind `PiDurableExecutionSession`, `PiDurableCandidateSandbox`, a recovery bucket, the runtime's preview entrypoint or a product entrypoint for the runtime to call. `CandidatePrivateProduct` (the product RPC surface the runtime needs) is implemented only by the test fixture `CandidateFixtureProduct` in `apps/credential-tests`. Plan 019 (real-auth local acceptance) has been BLOCKED on exactly this since 2026-10-28.

This plan delivers:
- a production `CandidatePrivateProduct` entrypoint in the web Worker;
- a runtime Worker entry;
- the missing executor-teardown method;
- the Alchemy wiring, opt-in and local only.

Hosted deployment stays out of scope. Open decision 5 says production work "needs a named target and explicit approval". The named target here is the **local Alchemy stage only**. A hosted stage needs its own approval and plan (020's hosted track).

## Current state

### Topology the spec requires

`docs/specs/pi-durable-session-runtime.md` §1 ("Architecture and responsibility"):

> A separately deployed runtime Worker owns the workspace-session Durable Object class and the Sandbox class. […] Private service bindings connect the Workers. The product Worker must not expose an arbitrary public proxy to privileged runtime methods. The runtime Worker must not become a public preview origin. Alchemy remains the only deployment owner.

`plans/decisions/024-candidate-preview-delivery.md` §5 lists the wiring: a `CandidateSandbox` DO namespace for `PiDurableCandidateSandbox` with the image, `CANDIDATE_RECOVERY` R2, the `ContainerProxy` export, runtime config for the preview base host, a product-to-runtime service binding for preview fetch, and the `PiDurableExecutionSession` export as `CandidateSessions`. 024 rejected binding `CandidateSandbox` into the product Worker, because the public Worker must not hold a binding that can `exec` in untrusted sandboxes. **The product Worker must never get a `CandidateSandbox` binding.**

Target graph:

```text
product Worker "website" (apps/web/src/server.ts)
  exports CandidatePrivateProduct   <── service binding CandidateProduct ── runtime
  CandidateSessions  ── cross-script DO ──> runtime PiDurableExecutionSession
  CANDIDATE_PREVIEW  ── service binding ──> runtime entrypoint CandidatePreview
  BACKUP_BUCKET (existing R2 "sandbox-backups")

runtime Worker "candidate-runtime" (apps/runtime/src/pi-durable-candidate-entry.ts), url: false
  CandidateSessions  = DO PiDurableExecutionSession (sqlite)
  CandidateSandbox   = Container PiDurableCandidateSandbox (root Dockerfile)
  CANDIDATE_RECOVERY = the SAME R2 bucket as BACKUP_BUCKET
  CandidateProduct   = service -> website entrypoint CandidatePrivateProduct
  CANDIDATE_DISPOSABLE = "008-synthetic", CANDIDATE_RUNTIME_KEYS (secret), CANDIDATE_PREVIEW_HOST (optional)
```

**Why one bucket.** `readCandidateBaselineSource` (`apps/web/src/lib/candidate-baseline.ts:79-89`) returns the project seed's `objectKey`. Product code writes that key into `BACKUP_BUCKET` (`apps/web/src/lib/sandbox-archive.ts:135-142,695`, keys `project_seed/<id>/<gen>/<archiveId>.tar.gz`). The runtime restores the seed through its own store over `CANDIDATE_RECOVERY` (`apps/runtime/src/pi-durable-checkpoints.ts:904-910`). The two buckets must be the same, or every baseline fails.

**Why sharing is safe** (checked at `dfc27dd`): runtime retention deletes only keys in its own `checkpoint_objects` ledger. Those keys are inserted at publication (`pi-durable-checkpoints.ts:631-635`, `context/<session>/…`) or come from runtime uploads (`:541-546`, `pi-durable-artifacts.ts:614`, `workspace/<session>/…`). Product deletes only by D1 row `objectKey` (`sandbox-archive.ts:809,849`). Neither side lists or deletes by prefix.

### What is gated and stays gated

Wiring deploys inert code unless fixtures are seeded. Every one of these gates **stays**:

- `apps/runtime/src/pi-durable-product-session.ts:189,242`: every session entry throws unless `env.CANDIDATE_DISPOSABLE === "008-synthetic"`.
- `apps/web/src/lib/session-command-candidate.ts:440-475`: first-session creation requires a `codex_fixture_capabilities` row, and new identities use `controllerNamespace='fixture-pi-durable-execution-v1'`.
- `apps/web/src/lib/model-product-transport.ts:31-37,54-60`: `performPrivateModelRequest(…, fixtureAvailable=false)` returns `{status:"unavailable"}`, and `readPrivateModelPermit(…, false)` returns `denied`. The spec (line 627) says product request and permit methods "remain unavailable in production composition".
- `apps/web/src/lib/configuration-product-authority.ts:13-22`: `readOwnedConfigurationAuthority(db, subject, input, selection, fixtureAvailable, candidatePolicy?)` returns `{version:1,status:"unavailable"}` when `fixtureAvailable` is `false`.
- **The production entrypoint passes `false` to all three helpers.** The fixture passes `true` to each (`apps/credential-tests/src/model-entry.ts:1467-1485`); that is the deliberate difference. Consequence: through this entrypoint a candidate session can never configure or call a model. Model work waits on plan 020 or a later maintainer decision.

### Runtime side

`apps/runtime/src/pi-durable-execution-session.ts:32-65` already defines the classes and bindings:

```ts
export class PiDurableCandidateSandbox extends Sandbox {
	enableInternet = false;
	interceptHttps = true;
}
// …
PiDurableCandidateSandbox.outboundHandlers = { candidateGit };

export type ExecutionSessionBindings = CandidateSessionBindings & {
	CandidateSandbox?: DurableObjectNamespace<PiDurableCandidateSandbox>;
	CANDIDATE_RECOVERY?: R2Bucket;
	CANDIDATE_PREVIEW_HOST?: string;
};
```

`CandidateSessionBindings` (`pi-durable-product-session.ts:140-145`):

```ts
export type CandidateSessionBindings = {
	CANDIDATE_DISPOSABLE: "008-synthetic";
	CANDIDATE_RUNTIME_KEYS: string;
	CandidateProduct: CandidatePrivateProduct;
	CandidateSessions: DurableObjectNamespace<PiDurableProductSession>;
};
```

The scope type and its parser are defined in the runtime (`pi-durable-product-session.ts:52-74`) and depend only on the contracts JSON helpers (`literalField`, `strictRecord`, `stringField` from `packages/runtime-contracts/src/json.js`, imported at `:13-17`):

```ts
export type CandidateRuntimeScope = { version: 2; userId: string; projectId: string; workspaceSessionId: string; ownerVersion: 1 };
export function parseCandidateRuntimeScope(value: unknown): CandidateRuntimeScope {
	const row = strictRecord(value, ["version", "userId", "projectId", "workspaceSessionId", "ownerVersion"], "Candidate runtime scope");
	return { version: literalField(row, "version", [2]), userId: stringField(row, "userId"), projectId: stringField(row, "projectId"), workspaceSessionId: stringField(row, "workspaceSessionId"), ownerVersion: literalField(row, "ownerVersion", [1]) };
}
```

`apps/web/src` has no equivalent; web has only `CandidateFetchScope` and `CandidateSessionScope`. The importers are `pi-durable-execution-session.ts` and `apps/credential-tests/src/model-entry.ts:33-38`, both via `./pi-durable-product-session.ts`. Step 0b moves the pair into contracts so web can use it.

`CANDIDATE_RUNTIME_KEYS` is JSON parsed by `parseRuntimeKeyring` (`:229-235`). Its shape is the one the fixture uses (`apps/credential-tests/vitest.config.ts:38`): `{"currentVersion":"<v>","keys":{"<v>":"<64 hex chars>"}}`. Never commit a real value.

`CandidatePrivateProduct` interface: `pi-durable-product-session.ts:75-139`. It extends `PrivateModelTransport` (`requestModel`, `readModelPermit`; `apps/runtime/src/pi-durable-models.ts:147-156`).

Hooks follow one pattern: a no-op `protected` hook in the base class, overridden in `PiDurableExecutionSession`. Exemplar, the preview revocation pair:

```ts
// pi-durable-product-session.ts:179-180 (base)
/** Deployment composition revokes the session's preview URL; none has nothing to revoke. */
protected async revokePreview(_scope: CandidateRuntimeScope): Promise<void> {}
// pi-durable-execution-session.ts:145-155 (override)
protected override async revokePreview(scope: CandidateRuntimeScope) {
	const { CandidateSandbox } = this.env;
	if (!CandidateSandbox) return;
	await (getSandbox(CandidateSandbox, candidateSandboxName(scope.workspaceSessionId), { transport: "rpc" }) as ExecutionSandbox).unexposePort(WORKSPACE_PREVIEW_PORT);
}
```

`purgeDeleted` (`pi-durable-product-session.ts:480-491`) is the model for a fenced, passive method that closes the host first:

```ts
async purgeDeleted(value: unknown) {
	const scope = await this.passiveScope(value);
	if (!(await this.env.CandidateProduct.readDeletionAuthority(scope)))
		throw new Error("Candidate deletion not fenced");
	await this.host?.yield().catch(() => undefined);
	await this.host?.awaitClosure().catch(() => undefined);
	this.host = undefined;
	await this.revokePreview(scope);
	await this.ctx.storage.deleteAlarm();
	await this.ctx.storage.deleteAll();
}
```

`passiveScope` is `private` (`:241`). New base-class methods can call it; subclasses cannot.

**Missing runtime capability.** The product lifecycle tears down an executor through `CandidateLifecycleRuntime.terminateExecutor(identity)`. It does that for archived-session executor jobs and for every session of a deleted project (`apps/web/src/lib/candidate-lifecycle.ts:29-33,396-440,477-483`). It releases the execution slot only on `{terminated:true}`. No runtime method destroys a candidate sandbox, and the interface passes only `{identityId, incarnationId, sandboxId}`, not the workspace session. The sandbox's name is `candidateSandboxName(workspaceSessionId)` (= `c-<workspaceSessionId>`, `apps/runtime/src/pi-durable-preview.ts`). Today `teardownExecutor` selects `id,incarnationId,sandboxId,userId,state` (`candidate-lifecycle.ts:397-401`) and has `sessionId` in hand.

The preview helper exists but nothing mounts it (`apps/runtime/src/pi-durable-preview-fetch.ts`):

```ts
export async function candidatePreviewFetch(request, deps: { session(id): { previewAdmit(digest): Promise<boolean> }; proxy(request): Promise<Response | null> }): Promise<Response>
export function candidatePreviewProxy(env: { CandidateSandbox: DurableObjectNamespace<Sandbox> }): (request: Request) => Promise<Response | null>
```

The only Worker entry in the runtime is a fixture: `apps/runtime/src/pi-durable-local-entry.ts` re-exports `default`, `PiDurableLocalRuntime` and `PiDurableLocalSandbox`. `apps/runtime/tsconfig.json` includes `src/**/*.ts`, so a new entry file is typechecked by `pnpm --filter @ditto/runtime typecheck`.

### Product side

The fixture that the production entrypoint must mirror, minus fixture hooks, is `apps/credential-tests/src/model-entry.ts:722-1490` (`class CandidateFixtureProduct extends WorkerEntrypoint<CandidateFixtureBindings>`). For each method, the production body is below. `parseCandidateRuntimeScope` below means the contracts copy from Step 0b. Rows marked **differs** are deliberate differences from the fixture; everything else matches it.

| Method | Production body |
|---|---|
| `readCandidateBaselineSource(scope)` | `readCandidateBaselineSource(DB, parseCandidateRuntimeScope(scope))`, same as the fixture |
| `openCandidateBranchFetch` / `brokerCandidateGit` / `closeCandidateBranchFetch` | Same calls, but deps are `{ db: DB, now: Date.now, ...candidateGitHubDeps(env, DB, parsedScope), fetch: (r) => fetch(r) }`. `candidateGitHubDeps` is at `apps/web/src/lib/candidate-branch-fetch.ts:95-158`. |
| `applyCandidateProjections` / `Checkpoints` / `Restore` / `Archive` | `commands().applyProjections` / `applyCheckpointProjections` / `applyRestoreCompletion` / `applyArchiveCompletion` with the parsed scope. No fault injection. |
| `readHistoryAuthority` / `readArchivedAuthority` | `lifecycle().historyAuthority` / `archivedAuthority` |
| `readDeletionAuthority` | Same SQL as the fixture (`model-entry.ts:1288-1296`) |
| `readRuntimeAuthority(scope)` | **Differs**: `commands().runtimeAuthority(userId, projectId, workspaceSessionId)` only. No `candidate_fixture_resets` branch, no revoke counter. |
| `readCandidateProjectValues` | **Differs**: `deliverCandidateProjectValues({…, secret: env.BETTER_AUTH_SECRET})`; the fixture uses `CANDIDATE_PROJECT_VALUES_SECRET`. Project `envVars` are encrypted with `BETTER_AUTH_SECRET` (`apps/web/src/lib/workspace-runtime.ts:804`, same `encryptText`/`decryptText` in `apps/web/src/lib/crypto.ts`). |
| `readCandidateSubject` / `reconstructCommand` | Same as the fixture |
| `reconcileCandidateDecision(decision)` | **Differs**: `commands().reconcileDecision(decision.commandId, decision.ownerVersion, decision)`. No `consumeLostDecisionAck`, which is fixture-only. |
| `readCandidateConfigurationAuthority` | **Differs**: the fixture body minus the `candidateConfigurationPermission()` hold, with `CodexCredential` in place of `CandidateCredential`, and **`false`** as the fifth argument to `readOwnedConfigurationAuthority` (the fixture passes `true`) |
| `requestModel(input, cap)` | **Differs**: `performPrivateModelRequest({ DB: env.DB, CodexCredential: env.CodexCredential }, input, cap, false)`; the fixture passes `CandidateCredential` and `true` |
| `readModelPermit(input, d)` | **Differs**: `readPrivateModelPermit(DB, input, d, false, CANDIDATE_MODEL_POLICY)`; the fixture passes `true` and the reset-aware `candidateModelPolicy(DB)` (`apps/credential-tests/src/entry.ts:174`), which is fixture-only |
| `fetch()` | `new Response("Not found", { status: 404 })` |

Omit the fixture-only methods: `reserveCandidateReset`, `resetCandidate`, `fixtureControls`, `fixtureRecoveryAcknowledged`, `recoverCandidate`, `fixtureDispatchActivation`, `setProjectionFault`, `setExecutorFixture`, `revokeRuntimeAuthorityAfter`, `continueOwned`, `runCandidateCleanup`. Also omit the owned browser-facing methods (`admitOwned`, `observeOwned`, …). Those take a caller-supplied `userId`, so they must **not** be on an entrypoint the runtime can call. They belong to the in-process service below.

The fixture `commands()` (`model-entry.ts:1161-1189`) builds `new CandidateProductCommands(DB, runtimePort, owner => credentialStub)` where `runtimePort` maps `readSelection`, `targetStatus`, `observe`, `observeHistory` and `workspaceAction` onto `CandidateSessions.getByName(sessionId)`. The fixture `lifecycle()` (`:1235-1263`) builds `new CandidateLifecycle(DB, { exportContinuation, importContinuation, terminateExecutor, purgeSession })`. `drain()` (`:1313-1320`) delivers with `CandidateSessions.getByName(sessionId).deliverCommand(commandId, ownerVersion)`.

**The browser-facing service must run in process, not over a service binding.** `handleCandidateCommandRequest` maps errors with `error instanceof CandidateCommandError` (`apps/web/src/lib/session-command.ts:1390-1394`), and so does `projects.ts:327`. Workers RPC does not keep error classes, so a service-binding hop would turn every 409/403 code into `503 runtime_unavailable`. The current seam (`apps/web/src/server.ts:167-183`):

```ts
return withSessionRuntimeResolution(
	{ candidateCommands: env.PI_DURABLE_PRODUCT_COMMANDS },
	() => handler.fetch(request),
);
// scheduled:
const candidate = env.PI_DURABLE_PRODUCT_COMMANDS?.drain();
```

`CandidateProductCommandService` (`apps/web/src/lib/session-runtime-client.ts:193-225`) has six members: `admitOwned`, `observeOwned`, `workspaceActionOwned`, `deleteProjectOwned`, `modelsOwned` and `drain`. Their fixture bodies are `model-entry.ts:1274-1320` (`deleteProjectOwned` → `lifecycle().deleteProject`).

`apps/web/types/env.d.ts` (the whole file's binding part):

```ts
export type CloudflareEnv = typeof website.Env & {
	// Runtime service binding for candidate preview hosts; unbound until deployment wiring.
	CANDIDATE_PREVIEW?: Fetcher
	PI_DURABLE_PRODUCT_COMMANDS?: import("../src/lib/session-runtime-client").CandidateProductCommandService
}
```

`website.Env` is inferred from the `bindings` in `alchemy.run.ts`, so `pnpm typecheck` also checks `alchemy.run.ts`.

The web package already imports runtime modules by relative path (`apps/web/src/lib/session-command-candidate.ts:45`, `../../../runtime/src/product-projector.js`). It does **not** import `pi-durable-product-session.ts`, because that module pulls in `@earendil-works/*`, which web does not depend on. Do not add that import to web. Check conformance in `apps/credential-tests` instead, which resolves both (`apps/credential-tests/tsconfig.json`, `"#/*": ["../web/src/*"]`).

`ModelProductBindings` (`apps/web/src/lib/model-product-transport.ts:18`) is the exemplar for a narrow bindings type in place of the global `Env`. Follow it.

### Alchemy (`alchemy.run.ts`)

- `:20-31`: `piDurableFixture` selects a separate app. Leave it untouched.
- `:82-119`: the old `DITTO_LOCAL_RUNTIME_TOPOLOGY` block is the in-repo exemplar for two Workers that bind each other by name: `WorkerRef({ service: name })` plus `Worker.experimentalEntrypoint(ref, "EntrypointName")`. Do not reuse or edit that block.
- `:121-129`: the legacy `Container("sandbox", { className: "Sandbox", build: { context: ".", dockerfile: "Dockerfile" }, instanceType: "basic", maxInstances: 20 })`. The root `Dockerfile` already installs `ditto-workspace`, `ditto-exec` and `ditto-archive`, which the candidate sandbox needs. Reuse the same build.
- `:137-139`: `sandboxBackups = R2Bucket("sandbox-backups", …)`.
- `:141-211`: `TanStackStart("website", { … bindings, wrangler: { main, transform } })`. **The transform replaces `durable_objects.bindings` with a literal two-item list** (`Sandbox`, `CodexCredential`, `:192-204`). Any new DO binding on the website must also be added to that list, or local dev drops it.
- The deployed website's Worker name is `ditto-website-<stage>`, i.e. `${app.name}-website-${app.stage}` (from `.alchemy/ditto/ayan/website.json`). Do **not** add a `name:` to `TanStackStart`, because renaming replaces the Worker.
- Alchemy 0.93.12 supports `DurableObjectNamespace(id, { className, scriptName, sqlite })` for cross-script bindings (`node_modules/alchemy/lib/cloudflare/durable-object-namespace.d.ts:7,16,49`) and `Worker.experimentalEntrypoint(worker | WorkerRef | Self, name)` (`worker.d.ts:795`).
- The only local Alchemy stage state is `ayan`, with `http://localhost:5177/`. No hosted stage is recorded in this checkout.

### Conventions

- Tabs, double quotes, `unknown` for external input, typed outcomes, Biome (`pnpm check`).
- Comments only for constraints the code cannot show. Short `/** … */` on hooks, as in the excerpts above.
- Commit style is conventional with scope, e.g. `feat(runtime): return candidate preview URL`, `feat(web): route candidate preview hosts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web typecheck (also checks `alchemy.run.ts`) | `pnpm typecheck` | exit 0 |
| Runtime typecheck | `pnpm --filter @ditto/runtime typecheck` | exit 0 |
| Contracts gate | `pnpm contracts:verify` | exit 0 |
| Credential tests typecheck | `pnpm --filter @ditto/credential-tests typecheck` | exit 0 |
| One credential worker test | `pnpm --filter @ditto/credential-tests exec vitest run src/<file>` | all pass, nonzero count |
| Web test | `pnpm --filter @ditto/web exec vitest run src/server.test.ts` | all pass |
| Lint/format check | `pnpm check` | exit 0 |
| Credential gate | `pnpm credentials:verify` | exit 0. On WSL the combined run is known to flake on storage; if so, rerun each file alone and record both. |
| Full gate | `pnpm verify` | exit 0 |

A zero-test filter is not a pass.

## Suggested executor toolkit

- `durable-objects` and `workers-best-practices` skills, if available, for the entrypoint and DO method.
- Alchemy docs for `Worker`, `Container`, `DurableObjectNamespace` (`scriptName`), `WorkerRef` and `Worker.experimentalEntrypoint`. Read `node_modules/alchemy/lib/cloudflare/*.d.ts` rather than guessing.

## Scope

**In scope** (the only files you may modify or create):
- `packages/runtime-contracts/src/candidate-scope.ts` and `candidate-scope.test.ts` (create): the moved scope type and parser.
- `apps/runtime/src/pi-durable-product-session.ts`: re-export the moved parser, add `terminateExecutor` and the `destroyExecutor` hook.
- `apps/runtime/src/pi-durable-execution-session.ts`: override `destroyExecutor`.
- `apps/runtime/src/pi-durable-candidate-entry.ts` (create): the runtime Worker entry.
- `apps/web/src/lib/candidate-lifecycle.ts`: widen the `terminateExecutor` input only.
- `apps/web/src/lib/candidate-product.ts` (create): the production entrypoint and in-process service.
- `apps/web/src/server.ts`, `apps/web/src/server.test.ts`, `apps/web/types/env.d.ts`
- `apps/credential-tests/vitest.config.ts`, `apps/credential-tests/src/model-entry.ts` (one re-export line), `apps/credential-tests/src/product-commands.worker.test.ts` (new `it` blocks and one `ProvidedEnv` line only), `apps/credential-tests/src/candidate-production-product.type-test.ts` (create; compile-time checks only)
- `package.json` (root): only the `credentials:verify` file list.
- `alchemy.run.ts`
- `README.md`: environment-variable section only.
- `plans/README.md`: status row, decision 5 text and the 019 row.

**Out of scope** (do NOT touch):
- `controllerNamespace='fixture-pi-durable-execution-v1'`, `CANDIDATE_DISPOSABLE` / `"008-synthetic"`, `codex_fixture_capabilities`. These are the disposable gate. Lifting them is a separate maintainer decision.
- `fixtureAvailable=false` → `true` anywhere. Model requests stay unavailable in production composition (spec line 627; plan 020).
- `CodexCredential.modelCapacity()` (`apps/web/src/lib/codex-credential-do.ts:452`). It is unbounded in production, but unreachable while requests are unavailable. See Maintenance notes.
- `restoreAvailable` / `archiveAvailable` on the admission runtime port. Leave them unset, so restore and archive admission stay refused. See Maintenance notes.
- Any `CandidateSandbox` binding on the website. 024 forbids it.
- The `piDurableFixture` app and the `DITTO_LOCAL_RUNTIME_TOPOLOGY` block in `alchemy.run.ts`.
- `CandidateFixtureProduct` / `CandidateFixtureSession` behavior. Re-exporting is allowed; refactoring them onto the production class is a follow-up.
- Any migration, D1 schema, `Dockerfile` or runner change.
- **Running `pnpm deploy` / `alchemy deploy`, or creating any hosted resource.** Hosted is a separate approval.

## Git workflow

- Work on a branch from `feat/pi-durable` (e.g. `advisor/034-candidate-deployment-wiring`). Do not push, open a PR or merge.
- Commit per step, conventional with scope, e.g. `feat(runtime): add candidate executor teardown`, `feat(web): add candidate private product entrypoint`, `build: wire candidate runtime behind local flag`. No agent co-author trailer.

## Steps

### Step 0: Baseline

Run `pnpm typecheck`, `pnpm --filter @ditto/runtime typecheck`, `pnpm --filter @ditto/credential-tests typecheck`, `pnpm --filter @ditto/credential-tests exec vitest run src/candidate-preview.worker.test.ts` and `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts`.

**Verify**: all exit 0, and the preview test reports at least 1 passed. Record the passed count of `product-commands.worker.test.ts`; Step 6 compares against it. If the baseline fails, STOP.

### Step 0b: Move the scope parser into contracts

1. Create `packages/runtime-contracts/src/candidate-scope.ts` holding `CandidateRuntimeScope` and `parseCandidateRuntimeScope`, moved verbatim from `pi-durable-product-session.ts:52-74`. Import `literalField`, `strictRecord` and `stringField` from `./json.js`, as `workspace-action.ts` imports its helpers.
2. In `pi-durable-product-session.ts`, delete the two definitions and add `export { type CandidateRuntimeScope, parseCandidateRuntimeScope } from "../../../packages/runtime-contracts/src/candidate-scope.js";`, plus an `import` of the same names for the file's own use. Drop `literalField`/`strictRecord`/`stringField` from its `json.js` import only if nothing else in the file uses them (`grep -n "strictRecord\|literalField\|stringField" apps/runtime/src/pi-durable-product-session.ts`). Other importers stay unchanged.
3. Create `packages/runtime-contracts/src/candidate-scope.test.ts`, modeled on `workspace-action.test.ts`. Write one `it` that accepts a valid scope and rejects: an extra key, `version: 1`, `ownerVersion: 2` and a missing `workspaceSessionId`.

**Verify**: `pnpm contracts:verify` → exit 0, and the new test is counted. `pnpm --filter @ditto/runtime typecheck` → 0. `pnpm --filter @ditto/credential-tests typecheck` → 0.

### Step 1: Runtime executor teardown

In `pi-durable-product-session.ts`:
1. Next to `revokePreview`, add the hook:
   ```ts
   /** Deployment composition destroys the session's sandbox; none has no termination evidence. */
   protected async destroyExecutor(_scope: CandidateRuntimeScope): Promise<boolean> {
   	return false;
   }
   ```
2. After `purgeDeleted`, add a public method:
   ```ts
   /** Destroys this session's executor once its archive or project deletion is authoritative. */
   async terminateExecutor(value: unknown): Promise<{ terminated: boolean }> {
   	const scope = await this.passiveScope(value);
   	if (
   		!(await this.env.CandidateProduct.readDeletionAuthority(scope)) &&
   		!(await this.env.CandidateProduct.readArchivedAuthority(scope))
   	)
   		throw new Error("Candidate authority denied");
   	await this.host?.yield().catch(() => undefined);
   	await this.host?.awaitClosure().catch(() => undefined);
   	this.host = undefined;
   	return { terminated: await this.destroyExecutor(scope) };
   }
   ```
   The default `false` keeps the execution slot held. A composition with no sandbox has no evidence to offer, and the lifecycle retries (`candidate-lifecycle.ts:424-428`).

In `pi-durable-execution-session.ts`, override:
```ts
protected override async destroyExecutor(scope: CandidateRuntimeScope) {
	const { CandidateSandbox } = this.env;
	if (!CandidateSandbox) return false;
	try {
		await getSandbox(CandidateSandbox, candidateSandboxName(scope.workspaceSessionId), { transport: "rpc" }).destroy();
		return true;
	} catch {
		return false;
	}
}
```
`destroy()` resolving is the same termination evidence the local fixture uses (`apps/runtime/src/pi-durable-local.ts:269`). Do **not** copy `revokePreview`'s `as ExecutionSandbox` cast: `ExecutionSandbox` has no `destroy`, while the uncast `getSandbox` return (the SDK `Sandbox` class, 0.12.3) does.

**Verify**: `pnpm --filter @ditto/runtime typecheck` → exit 0.

### Step 2: Widen the lifecycle teardown input

In `apps/web/src/lib/candidate-lifecycle.ts`:
- Change `terminateExecutor(identity: { identityId; incarnationId; sandboxId })` (`:29-33`) to also carry `workspaceSessionId: string; userId: string; projectId: string`.
- In `teardownExecutor` (`:396-440`), add `projectId` to the SELECT column list **and** `projectId: string` to the `.all<{ … }>()` row type (`:402-408`). Then pass `workspaceSessionId: sessionId, userId: identity.userId, projectId: identity.projectId` in the call at `:424`.

The fixture's `terminateExecutor: async (identity) => …` (`model-entry.ts:1251-1254`) ignores the extra fields, and so does `fakeLifecycleRuntime` in `product-commands.worker.test.ts`. Step 6 adds the test that proves the fields arrive.

**Verify**: `pnpm typecheck` → 0. `pnpm --filter @ditto/credential-tests typecheck` → 0. `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t "termination evidence"` → 2 passed (`:3136` and `:3718`).

### Step 3: Production product module

Create `apps/web/src/lib/candidate-product.ts`. It contains:

1. `export type CandidateProductBindings = { DB: D1Database; CodexCredential: DurableObjectNamespace<CodexCredential>; CandidateSessions: DurableObjectNamespace; BETTER_AUTH_SECRET: string } & GitHubAppCredentials`, in the same style as `ModelProductBindings`.
2. `interface CandidateSessionRpc`: the session methods the product calls: `readSelection`, `targetStatus`, `observe`, `observeHistory`, `workspaceAction` (signatures from `CandidateAdmissionRuntime`, `session-command-candidate.ts:70-99`), plus `deliverCommand(commandId: string, ownerVersion: number): Promise<unknown>`, `exportContinuation(scope: unknown): Promise<unknown>`, `importContinuation(scope: unknown, seed: unknown): Promise<unknown>`, `purgeDeleted(scope: unknown): Promise<void>` and `terminateExecutor(scope: unknown): Promise<{ terminated: boolean }>`. Add one accessor with the module's only cast:
   ```ts
   // Typed structurally: web cannot import the runtime class; credential-tests checks conformance.
   function session(env: CandidateProductBindings, id: string) {
   	return env.CandidateSessions.getByName(id) as unknown as CandidateSessionRpc;
   }
   ```
3. Private builders `commands(env)` and `lifecycle(env)`, ported from the fixture's `commands()` and `lifecycle()` with `CodexCredential` for the credential. `terminateExecutor: (identity) => session(env, identity.workspaceSessionId).terminateExecutor({ version: 2, ownerVersion: 1, userId: identity.userId, projectId: identity.projectId, workspaceSessionId: identity.workspaceSessionId })`. `purgeSession`, `exportContinuation` and `importContinuation` build the same scope object and call the session.
4. `export function createCandidateProductCommandService(env: Omit<CandidateProductBindings, "CandidateSessions"> & { CandidateSessions?: DurableObjectNamespace }): CandidateProductCommandService | undefined`. All other bindings are always present on the website, so only `CandidateSessions` is optional. It returns `undefined` unless `env.CandidateSessions` is set. Otherwise it narrows with `const bound = { ...env, CandidateSessions: env.CandidateSessions }` and returns the six members, delegating as the fixture does (`admitOwned` → `commands().admit`, `observeOwned` → `commands().observe`, `workspaceActionOwned` → `commands().workspaceAction`, `modelsOwned` → `commands().models`, `deleteProjectOwned` → `lifecycle().deleteProject`, `drain` → `commands().drain(...)` with `deliverCommand`).
5. `export class CandidatePrivateProduct extends WorkerEntrypoint<CandidateProductBindings>`, with exactly the methods in the method table under "Product side" in Current state. Type its scope parameters as `CandidateRuntimeScope` and parse each with `parseCandidateRuntimeScope`, both imported from `../../../../packages/runtime-contracts/src/candidate-scope.js` (Step 0b). That is the same relative depth as the existing `session-runtime-client.ts:198` import of `product-command.js`.

Import `WorkerEntrypoint` from `"cloudflare:workers"` as `session-runtime-product.ts` does.

**Verify**:
- `pnpm typecheck` → 0.
- `grep -nw "true" apps/web/src/lib/candidate-product.ts` → no matches. Biome puts each argument on its own line, so a pattern like `, true)` would pass even when `true` is passed. If some other legitimate `true` is needed, STOP and report it instead of loosening the check.
- `grep -c "performPrivateModelRequest\|readPrivateModelPermit\|readOwnedConfigurationAuthority" apps/web/src/lib/candidate-product.ts` → `3` call sites, plus their imports.
- `grep -c "CandidateSandbox" apps/web/src/lib/candidate-product.ts` → `0`.

### Step 4: Product Worker uses the module

In `apps/web/src/server.ts`:
- Add `export { CandidatePrivateProduct } from "#/lib/candidate-product";` next to the existing `export { ProductEntrypoint } …`.
- In `fetch` and `scheduled`, resolve `const candidateCommands = env.PI_DURABLE_PRODUCT_COMMANDS ?? createCandidateProductCommandService(env);` and use it where `env.PI_DURABLE_PRODUCT_COMMANDS` is used now. The env field stays as the existing test injection seam (`server.test.ts:283,373`).

In `apps/web/types/env.d.ts`, add `CandidateSessions?: DurableObjectNamespace` to the intersection, with a one-line comment like the `CANDIDATE_PREVIEW` one.

In `apps/web/src/server.test.ts`, under `describe("candidate entrypoint composition", …)`, add two tests modeled on the one at `:268-299`:
- With neither `PI_DURABLE_PRODUCT_COMMANDS` nor `CandidateSessions`, `resolveCandidateProductCommands()` is `undefined` inside the handler.
- With `CandidateSessions: {}` (a stub) and no `PI_DURABLE_PRODUCT_COMMANDS`, it is defined and has a `drain` function.

Do not add a `scheduled` test with the stub: `drain()` would query D1 through it. The existing scheduled tests pass `env = { Sandbox: {} }` with no `CandidateSessions`, so they still take the no-candidate path.

**Verify**: `pnpm --filter @ditto/web exec vitest run src/server.test.ts` → all pass, including the 2 new tests. `pnpm typecheck` → 0.

### Step 5: Runtime Worker entry

Create `apps/runtime/src/pi-durable-candidate-entry.ts`:

```ts
import { ContainerProxy } from "@cloudflare/sandbox";
import { WorkerEntrypoint } from "cloudflare:workers";
import { type ExecutionSessionBindings, PiDurableCandidateSandbox, PiDurableExecutionSession } from "./pi-durable-execution-session.ts";
import { candidatePreviewFetch, candidatePreviewProxy } from "./pi-durable-preview-fetch.ts";

export { ContainerProxy, PiDurableCandidateSandbox, PiDurableExecutionSession };

/** Product-only preview hop; the runtime has no public origin. */
export class CandidatePreview extends WorkerEntrypoint<ExecutionSessionBindings> {
	fetch(request: Request) {
		const { CandidateSandbox, CandidateSessions } = this.env;
		if (!CandidateSandbox) return new Response("Not Found", { status: 404 });
		return candidatePreviewFetch(request, {
			session: (id) => CandidateSessions.getByName(id),
			proxy: candidatePreviewProxy({ CandidateSandbox }),
		});
	}
}

export default { fetch: () => new Response("Not Found", { status: 404 }) };
```

Adjust only what typecheck requires, e.g. the `getByName` return type against `previewAdmit`. If `ContainerProxy` is not exported by `@cloudflare/sandbox` 0.12.3 the way `apps/web/src/server.ts:3` imports it, STOP.

**Verify**: `pnpm --filter @ditto/runtime typecheck` → 0. `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-preview-fetch.test.ts` → passes.

### Step 6: Conformance and production-entrypoint tests (credential-tests)

The runtime tests go in `product-commands.worker.test.ts`, which already has the migration imports (`:7-34`), the `beforeEach` seeding (`:158`) and the helpers they need: `candidateCredential()` (`:71`), `modelReplies()` (`:84`), `prompt` (`:133`). Do not create a new worker-test file; it would have to copy all of that.

1. In `apps/credential-tests/src/model-entry.ts`, add `export { CandidatePrivateProduct } from "../../web/src/lib/candidate-product";`.
2. In `apps/credential-tests/vitest.config.ts`, add a service binding `ProductionCandidateProduct: { name: currentWorker, entrypoint: "CandidatePrivateProduct" }` next to `CandidateProduct`, and add `BETTER_AUTH_SECRET: "synthetic-034-auth-secret"` to `bindings`. The existing `DB`, `CodexCredential` and `CandidateSessions` bindings satisfy the rest. GitHub bindings are absent, so these tests must not call the branch-fetch methods.
3. In `product-commands.worker.test.ts`, add one line to the existing `declare module "cloudflare:test"` block (`:56-62`): `ProductionCandidateProduct: Service<import("../../web/src/lib/candidate-product").CandidatePrivateProduct>;`. Do not redeclare it in any other file; a redeclaration must have an identical type or TS errors.
4. Append these `it` blocks to the end of `product-commands.worker.test.ts`. Each starts with `await candidateCredential(); modelReplies();`, as the deletion test at `:4037` does.
   - **Models stay unavailable**: `await env.ProductionCandidateProduct.requestModel({}, { describe: async () => { throw new Error("unused"); }, claim: async () => ({ status: "denied" as const }), halt: async () => ({ status: "denied" as const }) })` → `{ version: 1, status: "unavailable" }`. Also `readModelPermit({}, {} as never)` → `{ status: "denied" }`.
   - **Runtime authority parity**: `const first = await env.CandidateProduct.admitOwned("owner", prompt)`. Build `scope = { version: 2, ownerVersion: 1, userId: "owner", projectId: "project", workspaceSessionId: first.workspaceSessionId }`. `ProductionCandidateProduct.readRuntimeAuthority(scope)` deep-equals `CandidateProduct.readRuntimeAuthority(scope)`.
   - **Teardown input**: after admitting as above, `new CandidateLifecycle(env.DB, runtime, Date.now, () => crypto.randomUUID())`, where `runtime` is a local `CandidateLifecycleRuntime` (both names are already imported, `:35-38`). Its `terminateExecutor` pushes its argument to an array and returns `{ terminated: true }`, `purgeSession` resolves, and the two continuation methods throw. Call `deleteProject("owner", "project")` in process (refusals and calls are asserted in process; see the comment at `:4066`). Expect the array to contain one object with `workspaceSessionId: first.workspaceSessionId`, `userId: "owner"`, `projectId: "project"`.
   - **Executor teardown is fenced**: admit as above, but **do not drain**, so the session DO never opens a host. `runtime = env.CandidateSessions.getByName(first.workspaceSessionId)`. (a) `await runInDurableObject(runtime, async (instance) => { await expect(instance.terminateExecutor(scope)).rejects.toThrow("Candidate authority denied"); })`. Assert rejections in process like this, never over RPC: a rejected RPC is reported as unhandled and fails the run. (b) `await env.CandidateProduct.setExecutorFixture({ terminates: true, purgeFault: true })`, then `await env.CandidateProduct.deleteProjectOwned("owner", "project")` → `{ status: "deleting" }`. `purgeFault` makes inline cleanup fail before it deletes the `projects` row (`candidate-lifecycle.ts:328-333,526`), so the project stays fenced. (c) `await runtime.terminateExecutor(scope)` → `{ terminated: false }`, since the fixture session class has no sandbox hook. Finally, reset with `await env.CandidateProduct.setExecutorFixture({ terminates: true })`.
5. Create `apps/credential-tests/src/candidate-production-product.type-test.ts` (compile-time only; `vitest.config.ts` includes only `*.worker.test.ts`, and credential-tests typecheck includes `src/**/*.ts`). Define `type AssertTrue<T extends true> = T`, as `apps/runtime/src/forbidden-bindings.type-test.ts` does. Then:
   - `export type ProductConforms = AssertTrue<InstanceType<typeof CandidatePrivateProduct> extends CandidatePrivateProductPort ? true : never>`. Import the interface as `import type { CandidatePrivateProduct as CandidatePrivateProductPort } from "../../runtime/src/pi-durable-product-session.ts"`.
   - `export type SessionConforms = AssertTrue<InstanceType<typeof PiDurableExecutionSession> extends CandidateSessionRpc ? true : never>`. Export `CandidateSessionRpc` from `candidate-product.ts` for this.
   - Parameter types are checked bivariantly, so a failure here means a return type or an arity differs. That is a real contract mismatch: STOP and report the method. Do not widen either side to `unknown` to make it pass.
6. In root `package.json`, append `src/candidate-preview.worker.test.ts` to the `credentials:verify` vitest file list. That test was added by 032 but is missing from the list today, so CI never runs it.

**Verify**:
- `pnpm --filter @ditto/credential-tests typecheck` → 0.
- `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts` → all pass, with the count 4 higher than in Step 0's run of this file. Record both counts.
- `pnpm --filter @ditto/credential-tests exec vitest run src/candidate-preview.worker.test.ts` → passes.

### Step 7: Alchemy wiring, opt-in and local only

In `alchemy.run.ts`, inside `createWebsite()`:

1. Near the top:
   ```ts
   const candidateRuntime = process.env.DITTO_CANDIDATE_RUNTIME === "1";
   if (candidateRuntime && !app.local)
   	throw new Error("Candidate runtime wiring is local-only until a hosted stage is approved.");
   if (candidateRuntime && !process.env.CANDIDATE_RUNTIME_KEYS)
   	throw new Error("DITTO_CANDIDATE_RUNTIME=1 requires CANDIDATE_RUNTIME_KEYS.");
   ```
2. After `sandboxBackups` and **before** `TanStackStart`, add exactly this shape. The names `websiteName` and `candidate` are used by items 3–5:
   ```ts
   const websiteName = `${app.name}-website-${app.stage}`;
   const candidate = candidateRuntime
   	? await Worker("candidate-runtime", {
   			name: `${app.name}-candidate-runtime-${app.stage}`,
   			entrypoint: "apps/runtime/src/pi-durable-candidate-entry.ts",
   			compatibilityDate: "2026-03-10",
   			compatibilityFlags: ["nodejs_compat"],
   			url: false,
   			bindings: {
   				CandidateSessions: DurableObjectNamespace("candidate-sessions", { className: "PiDurableExecutionSession", sqlite: true }),
   				CandidateSandbox: await Container("candidate-sandbox", { className: "PiDurableCandidateSandbox", build: { context: ".", dockerfile: "Dockerfile" }, instanceType: "basic", maxInstances: 20 }),
   				CANDIDATE_RECOVERY: sandboxBackups,
   				CandidateProduct: Worker.experimentalEntrypoint(WorkerRef({ service: websiteName }), "CandidatePrivateProduct"),
   				CANDIDATE_DISPOSABLE: "008-synthetic",
   				CANDIDATE_RUNTIME_KEYS: alchemy.secret(process.env.CANDIDATE_RUNTIME_KEYS),
   				...(process.env.CANDIDATE_PREVIEW_HOST ? { CANDIDATE_PREVIEW_HOST: process.env.CANDIDATE_PREVIEW_HOST } : {}),
   			},
   		})
   	: undefined;
   ```
   The runtime goes first because the product Worker holds a cross-script DO binding to it, and the target script must exist before that binding can be uploaded. The runtime's reference back to the product goes through `WorkerRef` by name. Alchemy emits a DO migration only when `scriptName` is absent or names the same Worker (`node_modules/alchemy/lib/cloudflare/worker-metadata.js:245-247,402-404`), so the runtime gets the `PiDurableExecutionSession` SQLite migration and the website gets none.
3. In the `TanStackStart` `bindings`, spread `...(candidate ? { CandidateSessions: DurableObjectNamespace("candidate-sessions-ref", { className: "PiDurableExecutionSession", scriptName: candidate.name }), CANDIDATE_PREVIEW: Worker.experimentalEntrypoint(candidate, "CandidatePreview") } : {})`.
4. In the `wrangler.transform`, when `candidate` is set, append `{ class_name: "PiDurableExecutionSession", name: "CandidateSessions", script_name: candidate.name }` to the literal `durable_objects.bindings` list. Do not add a `migrations` entry: cross-script bindings need none.
5. After `TanStackStart`, `if (candidate && website.name !== websiteName) throw new Error(...)`, so a name drift fails loudly instead of binding a missing service.

Keep the legacy bindings and the `Route` unchanged. With the flag unset, the bindings and transform output must be the same as before. Use conditional spreads, not new default values.

**Verify**:
- `pnpm typecheck` → 0. `env.d.ts` infers from this file. If the inferred `website.Env` now conflicts with the `env.d.ts` declarations of `CANDIDATE_PREVIEW` or `CandidateSessions`, remove the now-redundant `env.d.ts` line rather than adding `any`. If neither way compiles, STOP.
- `pnpm check` → 0.
- `grep -n "CandidateSandbox" alchemy.run.ts` → exactly 1 line, inside the `Worker("candidate-runtime"` call.
- `git diff alchemy.run.ts` → every added line in `createWebsite()` is either inside a `candidateRuntime`/`candidate` conditional or one of the item 1 guards. No existing line is deleted or changed except where the bindings object and the transform's DO list gain a conditional spread. The executor cannot run Alchemy, so this read of the diff is the executor-side check. Step 10.1 is the runtime proof that the flag-off output is unchanged.

### Step 8: README environment section

In `README.md`'s environment-variable list (the section starting "Set these in a root `.env.local`…", around `:80`), add three entries without values:
- `DITTO_CANDIDATE_RUNTIME`: set to `1` to wire the candidate runtime locally. Refused on hosted stages.
- `CANDIDATE_RUNTIME_KEYS`: required with the flag. JSON `{"currentVersion":"v1","keys":{"v1":"<64 hex>"}}`; generate the hex with `openssl rand -hex 32`.
- `CANDIDATE_PREVIEW_HOST`: optional, e.g. `localhost:<vite port>`. Unset keeps candidate preview unavailable.

**Verify**: `pnpm check` → 0.

### Step 9: Full gate

Run `pnpm verify`.

**Verify**: exit 0. If only `credentials:verify` fails on the combined run with a storage error, rerun each listed file alone and record both results (known WSL flake, plans 021/022).

### Step 10: Local smoke (maintainer-run; the executor records `not run` unless told otherwise)

It needs the maintainer's `.env.local`, Docker and a browser sign-in, none of which an executor worktree has.

1. **Flag off is unchanged.** Before checking out the 034 commits, run `pnpm dev` once on the base and copy `apps/web/.alchemy/local/wrangler.jsonc` to a scratch file. Then, on the 034 commits with `DITTO_CANDIDATE_RUNTIME` unset, run `pnpm dev` again and stop it. `diff <scratch copy> apps/web/.alchemy/local/wrangler.jsonc` → no output, and `grep -c CandidateSessions apps/web/.alchemy/local/wrangler.jsonc` → `0`.
2. Set `DITTO_CANDIDATE_RUNTIME=1`, `CANDIDATE_RUNTIME_KEYS` and `CANDIDATE_PREVIEW_HOST=localhost:<vite port>`, then run `pnpm dev`. Expect both Workers to start. `grep -n "CandidateSessions\|CandidatePreview" apps/web/.alchemy/local/wrangler.jsonc` shows the DO binding with `script_name` and the service binding.
3. `curl -s -o /dev/null -w '%{http_code}\n' -H "Host: 10000-c-00000000-0000-4000-8000-000000000000-abc.localhost:<vite port>" "http://localhost:<vite port>/"` → `404`. The `Host` header avoids depending on `*.localhost` DNS. With the flag set, `env.CANDIDATE_PREVIEW` is bound. A `500`/`503` means the binding did not resolve across the Vite and Alchemy processes, which is a STOP. A `404` means the request reached the runtime's `CandidatePreview` and `previewAdmit` refused a cold session.
4. Record the results in `plans/evidence/034-deployment-wiring.md`.

Product-to-runtime DO calls (models, observe) and a real baseline need a seeded `codex_fixture_capabilities` row and a measured project seed. That is 019's acceptance, not this plan's.

## Test plan

- `packages/runtime-contracts/src/candidate-scope.test.ts` (new, 1 test): the moved parser accepts a valid scope and rejects an extra key, a wrong version or owner version, and a missing field.
- `apps/credential-tests/src/product-commands.worker.test.ts` (+4): models and permit unavailable; runtime authority parity with the fixture; teardown receives `workspaceSessionId`, `userId` and `projectId`; executor teardown refused until fenced, then `terminated:false` without a sandbox.
- `apps/credential-tests/src/candidate-production-product.type-test.ts` (new, 2 compile-time checks): `CandidatePrivateProduct` conforms to the runtime interface, and `PiDurableExecutionSession` conforms to `CandidateSessionRpc`.
- `apps/web/src/server.test.ts` (+2): the service is absent without `CandidateSessions` and present with it.
- Existing: the two `termination evidence` tests in `product-commands.worker.test.ts`, `candidate-preview.worker.test.ts` (now in `credentials:verify`), `pi-durable-preview-fetch.test.ts`.
- Not covered by automated tests: `PiDurableExecutionSession.destroyExecutor` against a real sandbox, and binding resolution across Workers. Step 10 and 019 cover them.

## Done criteria

- [ ] `pnpm verify` exits 0 (or the documented per-file `credentials:verify` rerun passes)
- [ ] `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts` → 0 failed, passed count 4 higher than in Step 0
- [ ] `pnpm contracts:verify` → exit 0, including `candidate-scope.test.ts`
- [ ] `grep -n "candidate-preview.worker.test.ts" package.json` → present in `credentials:verify`
- [ ] `grep -rn "parseCandidateRuntimeScope" apps/web/src` → imports only from `packages/runtime-contracts/src/candidate-scope.js`
- [ ] `grep -nw "true" apps/web/src/lib/candidate-product.ts` → no matches
- [ ] `grep -rn "CandidateSandbox" apps/web/src` → no matches
- [ ] `grep -n "008-synthetic\|fixture-pi-durable-execution-v1" apps/web/src/lib/candidate-product.ts` → no matches (the gates stay where they are)
- [ ] `grep -n "DITTO_CANDIDATE_RUNTIME" alchemy.run.ts` → present, together with the `!app.local` refusal
- [ ] `git status --porcelain` lists only in-scope files
- [ ] `plans/evidence/034-deployment-wiring.md` exists with `passed`/`failed`/`not run` for steps 9 and 10
- [ ] `plans/README.md` 034 row updated

## STOP conditions

- An excerpt in "Current state" does not match the live code.
- Alchemy rejects `scriptName` on `DurableObjectNamespace`, `url: false` on `Worker`, or `experimentalEntrypoint(WorkerRef, …)` inside a `TanStackStart`/`Worker` binding.
- Typecheck can only pass with `any`, or by importing `pi-durable-product-session.ts` into `apps/web`.
- Any step seems to need lifting the disposable gate, changing `fixtureAvailable`, adding a `CandidateSandbox` binding to the website, or changing a migration, schema or `Dockerfile`.
- A conformance check in `candidate-production-product.type-test.ts` fails. Because parameters are checked bivariantly, that means a return type or arity differs. Report the method and both types; do not change the runtime interface or widen either side.
- Step 6's teardown test sees `deleteProjectOwned` return `{ status: "deleted" }`, or `terminateExecutor` reject after the fence. Either means the fence did not survive inline cleanup.
- `readRuntimeAuthority` parity fails. The production entrypoint must not diverge from the fixture's non-reset path.
- Step 10 returns 500/503 (cross-process binding did not resolve). Report the exact log line.
- Anything prompts for, or would run, `alchemy deploy` against a non-local stage.

## Maintenance notes

- **No model work through this composition.** All three model helpers get `false`, so a candidate prompt on the wired stack is admitted and delivered but cannot configure or call a model. 019 can exercise baseline, Git, preview, archive and deletion here, but a prompt that reaches a model needs plan 020 or an explicit maintainer decision about a local fixture model path.
- **Hosted deployment** is a separate plan with a named stage and explicit approval. It must remove the `!app.local` refusal, decide whether `CANDIDATE_DISPOSABLE` belongs on a hosted stage, and check that the first upload order works on Cloudflare: the runtime's service binding to a website entrypoint that does not exist yet, and the website's cross-script DO binding. Production model requests stay unavailable until 020.
- **Model capacity**: production `CodexCredential.modelCapacity()` returns `undefined`. Before anyone turns `fixtureAvailable` on for candidate sessions, compose `CandidateCapacity` there, as `CandidateFixtureCredential.modelCapacity` does (`apps/credential-tests/src/entry.ts:215-222`).
- **Restore and archive admission**: `restoreAvailable`/`archiveAvailable` stay unset, so the product refuses restore and archive commands for production candidate sessions. Setting them is a product decision for 019, once restore and archive are exercised against a real sandbox.
- **Fixture duplication**: `CandidateFixtureProduct` now parallels `CandidatePrivateProduct`. A later refactor can make the fixture extend the production class and override only the reset, fault and authority hooks. Until then, a change to one must be mirrored in the other. The parity test guards `readRuntimeAuthority` only.
- **Executor teardown semantics**: `terminateExecutor` closes the host before destroying the sandbox and trusts `destroy()` resolving as evidence. If container runs show `destroy()` can resolve while processes survive, `destroyExecutor` must poll for absence instead, as 024 A4 does for preview stop.
- **Shared bucket**: runtime keys use the `workspace/` and `context/` prefixes, product keys use `<ownerKind>/`. Anything that adds a prefix-based delete on either side breaks the sharing argument.
- Reviewers should check: no `userId`-taking method on `CandidatePrivateProduct`; `false` passed to all three helpers (model request, permit, configuration); the flag-off Alchemy graph unchanged; no `CandidateSandbox` in `apps/web`.
