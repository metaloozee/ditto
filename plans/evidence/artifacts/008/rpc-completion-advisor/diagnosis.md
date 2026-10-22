# 008 RPC/completion diagnosis

Bounded diagnosis only. No permanent correction. Candidate restored; 008 remains blocked and unaccepted.

## Result

The single original-order selection reproduces the known failure: exit 1, 12 passed, queued configuration timeout at unchanged 5000ms, 47 name-filter exclusions and one unhandled isolated-storage failure. Fifteen cases selected among 62 collected. Lost-started acknowledgment and Stop control-intent repair are selected but unreached, not passes or ordinary exclusions. Outer elapsed 45.156s; Vitest duration 41.23s. The exact argv/cwd is in command.json and full output in diagnostic-sequence.log. No full suite, typecheck, aggregate or second run.

The original command was:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

## What the boundary marks establish

All marks use constant stage names and scalar Date.now timestamps. Trusted private fixture methods enable the affected case, not prompt text, secrets or logged IDs. Sender marks start BEFORE invoking the service RPC. The composition returns its original RPC thenable, without wrapping it in an async function or adding .then. The host's existing awaitWithContext is unchanged. Receiver exit probes use try/finally and await the original receiver promise so exit means receiver-body completion. That adds promise-continuation overhead and logging, so timings are not guarantees.

Ten selection calls have creation durations of 0ms at millisecond resolution. Created-to-receiver-entry gaps are 51, 47, 47, 52, 51, 51, 52, 53, 109 and 54ms. Receiver-exit-to-sender-await gaps are 0 or 1ms. The seven explicit-configuration calls account for 422ms before receiver entry, 388ms inside receiver bodies and 4ms after receiver exit. This localizes the recurring cost after the RPC method returns its thenable and before the application receiver body. It is not synchronous RPC construction cost and not a large return-side await delay.

Twenty-four matched runtime-authority sends also construct their thenables in 0ms. Their entry gaps range 46–76ms; 22 are 46–54ms. Matched receiver bodies total 177ms. Several scope/alarm authority reads have no corresponding composition sender mark and are intentionally excluded. Configuration authority-await marks follow receiver exit by 0–1ms. rpc-intervals.json and scalar-events.json contain the original timestamps and derived intervals.

A particularly useful read-only sequence has fresh selection await at body +3566ms, followed immediately by the final selection sender mark. Receiver entry is +3618ms. In restored PiDurableHost.configurationAllowed:1607–1618, this path performs parsing/comparison, with no host storage write between those selection calls. This weakens a hypothesis that every fixed gap is caused by a new synchronous host write. It does not rule out earlier/background output-gate work.

The exceptional 109ms selection-entry gap overlaps a native alarm entering during configuration. Its receiver body then takes 125ms while two unmarked alarm/scope authority callbacks and reconciliation execute. This supports contention as a possibility for that outlier, not as a proved explanation of the regular gaps.

## First completion and follow-up preparation

Measured from actual test-body entry:

| Boundary | ms |
| --- | ---: |
| First poll starts | 1086 |
| First schedule enters | 1191 |
| Adapter guard starts | 1916 |
| Guard supplies prepared dispatch to adapter | 2103 |
| Private model transport starts | 2169 |
| Exact claim enters | 2387 |
| Exact claim exits after final host checks | 2574 |
| Private transport returns | 2603 |
| Result evidence persisted | 2609 |
| Member-completion transition observed | 2626 |
| Alarm invocation join completes | 2653 |
| First poll returns | 2654 |
| Reopen starts | 2705 |
| Configuration starts | 3026 |
| Configuration and retained-task comparison finish | 4312 |
| Second delivery finishes / final poll starts | 4457 |
| Follow-up schedule enters | 4684 |
| Follow-up adapter guard starts | 5054 |

The first poll lasts 1568ms. Its schedule-to-model-guard span is 725ms, containing repeated fresh authority and mandatory first-root configuration checks. Guard-to-prepared-dispatch is 187ms. Transport is 434ms, of which exact claim is 187ms, then 29ms remains until transport return. Result persistence is 6ms; member settlement appears 17ms later. These are finite serial costs, not evidence of a long final settlement stall. A member-complete mark is a transition observation, not a new durability guarantee; repeated reconcile calls also emit it for already-complete members.

Only 543ms remains when final polling starts. Follow-up schedule begins at +4684ms and its guard begins at +5054ms, already beyond the original test deadline. No second prepared-dispatch, exact claim, transport return or completed follow-up mark appears before storage isolation fails. The admitted-work preparation path itself consumes the remaining budget before two follow-ups can complete. It does not establish an indefinitely stuck follow-up or framework impossibility.

There is no credential final-fetch probe in this run. The transport and exact-claim marks bracket that path but do not individually measure every product/credential permit. Restored codex-credential-do.ts:310–365 was read: fresh permits precede claim; another permit follows host acknowledgment; cancellation, current permit bounds, credential revision and finalModelDispatch are checked before fixed-destination fetch. No safety step was changed.

## Pinned source/API evidence read

Full absolute installed paths, SHA256 values and line-numbered excerpts are preserved in pinned-source-excerpts.json. Abbreviations here resolve to the installed package roots recorded there.

- Chord 1.0.1 `dist/context/index.js:65–96`, especially 72–91. `awaitWithContext` returns the supplied promise when there is no abort signal; otherwise it adds an abort listener and calls `promise.then(...)`, removes the listener on settlement and resolves/rejects. There is no timer. Cancellation rejects only the waiter, not the underlying operation. Its package.json export maps the context import to this dist file; src/context/index.ts is absent from the installed package.
- Pool 0.12.21 `dist/worker/lib/cloudflare/test-internal.mjs:328–337,376–394,419–466`. Every named current-Worker RPC resolves a property through `getWorkerEntrypointExport`, which awaits `importModule`, which runs `instance.executor.executeId(specifier)` in the runner DO. The callable wrapper awaits that property before applying the actual receiver method. This entire path occurs before the receiver ENTRY mark.
- Same pool file `:137–152,185–213`. `runInRunnerObject` obtains the singleton runner DO and `runInStub` awaits its fetch, then extracts a result from actionResults. This adds a concrete test-wrapper/runner-DO boundary absent from the application receiver-body measurement.
- Vite-node 3.2.4 `dist/client.mjs:164–211`. `executeId` awaits `resolveUrl` before `cachedRequest`; module evaluation has a promise cache. The inspected code does not contain a 50ms timer. An export-cache correction in the installed pool would require dependency edits, forbidden here. No private runner APIs were invoked.
- Credential fixture `vitest.config.ts:27–43` binds CandidateProduct to the current Worker with named CandidateFixtureProduct. It therefore uses the above wrapper, rather than proving latency of an independently bundled production service.
- Pi Durable 1.0.1 `dist/harness/generation.js:254–310` throttles partial writes and drains the in-flight write in finally. This candidate's adapter emits a terminal done/error, not partials, after guarded result persistence. The partial-throttle timer is not a demonstrated source of service-RPC entry gaps.
- Pi Durable `dist/harness/output.js:185–242` has a minimum 100ms adaptive progress interval. `dist/harness/scheduler.js:1150–1165` has a generic abortable delay helper. Neither inspected excerpt establishes a fixed 50ms service-RPC delay, and no scheduler internals were called or modified.
- Restored host `pi-durable-host.ts:1582–1635` retains fresh selection/local-authority ordering; `:3718–3747` reconciles submission status and member state; `:5464–5498` reconciles before consuming candidate work and preserves active-invocation/yield checks. Product composition `pi-durable-product-session.ts:124–199`, fixture receiver `model-entry.ts:1102–1244` and private adapter `pi-durable-models.ts:167–305` were read before probing.

External API pages fetched and read:

- https://developers.cloudflare.com/workers/runtime-apis/rpc/ documents custom thenables with `.then()`, not native promises. This supports awaiting the result; it does not establish that bypassing awaitWithContext or disposing it early is safe.
- https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/ documents execution-context and stub lifetimes. It does not justify disposing the borrowed exact claim while credential dispatch still uses it.
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ documents outgoing messages waiting for prior writes to flush, and sync resolving when pending writes complete. No allowUnconfirmed, storage-gate bypass or extra sync was introduced.
- https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/ describes input/output gates. These APIs make output gating plausible but do not assign the observed gap uniquely to it.

## Predictions and decision

1. Synchronous creation/return-side adoption cost: rejected at this resolution. Pre-receiver transport/thenable/wrapper work remains unresolved. Chord's own implementation supplies no delay timer.
2. Output gate: not established. The read-only sequential case and concrete pool wrapper mean it cannot be called the unique cause. No gate bypass is safe or authorized.
3. Finite cumulative preparation and settlement: supported in this run. The first model settles promptly after transport return; the next preparation reaches the adapter only after the test budget is exhausted.

No supported single-variable correction hypothesis emerged that could be contrasted without changing dependency code, invoking private runner/scheduler APIs, changing composition semantics, weakening safety or deadlines, or introducing an unverified Worker bundle. CONTRAST NOT RUN. No permanent correction choices are justified. The unresolved boundary is RPC-thenable creation to entry into CandidateFixtureProduct, including current-Worker test-wrapper export resolution/runner-DO fetch and any runtime output gate. Stop for advisor review rather than inventing a correction.

## Preservation

Worktree stays detached at 2487d56291fb6196672b36cd9f9c632ef2dfa9c5. Active PI metadata is openai/gpt-6.1-sol, medium reasoning; no fallback used. Before probes all 37 actual source hashes matched MAIN's command-read-batch-advisor/final-source-sha256.json. All 37 exact files, including untracked implementation, are archived under entry-source/. Selected previous evidence is copied under this new artifact directory. Environment, dependency, cache and build trees are excluded; old artifacts remain.

Five source files were temporarily instrumented: host, private adapter, product-session composition, model-entry fixture and affected test. temporary-probe.patch is the exact incremental patch. All 37 now equal entry bytes and expected hashes; restoration-proof.json records each file and a zero-marker scan. final-source-sha256.json records restored hashes. git diff --check passes; staging remains empty. No MAIN writes, install, dependency repair, commit, push, deployment, provider/credential request, shared/retained DB mutation or deletion occurred. Existing confined credential-free clean-run launcher and unchanged deadlines were used. No secret values were encountered or reproduced. The absent improve closing-the-loop reference was not invented.
