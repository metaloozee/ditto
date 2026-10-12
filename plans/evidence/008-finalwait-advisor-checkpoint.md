# 008 final-hold advisor checkpoint

Status: two-file fixture correction independently passes its narrow tests. Full 008 remains blocked and unaccepted.

The advisor read the complete executor report, incremental patch and relevant authority/claim code. All 37 final source hashes independently match the saved inventory. Exactly the two authorized fixture files changed; the other 35, including runtime diagnostic sites, match entry bytes. Executor evidence is preserved in `artifacts/008/finalwait-substage/`.

The request and per-request policy capture their own final-hold waiter. A real fourth positive permit resolves true; earlier request settlement resolves false. Idempotent Promise settlement retains true after completion. All existing positive tests explicitly assert true in cleanup scopes. The new actual-admission regression crosses the unchanged host yield, observes denied/no fetch and claimed=0, and preserves admitted/uncertain effect occupancy. It does not claim successful progress or authorize a retry/refund.

The advisor independently reran all eight relevant cases on final bytes at the existing configuration/deadlines. Result: eight passed, 46 unrelated cases explicitly filtered, exit 0 and clean teardown. Expected real-abort runtime diagnostics remain visible. Log: `artifacts/008/finalwait-advisor/narrow.log`.

The executor's sole full run is still red: 39 passed, seven failed, one isolation error before the 54-case suite completed. Failures include real claim/final preparation denial, queued configuration, lost-started acknowledgment and control-intent Stop. No final aggregates were run. Narrow success is not whole-slice acceptance.

The scalar trace now locates captured cancellation after irreversible claimed=1 consumption. Durability and the bound product check completed; the existing fresh-authority await crossed host yield. One case had 29ms remaining before that await and -42ms afterward, despite about 59 seconds of operation budget. Another fresh read returned after yield with the signal not yet aborted, and the synchronous deadline predicate correctly rejected it. Keep this distinction and preserve the exact host guard, all fresh checks and consumed/unknown occupancy.

The next latency target is the fixture authority's serial reset-table presence/reset-row/owned-session reads. Any optimization must preserve missing-table behavior, exact reset/identity/namespace/incarnation/lifecycle predicates, review/deletion checks and the final synchronous acknowledgment. It is a target, not a proven cure for every failed test or teardown. No authority caching, missing-predicate shortcut, larger budget or progress-policy change is accepted here. A completed green relevant suite and the five final aggregates remain required before acceptance review.
