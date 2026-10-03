# 002: Prove a bounded runtime host

Status: BLOCKED on passed L0 evidence. Base: `bcce03e`. Phase: L1, host gate.
Depends on: 001. Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 3.2–3.6, 7, 9, 17–18; PD08–PD10, PD27 and partial PD07, whose product restart is completed in 008/010; OD2, OD5–OD6.

## Outcome

One open Pi Harness per owning runtime DO must yield and reopen without losing continuation, overlapping an old owner, or recording user cancellation. This is the first likely architecture blocker. Do not start downstream product work merely because imports succeeded.

The inspected upstream revision has passive `Harness.open`, but scheduling-enabling submission, resume, compaction, abort and wait operations. It has no proven bounded pump, and close may wait for non-cooperative work. Those are questions to prove with supported APIs, not gaps to patch privately.

## Current code and scope

`apps/runtime/src/session-runtime.ts` still exposes a container scheduler:

```ts
export type RuntimeScheduler = {
	schedule: (
		when: Date,
		callback: string,
		payload?: unknown,
	) => Promise<unknown>;
};
```

`apps/runtime/src/feasibility.test.ts` explicitly expects `SessionRuntime` not to own an alarm. That is an old-container constraint, not the direct-DO contract. Preserve useful behavior, not this assertion for the new class. `apps/runtime/vitest.config.ts` is the existing real-workerd test seam.

Scope: runtime candidate host, private clock/wakeup fixtures, relevant runtime tests/config and evidence. No product routing, retained user content, encryption claims, new engine, legacy removal, or deployment. L1 may use only disposable synthetic storage with a hard one-runtime/one-executor limit.

## Steps and verification

1. Read the exact L0-pinned public lifecycle/task APIs and the L0 evidence. Write a short host protocol in this plan's evidence before implementation: passive open, inspect, fresh authority/fences, executor reconciliation, permitted scheduling, bounded invocation end, durable wakeup and reopen. List every scheduling-enabling call. Pick and persist a finite invocation budget suitable for local tests; it is a safety bound, not a latency benchmark or hosted alarm-limit proof. A supported-lifecycle failure is a valid failed gate, not a requirement to force a passing design.
   Check: `pnpm --filter @ditto/runtime typecheck`, expected exit 0. If the public API cannot implement the protocol, record the L1 gate as failed and stop without a work-around.
2. Implement only the host glue needed for that protocol. Keep local state transitions short; no model/tool I/O inside `blockConcurrencyWhile` or a storage transaction. Persist wakeup intent before acknowledging work. Use one alarm policy covering runnable work, retry deadlines, unresolved effects and future projection/checkpoint work. A product callback must not re-enter a waiting runtime call.
   Add `apps/runtime/src/pi-durable-host.test.ts`. Run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-host.test.ts`. Assert passive startup and history/watch reads cause zero provider/executor admissions.
3. Fault the host during a prepared model request, a live tool and a sleeping/retrying task. Include a task which ignores cooperative cancellation. Demonstrate a bounded supported end to the invocation and no replacement Harness while the old one can still act. An unresolved host close is failure, not a reason to race a replacement. Distinguish killing a local workerd process from real hosted eviction.
   Same command. Assert recoverable committed progress, unchanged user-cancel state, one admission owner, and a durable future wakeup with no browser.
4. Drop alarm scheduling after intent commit, fail a handler and duplicate alarm delivery. Restart the runtime and any already-created credential-free transport fixture. Do not add product routing just to claim PD07; the real product-worker restart case belongs to 008/010. Reconciliation must repair retained intent and choose the earliest required deadline without depending on a process timer, browser or `waitUntil`.
   Same command, repeated against real DO SQLite. Node-only fixtures are supplementary.
5. Record supported APIs, exact bounds, task/version pins, crash points, commands and results under `plans/evidence/002-host-lifecycle.md`. Mark PD07–PD10 scope accurately; L1 is not complete until 003 also passes. Run `pnpm runtime:verify` and `pnpm verify`; verify retained brain code if its inputs changed.

## Acceptance and handoff

All host tests exit 0 and establish actual bounded behavior, passive activation and one owner. Mocked identity is local evidence only. No test may equate a stored timer or timeout error with process death. Keep all new calls to scheduling-enabling Pi APIs behind the guarded runtime transitions.

Stop on a needed maintained fork, private scheduler patch, second continuation engine, endless alarm handler or close which cannot be bounded safely. Report the upstream interface/change needed. OD2 requires review and supported upstream resolution; a failed gate does not authorize another architecture.

This is a conditional plan. Before coding, replace any guessed API detail with the verified L0 contract and record the revised base commit. Preserve the invariant and scope rather than mechanically applying stale paths. No reset, live request, deployment, staging or commit is authorized.
