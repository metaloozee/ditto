# 003 execution review

Historical review of the initial candidate. Superseded by the [003 repair acceptance review](003-repair-review.md). Findings and failed evidence below describe the original candidate, not the accepted repair.

Verdict: **REJECTED. Candidate needs repair; 003 is not complete and 004 remains blocked.** The inherited verification gates pass, but independent probes reproduce failures in the new admission and delivery paths.

## Candidate and scope

- Advisor checkout: `/home/ayan/ditto`, branch `brain`, base `d18bf57`.
- Executor checkout: `/home/ayan/ditto-worktrees/plan-003-grok`, detached at `d18bf57`.
- Executor: `xai/grok-4.6`, agent `453bb095-5abc-490`. This execution's user request overrides the older model preference recorded in the plan.
- Candidate: 11 modified and six new source/test files. All changes remain unstaged and uncommitted. No merge, push, deployment, shared migration, live database access, paid platform test, or real-user enablement was performed.
- The advisor changed only files under `plans/`. Source in the advisor checkout remains unchanged.

The [scope manifest](003-review-evidence/candidate-scope.json) records all candidate source hashes. The [tracked diff](003-review-evidence/candidate-tracked.diff) preserves existing-file edits. New source remains in the executor checkout and is covered by the manifest. These artifacts identify the reviewed candidate, not a commit or an accepted implementation.

The executor changed the planned command/contracts/adapters and added a batch-fault hook to `sqlite-d1-test-utils.ts`. That supporting test seam serves the requested rollback tests. Historical migrations, Alchemy, dependency manifests/lockfiles, runtime/brain/runner source and generated route source have no final tracked changes. The accepted R5 boundary is preserved. The source-relative contracts import is a reported deviation from package-export consumption, discussed below.

The improve skill's `references/closing-the-loop.md` is absent. This review follows the explicit execution-and-review rules supplied by the user; no compliance with an unavailable reference is claimed.

## Independent verification

Commands ran inside the executor checkout with Node `v24.21.0`, npm `12.0.2`, and pnpm `11.8.0`.

| Command | Advisor result |
|---|---|
| Focused command, delivery, capacity, legacy service/ownership and route suites | PASS: eight files, 98 tests. |
| `pnpm verify` | PASS: check, web typecheck, 70 web files / 736 tests, web build, runner typecheck, 79 runner tests and runner build. |
| `pnpm check`, within `verify` | PASS with 11 warnings. |
| `pnpm runtime:verify` | PASS: typechecks and 20 tests. |
| `pnpm brain:verify` | PASS: contracts typecheck/build and 14 tests, consumer freshness check, brain typecheck/build and 43 tests. |
| `git diff --check` in both checkouts | PASS. |
| Advisor behavioral probes | FAIL: 12 failed checks, three passing checks, two informational observations. Failures are grouped below, not 12 independent defects. |

Logs are under [003-review-evidence](003-review-evidence/). The brain freshness selection skips three unrelated tests; the subsequent full brain suite runs all 43. Runtime verification warns that the installed local runtime falls back from compatibility date `2026-09-16` to `2026-03-10`. This is local evidence, not paid-platform validation.

The focused command was:

```sh
pnpm --filter @ditto/web exec vitest run \
  src/lib/session-command.test.ts \
  src/lib/session-command-delivery.test.ts \
  src/lib/workspace-runtime-capacity.test.ts \
  src/lib/agent-run-service.ownership.test.ts \
  src/routes/api.agent.stream.test.ts \
  src/routes/api.agent.control.test.ts \
  src/lib/agent-run-service.test.ts \
  src/lib/agent-control-service.test.ts
```

Reproduce the independent failures from the advisor checkout:

```sh
node plans/003-review-probes.cjs /home/ayan/ditto-worktrees/plan-003-grok
```

Expected result for this reviewed candidate: exit 1, 15 checks / 12 failures. [Probe source](003-review-probes.cjs) and [captured output](003-review-probes.log) are retained. The probes transpile actual candidate modules without editing them. HTTP probes capture production POST handlers and substitute auth, route registration, database construction and unused legacy entrypoints. Trusted command services and SQLite persistence remain real. Inputs and databases are synthetic. This is not cookie-authentication or Cloudflare evidence.

## Blocking findings

All paths and line numbers below refer to the executor checkout.

### R1. Default routes allow callers to create trusted sessions

Priority: P1. Evidence: `apps/web/src/routes/api.agent.stream.ts:48-66`, `api.agent.control.ts:41-59`, and `apps/web/src/lib/session-command.ts:622`.

Both production handlers choose trusted admission solely from a browser-supplied `version` field. A versioned first prompt on an ordinary owned project creates a `trusted_v1` workspace session. There is no server-owned test eligibility gate. This violates the phase boundary that defaults remain legacy and only explicitly eligible test sessions enter trusted admission.

The captured-handler probes submit a first prompt without a session and without any feature eligibility. Both routes return 202 and create one trusted workspace session, a message pair, a command, a key and delivery work. In this candidate that work cannot progress because the configured transport always throws.

Repair: introduce a server-owned eligibility decision at the production admission boundary, including first-session creation. Do not treat protocol version as rollout permission. Default requests must not create trusted work. Test transport/eligibility injection may enable the authorized fixture without enabling ordinary users or changing Alchemy. Verify both routes through their actual authenticated handlers.

### R2. Trusted transport is a stub backed by the wrong model configuration

Priority: P1. Evidence: `api.agent.stream.ts:52-61`, `api.agent.control.ts:45-54`, `workspace-runtime.ts:1154-1167`, and `session-command.ts:971-979`.

Each adapter independently constructs this behavior:

```ts
modelConfiguration: async () => ({
  configured: Boolean(env.OPENCODE_API_KEY?.trim()),
  protocolVersion: SESSION_RUNTIME_PROTOCOL_VERSION,
}),
deliver: async () => { throw new Error("runtime_unavailable"); },
control: async () => { throw new Error("runtime_unavailable"); },
```

That is not a private runtime transport or a runtime configuration probe. The new path reads the legacy product key, and the scheduled path can never deliver a command. The probes observed a product-key read in each trusted handler. Admission also ignores the returned protocol version: a transport reporting version 2 still admits a version-1 command and writes rows.

Repair: use one narrow transport resolver shared by admission and scheduled delivery. The default unavailable transport must fail closed for new model-requiring admission, while eligible trusted Stop intents remain durably recordable during a transport outage. Inject the transport below the production handlers for local tests. Validate the supported configuration protocol. Do not remove the legacy key binding, add deployment wiring, expose keys, or implement the coordinator under this repair. If binding/dependency scope must expand, request approval rather than substitute another inline stub.

### R3. Accepted thinking settings are not durably stored

Priority: P1. Evidence: `apps/web/src/lib/session-command.ts:102-110`, `:688-734`, and `:797-799`.

Admission hashes the requested thinking level, but persists no reconstructible thinking field. The outbox payload is only `{commandKind: "prompt"}`. Messages store the text/model; command rows store IDs and a digest. An accepted `max` request loses its execution setting when the request ends.

Repair: persist every supported normalized execution parameter atomically with command admission. The existing bounded outbox payload can hold settings without embedding a transcript or altering historical migrations. The receiving side must be able to reconstruct the admitted command from persisted message references and settings alone. Add a test that admits each thinking level, discards request state, and reconstructs the same setting; retain stable message/command IDs on retries.

### R4. Delivery cannot acknowledge work and starves later commands

Priority: P1. Evidence: `apps/web/src/lib/session-runtime-client.ts:21-22`; `session-command-delivery.ts:114-137`, `:191`, and `:245-273`.

The transport returns `Promise<void>`, so there is no accepted-position/receipt acknowledgment contract for 004. Success and failure both call `releaseDeliveryAttempt`, which sets `deliveryState` back to `pending`. Candidate selection even includes `delivered` rows. Nothing removes successfully handed-off work from ordinary retry selection.

With 26 admitted commands and three scheduled-style passes one minute apart, the probe records 75 resolved calls for only the first 25 commands. Command 26 is never delivered. This is an indefinitely undeliverable tail, not a coordinator-deduplication claim.

Repair: define and validate the phase-004 acknowledgment contract now, while leaving actual coordinator acceptance to 004. Record successful handoff independently from execution status. Retry the same IDs on missing, lost or invalid acknowledgments; do not settle messages or release execution capacity. Accepted work must stop occupying the undelivered queue. Test more than one pass of backlog, actual acknowledgment loss, predecessor-retry responses, duplicate handoff and priority Stop using only transport faults and persisted observations.

### R5. HTTP parsing bypasses the strict JSON contract

Priority: P1. Evidence: `api.agent.stream.ts:40-48` and `api.agent.control.ts:34-41`.

The handlers call `request.json()` before invoking the strict parser. Native JSON parsing erases duplicate keys. A body containing duplicate version fields, with version 2 followed by version 1, is rejected by `parseBrowserCommandV1(raw)` but accepted by both production routes with 202 and durable rows.

Repair: preserve the raw, bounded request body for strict versioned-command parsing. Enforce the encoded-byte limit while reading, not only after native parsing and reserialization. Keep legacy discrimination backward-compatible, but never route malformed/unsupported versioned input into legacy execution. Add captured-handler tests for literal and escaped duplicates, byte limits, malformed JSON, unsupported versions and forbidden authority fields.

### R6. Delivery exceeds its pass budget and can retry without backoff

Priority: P2. Evidence: `session-command-delivery.ts:174-175`, `:214`, `:231`, and `session-runtime-client.ts:29-39`.

The code shortens the D1 lease to the remaining pass budget, not the transport timeout. A call can still take five seconds after almost all of the 20-second pass has elapsed. Retry time is calculated before the call, so a slow failure consumes its own backoff.

The logical-clock probes demonstrate a 24,500 ms pass with five calls of 4,900 ms each. A failing 4,900 ms call is retried immediately at 4,900 ms, with none of the required one-second post-failure delay. These are deterministic policy tests, not platform timing measurements.

Repair: bound each call by the smaller of the service timeout and the remaining pass budget, rechecking after persistence work. Persist retry time from the failed attempt's completion. Preserve separate delivery leases and execution/capacity authority. Add deterministic tests for slow calls, timeout, post-failure jitter bounds, clock advancement and lease takeover.

### R7. Text normalization is missing

Priority: P2. Evidence: `session-command.ts:102-116`, `:937`, and `packages/runtime-contracts/src/command.ts:307-312`.

The new path neither trims prompt/follow-up text nor rejects whitespace-only text. The inherited legacy schemas normalize text, and plan 003 explicitly requires consistent normalized hashing. A retry of `hello` as `  hello  ` conflicts; a whitespace-only prompt creates a message pair and command.

Repair: define the same normalized text once before hashing and persistence, reject empty normalized input, and preserve all meaningful interior text. Test prompt and follow-up normalization, default thinking equivalence and conflicts on genuinely different payloads through the handler fixture.

### R8. The required production-handler and delivery-fault tests are absent

Priority: P1 acceptance gap. Evidence: `apps/web/src/test/session-runtime-fixture.ts:235-245`, `:129-133`, `session-command-delivery.test.ts:69-117`, and `session-command.test.ts:306-327`.

`asUser().command` calls `handleSessionCommandRequest` directly with a supplied user ID. It never invokes either route or its auth adapter. Thus T01/T02 are service tests, not the captured production-handler tests required by the plan. The unchanged route suites do not exercise versioned admission.

The fixture transport always resolves. The test labeled lost acknowledgment only rewrites `deliveryLeaseExpiresAt`; it never loses an acknowledgment. The missing-predecessor test checks ordinary ordering without a predecessor error. Recovery admission tests exercise only one of the six unavailable variants. No new test covers the production scheduled dispatch path, supported acknowledgment shape, first-class receipt observation, timeout/budget behavior, delivery-storage failure, or runtime protocol mismatch.

Repair: retain the useful SQLite batch fixture, but drive admission through captured production POST handlers and the existing injected-auth convention. Inject transport/storage faults underneath real services, not service outcomes or coordinator decisions. Add receipt/message observations and all unavailable-recovery cases. Correct T03/T04 and T06/T07 labels. Keep coordinator execution dedupe and consumption explicitly blocked on 004; do not replace missing integration tests with assertions about class names or source text.

## Confirmed useful behavior

The rejection is not a claim that the whole candidate is unsound:

- New admission uses a real D1-style atomic batch. The advisor repeated faults at all nine first-session statements and observed no retained session, message, command, key, work or sequence row.
- Independent deletion and ownership-transition races between the initial read and persistence reject with zero new command/message/work rows.
- Existing tests cover concurrent same-key convergence, conflict rejection, first-session retry and retry after model-configuration loss.
- Trusted command rows remain excluded from the inherited legacy expiry/failure helpers in the exercised tests.
- All six recovery discriminants exist, and admission rejects recovery kinds instead of dispatching them to missing handlers.
- No candidate code launches Pi or implements phase-004 coordinator consumption. The accepted shared-policy credential boundary remains intact.

## Considered and not used as rejection grounds

- Receipt shape: existing `ReceiptV1` has no direct user/assistant message-ID fields. Their absence alone is not a regression or a reason to expand the contract. Verify immutable message mapping through the planned receipt observation instead.
- Post-tombstone delivery: a probe observes an outbound call after a deleting flag and tombstone. That does not prove unauthorized execution or record recreation. The future consumer must revalidate lifecycle/ownership; 004 and 009 retain that obligation. The probe records this as informational rather than claiming an execution vulnerability.
- Missing real coordinator, real cookies in every test, or paid topology: deliberately outside 003's local acceptance. R8 asks for production-handler coverage with mocked auth, not an auth rewrite or Cloudflare acceptance.
- Keeping `OPENCODE_API_KEY` for the legacy route: expected until later cutover. R2 concerns the new trusted path consulting it, not removal of the existing binding.
- Relative contracts import: `session-command.ts:30` reaches directly into `packages/runtime-contracts/src/command.js`. This bypasses the planned package-export boundary but adds no demonstrated credential leak. Resolve package-consumer scope explicitly during repair; do not silently change manifests/lockfiles or make this cosmetic concern the main blocker.

## Repair order and handoff

1. Repair R1/R2 and establish R8's actual production-handler fixture before relying on further admission results.
2. Repair strict body handling and normalization, then durable setting persistence. Extend ownership, idempotency, control and unavailable-recovery cases.
3. Define handoff acknowledgment semantics, repair delivery progression and timing, and exercise the scheduled adapter with injected transport. Do not implement phase 004 or settle trusted execution from the dispatcher.
4. Rerun the named narrow suites, the advisor probes and all three inherited gates. Review the actual final diff and any supporting scope expansion again.

The candidate remains available in its detached worktree for a separately requested repair. It must not be treated as an accepted dependency for 004. No source repair, staging, commit, merge, push or deployment was performed by the advisor.
