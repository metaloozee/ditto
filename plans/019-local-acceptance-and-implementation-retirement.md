# 019: Record local acceptance and retire superseded implementation

Status: BLOCKED on complete L5, plans 015–018. Base: `bcce03e`. Phase: L6.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 1–18 and testing decisions; PD01–PD37, PD39–PD42 locally, PD38 tracked separately; OD1–OD7.

## Outcome

Review actual evidence, close essential local behavior gaps and record local code-level acceptance. Retire old Node-specific source only after replacement coverage is demonstrated and the implementation transition is reviewed. Hosted readiness, actual Codex validation and independent browser QA remain separate evidence tracks.

No deployment/reset is authorized. If real-provider evidence is outstanding, record local fixture-backed acceptance with PD38 outstanding, never fully verified subscription support. If hosted entitlements are absent, mark those checks `not run`, not architectural failure.

## Current state and scope

Root `package.json` currently runs:

```json
"verify": "pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm runner:verify"
```

It omits `runtime:verify` and retained brain verification. `.github/workflows/ci.yml` installs root/runner dependencies and invokes only `pnpm verify`. `packages/session-brain` still contains the Node SDK continuation feasibility implementation; `packages/sandbox-runner/src/run-agent.ts` invokes `createAgentSession` in the execution image. Historical evidence lives in Git snapshot `52c9cef` and must remain referenced.

Scope: evidence review, missing essential tests through existing seams, bounded real-auth backend smoke, verify/CI scripts, removal of proved superseded source and dependencies, implementation-facing documentation. No broad refactor, test quotas, visual tests, benchmarks or Git push enablement.

## Ordered steps and checks

1. Read every phase's evidence and actual diff at its recorded commit. Build the full PD01–PD42 mapping to executable tests and exact environment/results. Any missing essential local guarantee blocks acceptance. Do not turn an empty test command, mocked platform claim or old Node pass into Pi evidence. Use the index's mapping only as intended coverage, not proof.
   Run `pnpm runtime:verify` and narrow mapped suites, expected exit 0. Re-run local Docker/Alchemy gates using their documented isolated fixture commands; absent prerequisites remain `not run` and block the affected local gate.
2. Add the bounded PD39 real-auth HTTP smoke using actual Better Auth session cookies against disposable local D1 through the product HTTP handler. Cover missing, expired, foreign and valid sessions. Create synthetic local users/sessions, not live OAuth credentials. Use existing auth configuration and ownership policy; do not replace Ditto sign-in. Injected identity tests remain useful but separately labeled.
   Add `apps/web/src/test/pi-durable-auth-http.test.ts` against a real local product Worker HTTP request boundary using Better Auth cookies and disposable D1. Reuse the product-only Worker setup from 006 or the local Alchemy fixture, and register its exact finite command in evidence. A direct handler call with injected identity or absent cookie infrastructure cannot pass PD39; missing infrastructure is `not run` and blocks local acceptance. Expected unauthorized cases have no command/provider/sandbox effects; valid requests receive durable acceptance. No browser automation.
3. Review dependency direction and binding graphs for all five modules. Product routes depend only on commands/product contracts; runtime alone owns scheduling/mutation/safety; recovery cannot publish/activate independently; privileged access returns no credentials; execution cannot grant authority. Shared contracts cannot import auth, DB, frontend or Pi. Re-run forbidden-import and forbidden-binding checks against actual bundled entry graphs.
   Run `pnpm contracts:verify`, `pnpm runtime:verify`, `pnpm typecheck`; use behavior tests for persistent handoffs rather than file-count assertions.
4. Produce an explicit retirement list after examining callers: trusted Node image, Node-to-DO bridge, custom AgentSession continuation, brain identity/capacity fields and sandbox agent engine entrypoints. Remove only what the now-covered candidate replaces. Preserve runner execution/Git/archive helpers and useful regression scenarios. Preserve historical evidence in Git/docs links. If any path still serves a real owner, stop source retirement until a separately reviewed safe transition exists. Do not apply a data migration/reset to make deletion easier.
   Before removal, run `pnpm brain:verify` while retained code remains. After removal, update scripts/CI so new runtime/storage/product tests are required and absent obsolete packages are not kept solely to preserve test counts. Run `pnpm verify` and `pnpm runtime:verify` afterward.
5. Update `README.md`, `docs/README.md`, implementation-facing runtime summaries and `CONTEXT.md` model terminology to match what actually landed. The spec overrides its old fixed-model glossary until corrected. Record local acceptance under `plans/evidence/019-local-acceptance.md` with exact versions, commands, local scope, known limitations and unrun external checks. Update plan statuses by evidence, not intention.

## Done and stop

All required local gates pass on the reviewed revision; PD38 and hosted/browser checks have explicit status. No competing owner or obsolete engine remains in the accepted candidate path. Verification/CI genuinely includes the runtime checks. A local report does not enable deployment or claim hosted service identity/process/billing behavior.

Refresh this conditional plan from completed phase evidence before execution. Stop retirement for unproven replacement behavior, unexplained failures or live-owner ambiguity. No reset, production operation, live subscription use, deployment, staging or commit. Future engine upgrades must repeat affected compatibility/state tests and preserve version blocks.
