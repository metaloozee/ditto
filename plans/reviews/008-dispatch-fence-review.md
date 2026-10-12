# 008 credential-local dispatch fence review

Status: conceptually viable, not accepted. The subsequent [scoped implementation continuation](../decisions/008-implementation-continuation.md) permits implementing the required candidate hooks; it does not pass any gate or accept the issuer.
Proposal reviewed: the "Smallest proposed dispatch/reset mechanism" section of [executor qualification evidence](../evidence/008-fixture-reset-qualification.md).
Related: [witness proposal](../decisions/008-fixture-reset-witness-protocol.md), [qualification advisor review](../evidence/008-qualification-advisor-review.md).

A fresh read-only critic, `31a00aa2-38d3-46d`, used `openai-codex/gpt-6.1-sol` with medium reasoning. It reviewed the proposed ordering, bindings and crash behavior, not the qualification tests or artifacts. The advisor independently checked the cited exact-claim, reservation and deadline code and retrieved the Cloudflare output-gate explanation. No source changes or new tests occurred for this design review.

## Required corrections

1. The final gate must synchronously access live credential-DO SQLite, not only cached epoch state. A stale constructor may finish non-storage work after replacement; storage access is the platform uniqueness fence. Failure must deny, never fall through to fetch. There must be no suspension between this live check and actual `fetch` invocation. This is storage fencing, not proof that the older constructor terminated.
2. Bind the immutable preparation to the original validated attempt. Include owned user/project/session, owner/version/protocol, candidate namespace/named session DO, execution identity/incarnation/lifecycle, host authority generation, effect ID and request digest. The host generation must match the existing attempt. Old descriptors cannot adopt whichever epoch is active after an awaited describe/preparation call. Connection, executor and host counters remain distinct. Revoked generations cannot be reused.
3. Specify idempotent conditional revoke and reopen receipts. Close only the exact scope/epoch/reset ID and persist before acknowledgment. A retry cannot close a successor. Credential constructor identity is not session-host constructor identity. Replacement must load the durable closure before admission; a new nonce cannot reopen it. Reactivation requires the exact newer generation and validated current session recovery acknowledgment. Lost acknowledgments remain denied until reconciled.
4. Define the guarantee at fetch invocation, not network delivery. Same-turn ordering can order the local gate transition against invocation. Output gates may delay an already invoked request until after reset acknowledgment. Such work remains potentially live and occupied. No claim of upstream cancellation, no-late-delivery or remote termination follows. Current documentation does not prove the pinned SQLite/output-gate behavior; qualification is still needed.
5. Preserve every existing deadline across any new wait. The proposed added `storage.sync()` may return after a privileged window expired. The existing Boolean permit does not return authoritative window expiry. A final gate needs validated window expiry plus attempt/overall deadlines, abort state and credential revision. Checking only the attempt deadline would weaken accepted policy.

The advisor verified that `pi-durable-host.ts` consumes and durably seals the exact claim before dispatch and checks fresh authority after the bound product callback. `ModelProductAuthority.reserve/record` retains request reservations and consumed capacity. Its window creation clamps expiry to the effect deadline and 30,000 ms; `permit` returns a Boolean after checking the query's window/command/effect expiry against the clock. The proposed extra await must not discard these constraints.

## Keep the change smaller

Prefer existing host effect/claim and product reservation records over another per-effect credential ledger. Add a journal only after identifying a missing durable recovery decision those records cannot express. Any added record must reference existing identity/accounting, never authorize refund, replay or inferred completion. A prepared-only record means conservative uncertainty, not confirmed dispatch.

The reproduced B race uses a direct test D1 review revocation, not an acknowledged credential-local barrier. It establishes the stale-positive problem; it does not exercise the proposed remedy. A future gate test must explicitly identify its revocation/barrier linearization and acknowledgment. Do not quietly reinterpret arbitrary D1-only revocation as serialized with credential dispatch or report the original red assertion as fixed without the corresponding mechanism.

## Permission and remaining gate

The critic identified at least an immutable candidate preparation-context hook and a strictly synchronous final dispatch gate in `CodexCredential.requestModel`, plus private fixture-composition revoke/reconcile/reactivate authority. These are beyond the previously approved protected policy factory and beyond the current fixture-only qualification authorization. Keep noncandidate behavior and credential storage/renewal unchanged. Do not hold a mutex, `blockConcurrencyWhile`, credential renewal or provider wait across priority Stop.

Stop if replacement fencing depends only on memory, old preparations acquire new epochs, durable acknowledgment is unclear, deadlines are weakened or the receipt implies remote cancellation. The separate exact abort-witness qualification remains incomplete; its fixture-only continuation stopped after callback flag ambiguity and another isolated-storage teardown failure. No broader implementation is dispatched by this review.
