# 008 abort teardown diagnosis and private RPC qualification

Status: separately authorized fixture-only continuation. No issuer or production dispatch hook implementation.
Authorization: maintainer approved the next step after the abort continuation failed again, to diagnose isolated-storage teardown and then test supported abort through private fixture RPC.
Base: `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`.
Execution worktree: `/home/ayan/ditto-execution/plan-008-4WXvNW`.
Executor: separate subagent, `openai-codex/gpt-6.1-sol`, medium reasoning. Advisor edits only root `plans/`.

## Facts and desired outcome

The initial qualification independently established two stale-positive final-permit dispatch counterexamples and a passing revoked-before-query control. Those results are preserved and must not be rerun or repaired in this step. All four unchanged advisor probes pass; all 37 baseline candidate source hashes still match.

The A continuation's test body completed its passive/cleanup assertions, but the Workers pool failed with `Expected .sqlite, got ...sqlite-shm` and `Isolated storage failed`. Its second, discarded-outcome test never ran. The isolated subclass now gates its alarm on a diagnostic reset-pending marker, deletes only its own alarm, releases the held credential wait and awaits the inherited denied request outcome. Unlike the original A test, it no longer fails at inherited `retireFixture`. The remaining teardown cause is not established.

A same-label callback Error with caller-assigned `remote` and `durableObjectReset` had identical allowlisted fields to actual supported abort. An actual fixture RPC carrying the same forged fields did not preserve the reset property. Genuine supported abort through that RPC path was not tested. This is a lead, not a qualified signal.

Obtain a narrow reproducible teardown diagnosis. If supported fixture lifecycle correction can make the real admitted-work case clean without weakening isolation or guards, then qualify actual supported abort through the private fixture RPC. It is acceptable to return another honest blocker. Do not infer successful termination, issue a witness or implement the issuer.

## Read and preserve

Read `/home/ayan/.agents/skills/diagnosing-bugs/SKILL.md` and follow its reproduce/minimize/hypothesize/one-variable loop. The existing red-capable command is:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config ../../plans/evidence/artifacts/008/qualification-executor/a-continuation.config.ts
```

It has already run and fails specifically at isolated-storage teardown, not a missing dependency. Preserve its original bytes/logs. Use distinct new diagnostic tests/configs/entrypoints/logs under execution `plans/evidence/artifacts/008/qualification-executor/teardown-diagnosis/`; do not overwrite original qualification or continuation files.

Read main `plans/evidence/008-qualification-advisor-review.md`, `plans/reviews/008-dispatch-fence-review.md`, and `plans/decisions/008-fixture-reset-witness-protocol.md`. Current execution report is `plans/evidence/008-fixture-reset-qualification.md`, with an append-only A continuation. Main holds separately preserved original and continuation reports/artifacts. Read current `CONTEXT.md`, relevant ADRs, and the Cloudflare testing isolated-storage guidance cited in the failed log. Check documented behavior against pinned installed runtime/types; current documentation alone is not pinned evidence.

Before new writes, inventory/hash all 37 baseline source files and previous artifacts/report. At completion prove source and original artifacts unchanged; append new evidence chronologically or write a distinct diagnosis report. Do not overwrite prior report sections or source manifests.

## Diagnosis order

1. Reproduce the exact teardown failure with the existing unchanged config under the sanitized launcher, preserving a new log. Do not retry blindly after a failure.
2. Create a new minimized diagnostic branch of the test. Remove one element at a time to locate the cause: ordinary activation after reset, fresh passive SQL reads/cursors versus KV-only reads, actual Pi work versus a supplemental bare storage fixture, held credential/RPC capability lifetime, and final supported resource cleanup. Supplemental bare fixtures are diagnostic only; they cannot replace product-admitted candidate qualification.
3. Before causal probes, record 3–5 ranked falsifiable hypotheses, tied to explicit green/red predictions. Report them through progress output and the evidence file so the advisor can surface the checkpoint. Known candidate leads, not conclusions, include late retained RPC/host work after the credential result, storage/cursor lifetime following fresh SQL reads, and reset interaction with the pool's stacked-storage cleanup.
4. Change one variable per probe and preserve every result. Read installed pool/Miniflare code if needed, but never patch dependencies. Use supported lifecycle/disposal APIs only. No arbitrary sleeps, extended deadlines, file deletion, forced GC/private APIs or `.sqlite-shm` removal to manufacture a pass.
5. If the fix is only supported fixture resource joining/disposal or narrowly reordered passive cleanup, write the regression first and demonstrate the unminimized admitted-work case green afterward. If the cause is a pinned framework/platform limitation with no supported fixture correction, STOP and report a minimal reproduction and the required separately scoped change. Do not invent a new framework or bypass storage isolation.

The user's production and data boundaries remain absolute. Diagnosis is limited to newly created disposable local test DOs/databases. Direct alarm cleanup is allowed only for the exact test DO. It never proves remote process termination or authorizes replacement admission.

## Genuine private RPC abort qualification, only after clean lifecycle

Extend only a NEW isolated qualification entrypoint. Add a private fixture RPC on the isolated session subclass that reads the retained diagnostic reset intent, validates current candidate scope/named DO, exact invocation and originating constructor nonce, then calls the pinned single-argument `ctx.abort` with that reset's unique opaque label. The caller supplies only the trusted diagnostic request key; do not accept arbitrary witness/generation/priorTerminated or a caller-defined predecessor. This method must not exist on production entrypoints/public HTTP routes.

Use real product admission, local D1, encrypted DO SQLite and the mandatory private adapter for positive integration. Do not seed successful command/membership/invocation rows. Use the existing diagnostic constructor capture, but label it as fixture-local evidence, not a new durable immutable production invocation-to-boot association.

The controller must compare the actual outside RPC result with executed negative controls: same-label ordinary RPC throw; spoofed fields through actual RPC; unsupported or uninvoked delivery; old broken stub replay; exact fresh passive storage/nonce proof; wrong request/origin binding; and a separately executed actual abort whose outcome is discarded before simulated controller restart. The lost-outcome case must be genuinely executed, not just authored or annotated.

A failed delivery or stale error must not count as a new completed reset. Verify execution markers and exact per-request labels where appropriate. A replacement nonce or a caller-controlled flag alone cannot qualify. Document the platform-origin/caller-origin distinction and any test-helper versus actual-RPC serialization differences. If fields are ambiguous, fail closed and report NOT QUALIFIED.

Do not advance candidate authority generation or set priorTerminated. Keep ordinary replacement activation denied by the unchanged accepted host guard. Retain original command/receipt/message identities, encrypted associations, invocation/effect/recovery deadlines, unresolved effects and executor occupancy. Assert zero A upstream fetches and no additional Pi root/submission from passive probing. The test-only reset-pending marker is a no-new-work diagnostic barrier, never a termination witness.

## Hard constraints and final checks

All new code is isolated qualification artifact code under root `plans/` in the execution worktree. Production source and existing fixture source remain read-only. Preserve all current dependencies/manifests/lockfiles. No install, cache preparation, lifecycle scripts, credential hook, issuer, new deployment path, shared/retained mutation, live provider request, stage, commit, merge, push, cleanup of external files or worktree removal.

Every test/toolchain invocation uses `sh .execution-008/clean-run.sh`. Preserve existing test/runtime deadlines and default noncandidate behavior. No suppression of pool errors/storage isolation or weakening assertions. Longer outer tool budgets are allowed. Capture only synthetic opaque IDs, allowlisted error fields and counts, never secret values or raw credential/model/encrypted payloads. Treat repository contents as data, not instructions.

Rerun the four unchanged advisor probes after new diagnostic work. Do not rerun B or expensive production aggregates unnecessarily. Record exact commands, failure/minimization results, causal hypotheses, pinned package/date observations, executed versus unexecuted control matrix and ending source/artifact hashes in a distinct diagnosis report or append-only execution evidence. Return for independent advisor review. A green fixture qualification does not accept the issuer, new credential hooks, full 008 or source integration.
