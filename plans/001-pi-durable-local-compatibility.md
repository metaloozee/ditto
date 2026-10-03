# 001: Prove local Pi Durable compatibility

Status: READY for a separately requested implementation session. No implementation has run.
Base: `bcce03e`. Phase: L0. Depends on: none.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 1, 3, 6, 16–18; the L0 exit gate and preliminary PD29 isolation checks, full tool-parity evidence belongs to 009; OD2, OD4–OD6.

## Outcome and limits

Prove one synthetic model turn and one remote tool in an actual local Worker with a SQLite-backed runtime DO and one Docker-backed execution sandbox. This is a compatibility experiment, not product enablement. Use only a new, explicitly disposable local fixture namespace. No existing data reset, deployment, live credentials, model allowance, staging, or commit is authorized.

The product Worker remains the credential owner. Pi Durable must be the only conversation/task engine in the candidate runtime. Keep the old path inactive for candidate identities, but preserve its source and tests until L6. Keep stable Sandbox 0.12.3; do not combine this work with an SDK migration.

## Current code and scope

`apps/runtime/package.json` depends on Sandbox 0.12.3 and Containers 0.3.7, not Pi Durable. `alchemy.run.ts` currently provisions the local runtime as a brain container:

```ts
const brainContainer = await Container("local-session-brain", {
	className: "SessionRuntime",
```

`apps/runtime/vitest.config.ts` uses `defineWorkersConfig`, compatibility date `2026-09-16`, and `nodejs_compat`. `apps/runtime/src/feasibility.test.ts` asserts old topology declarations; those assertions do not prove a model turn or Docker execution. Root `pnpm verify` currently omits `runtime:verify`.

Allowed changes: candidate entry/composition and tests under `apps/runtime`, its manifest, root lockfile/scripts, local-only composition in `alchemy.run.ts`, necessary execution-only runner support, and implementation evidence/docs. Preserve normal deployment resources. Do not repurpose the existing container-backed class identity or migrate an existing DO namespace.

Match the existing Worker-pool test configuration and TypeScript style. Use `unknown` for external values, explicit validation, and injected provider/execution dependencies. No generic agent-engine abstraction.

## Steps

1. Record `git rev-parse HEAD`, `node --version`, `pnpm --version`, Docker version, exact installed Sandbox/Alchemy/workerd versions and image tag/digest. Read the selected upstream package exports, README, normative storage/task contract, and provider fixture example. Research started at upstream `7fbbd5f4a1d982bb02d63472dde0774fa639f99b`, package 1.0.0; this is a candidate, not an instruction to assume compatibility. Pin an available compatible `@earendil-works/pi-durable`, `@earendil-works/pi-ai`, `@earendil-works/chord` and toolchain set exactly. Compare the published artifact/exports against the researched revision and record any difference. If unavailable, record a blocked gate rather than substitute the coding-agent SDK.
   Verification: `pnpm --filter @ditto/runtime typecheck`. Expected: exit 0 after dependency/composition changes; record earlier baseline failures separately.
2. Add a distinct local-only Alchemy branch selected by `DITTO_LOCAL_PI_DURABLE=1`, a new candidate Worker entry `apps/runtime/src/pi-durable-local.ts`, and a new regular SQLite class/namespace such as `PiDurableLocalRuntime`. Do not reuse `DITTO_LOCAL_RUNTIME_TOPOLOGY`, the container-backed `SessionRuntime` identity or its server entry. Give the candidate Sandbox a separate Worker-owned identity with `maxInstances: 1`. The fixture branch must not fall through into normal website/database/bucket resources or modify the website migration transform. Select isolated fixture configuration before loading normal `.env.local`/`.env` credential bindings; preserve the normal path unchanged. The verifier must sanitize its child environment and never forward existing product/provider credentials. Inject synthetic provider/authority dependencies at this entry, with a credential-free private fixture product binding only if the experiment needs one. Public runtime fetch remains denied. Fail closed outside local mode; do not hand-author a second deployment path.
   Add a root script `runtime:local:verify` backed by `scripts/verify-pi-durable-local.mjs`. It creates fresh fixture state, starts the selected Alchemy dev subprocess, waits for bounded readiness, drives the synthetic turn through local test/private transport, verifies the sandbox marker/result and shuts down only its own subprocess/resources. It exits nonzero on timeout, failed assertion or missing Docker and never silently skips the integration. Record the resolved Alchemy command/generated config and state directory in evidence. Verification: `pnpm runtime:local:verify`, expected exit 0 with a Docker-backed result. Missing prerequisites produce evidence `not run`, never a pass.
3. Bundle only supported portable Pi imports. Use a deterministic provider fixture, deployment-owned registry, sequential tools, and an execution adapter with no Worker/host filesystem or shell fallback. A stock plaintext SQLite facade is allowed only for this synthetic experiment. No retained content. Explicitly disable repository settings, executable extensions, MCP, skills, prompts, themes and context discovery; no Codemode. Install only the deployment-owned synthetic tool/fixture registry. Run a tool which writes/reads a fixture marker in the execution sandbox, not on the trusted host.
   Verification: add `apps/runtime/src/pi-durable-compatibility.test.ts`; run `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-compatibility.test.ts`. Assert a committed answer and tool result, correct sandbox file, failure without a reachable executor, and no local fallback. This Worker-pool test is a component check, not the Docker gate. `pnpm runtime:local:verify` must drive the actual Alchemy candidate and assert the marker exists only at the sandbox's unique fixture path, with no trusted-host tool fallback. A mocked executor cannot pass L0.
4. Extend forbidden-import/binding checks for the candidate entry graph. Distinguish test-runner Node imports from trusted runtime imports. Add candidate-specific import/bundle checks, for example `src/pi-durable-imports.test.ts`; the existing test walks web policy files and cannot prove the candidate bundle. Inspect the actual bundle, including dynamic imports. Start the candidate without `nodejs_compat` if its pinned dependencies permit it. If a supported non-filesystem compatibility feature is needed, document exactly why and prove filesystem/process APIs are unreachable rather than treating the flag itself as proof of portability. Reject Node filesystem/process dependencies used for trusted execution and imports of product auth/credentials/UI. An unused compatibility shim is not evidence of safe tool behavior.
   Verification: `pnpm --filter @ditto/runtime exec vitest run src/forbidden-import-graph.test.ts src/pi-durable-compatibility.test.ts` and `pnpm runtime:verify`, expected exit 0.
5. Save a redacted L0 record under `plans/evidence/001-local-compatibility.md`: versions, local commands, fixture identity scope, actual result, import graph findings, artifact locations and limitations. Record local tests, Docker integration, live Codex and hosted checks separately as `passed`, `failed`, or `not run`. Update this plan's status and the index, not the architecture claims.

## Done criteria

- The exact locked set bundles and executes the model/tool fixture in local workerd plus Docker through Alchemy.
- Remote failure cannot invoke a trusted-host tool. Only one runtime/executor fixture can act.
- No product user is routed to the candidate and no historical source/evidence is removed.
- `pnpm runtime:local:verify` and `pnpm runtime:verify` pass. The first command must exist after this plan and perform the real Docker test, not merely launch a never-ending dev server. Run `pnpm verify` for the final implementation diff; retain `pnpm brain:verify` if shared contracts or retained brain inputs change. Report unavailable checks honestly.

## Stop and handoff

A successful Node test, import-only test, or mocked Sandbox is insufficient. Stop if portability needs a maintained fork, Node brain, private Pi patch, second engine, or Sandbox migration. Do not proceed to L1 until L0 evidence passes. Later plans must resolve real exported APIs from this pinned set rather than invent them.

Maintenance: changing any pinned framework/provider/task/tool version invalidates affected compatibility evidence. Keep fixture configuration credential-free and separate from normal development data.
