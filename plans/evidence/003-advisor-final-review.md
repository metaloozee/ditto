# 003 final advisor acceptance

Verdict: **accept 003 as DONE for the reviewed disposable local scope.** With the previously accepted 002 gate, this completes local L1 in the preserved execution worktree. It does not accept product routing, retained user workspaces, hosted behavior or live providers. No commit, integration, deployment or worktree cleanup is authorized by this review.

Reviewed detached `/tmp/ditto-plan-003-998rQl` at `cf7bfbcbfb1900392cac795d21cc32d4f5982520`, with all source uncommitted. Every executor and independent subagent used `openai/gpt-6.1-sol` with Medium reasoning. The interrupted executor's correction was preserved and completed by a fresh executor on the same model and reasoning. Advisor source edits were not performed; advisor writes are confined to `plans/`.

Read the complete initial host, mandatory fixture and effects suite, the complete final correction patch and added tests, executor evidence, retained public-correlation and five-gap probes, and the target specification/public Pi interfaces. The advisor independently reproduced the failed signal-only bridge, accepted the conservative public-record protocol after 14 actual Worker tests and typechecking, and rejected the first source candidate after five real counterexamples despite passing broad gates. [Initial source review](003-advisor-source-review.md) and [targeted diagnostics](003-targeted-diagnostics.md) preserve those failures. [Executor evidence](003-effect-safety.md) preserves every earlier investigation and candidate result; its last correction section describes this final source.

## Accepted behavior

- The host alone owns command/run/message/submission/task/effect mapping, epochs, safety decisions and terminal member/projection intent. Pi owns continuation. Mandatory provider/tool adapters enforce exact authority and correlation, with no registered stock bypass, second effect ledger, shadow transcript or private scheduler patch.
- Generation binds its actual request hook/task and pinned public checkpoint. Compaction binds trusted task/range/owner evidence, then validates the retained prepared tuple and semantic request digest. Missing first-summary association, foreign or incompatible work and ambiguous producers deny before I/O. Logical request, Pi attempt, actual spending attempt and host invocation remain distinct.
- Validated bounded result evidence is durable before Pi consumes it. Matching public original result/terminal or retry evidence permits the same ledger row to become Pi-committed. Identical delivery is harmless, conflicting results retain a review block. The integration proves separate safety/Pi crash orderings, not atomicity merely because both use SQLite.
- Admission/result persistence failures deny live effects even when another failure marker cannot commit. Reopen derives denial from original admitted/unresolved effects. Healthy later writes do not clear the barrier; trusted storage reconciliation requires current authority and accounted-for disposition. Unknown shell/summary outcomes fail pending run membership and block every later model/tool effect across two real SQLite reopens and new command IDs. Original effects and executor accounting survive.
- Exact-run Stop advances its epoch before cooperative Pi cancellation, independent of ordinary sequence gaps/capacity. Stale preparation/result callbacks do not dispatch or publish current work. A local cancellation receipt does not prove remote termination; an uncooperative shell remains stopping or fails with a persistent block. The hard single-executor fixture does not free capacity merely by forgetting a live operation.
- Finite model/tool deadlines are distinct from host invocation work/drain and the fixed per-run 15-minute recovery deadline. Expiry is checked after asynchronous preparation and at result acceptance, even without an alarm. Terminal states do not revive. Settlement preserves completed assistants and atomically records the fate of pending members and bounded projection intent.
- Completed mutations, model IDs/context and follow-up membership survive local interruption/reopen without repeated I/O. Known model errors may authorize a separately recorded retry only with matching committed Pi evidence; no exactly-once spending claim is made.
- Actual bounded close, both authority-wait cancellation guards, yield-not-Stop behavior, same-DO alarm reactivation and native resource joins remain covered by all 53 unchanged 002 host assertions.

## Five reviewed corrections

All seven permanent correction cases were red against the preserved initial candidate and pass on the final source. The advisor reviewed every incremental source hunk and independently reran them.

1. Shared effect reservation is checked inside the short admission transaction and immediately before concrete dispatch. Typed reservation denial is not storage failure. A simultaneous real summary/tool request cannot admit or dispatch both.
2. Matching known nonretryable and retry-exhausted terminal compaction errors account for their original result without a fabricated summary. Pending members fail while previously complete assistants remain complete.
3. Final request admission and result barriers enforce the fixed recovery deadline after awaits. Separate preparation-crossing and response-only-crossing cases deny late I/O or Pi consumption and retain admitted execution evidence.
4. Trusted abrupt takeover records interruption/recovery intent alongside closure accounting. Without an exact termination timestamp, the prior invocation's durable start is a conservative lower bound. Existing deadlines are preserved; a late reopen never starts a fresh recovery clock.
5. Serviced reconciliation/Pi-retry/settlement and consumed inbox wakeups are removed before native alarm repair. Terminal no-work does not rearm the same past deadline indefinitely. Future retained reservations and uncertainty records survive.

## Independent final gates

All commands ran from the preserved worktree under `env -i`, the installed Node/pnpm executable PATH, `CI=1`, `NO_COLOR=1`, and isolated `HOME=$PWD/node_modules/003-advisor-logs/home`. No inherited credentials or live effects were used. Logs below are relative to the worktree and are also archived.

| Command/check | Outcome | Evidence |
|---|---|---|
| `pnpm runtime:verify` | passed, exit 0; both runtime typechecks, 6 Node checks and 121 Worker tests in 6 files, including 40 effects and 53 inherited host tests | `node_modules/003-advisor-logs/runtime-final.log` |
| `pnpm verify` | passed, exit 0; Biome, web types, 808 web tests, web build, runner types, 79 runner tests and runner build | `node_modules/003-advisor-logs/verify-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-effects.test.ts -t 'correction:' --reporter=verbose` | passed, exit 0; 7 actual correction tests, 33 original tests skipped by this focused filter | `node_modules/003-advisor-logs/corrections-final.log` |
| Unchanged original diagnostic config with `-t 'gap1\|gap2\|gap4\|gap5'` | passed, exit 0; 4 original diagnostic cases | `node_modules/003-advisor-logs/original-diagnostics-final.log` |
| Unchanged original diagnostic config with `-t gap3` | failed, exit 1; bounded observation waits for a dispatch that need not occur under conservative denial | `node_modules/003-advisor-logs/original-race-final.log` |
| Final source identity, 53 protected inputs and `git diff --check` | passed; source hashes unchanged through independent gates | `node_modules/003-advisor-logs/final-source-before.sha256`, `preservation-final.log` |
| Contracts | not run, unchanged | No contract/package change |
| 003 and local L1 | passed, accepted within this review's limits | This review plus accepted 002 |

The old race probe still waits for exactly one new dispatch before asserting, whereas the approved safety correction permits denying both contenders. Its timeout is preserved as a failed diagnostic, not called green or hidden. The permanent race regression synchronizes both actual admission preparations, reaches durable reservation evidence, and asserts at most one admission/I/O with no false storage-failure marker. The short transactional/final dispatch guards enforce that safety requirement. No historical assertion was weakened to manufacture a pass. Losing availability under this collision does not establish an unsafe dispatch.

## Exact source and archived evidence

| Source | SHA-256 |
|---|---|
| `apps/runtime/src/pi-durable-host.ts` | `193fd4406d4e7853589be6214c3621b38e2849a912273db73412aaa0bbc589ac` |
| `apps/runtime/src/pi-durable-cooperative-fixture.ts` | `b1d08d07e4112b95b8329cc40df5a94791bf666ef9594ccd0d77e21ff0dec6e5` |
| `apps/runtime/src/pi-durable-effects.test.ts` | `bf94586ac631d975b2f2c3f210681af2cdd197f3488cc16d4bcc9f87ae0937c2` |

[`artifacts/003/verification.tar.gz`](artifacts/003/verification.tar.gz) retains original/executor/advisor logs, probes, exact correction baseline, incremental patches, hashes and versions. SHA-256: `283bf4bded76efef8a5d0c67da87f6efcc65b42ddc5d8c7849bcd2cb16257acf`. `gzip -t` passed. CLI HOME and downloaded package caches are excluded. Extract into separate scratch storage, not over the repository. The worktree itself is preserved; archiving is not cleanup permission.

Pi Durable/pi-ai/Chord remain 1.0.1; Worker pool 0.12.21 resolves Miniflare 4.20260310.0 and workerd 1.20260310.1. Runtime Vitest/TypeScript/TypeBox remain 3.2.7/5.9.3/1.3.27. Node/pnpm are 24.21.0/11.8.0. Requested/effective compatibility remains 2026-09-16/2026-03-10. No September, hosted or new Docker image claim. Biome reports 29 warnings and no errors; configuration and suppressions are unchanged.

## Limits and next step

This is disposable plaintext, credential-free local feasibility code. Retained encrypted user state, real tools/write replay, actual Codex networking, hosted eviction/termination/isolation/capacity, product-handler Stop/restarts, projection transport, browser and a new Docker execution gate are **not run**. Local authorities and capacity/termination evidence remain synthetic. The initial paired recovery baseline is not implemented; no retained workspace is enabled.

A summary interrupted before its first validated prepared association remains denied. Ambiguous producer collisions may deny both candidates. Abrupt takeover may conservatively expire recovery up to one prior invocation early. Unsupported background/deferred/foreign/versioned paths remain rejected, not positively supported. These availability limits do not authorize identity guesses, shell replay or weaker guards.

003 source is accepted only in the detached worktree. The main checkout contains plan/evidence updates, not the source implementation. Integration and any commit need a separate explicit request. After the accepted source is available on the next execution base, 004 can be refreshed against it and separately executed. No later plan ran and no worktree was removed.
