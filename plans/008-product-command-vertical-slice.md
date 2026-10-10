# 008: Connect durable product commands to Pi submissions

Status: READY for a separately authorized, disposable fixture implementation, subject to the preflight below. Not implemented.
Reviewed base: `3fe7b48` on `feat/pi-durable`. Phase: part of L3, not L3 completion.
Prerequisites: 001–007 accepted and integrated. Local L2 passed in 004/005. 007 source is integrated at `5a33d81` and `3bdf90a`.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 2–9, 12, 15–18; PD01–PD11, PD16, PD32–PD33, PD42; OD1–OD7. Coverage limits are listed below.
Review record: [008 refresh](reviews/008-product-command-refresh.md).

## Outcome

An authenticated synthetic prompt receives an atomic D1 receipt. Private delivery stores the command in the owning direct-DO runtime before acknowledging it. Durable wakeups consume commands in sequence and submit each instruction to Pi once logically. Follow-ups keep their own message pairs. Targeted Stop works before delivery, across sequence gaps, and without ordinary capacity.

Use the accepted encrypted `PiDurableHost` and the mandatory synthetic private model adapter from 007. Do not connect the old Node `SessionCoordinator` to Pi or add another execution owner. Default product composition remains unavailable. Candidate execution is enabled only by deployment-owned disposable fixture composition, never by a browser field alone.

This plan includes command admission, command/run binding, ordered submission, queue disposition and the minimum resource policy needed to exercise them. Remote coding-tool parity belongs to 009. Full terminal D1 projections, observation streams and L3 acceptance belong to 010. No retained workspace activation before L4.

## Accepted predecessor outputs

Read these records before execution, without reopening their accepted decisions:

- `plans/evidence/005-advisor-final-review.md` and `005-integration.md`: format-4 encrypted Pi storage, bounded host-private fields, authenticated history and local L2. Large Pi records do not imply arbitrary-sized host input support.
- `plans/evidence/006-advisor-final-review.md`: fixture-only credential ownership and renewal. Hosted authentication remains unavailable.
- `plans/evidence/007-advisor-final-review.md` and `007-integration.md`: accepted custom-summary preparation, exact host claim, synthetic credential transport and authenticated configuration. The final review's pre-integration wording is historical; the integration record establishes the current source.

Preserve Pi Durable/Pi AI/Chord 1.0.1, Sandbox 0.12.3 and the current lockfiles. Keep the one-attempt custom-summary policy and the exact claim's fresh final host/product checks. Do not replace the synthetic `.invalid` protocol with a guessed Codex wire protocol. No provider upgrade, live request or billing fallback is part of 008.

The accepted 007 gates were contracts 25, brain 43, credentials 164 Worker plus 3 Node, runtime 387 Worker plus 6 Node, and repository 848 web plus 79 runner tests. These are predecessor results, not results from this refresh or required future test counts.

## Current checkout and integration gaps

Paths and line anchors below were inspected at the reviewed base. Locate symbols again after any drift.

| Location | Current behavior and consequence for 008 |
|---|---|
| `apps/web/src/lib/session-command.ts:1263–1362`, `:905–1235` | Parses BrowserCommandV1, uses a parameterless configured/protocol check, then atomically creates the first session, sequence, command, messages, key and outbox. First sessions are `trusted_v1`, with no executor identity. Keep atomic admission and retry behavior, not that owner or readiness shortcut. |
| `packages/runtime-contracts/src/command.ts:14–161`; `limits.ts` | Historical V1 includes prompt-level `thinkingLevel` and recovery kinds. It accepts up to 32,000 text characters. Do not silently reinterpret it as conversation configuration or admit unimplemented recovery actions. |
| `apps/web/src/lib/session-runtime-client.ts` | Default transport is unavailable; admission eligibility defaults false. `OwnedConfigurationRuntime` is separate from the older `SessionRuntime` transport. Preserve this default denial. |
| `apps/web/src/lib/session-command-delivery.ts` | Bounded leased outbox retries and exact receipt/sequence acknowledgment checks exist. Routing is hardcoded to `trusted_v1`. Delivery acceptance is not start. |
| `apps/runtime/src/server.ts`; `session-runtime.ts` | `SessionRuntime` extends `Container` and composes the old `SessionCoordinator`. Its prerequisites include a brain identity/reservation. This is not the accepted Pi host. |
| `apps/web/src/lib/session-runtime-authority.ts:161–174` | Old execution prerequisites return null. Do not make them pass by fabricating a trusted-brain role. Add a separate direct-DO authority path. |
| `apps/runtime/src/pi-durable-host.ts:3659–4035` | `accept` stores encrypted text, message/run membership and wakeup intent. `schedule` uses `requestId = command ID`, recovers with `submissionByRequest`, and waits for predecessor submissions to finish. There is no product command-kind protocol or queue expiry/cancellation protocol. Its input cap is 8,192 UTF-8 bytes. |
| `pi-durable-host.ts:3434–3504`, `:4448–4531` | Stop requires an already-known run. Alarm selection uses inbox arrival order, not the command sequence. An active invocation returns after repairing its alarm. Direct fixture calls to `schedule` do not prove autonomous follow-up draining or Stop-before-prompt delivery. |
| `pi-durable-host.ts:1225–1283`, `:1108–1136` | `mappedCommand` repairs numeric submission membership before guarded effects. Terminal transitions preserve completed assistants and queue local projections. Extend this owner rather than adding another run ledger outside it. |
| `apps/runtime/src/pi-durable-models.ts` | `createPrivateModelAdapter` and `ExactModelClaim` provide 007's mandatory guarded product/credential path. `cooperativeFixture` alone is not evidence that product authorization works. |
| `apps/web/src/lib/model-product-authority.ts:118–195` | Provider authorization requires D1 command/run membership, exact executor identity and `trusted_v1`. It also treats `session_commands.deadlineAt` as current request authority. Candidate queue expiry must not become a 15-minute whole-run limit. |
| `apps/credential-tests/src/model-entry.ts`; `codex-request-contract.worker.test.ts` | Real workerd/D1/credential RPC fixtures exist, but the fixture subject is fixed and tests seed commands/memberships manually. 008 must derive these from admitted product commands, not preseed a successful run. |
| `apps/web/src/test/session-runtime-fixture.ts:778–857` | Captures actual POST handlers under mocked authentication. Its coordinator is the old Node/SQLite fixture, not Pi Durable or real D1. Keep it for route/admission regressions and add a real Worker integration leg. |

Two excerpts define the existing handoff to preserve and complete:

```ts
// apps/runtime/src/pi-durable-host.ts, schedule
const retained = await this.piRecords.submissionByRequest(
	ROOT_CONVERSATION_ID,
	id,
	BACKGROUND_CONTEXT,
);
```

The later submission call in the same method reads the verified encrypted inbox:

```ts
const submission = await root.submit(
	{
		type: "input",
		content:
			this.opened(`inbox:${id}:content`, input.content) ??
			input.content,
		requestId: id,
	},
	BACKGROUND_CONTEXT,
);
```

Submission itself enables Pi scheduling. A post-submit numeric-ID write cannot be the only guard against an early provider callback.

```ts
// apps/web/src/test/session-runtime-fixture.ts, actual route test pattern
return withResolution(async () => {
	const response = await route.server.handlers.POST({
		request: new Request(`http://localhost/api/agent/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: payload as BodyInit,
		}),
	});
	return { status: response.status, body: (await response.json()) as unknown };
});
```

Match existing TypeScript conventions: tabs, double quotes, `unknown` at parsers, strict bounded records and stable domain reason codes. Do not expose raw SQL, Harness handles, fixture fault setters or Pi tasks through product routes.

## Scope

Allowed implementation locations:

- `apps/web/src/lib/session-command*.ts`, `session-runtime-{client,authority,product,ownership}.ts`, nearest tests and `src/test/session-runtime-fixture.ts`.
- `apps/web/src/routes/api.agent.stream.ts`, `api.agent.control.ts`, `apps/web/src/server.ts`, and narrow scheduling/owner guards in `workspace-runtime*.ts`. Include `server.test.ts` and the nearest `agent-run-service.test.ts` / `agent-control-service.test.ts` denial coverage. Changes to those legacy services, if needed, are limited to candidate-owner rejection. No unrelated legacy cleanup.
- `apps/web/src/lib/model-product-authority.ts`, `model-product-transport.ts`, `configuration-product-authority.ts`, and their nearest tests where candidate ownership, accepted membership and deadline semantics need integration. Preserve all 007 final-claim checks.
- `apps/runtime/src/pi-durable-host.ts`, `pi-durable-models.ts`, their existing tests, and one focused private direct-DO command entrypoint/module if needed. The host remains the sole run/effect owner.
- `packages/runtime-contracts/src/` for versioned data contracts/parsers and tests. Shared contracts must not import Pi, SQL, authentication or either Worker implementation.
- `apps/web/src/db/schema.ts`, `src/db/trusted-runtime-migration.test.ts`, and new additive migration artifacts, including metadata. Update handwritten schema fixtures with the migration. Never rewrite historical migrations. Apply only to newly created test databases.
- Existing runtime and credential-test Worker entrypoints/configs, plus `apps/credential-tests/src/product-commands.worker.test.ts` and `apps/runtime/src/pi-durable-commands.test.ts`. New filenames below are planned, not existing gates.
- `package.json` only to register the new Worker test in verification. Binding declarations and the existing Alchemy disposable-fixture branch only if needed for private composition. No default resource activation or second deployment path.
- `plans/evidence/008-product-commands.md`, this plan and its index status. Update implementation-facing docs only for actual completed behavior.

Out of scope: UI, authentication replacement, real credentials, external provider requests, retained data, seed/recovery/Git/preview implementation, full observation transport, new coding tools, global multi-workspace capacity policy, old runtime retirement, dependency upgrades, speculative abstractions and a general migration/importer. Preserve old package tests and evidence. No reset, deployment, shared DB mutation, stage or commit.

## Required protocol decisions

Implement these as one bounded fixture protocol, not optional alternatives.

### A. Separate ownership and command meaning

Use the candidate owner discriminator `pi_durable_v1`, a separate direct-DO namespace named for that owner, and candidate command/transport version 2. First candidate sessions have owner version 1, runtime protocol version 2 and command payload version 2. These version numbers identify different contracts. Do not route existing `trusted_v1` or legacy records to Pi. Owner incarnation/version, wire version, host invocation generation and executor lifecycle generation are different fields, not interchangeable counters.

Define candidate BrowserCommandV2 and reconstructed CommandV2 for exactly `prompt`, `follow_up`, `stop`, and `cancel`. Prompt/follow-up carry text and identity fields, not a command-wide model/thinking selection. Configuration continues through accepted ConfigurationIntentV1. Use version-2 candidate receipts/acks; retain the existing exact command ID, receipt ID, owner version and accepted-sequence checks. Keep V1 parsing, stored payload meanings and old tests intact. Candidate recovery kinds fail before admission until their handlers exist.

The new owner may be created only by the isolated fixture's first-prompt path. No legacy-to-candidate transition is enabled. Candidate routing requires both trusted composition and matching persisted owner/protocol. Unknown versions, malformed versioned bodies and unversioned requests for candidate sessions must never fall through to legacy execution.

For 008, enforce the existing host ceiling of 8,192 encoded UTF-8 text bytes at the candidate product parser before any writes. Reject, never truncate. Keep the outer request-body limit. This is a declared fixture limit, not full attachment/text parity or a change to historical V1 limits.

### B. Admission and model readiness

For a first prompt, add a bounded product-side pre-session readiness operation. Its owner comes from authenticated context and its input identifies the owned project, not a fabricated session/executor. Check the ready project and deletion fence, `CodexCredential.status`, and the exact synthetic capability generation/revision for the deployment-owned default `faux-1` with thinking `off`. This operation creates no rows, runtime, conversation or effect. The existing `ownedConfiguration` query cannot serve this purpose because it joins a session and executor that do not yet exist.

For an existing candidate session, use a passive owned configuration read. If a Pi root exists, validate its persisted selection against current connection/capability generation, model and thinking support. If an admitted session has no Pi root yet, validate the same explicit default through pre-session account policy plus current owned-session/identity checks. Do not create a root to answer readiness. Explicit configuration intents may establish the root through their own accepted policy; prompt admission must not overwrite that selection.

Reuse 007's credential status and capability validation, and its owned configuration policy where a session exists, not `configured: true` or a bundled model catalogue. Carry fresh D1 ownership/connection predicates into the admission batch where applicable. Later model attempts independently recheck mutable authority. Readiness is not a model pin or an effect permit.

Identical retries still resolve through the stored owner/target-scoped key and return the original session, receipt, command and message IDs. They do not allocate another runtime, extend expiry or revalidate a new model choice as if they were new work. Preserve current ownership/deletion checks on receipt access. Changed payloads conflict.

Validate follow-up/Stop targets and cancel targets against owned accepted records, including same workspace membership. An initial prompt's stable run identity is its command ID. Follow-ups retain that target run ID. For a new follow-up, perform a bounded passive runtime target-status read after product ownership checks. It returns the exact owner/run and either not-yet-delivered, nonterminal, or terminal. A trusted accepted initial prompt with no runtime run yet is a valid queued target. Reject a known terminal follow-up target before admission. Stop against an owned terminal run is an idempotent no-op control, not a revived run.

Choose this race policy explicitly: acceptance promises a durable instruction and receipt, not that its target stays open. If the runtime completes after the admission status read but before the accepted follow-up is consumed, retain that follow-up with `target_run_terminal`, fail its local pending assistant membership and atomically queue its failure projection. Do not start a new run or reopen the old one. This also applies when the follow-up committed in D1 before predecessor completion but its delivery arrived afterward. A later full projection design may not silently change this recorded outcome. Test the delayed-delivery race through crash/reopen with original IDs intact. An identical receipt remains replayable after settlement.

### C. Trusted delivery, start and membership

Private delivery takes a command reference and expected owner version, not browser-supplied command content or workspace authority. Product reconstruction verifies D1 command, receipt, user/assistant membership, payload digest, outbox version and current owner. Routing derives the owning namespace/session from that result. Bind an opened DO to that identity and reject later mismatches.

Candidate admission must establish an owned synthetic executor registration for the newly created workspace through a trusted fixture path. It must not mint a brain identity or treat a caller-provided executor ID as proof. Creation/retry must not leak duplicate identities. This registration and the hard single-workspace limit do not prove a real sandbox exists. Actual tool execution follows in 009.

At DO acceptance, store the complete immutable command identity, sequence, receipt, accepted time, queue deadline, digest and message/run membership with encrypted private payload and durable wakeup intent. Acknowledge future sequence numbers immediately after this durable acceptance. A missing predecessor is a consumption wait, not a failed inbox receipt. Exact duplicates return the same acknowledgment even after completion, Stop, cancellation or expiry; conflicting content/membership fails closed.

Persist command-to-run/message binding and a stable logical Pi request ID before submission. The D1 `runtime_command_memberships` row required by 007 must be established by an idempotent bounded product callback tied to the reconstructed command and trusted candidate owner. Do not seed it in integration tests or treat a lagging assistant projection as admission authority. Conflicting run/assistant/owner/epoch binding denies. The callback must not re-enter a runtime command that is waiting for it.

For candidate work, persist a runtime-owned `started` or `expired` queue decision before scheduling. The start decision includes the immutable command identity, owner version, run, queue deadline and decision time; start may win only before that deadline and after resource/target checks. Reconcile its exact identity into product authority before allowing provider dispatch. A lost acknowledgment retries that decision; neither Worker independently invents the opposite outcome. An expired decision creates a terminal command disposition and local pending failure projection without a Pi submission. Store start evidence separately from the fixed acceptance deadline. After a valid start decision, provider checks use current ownership, run/epoch and finite effect/window deadlines, not the expired queue deadline. Keep the old V1 deadline behavior on its existing path.

Bind model/configuration policy through separate deployment-owned candidate RPC composition. Keep ModelSubjectV1 and the synthetic request body unchanged; they do not carry an owner discriminator. The candidate composition injects a closed expected-owner policy of `pi_durable_v1` and a dedicated executor controller namespace. It must compare both against current D1 records. The old composition continues to expect `trusted_v1`. Browser fields and claim JSON cannot select a policy or widen an allowlist. Bind `createPrivateModelAdapter` to the candidate's private request/permit methods and its owned configuration callback; keep old methods/default production behavior unchanged.

Audit every candidate authority path in `model-product-authority.ts`, not just `facts`: `ownedConfiguration`, `facts`, `current`, `open`, `reserve`, `permit`, and the three-denial review/halt update. `current`, `open` and `permit` each independently clamp to `session_commands.deadlineAt` today. On the candidate path require the exact reconciled start decision instead of that queue TTL, while preserving current-clock window/effect checks after awaited queries. Test V1 expiry still denies, candidate started work survives queue TTL, wrong-owner transport denies, and three candidate denials still persist review and halt the exact host claim.

Every new cross-store handoff needs an intent, idempotent outcome and crash tests on both sides. Do not claim a D1/DO/Pi distributed transaction.

### D. Ordered Pi consumption and follow-ups

Keep one owner transition lane for ordinary admission/consumption/configuration state changes. Do not hold it across a model turn or credential model-dispatch wait. Preserve 007's bounded configuration/authority waits, but keep epoch-first Stop outside that waiting lane so it can commit revocation immediately. Recheck mutable guards after asynchronous preparation.

Maintain a durable sequence cursor and a disposition for every accepted sequence, including non-Pi controls. Select by command sequence, not inbox rowid. A later command waits for a predecessor or its verified durable disposition. Do not consume all follow-ups into one Pi generation, use steering, or infer a turn boundary from a streaming flag.

The pinned 1.0.1 API documents that follow-ups are placed when a run answers; steers join after a tool round. Current `schedule` waits for prior submission status `done` or `unanswered`, and `mappedCommand` requires exactly one live input. Preserve one instruction at a time. A successful predecessor's committed `done` state permits the next instruction. `unanswered` requires explicit run failure/cancellation handling, not automatic continuation of pending work after a failed run. Record the supported public status/placement evidence and tests before expanding the existing host.

Commit the stable request ID and a `submitting` consumption intent before calling `root.submit`. Recover a committed Pi submission through `submissionByRequest`. Validate type, request ID, conversation generation and original payload association before attaching its numeric ID. Pi deduplication does not replace payload validation. The guarded task/provider path must establish durable exact command/submission/message membership even if Pi starts a callback before `submit` returns.

Make alarms advance the next eligible instruction after a turn without another POST, a test call to `schedule`, or client activity. Cover active-invocation settlement, host close/reopen, duplicate alarms, missing predecessors arriving later and missed alarm scheduling. Avoid repeatedly selecting an already-finished first command or spinning on a gap. Preserve accepted custom summaries, prepared-request configuration and unknown-effect fences.

### E. Cancellation, Stop and limits

Queue cancellation records the exact target command's disposition before it can start. Reconstruct an undelivered target from trusted product records if needed. A cancellation may establish that target disposition before the ordinary cursor reaches the cancel command, but cannot skip unrelated predecessors. Cancellation after start reports a stable too-late disposition; it is not an implicit Stop. Retain accepted messages and failure projection intent. Controls themselves occupy sequence positions and cannot leave permanent gaps.

Late delivery into an already-stopped or otherwise terminal run has a separate accounting transition. Persist the original inbox acknowledgment and the command's terminal disposition, attach its original user/assistant membership, and atomically add a failure projection for any newly arrived pending assistant. Do not rely on `terminal()` being called again, since it currently returns immediately for terminal runs. Preserve already-complete members, the run's terminal state and epoch, and any unrelated newer run. Test a prompt plus multiple undelivered follow-ups arriving after Stop and repeated delivery of each.

Stop uses its exact run target and a priority path. If Stop arrives before the prompt/run inbox, reconstruct the owned target and durably fence that run before acknowledging the control. Later prompt delivery may be accepted for accounting but must not schedule it. Reuse 003's epoch-first revocation, then cooperative cancellation. No new model entitlement or ordinary resource slot is needed. In particular, control-only activation must not invoke `initializeOwnedConfiguration` to create a root conversation and require a connected model before persisting Stop. Keep default validation mandatory before the first ordinary conversation creation. Test Stop after disconnect, before the first root exists, and under exhausted capacity. Delayed old-run Stop cannot affect a newer run. Cancellation acknowledgment never proves remote process termination.

Use one persistent workspace claimant for the disposable fixture database's lifetime, with at most one runtime, one executor and one concurrent model operation. Acquire its unique D1 fixture claim in the same atomic batch as first-prompt admission and synthetic executor registration. A different first-prompt key that would create a second workspace is rejected with `fixture_capacity_exhausted`, with no session, identity, command, message or outbox leftovers. An identical key returns its original receipt. Test two concurrent distinct first prompts and rollback at each batch boundary.

The workspace claim is not released by a completed run, Stop, host close, lease timeout or restart. It ends only when the disposable fixture itself is torn down; 008 does not add a release/reassignment workflow. Commands within the winning workspace can queue under their own fixed deadline, but cannot overlap model work or unsafe writers. Persist model/resource occupancy before admission and release an operation slot only after accounted completion or known pre-dispatch rejection. Track an unresolved or live isolated executor as occupied across host close/restart. Do not use an in-memory boolean or `liveExecutors ?? 1` as the entire capacity policy. Retain existing configurable execution pool policies for noncandidate owners; full FIFO multi-workspace policy stays in 015.

The ordinary queue deadline is fixed at acceptance plus 900,000 ms. D1 command times are milliseconds; legacy `workspace_runtime_work.expiresAt` is seconds. Do not mix units or reset either on retry. Queue expiry only wins before the runtime start decision. The automatic recovery deadline remains a separate 15 minutes from first interruption. Neither bounds the whole healthy run. Stop, revocation and cleanup bypass capacity acquisition.

## Execution sequence and gates

### 0. Preflight, no implementation until the baseline is usable

1. Record `git rev-parse HEAD`, `git status --short`, Node/package versions and actual installed runner paths. Verify the integrated prerequisite files and read the accepted evidence above.
2. This refresh attempted the narrow web command below under a sanitized environment. pnpm unexpectedly began automatic dependency installation, recreated ignored dependency files and timed out before Vitest ran. Tracked source/manifests/lockfiles remained unchanged. No baseline pass is claimed. Do not retry automatic installation or repair the main checkout without separate approval. Use a separately prepared execution environment; stop on missing dependencies.
3. Before invoking pnpm, establish that the installed launcher will not auto-install. Do not assume `exec` is read-only. A directly invoked existing local Vitest binary is suitable for a baseline when its dependencies are intact. Do not use `npx`, `dlx`, or an installer as a verification fallback.
4. Run the current narrow gates in a credential-free environment using the package's installed runner:

```sh
pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-command-delivery.test.ts src/lib/session-runtime-ownership.test.ts
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts src/pi-durable-models.test.ts
pnpm credentials:verify
```

Expected: exit 0, named tests actually collected. A toolchain failure is a preflight block, not a failed Pi feasibility decision or permission to weaken tests. Keep `.env.local` and platform credentials out of the test environment. Never print secret values.

### 1. Versioned candidate admission and owner isolation

Implement A/B and product-side parts of C. Extend existing POST-handler tests for candidate first prompts, retry/conflict, current model readiness, byte bounds and invalid targets. Include concurrent first-prompt retries and a failed D1 batch. Assert no command/messages/outbox/identity/provider effects on rejection.

Test both POST routes with unversioned/V1/V2 inputs against legacy, old trusted and candidate owners. Keep default admission denied. Existing command tests replace legacy services with throwing mocks; that alone does not prove real unversioned owner denial. Add cases through real `prepareAgentRun` / `controlAgentRun` owner checks, keeping lower execution dependencies inert and asserting zero execution. Preserve the existing regression suite.

At the actual product `fetch` and `scheduled` entrypoint boundaries, resolve transport from trusted disposable composition, not a request-scoped override that disappears after the HTTP request. Existing `fixture.scheduledDrain()` calls the drain directly and is not an entrypoint composition test. Extend `apps/web/src/server.test.ts` to exercise the entrypoint and its joined drain. Prevent legacy queue execution, expiry, capacity reclamation and other maintenance from claiming candidate work or treating its synthetic identity as a real legacy sandbox.

Gate: `pnpm contracts:verify`, `pnpm typecheck`, and the web baseline command above. Expected: V1 regressions pass; V2 rejects unsupported inputs before rows; one receipt/message pair/identity on concurrent retry.

### 2. Direct-DO command acceptance and ordered consumption

Implement the direct-DO entrypoint, trusted reconstruction and C/D using the existing host. Extract only genuinely shared command data out of old runtime imports. Do not refactor the old coordinator/projector for style. Preserve private storage bounds, authenticated records, short transactions and passive reopen. Any new retained command meaning needs an explicit compatibility version; never reinterpret a retained old namespace.

Create `apps/runtime/src/pi-durable-commands.test.ts` for encrypted real-DO fault tests. Add faults before/after inbox durability, wakeup registration, consumption intent, Pi submission, numeric mapping and D1 membership/start acknowledgment. Include the immediate provider-callback-before-submit-return race. Before scheduling, each effect must resolve to exactly one accepted command and assistant.

Gate:

```sh
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-commands.test.ts src/pi-durable-effects.test.ts src/pi-durable-host.test.ts src/pi-durable-models.test.ts
```

Expected: one logical Pi submission per consumed command; no missing or duplicated instruction; all accepted predecessor safety tests remain green. A preserved row without eventual autonomous progress is insufficient.

### 3. Priority controls and deadline reconciliation

Implement E and the candidate start/expiry authority integration. Keep local terminal decisions, command dispositions and pending assistant projection intents atomic. Preserve an already-complete assistant if a later follow-up fails. Full D1 projection delivery remains 010; do not claim its eventual-settlement gate here.

Gate: the runtime command test above plus web command/delivery/control tests. Assert Stop before target delivery, Stop under a held provider/configuration callback, capacity saturation, late old Stop, cancel-before-delivery, cancel-versus-start, and queue expiry on both sides of lost start acknowledgment. Advance the fake clock beyond queue TTL after a valid start and prove later admitted requests are not rejected merely by the old command deadline. Advance the recovery deadline separately and prove no new effect admission.

### 4. Product-to-Pi Worker integration

Extend the existing credential Worker test environment, not a new test framework. Add `apps/credential-tests/src/product-commands.worker.test.ts`. Use real local D1, encrypted DO SQLite and private RPC. Fixture-owned authenticated context supplies the user; it does not accept arbitrary user IDs from public JSON. Exercise production command admission/delivery code and actual credential/model policy, with network disabled except the synthetic mock destination.

Adapt the fixed `FixtureProduct` subject to the trusted candidate session/identity created by admission. Reuse `createPrivateModelAdapter`, not a standalone cooperative provider. Wire the candidate command entrypoint in isolated Worker composition and test both directions of the private transport. Normal `ProductEntrypoint`, public routes and deployment bindings must remain unavailable for candidate execution outside that composition.

Cover at least this matrix, combining cases where useful:

| Case | Observable assertion |
|---|---|
| First prompt, concurrent identical retry, changed payload | Original receipt/session/message IDs survive; one logical command; changed payload conflicts. |
| Foreign/archived/deleting/disconnected/unavailable model/unsupported thinking, invalid owner/protocol, over-byte-limit text | No admission rows, Pi submission, provider fetch or executor start. |
| D1 commit before delivery; lost DO ack; product restart | Outbox retries reconstruct the same accepted command. One logical submission. |
| Arrival order 3, 1, 2; cancel a missing target; priority Stop between prompts | Receipt for 3 is durable immediately; consumption respects all dispositions and never skips an unknown sequence. |
| Stop before target inbox, held request preparation and saturated slot | Epoch fence wins without a slot; delayed delivery cannot start targeted work. |
| Completion/reopen followed by duplicate delivery | Original ack, no revived run or repeated model attempt. |
| Browser detaches; new product invocation; native runtime alarms | Follow-ups progress without a direct test call to `schedule`; message/run identity remains stable. |
| Start/expiry race and lost acknowledgments | One durable fate; no healthy started run failed by dispatcher expiry; no expired command newly submitted. |
| Prepared model/configuration change during queued follow-up | Existing prepared request unchanged; next preparation uses current configuration through 007's exact claim. |
| Provider denial or uncertainty after a valid receipt | Stored work remains inspectable; no automatic duplicate dispatch, attempt refund or fallback. |

The web fixture remains the actual POST-route/authentication-injection leg. The Worker suite proves D1/DO/private transport semantics through the same command module. Neither proves cookie authentication or hosted service-binding identity. Do not expose a public test-only Pi control to join those tests.

Gate:

```sh
pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts src/codex-request-contract.worker.test.ts
pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-command-delivery.test.ts src/lib/session-runtime-control.test.ts src/lib/session-runtime-ownership.test.ts src/lib/workspace-runtime.test.ts src/lib/agent-run-service.test.ts src/lib/agent-control-service.test.ts src/server.test.ts src/db/trusted-runtime-migration.test.ts
```

Expected: exit 0 with the new suite collected, denied calls making zero upstream requests, and no manual command/membership seeding after admission. Register the new Worker file in `credentials:verify`; its current script explicitly lists only two files, so merely adding a file does not add it to `pnpm verify`.

### 5. Review, aggregate verification and handoff

Run sequentially after narrow checks pass:

```sh
pnpm contracts:verify
pnpm brain:verify
pnpm credentials:verify
pnpm runtime:verify
pnpm verify
git diff --check
```

Expected: all exit 0, no suppressed suites or increased deadlines. Root `verify` does not replace `runtime:verify` or `brain:verify`. Retained brain verification is required when shared contracts change. If an aggregate fails, report the failure and its cause; do not retry until green and hide the first failure.

Record actual results in `plans/evidence/008-product-commands.md`: base and diff scope, pinned versions, requested/effective workerd date, owner/wire/storage compatibility tuple, exact tests/crash points, supported follow-up boundary, capacity/size ceilings, and each handoff's recovery rule. Distinguish `passed`, `failed`, and `not run`. Update the index only after independent review.

## Done criteria and evidence limits

008 is done only when all four new integration guarantees are demonstrated: authentic product receipts, crash-safe trusted delivery, autonomous ordered Pi consumption, and priority controls with reconciled queue/capacity decisions. Tests must use commands admitted through product policy, not synthetic host membership as a substitute.

- PD01–PD06 and PD33: candidate command cases above pass through product admission plus real Worker integration.
- PD07–PD10: bounded local restart/wakeup behavior passes for this slice. No hosted eviction claim.
- PD11: command/follow-up mapping handoff only; real coding tools remain 009.
- PD16: retain the accepted local deadline fencing and pending projection intent. Eventual D1 assistant settlement is not complete until 010.
- PD32: hard single-workspace/model/executor bound only. Concurrent builder/preview/multi-workspace policy remains 015.
- PD42: synthetic account capabilities and accepted configuration behavior only. Live account entitlement remains unproved.
- PD38, PD39, Docker coding-tool parity, full observations/projections, L3 completion, retained activation, UI, hosted checks and benchmarks remain `not run` or explicitly assigned to later plans. Do not turn predecessor fixture success into a live-provider claim.

## Stop conditions and maintenance

Stop if the design needs a brain identity, a second task scheduler, a private Pi API, a fork, a wider provider protocol, an implicit owner migration, or a product callback that re-enters its waiting runtime. Stop on an unclassified handoff, unsupported command size, unsafely revived terminal run, or inability to make forward progress without a client. Stop if new command behavior cannot preserve the accepted encrypted storage, summary, exact-claim, Stop and close guarantees.

New intent kinds must participate in the same owner checks, idempotency, sequencing/disposition and expiry rules. They must not create another mutation path. 009 consumes the resulting guarded runtime interface; 010 consumes run/message membership and pending projections. Refresh those conditional plans from 008's actual accepted output, not this proposed API. Full capacity policy in 015 replaces the conservative fixture restriction only after its own evidence.
