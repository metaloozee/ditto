# 008 fixture reset/witness draft review

Status: initial independent review complete, proposal BLOCKED. Requirement amendments are recorded, but have not received a second independent review. This is not implementation acceptance.
Proposal: [fixture reset and termination witness](../decisions/008-fixture-reset-witness-protocol.md).
Reviewed base: `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`; candidate source remains uncommitted in `/home/ayan/ditto-execution/plan-008-4WXvNW`.

## Authorization and scope

The maintainer approved drafting a fixture-only issuer protocol before implementation. The advisor wrote only root `plans/` files, inspected the preserved candidate and retrieved current Cloudflare documentation. No test, reset, dependency/cache preparation, database mutation, deployment, source change, staging, commit, integration or cleanup was performed during this drafting step.

A fresh read-only reviewer completed on the user-selected `openai-codex/gpt-6.1-sol` with medium reasoning. Its verdict was conditionally sound direction, but not an implementable protocol yet. It found six gaps in addition to the already explicit abort qualification block. The advisor inspected the relevant source before amending the requirements. No independent approval of the amended text is claimed.

## Evidence used

The advisor inspected the accepted `PiDurableHost.open` guard and the candidate authority/entrypoint/fixture paths cited by the proposal, as well as the existing exploratory termination test. Those bytes do not yet implement an issuer. The existing four independently passing correction probes remain evidence only for their narrow corrections.

Current Cloudflare references:

- [Durable Object state, abort](https://developers.cloudflare.com/durable-objects/api/state/#abort). Documents immediate reset and an uncatchable application error. Current alarm options are not assumed to exist in the pinned fixture.
- [Durable Object lifecycle, shutdown behavior](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/#shutdown-behavior). Ordinary shutdown may let old non-storage HTTP/RPC work finish. A replacement constructor alone is insufficient evidence of prior host termination.
- [Durable Object stub](https://developers.cloudflare.com/durable-objects/api/stub/). Stub construction is not an invocation or termination proof.

The installed `@cloudflare/workers-types` declaration inspected in the execution worktree accepts only the single-argument `abort(reason?: string)` signature. No new declaration or package was installed.

## Open prerequisite

The protocol requires a distinguishable observation of the exact supported abort call. The earlier probe asserts only a generic rejected promise and changed instance fields. It does not establish this signal. Qualification must fail closed if the pinned local runtime cannot distinguish expected abort completion from lost delivery or an arbitrary exception. The proposal explicitly leaves loss of the abort observation blocked, even if a replacement exists.

The proposal also separates witness-authorized passive recovery from ordinary scheduling, requires current-generation predicates on candidate model authority, preserves priority controls and unknown-effect occupancy, and supplies cross-store crash dispositions. These are proposed changes, not passing behavior.

## Independent findings and advisor disposition

| Finding | Verified candidate evidence | Amendment and remaining limit |
|---|---|---|
| Reset preparer boot was not bound to the predecessor's originating boot | `pi-durable-host.ts:416`, `:4808–4824` record invocation identity/generation/deadlines but no constructor association. | Require an immutable host-owned invocation-to-boot association at creation. A natural replacement cannot attach its own nonce to an old invocation and certify it by aborting itself. |
| Last positive permit response can outlive reset | `model-product-authority.ts:380–406` checks time after its query, not a reset transition that happened while the response was held. `codex-credential-do.ts:289–310` performs the final permit await after the host claim, then dispatches. | Added an explicit OPEN DESIGN BLOCK for a defined dispatch/reset linearization point. More asynchronous queries are not a solution by themselves. Require a held-positive-final-response test and separate approval if a new credential hook is needed. |
| Provider denial alone does not fence ordinary scheduling mutations | `pi-durable-host.ts:4780–4880` initializes configuration, creates an invocation, accesses the root and prepares submission across awaits; `:5390–5420` consumes candidate work through alarms. | Enumerate ordinary mutation/scheduling points and post-suspension checks. Keep passive probe separate from activation and preserve safety-independent control accounting. This remains a required implementation design, not passing behavior. |
| Receipt replay can omit incomplete Stop application | `pi-durable-host.ts:3939–3956` returns a duplicate acknowledgment after wakeup repair; `:4046–4075` commits Stop record/fence before downstream `stop`; `:3503–3572` performs task/submission abortion and reconciliation afterward. | Require recovery of partial local control application, without repeated epoch increments. Page through all controls to a committed cutoff/end marker, including previously delivered ones. A stored applied receipt is insufficient. |
| Successor proof and recovery-ready acknowledgment could become stale | The initial draft omitted replacement between proof and issuance and reuse of a dead successor's acknowledgment without a new unclosed invocation. | Define the immutable proof digest, separate mutable state checks, append-only refreshed proofs, and fresh current-boot recertification at issuance/activation/local clear. A new unclosed successor needs its own termination proof. |
| Takeover authority could ignore review fences | `session-command-candidate.ts:105–116` omits `runtimeFailureReasonCode IS NULL`; `model-product-authority.ts:110`, `:198` includes it. | Explicitly require that predicate in reservation, issuance, activation and runtime authority reads. Preserve passive receipts and exact-target control accounting under denial. |

The review affirmed that the draft does not weaken the existing newer-generation/exact-predecessor guard and does not treat local reset as remote effect completion. Its findings are protocol omissions, not an assertion that the already accepted predecessor gates failed. Neither reviewer nor advisor changed candidate source.

## Next decision

Do not dispatch issuer implementation yet. First settle the abort completion signal and final dispatch-barrier design with the fixture-only qualification step, then review those concrete results. The proposal explicitly stops if either lacks a supported pinned mechanism.

The maintainer subsequently authorized that qualification. The [handoff](../decisions/008-fixture-reset-qualification-handoff.md) was dispatched to a separate executor on `openai-codex/gpt-6.1-sol`, medium reasoning, in `/home/ayan/ditto-execution/plan-008-4WXvNW`. Agent ID `21f93215-8ed3-440`. It may write isolated test artifacts and narrow diagnostic fixture changes, but production code, issuer implementation, installations/cache preparation, integration and cleanup remain prohibited. Only newly created disposable local test DOs/databases may be reset or changed by the tests.

The [initial qualification report](../evidence/008-fixture-reset-qualification.md) is now preserved. The [advisor review](../evidence/008-qualification-advisor-review.md) independently reproduces two stale-positive final-permit dispatches, passes the revoked-query control and four unchanged correction probes, and verifies all 37 source hashes unchanged. Abort classification remains unqualified. The [fixture continuation review](../evidence/008-qualification-advisor-review.md#continuation-review) records spoofable callback flags, different RPC serialization and another failed isolated-storage teardown; the lost-outcome test did not execute. The executor stopped without production changes. The [dispatch-design critique](008-dispatch-fence-review.md) is complete, with additional storage/binding/acknowledgment/deadline requirements and separate permission needed for credential hooks. The mechanism is not accepted.

008 remains BLOCKED. The remaining real-D1/control matrix and exact final aggregate checks are incomplete. No abrupt recovery pass is claimed. Issuer implementation requires a subsequent maintainer decision.
