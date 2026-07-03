# Plan 031: Add the Flue Dispatch and Stream Adapter

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report; do
> not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat df4631b..HEAD -- alchemy.run.ts src/lib/project-agent-run-contract.ts src/lib/project-run-projection.ts src/lib/flue-event-projection.ts docs/decisions/2026-07-02-four-layer-flue-integration-spike.md docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> git diff --stat -- alchemy.run.ts src/lib/project-agent-run-contract.ts src/lib/project-run-projection.ts src/lib/flue-event-projection.ts docs/decisions/2026-07-02-four-layer-flue-integration-spike.md docs/four-layer-flue-workflow-rewrite-prd.md plans/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the excerpts
> below against the live code before proceeding. If an excerpt no longer matches
> and the difference is not merely formatting, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/030-flue-event-projection-contract.md`
- **Category**: migration / tests
- **Planned at**: commit `df4631b`, 2026-07-03

## Why this matters

The public TanStack Worker reaches Flue through the private `FLUE_WORKER` service
binding declared in Phase 0/1. Phase 2 needs a small adapter that knows how to
admit a prompt to Flue's generated agent HTTP route and resume the Durable Stream
by offset. Keep this as a pure, injectable fetch adapter so later code can test
dispatch and stream handling without a live Flue Worker, live LLM, or Cloudflare
runtime.

## Current state

Relevant files:

- `alchemy.run.ts` - declares the private Flue Worker and binds it to `website` as `FLUE_WORKER`.
- `src/lib/project-agent-run-contract.ts` - pure admission-before-dispatch contract currently returns a generic `dispatchId` receipt.
- `src/lib/project-run-projection.ts` - D1 projection helper currently requires both `flueAgentInstanceId` and `flueSubmissionId` to consider a Flue pointer present.
- `docs/decisions/2026-07-02-four-layer-flue-integration-spike.md` - records the split Worker topology and the default-session Flue adapter caveat.
- `plans/030-flue-event-projection-contract.md` - prerequisite event mapper plan.

Alchemy already exposes the private Flue Worker service binding:

```ts
// alchemy.run.ts:63-72
export const flueWorker = await Worker("flue-worker", {
	entrypoint: FLUE_WORKER_ENTRYPOINT,
	compatibilityFlags: ["nodejs_compat"],
	bindings: {
		Sandbox: sandbox,
		FLUE_PROJECT_CODER_AGENT: flueProjectCoderAgent,
		FLUE_REGISTRY: flueRegistry,
		ANTHROPIC_API_KEY: alchemy.secret(process.env.ANTHROPIC_API_KEY),
	},
});

// alchemy.run.ts:74-82
export const website = await TanStackStart("website", {
	url: true,
	bindings: {
		DB: database,
		Sandbox: sandbox,
		WorkspaceSessionBroker: workspaceSessionBroker,
		ProjectCoordinator: projectCoordinator,
		FLUE_WORKER: flueWorker,
```

The current project-agent contract receipt is too generic for Flue's HTTP route:

```ts
// src/lib/project-agent-run-contract.ts:28-31
export type ProjectAgentDispatchReceipt = {
	dispatchId: string;
	acceptedAt: string;
};
```

Installed Flue HTTP route docs/types show the generated app exposes direct agent
prompt and stream routes:

```ts
// node_modules/@flue/runtime/dist/flue-app-wbMGNdFj.d.mts:196-209
// - `POST /agents/:name/:id` - send a prompt (202 admission; `?wait=result` for a sync JSON result)
// - `GET/HEAD /agents/:name/:id` - DS event stream read
// Event streams use the Durable Streams protocol (catch-up, long-poll, SSE) and are read-only.
```

Installed response schemas show direct agent admission returns stream coordinates,
not necessarily a public submission id:

```js
// node_modules/@flue/runtime/dist/run-store-BoLOKXLD.mjs:64-72
const AgentAdmissionResponseSchema = v.object({
	streamUrl: v.string(),
	offset: v.string()
});
const AgentInvocationResponseSchema = v.object({
	result: v.unknown(),
	streamUrl: v.string(),
	offset: v.string()
});
```

The adapter internals confirm external submissions cannot select a named Flue
session in beta.1:

```ts
// node_modules/@flue/runtime/dist/adapter.d.mts:17-22
/**
 * Agent-mode submissions always target the default session of the
 * default harness; external submissions cannot select a session.
 */
declare const SUBMISSION_SESSION_NAME = "default";
```

This means Phase 2 should carry product `sessionId` in D1 and Ditto bridge state;
do not invent a named-session Flue API in this plan.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm test -- src/lib/flue-dispatch-adapter.test.ts` | exits 0; new tests pass |
| Projection tests | `pnpm test -- src/lib/flue-event-projection.test.ts` | exits 0 if plan 030 is done |
| Full tests | `pnpm test` | exits 0 |
| Typecheck | `pnpm exec tsc --noEmit --pretty false` | exits 0 |
| Lint | `pnpm lint` | exits 0 with only known warnings in `grainient.tsx:297` and `sidebar.tsx:85` |
| Whitespace | `git diff --check` | exits 0 with no output |

Do not call a live Flue Worker or spend model tokens in this plan.

## Scope

**In scope**:

- `src/lib/flue-dispatch-adapter.ts` (create)
- `src/lib/flue-dispatch-adapter.test.ts` (create)
- `src/lib/project-agent-run-contract.ts` only to widen the receipt type if needed
- `src/lib/project-agent-run-contract.test.ts` only to update expectations if the receipt type changes
- `plans/README.md` only to update this plan's status row if instructed

**Out of scope**:

- Calling `env.FLUE_WORKER.fetch` from `workspace.startRun`.
- Adding the bridge Durable Object; that is plan 033.
- Editing `.flue/agents/project-coder.ts`; that is plan 032.
- Changing D1 schema, migrations, UI components, socket routes, or `WorkspaceSessionBroker`.
- Implementing cancellation, named Flue sessions, mutating tools, or snapshot behavior.

## Git workflow

- Branch: `advisor/031-flue-dispatch-adapter` if you create a branch.
- Commit message style: Conventional Commits, e.g. `feat(flue): add dispatch adapter`.
- Do not push, deploy, or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Create the adapter module and public types

Create `src/lib/flue-dispatch-adapter.ts`. Keep it free of Cloudflare runtime
imports except structural types. Define:

```ts
export const PROJECT_CODER_AGENT_NAME = "project-coder" as const;

export type FlueAgentDispatchInput = {
	agentName: string;
	agentInstanceId: string;
	message: string;
};

export type FlueAgentDispatchReceipt = {
	agentName: string;
	agentInstanceId: string;
	streamUrl: string;
	streamOffset: string;
	submissionId: string | null;
	acceptedAt: string;
};

export type FlueStreamPollInput = {
	agentName: string;
	agentInstanceId: string;
	offset: string;
	cursor?: string | null;
};

export type FlueStreamPollResult = {
	events: unknown[];
	nextOffset: string;
	cursor: string | null;
	closed: boolean;
};
```

Use `streamOffset`, not just `offset`, because D1 already has
`agent_runs.flueStreamOffset`.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0 or fails only
because implementation is not complete yet.

### Step 2: Implement route/path helpers

Add helpers that encode paths exactly once:

```ts
export function buildFlueAgentPath(input: {
	agentName: string;
	agentInstanceId: string;
}): string
```

Expected path: `/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(agentInstanceId)}`.

Add:

```ts
export function buildFlueStreamPath(input: FlueStreamPollInput): string
```

Expected stream path appends `?offset=<encoded>&live=long-poll` and appends
`&cursor=<encoded>` only when `cursor` is non-empty. Use `live=long-poll`, not
SSE, so the bridge can consume discrete JSON batches and update D1 transactionally.

**Verify**: `pnpm test -- src/lib/flue-dispatch-adapter.test.ts` will fail until
tests are added, but `pnpm exec tsc --noEmit --pretty false` should exit 0.

### Step 3: Implement fetch factories for the service binding

Define adapter fetch types:

```ts
export type FlueDispatchFetch = (request: Request) => Promise<Response>;
export type FlueStreamFetch = (request: Request) => Promise<Response>;
```

Add factories that accept an object with a `fetch(request: Request): Promise<Response>`
method. This matches Cloudflare Worker service bindings structurally:

```ts
export function createServiceBindingDispatchFetch(binding: { fetch(request: Request): Promise<Response> }): FlueDispatchFetch
export function createServiceBindingStreamFetch(binding: { fetch(request: Request): Promise<Response> }): FlueStreamFetch
```

Both factories can return `(request) => binding.fetch(request)`. Keep them
separate anyway because plan 033 will inject them independently in tests.

Do not import `Env` or `cloudflare:workers` into this module.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 4: Implement `createFlueDispatchAdapter`

Export:

```ts
export function createFlueDispatchAdapter(options: {
	dispatchFetch: FlueDispatchFetch;
	streamFetch: FlueStreamFetch;
	now?: () => Date;
}): {
	dispatch(input: FlueAgentDispatchInput): Promise<FlueAgentDispatchReceipt>;
	poll(input: FlueStreamPollInput): Promise<FlueStreamPollResult>;
}
```

`dispatch(...)` behavior:

- POST to `https://flue.internal${buildFlueAgentPath(input)}`.
- Send JSON body `{ message: input.message }`.
- Set `Content-Type: application/json`.
- Require `response.ok`; on failure, throw an `Error` with a compact message from the JSON `{ error: { message } }` shape when present, or response text/status otherwise. Cap error text at 1000 chars.
- Parse response JSON. Require `streamUrl` string and `offset` string per Flue's `AgentAdmissionResponseSchema`.
- Return `streamOffset: body.offset` and `acceptedAt: options.now?.().toISOString() ?? new Date().toISOString()`.
- If the response body contains a future `submissionId` string, preserve it; otherwise return `submissionId: null`.

`poll(...)` behavior:

- GET `https://flue.internal${buildFlueStreamPath(input)}`.
- On `200`, parse JSON as an array of events.
- On `204`, treat events as an empty array.
- Require the `Stream-Next-Offset` response header; use it as `nextOffset`.
- Read `Stream-Cursor` as `cursor` when present; otherwise `null`.
- Treat `Stream-Closed: true` as `closed: true`.
- Throw a compact `Error` for non-200/non-204 responses.

Do not parse SSE in this plan. Flue's long-poll stream mode is enough for the
Durable Object bridge and simpler to test.

**Verify**: `pnpm exec tsc --noEmit --pretty false` -> exits 0.

### Step 5: Add unit tests with fake fetches

Create `src/lib/flue-dispatch-adapter.test.ts`.

Cover:

- `buildFlueAgentPath` URL-encodes agent name and instance id.
- `dispatch` POSTs to `/agents/project-coder/<instance>` with JSON `{ message }`.
- `dispatch` returns `streamUrl`, `streamOffset`, `submissionId: null`, and deterministic `acceptedAt` when `now` is injected.
- `dispatch` preserves a future `submissionId` field if present.
- `dispatch` throws a compact error for a non-ok Flue response.
- `poll` GETs `/agents/<name>/<id>?offset=<offset>&live=long-poll`.
- `poll` parses a `200` JSON event array and `Stream-Next-Offset` header.
- `poll` parses a `204` no-content response as no events and still updates the offset from the header.
- `poll` reports `closed: true` when `Stream-Closed: true` is present.

Use only fake `Response` objects and fake functions. Do not call a real service
binding.

**Verify**: `pnpm test -- src/lib/flue-dispatch-adapter.test.ts` -> exits 0 and
all new tests pass.

### Step 6: Update the project-agent run receipt type if needed

If TypeScript integration in later plans would be simpler with the new receipt,
update `src/lib/project-agent-run-contract.ts` so `ProjectAgentDispatchReceipt`
matches `FlueAgentDispatchReceipt` semantics:

```ts
export type ProjectAgentDispatchReceipt = {
	dispatchId?: string;
	submissionId?: string | null;
	streamUrl?: string;
	streamOffset?: string;
	acceptedAt: string;
};
```

Keep existing tests in `src/lib/project-agent-run-contract.test.ts` passing by
updating fake receipts. Do not change admission order or coordinator semantics.

If the existing contract can remain untouched without awkward casts in plan 033,
leave it alone. Prefer fewer changes.

**Verify**:

```bash
pnpm test -- src/lib/project-agent-run-contract.test.ts src/lib/flue-dispatch-adapter.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected result: tests and typecheck pass.

### Step 7: Run the full baseline

Run:

```bash
pnpm test
pnpm exec tsc --noEmit --pretty false
pnpm lint
git diff --check
```

Expected result: tests pass, typecheck exits 0, lint exits 0 with only the two
known warnings, and whitespace check emits no output.

## Test plan

- New `src/lib/flue-dispatch-adapter.test.ts` covers path construction, dispatch parsing, stream long-poll parsing, and error handling.
- Existing `src/lib/project-agent-run-contract.test.ts` remains green if the receipt type changes.
- No live Flue Worker, LLM, Sandbox, D1, or Worker runtime is required.

## Done criteria

All must hold:

- [ ] `src/lib/flue-dispatch-adapter.ts` exports route helpers, service-binding fetch factories, and `createFlueDispatchAdapter`.
- [ ] Dispatch uses `POST /agents/:name/:id` with `{ message }` and parses Flue stream coordinates.
- [ ] Stream polling uses `GET /agents/:name/:id?offset=...&live=long-poll`, not SSE.
- [ ] Non-ok Flue responses throw compact stable errors without dumping huge bodies.
- [ ] `pnpm test -- src/lib/flue-dispatch-adapter.test.ts` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm exec tsc --noEmit --pretty false` exits 0.
- [ ] `pnpm lint` exits 0 with only known warnings in `grainient.tsx:297` and `sidebar.tsx:85`.
- [ ] `git diff --check` exits 0.
- [ ] No source files outside the in-scope list are modified.

## STOP conditions

Stop and report back if:

- Plan 030 has not landed, or `src/lib/flue-event-projection.ts` is absent.
- Installed Flue route or response schemas differ from the excerpts above.
- The only workable adapter requires exposing the Flue Worker publicly instead of using `FLUE_WORKER` service binding.
- The direct agent route no longer accepts JSON `{ message: string }`.
- Long-poll stream mode is unavailable and the bridge would require SSE parsing in this plan.
- You need to add a D1 migration or UI change.
- A verification command fails twice after a reasonable fix attempt.
- You need to touch a file listed out of scope.

## Maintenance notes

- Plan 033 should use this adapter from inside `FlueRunBridge`; do not duplicate Flue route construction there.
- Direct Flue HTTP admission exposes stream coordinates, not a guaranteed public submission id. Later code should store `flueStreamOffset` and leave `flueSubmissionId` null unless Flue returns one.
- External Flue submissions cannot select named sessions in beta.1. Keep product session identity in D1 and bridge state until the Flue API changes or an app-owned Flue route is added.
