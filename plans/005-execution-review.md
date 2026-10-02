# 005 initial execution review

Historical initial verdict: **REJECTED AS INCOMPLETE.** The partial source is retained for repair; 006 remains blocked. The [continuation 3 review](005-continuation-3-review.md) is the current result: all gates and six probes pass, but missing startup/capacity, brokers and UI Git still prevent acceptance. R2 execution has resumed from the saved checkpoint. [005-RESUME.md](005-RESUME.md) records the active executor; earlier reviewed gates do not verify the startup delta.

## Candidate and authorization

- Parent: `/home/ayan/ditto`, branch `brain`, execution base `13480bc7f4daf9489a0aa7cf7fea071a1115c8c3`.
- Candidate: `/home/ayan/ditto-worktrees/plan-005-codex`, branch `codex/plan-005-transport`, same HEAD. Changes are unstaged and uncommitted.
- Executor: `61dfd224-ec17-448`, requested `openai-codex/gpt-6.1-sol`, reasoning `high`. The tool invocation records both settings. The executor separately confirmed the model but could not inspect reasoning metadata.
- Initial scope: 16 modified and 12 added source files. The advisor verified all 28 hashes against the executor manifest and checked the diff and new source. Hashes remained unchanged through independent verification.
- Evidence: [scope and diffs](005-review-evidence/initial/), [independent probes](005-review-probes.cjs), [gate script](005-review-gates.sh). The executor's own logs remain under the candidate's `plans/005-execution-evidence/`.

004 landed through `c317eaa` and `bfab209`, merged at `a788547`. All nineteen accepted hashes match the execution base. Its historical uncommitted-status text is not the current integration state.

No staging, source commits, integration, push, deployment, production access, shared database migration or paid tests are authorized. The advisor edits only `plans/`; source work and implementation verification remain in the isolated candidate.

## Continuation dispatch

The original executor was no longer resumable; the tool returned `Agent not found`. Executor `598541a8-cdd0-4fa` then continued in the same retained worktree with `openai-codex/gpt-6.1-sol`, High reasoning. Its registry entry and temporary transcript later became unavailable without a completion report. The advisor recovered its 42-path source, reran focused gates and confirmed all six review probes pass. See the [recovered continuation handoff](005-continuation-handoff.md). Replacement `c9365d4f-dcc2-410` stopped at the Codex usage limit after creating a worktree-local handoff, without source changes. All 42 recovered source hashes remain unchanged. The user's next continuation request dispatched retry `b5bf9a10-e631-402` with the same requested model and High reasoning. Full implementation and independent acceptance remain pending.

The probe's assertions are unchanged. Its synthetic fixtures now go into the candidate's ignored `node_modules/.cache/ditto-plan-005-review/`, so an executor rerun does not write parent files. Initial logs, diffs and fixtures remain preserved. The gate script accepts an evidence-directory argument for later rounds without overwriting initial results.

## Independent results

All twelve independent gate invocations returned zero:

| Gate | Result |
| --- | --- |
| Exact phase web selection | PASS, 142 tests |
| Binding graph | PASS, 2 tests |
| Remote tools | PASS, 15 tests |
| Runner typecheck and `runner:verify` | PASS, 94 tests and build |
| Runtime and root typechecks | PASS |
| `pnpm check` | PASS, 11 inherited warnings |
| `pnpm verify` | PASS, 830 web tests, 94 runner tests and builds |
| `pnpm runtime:verify` | PASS, 26 tests |
| `pnpm brain:verify` | PASS, 43 brain and 22 contracts tests, typechecks/builds |
| `git diff --check` | PASS |

Brain freshness selects three tests and skips three unrelated cases before the full suite. Local workerd reports its existing compatibility-date fallback. Neither is platform release evidence.

The independent probes run six behavioral checks: **three PASS, three FAIL**. Positive controls establish valid bridge parsing, already-expired rejection and ordinary text search. Failures are B03, G02 and G03 below. The first probe run hit its outer timeout because the child timeout used SIGTERM; the corrected probe uses SIGKILL for its own runaway child. Both logs are retained. No candidate source was changed to run these probes.

## Findings and required continuation

### R1. The bridge does not dispatch repository operations

`apps/runtime/src/server.ts:348` rejects every brain request except readiness and continuation. There is no `apps/runtime/src/executor-dispatch.ts`. `SessionRuntime.coordinator()` supplies no production dispatch adapter, and `session-runtime.ts:1288` still only calls its existing optional observation hook. The new CLI is not connected to a journaled command path.

Implement the complete Worker dispatch behind the existing coordinator. Persist logical identity, arguments, incarnation, epoch, policy and finite deadline before Sandbox RPC. Reconcile identical admission without redispatch; an ambiguous shell acknowledgment becomes unknown, never an automatic retry. Await encrypted result persistence before returning tool content to the brain. Preserve 004's epoch, Stop, fatal-latch, unresolved-writer and scheduler guarantees. Transport-facing tool definitions must have no trusted-host filesystem/process fallback. Real Pi loop integration remains 006.

Tests must submit an authenticated command, drive the fake provider through production bridge/dispatch, execute against an isolated executor fixture and observe durable results. Inject dispatch and persistence failures. Prove zero trusted-host tool calls, not merely an empty resource-loader list.

### R2. Startup and admitted-operation authority have readers but no complete writers

`runtime-egress.ts:109-166` queries startup and operation authority, but `session-command.ts:1163-1166` still writes null startup-role, pool, identity and deadline fields. No product identity/capacity service or admitted-operation materialization path was added. `sandbox-authority.ts:533-538` intentionally still denies trusted brain windows through the legacy API. Do not simply remove that legacy fence.

Add product-persisted command/startup, builder and approved migration intents with immutable owner/version, target, roles, pools and deadline. Implement narrow product callbacks that freshly resolve those references. Registration must be idempotent and assign incarnation under that intent. Rotation, retirement and release need their matching lifecycle intent and trusted termination evidence. Body-supplied identities or pools cannot enlarge authority. Startup must work before any model/tool window exists.

Add runtime-owned admitted execution/privileged windows tied to actual coordinator decisions, not HTTP prompt acceptance. Revalidate after awaited reads and before effects; close authority on Stop, settlement and lifecycle/deletion fences. Test fabricated, expired, cross-session, replayed and superseded references, owner/incarnation mismatch, pool expansion and deletion races. Keep real-user paired-baseline and capacity gates closed until later phases; fixtures may provide valid prerequisites without weakening production checks.

### R3. Privileged transport and project-value materialization are absent

`runtime-egress.ts:196-202` unconditionally rejects classified model, Git and action requests. The product entrypoint still provides only phase-004 adapters; `runtime-product-service.ts` does not exist. `RuntimeEntrypoint.modelConfiguration()` at `server.ts:393-397` always returns false.

Implement runtime-only model attach using the existing full fixed-model contract and current admitted effect. Preserve one atomically consumed metadata allowance, no refund on upstream failure, and closure plus coordinator review after three denials. Keep model keys out of the product service result and both containers.

Extract/reuse the existing Git validation and response policies without importing the mixed legacy broker into runtime. Runtime sends a freshly reconstructed credential-free request plus trusted operation reference to the product named entrypoint. Product freshly revalidates authority/repository/ref/epoch and performs repository-scoped mint, attach and upstream fetch itself. Never return installation tokens.

Add `executionEnvironment({effectId, identityId, incarnation, ownerVersion})` at the product boundary. It must resolve a current admitted execution record, decrypt only in product, and deliver values only to Worker dispatch for the authorized shell child. Redact results in trusted Worker processing before delivery/projection. Never persist plaintext values, serialize them into jobs or put them in brain/container launch, Git, preview, builder, control, backup or restore environments. Runtime must not bind auth secrets.

### R4. UI Git still bypasses the new command boundary

`packages/runtime-contracts/src/command.ts:15-37` has no Git command variants. `apps/web/src/integrations/trpc/routers/session-git.ts` remains unchanged and uses direct legacy leases and operations. No model-free Git idempotency or coordinator serialization tests were added.

Add strict session-scoped Git business inputs and server-issued command identity/sequence through the existing authenticated admission and receipt system. Additive persistence changes must preserve historical migrations and existing records. Same-key retries return one command; conflicting payloads reject without side effects. Model-free Git creates no prompt-message pair and works with model configuration unavailable. Route trusted-owner tRPC adapters through fixed commands; preserve fenced legacy behavior until cutover. Agent Git remains effects in its current run, not a fresh browser command. Both paths share branch/ownership/secret preflight and closed Git children. Keep push and PR export gates disabled and add no merge/close capability.

### R5. Required boundary evidence remains missing

The new local target uses correct-looking named bindings and tests their configuration. However, it does not prove an unbound Worker cannot invoke a named entrypoint in local workerd. The product HTTP negative test invokes the seven-line private fixture Worker, not `apps/web/src/server.ts`'s real default handler. Existing T30 only supplies values directly to the shell helper; it does not test admission, both-container launches, Git/environment service crossings or redaction. T29 does not test a trusted-brain failure path.

Complete those local tests with positive controls, actual application entrypoints and pinned SDK handler registration. Distinguish platform-base substitutions from local workerd capability evidence. The inherited full gate is green but cannot prove absent functionality. P-Bridge, P-Model and P-Git remain NOT RUN until separately authorized; Docker build/boot has not been verified.

### R6. Bridge deadline is checked against time before the body read

`brain-transport.ts:114` awaits the stream; line 137 then compares the request deadline against the earlier `now` argument. There is no elapsed-time bound around `reader.read()` at line 74. Probe B03 advances the clock during the stream read and observes an expired envelope accepted after completion. B01/B02 prove normal parsing and already-expired rejection.

Bound body-read time and cancellation, sample the current clock after awaited parsing, and revalidate the deadline before dispatch. Preserve deterministic clock injection. Add tests for a stream that stalls, expires during reading and expires during authority lookup. Do not fix only by enlarging the timeout.

### R7. Grep's synchronous regex can defeat cancellation

`packages/sandbox-runner/src/remote-tool.ts:502,516` evaluates caller-supplied JavaScript regexes synchronously. Probe G03 supplies a short pathological expression and a 50 ms tool deadline; the child remains occupied until the review process kills it after four seconds. An AbortSignal timer cannot interrupt synchronous regex execution.

Move search to a bounded, cancellable image-owned operation with linear-time regex behavior, or isolate pattern execution with a killable process. Use a fixed executable and closed environment; no repository-selected binary or dynamic tool download. Preserve finite deadlines, bounded output and meaningful regex semantics. Add the failing scenario before the fix and retain ordinary-pattern positive controls.

### R8. One binary file breaks a directory text search

`remote-tool.ts:511` decodes every walked file with fatal UTF-8 decoding. Probe G01 finds a text match; adding one unrelated binary file makes the same search reject with `utf8` in G02. This affects ordinary repositories with images. The bounded walker also ignores neither full `.gitignore` rules nor the original match/context counting semantics.

Preserve fatal decoding for explicit text-file reads, but make directory grep handle binary files as a search tool rather than abort the entire query. Restore the pinned Pi search contract, including ignore files and match limits distinct from context lines. Avoid duplicating Pi's semantics in an ad hoc walk when a fixed image-owned search executable can provide them. Test text plus images, ignored paths, negations, nested ignore files, single-file search, context and bounded truncation.

## Review scope

All 28 changed source paths trace to the chosen plan. The public-egress extraction, relative-import changes, local contracts dependency and additive executor CLI are relevant, not scope violations. Existing coordinator, journal, encryption and reconciliation source bytes were unchanged in this candidate. That limits its regression exposure but also confirms dispatch and UI Git were not implemented.

No source is accepted for integration by this review. Preserve the initial diff and hashes before repairs. Continue in the same uncommitted worktree, write regression tests for the confirmed defects, finish the missing plan behavior, then rerun the exact gates and independent probes. If a security-boundary stop condition appears, stop and report it rather than weakening the contract.

## Skill-reference limitation

`/home/ayan/.agents/skills/improve/references/closing-the-loop.md` returned ENOENT. Execution follows the user's supplied isolated-executor and independent-review contract. No unavailable-reference compliance is claimed.
