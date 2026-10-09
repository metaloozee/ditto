# 007 custom-summary correction gate

Status: BLOCKED at mandatory restoration identity check. No correction edits or tests were performed.

## Execution identity and boundary

Execution worktree: `/home/ayan/ditto-execution/plan-007-recovery`, detached at `0ccc5b20c25a4e63017b3eebf6608dba62253479`.
The observed `PI_MODEL` was `gpt-6.1-sol`; `PI_PROVIDER` was `openai`. Reasoning setting was not independently inspected. Main `/home/ayan/ditto` was used only as read-only recovery input.

## Restoration commands and results

Executed in the fresh worktree, in this order:

1. `sha256sum /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-interrupted-candidate.tar.gz` returned the required `63c20ec1285f96e5a82bc99ee1d1b552e65a9853bda79d00c41448079b8d24d1`.
2. `git apply --check /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-advisor-review/source.patch` passed.
3. `git apply /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-advisor-review/source.patch` passed, without staging.
4. `tar -xzf /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-interrupted-candidate.tar.gz apps/runtime/src/pi-durable-model-preparation.gate.test.ts` extracted only the prescribed preparation gate.
5. `cp /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-advisor-review/recovered/apps/runtime/src/pi-durable-summary{,.test}.ts apps/runtime/src/` copied the two final summary files.
6. `sha256sum -c /home/ayan/ditto/plans/evidence/artifacts/007/custom-summary-advisor-review/source.sha256` exited 1. Six identities passed; the preparation gate failed.

Preparation gate path: `apps/runtime/src/pi-durable-model-preparation.gate.test.ts`.

- Required SHA-256: `058ee49050271fe301da1fb92072ea2d1f9042eddf13f792af6e828cd4c6a65d`
- Actual extracted SHA-256: `a166c5e618021bc463de672581f342779156a269128285974541ac5aac4734af`

The handoff requires stopping on any mismatch. No attempt was made to reconstruct, normalize, or replace this file. A correct recovery input or an explicitly revised accepted restoration procedure is needed before correction work.

`git diff --cached --exit-code` passed, confirming empty staging. Status showed the expected four tracked candidate changes and three untracked candidate source files. No install, manifest edit, lockfile edit, credential access, provider operation, commit, integration, or deployment occurred.

## Remaining predicates and gates

Not run because restoration failed:

- Forced configuration-winning and preparation-winning ordering around asynchronous hashing/sealing, in plaintext and encrypted storage. Configuration must not resolve before the held preparation commits; retained preparation must keep its original exact configuration, and the next preparation must observe the change.
- Cancellation/Stop, persistence failure, and reopen ordering probes.
- Generation-owned automatic crash probes with an inspected real waiting parent at pre-preparation, prepared/pre-admission, admitted unknown through two reopens, durable result/pre-return, before actual Pi placement commit, and after commit/pre-publication.
- Exact result/usage reuse once, no summary redispatch, independently counted legitimate parent continuation, single receipt/placement/membership, settled assistants, and persistent unknown-outcome denial of later effects.
- Automatic waiting-parent known failure, Stop/stale authority, and request/result storage fault probes.
- Runtime typecheck, scoped Biome, summary and nearest suites, `pnpm runtime:verify`, `pnpm verify`, approved spec equality, final diff check, and lock graph comparison.

No new test counts or passing correction predicates are claimed. Historical reported counts are not executor verification here. The historical stock-summary failure and missing old raw-log limitation remain unchanged. Broad independent verification of the previous candidate was interrupted, not passed. Neither correction prerequisite nor full 007 is accepted.

## Preservation

`plans/evidence/artifacts/007/custom-summary-correction-restoration-blocked.tar.gz` preserves the seven restored source files, this evidence, and the exact handoff/hash reference inputs. It is a failed-restoration snapshot, not a verified exact candidate. Its sibling `.sha256` records the archive hash. Historical evidence in main was not rewritten.
