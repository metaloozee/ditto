# 005 continuation 3 review

Verdict: **NOT ACCEPTED. Plan 005 remains incomplete.** The eight-file repair is useful and passes independent verification, but required startup/capacity, model/Git broker and UI Git behavior is still absent. Do not unblock 006 or integrate this candidate as completed 005.

## Reviewed source

- Worktree: `/home/ayan/ditto-worktrees/plan-005-codex`.
- Branch: `codex/plan-005-transport`.
- HEAD: `13480bc7f4daf9489a0aa7cf7fea071a1115c8c3`.
- Executor: `b5bf9a10-e631-402`, `openai-codex/gpt-6.1-sol`, High reasoning.
- Full candidate: 42 source paths, 23 modified and 19 added, all unstaged and uncommitted.
- This continuation: eight changed paths, no additional source paths and no removed recovered work.

The advisor reconstructed the previous 42-file state from saved diffs and verified every byte against its prior hash manifest. All current hashes match the executor's new manifest. The advisor read the actual [579-line delta](005-review-evidence/continuation-3/eight-file-delta.diff), its implementation context and test fixtures. All 42 hashes remained stable through independent gates.

[Review evidence](005-review-evidence/continuation-3/) contains the scope, verified before-copies, delta, gate logs, focused results, independent probes and named-capability output. Historical failures and recovery evidence remain untouched.

## Changes verified

1. The contracts package now validates bounded result content, permitted text/image variants, details bytes/nesting and Boolean error flags. Both the executor and Worker apply it. Shell results cannot use the image variant.
2. Worker result redaction covers object keys as well as values and text. Redacted-key collisions fail closed. Invalid acknowledgments do not cross the durable result barrier or authorize automatic replay.
3. Environment materialization reads fresh D1 authority after its final awaited coordinator callback. The regression cases revoke owner, identity or admission authority during that callback.
4. The bridge revalidates source, operation and deadline after dispatch, before returning the result. Revoked callers are denied while already-recorded outcomes remain durable.
5. Additional tests exercise overlapping duplicate delivery, later-effect serialization, job-preparation authority changes and failure to close the D1 admission after execution.
6. The local Worker test configuration now declares `ContainerProxy` as a WorkerEntrypoint, not a Durable Object. The independent capability run no longer emits the earlier missing-export warning.

These changes fit the selected plan. No unrelated source change was found in this continuation. They do not complete its missing services.

## Independent verification

All twelve gate invocations in `005-review-gates.sh` returned zero:

| Gate | Result |
| --- | --- |
| Exact nine-file phase web selection | 143 tests PASS |
| Binding graph | 2 tests PASS |
| Remote tools | 18 tests PASS |
| Runner typecheck and verification | PASS, 97 tests and build |
| Runtime and root typechecks | PASS |
| `pnpm check` | PASS, 11 inherited warnings |
| `pnpm verify` | PASS, 872 web and 97 runner tests, builds |
| `pnpm runtime:verify` | PASS, 26 tests |
| `pnpm brain:verify` | PASS, 43 brain and 29 contracts tests, builds/typechecks |
| `git diff --check` | PASS |

Additional independent checks:

- Journal, control, delivery, dispatch, bridge and real product default-handler tests: 119 PASS across six files.
- `005-review-probes.cjs`: six PASS, zero failures. The original expired-request, hostile-regex and binary-search failures remain fixed.
- Local workerd capability experiment: bound named entrypoints callable; unbound caller cannot invoke them; eight public path/header probes return 404. Both pinned SDK class registries contain their catch-all handler.

Brain freshness selects three tests and skips three unrelated cases before the full suite. Local workerd retains its existing compatibility-date limitation. These do not establish paid platform behavior.

## Still blocking acceptance

- **R2:** full two-role startup/identity/capacity callbacks, builder/migration/lifecycle intents, idempotent assignment and termination-only capacity release remain absent. Brain-only prompt fields are insufficient.
- **R3:** `runtime-egress.ts` still returns `privileged_transport_unavailable` for model, Git and action requests. Runtime model spending/metadata/denial policy and product Git mint-and-fetch are not implemented. The product service currently provides only environment materialization.
- **R4:** strict browser/server Git command variants, authenticated model-free idempotent admission, trusted tRPC adapters and coordinator Git serialization remain unchanged.
- **R1/R5:** complete crash/Stop/window lifecycle and no-host-fallback evidence remains incomplete. The dispatch fixture substitutes Sandbox RPC. Its launch-environment assertion checks a constant `{brain: {}, executor: {}}`, not actual launch calls, so it does not establish T30 launch isolation. Actual launch and forbidden-child checks still need to be implemented.
- The named-capability experiment uses an esbuild bundle with `keepNames: true`, not the deployment bundle. It proves only that local configuration. It neither launches containers nor verifies HTTPS interception. Its product public handler is the private fixture; real TanStack default-handler tests run separately.

The next execution should implement the missing R2 service protocol, then R3 brokers and R4 Git admission. Further hardening of the existing subset cannot substitute for those requirements. Preserve the current fixes and their regressions.

P-Bridge, P-Model and P-Git remain **NOT RUN**. The advisor did not rerun Docker boot/build evidence or all historical standalone 004 probe generations. No production access, shared database migration, staging, source commit, merge, push or deployment occurred. The executor has finished this run; no continuation agent is currently running.
