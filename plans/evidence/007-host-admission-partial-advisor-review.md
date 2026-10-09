# 007 partial host admission advisor review

Verdict: NOT ACCEPTED. Environment blockers are resolved, but the new local claim primitive has two independently reproduced correctness gaps. Full 007 remains incomplete.

Candidate lives uncommitted in detached `/home/ayan/ditto-execution/plan-007-recovery`, base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Executor used the newly requested `openai-codex/gpt-6.1-sol` with medium reasoning. Its report is worktree `plans/evidence/007-remaining-host-admission-partial.md`.

## Reviewed changes and preservation

The advisor read the complete incremental patch against accepted custom-summary source, complete new model-attempt contract/parser and tests, complete new ten-case Worker model suite, and the existing host private-field/seal checks. The new contract is an exact association, not a credential or entitlement permit. The provider signature now passes a local `ModelDispatch`; existing fixtures can still ignore its claim. Product admission, transport, operation windows and authenticated configuration remain missing.

The advisor independently verified the executor's seven new candidate hashes, four unchanged manifest/lock hashes and empty staging. It independently ran the four nearest runtime suites: **192 tests pass**, comprising models 10, effects 62, summary 118 and preparation 2. The four original close-deadline cases still pass. Broader executor-reported passes are not independently repeated in this review.

## Independent failing cases

Advisor-only tests and configuration are under worktree `plans/evidence/artifacts/007/`. No production source was edited by the advisor.

```sh
cd /home/ayan/ditto-execution/plan-007-recovery
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true \
  pnpm --filter @ditto/runtime exec vitest run \
  --config ../../plans/evidence/artifacts/007/advisor-model-claim.config.ts
```

Actual final run: **4 failed**, zero unhandled errors. Each promise resolves instead of rejecting, in both plaintext and encrypted fixtures. Log: `advisor-model-claim.probe.log`; test: `advisor-model-claim.probe.test.ts`.

1. **Claim consumption can be rewound in the live host.** Claim once, directly reset `host_model_dispatch.claimed` to zero using the disposable SQLite tamper seam, then claim the same exact association again. The second claim succeeds. The new table is not included in retained private-field seals, and the closure retains no non-rewindable consumption guard. This defeats the local one-shot claim under a modified safety row, including in the encrypted fixture. It is an integrity counterexample, not evidence that an external user can mutate the trusted DO database.
2. **Revocation during claim durability is acknowledged with stale authority.** Hold the claim's actual `storage.sync`, change injected current authority from true to false, then release the durability wait. The claim succeeds. `modelDispatch.claim` reads authority before Pi task lookup and flush, and reuses that snapshot in its final `dispatchPermit`. Existing revocation tests change authority before claim begins, so they do not cover this window.

The probe setup initially failed to discover a test outside the runtime root, then encountered two configuration-resolution failures. Those attempts ran zero tests and are not correctness evidence. The final config keeps runtime dependency resolution and explicitly includes the planning test. Only the four-test run above counts.

## Required correction

In `apps/runtime/src/pi-durable-host.ts:modelDispatch`, preserve one-shot consumption even if its live backing row is reset. Use owning host safety state and, for retained persistence, bind the durable receipt to the existing integrity mechanism rather than an unauthenticated mutable flag. Keep the original effect ledger and uncertainty block; never refund a claim or permit redispatch after uncertain interruption. Add permanent nearest-suite tests for reset/substitution and reopen behavior rather than relying solely on this planning probe.

Refresh authority after the durability barrier and perform the final synchronous local epoch/Stop/fence/deadline/receipt checks with that refreshed authority, without inserting another awaited operation after the final check. Add actual held-task/held-flush races and preserve the consumed reservation on failed acknowledgment. Do not move claim onto a provider/configuration queue that can deadlock its caller.

These local corrections still do not establish end-to-end product/credential authority or a reviewed service-binding capability. Mandatory composition and all remaining plan steps must be separately completed and reviewed. No live transport, integration, stage, commit or deployment is authorized. PD38 remains not run.
