# 021: Expose candidate session contracts to the product

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in "STOP conditions" occurs, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `git diff --stat bc10998..HEAD -- apps/web/src apps/runtime/src apps/credential-tests/src packages/runtime-contracts/src`
> If any in-scope file changed, compare the "Current state" excerpts against live code. A mismatch is a STOP condition.

## Status

- **Status**: DONE with one limit, reviewed 2026-10-23. Step 5 STOPPED: `PiDurableHost.configureOwned` needs `dependencies.configuration`, which only `configureCandidate(commandId)` provides for a stored prompt/follow-up, so `configureOwned` is deliberately absent from the service interface. Changes are uncommitted in `/home/ayan/ditto-execution/plan-021`.
- **Priority**: P1 (critical path: 018 is blocked on it)
- **Effort**: L
- **Risk**: MED (new product routes over an existing, fixture-accepted backend; one runtime contract addition)
- **Depends on**: 017 (DONE). Unblocks 018.
- **Category**: direction (L5 product completion)
- **Planned at**: commit `bc10998`, 2026-10-23
- **Spec**: `docs/specs/pi-durable-session-runtime.md` decisions 3.1, 3.5, 6 (lines ~378–384), 12 (lines ~641–645), 14, 15

## Why this matters

Plan 018 wires the approved UI (layout option A) to durable contracts. Its executor stopped because the web app cannot reach those contracts. Plans 008–017 built and tested the candidate (`pi_durable_v1`) backend, but only through the credential-test fixture `CandidateFixtureProduct`. The web Worker's typed service binding exposes only `admitOwned` and `drain`. This plan exposes the owned operations the UI needs: observation, workspace actions, model discovery, configuration, archive and restore state, and candidate project deletion. It exposes them through product routes. It adds no UI.

## Current state

The web Worker gets an optional service binding; in the product today nothing provides it, only the fixture does.

`apps/web/types/env.d.ts:7`:
```ts
PI_DURABLE_PRODUCT_COMMANDS?: import("../src/lib/session-runtime-client").CandidateProductCommandService
```

`apps/web/src/lib/session-runtime-client.ts:193`:
```ts
export interface CandidateProductCommandService {
	admitOwned(userId: string, body: unknown): Promise<ReceiptV2>;
	drain(): Promise<void>;
}
```
`apps/web/src/server.ts:160` puts it into request scope (`withSessionRuntimeResolution({ candidateCommands: env.PI_DURABLE_PRODUCT_COMMANDS }, ...)`); routes read it with `resolveCandidateProductCommands()`.

The fixture already implements more owned methods, in `apps/credential-tests/src/model-entry.ts` (class `CandidateFixtureProduct`, ~line 711):
```ts
continueOwned(userId, input)            // lifecycle().continueArchived
deleteProjectOwned(userId, projectId)   // lifecycle().deleteProject
observeOwned(userId, projectId, sessionId, cursor?)  // commands().observe
workspaceActionOwned(userId, input)     // commands().workspaceAction
admitOwned(userId, input)
drain()
```
They delegate to `CandidateProductCommands` (`apps/web/src/lib/session-command-candidate.ts`, `observe` ~line 1443, `workspaceAction` ~line 1418) and `CandidateLifecycle` (`apps/web/src/lib/candidate-lifecycle.ts`, `deleteProject` ~line 268).

The existing candidate route handler is the pattern to copy. `apps/web/src/lib/session-command.ts:1364`:
```ts
export async function handleCandidateCommandRequest(options: {
	service: CandidateProductCommandService | undefined;
	authenticatedUserId: string;
	body: unknown;
}): Promise<{ status: number; body: unknown }> {
	if (!options.service)
		return { status: 400, body: { code: "candidate_admission_ineligible" } };
	try {
		return { status: 202, body: await options.service.admitOwned(options.authenticatedUserId, options.body) };
	} catch (error) {
		// CandidateCommandError -> {status, {code}}; ContractParseError -> 400; else 503 runtime_unavailable
	}
}
```
Its route caller is `apps/web/src/routes/api.agent.control.ts` (auth via `createAuth(env).api.getSession`, bounded body via `readBoundedAgentRequestText`, `jsonResponse`). Tests: `apps/web/src/routes/api.agent.control.test.ts`, `apps/web/src/lib/session-command.test.ts`.

Facts the UI needs, and where they are today:

| Need | Where it is now |
|---|---|
| Observation (snapshot + events + cursor) | `CandidateProductCommands.observe` returns `RuntimeObservationV1` (`packages/runtime-contracts/src/projection.ts:203`). Its `ObservationSnapshotV1` has `runs`, `assistants[].reason` (includes `"checkpoint_restored"`, `"session_archived"`), `health.projectionLag`, `health.safetyStopped`, `health.recovery?.status` (`none/healthy/degraded/blocked`). No archive state. |
| Blocked archive | Host-only. `apps/runtime/src/pi-durable-host.ts:653` table `host_archives.state IN ('fenced','retired','final','complete','blocked')`; set to blocked ~line 5343. D1 `candidate_archives.state` is only `closed|complete` (`apps/web/src/db/schema.ts:947`). |
| Restore loss time / uncertainty | D1 `candidate_restore_barriers` (schema ~923: `state closed|complete|refused`, `restoredPairId`, `completedAt`) and `runtime_checkpoint_pairs` (schema ~817: `createdAt`, `outstandingEffectCount`). Not exposed. |
| Account models + thinking | `SyntheticAccountV1` (`packages/runtime-contracts/src/model.ts:97`: `status`, `models: {id, thinking[]}[]`), read from fixture table `codex_fixture_capabilities` inside `CandidateProductCommands.subject` (~line 300). `ProductEntrypoint.discoverModels` in `apps/web/src/lib/session-runtime-product.ts` always returns `unavailable`. |
| Current selection | `PiDurableProductSession.readSelection(subject)` (`apps/runtime/src/pi-durable-product-session.ts:348`) → host `readCandidateSelection`. |
| Configuration intent | Contract `ConfigurationIntentV1` (`packages/runtime-contracts/src/configuration.ts`). Host has `configureCandidate(commandId, input)` (`pi-durable-host.ts:5637`), which is bound to a prompt/follow-up command, and `configureOwned(input)`. No product session DO method accepts a standalone intent. |
| Session runtime kind | `projects.list` (`apps/web/src/integrations/trpc/routers/projects.ts:334`) already returns full active `workspace_sessions` rows, so `runtimeOwner` reaches the browser for active sessions. It does not cover archived sessions or a per-project flag. |
| Candidate project deletion | `projects.deleteProject` (`routers/projects.ts:293`) calls legacy `deleteProjectRuntime`, which refuses candidate projects with `runtime_owner_mismatch`. |

Conventions: tabs; TypeScript `unknown` until parsed; contract parsers live in `packages/runtime-contracts/src/*.ts` beside a `*.test.ts`; product errors are stable codes, never exception text (spec 3.5). Comment only for non-obvious constraints. Observations must never include archive references, crypto metadata, pair IDs or executor authority (spec 3.5, 14).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Web typecheck | `pnpm typecheck` | exit 0 |
| Web test (one file) | `pnpm --filter @ditto/web exec vitest run <path-under-apps/web>` | pass |
| Contracts | `pnpm contracts:verify` | pass |
| Runtime | `pnpm runtime:verify` | pass |
| Credential fixture | `pnpm --filter @ditto/credential-tests typecheck && pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts` | pass (known WSL flake: see STOP) |
| Lint | `pnpm check` | no errors |

## Scope

**In scope**
- `apps/web/src/lib/session-runtime-client.ts` (widen `CandidateProductCommandService`)
- `apps/web/src/lib/session-command.ts` (new owned handlers beside `handleCandidateCommandRequest`)
- `apps/web/src/lib/session-command-candidate.ts` (`models`, `configure`, observation enrichment)
- `apps/web/src/routes/api.agent.observe.ts`, `api.agent.workspace-action.ts`, `api.agent.models.ts`, `api.agent.configure.ts` (create) and their `*.test.ts`
- `apps/web/src/integrations/trpc/routers/projects.ts` (+ `projects.test.ts`): candidate flag and candidate deletion
- `apps/web/src/routeTree.gen.ts` only if the router generator rewrites it during `pnpm build`/dev
- `packages/runtime-contracts/src/projection.ts` (+ test): optional archive and restore fields
- `apps/runtime/src/pi-durable-product-session.ts`, `apps/runtime/src/pi-durable-host.ts`: archive state in observation; standalone configuration (Step 5 gate)
- `apps/credential-tests/src/model-entry.ts`, `apps/credential-tests/src/product-commands.worker.test.ts`: fixture implements the widened interface; behavior tests
- `plans/evidence/021-product-exposure.md` (create)

**Out of scope**
- Any component under `apps/web/src/components` (that is 018).
- `alchemy.run.ts` and any deployment or binding for the real product. The binding stays fixture-only.
- Real Codex discovery (plan 020). Locally, models come only from `codex_fixture_capabilities`.
- Continuation exposure (`continueOwned`): 016 says it is not end to end.
- Legacy and `trusted_v1` paths; do not change their behavior.
- Session-level deletion of a candidate session. None exists; do not invent one.

## Steps

### Step 1: Baseline

Install, run `pnpm typecheck`, `pnpm contracts:verify`, `pnpm runtime:verify` and the credential fixture command. Record results (including any flaky failures by test name) in `plans/evidence/021-product-exposure.md`.

**Verify**: all pass, or failures recorded verbatim before any edit.

### Step 2: Widen the service interface

In `session-runtime-client.ts`, extend `CandidateProductCommandService` with exactly:
```ts
observeOwned(userId: string, projectId: string, sessionId: string, cursor?: number): Promise<RuntimeObservationV1>;
workspaceActionOwned(userId: string, input: unknown): Promise<WorkspaceActionResultV1>;
deleteProjectOwned(userId: string, projectId: string): Promise<{ status: "deleted" | "deleting" }>;
modelsOwned(userId: string, input: unknown): Promise<CandidateModelsV1>;
configureOwned(userId: string, input: unknown): Promise<ConfigurationAckV1>;
```
Define `CandidateModelsV1` in `packages/runtime-contracts/src/configuration.ts` (with a parser and test):
```ts
type CandidateModelsV1 = {
	version: 1;
	status: "available" | "unavailable" | "revoked" | "disconnected";
	models: { id: SyntheticModelId; thinking: SyntheticThinking[] }[];
	selection: ConfigurationSelectionV1 | null;
};
```
Update `CandidateFixtureProduct` so it satisfies the interface (it already has the first three).

**Verify**: `pnpm typecheck`, `pnpm contracts:verify`, and `pnpm --filter @ditto/credential-tests typecheck` pass.

### Step 3: Observation and workspace-action routes

Add `handleCandidateObserveRequest` and `handleCandidateWorkspaceActionRequest` to `session-command.ts`, shaped exactly like `handleCandidateCommandRequest` (same `service` absent → 400 `candidate_admission_ineligible`, same error mapping). Observe success → 200; workspace action → 200 with the `WorkspaceActionResultV1` (a `denied` result is a 200 body, not an HTTP error).

Create `routes/api.agent.observe.ts` (POST body `{ version: 1, projectId, sessionId, cursor? }`; parse it strictly with a new parser in `packages/runtime-contracts/src/projection.ts`) and `routes/api.agent.workspace-action.ts` (POST body passed through as `unknown`; `CandidateProductCommands.workspaceAction` already parses it). Copy the auth, bounded-read and `jsonResponse` structure from `api.agent.control.ts`. The authenticated user ID always comes from the session, never the body.

Tests (model after `api.agent.control.test.ts` and `session-command.test.ts`): unauthenticated → 401; no binding → 400 code; a `CandidateCommandError` maps to its status and code; a stale cursor passes through to the service unchanged; a body `userId` field is rejected by the strict parser.

**Verify**: `pnpm --filter @ditto/web exec vitest run src/routes/api.agent.observe.test.ts src/routes/api.agent.workspace-action.test.ts src/lib/session-command.test.ts` pass.

### Step 4: Account models

Implement `CandidateProductCommands.models(userId, input)`. `input` is `{ version: 1, projectId, sessionId? }`.
- Credential status from the injected `credential(userId).status(userId)`. Anything other than `connected` → `status: "disconnected"` (or `"revoked"` when the credential reports revoked), with `models: []` and `selection: null`.
- Account snapshot from `codex_fixture_capabilities` through `parseSyntheticAccountV1`. Missing → `"unavailable"`.
- `selection`: when `sessionId` is given and owned (`this.subject`), `this.runtime.readSelection(subject)`; otherwise `null`. This read must not schedule work (spec 3.1, "a read must never enable scheduling").
Expose it as `modelsOwned` on the fixture and add route `api.agent.models.ts` with a handler as in Step 3.

Do not add any fixed-catalogue fallback. `agent-models.ts` stays untouched.

Tests in `product-commands.worker.test.ts`: connected + snapshot → models and the remembered selection; disconnected → `disconnected` with no models; snapshot missing → `unavailable`; another user's session → `runtime_owner_mismatch`. Route test as in Step 3.

**Verify**: the credential fixture command and the new route test pass.

### Step 5: Configuration intent (gated)

Spec lines ~641–645: configuration intents are standalone, owner-authenticated, serialized on the runtime owner lane, keyed by `intentId`, and return `ConfigurationAckV1`.

First read `pi-durable-host.ts` `configureOwned` and `configureCandidate` (~5637). **If `configureOwned` cannot run without a prompt/follow-up command's `dependencies.configuration`, STOP for this step and report what it requires.** Do not build a command-less path in the host on your own. Otherwise:
- Add `configure(subject, intent)` to `PiDurableProductSession`, which activates the host like `readSelection` and applies the intent through `configureOwned`.
- Add `CandidateProductCommands.configure(userId, input)`: parse `ConfigurationIntentV1`; derive the subject from the session (never from intent fields); check entitlement with the existing `ModelProductAuthority` / `readOwnedConfigurationAuthority` (`apps/web/src/lib/configuration-product-authority.ts`); forward to the runtime.
- Add `configureOwned` on the fixture and route `api.agent.configure.ts`.

Tests: applied; duplicate `intentId` returns its retained ack; changed payload under the same `intentId` → `conflict`; a model or thinking level the account lacks → `denied`; disconnected → `denied`.

**Verify**: `pnpm runtime:verify` and the credential fixture command pass.

### Step 6: Archive and restore facts in observation

Extend `ObservationSnapshotV1.health` (contract, parser and test) with two optional, product-safe fields:
```ts
archive?: { status: "pending" | "blocked" | "complete" };
restore?: { checkpointAt: number; effectsUncertain: boolean };
```
- `archive`: set by the host's observation from `host_archives.state`: `blocked` → `"blocked"`, `complete` → `"complete"`, `fenced|retired|final` → `"pending"`, no row → absent. Trace where host observation builds `health.recovery` and add it beside that. If the host has no single place that builds the snapshot, STOP and report.
- `restore`: set on the product side in `CandidateProductCommands.observe`, from the latest `candidate_restore_barriers` row for the session with `state='complete'`, joined to `runtime_checkpoint_pairs` on `restoredPairId`: `checkpointAt = pairs.createdAt`, `effectsUncertain = pairs.outstandingEffectCount > 0`. No pair ID, digest or object key in the output.
- Archived sessions are observed through `observeHistory`. Make sure `archive` and `restore` are present there too.

Tests: runtime test for each `host_archives` state mapping (next to the existing observation tests `apps/runtime/src/pi-durable-observation.test.ts`); fixture test that a completed restore yields `checkpointAt` and `effectsUncertain`; a test asserting the observation JSON contains no `pairId`, `archiveDigest` or `continuationObjectKey` substring.

**Verify**: `pnpm contracts:verify`, `pnpm runtime:verify`, and the credential fixture command pass.

### Step 7: Candidate project flag and deletion

In `routers/projects.ts`:
- `list` and `get` each return `hasCandidateSessions: boolean`: true when the project has any `workspace_sessions` row with `runtimeOwner='pi_durable_v1'`, any status.
- `deleteProject`: when the project has candidate sessions **and** `resolveCandidateProductCommands()` is defined, call `service.deleteProjectOwned(ctx.user.id, input.id)` and return its status. When the service is absent, keep today's refusal, but throw `PRECONDITION_FAILED` with the message `"This project has sessions that can't be deleted yet."` so the UI shows it. Leave legacy-only projects on the existing path. If the project mixes legacy and candidate sessions, `CandidateLifecycle` refuses it by design (016); map that refusal to `PRECONDITION_FAILED` with its code.

Tests in `projects.test.ts`: flag true/false; candidate + service → `deleteProjectOwned` called with the session's user; candidate without service → `PRECONDITION_FAILED` and that message; legacy-only unchanged.

**Verify**: `pnpm --filter @ditto/web exec vitest run src/integrations/trpc/routers/projects.test.ts` passes.

### Step 8: Gates and evidence

Run `pnpm check`, `pnpm typecheck`, `pnpm contracts:verify`, `pnpm runtime:verify`, `pnpm credentials:verify`, `pnpm test`, `pnpm build`. Write `plans/evidence/021-product-exposure.md`: the new routes with request and response shapes, the fields added, test names per step, gate results, and any STOP sub-items. These are the contracts 018 will consume.

**Verify**: every gate passes, or a failure is recorded with the test name and shown to fail at the Step 1 baseline too.

## Done criteria

- [ ] `CandidateProductCommandService` declares the five new methods, and `CandidateFixtureProduct` implements them (Step 5's `configureOwned` may be absent only if Step 5 STOPPED)
- [ ] Four new routes exist with tests; none reads a user ID from the body
- [ ] `ObservationSnapshotV1.health` has optional `archive` and `restore`, with parser tests
- [ ] `projects.list`/`get` return `hasCandidateSessions`; candidate deletion goes through `deleteProjectOwned` when the binding is present
- [ ] `git status` shows changes only in in-scope files; `apps/web/src/components` is untouched
- [ ] Gates from Step 8 pass; evidence file written

## STOP conditions

- The drift check shows in-scope changes that don't match the excerpts.
- Step 5's host cannot apply a configuration intent without a command (stop that step only and continue).
- The host has no single place that builds the observation snapshot (stop Step 6's `archive` only).
- Any change seems to need `alchemy.run.ts`, a deployment, a real Codex request, or a UI component.
- `product-commands.worker.test.ts` fails twice in a row on a test this plan added or touched. Failures in untouched tests that also fail at baseline are the known WSL flake recorded in 017; record them and continue.
- Exposing a fact would put archive refs, digests, object keys, pair IDs, crypto data or executor authority in a browser response.

## Maintenance notes

- 018 consumes these routes. Its executor should read `plans/evidence/021-product-exposure.md` first.
- When the real product binding lands (019/020 scope), `PI_DURABLE_PRODUCT_COMMANDS` must provide every method in the widened interface. A missing method is a runtime error, not a type error, because the binding is an RPC stub.
- `codex_fixture_capabilities` is the only model source until 020. Replacing it means changing `models()` and `subject()` together.
- `projects.list` already sends whole session rows, internal columns included. Narrowing that payload is a separate hardening change; don't fold it in here.
