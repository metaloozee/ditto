# 007 custom-summary advisor review

Status: **BLOCKED pending configuration/preparation ordering and automatic crash-recovery evidence**. The maintainer requested Continue. A separate correction executor must close those prerequisites before any downstream 007 adapters. Nothing is integrated or committed.

## Candidate and independent observations

The completed retry returned BLOCKED, not READY. Its [recovered evidence](007-custom-summary-gate.md) records 69 summary tests, 255 nearest tests, 288 runtime Worker tests plus 6 Node tests, and a passing repository gate. Those broader results remain executor-reported. The advisor inspected the actual tracked host/fixture/effects/spec diff and complete new summary module and test, and reran the summary suite in the old worktree. [The independent output](artifacts/007/custom-summary-advisor-review/summary.log) records **69 passing tests** with runtime shutdown. The command's explicit exit-status record was not retained.

The subsequent runtime verification output is empty, and repository/Biome review logs are absent. The verification command was interrupted. The advisor cannot claim independent aggregate passes or full candidate acceptance.

The implementation makes the custom selection-phase request explicit with correlation version 2. It retains encrypted preparation, disables provider retries, reserves one nonrefundable attempt, persists response and usage together, reuses successful evidence, and checks actual Pi placement receipts. Generation retains correlation version 1 and separate stock-Pi control fixtures. The spec diff matches the three accepted edit shapes on inspection; its full-file programmatic equality still requires an independent rerun.

## Remaining prerequisites

1. In `PiDurableHost.summarize()`, the candidate reads the agent configuration before asynchronous request hashing and encryption, then commits `host_tasks.prepared` through a separate host transition. No shared owning configuration/preparation serialization is present. The last race test requests configuration during a model lookup and dynamically accepts whichever configuration completed first; it did not force the configuration-before-preparation commit ordering. This is a contract and evidence gap, not an independently reproduced stale-configuration bug or an upstream incompatibility verdict.
2. Manual close/open tests cover preparation, unknown admission, durable success and Pi placement boundaries. Automatic compaction has initial-placement tests only. Its waiting generation parent must be exercised at the same boundaries, including continued generation after a reused summary and no later model/tool dispatch after an uncertain summary.

Do not fix these by pinning an entire command, weakening admission, inventing a provider retry scheduler, patching Pi, or changing the custom preparation point to its earlier configuration read.

## Lost temporary worktree and exact recovery

On the next maintainer Continue, `/tmp/ditto-plan-007-3oi7vl` did not exist, and `git worktree list --porcelain` listed only the main checkout. The old executor handle and its `/tmp` output were unavailable. The advisor did not delete the worktree. The cause of its disappearance is not established.

The interrupted candidate archive and final tracked source patch survived under `plans/`. Complete prior read-tool results in this session also survived. The advisor extracted only the final summary module, final summary test and executor evidence into [recovered artifacts](artifacts/007/custom-summary-advisor-review/recovered/). Both source files exactly match their recorded final SHA-256 values, not a reconstruction from memory:

```text
cb0e527f52064286b36f9f02a536212c386832a9dc1eae95542364b1ccfa4590  apps/runtime/src/pi-durable-summary.ts
c6bf891d5fd6b8b375c228d336492b72eea677ff4a1aacf788c1281d7a41eb20  apps/runtime/src/pi-durable-summary.test.ts
```

The first restoration executor correctly stopped because the interrupted archive's preparation test did not match the final hash. The advisor's assumption that this file was unchanged was wrong. The archived test was pre-format. Pinned Biome 2.4.5 read-only stdin formatting, with no source write, recovered the exact recorded final file under the recovered artifacts directory:

```text
058ee49050271fe301da1fb92072ea2d1f9042eddf13f792af6e828cd4c6a65d  apps/runtime/src/pi-durable-model-preparation.gate.test.ts
```

The expected identity was not revised or waived. [Restoration stop evidence](007-custom-summary-restoration-stop.md) and its failed-state archive remain preserved. The handoff now supplies all three exact untracked files directly. The executor must still verify all seven original hashes together before correction work.

The recovered evidence is a complete earlier tool result, but no prior evidence-file hash was recorded. The retry's detailed raw logs were not recovered. Do not represent that prose as independently verified output.

A fresh detached worktree was created at `/home/ayan/ditto-execution/plan-007-recovery` from the unchanged base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. It is outside `/tmp` and has not yet had candidate source restored. The separate executor must apply the preserved tracked patch, restore the exact untracked files, and verify **all seven final source hashes** before modifying the candidate. Failure to reconstruct any recorded source identity is a stop condition.

Only planning/evidence artifacts and detached-worktree creation were performed by the advisor. No source edit in either checkout, main dependency repair, stage, commit, merge, deployment, live provider/account call, credential access, shared database mutation or deletion occurred.
