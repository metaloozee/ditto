# 008 fixture-only reset and termination witness

Status: reviewed requirements, with [scoped fixture implementation now requested](008-implementation-continuation.md) after the independent local RPC test pass. No issuer or recovery gate pass is claimed. The first independent review found six gaps; the requirement amendments below have not had a second independent text review.
Review record: [draft review](../reviews/008-fixture-reset-witness-review.md). The separately authorized [qualification advisor review](../evidence/008-qualification-advisor-review.md) independently reproduces the stale-positive final-permit gap; abort is still unqualified. No issuer implementation is accepted; the subsequent continuation is scoped to disposable fixture composition.
Written against `2487d56291fb6196672b36cd9f9c632ef2dfa9c5` and the corrected, uncommitted candidate in `/home/ayan/ditto-execution/plan-008-4WXvNW`.
Parent requirement: `plans/008-product-command-vertical-slice.md` and `plans/reviews/008-product-command-refresh.md`. This document proposes a narrow amendment to that plan's prohibition on reset, limited to one explicitly selected disposable test DO. It does not authorize any operation now.

## Decision proposed

Use a trusted local test controller to request an explicit Cloudflare per-object abort. Issue takeover authority only after an independent controller observes the expected abort outcome and obtains a matching passive replacement proof. Keep the reset intent, replacement observation and issued witness durable and idempotent.

Keep this mechanism in the existing synthetic credential-test composition. Do not add a production reset endpoint, a general lifecycle service, a new DO namespace or a second scheduler. Ordinary product execution remains unavailable by default. Repository code, browser inputs and sandbox processes cannot request resets, provide termination evidence or select a generation.

The cheaper alternative is to test only graceful close/reopen. It needs no new issuer, but does not satisfy 008's abrupt restart and cross-store crash requirements. This proposal costs a private fixture journal, a candidate-only recovery admission barrier and additional crash tests. It must stop if the pinned runtime cannot supply a distinguishable abort outcome. A generic rejected RPC plus a new constructor is insufficient.

## Why the candidate cannot recover yet

In the execution worktree:

- `apps/runtime/src/pi-durable-host.ts`, `PiDurableHost.open`, requires current authority, a generation newer than the unclosed predecessor, and `priorTerminated` equal to that predecessor's exact invocation ID. A failed predecessor still requires review. The existing guarded closure accounting runs before Pi opens.
- `apps/web/src/lib/session-command-candidate.ts`, `runtimeAuthority`, returns generation `1` and no witness. Its executor lifecycle generation and live-executor count are different authorities.
- `apps/runtime/src/pi-durable-product-session.ts`, `open`, passes that product authority directly to the accepted encrypted host.
- `apps/credential-tests/src/model-entry.ts`, `CandidateFixtureSession.reopenFixture`, waits for actual graceful closure. It does not establish abrupt termination.
- `plans/evidence/artifacts/008/correction-executor/termination-seam.test.ts` shows that a supported `DurableObjectState.abort()` followed by a fresh stub can discard fixture instance fields while preserving SQLite. It has no admitted candidate work, exact predecessor binding or independently classified abort outcome. It is exploratory evidence only.

Do not edit the predecessor check into accepting lease expiry, a timeout, a reset request, replacement construction alone or an application-written pre-abort witness. Do not use the execution identity's lifecycle counter as the host takeover counter.

## Platform facts and the qualification gap

Cloudflare's [state API](https://developers.cloudflare.com/durable-objects/api/state/#abort) says `abort` immediately resets the DO, logs the supplied error and produces an error application code cannot catch. It also documents alarm retry after abort. The installed Workers declarations expose `abort(reason?: string): void`. Use only that pinned signature. Do not use the newer alarm-options argument or upgrade a dependency to get it.

The [lifecycle documentation](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/#shutdown-behavior) distinguishes storage uniqueness from complete termination. During ordinary shutdown, an old HTTP/RPC invocation may finish if it does not access storage. A different instance nonce therefore cannot, by itself, prove that all prior host work stopped. The same page documents no reliable shutdown hook. Creating a [stub](https://developers.cloudflare.com/durable-objects/api/stub/) does not even instantiate the object until a method is invoked.

These pages were retrieved during drafting. Their current text is not evidence that every feature exists at the candidate's pinned workerd compatibility date. The installed types and exploratory test support only the single-argument reset seam.

Before implementing the issuer, qualify the pinned local abort seam with a trusted test callback and real admitted candidate work. The controller must distinguish the runtime outcome of that exact abort call from an arbitrary exception, failed delivery, storage failure or lost response. An exact per-reset opaque error label may be used only if the pinned runtime preserves it in a reliably classifiable abort outcome and trusted code has no other path that emits it. The executor must document the actual classification, not assume one from the current `rejects.toThrow()` probe.

If that distinction cannot be established, STOP. Leave authority denied and report the missing supported completion signal. Do not replace this requirement with a sleep, an assertion on a changed field, an expected generic exception or a caller-set success bit. A protocol requiring this signal is deliberately conditional, not a claim that such a signal has already been found.

## Trust and ownership

The reset requester and observer are the deployment-owned local test controller, outside the DO being reset. The requester names only an owned fixture session and an opaque idempotency key. It cannot supply predecessor ID, generation, execution identity, prior termination or model authority.

Reuse the existing private `CandidateFixtureProduct` composition for durable journal operations. Its HTTP `fetch` remains 404. Reset methods exist only in the test entrypoint, not `ProductEntrypoint` or normal deployment bindings. The actual abort can be performed through `cloudflare:test`'s existing `runInDurableObject` callback against the validated `CandidateSessions` stub. There is no need for a browser-callable DO reset method.

Every journal transition rechecks current D1 user/project/session ownership, candidate owner/version/protocol, fixture claim, execution identity/controller/incarnation/lifecycle and retirement/deletion/review fences. Reservation, witness issuance, recovery activation and the runtime authority read must explicitly require `workspace_sessions.runtimeFailureReasonCode IS NULL`; the current candidate owned-session query lacks that predicate. A review fence denies takeover and ordinary activation, not just model admission. Preserve passive receipt access and exact-target Stop/cancel accounting without permitting ordinary work. Select the DO from the validated workspace session ID and namespace, never a caller-supplied DO ID. Private replacement probes also check the retained encrypted owner/session association and that `ctx.id` matches the candidate namespace's named ID.

The controller is trusted fixture code. Untrusted repository contents are data. No secret, keyring, prompt, raw model response or credential is recorded in this protocol or its test evidence.

## Durable records

Add bounded fixture-only tables to newly created credential-test D1 databases, adjacent to their existing handwritten fixtures. Do not introduce a production migration just to exercise test reset authority. The candidate authority extension is composition-injected; absence of the fixture issuer preserves generation `1`, no witness and default denial of abrupt takeover.

Maintain one current authority record per exact candidate owner/session. Store:

- Owned user/project/session, runtime owner/version, candidate namespace/DO identity, and the existing execution identity tuple.
- Current host authority generation, initially `1`.
- Phase `active`, `reset_pending`, or `recovery_only`.
- Canonical reset ID, predecessor invocation ID/generation and predecessor boot nonce when a reset is pending.

Maintain an immutable history row for each reset. Store its owned scope, canonical request key, expected predecessor tuple, reserved next generation, classified abort observation, replacement boot nonce and exact local-journal digest, issued witness, and resume acknowledgment. Phase markers record which handoffs committed. The reserved generation is not authority until issuance.

Use unique constraints for the request key within its scope and for the exact predecessor invocation within that owner/session. One predecessor can receive only one newer generation. A concurrent different request for a pending reset returns a stable busy/conflict result. An exact retry returns the same canonical record. Retries after issuance never allocate another generation, rerun abort against the replacement or rebind to a newer predecessor.

Each candidate invocation must receive an immutable invocation-to-boot association in the same host-owned durable transition that creates its invocation row. Include the trusted candidate namespace/DO identity and constructor nonce. The current invocation schema has no such association. Keep the current constructor nonce in memory, but retain its immutable association per invocation in the existing encrypted host's ownership domain. A fixture-only additive association table is sufficient; do not reinterpret old records. A missing association denies abrupt reset qualification.

The DO retains a small local reset intent bound to the canonical reset ID, full scope, exact predecessor invocation/generation and that originating boot nonce. Preparation and the abort callback must be executing in the originating boot. They cannot attach their own new nonce to a predecessor from a different constructor. This prevents aborting a replacement while an older non-storage request may still run.

Define the proof identity digest over canonical reset ID, complete owned scope and executor tuple, predecessor ID/generation/start/yield/end deadlines, immutable predecessor-to-boot association and reserved successor generation. Exclude mutable run, effect, projection, control and invocation-state fields. Validate predecessor state separately. Only existing guarded transitions may move it to closed; failed state denies. Persist replacement-proof versions with distinct constructor nonces as append-only observations, never replacements for the original abort observation or invocation binding. Recovery-ready separately records closure-accounting state, control cutoff and completed pagination evidence.

The reset journal must not contain encrypted private payloads or editable copies of run/effect state. The accepted host remains their sole owner. A reset row is evidence about host termination, not a second run ledger.

## Ordered protocol

### 1. Reserve and deny ordinary work

The product controller conditionally reserves a reset for the validated session and enters `reset_pending`. This commit is a reset intent, never a witness. All candidate runtime authority reads now deny ordinary admission. Candidate model queries evaluated after that commit deny already-open windows and reserved requests. This does not invalidate an older positive permit response that is still in flight.

The candidate-only final product predicates must check the current host authority generation against the existing model attempt generation. Check this in the shared candidate facts used by `current`, `open`, `reserve` and `permit`, including checks after awaited calls. After recovery, an old-generation claim must still deny, even though the phase is active again. Preserve the accepted exact host claim and all credential/window/effect deadline checks. Do not change ModelSubjectV1, the synthetic model body, default `trusted_v1` policy or credential renewal/storage.

The dispatch-barrier linearization point remains an OPEN DESIGN BLOCK. The credential DO's last `policy.permit` can evaluate under generation N, then return its old positive response after reset and successor activation. The code immediately calls `fetch` without another host claim. Repeating the same asynchronous query cannot close this gap by itself. Before issuer implementation, specify a candidate-only dispatch/reset serialization or locally checked revocation mechanism, its durable acknowledgment and exact no-await transition into `fetch`. It must reject stale responses at every final suspension boundary without holding the priority Stop lane across provider or credential waits. Do not claim the reset reservation commit alone is a complete dispatch barrier.

A qualifying protocol must state whether a dispatch occurred before or after the acknowledged barrier, even if its admission/reservation happened earlier. Retain effects dispatched before that point as potentially live. A dispatch afterward must deny, including an old positive final query response. No reset or recovery-ready acknowledgment may assert a completed barrier without this proof. If the mechanism needs another credential-DO hook beyond the previously approved protected policy factory, stop for a separate scoped approval. Preserve default credential behavior and final authority checks.

A request already dispatched before the qualified barrier may remain in flight. Keep its original effect and occupancy evidence. Entering `reset_pending` neither refunds it nor proves remote completion.

### 2. Bind the exact predecessor locally

Through the trusted fixture callback, set a local no-new-ordinary-admission barrier and durably retain the reset intent. This must serialize with host invocation creation so no newer invocation can appear between predecessor capture and abort. It must also invalidate stale authority preparations when they return. Do not call `yield`, wait for Harness close, cancel a run as user Stop or edit an invocation to `closed`.

Read the exact latest invocation and its immutable originating-boot association from the existing host journal. Require it to equal the current preparation constructor. A missing association or boot mismatch blocks; aborting this constructor cannot certify termination of a different one. A failed invocation requires review. A missing or already-closed invocation is not the abrupt-takeover test case. If it closed while reset was being prepared, record that outcome and use separately tested graceful recovery, not fabricated abrupt evidence. Neither path may clear unknown effects.

Reconcile the locally captured predecessor into the reserved product reset using conditional writes. Verify the complete tuple on both sides. A changed predecessor or owner never becomes a different target under the same key. Do not proceed to abort on mismatched or incomplete preparation.

### 3. Invoke the supported reset

The controller obtains the validated object's stub and invokes the trusted per-object callback. Before the abort, that callback revalidates the local reset tuple and predecessor. It performs no Harness closure or run terminalization. Its final operation calls the pinned `state.abort` with the canonical opaque label.

An expected abort rejection is not a normal success response. The outside controller classifies it using the previously qualified runtime behavior and durably records that observation against the exact reset. Generic transport failures leave the reset pending. Never write `priorTerminated` in the dying instance or immediately before abort.

### 4. Observe the replacement without Pi

Obtain a fresh stub and call a private passive replacement probe. The probe must not call `activate`, open Harness, initialize configuration, create a conversation, invoke a provider or repair alarms by scheduling work.

It verifies the retained scope, local reset tuple, exact predecessor invocation and current constructor nonce. The replacement nonce must differ from the captured old nonce. The predecessor must still match, or have only the already-recorded guarded closure-accounting outcome on an issuance retry. A changed invocation fails closed. Persist the proof before returning it.

The outside controller combines the independently classified abort observation with this exact replacement proof. The probe is not itself the issuer. A new nonce without the abort observation cannot authorize takeover, including natural eviction or ordinary deployment shutdown.

Before issuance, obtain a fresh proof from the currently serving constructor. If it changed after proof persistence, append a refreshed proof only when the same terminated predecessor remains latest and no new unclosed invocation exists. The original classified abort must still target that predecessor's originating boot. Never rebind an existing witness. Subsequent reset of a successor with its own unclosed invocation needs a separate classified abort and witness.

### 5. Issue one witness and reopen only for recovery

One conditional D1 transition issues the reserved newer generation, exact `priorTerminated` value and immutable proof association, and enters `recovery_only`. Recheck current owner, identity and review/deletion fences here. A lost commit acknowledgment is recovered by reading the same row. Do not increment again.

Only this matching witness may reach `PiDurableHost.open`. Keep its existing generation and exact predecessor guard unchanged, then run its existing durable closure/interruption accounting before opening Pi. The witness proves local host termination only. It does not prove graceful close, provider cancellation, executor death or a known remote outcome. Keep conservative interruption time and all original recovery/effect deadlines.

Opening the host and allowing ordinary scheduling must be separate permissions during `recovery_only`. Add the smallest candidate-only barrier needed to allow passive recovery and priority control accounting while denying root creation, ordinary Pi submission, retry/summary scheduling and model/tool dispatch. Do not implement it by returning `current: true` everywhere and relying solely on provider rejection. Such a path could already submit or consume work before Stop is applied. Preserve existing noncandidate behavior and capacity-independent controls.

Enforce the local recovery barrier at ordinary invocation creation, queue start/consumption decisions, configuration/root initialization, run activation, consumption/submitting intents, numeric submission attachment that could enable work, `root.submit`, Harness resume and ordinary retry/summary/model/tool scheduling. Recheck after each suspension and immediately before the mutation or scheduling call. Harness open, safety reconciliation and wakeup repair must not bypass it. Existing receipt retention, guarded closure accounting and exact-target control reconciliation remain allowed even if an unknown effect blocks ordinary work. The passive replacement probe stays separate from `activate`.

An alarm or delivery that reaches an unissued replacement remains denied and retryable. An alarm in `recovery_only` cannot execute ordinary work. Keep durable wakeup intent; do not use alarm deletion as proof of closure. Use the pinned default alarm behavior, not new options or longer test deadlines.

### 6. Apply controls, acknowledge recovery and resume

Product admission and immutable receipt replay for owned Stop/cancel stay available during reset without model entitlement or an ordinary capacity slot. If a dead/unissued host cannot account for a delivered control yet, delivery remains pending. Do not acknowledge it as durably applied or consume its sequence position merely because its product receipt exists.

After witness issuance, the recovery-only host drains already-admitted priority controls before ordinary work. Product supplies bounded pages of trusted Stop/cancel references through a committed sequence cutoff, including controls already marked delivered that could have an incomplete local application. Persist the pagination cursor and reconcile every page through an explicit end marker. If a bounded recovery invocation cannot finish, retain recovery-only mode and its wakeup rather than omitting the tail.

A retained control receipt or `applied` product disposition alone is not completed application. Current Stop delivery can commit the product record and epoch-first `stopping` fence before task/submission abortion finishes. Recovery must use the existing exact-target stop/reconcile transitions to repair that partial application idempotently, without another epoch bump, and account local terminal membership/projections or retain an explicit remote-uncertainty fence. Inspect local stopping/control state even if duplicate delivery returns its stored acknowledgment. Cancellation likewise preserves one durable disposition and `too_late` outcome. Recovery-ready requires the completed local control reconciliation evidence, not receipt replay alone. It never certifies remote cancellation.

Controls beyond the cutoff use the ordinary priority delivery race semantics; a fresh local check still precedes each ordinary action. A cutoff is not permission to ignore a control already delivered locally.

Persist a DO recovery-ready acknowledgment tied to the reset, successor boot and issued generation only after guarded closure accounting, priority-control reconciliation and safety inspection. Preserve unresolved effects and workspace/executor/model occupancy. Recovery-ready may mean inspectable and fenced, not entitled to restart effects.

The product controller re-probes the current constructor, reconciles that boot's acknowledgment and conditionally marks the authority active. A replacement before activation must issue its own fresh recovery-ready acknowledgment after the same checks; a dead constructor's acknowledgment cannot activate it. If no new unclosed invocation exists, this recertification uses the already-issued generation and original witness without another reset. If one exists, block for its own termination proof. The DO clears its reset admission barrier only after a fresh read confirms that same active generation, acknowledgment and its own current boot nonce. A replacement after the product active commit but before local clear follows the same recertification rule. Lost responses on either side retry the same transition. Normal scheduling then resumes only through existing host safety, recovery deadline, queue decision, capacity and fresh model authority checks. Unknown effects remain a reason to deny work.

Stop fences committed before a crash remain committed. A delayed old-run Stop cannot affect a newer run. Cancel after a durable start remains `too_late`, not implicit Stop. Missing ordinary sequence positions remain gaps; recovery control delivery cannot skip them for ordinary consumption.

## Crash and retry rules

| Crash boundary | Recovery rule |
|---|---|
| Product intent committed, local preparation missing | Authority remains denied. Retry local preparation against the current exact journal; no witness exists. |
| Local preparation committed, abort not observed | Retry the exact reset against the old nonce after validating the tuple. If a replacement already exists without a classified abort, do not infer termination. Remain blocked for review. |
| Abort happened, controller lost its outcome before recording | A new constructor is insufficient. Do not issue a witness. This protocol intentionally fails closed rather than guessing. Report this availability limit. |
| Abort observation durable, replacement proof missing | Fresh passive probe can repair the proof. It cannot open Pi. |
| Replacement proof durable, witness not issued | Re-probe the currently serving constructor. Append a refreshed proof only with the same terminated predecessor and no new unclosed invocation. Issue one conditional successor generation. |
| Witness commit succeeded, acknowledgment lost | Read the canonical witness. Never abort the replacement or reserve another generation. |
| Witness issued, host closure-accounting commit not completed | `PiDurableHost.open` retries existing guarded accounting using the same exact witness. No ordinary scheduling yet. |
| Closure accounting committed, replacement resets before recovery-ready | Re-read the latest journal. If a new unclosed invocation exists, it requires its own classified reset and distinct witness. The old witness cannot terminate it. |
| Recovery-ready committed locally, product acknowledgment missing | Re-probe the current boot; retry only its matching acknowledgment. A different boot recertifies after safety/control reconciliation, or blocks on a new unclosed invocation. |
| Product active committed, local acknowledgment/clear missing | Clear only on a fresh owned read matching generation, acknowledgment and current boot. A different boot recertifies without reissuing the old witness; a new unclosed invocation requires its own termination proof. |

There is no safe witness-before-termination ordering. Only an intent can precede termination. The issued-witness-before-local-accounting and termination-before-witness orderings are separately recoverable as above. Losing the abort observation itself is an explicit block, not an undocumented success case.

## Proposed implementation scope after approval

Use the preserved execution worktree and a separate executor on `openai-codex/gpt-6.1-sol`, medium reasoning. The advisor never edits source.

Expected touch points are existing fixture entrypoints and `product-commands.worker.test.ts`, candidate composition/authority in `pi-durable-product-session.ts` and `session-command-candidate.ts`, the candidate model-policy predicates in `model-product-authority.ts`, and a minimal candidate-only host barrier plus nearest tests in `pi-durable-host.ts` / `pi-durable-commands.test.ts`. Reuse existing handwritten disposable D1 fixtures. No new deployment path, dependency, production reset API or shared database migration is permitted by this proposal.

Before source work, archive current corrected bytes and hashes. Preserve all four unchanged advisor probes and prior evidence. Scope expansion, a new termination mechanism, shared deployment binding or inability to separate passive open from ordinary scheduling requires another decision, not improvisation.

## Required evidence

All positive recovery tests use commands admitted by `CandidateProductCommands`, real local D1, encrypted DO SQLite and the mandatory private synthetic model adapter. Do not seed successful commands/membership. The standalone reset qualification is supplemental, never a substitute for this integration leg.

Required cases:

1. Qualify exact pinned abort outcome; reject generic exceptions and arbitrary RPC failure. A passive replacement proof makes zero Pi/provider/root-creation calls.
2. Reset actual admitted active work. Preserve predecessor ID, original receipt/messages, logical request IDs, sequence, configuration and encrypted payload association. Prove the correct witness permits guarded accounting, not a second logical submission.
3. Concurrent identical resets and lost issuance acknowledgment produce one successor generation. Changed owner/session/DO/predecessor/executor tuples, reused old witness and caller-provided authority deny.
4. Fault each table boundary above, especially termination before issuance and issuance before guarded accounting. Simulate controller restart from durable records, not an in-memory success flag.
5. Lose the abort observation deliberately. Assert safe pending/review with no resumed effects. Natural replacement without classified abort also denies.
6. Hold an old-generation preparation or permit across reset. In particular, hold the positive result of the last permit query after it evaluated but before it reaches the credential DO. Reset and reactivate, then release that old positive result. Prove zero new upstream dispatch, no successor overwrite and no occupancy release. Repeat for each suspension after authority preparation; a delayed query input alone is insufficient.
7. Admit Stop before reset, during pending reset and during recovery-only mode. Include disconnect, held configuration and capacity exhaustion. No ordinary submission races ahead of known priority controls; exact late old Stop leaves a newer run untouched.
8. Preserve cancel/start `too_late`, terminal late-member failure projections, existing completed assistants and queued configuration. No canceled or expired target revives after reset.
9. Keep unresolved remote effects and executor occupancy across reset. Fresh model/tool admission remains fenced. No refund, timeout-based release or shell replay.
10. Exercise native alarms after resume with no direct test call to `schedule`. Preserve queue and recovery deadlines. No test/runtime deadline increase or suppressed assertion.
11. Natural replacement before reset preparation must fail the invocation-to-boot comparison. Test replacement after passive proof and before issuance, after recovery-ready and before activation, and after product activation before local clear. No stale successor proof or acknowledgment implicitly enables another constructor.
12. Crash after the Stop fence/record commit but before task/submission abortion, then replay its receipt. Recovery must finish local reconciliation without another fence increment. Test more controls than fit one recovery page; no recovery-ready acknowledgment before the end marker.
13. Commit a review fence during reservation, issuance and activation separately. Each authority transition and fresh runtime read denies, while passive receipts and exact-target controls remain safe.

Run the nearest gates inside the existing isolated launcher:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime exec vitest run src/pi-durable-commands.test.ts src/pi-durable-effects.test.ts src/pi-durable-host.test.ts src/pi-durable-models.test.ts
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts
sh .execution-008/clean-run.sh pnpm typecheck
```

Then finish the remaining original 008 real-D1/control matrix and exact sequential aggregates, `contracts:verify`, `brain:verify`, `credentials:verify`, `runtime:verify`, `verify`. The existing isolated brain metadata prerequisite needs separate scoped preparation if not already authorized; this drafting approval grants no installation/cache operation. Longer outer command budgets do not change deadlines.

Record actual source hashes, reset identity bindings, abort classifier, every crash disposition and exact commands/results under `plans/evidence/`. Do not count historical pre-correction aggregates as final-byte verification. No tests have been run for this proposal. No hosted eviction, live-provider, retained-data, coding-tool parity, full D1 projection or L3 acceptance is claimed.
