# 008 plan refresh at `3fe7b48`

Scope: review and revise `plans/008-product-command-vertical-slice.md` before separately authorized execution. No product implementation. Plans 001–007 remain accepted for their recorded local scopes.

## Review basis

Read the authoritative runtime specification in full, current product/domain docs, README, root/package/test configuration, CI, plan index, 005/007 acceptance and integration evidence, neighboring 009/010 briefs, and the current command/host/model/credential integration paths. The working tree was clean at the start. The installed improve skill's `references/plan-template.md` is absent; this refresh uses the supplied self-contained plan requirements instead.

007 is integrated at `5a33d81` and `3bdf90a`, with planning/evidence at `3fe7b48`. The old 008 base `bcce03e` and its BLOCKED-on-007 label were stale. Historical statements in earlier evidence do not revoke the later acceptance and integration.

## Substantive corrections

These are missing instructions or integration work for 008, not claims that the narrower accepted predecessor gates failed.

| Review finding | Evidence at the reviewed base | Plan correction |
|---|---|---|
| The brief could send an executor back into the old brain-container coordinator. | `apps/runtime/src/server.ts:137–145`; `apps/web/src/lib/session-runtime-authority.ts:161–174`; `apps/runtime/src/pi-durable-host.ts:349–389` | Identify `PiDurableHost` as the accepted owner. Require a separate direct-DO namespace/owner and leave the old coordinator unavailable for the candidate. |
| Old V1 thinking and text limits do not match the accepted host/configuration contracts. | `packages/runtime-contracts/src/command.ts:45–161`; `limits.ts:1–5`; `apps/runtime/src/pi-durable-host.ts:3659–3671` | Separate candidate command semantics from V1. Use conversation configuration, enforce the host's 8,192 UTF-8-byte limit before admission, and reject unimplemented recovery commands. |
| Boolean readiness cannot establish user connection/model entitlement, and first admission has no executor identity. | `apps/web/src/lib/session-command.ts:905–972`, `:1304–1324`; `apps/web/src/lib/model-product-authority.ts:28–86` | Owned readiness for existing conversation state, explicit validated synthetic default before first creation, trusted idempotent fixture identity registration, no model pin. |
| 007's fixture provider path needs real admitted command/run membership. | `apps/web/src/lib/model-product-authority.ts:118–170`; `apps/credential-tests/src/model-entry.ts`; `apps/credential-tests/src/codex-request-contract.worker.test.ts` | Establish membership through a bounded idempotent trusted callback. Require Worker integration without manually seeded commands/membership and retain exact host claim checks. |
| Queue expiry currently doubles as model authority expiry. | `apps/web/src/lib/session-command.ts:926–929`; `apps/web/src/lib/model-product-authority.ts:125–135`, `:173–188` | Separate fixed queue deadline from durable runtime start/expiry decisions and per-effect/window authority. Test a healthy started run after queue TTL and both lost-ack race outcomes. |
| Existing host tests do not establish product-ordered autonomous follow-up draining. | `apps/runtime/src/pi-durable-host.ts:3809–3865`, `:4432–4531`; `apps/runtime/src/pi-durable-effects.test.ts:266–310` | Sequence cursor and dispositions, supported one-input boundary, native wakeup progress without direct `schedule` calls, and crash tests around Pi submission and numeric-ID mapping. |
| Stop-before-delivery and queue cancellation need explicit semantics. | `apps/runtime/src/pi-durable-host.ts:3434–3504`, `:3659–3799`; `packages/runtime-contracts/src/command.ts:59–75` | Persist targeted Stop fences before missing prompt delivery, durable cancellation dispositions, too-late cancellation outcomes, no terminal run revival, and priority controls independent of capacity/model readiness. |
| A new Worker suite would otherwise be absent from aggregate verification. | Root `package.json`, `credentials:verify`; `apps/credential-tests/vitest.config.ts` | Register `product-commands.worker.test.ts` in the explicitly enumerated credential verification script. Keep route tests and real Worker integration as separate, honestly labeled evidence. |
| The old brief blurred command completion with later tool/projection gates. | `plans/009-remote-coding-tools.md`; `plans/010-settlement-and-observation.md`; spec L3 | State partial PD coverage, local terminal/projection-intent responsibilities, and what still belongs to 009/010/015/019/020. |

The refreshed plan also fixes scope, exact gate commands, step ordering, compatibility requirements, maintenance notes and stop conditions. It retains the single-workspace fixture restriction rather than pulling full capacity policy into 008.

## Verification during this review

An attempted baseline command was:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-command-delivery.test.ts
```

Instead of reaching Vitest, the launcher downloaded pnpm and began automatic dependency installation, reporting that it recreated `/home/ayan/ditto/node_modules`. The command timed out after 120 seconds. No test result was produced. This was an unintended dependency-side effect of the attempted verification, not an authorized dependency repair. It was disclosed in the conversation as soon as the command returned.

Subsequent read-only checks found no remaining pnpm/Vitest process and no tracked source, manifest or lockfile changes. The ignored dependency tree and isolated verification HOME were changed; their completeness has not been verified. No retry, cleanup, install, build, formatter, dependency repair, deployment or database operation followed. The execution plan now requires a usable dependency preflight and warns that pnpm `exec` can trigger installation. Separate approval is needed to repair main-checkout dependencies.

| Check | Result |
|---|---|
| Predecessor acceptance/integration and cited source inspection | passed |
| New implementation tests | not run, no implementation authorized |
| Attempted narrow baseline | not run, launcher/install timed out before Vitest |
| Full repository/runtime/credential gates | not run in this planning review |
| `git diff --check` and tracked change scope | passed, only planning documents changed |
| Live provider, hosted, Docker, browser checks | not run |

No whole-repository security/dependency/performance audit was requested or performed. The review covers 008 and its immediate prerequisite and handoff boundaries, not independent reacceptance of 001–007 or refresh of every later plan.

## Review disposition

The refreshed plan is ready for a separate disposable-fixture implementation after dependency preflight. This is planning readiness, not implementation acceptance, authorization to execute, or a newly passed L3 gate. Source/configuration changes outside `plans/` are not part of the diff.

## Independent read-only review dispositions

A product-side review of the original brief and a fresh-context cold review of the rewritten plan both completed. Neither agent edited files or ran tests. The parent checked the cited implementation before applying these corrections:

- Cold Stop cannot depend on root initialization or model entitlement. Section E now names the control-only activation requirement and the disconnect-before-first-delivery regression.
- First-prompt validation cannot call an owned-session query before the session exists. Section B now defines pre-session project/account readiness, the explicit synthetic default, and existing-session readiness when no Pi root exists.
- Candidate ownership and expiry must be enforced in every model authority method. Section C names the exact methods, composition-selected owner/namespace policy and all three independent deadline clamps. Historical V1 remains unchanged.
- Follow-up admission races with runtime terminalization. Section B chooses a passive target read plus explicit `target_run_terminal` disposition if the run closes before consumption. The original receipt/messages survive; the run is never revived. This is specified behavior, not an accidental consequence of delivery timing.
- Stop may settle a run before its accepted members arrive. Section E requires late membership/disposition/failure-projection accounting without rerunning `terminal()` or changing the terminal run/epoch.
- Fixture capacity needed a concrete lifetime. Section E selects one persistent workspace claimant for the test database lifetime, acquired in the admission batch. Distinct losing first prompts leave no rows; host close and timeouts never release the claim.
- Throwing mocks do not prove legacy service rejection. Step 1 now requires real legacy owner checks with lower execution dependencies inert, and the test scope includes both service suites.
- Direct drain calls do not prove scheduled entrypoint composition. Step 1 now names actual `fetch`/`scheduled` boundary coverage in `server.test.ts`.

The cold reviewer confirmed that the early-provider-callback mapping requirement and the 009/010 boundaries were appropriately scoped. Corrections were incorporated and checked by the parent; no second independent acceptance of the final text is claimed. The attempted resume of that reviewer was unavailable because its agent handle had been cleaned up.

Considered and rejected: reopening accepted 007 merely because older notes still say BLOCKED; replacing every `trusted_v1` occurrence globally; enabling production to make a fixture pass; treating manually seeded D1 membership as product integration; expanding 008 to full tool parity, full observation/projection delivery or multi-workspace capacity. None is necessary for this slice. No independent reacceptance of the predecessor implementation was performed.
