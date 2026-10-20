# 009 remote coding tools

Disposition: DONE for the local fixture scope, accepted with limits after one rejected review round; see the acceptance section at the end. Base `e0063eb` on `feat/pi-durable`. Executed 2026-10-20 in a credential-free cloud container: Node 24.22.0, npm 12.0.2, pnpm 11.8.0, Docker 29.9.1.

## Refreshed design

The plan was written against `bcce03e`, before 008. It was refreshed against the integrated 008 host before coding:

- `PiDurableHost.tool()` already admitted one exact effect per Pi tool call, bound to command, run, submission, task, call and epoch. One effect per call is kept. A second admission inside one call is impossible because tool effects never replay.
- Pi Durable 1.0.1 ships `read`, `write`, `edit` and `bash` only, and they touch files through a local `ExecutionEnv`. They are not used. Ditto's runner already runs `@earendil-works/pi-coding-agent` 0.85.1 tools, so the executor calls those exact tool definitions. This preserves names, arguments, output formats and truncation without reimplementing them.
- The synthetic product model protocol from 007 carries text only. Product commands therefore cannot make the faux model emit tool calls without widening that protocol, which 007 forbids. Runtime tests drive tools through the real host guard with a scripted model instead.

## Implementation

| Part | Location |
|---|---|
| Typed contract: seven tools, bounded arguments, effect classes, `ToolOperationV1`, `ToolOutcomeV1` (completed, rejected, pending, unknown) | `packages/runtime-contracts/src/tool-execution.ts` |
| Execution-only handler with per-operation journal, identity checks and interrupted-operation classification | `packages/sandbox-runner/src/tool-exec.ts` |
| Image command `ditto-exec init <session> <generation>` and `ditto-exec run <file>` | `packages/sandbox-runner/src/tool-exec-cli.ts`, `Dockerfile` |
| Deployment-owned Pi tools, exact dispatch, evidence and the Sandbox command transport | `apps/runtime/src/pi-durable-tools.ts` |
| Host: remote tool names, `mutation` operation class (never replayed), `ToolPermit` passed to dispatch after the final permit, digest-based receipt matching, correlation size check before sealing | `apps/runtime/src/pi-durable-host.ts` |
| Product session installs the tools; `remoteExecutor()` returns none until deployment composition binds a sandbox | `apps/runtime/src/pi-durable-product-session.ts` |

Effect classes: `read`, `grep`, `find`, `ls` are observations (`new-observation`). `write`, `edit` are mutations and `bash` is shell; both use `never`. Nothing replays automatically.

Dispatch carries the admitted effect operation, epoch, invocation generation and the effect's operation deadline. The executor rejects a different workspace, a different executor generation, a passed deadline, malformed input and a reused operation ID with different input. Generations only move forward.

Outcome handling in the runtime tool:

- Completed and rejected outcomes are recorded as host evidence and returned to Pi as the tool result (`isError` for tool errors and rejections). Evidence holds `{isError, contentDigest}` so outputs up to the 50 KB tool bound fit the 8 KB evidence bound, and the receipt check compares the digest of Pi's committed content. Pi's own output bound is raised above the executor bound so Pi never rewrites the text.
- A lost response triggers one reconciliation dispatch with the same operation. The executor's journal returns the stored completion, or runs it for the first time if the first request never arrived.
- Pending, unknown and still-lost outcomes record no result. The effect stays unresolved, which blocks every later model and tool admission across reopen (PD12).

Executor journal recovery: the journal is read before the workspace and generation checks, so a reconciliation after the executor moved to a newer generation still reports prior work. Each run attempt is claimed by an exclusive create (a hard link that never replaces) holding the claimant's process ID, so overlapping requests for one operation run it at most once; a claim held by a live process is `pending`, and a claim whose process died before its start record lets the next attempt run. A completed record returns the stored outcome. A started observation reruns. A started shell is `unknown` and never reruns. A started mutation is completed if the file matches the recorded after-digest, reruns only if it still matches the recorded before-digest (expected content), and is `unknown` otherwise. A journal whose process is still running is `pending`; a zombie counts as dead.

## Parity inventory and gaps

| Behavior | Status |
|---|---|
| Names and argument shapes of `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` | Same as runner 0.85.1, checked by the contract parity test |
| Text output, truncation notices, edit error text, `.gitignore` handling | Same code path as the runner |
| Image reads | Changed. Image files now return an explicit error result instead of an image attachment, because Pi Durable 1.0.1 tool results and host evidence do not support images. Needs maintainer approval as a product parity change. |
| `grep`/`find` binaries | Changed. The image now installs `ripgrep` 13.0.0 and `fd-find` 8.3.1 and the executor sets `PI_OFFLINE=1`. Before, the stock tools downloaded binaries at run time. |
| Shell environment | The shell child gets only `PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `TZ`. This is not a secret boundary: `bash` and `read` can still read `/proc/1/environ`, so the guarantee must be that the sandbox container environment holds no secrets at all. |
| Executor state | `read`, `write` and `edit` refuse paths that resolve, through symlinks, into the executor state directory. `bash`, `grep`, `find` and `ls` run as the same user and can still reach it; a separate user for executor state is a deployment requirement. |
| Streaming partial tool output | Not implemented. Results arrive when the operation completes. |
| `ditto_push_branch`, `ditto_open_pull_request` | Not ported. Privileged Git stays disabled until 014/015, so PD30 and PD31 remain partial. |
| Stop during a running remote shell | The runtime wait is cancelled; the remote process stops at the operation deadline. Trusted termination evidence stays with hosted checks (PD14). |
| Argument bounds | Write content and edit text 96,000 bytes, command 16,384 bytes, paths and patterns 4,096 bytes, encoded arguments 100,000 bytes, so the 128 KB correlation always fits. |

## Checks

| Check | Result |
|---|---|
| `pnpm --filter @ditto/runtime-contracts exec vitest run src/tool-execution.test.ts` | passed, 3 tests |
| `npm test --prefix packages/sandbox-runner -- src/tool-exec.test.ts` | passed, 16 tests: every tool on real files, error and image results, no ambient variable in the shell child, identity rejections, monotonic generation, duplicate, conflict, interrupted shell, live process pending, overlapping requests run once (fails if the claim is a plain copy), live and dead pre-start claims, prior work reported after a generation change, executor state refused to the file tools, interrupted mutation (apply, recovered, unknown), repository settings/extensions/skills/prompts/MCP never loaded, contract parity |
| `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-tools.test.ts` | passed, 7 tests: admission before dispatch with exact correlation, invalid arguments and missing executor create no effect, known rejection does not block, lost response before and after dispatch reconciles without a second execution, an unknown shell and a failed remote write or read stay unresolved, never reach a local fallback and block the same command after each of two restarts, authority change before dispatch denies, Sandbox transport quoting and one init per generation |
| `node --test apps/runtime/src/pi-durable-imports.test.mjs` | passed, 4 tests, including no local file, process or stock coding-tool import in the runtime tool module |
| Product suite with tools installed | passed, 62 tests |
| Local Docker: `sh plans/evidence/artifacts/009/docker-tool-exec.sh ditto-sandbox:009` | passed; log in `artifacts/009/docker-tool-exec.log` |
| `pnpm contracts:verify`, `brain:verify`, `credentials:verify`, `runtime:verify`, `typecheck` | passed: contracts 52, brain 43 plus 3 recovery checks, credentials 226, runtime 408 plus 7 Node checks |
| `pnpm verify` | passed after the review fixes: credentials 226, web 861, runner 95 |
| `git diff --check` | clean |

The Docker check builds the repository `Dockerfile` on `cloudflare/sandbox:0.12.3` (Ubuntu 22.04.5, Node 22.23.1). The only difference is that the build adds the container's proxy CA through `NODE_EXTRA_CA_CERTS` so npm can reach the registry. The container runs with `--network none` and an ambient `DITTO_SYNTHETIC_SECRET`. It shows real file results for all seven tools, a stale edit error, `.gitignore` respected by grep, the variable absent from the shell child's environment but still readable through `/proc/1/environ`, a duplicate shell returning the stored result without running twice, a conflicting reuse rejected, an old generation rejected and unable to reinitialize, a `write` to the executor state refused, three overlapping requests for one shell running it once (two `pending`, one `completed`), and a shell whose executor was SIGKILLed reported as `unknown` on reconciliation. The killed executor's detached shell keeps running and its side effect appears later, which is why that outcome must stay `unknown`.

## Not run

Hosted Sandbox transport and process termination, egress policy, live provider requests, browser checks and retained data: not run. The product-command path cannot exercise tools until a later plan widens the synthetic model protocol or binds a real executor in deployment composition.

## Acceptance

First independent review: REJECT. The admission path was sound, but two defects broke exact classification across transport faults:

1. The journal was not exclusive. A reconciliation that overlapped a still-starting first request could run a shell or mutation twice. Fixed with per-attempt exclusive claims.
2. A generation or workspace rejection was returned before the journal lookup, so a reconciliation after a generation change could report "not executed" for work that ran. Fixed by reading the journal first.

The review also found that untrusted tools could forge the journal (now refused to `read`, `write` and `edit`; the rest is a recorded limit), that the ambient-secret claim was overstated, that the two-restart and failed-remote-read/write tests were missing, and that the Docker SIGKILL claim was wrong. All were corrected above. The host receipt-matching change was judged safe.

Second review of the fixes: ACCEPT WITH LIMITS. The reviewer found no path that runs one attempt twice across processes, no unbounded loop, and a state-path guard that handles relative paths, `..`, symlinked parents and missing parents. Its added limits are below.

Limits carried forward:

- Overlap safety assumes one executor process per request, which is how `ditto-exec run` works. Two calls inside one long-lived process can treat each other's live journal as dead. Hosting the executor in a server requires fixing that first.
- A reconciler recovering an old mutation journal while a new attempt finishes the same write can return a different `completed` text than the new attempt. Both are `completed` without error, so the classification holds.
- `bash` can bypass the file-tool state guard with a hard link or a symlink swap between check and write; this is covered by the separate executor user requirement below.

- Journal and generation state live in the container filesystem. A replaced container loses them; a reconciliation then sees a missing journal.
- Liveness uses process IDs. A reused process ID after a container restart gives a permanent `pending`, which fails closed and needs operator recovery.
- `bash`, `grep`, `find` and `ls` can reach executor state as the same user, and `/proc` exposes the container environment. A separate executor user and a secret-free container are deployment requirements.
- Detached shell children outlive a `completed` outcome. Stopping a running remote shell relies on the operation deadline; PD14 hosted evidence is outstanding.
- The runtime trusts the executor's classification; it does not verify file results.
- Image reads return an error instead of an attachment. This product parity change needs Ayan's approval.
- Streaming output and the push and pull request tools are absent, so PD30 and PD31 stay partial.
- The product-command path cannot exercise tools yet. Hosted transport, egress and termination checks were not run.
