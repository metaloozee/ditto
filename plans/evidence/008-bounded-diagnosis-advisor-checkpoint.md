# 008 bounded diagnosis advisor checkpoint

Status: candidate still unaccepted. No aggregate or integration result.

The advisor read the complete diagnostic report and relevant claim/final-hold code. Diagnostic artifacts are preserved in main `plans/evidence/artifacts/008/bounded-diagnosis/`. All 37 restored source hashes independently match the previous final inventory.

The agent reproduced a one-test fault twice using actual admission, the existing preclaim hold and the unchanged host yield deadline. Host context aborts, credential signal remains live with about 58.6 seconds of effect budget, no fetch occurs, and the member/projection/run fail while the effect remains admitted. Removing the trigger restores a pass with clean teardown. This establishes a deadline-domain counterexample, not permission to retry or refund uncertain work.

Its sole original-deadline full trace reports 36 passed, two failed and an isolation error before completion. Initial prompt and three native turns passed. The reset/recovery preparations reached a first valid host permit with 153ms yield remaining, then host-context cancellation became an opaque denied claim. Effect expiry was refuted in those captures. The exact asynchronous substage and full-run abort source remain unproven, as does the independent teardown cause. These results do not establish framework impossibility or a single cause for every earlier failure.

The advisor authorized only a specific two-file fixture correction in executor `32488ff5-2e3b-412`, `openai-codex/gpt-6.1-sol`, medium reasoning. Final-permit holds capture their request's waiter, resolve true only at the actual positive final hold, resolve false on earlier settlement, and tests must assert true. A controlled negative regression must preserve original budgets and occupied uncertain effects. False cannot become readiness or make a red preparation succeed.

The same executor will temporarily observe existing claim await boundaries, including before/after irreversible receipt consumption, without new waits, queries or policy changes. Diagnostic runtime edits must be restored. At most one full product run may recover a missing trace. No host progress/retry/refund change, deadline extension or broad permit removal is delegated. A proposed optimization requires exact evidence and advisor synthesis first. The five aggregates still wait for a green relevant product suite.
