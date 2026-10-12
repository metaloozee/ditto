# 008 partial stage-1 advisor checkpoint

Disposition: incomplete, not accepted as plan 008. Execution has been directed to continue after correcting test temporary-directory confinement. The parent made no implementation edits.

## Reviewed increment

Detached worktree: `/home/ayan/ditto-execution/plan-008-4WXvNW`, base `2487d56`. Execution uses `openai/gpt-6.1-sol` with medium reasoning. The initial dependency block and the subsequent executor report are preserved in [preflight evidence](008-product-commands.md) and [continuation evidence](008-executor-continuation.md).

The advisor read both new candidate contract/parser files, all five tracked source/test diffs, the clean verification launcher, dependency hash baseline and complete executor evidence. The increment adds V2 command parsing and candidate ownership isolation only. No admission, receipt reconstruction, trusted fixture composition, readiness, capacity, ordered host consumption, queue decision reconciliation, controls or product-to-Pi integration is implemented yet. There is no basis for 008 acceptance or dependent-plan execution.

The advisor independently recomputed all eleven manifest/lock/config hashes in `.execution-008/dependency-baseline.json`; all match. Tracked source and staging in main remain unchanged. The execution worktree has no staged changes and its tracked whitespace check passes. Local `.execution-008/` contains generated dependencies, toolchain, caches and logs and is untracked; it is not implementation source intended for integration.

The executor reports 37 web, 112 runtime and 164 credential Worker plus 3 Node baseline tests passing, followed by 49 contract tests passing. These are executor results, not independently rerun advisor gates. The first web typecheck failed on the expanded owner type. Its narrow correction rejects `pi_durable_v1` before the old coordinator authority path can grant ownership, but had not yet been tested at this checkpoint. Its new denial test also needs scoped formatting. Neither a green contract gate nor source inspection proves that correction.

## Confinement incident

The advisor confirmed that `.execution-008/clean-run.sh` omitted `TMPDIR`, `TMP` and `TEMP`. The existing web fixture creates journal directories with `mkdtempSync(join(tmpdir(), "ditto-journal-"))`. The executor observed `os.tmpdir()` as `/tmp` and stopped after disclosing the outside-worktree test writes. Exact temporary paths and remaining artifacts were not inventoried. No absence or cleanup claim is made. Synthetic passing tests do not waive the confinement requirement.

Continuation was directed under the existing authorization, without another dependency or operational expansion. The executor must use a worktree-local temporary directory, explicitly set all three temporary-root variables, verify actual `os.tmpdir()`, inspect bounded harness configuration for bypasses, and rerun all three baseline gates plus the current web typecheck. External temporary files must not be inspected or removed. Any mandated platform socket exception must be separately qualified rather than described as content-file confinement.

After those checks pass, the original authorized execution may continue in the same worktree through the refreshed plan's ordered stages and exact gates. Initial failures and this incident remain preserved. No staging, commits, integration, deployment, provider requests, shared database operation, external cleanup or main dependency repair is authorized. Final acceptance still requires a stable complete diff and independent verification.

## Subsequent socket-test authorization

The corrected launcher now sets all three temporary-root variables inside the worktree. The executor subsequently stopped on a separate hardcoded socket path. The advisor read `packages/sandbox-runner/src/control-channel.ts` and its complete test file. The first two real roundtrip tests omit the existing `socketPath` option, so server startup would unlink and bind an endpoint under `/tmp`; the other socket tests already pass paths derived from `os.tmpdir()`.

The user explicitly authorized a narrow test-only expansion to `packages/sandbox-runner/src/control-channel.test.ts`. Only those first two tests may receive matching worktree-local paths for their server and client calls. Production socket derivation, real socket behavior, assertions and the default path string test must remain unchanged. No external cleanup is authorized.

The prior agent handle was unavailable when resumed, so a fresh executor was launched on `openai/gpt-6.1-sol` with medium reasoning in the same preserved worktree. Its handoff includes the complete current-state inventory, historical failures, isolation requirements, exact authorized test expansion and the remaining plan scope. No new test pass or implementation acceptance is claimed by this dispatch.

## Independent credential baseline and continuation

The next executor completed the narrow socket changes. The advisor read the complete runner-test diff and ownership-test formatting diff. Both socket tests now pass identical local paths to their server and clients, preserve their original assertions and real roundtrips, and leave production socket code unchanged. The executor reports seven runner control-channel tests, 40 web baseline tests, 112 runtime baseline tests and web typecheck passing under the confined launcher. Those counts remain executor results.

Its credential gate was interrupted by a 120-second outer command timeout. The advisor read that interrupted log and the older complete baseline log. The older suite took 218.91 seconds, so a 120-second command budget was insufficient even for the known passing baseline. The interrupted log contains no suite-total result and does not demonstrate a failed assertion. The initial interruption remains preserved and is not converted into a pass.

The advisor independently ran `sh .execution-008/clean-run.sh pnpm credentials:verify` once in the execution worktree with a 600-second outer command budget. No test, Vitest timeout, configuration, product deadline or runtime deadline changed. The exact unfiltered gate passed exit 0, including typecheck, 164 Worker tests across two files and three Node checks. Worker duration was 258.01 seconds. The full log is preserved in [advisor baseline artifacts](artifacts/008/advisor-baseline/credentials.log).

This establishes the current credential baseline, not implementation acceptance. The same executor was resumed on `openai/gpt-6.1-sol` with medium reasoning to complete stage 1 and continue the ordered remaining plan. Known full-suite durations must inform outer command budgets; immutable test/runtime deadlines remain unchanged. The baseline hash inventory does not forbid the plan's explicitly allowed script-only root `package.json` registration of the new Worker suite. Dependency declarations and lockfiles still must be preserved. Plan 008 remains incomplete and unaccepted.

## Credential composition scope gap

The executor next stopped without further source changes because candidate model policy cannot be injected into the accepted credential owner. The advisor read the complete `apps/web/src/lib/codex-credential-do.ts` and the relevant `ModelProductAuthority` implementation. `requestModel` directly constructs `new ModelProductAuthority(this.env.DB)`, whose current authority SQL requires `trusted_v1`. There is no overridable policy factory, and the credential-state/decryption helpers are private.

The plan requires deployment-selected closed candidate owner/namespace policy in both product and credential dispatch, while preserving old/default composition. Its explicit allowed paths omit `codex-credential-do.ts`. Inferring candidate authority from the request or current D1 owner would violate that requirement, and duplicating dispatch in a fixture subclass would duplicate the accepted credential/claim protocol.

A narrowly scoped deployment-owned policy factory in `codex-credential-do.ts` is the recommended addition. Default composition must still construct the historical trusted policy, and only a separate fixture-owned candidate composition may select the candidate policy. Credential schema, storage, renewal, request protocol, mutable authority checks, exact claim, final permit/revision checks and default denial must remain unchanged. This is a scope clarification for 008, not reacceptance of 007. The user subsequently authorized that narrow additional file scope. The same executor was resumed on `openai/gpt-6.1-sol` with medium reasoning in the preserved worktree. Its handoff specifies a protected deployment-owned factory, unchanged default trusted policy, separate candidate fixture composition, no request-selected allowlist and no changes to credential storage, renewal, wire format or final authorization checks. Wrong-owner and namespace denials must remain zero-fetch and existing regressions must remain intact. No credential-file result or implementation acceptance is claimed by this dispatch.
