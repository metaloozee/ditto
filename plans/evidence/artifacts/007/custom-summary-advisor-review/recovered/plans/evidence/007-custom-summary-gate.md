# 007 custom-summary gate

Status: **BLOCKED on remaining contract evidence**, not on the prior provider usage limit. The candidate is uncommitted in `/tmp/ditto-plan-007-3oi7vl`. The final runtime and repository commands pass. They do not establish every requirement in the accepted decision. Independent review must not authorize the remaining 007 adapters from these passing counts alone.

Base and current HEAD are both `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Execution used the requested OpenAI `gpt-6.1-sol` session; the environment identifies `PI_PROVIDER=openai` and `PI_MODEL=gpt-6.1-sol`. No provider, billing, account or credential configuration was changed. This is synthetic local work, not PD38.

## Scope and inspected candidate

The resumed executor read the accepted decision, plan 007, correction advisor review and complete authoritative runtime specification. The partial candidate was inspected rather than recreated. Runtime changes are confined to these files:

- `apps/runtime/src/pi-durable-host.ts`
- `apps/runtime/src/pi-durable-cooperative-fixture.ts`
- `apps/runtime/src/pi-durable-effects.test.ts`, inherited correction and explicitly named stock-Pi controls
- `apps/runtime/src/pi-durable-model-preparation.gate.test.ts`, inherited preparation gate
- `apps/runtime/src/pi-durable-summary.ts`
- `apps/runtime/src/pi-durable-summary.test.ts`

The approved specification diff was already present at resumption. It remains exactly the three replacements from the accepted decision. This evidence file is the only new planning artifact from this resumption. The plan, decision and earlier evidence already present in this worktree were not rewritten. No main-checkout edit, staging, commit, integration, worktree deletion, deployment, shared database operation, real credential access or live model request occurred.

Dependencies were already installed for the pnpm workspace. Runner dependencies were missing. `npm ci --ignore-scripts --prefix packages/sandbox-runner` installed them only in this worktree. Manifests and lock graphs remain unchanged. Builds wrote ignored outputs only in this worktree.

## What changed during resumption

The partial version-2 result path skipped generation's schema checks without supplying its own complete identity checks. The custom path now validates its own bounded response envelope before result accounting or consumption. It checks assistant role, nonempty bounded API identity, selected provider/model identity, allowed stop reasons, finite timestamp, content-array presence, bounded safe-integer usage counters, bounded finite costs, optional error text and the 8192-byte complete response ceiling. Summary-text validation separately rejects empty, oversized, unsuccessful and tool-use responses. The same response-envelope checks run during successful-result reuse and receipt reconciliation.

Current callback payloads must equal the persisted custom transcript and options, not merely have the same semantic transcript digest. Returned hook text must come from the exact recorded response. Custom task matching validates the policy parser, exact operation identity, null tool-call identity, SELECT-phase task, owner, task input, retained request, selected range and digest. A receipt-read exception cannot masquerade as a failed-summary receipt.

Summary policy remains `ditto-summary-1`; host compatibility remains the partial candidate's explicit `pi-1.0.1/ditto-host-3`. Tests reject host-2 meanings. Ordinary generation correlation remains version 1. Explicit stock-Pi fixtures retain their stock retry and missing-association behavior; their assertions were not weakened.

Added result-write rollback and result-flush fault points demonstrate that response and usage share the existing effect evidence transaction. There is no separate summary spending ledger, private Pi usage mutation, retry scheduler, task replacement or provider dependency upgrade.

The synthetic provider now returns the identity of the model actually dispatched, including `faux-2`, rather than always labeling a response `faux-1`. A fixture-only absent-custom-hook mode exercises guarded stock fallback denial.

## Prepared request and accounting evidence

The public hook's source is serialized as application data with optional focus instructions. Source over 32000 UTF-8 bytes is rejected, not truncated by this custom policy. The two-message request contains an application-owned system prompt beginning `Ditto summary policy 1` and the exact serialized public hook source as its user message. It does not copy Pi's private summary prompt or serialization.

The retained preparation contains policy, task, conversation, selected first-kept position, selected entry IDs, source digest, selected provider/model, thinking level, stream options and full transcript. Retained private fields use the existing owned encrypted host-field storage and seals. The custom provider callback uses a current signal-bound trusted association while Pi remains in SELECT. Recovery repeats the hook association; it does not infer ownership from a sole producer.

Captured fixture requests establish these configurations:

| Situation | Actual guarded request |
|---|---|
| Initial generation | `faux-1`, thinking off |
| Custom request committed with low thinking, then configuration changed and reopened | `faux-1`, low, `maxTokens: 1024`, `maxRetries: 0`, `cacheRetention: none` |
| Interruption before custom preparation, configuration changed, then reopened | `faux-2`, high, the same custom token/retry/cache limits |
| Newly prepared generation after the change | `faux-2`, high |

The dedicated suite captures complete transcript/options inside the guarded synthetic dispatch callback. The older preparation gate also prints its configuration capture. Neither establishes a Codex transport body or entitlement.

For successful-result recovery, the custom effect stays `result-recorded` while Pi remains in SELECT. Actual close joins the canceled local hook wait. Reopen revalidates the trusted hook and consumes the existing result. The summary provider dispatch count stays one, the custom effect row count stays one, and its usage remains in that original row once. Total fixture calls are two in the manual scenario because the initial generation is a separate call. Pi then supplies its real compaction entry/submission receipt and the effect becomes `pi-committed`.

Known error, abort, empty, tool-use and oversized-text responses have one reserved custom attempt. With both Pi retries and provider settings enabled in the fixture, the actual custom callback still carries `maxRetries: 0`. The owning local transition fails the affected run and pending follow-up assistant; the hook declines without recursively scheduling or aborting a task. Failure never refunds the reservation.

A transport failure without a recorded response stays admitted and unknown. Two reopens block subsequent model/tool admission and never redispatch. Invalid response identities or usage are rejected before consumption and leave a durable review block, not fabricated usage.

## Persistent handoff coverage

| Handoff or denial | Evidence and limit |
|---|---|
| Before custom preparation | Plaintext and encrypted close/reopen tests prepare from changed current configuration. No custom effect is admitted early. |
| Prepared request before admission | Plaintext and encrypted tests retain exact request/configuration through close/reopen. The preparation gate retains original low-thinking request and captures later high-thinking generation. |
| Preparation transaction rollback | Both storage modes fence later effects; rollback precedes any custom admission. |
| Preparation flush failure | Both modes fence live and reopened hosts; no custom dispatch occurs. |
| Admitted request without result | Both modes block model/tool admission across two reopens; original reservation is retained. Synthetic remote work remains separately accounted for. |
| Result plus usage transaction rollback | Both modes retain the admission without evidence; later effects are fenced. No summary is consumed. |
| Result plus usage flush failure | Both modes retain recorded evidence but a persistent storage barrier denies later effects. |
| Durable result before hook return | Both modes reuse the exact result after actual close/open, without repeat dispatch or duplicate usage. |
| Before actual Pi placement storage commit | Public Storage fault seam interrupts before the real batch; both modes recover the recorded result and place one summary. |
| After actual Pi placement storage commit | Public Storage seam performs the real batch, then holds publication; close waits for admitted settlement to join. Both modes reopen without repeat dispatch or conflicting placement. |
| Actual automatic and manual placement | Both modes produce a real Pi receipt, one custom reservation and one compaction entry. |
| Wrong range, digest, policy, task or conversation | Plaintext prepared-state mutation tests deny custom admission. Exact callback transcript/options mutation also denies dispatch. |
| Revoked authority, stale epoch and Stop | Custom prepared-request tests deny dispatch; existing host/effects suites retain fresh-authority, Stop, recovery-deadline and operation-deadline checks. |
| Expired invocation during preparation | Both modes deny custom admission without extending invocation authority. |
| Encrypted prepared/result tampering | Reopen fails closed before later I/O. Existing encryption suites retain owner, key, seal, route, transaction and history checks. |
| Absent/throwing custom hook | Both modes produce no stock summary dispatch or compaction entry. |
| Oversized source | Both modes reject before summary admission without custom truncation. |
| Generation retries, tools and history | Existing preparation/effects/host/storage/history suites pass, including genuine stock controls, completed tool recovery and unsafe-shell blocking. |

The automatic/manual initial-placement tests share the same owning implementation, but the crash-boundary tests above use manual compaction. They do **not** prove the complete automatic-compaction crash matrix with its waiting generation parent. That missing evidence remains a gate limitation.

## Unresolved supported handoff

Configuration/preparation serialization is not yet established. `summarize()` reads `root.agent()`, resolves the model, then awaits request hashing and encrypted sealing before committing `host_tasks.prepared`. The candidate has no demonstrated owning transition shared with public `root.configure()` that orders a configuration commit against that custom preparation commit. The full authenticated configuration-intent adapter remains out of scope for this dispatch.

A concurrent synthetic lookup probe requested configuration change during preparation. Initial experiment `24-config-race.log` expected the changed model and failed. The stronger ordering probe `25-config-race-ordering.log` showed that the configuration had **not** completed before the preparation transition. Thus the first failure was a bad ordering premise, not a reproduced stale-configuration defect. The final test checks the request against the configuration actually committed at that transition. It passes, but does not force the opposite commit ordering.

This is a precise verification gap, not a claim that Pi's supported APIs cannot serialize the handoff. Before approval, establish an owning supported configuration/preparation ordering and prove the configuration-commit-before-custom-preparation branch during asynchronous hashing/sealing. Do not declare the request committed earlier than its durable preparation commit, add a scheduler, or implement the remaining product configuration adapter merely to conceal this gap.

Together with the unrun automatic-compaction crash matrix, this prevents an honest READY verdict despite green aggregate commands. No unsupported upstream feature or fork was introduced.

## Commands and results

Every execution command ran from this worktree with:

```sh
env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true
```

Logs are preserved under `node_modules/007-custom-summary-logs/resumed/`. Earlier top-level logs remain unchanged. Commands below name exact final-state checks:

```sh
pnpm --filter @ditto/runtime typecheck
pnpm exec biome check apps/runtime/src/pi-durable-host.ts \
  apps/runtime/src/pi-durable-cooperative-fixture.ts \
  apps/runtime/src/pi-durable-effects.test.ts \
  apps/runtime/src/pi-durable-model-preparation.gate.test.ts \
  apps/runtime/src/pi-durable-summary.ts apps/runtime/src/pi-durable-summary.test.ts
pnpm --filter @ditto/runtime exec vitest run src/pi-durable-summary.test.ts \
  src/pi-durable-model-preparation.gate.test.ts src/pi-durable-effects.test.ts \
  src/pi-durable-host.test.ts src/pi-durable-storage.test.ts src/pi-durable-history.test.ts
pnpm runtime:verify
pnpm verify
git diff --check
git diff --cached --exit-code
git diff --exit-code -- '**/package.json' '**/*lock*' '*lock*'
```

Runtime and repository aggregate commands ran sequentially after the narrow tests, not concurrently.

| Check | Final result |
|---|---|
| Runtime typecheck, `27-typecheck.log` | passed |
| Scoped Biome, `28-biome.log` | passed, no edits; 45 warnings, no errors |
| Six nearest suites, `29-nearest.log` | passed, 255 tests: summary 69, preparation 2, effects 62, host 55, storage 41, history 26 |
| `pnpm runtime:verify`, `30-runtime-verify.log` | passed, runtime typecheck, 6 Node tests, 288 Worker tests across 11 files; new suite discovered by existing aggregate glob |
| `pnpm verify`, `31-verify.log` | passed, repository Biome, web typecheck, credential typecheck, 22 credential Worker tests, 3 credential Node tests, 815 web tests across 73 files, web build, runner typecheck, 79 runner tests across 11 files, runner build |
| Exact approved spec equality, `32-spec-equality.log` | passed; applied the accepted decision's three old/new pairs to the base spec in memory and compared the complete result to the current file |
| Diff whitespace, empty staging, frozen manifest/lock graph | passed |
| Automatic compaction at every crash boundary | not run; initial automatic placement only |
| Configuration commit completed before request persistence during asynchronous hashing/sealing | not established by the concurrent probe |
| PD38, account discovery, real provider transport, hosted eviction/deployment | not run, not authorized |
| Remaining 007 adapters, contracts/brain standalone gates | not implemented/not run separately; no shared contracts changed |

Preserved intermediate results:

- `01-typecheck.log` passed on the resumed partial state.
- `02-biome.log` failed formatting/import checks; subsequent scoped formatting fixed those errors.
- `03-summary-initial.log` had 23 passes and two failures. Result-fault injection fired while reconciling the previous generation before compaction. The fixture now restricts that fault to the custom effect handoff, without weakening fencing assertions.
- `04-nearest-initial.log` passed 186 tests.
- `05-summary-validation.log` passed 25 tests.
- `07-summary-handoffs.log` had 43 passes and two failures. The synthetic faux response helper ignored requested model overrides. Returning the actual dispatched model identity fixed the fixture; strict result validation was retained.
- `11-nearest.log` passed 243 tests; `12-runtime-verify.log` passed 276 Worker tests plus 6 Node tests.
- `13-verify.log` passed repository checks through web build, then failed runner typecheck because runner dependencies were absent. `14-runner-install.log` records the permitted scripts-disabled install. `15-verify.log` passed after installation.
- `19-nearest.log`, `20-runtime-verify.log`, and `21-verify.log` passed with 254 nearest tests, 287 runtime Worker tests plus 6 Node tests, and the repository gate respectively.
- `24-config-race.log` and `25-config-race-ordering.log` preserve the rejected ordering experiment described above. Neither is a library incompatibility verdict.

Inherited native-alarm intermittent failures remain historical evidence. No alarm timeout, assertion or safety policy was changed to hide them. Native-alarm checks passed in this resumption, which does not establish the cause of earlier failures or hosted reliability. Installed workerd continues to fall back from requested compatibility date `2026-09-16` to `2026-03-10`.

Environment: Node `v24.21.0`, pnpm `11.8.0`, pinned Pi Durable `1.0.1`, runtime Vitest `3.2.7`, Biome `2.4.5`. The approved spec has only these edit identities: generation configuration-rule scope, inserted custom-summary contract after actual-request-construction requirements, and OD7's summary exception. No other architecture rule changed.

## Final source identities

SHA-256 values identify the uncommitted candidate checked above:

```text
60c7b9ec7a2db18354599505f0e7c6d858a2c2b211ec48d4065757382f9b7b1b  apps/runtime/src/pi-durable-host.ts
9baee01e572dbf5c5fed4149bcb545a89b9c95532d00f654e1f72ce56dd9b576  apps/runtime/src/pi-durable-cooperative-fixture.ts
f2bb4b1d5c8ed22ec234ca15df8754b2ef240bf4dee3aa453c216fcc228d9c4c  apps/runtime/src/pi-durable-effects.test.ts
058ee49050271fe301da1fb92072ea2d1f9042eddf13f792af6e828cd4c6a65d  apps/runtime/src/pi-durable-model-preparation.gate.test.ts
cb0e527f52064286b36f9f02a536212c386832a9dc1eae95542364b1ccfa4590  apps/runtime/src/pi-durable-summary.ts
c6bf891d5fd6b8b375c228d336492b72eea677ff4a1aacf788c1281d7a41eb20  apps/runtime/src/pi-durable-summary.test.ts
a185f222019cbf7e7225411c8c00751dfa2209e34b0ca0e228af31b571c238ed  docs/specs/pi-durable-session-runtime.md
```

Full 007 is **not DONE**. This candidate requires independent review and additional prerequisite evidence. Remaining transport/account/configuration adapters are not authorized by this dispatch.
