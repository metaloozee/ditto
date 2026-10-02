# 005 recovered continuation handoff

Historical recovery handoff. Retry executor `b5bf9a10-e631-402` completed an eight-file repair using `openai-codex/gpt-6.1-sol`, High reasoning. The [continuation 3 review](005-continuation-3-review.md) now records current source and independently passing gates. Plan 005 remains incomplete. Executor `392d9cad-b1c1-4df` was stopped by the user for machine shutdown while implementing R2. Its partial changes are preserved but unreviewed. [005-RESUME.md](005-RESUME.md) is the current restart handoff; resume with `openai-codex/gpt-6.1-sol`, High reasoning, when the user returns. The advisor will review that slice and continue R3 brokers and R4 UI Git under the existing execution authorization, without asking the user to restart the plan. The remaining-work section below still applies. No model substitution, source integration or deployment is authorized.

## Provenance

The registry no longer knows executor `598541a8-cdd0-4fa`, and its reported temporary transcript path no longer exists. There was no completion report available to the advisor. Its source and local logs remain in `/home/ayan/ditto-worktrees/plan-005-codex`, branch `codex/plan-005-transport`, HEAD `13480bc7f4daf9489a0aa7cf7fea071a1115c8c3`. No process with that worktree as its working directory was found during recovery.

The advisor preserved all 42 current source paths, 23 modified and 19 added, in [recovered evidence](005-review-evidence/recovered-continuation-1/). Initial 28-path evidence remains separate. Do not reset either candidate or historical logs.

## Newly observed implementation

- `apps/runtime/src/brain-dispatch.ts` routes continuation, remote tool/result and read-snapshot control operations. It checks envelope identity and committed position.
- `executor-dispatch.ts` creates a D1 execution admission, repeatedly revalidates authority, writes a bounded job, calls the image CLI through Sandbox RPC, redacts returned results and closes the admission.
- `session-runtime.ts` adds an awaited execution adapter, current-execution checks and committed-result reads. Failed execution becomes unknown; result persistence remains a barrier. These changes still need full adversarial review against accepted 004 invariants.
- `runtime-product-service.ts` implements only execution-environment materialization. It checks D1 plus the owning coordinator before and after decrypting. It does not yet implement Git mint-and-fetch, capacity or identity service callbacks.
- Additive migration `0021_runtime_execution_admissions.sql` and matching schema exist. The product entrypoint exposes environment materialization; the runtime entrypoint exposes current-execution checks and actual model-configuration presence.
- Prompt admission now persists brain-only startup intent fields. Complete two-role startup registration/reservation and builder/migration/lifecycle callbacks are still missing.
- `remote-search.ts` uses fixed `/usr/bin/rg` rather than synchronous JavaScript regex. `brain-transport.ts` has finite body-read cancellation and fresh deadline checks.
- Real product default-handler negative tests and local named-capability/Docker experiments were added. Executor logs are under candidate `plans/005-execution-evidence/continuation-1/`. Those logs alone are not independent acceptance. The named-capability log includes a missing `ContainerProxy` export warning that must be resolved or explicitly bounded in the test claim.

## Independent recovery checks

All commands below returned zero against the recovered source:

- `pnpm --filter @ditto/web exec vitest run src/lib/brain-transport.test.ts src/lib/executor-dispatch.test.ts src/lib/session-runtime-security.test.ts src/server.test.ts`
- `npm run build --prefix packages/sandbox-runner`
- `node /home/ayan/ditto/plans/005-review-probes.cjs "$PWD"`: all six checks pass, including the three formerly failing deadline/grep probes.
- `pnpm --filter @ditto/runtime typecheck`
- `pnpm typecheck`
- `git diff --check`

Full gates were not rerun during recovery. Initial full-green results describe the earlier candidate, not these additional changes. Paid P-Bridge/P-Model/P-Git remain NOT RUN. No deployment or actual provider/GitHub operation was performed by the advisor.

## Work still required

Continue the original plan and [R1-R8 review](005-execution-review.md), accounting for the source changes above. Do not redo fixed search/deadline work unnecessarily.

1. Complete durable startup, identity, capacity and lifecycle intent callbacks with fresh D1 and race tests. Brain-only prompt fields do not authorize a two-role startup, and authority cannot derive from caller IDs/pools. Keep the legacy trusted-window fence and real-user execution gates closed.
2. Replace `runtime-egress.ts`'s `privileged_transport_unavailable` branch with the approved runtime model broker and product Git mint-and-fetch protocol. Every spend/network call needs current admitted authority; metadata allowance and three-denial closure remain required. Do not import product key ownership into runtime or pass tokens across the service binding.
3. Complete model-free, idempotent, strict UI Git command admission and serialized execution. `packages/runtime-contracts/src/command.ts` and `apps/web/src/integrations/trpc/routers/session-git.ts` remain unchanged. Agent Git stays current-run effects. Push remains disabled.
4. Review and harden the new dispatch/environment implementation: Stop races, duplicate delivery, result conflict, persistence outage, epoch/identity replacement, bounded result schemas, no host fallback and secret absence across forbidden children. Preserve accepted 004 wakeup and uncertain-writer behavior.
5. Complete T27-T30 local evidence and real named-service/public-handler tests. Run all exact original gates, inherited `verify`, `runtime:verify`, `brain:verify`, the independent probes and relevant 004 regressions before requesting acceptance.

Use `openai-codex/gpt-6.1-sol` with High reasoning. Write source only in the retained isolated worktree. No commits, staging, merges, push, PRs, production access, shared migrations or paid tests. Preserve historical migrations and evidence. Keep a short worktree-local handoff file current after each implemented area so another lost registry does not lose the execution state.
