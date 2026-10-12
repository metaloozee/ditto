# 008 partial dispatch increment review

Status: narrow barrier cases independently pass; full 008 remains BLOCKED and unaccepted.
Executor: [implementation continuation](008-implementation-continuation.md), `a346735e-b600-46c`, now stopped.
Worktree/base: `/home/ayan/ditto-execution/plan-008-4WXvNW`, `2487d56291fb6196672b36cd9f9c632ef2dfa9c5`.

The advisor read the complete four-file increment patch and executor report. Changes add default-no-op credential preparation/final hooks, candidate-only live SQLite dispatch fencing, retention of exact validated permit deadlines and three admitted-work barrier regressions. The existing final product/host checks and noncandidate policy remain. The final local check reaches fetch without another await. No issuer, reactivation or host-origin/recovery code was implemented.

Independent final-byte runs through `sh .execution-008/clean-run.sh`:

| Command after launcher prefix | Result |
|---|---|
| `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t credential-local` | passed, 3 barrier cases; 32 unrelated cases explicitly skipped by filter; clean teardown |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/artifacts/008/advisor-current/runtime-probes.config.ts` | passed, all 4 unchanged advisor probes |

The advisor recomputed all 37 final source hashes, verified exactly the four reported files changed from the qualification baseline, and matched the complete archived entry source bytes to that baseline. The patch, complete source/prior-evidence archive, final source inventory and logs are preserved under main `plans/evidence/artifacts/008/implementation-20261011T081337Z/`. The incomplete 94MB compressed archive and 17MB generated-cache inventory remain preserved only in execution; the preservation record states that exclusion explicitly.

The executor's 177 Worker regression pass preceded final formatting and a final owner check. It is not a final-byte aggregate pass. Final-byte typechecks, contracts and focused barriers are reported separately. The replacement case reloads the exact closed receipt; its supplemental request has an invalid empty body, so a valid-body stale-descriptor restart test remains required. Generation reactivation, full deadline/scope coverage, trusted reset/recovery and the original remaining matrix are unfinished.

The unchanged `brain:verify` freshness test failed with `ENOTCACHED` for public Vitest registry metadata. Inspection confirms that it removes all inherited `npm_*` variables and runs offline. It therefore uses the worktree-local default cache under `.execution-008/home/.npm`, not the launcher's `.execution-008/cache/npm`. No test, source or dependency was changed to bypass this prerequisite. No cache repair was authorized or performed at that stop.

The maintainer has since approved narrowly scoped public test-cache preparation in the execution `.execution-008/home/.npm` only. It may use existing public worktree cache data and missing public npm metadata/tarballs needed by the unchanged test, with no project source/manifests/lockfiles/installed dependencies changed during cache preparation. The old handle expired before resume; fresh executor `0c803e84-9ccc-429` is running on `openai-codex/gpt-6.1-sol`, medium reasoning. It must clear this narrow prerequisite, then finish the remaining already-authorized source implementation BEFORE the final aggregates. That executor hit its usage limit before running cache preparation, after writing a source/evidence archive and an unexecuted public-cache script under execution `plans/evidence/artifacts/008/continuation-20261011T0915Z/`. The advisor inspected the script/checkpoint and recomputed all 37 final source hashes; none changed. The maintainer explicitly selected `openai/gpt-6.1-sol`, medium reasoning, for future subagents. Fresh executor `4e619cd4-5f9e-449` is continuing from that checkpoint. No cache outcome or remaining implementation result is claimed. Source integration, deployment and acceptance remain unauthorized.
