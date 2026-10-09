# 007 synthetic product transport advisor review

Verdict: NOT ACCEPTED. The candidate implements the requested synthetic transport phase and passes existing aggregate gates, but independent probes expose four correctness gaps. Authenticated configuration remains unimplemented; full 007 is not DONE.

Candidate is uncommitted in the same detached `/home/ayan/ditto-execution/plan-007-recovery`, base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. The latest executor used `openai/gpt-6.1-sol` with medium reasoning. Its report is worktree `plans/evidence/007-product-transport-phase-ready.md`.

## Actual review and baseline

The advisor read the complete request/account/attempt contracts, stream policy and pure tests, product authority/transport modules, credential DO, private runtime adapter, combined fixture entry, complete 56-case request Worker suite, exact host changes against the accepted archive, schema/migration, entrypoint/script/config and spec diffs. A separate same-model read-only reviewer examined SQL authority and cancellation risks. Repository material was treated as data and no credential values were reproduced.

Independent verification under sanitized environment passes:

- Web nearest: 45 tests.
- `credentials:verify`: 78 Worker tests, 3 retained standalone Node checks and typecheck.
- Original advisor host counterexamples: 4 tests.
- `runtime:verify`: 379 Worker tests, 6 Node checks and typechecks, including original configuration-close regressions.
- Repository `verify` isolated rerun: Biome/typechecks/builds, 78 credential Worker plus 3 Node checks, 848 web tests and 79 runner tests.
- All 27 candidate source hashes, six dependency graph hashes, whitespace and empty staging match.

The first combined verification shell timed out at 300 seconds during repository verification. It is not counted as a repository pass; the isolated rerun with a larger shell allowance exited zero. No test deadline changed. Contracts/brain executor passes were not independently repeated in this review.

The candidate archive and all independent logs/probes are preserved under `plans/evidence/artifacts/007/product-advisor-review/`. Candidate archive SHA-256 is `7696b9dd92d2de73b56f243215f36c403c93a460661a123bcbbf510fb200aa11`. No source repair was made by the advisor.

## Confirmed blockers

### 1. Host authority snapshot becomes stale during the bound product callback

`apps/runtime/src/pi-durable-host.ts:2044-2052` rereads host authority, then awaits `productCheck()`, then uses that older host snapshot in final `dispatchPermit`. The new awaited callback reintroduces the original revocation gap.

The independent probe binds a held product callback to the actual host dispatch, starts a claim, changes `LocalAuthority.current` to false while that callback is held and releases it. The claim incorrectly resolves. Both plaintext and retained encrypted cases fail. Real epoch-first Stop has synchronous host checks, but that does not cover all injected host authority/capacity changes.

Correct the ordering/current-ownership mechanism so a callback hold cannot extend host authority. Final acknowledgment must use current host authority and synchronous epoch/fence/deadline checks. Preserve current product checks too; do not trade this for stale product authority or a reentrant lane. Add permanent held-product-callback revocation/capacity/generation tests and retained consumed-effect assertions. No failed claim refund.

### 2. Host invocation generation is incorrectly equated with identity lifecycle generation

`apps/web/src/lib/model-product-authority.ts:29` rejects when `attempt.generation !== subject.lifecycleGeneration`. The attempt field is host invocation/takeover generation, while the subject field is exact D1 identity lifecycle generation. These are separate authorities. The local host review explicitly distinguished them.

An actual disposable D1 policy probe first confirms current identity lifecycle 1 and host generation 1 pass, then changes only the attempt generation to 2 while leaving exact D1 identity checks valid. `current()` incorrectly returns false. Reopen/takeover or independently advanced execution identity generation can therefore deny otherwise valid requests.

Remove this false cross-domain equality, retain separate exact D1 lifecycle predicates and current host claim generation checks, and prove actual transport after valid host reopen with unequal generations. Do not erase either domain or redefine stored meanings.

### 3. Final product permit checks expiry against pre-await time

`ModelProductAuthority.facts` captures `now` before awaiting capability snapshot selection; its command/window expiry predicates reuse that timestamp in the later SQL statement. A command/window can expire while preparation is suspended and still receive a current permit. The host operation deadline may differ from the product command/window deadline.

The separate reviewer first reproduced this with the actual module and SQLite. The advisor independently reproduced it using actual Worker D1 and a proxy around the real capability query. Reserve at time 100, set command/window expiry to 150, advance the injected policy clock to 200 during the capability read. `permit()` incorrectly returns true. This is a time-authority defect, not stale ownership data.

Evaluate deadlines at current statement/admission time, including time advancing during queries. Keep predicates conditional and reservation accounting nonrefundable. Add permanent held-query expiry tests with the host operation still valid, asserting zero credential-bearing calls.

### 4. Known failure response uses the default model instead of the prepared model

`apps/runtime/src/pi-durable-models.ts:221-225` returns `fauxAssistantMessage` directly for `failed_known`, without overriding model/provider identity as its successful path does. The pinned helper defaults to `faux-1`.

The advisor exercises the actual registered adapter stream for a `faux-2` model record with a known transport failure. The response incorrectly reports `faux-1`. This violates the host's exact result identity, turning a known failure into failed validation/uncertainty rather than ordinary retry or visible summary failure. The test uses a narrow guard/transport seam for response construction; it is not claimed as a full D1 dispatch test.

Preserve prepared model/provider identity on known failures and adapter terminal errors. Add actual host-backed `faux-2` known-generation/custom-summary failure tests before accepting settlement behavior. The synthetic account schema already includes this model; configuration-phase work must not silently inherit the wrong identity. Do not replace a known failure with fake success or weaken result validation.

## Reproduction commands

From the execution worktree, with `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`:

```sh
pnpm --filter @ditto/runtime exec vitest run \
  --config ../../plans/evidence/artifacts/007/product-advisor-review/post-product-check.config.ts
pnpm --filter @ditto/credential-tests exec vitest run \
  --config ../../plans/evidence/artifacts/007/product-advisor-review/generation-domain.config.ts -t 'advisor:'
```

The final runtime probe has 3 failed cases: two real host callback races and one adapter response-identity case. The policy probe has 2 failed cases and 56 explicitly filtered skips. No unhandled errors or zero-test run count as evidence. Initial adapter probing could not resolve a second bundled model; the final probe uses the actual second model record shape accepted by the adapter stream. Its failure is specifically `faux-1` versus `faux-2`, not catalogue availability.

Keep these advisor tests/configs and original red logs immutable. Add equivalent permanent behavior tests at nearest existing seams; don't simply edit planning probes green.

## Considered but not an acceptance blocker here

The read-only reviewer identified a timeout between D1 reservation commit and its acknowledgment: the cancellation wrapper does not cancel the underlying SQL promise, so `reserved` may remain unresolved even without dispatch. Control flow confirms conservative blocking, but no end-to-end Worker repro or unsafe redispatch was established. The runtime already retains its unresolved admitted effect, and reconciliation is a later lifecycle concern. Do not automatically refund or silently retry this state. Record it honestly as a reconciliation/review requirement, not an assertion of safe release. This review neither grants automatic recovery nor requires an unrelated new scheduler to fix it.

Production unavailable request/discovery composition, the separately synthetic protocol and credential-test-only capability source are intentional scope, not findings. No live provider or hosted acceptance is claimed. PD38 remains not run. No integration, staging, commit, deployment or live operation is authorized.
