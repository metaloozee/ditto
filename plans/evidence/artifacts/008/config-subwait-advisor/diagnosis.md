# 008 configuration sub-wait diagnosis

Diagnosis only. Candidate restored. 008 remains incomplete and unaccepted.

## Finding

The current configuration wait is distributed fresh authorization, not an ordinary owner-lane stall or supported Pi configuration/persistence stall. In this one instrumented original-order run, configureOwned takes 1196ms through its final finish marker. Seven product authorization stages total 843ms, and five separate fresh local-authority callbacks total 324ms. Together these account for 1167ms, about 98% of measured host configuration time.

There is no indefinitely pending configuration sub-wait in this run. Configuration returns applied at test-body +4489ms. The unchanged 5000ms test deadline is reached after second delivery, during the final completion poll. This differs from the earlier pre-batch body trace that crossed the deadline inside configuration. It does not show a permanent improvement or make the bounded sequence green.

## Preservation and scope

- Worktree only: /home/ayan/ditto-execution/plan-008-4WXvNW.
- Detached HEAD stays 2487d56291fb6196672b36cd9f9c632ef2dfa9c5; staging remains empty.
- Active harness metadata: openai/gpt-6.1-sol, medium reasoning. No fallback was invoked.
- Before archive or probes, all 37 actual source SHA256 values matched MAIN plans/evidence/artifacts/008/command-read-batch-advisor/final-source-sha256.json.
- entry-source-and-evidence.tar.gz contains all 37 source files, including untracked implementation, and six selected MAIN evidence files. Environment/dependency/cache trees are excluded. All previous artifacts remain.
- Only three source files were temporarily changed. temporary-probe.patch is the exact incremental patch against entry bytes. It was inspected before the run. Instrumented hashes are recorded separately.
- All 37 files now equal both their archived entry bytes and the MAIN expected hashes. restoration-proof.json records each entry/archive/restored hash and exact-byte comparison. final-source-sha256.json is the full restored inventory. No DEBUG-008-subwait marker remains in apps TypeScript source.
- MAIN was read only. No installation, dependency change, stage, commit, push, deployment, live provider, credential use, shared/retained DB mutation, deletion, deadline change or assertion change occurred. The existing test command used its disposable local storage.

## Ranked predictions and outcome

Predictions were written before the run in predictions.md and shown in the dispatch reply.

1. Fresh product/credential authorization dominates. Supported for the combined product and local-authority path. The fixture itself is not predominantly stuck on credential permission; most selection callbacks finish in 44–50ms, with one 118ms callback.
2. Supported Pi persistence/configuration dominates. Not supported in this run. root.configure takes 2ms; the two explicit durability waits take 6ms each; snapshot is 0ms at millisecond resolution; finishConfiguration takes 7ms. Ledger and conversation marks also finish promptly.
3. Ordinary owner lane dominates. Not supported. lane-wait-start to lane-enter is 1ms.
4. Accumulated test-body work exhausts the budget despite finite configuration. Supported. Configuration starts at body +3136ms, reaches configureOwned at +3273ms, and returns at +4489ms. Only about 511ms remains for second delivery, two follow-up completions, final assertions and retirement. Second delivery itself takes 178ms, leaving about 330ms when the final poll starts.

These are observations from one temporarily instrumented run, not latency guarantees or proof that all historical failures have one cause. Logging and ordinary run variation may change timing.

## Exact command and result

Run once from execution, with a 900-second outer tool budget and unchanged Vitest limits:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

command.json records argv/cwd/start time. diagnostic-sequence.log preserves the complete command output. run-result.json records exit 1 and 50.0115 seconds outer elapsed. Vitest reports 46.25 seconds, 12 passed, queued-configuration failed at 5000ms, 47 filtered/skipped, and one unhandled isolated-storage error. Fifteen cases are selected among 62 collected. Two selected later cases are unreached: real D1 lost started acknowledgment and real admitted Stop repairs candidate-control-intent. The reported result categories cover only 60 cases; the two unreached cases are not passes or ordinary name-filter exclusions.

Isolation failed while popping D1 and CandidateFixtureSession storage, with .sqlite-shm assertions. Candidate configuration unavailable appears after the isolation-failure banner; this does not establish an earlier spontaneous configuration failure. No body assertions-end or retire-start marker was emitted. The last body marker is deliver-second-end-poll-start at +4670ms. The probe therefore locates the body continuation at the final poll when the timeout interrupts it, not at configuration or retirement. No new cleanup explanation is established.

No full product suite, typecheck, aggregate, baseline rerun or second diagnostic run was performed.

## Scalar evidence

All probe records contain constant component/stage names and scalar timestamps only. scalar-events.json preserves 111 records. host-boundary-durations.json preserves the matched host intervals. Date.now has millisecond resolution, so 0ms means below this measurement resolution, not literally no work.

### Test-body timeline

| Boundary | Elapsed from actual body entry, ms |
| --- | ---: |
| Credential ready | 64 |
| Three admissions complete | 713 |
| Third delivery complete | 843 |
| First delivery complete / first poll starts | 1072 |
| First completion poll ends | 2757 |
| Reopen starts | 2810 |
| Reopen ends / configureFixture starts | 3136 |
| configureOwned enters | 3273 |
| Configuration returns applied | 4489 |
| Second delivery starts | 4492 |
| Second delivery ends / final poll starts | 4670 |
| Assertions/retirement reached | not observed |

The first poll consumes 1685ms and reopen consumes 326ms before explicit configuration. The configureFixture-to-configureOwned entry gap is 137ms. The return gap from the host finish marker to the body configure-end marker is 20ms. Neither gap is instrumented internally.

### Configuration host intervals

All times below are relative to configureOwned entry.

| Authorization stage | Start–end, ms | Duration, ms |
| --- | --- | ---: |
| Initial owned-only product check | 1–102 | 101 |
| Before-intent first selection check | 166–265 | 99 |
| Before-intent fresh selection check | 327–428 | 101 |
| Before-intent final selection check | 428–532 | 104 |
| Before-Pi first selection check | 603–830 | 227 |
| Before-Pi fresh selection check | 894–1003 | 109 |
| Before-Pi final selection check | 1003–1105 | 102 |

The five dependencies.authority waits take 62, 61, 63, 64 and 74ms, totaling 324ms. These are fresh host/product authority callbacks, not ownerQueue admission waits. Their internal subqueries were not probed.

The longest individual measured configuration interval is the 227ms before-Pi first selection authorization. Its fixture callback accounts for 118ms, including 63ms credential permission, and the host-to-fixture entry gap accounts for 108ms. The remaining millisecond is the callback return gap. The 227ms interval is not sufficient to explain the complete test failure by itself.

### Six selection fixture callbacks

| Stage | Subject read | Credential permission | Credential status | Owned policy | Complete callback |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before-intent first | 19 | 2 | 16 | 6 | 44 |
| Before-intent fresh | 20 | 2 | 17 | 6 | 45 |
| Before-intent final | 19 | 2 | 18 | 8 | 48 |
| Before-Pi first | 19 | 63 | 30 | 6 | 118 |
| Before-Pi fresh | 19 | 2 | 23 | 6 | 50 |
| Before-Pi final | 19 | 2 | 18 | 6 | 45 |

Rows are milliseconds, measured only for the synthetic next-selection callbacks. Initial owned-only authorization is measured at the host boundary, not subdivided. Subject calls total 115ms, permission calls 73ms, status calls 122ms and owned-policy calls 38ms. Callback totals sum to 350ms; two milliseconds of boundary/continuation gaps account for the difference.

Six host selection authorization intervals total 742ms. The 392ms difference from the six fixture callback totals lies outside the instrumented callback body. Entry gaps are 55, 56, 56, 108, 58 and 57ms. These observations separate callback work from cross-boundary elapsed time; they do not identify why those gaps occur. RPC scheduling/transport, other runtime work and probe overhead remain possible explanations. They are not evidence of a leaked credential hold or a platform impossibility.

## Smallest correction alternatives for advisor review

No permanent correction is established or authorized. Keep all seven authorization stages, their order, their independent freshness, and every budget/assertion. Do not cache authority or replace repeated checks with one permit.

1. Prefer reducing work inside each fresh authority callback, if its existing SQL offers a safe batch. Inspect CandidateFixtureProduct.readRuntimeAuthority in apps/credential-tests/src/model-entry.ts:1102 and CandidateProductCommands.runtimeAuthority in apps/web/src/lib/session-command-candidate.ts. Five such waits consume 324ms here. A per-call batch of genuinely independent existing reads, with exact predicate/binding/error and reset-proof validation preserved, is a narrower candidate than changing configureOwned's safety protocol. This trace does not locate the internal query cost or establish a safe concrete batch, so the advisor must verify it before authorizing implementation. It cannot remove an authority call or relax generation/priorTerminated checks.
2. A further per-call subject reconstruction optimization could target CandidateProductCommands.subjectForCommand and CandidateFixtureProduct.readCandidateConfigurationAuthority at model-entry.ts:1190 while preserving every fresh callback. However, all six measured subject reads total only 115ms after the accepted batching. Even eliminating that measured time would not leave enough demonstrated budget for the remaining two follow-ups. Do not mistake another query-count reduction for a complete fix.
3. If fresh safety checks are already minimal, focus a separately authorized investigation on the unprobed cross-boundary gaps or earlier admitted-work path instead of Pi configuration. Relevant symbols are PiDurableProductSession.open's authority/configuration composition in apps/runtime/src/pi-durable-product-session.ts, configureCandidate in pi-durable-host.ts:4168, and the unchanged queued test's admissions/first completion poll at product-commands.worker.test.ts:1504. These gaps and the 1685ms first poll offer more leverage than the 2ms root.configure call. A composition or scheduling correction would need supported-API evidence and must retain real D1/DO/private transport coverage, Stop priority, and fixture assertions. No such correction follows from this run alone.

Avoid Pi scheduler changes, disposal changes, test splitting that removes the queued/prepared-request assertion chain, widened deadlines, altered WORK_MS/DRAIN_MS, removing fresh checks, or a blind instrumentation campaign. The authorized run reached the relevant boundaries and reproduced the bounded failure. Stop here for advisor synthesis.

## Artifact index

- predictions.md: hypotheses recorded before execution.
- entry-source-and-evidence.tar.gz: exact entry source and selected evidence archive.
- entry-source-sha256.json / entry-status.txt: entry inventory and worktree state.
- temporary-probe.patch / instrumented-source-sha256.json: exact temporary patch and instrumented inventory.
- command.json / diagnostic-sequence.log / run-result.json: single command and result.
- scalar-events.json / host-boundary-durations.json: machine-readable scalar measurements.
- restoration-proof.json / final-source-sha256.json / final-status.txt: complete 37-file restoration proof.

No secrets were observed or reproduced in the examined diagnostic material. No repository text was treated as authorization to override this dispatch. Source and historical artifacts remain preserved.
