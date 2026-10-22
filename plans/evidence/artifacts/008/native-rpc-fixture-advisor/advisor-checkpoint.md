# 008 RPC and completion advisor checkpoint

Status: bounded diagnosis reviewed, no permanent source increment. Plan 008 remains BLOCKED and unaccepted. No executor is running.

## Preservation and review

Execution remains in detached `/home/ayan/ditto-execution/plan-008-4WXvNW` at `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`. The previous executor handle expired; fresh executor `3917379e-7b03-4a6` performed the continued investigation. All actual response metadata independently checked by the advisor uses `openai/gpt-6.1-sol`, medium reasoning. No fallback was used.

The advisor read the complete report, exact temporary patch and surrounding configuration/authority source, and checked the scalar event and RPC interval records. Five execution source files were temporarily instrumented, then restored: the host, private model adapter, direct-DO composition, private fixture entrypoint and affected product test. No installed dependency was changed. The probe preserves the sender's original RPC thenable, measures before its creation, and adds receiver entry/exit timing. Receiver exit uses an additional awaited continuation for measurement; that overhead and logging remain limitations of the diagnostic.

All 37 current source files independently match both archived entry bytes and the prior expected hashes, including untracked implementation files. Staging is empty and execution `git diff --check` passes. MAIN source remains untouched. Source/evidence copies and independent checks are preserved under `plans/evidence/artifacts/008/rpc-completion-advisor/`. No permanent fix, deadline change, authority cache, install, commit, integration, live-provider request or retained/shared DB operation occurred.

## What is established

The recurring configuration RPC gap occurs after thenable creation and before entry into the application receiver. The ten selection calls create their thenables within 0ms at millisecond resolution. Nine entry gaps are 47–54ms; one is 109ms and overlaps native alarm work. Return-side gaps are 0–1ms. For the seven explicit-configuration calls, the measured sums are 422ms before receiver entry, 388ms inside receiver bodies and 4ms after receiver exit. The advisor independently checked these intervals against scalar timestamps.

Twenty-two of 24 matched runtime-authority entry gaps are 46–54ms. Unmarked scope/alarm calls are excluded from that matched set. These measurements are not an exhaustive accounting of every RPC or a production latency guarantee.

A consecutive selection pair retains its 52ms entry gap without an intervening host storage write. This weakens a new-write-only output-gate explanation, but does not rule out pending or background gate work. The measurements do not assign the gap uniquely to any one mechanism.

Pinned Chord 1.0.1 `dist/context/index.js:75–91` attaches a `.then` handler and abort listener. It contains no timer. Cancellation rejects its waiter, not the underlying operation, so removing this adapter would not be a justified safety-preserving fix.

Pinned Workers pool 0.12.21 `dist/worker/lib/cloudflare/test-internal.mjs:419–463` resolves the current-Worker entrypoint export before applying each receiver method. That resolution awaits `importModule` at `:328–335`, which invokes the runner's `executor.executeId` through a singleton runner-DO fetch at `:137–152,185–187`. Vite-node 3.2.4 `dist/client.mjs:164–166` resolves the URL before consulting its module promise cache. The exact paths, hashes and excerpts are retained in `pinned-source-excerpts.json`.

The fixture uses a named current-Worker binding at `apps/credential-tests/vitest.config.ts:28`. Therefore the measured entry interval includes a concrete test export-resolution/runner-DO path. It does not isolate native production service-RPC transport. No inspected source establishes a fixed 50ms timer or justifies patching the test pool.

## Completion path

The first completion poll takes 1568ms. Scheduling enters at body +1191ms; the adapter guard starts at +1916ms, guarded preparation completes at +2103ms, and private transport spans +2169ms to +2603ms. The exact host claim accounts for 187ms of that transport. Result persistence takes 6ms, followed by a member-completion transition 17ms later. The alarm joins at +2653ms and the poll returns at +2654ms. This shows finite serial preparation cost rather than a demonstrated indefinite settlement stall. A logged member transition does not itself establish a new durability guarantee.

The final follow-up poll starts at body +4457ms. Follow-up scheduling enters at +4684ms, but its adapter guard starts at +5054ms, beyond the unchanged test deadline. There is no second prepared-dispatch or completed-follow-up observation before isolation fails. This is cumulative budget exhaustion, not evidence that a follow-up is permanently stuck.

## Actual gate

The original-order bounded selection ran once with all deadlines and assertions unchanged. Result: exit 1, 12 passed, queued-configuration timeout at 5000ms, 47 name-filter exclusions and one unhandled storage-isolation error. Among 62 collected tests, two selected cases were not reached: lost-started acknowledgment and Stop control-intent repair. They are not passes or ordinary filtered cases.

The causal contrast was `not run`: the executor found no supported single-variable correction that preserved the current composition and safety constraints. Full product suite, typechecks and final aggregates were `not run` in this continuation. The advisor ran preservation/metadata/whitespace checks, not another test invocation. Historical green gates are not new final-byte acceptance.

## Next decision

Another round of application timing marks is unlikely to distinguish the remaining wrapper-versus-native-transport question. A better next experiment is a bounded native-RPC auxiliary-Worker fixture contrast using the installed Miniflare/Workers pool and existing esbuild dependency. It must first prove supported bindings, shared disposable D1 access and isolation. It must retain the actual command and policy code, private RPC, native alarms, all fresh authorization stages and original assertions/deadlines. Direct in-process policy calls would not be an equivalent contrast.

This is an option for a separately scoped fixture probe, not an authorized topology rewrite or established fix. Current Cloudflare configuration documentation describes auxiliary Workers, but now documents a newer plugin. The advisor also read the installed pool's auxiliary-worker option handling at `dist/pool/index.mjs:7596–7613`. Pinned support and the exact binding/isolation design still need evidence before implementation. Do not copy newer plugin APIs, derive internal runner names, edit installed dependencies, bypass output gates, add a deployment path or claim that an auxiliary Worker necessarily solves the gate.

No correction to trusted runtime logic is justified by the current evidence. Complete product success with clean teardown, the original five sequential aggregates and independent whole-slice review remain required. 008 is not DONE, integrated, production-enabled or L3-complete.
