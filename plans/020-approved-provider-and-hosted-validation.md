# 020: Validate actual Codex and hosted behavior with separate approval

Status: BLOCKED on explicit operational approval. Base: `bcce03e`. External evidence track, not a prerequisite for unrelated credential-free local work.
Provider prerequisites: 006/007 and the relevant passed safety/storage gates. Hosted prerequisites: local acceptance 019 and a reviewed deployment scope.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 6, 12, 17–18; PD38, plus hosted variants of PD08–PD10, PD14, PD28, PD30–PD33; OD1–OD7.

## Outcome and consent boundary

Establish which actual account/models/authentication flows and hosted platform behavior work. Deterministic fixtures cannot prove subscription entitlement, hosted callback compatibility, service-binding identity, process termination, egress interception, eviction/update behavior or billing.

This plan does not authorize using credentials, spending allowance, creating resources, deploying, resetting, staging or committing. Before any external operation, name the account/environment, resource names, intended requests, quota/spending impact and cleanup scope, then wait for approval. Do not read or print existing secret values to prepare the request for consent.

## Current evidence and scope

`apps/runtime/vitest.config.ts` uses local workerd configuration. `apps/runtime/src/feasibility.test.ts` explicitly records the old-incarnation lifetime as unrun:

```ts
expect({ exactOldIncarnationTermination: "NOT_RUN" }).toEqual({
	exactOldIncarnationTermination: "NOT_RUN",
});
```

That declaration is not a platform experiment. The authoritative spec permits PD38 to remain `not run` during local development. Historical architecture research uses a former fixed model; do not use it as Codex evidence.

Scope: approved bounded external experiments, any minimal test adapter needed to invoke existing interfaces, redacted evidence and narrowly justified fixes planned separately. Alchemy remains the only deployment owner. No paid checks are required merely to begin implementation.

## Track A: actual subscription contract

1. Review 006's supported client/auth flow and 007's exact request schema/discovery method. Request approval for a named test account and a bounded set of actions. Without approval, record `not run` and stop this track.
2. Connect through the supported product flow. Verify account-backed available models/thinking capabilities, serialized renewal and disconnect/revocation with the least requests needed. Do not expose credentials in runtime/sandbox bindings, logs, history or evidence. A bundled catalogue alone fails discovery evidence.
3. Through authenticated commands exercise selected-model requests/responses, a remote tool, follow-up, compaction, cancellation and configuration timing. Until 014 records full L4 acceptance, any mutating provider/tool experiment must use an explicitly disposable synthetic workspace. This track never authorizes retained-workspace enablement or bypasses a missing paired baseline. Include Git metadata only within its reserved attempt policy. Record tested model/account class and actual request behavior, not raw prompt/provider records. Confirm there is no fallback to separately billed API access.
4. Save `plans/evidence/020-provider-validation.md` with tested versions, approved scope, commands, request counts/usage where available and limits. PD38 passes only for the actual tested account/model/flow. Contract failure blocks claims of support; do not reinterpret fixture success as a pass.

## Track B: hosted platform checks

1. After local acceptance, request separate approval for a named disposable Alchemy deployment and costs. Confirm entitlement. If absent, record `not run` with reason rather than failure. Never run `pnpm deploy` against an inferred/default production stage.
2. Use the approved stage's exact Alchemy command, recorded before execution. Exercise real service-binding authority, denied public runtime access, executor/builder role denial, execution termination/isolation, credential-free egress, deployment/update/eviction and wakeup recovery. Check bounded capacity, platform quotas and billing observations separately from local policy defaults.
3. Revoke/delete only the explicitly approved disposable resources, with separate approval where the earlier scope did not include cleanup. Verify late requests cannot recreate removed content or gain authority. Record redacted results under `plans/evidence/020-hosted-validation.md`.

## Acceptance and maintenance

Use `passed`, `failed`, `not run` per experiment with exact command and environment. There is no prewritten executable deployment command here because stage/resources/approval do not exist yet. Run existing `pnpm runtime:verify` and `pnpm verify` for any code change, but they cannot substitute for these experiments.

A failed external check requires review of the affected design, not a weaker security contract or silent host/engine switch. Independent browser QA remains a separate later acceptance step, not an automated UI suite added here. Revalidate affected experiments after provider flow/client, platform identity, SDK/image or deployment changes.
