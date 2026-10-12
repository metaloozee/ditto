# Bounded diagnosis

Provider/model/reasoning verified as openai-codex/gpt-6.1-sol/medium. MAIN read-only. No permanent patch, qualification repeat, dependency/cache change or aggregate run. Entry archive and hashes cover all 37 current intended files. `restoration.json` verifies 37/37 identical after precise removal of my diagnostics.

## Chronology and commands

Every test used `sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts`, followed by the filter below or no filter. Original five-second test and all runtime deadlines retained.

1. `two-case-entry.log`, filter `runs an actually admitted prompt|native alarms drain delivery order`: two passed, 51 filtered, clean teardown. 2629/4308 ms.
2. `two-case-trace.log`, same filter with synchronous scalar decision logs: two passed, clean teardown. Real claims admitted with final host yield remaining 576/621/523/266 ms, effect budgets above 59 seconds.
3. `full-original-deadline-trace.log`, sole unfiltered run: 36 passed, two failed, one isolation error, incomplete suite. Initial prompt and all three native turns passed. Discarded-observation=true preparation returned false; successor preparation timed out. For each failing preparation, first host permit passed with 153 ms yield remaining and every observed authority/receipt predicate true. Before final acknowledgment the HOST context aborted. ExactModelClaim swallowed AbortError into denied; credential caught claim_denied while its own signal was live and effect budget still above 58 seconds. This does not prove which asynchronous substage used the remaining time.
4. `reset-three-trace.log`, filter `private fixture reset preserves immutable host origin|private fixture recovery activates only`: three passed, 50 filtered, clean teardown. On the same claim path, durability/product/final-authority stages completed with 500/604/601 ms remaining.
5. `first-claim-yield-boundary.log` and `first-claim-yield-terminal.log`, filter `runs an actually admitted prompt`: deterministic temporary trigger added only to the original first test. Before admission call existing credential `holdModel("claim")`; after original drain await `waitModel()`, wait 1100 ms, then `releaseModel()`. Original assertions unchanged. Both runs fail the exact zero-fetch assertion in under four seconds, clean teardown. Second run observes host yield at -2 ms, host claim entry aborted at -443 ms, live credential signal with 58654 ms effect budget. Snapshot has failed member/projection/run, closed invocation, still-admitted effect, zero fetches. No earlier test is necessary.
6. Removed all own diagnostics and temporary trigger by exact edits. `first-restored.log`: original first test passes. `restoration.json`: all 37 entry hashes identical.

## Ranked hypotheses and outcomes

1. Original host work/yield budget exhausted during claim preparation. Predict host cancellation despite live credential/effect budgets. Supported by full-run cancellation and deterministic boundary reproduction. The exact full-run abort source/substage remains unobserved because yield-stage logging was added afterward.
2. Authority/generation/receipt predicate rejection before deadline. Predict false scalar at a guard. Refuted at observed failing first permits; no final predicate ran. Unobserved earlier/final authority changes cannot be ruled out universally.
3. Effect/credential deadline exhaustion. Predict expired operation or credential signal. Refuted in captured failures: about 59 seconds remained, credential signal false.
4. RPC/resource leak independently causes zero fetches and teardown. Predict zero-fetch requires resource/teardown failure. Refuted as necessary cause by both deterministic clean-teardown counterexamples. Full-run sqlite-shm cause remains unknown; no blind disposal or framework conclusion.

## Interpretation and next patch boundary

`pi-durable-host.ts` original lines 2534-2608 consume the receipt, await durability/product/fresh authority, then acknowledge. Original lines 4926-4934 schedule yield; 5313-5319 seal and abort owner context. `pi-durable-models.ts` lines 124-150 collapse claim exceptions, and lines 286-304 turn outer abort into a terminal provider event. The deterministic counterexample proves legitimate deadline rejection can leave a failed run and an admitted effect. It does NOT prove these semantics violate the accepted host contract, nor identify the historical initial-prompt failure's unique cause.

Small proposed diagnostic/preparation fix for parent authorization: mirror claim-hold settlement in `entry.ts` final-hold preparation. A request that ends without reaching its final hold should resolve a scalar false, and the test should explicitly assert true, rather than wait until the outer test timeout. This exposes denial promptly without making a red test green or extending any budget. It does not fix autonomous progress.

Before any progress fix, next discriminating test should use this one-test hold trigger at the existing claim boundary and inspect exact receipt claimed/state plus Pi terminal outcome. Decide whether host-yield interruption should preserve resumable work rather than become terminal provider abort; do not retry a consumed/uncertain effect or extend yield. A full-run substage/abort-source trace is still needed before attributing all historical failures or changing host policy.
