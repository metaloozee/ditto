# 008 body-boundary diagnostic

Status: stopped for advisor review; no permanent source delta; 008 unaccepted.

1. Printed and verified the required provider/model/reasoning selection, openai-codex/gpt-6.1-sol/medium. Read only the updated MAIN checkpoint. Independently verified and archived all 37 entry source files and selected prior evidence before edits. MAIN remained read-only.
2. Instrumented only the two authorized test bodies, starting before candidateCredential. Scalar boundary/elapsed logs used `[008-body-boundary]`. No fixture/runtime instrumentation, await splitting, new awaits/queries/timers, assertions or deadline changes. Removing injected lines independently reproduced exact entry bytes before running. Saved diagnostic-only.patch.
3. Ran the exact 15-selected original-order command once. Exit 1: 12 passed, queued configuration timed out at 5000ms, one isolation error, 42 filtered, two selected later cases unreached. No second run, typecheck, aggregate or full suite.

Generation-2 completed all measured assertions and cleanup: occupancy comparison returned at 3926ms, cleanup final/join releases at 3927/3928ms, retirement returned at 3945ms.

Queued configuration reached these boundaries from actual body entry:

| Path | Before/after, ms | Duration |
| --- | --- | --- |
| Three admissions | 62/726 | 664ms total |
| Third/first delivery | 727/1240 | 513ms total |
| First completion poll | 1240/3015 | 1775ms |
| Retained task read | 3017/3072 | 55ms |
| Reopen | 3072/3423 | 351ms |
| Configuration | 3423/5010 | 1587ms |
| Task comparison | 5010/5026 | 16ms |

Configuration returned and its applied assertion passed only after the 5000ms budget boundary. Second delivery entered at 5026ms without a return marker. The pool then reported runtime sqlite-shm isolation failure; pending reconstruction/delivery reported a missing session_commands table. Cleanup retirement entered at 5130ms without a return marker. Final completion and final reads were not reached.

This locates budget exhaustion across configureFixture after substantial first-turn polling, not an observed indefinite reopen stall or successful whole-test assertions followed by retirement. Retirement began after budget exhaustion and isolation trouble; its missing return does not establish the primary cause. The test owns runtime/alarm/host settlement; the pool owns isolated storage. Borrowed capabilities were not disposed.

Inner configuration waits remain unidentified. Further work needs advisor synthesis on measured configuration/first-turn paths, not an assumed SQL bottleneck. No fix made.

4. Removed probes through exact inverse edits. All 37 final hashes and archive bytes equal entry. model-entry and runtime remained unchanged throughout. Final delta is empty. No secret values, environment files, installs, deployment, shared/retained DB, external cleanup or Git mutation.
