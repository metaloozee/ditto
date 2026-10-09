# 007 corrected synthetic transport advisor review

Disposition: ACCEPTED for the local synthetic product/credential transport phase. Full 007 is NOT DONE. Authenticated configuration intents, durable payload-conflict idempotency, configuration snapshots and pre-conversation default validation remain unfinished. No integration or hosted acceptance is authorized.

## Candidate and independent inspection

The candidate remains uncommitted in detached `/home/ayan/ditto-execution/plan-007-recovery` at base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. The advisor inspected all seven files' correction hunks, the complete current product policy module, surrounding credential dispatch/settlement code, and the actual request/race assertions. This review supplements the full candidate review in [the prior rejection](007-product-transport-advisor-review.md).

All 27 corrected source identities match `artifacts/007/product-correction/source.sha256`. All six dependency graph identities match both the worktree and HEAD. All 33 labeled original advisor artifact identities match their main/worktree locations. The preservation manifest uses `main/` and `worktree/` labels rather than directly usable filesystem paths. A first literal checksum invocation failed to locate those labels; resolving them to the two artifact directories verifies every identity. There was no artifact drift.

The corrected archive is preserved in main at `artifacts/007/product-correction/source.tar.gz`, SHA-256 `5a6ae89b8dd948b89b516ac073dc8dfba4fa052ce8a08281c0c378709127a436`. The correction patch, graph identities, executor report and race snapshots are also preserved under `plans/`. Advisor source edits did not occur. Whitespace checks pass and staging is empty.

## Four resolved blockers

- Final host authority now follows the awaited exact product callback. The host performs cancellation, protected receipt, epoch, Stop, fence, uncertainty and deadline checks without another await before acknowledgment. Six permanent races change current authority, executor capacity or invocation generation during the callback across plaintext and encrypted hosts. Consumption remains irreversible and provider starts remain zero.
- The credential DO rechecks exact product policy after host acknowledgment. This prevents merely moving the stale product snapshot across the final host-authority await. The actual host/D1 race revokes capability revision during that await and proves zero fetches with a consumed claim and spent allowance. A denial here does not refund admission. This remains bounded ordered admission, not a distributed transaction.
- D1 identity lifecycle and host invocation generation no longer have an equality requirement. Exact lifecycle and host checks remain in their respective owners. The actual reopen transport test completes under invocation generation 2 with D1 lifecycle 1 through private Worker RPC, credential DO and D1.
- Time-bearing SQL bindings use current time, and completed queries compare returned command/window deadlines and the attempt deadline against the current clock. Four held actual-D1 query cases expire command or window while the host effect deadline is valid and observe zero fetches. The unchanged advisor expiry reproduction passes.
- Known failures and terminal adapter errors retain the prepared provider/model. Actual faux-2 generation retry and custom-summary failure tests preserve original settlement assertions. The explicit synthetic faux-2 catalogue entry is not live entitlement.

The five unchanged advisor cases now pass. Original probes and prior red evidence remain unchanged.

## Independent verification

Commands ran from the execution worktree under `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`. Logs are preserved in `artifacts/007/product-correction-advisor/`.

| Gate | Independent result |
| --- | --- |
| Unchanged host/adapter advisor probes | 3 passed |
| Unchanged D1 advisor probes | 2 passed, 64 explicitly filtered skips |
| Original host admission probes | 4 passed |
| `contracts:verify` | 16 tests, typecheck and build passed |
| `brain:verify` | 43 brain tests; contracts 16 and freshness 3 passed with 3 filtered skips; typechecks and builds passed |
| `credentials:verify` | 86 Worker tests and 3 Node checks passed |
| `runtime:verify` | 387 Worker tests and 6 Node checks passed, including the four unchanged configuration-close regressions |
| `verify` | 848 web tests, 79 runner tests, 86 credential Worker tests and 3 Node checks, formatting, typechecks and builds passed |

The chained independent gate run was interrupted after completing runtime verification, during repository verification. On Resume, no matching verification processes remained, candidate hashes still matched, and the isolated repository rerun exited zero with a 600-second shell allowance. Test deadlines were unchanged. No partial repository log counts as a pass.

## Limits retained

A committed reservation whose acknowledgment is lost can remain conservatively unresolved and needs reconciliation. No automatic refund, retry, evidence release or scheduler was added. Product policy may deny after host acknowledgment, but consumed host evidence remains. Stop winning before acknowledgment prevents fetch; Stop afterward cannot erase admitted work. No exactly-once provider billing claim is made.

Production discovery and transport stay unavailable. All transport tests use disposable synthetic records and mocked fixed `.invalid` requests. Workerd's compatibility fallback remains 2026-09-16 to 2026-03-10. Live provider support, retained-workspace activation, deployment and PD38 remain not run. The next configuration phase must preserve this accepted candidate rather than reset to an older baseline.
