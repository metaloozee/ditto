# 014 Git, preview and checkpoint quiescence; L4 acceptance

Disposition: DONE for the local fixture scope, accepted with limits after one rejected review round; see "Review" and "Acceptance". Base `228636b` on `feat/pi-durable`. Executed 2026-10-21 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0.

## Refreshed design

The plan was refreshed against the integrated 011 to 013 code before coding:

- 011 to 013 already give one exclusive mutation owner: the runtime recovery ledger's held scope. Publication, restore and archive hold it, and a held scope closes ordinary run admission. UI Git and preview now take the same scope with purpose `workspace`. There is no product-side lock and no second route.
- UI actions reach the runtime as typed intents, `WorkspaceActionV1`: `git_status`, `git_commit` with a message, `preview_start` and `preview_stop`. Push and pull-request creation are not actions; `GIT_PUSH_ENABLED` stays false. Preview takes no command or port: the port is fixed at 10000 and the executor discovers the supported command.
- The old orchestrators, `session-git.ts` and `session-preview.ts`, open the workspace through the legacy runtime lease, which asserts the `legacy` owner. A `pi_durable_v1` session is refused before any sandbox call. A new test pins that, so they cannot mutate a candidate-owned workspace.
- Preview is a writer outside the scope. Publication reads `writers()` and treats a running or uncertain preview as unsettled, so a pair is never captured while it runs.
- Starting preview is a process start, not a file change. It never sets or moves the backup deadline. Changes the preview process makes, such as build caches, are captured by the next pair, which can only be published after preview stops.

## Implementation

| Part | Location |
|---|---|
| Action, browser action, result and denial contracts; fixed port and ten-minute deferral | `packages/runtime-contracts/src/workspace-action.ts` |
| Ledger steps `present`, `git_status` (observations) and `git_commit`, `preview_start`, `preview_stop` (mutations); scope purpose `workspace` | `apps/runtime/src/pi-durable-artifacts.ts` |
| Workspace controller: actions under the scope, fixed backup deadline, preview state and generations, backup tick, restart policy, restore quiescence | `apps/runtime/src/pi-durable-workspace.ts` |
| Cold-preview file restore from the current pair without Pi | `restoreFiles()` in `apps/runtime/src/pi-durable-checkpoints.ts` |
| Host wiring: `workspaceAction`, overdue denial of agent changes, `workspace` wakeup, preview authority and traffic, stop before restore | `apps/runtime/src/pi-durable-host.ts` |
| Composition hook `workspaceController()`, returning none by default; `workspaceAction` RPC | `apps/runtime/src/pi-durable-product-session.ts` |
| Owned product route: parse, ownership, restore barrier, then the runtime | `CandidateProductCommands.workspaceAction` in `apps/web/src/lib/session-command-candidate.ts` |

### Action admission

Each action is denied in this order:

1. `restore_in_progress` while a restore row is not `complete`, `refusing` or `refused`. This check and the preview state are read again after the last scope acquisition, because a cold start awaits a file restore in between.
2. `blocked` while the host is denied, any recovery operation is `unknown`, or preview is `unknown`.
3. `backup_overdue` for a mutation once the backup deadline has passed. A refused user `preview_start` is kept as demand.
4. `busy` when the scope cannot be acquired: a run, tool, restore step or publication holds the workspace, or the executor is not writable. Writable uses the publisher's rule: the authority is current, the executor slot is 1 and exactly one executor is live.

Executor authority is read when the scope is acquired and again after each step is admitted, just before dispatch. A newer executor generation at that point fails the step with `authority_revoked` before it reaches the workspace.

The product route parses the browser action strictly, checks ownership through the same subject read as commands, refuses while a D1 restore barrier is closed and then calls the runtime. A composition without a runtime action answers `runtime_unavailable`.

A step runs under a ledger permit. A known error settles `failed` and answers `rejected`. A lost mutation, such as a commit or a preview stop with no answer, settles `unknown` and blocks every later action and publication across reopen. Observations that fail are only `failed`.

### Backup deadline

- The first unbacked change records `unbacked_since` and a deadline ten minutes later. A UI commit records it before dispatch, so a lost commit still counts. An agent tool that is not a read records it after admission. Later changes and preview traffic never move it.
- The call that sets the deadline arms the host's `workspace` wakeup, for UI commits and agent changes alike.
- The alarm's backup tick publishes at once when preview is stopped and the host is quiescent. While preview runs, it waits until the deadline.
- At the deadline, new UI commits, preview starts and agent writes or shell commands are denied. The agent denial uses `EffectDenied("backup")`, which fails the tool call without denying the host. Reads and status still run.
- An unknown recovery outcome stops the tick until review; it does not retry.
- The tick then stops preview. Only termination evidence marks it stopped and advances its generation, which revokes every URL of the old one. Without evidence preview becomes `unknown`, the tick stops and no pair is published.
- A successful pair clears the deadline. A failed publication keeps the change committed and the deadline in place, and retries in 30 seconds.
- After the backup, preview restarts only for a start the user made while it was refused, or for traffic in the last five minutes before a backup stop. The restart is a separate action. A quiet session is not restarted. A refused start stays pending until a restart succeeds; a busy restart retries in 30 seconds.

### Preview and restore

- `previewAuthority(generation)` is true only for the running generation on a host that is not sealed, denied or behind a storage barrier, and has no restore in progress. It is the check a product preview proxy must make before forwarding.
- A cold start first asks the workspace whether files are present. If not, and nothing is unbacked, `restoreFiles()` restores the current pair's archive under a `restore` scope. It never forks the conversation and never schedules Pi. While changes are unbacked the conversation is ahead of every pair, so cold preview answers `preview_unavailable` rather than hide that loss; only a paired restore with loss acknowledgment may. The previous pair is not tried for the same reason. If the current pair does not restore, the result is `preview_unavailable`; the seed is never used.
- A paired restore stops preview before files change. Without termination evidence the restore waits and files stay untouched. Restore never restarts preview.

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-workspace-actions.test.ts` | passed, 18 tests on real DO storage: UI status and commit then a pair at product generation 2; a degraded backup keeps the commit and retries; UI Git holding the scope delays a command, and a run in flight makes a commit `busy`; the fixed deadline under repeated commits and traffic, denial at the deadline, preview stop, publication and traffic restart; restart only for traffic or a refused start; an unproven stop blocks across reopen; a lost commit blocks across reopen; cold preview restores the baseline pair without Pi, and is unavailable when every archive is tampered; restore rows deny actions and a stale wakeup does nothing; agent shell denied while overdue without blocking the host, then the backup retry; a restore stops preview first, and an unproven stop holds the restore; no current executor, several live executors, or a generation change after acquisition denies the step; an agent change alone arms the wakeup and its pair publishes; cold preview refuses a previous-pair fallback; racing starts run one process, and a restore fence revokes preview authority; a restore fenced during a cold file restore stops the start; cold preview refuses while changes are unbacked |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-restore.test.ts src/pi-durable-checkpoints.test.ts` | passed, unchanged |
| `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t "UI workspace"` | passed on real D1: an owned action reaches the runtime with only the typed action; a foreign user gets `runtime_owner_mismatch`; push, empty or oversized commits, a message on a non-commit and a supplied command are refused; a composition without actions answers `runtime_unavailable`; the real product session answers `unavailable` with no workspace composed; a closed restore barrier refuses with `restore_in_progress` before the runtime |
| `pnpm --filter @ditto/web exec vitest run src/lib/workspace-runtime.test.ts src/lib/session-git.test.ts src/lib/session-git-ui-actions.test.ts src/lib/privileged-git.test.ts src/lib/git-fetch-contract.test.ts src/lib/git-push-contract.test.ts src/lib/git-secret-policy.test.ts src/lib/session-preview.test.ts src/lib/session-command.test.ts` | passed, 146 tests. The new case refuses legacy preview, mutating Git and Git read leases on a `pi_durable_v1` session before any sandbox call. The push contract still asserts `GIT_PUSH_ENABLED` is false |
| `pnpm contracts:verify` | passed, 60 tests |
| `pnpm runtime:verify` | passed, 488 Worker tests plus the Node checks |
| `pnpm verify` | passed: credentials 235, web 870, runner 107 |
| `pnpm check` | passed |

### Mutation checks

Each change was applied alone and the workspace and restore suites were run, then the change was reverted.

| Mutation | Result |
|---|---|
| Agent tool ignores the overdue deadline | killed |
| Each change moves the deadline | killed |
| The tick publishes while preview runs before the deadline | killed |
| A stop without termination evidence counts as stopped | killed |
| An unknown step answers `busy` instead of `blocked` | killed |
| Restore skips the preview stop | killed |
| Any old traffic restarts preview | killed |
| UI mutations ignore the overdue deadline | killed |
| Executor authority not read again before dispatch | killed |
| The controller ledger ignores executor writability | killed |
| An agent change does not arm the wakeup | killed |
| Cold preview falls back to the previous pair | killed |
| No admission recheck after the last acquisition | killed |
| Preview authority ignores a restore fence | killed |
| Cold preview restores files while changes are unbacked | killed |

## L4 reconciliation

| Gate | Evidence | State |
|---|---|---|
| Initial baseline from an owned seed, verified archive and context | 011 builders and artifacts; 012 `establishBaseline` | local fixtures and miniflare R2 |
| Paired publication with one exclusive scope, recheck and commit | 012 | local fixtures |
| Command dispositions through a cutoff | 013 | local fixtures and real D1 |
| Paired restore with fallback, never the seed | 013 | local fixtures and real D1 |
| Git and preview under the same owner; quiescence before capture; fixed backup deadline | this plan | local fixtures and real D1 |

L4 is accepted for the local fixture scope only. Every gate runs in fixtures or miniflare. No deployed session composes an executor, publisher, restorer or workspace controller, so retained-user mutation stays off.

## Limits

- No deployed composition supplies `workspaceController()`. Every deployed action answers `unavailable`, and the web UI still calls the legacy routes, which refuse candidate sessions.
- The product preview proxy is not wired to `previewAuthority`, and bearer URL issuance is unchanged. Generation revocation is proven only at the runtime check.
- No real Git or preview executor exists for the candidate runtime. The fixture executor models status, commit, start and stop. Privileged Git and the runner were not changed, and no Docker termination case ran.
- An agent shell already running at the deadline is not cancelled. The backup waits for quiescence and new changes stay denied until then.
- Preview start and stop need a quiescent host: they answer `busy` while a run is active.
- No branch sync, push, pull request or metadata model attempt was added. The plan's atomic metadata attempt reservation is not implemented.
- The preview-state recheck after the last acquisition is not covered by a test. The two-start race test serializes on the held scope instead, so it would pass without the recheck.
- Step deadlines are not enforced while a step runs. A hung commit or preview step holds the scope until a restart marks it `unknown`.
- UI Git racing a restore is tested with a restore row written directly, not with a concurrent restore command.
- `previewAuthority` is synchronous and does not read executor authority. A lost executor revokes preview only once the host is denied or a restore fences it.
- A UI commit records the deadline before dispatch even when the commit is refused or has nothing to commit. This fails safe but can stop preview without need.
- The product route reads the full model subject, so a user with no model capability gets `model_unconfigured` for Git status and preview too.
- Plan step 1's routing of agent Git through runtime intents, with product-side Git authority and token mint-and-fetch, is not done. Agent Git still runs as a guarded shell tool under 009's policy.
- An executor that is not current answers `busy`, not `blocked`, so a client retrying on `busy` polls until authority returns.
- The backup tick replaces the `workspace` wakeup with its own result. A commit made while the tick awaits a restart is backed up at the tick's time rather than at once; no deadline is lost.
- Preview demand is only a start refused while overdue. A user's original start does not keep preview alive across backups without recent traffic.
- An `unknown` preview or commit has no reconcile or operator path, as in 011.
- Traffic is recorded by `previewTraffic()`, which nothing calls outside tests yet.
- Hosted process termination and egress checks remain outstanding.

## Review

Round 1 rejected the change. Findings and fixes:

1. Blocking: the controller's ledger ignored executor authority and cached the generation, so a commit ran with no current executor. Fixed with the publisher's writable rule and a fresh authority read before each step's dispatch; tested.
2. An agent change set the deadline without a wakeup of its own. The call that sets the deadline now arms the wakeup; tested with an agent-only change.
3. Cold preview could restore the previous pair's files under the current conversation. It now restores only the current pair; tested.
4. Preview start and stop did not recheck after their last scope acquisition. Both now recheck under the held scope; the fence case is tested.
5. Preview authority ignored host lifecycle. It now requires a live host with no restore in progress; tested for a restore fence.
6. A refused user start was dropped when its restart was denied. It now stays pending.
7. An unknown ledger outcome made the tick retry forever. The tick now stops until review.
8. to 10. Ownership was found sound and no second mutation route was found. The evidence gaps it listed are now limits, and the gate placeholders are filled.

Round 2 accepted with limits. It found one should-fix: a cold start restored the current pair even with unbacked changes, which would let a later pair join the advanced conversation to older files. Cold preview now refuses while anything is unbacked; tested. Its notes on demand recorded at the late recheck were fixed; the `busy` answer for a lost executor and the wakeup overwrite are listed as limits.

## Acceptance

ACCEPT WITH LIMITS for the local fixture scope, after the second independent review. L4 is complete in fixtures only. Retained-user mutation stays off until a deployed composition supplies the executor, publisher, restorer and workspace controller, with hosted termination and egress evidence.
