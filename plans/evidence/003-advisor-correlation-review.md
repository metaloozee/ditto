# 003 advisor correlation review

Current interim verdict: the conservative public-record correlation protocol passes the focused feasibility checks and is ready for source integration. The hook/signal bridge alone is insufficient for resumed compaction, but this is not an established supported-integration blocker. 003 and complete L1 remain unaccepted; source implementation is separately dispatched below.

Reviewed detached `/tmp/ditto-plan-003-998rQl` at `cf7bfbc`, including the executor evidence, entire two retained probes and configs, refreshed plan diff, and pinned public provider, hook, task inspection and generation/compaction checkpoint interfaces. Source changes remain absent. Advisor writes are confined to `plans/`.

## Independent reproduction

The advisor reran both real Worker/DO SQLite probes in the preserved worktree, with `env -i`, the executor's Node/pnpm PATH, `CI=1`, `NO_COLOR=1`, and isolated `HOME=$PWD/node_modules/003-advisor-logs/home`.

| Command | Outcome | Log |
|---|---|---|
| `pnpm --filter @ditto/runtime exec vitest run --config "$PWD/apps/runtime/node_modules/003-probe/config.ts" --reporter=verbose` | passed, exit 0, one observation test | `node_modules/003-advisor-logs/correlation-observation.log` |
| Same command with `red-config.ts` | failed, exit 1, one compliance assertion | `node_modules/003-advisor-logs/correlation-compliance.log` |

The first generation is task 8; compaction is task 10. `beforeCompact` runs once. The first summary signal maps to task 10, but the summary attempt after actual close/reopen has no WeakMap binding. The original remote summary remains pending; the provider guard denies the resumed call before dispatch. This confirms the precise diagnostic claim, not impossibility of all supported correlation strategies.

The red probe requires its particular ephemeral binding to survive reopen. Neither the specification nor the plan requires that implementation. In the eventual host integration, the admitted unresolved original summary must block every subsequent dispatch regardless of whether the retried call can be correlated. Missing identity is independently a denial, not a reason to bypass uncertainty or an automatic upstream defect.

## Public-record alternative to prove before coding

Pi 1.0.1 publicly exposes `Harness.inspect`, `Harness.getTask`, task/conversation ownership, submission records, and versioned generation/compaction request checkpoints. Generation `beforeRequest` runs for every request, including recovery. Compaction has a range hook but no per-request hook. An adapter can therefore attempt a conservative alternative without private changes:

- Keep generation identity tied to the actual task-bearing hook and verify its current public request checkpoint. A counter, latest task or current run is not identity.
- For compaction without a hook binding, accept no ambiguity: require exactly one eligible built-in model-producing task on the approved conversation and version, its public `summarize` checkpoint, and a preexisting trusted compaction/task ownership mapping. Exclude waiting parent generations and retry-sleep phases; do not ignore another genuinely eligible request task.
- Recheck checkpoint, owner, epoch and admission fence after asynchronous preparation. Mandatory provider serialization must cover the causal association and dispatch, not merely serialize a scan. Any competing producer, incompatible task, phase change or missing mapping denies before remote I/O.
- Persist logical request identity from the retained Pi task plus prepared cutoff/range/model configuration. Record actual dispatch attempts separately from Pi's checkpoint attempt: a resumed call with unchanged Pi attempt is not automatically a new safe effect.
- The unresolved original summary prevents replacement calls across reopens. A completed Pi retry whose prior model error/result is durably accounted for may make a separately recorded request attempt. Do not clear uncertainty or feed results into a separate continuation scheduler.

At the first review this was a proposed private adapter policy, not a proved API guarantee. It needed real Pi/DO SQLite experiments for normal generation, compaction retry with no second range hook, unknown summary across reopen, and overlapping producers plus a phase change during async preparation. Experiments must observe actual denied/allowed I/O and stable original identity. If this strategy cannot establish causal ownership through supported public records, stop and report the exact failure. Do not patch Pi or claim success from a single eligible task count alone.

The executor's first investigation and failed logs remain historical. No upstream issue, specification amendment, deployment, live effect, stage, commit or integration is authorized.

## Independent public-record feasibility acceptance

The resumed executor wrote only ignored probes and appended investigation evidence. The advisor read both new probe files completely, their configuration, and the appended evidence. The adapter associates actual generation hooks with pinned public request checkpoints, holds compaction selection metadata durably, and validates the same tuple/digest on actual retry after reopen. It serializes association through actual dispatch initiation, registers competitors before entering that lane, and denies same-kind and mixed-kind ambiguity. It retains unknown admitted effects across two real SQLite reopens. Public task abort, authority/epoch/fence changes and mapping mutation during preparation deny dispatch. Waiting parent ownership is tested separately.

The advisor independently ran the following commands under the same sanitized environment and ignored HOME used above:

| Command | Outcome | Log |
|---|---|---|
| `pnpm --filter @ditto/runtime exec vitest run --config "$PWD/apps/runtime/node_modules/003-lane-probe/config.ts" --reporter=verbose` | passed, exit 0, 14 actual Worker tests | `node_modules/003-advisor-logs/public-lane.log` |
| `pnpm --filter @ditto/runtime exec tsc -p "$PWD/apps/runtime/node_modules/003-lane-probe/tsconfig.json"` | passed, exit 0 | `node_modules/003-advisor-logs/public-lane-types.log` |

Accept this constrained protocol as sufficient feasibility evidence to attempt source integration. It is not full 003, result-handoff or L1 acceptance. The first generation and summary dispatch occur, unknown summary attempts on both reopens are denied with the original rows unchanged, and known completed-error retry retains task/range while recording distinct actual/Pi attempt 2. A summary interrupted before establishing its first validated prepared tuple remains denied. Deferred provider APIs, arbitrary trusted producers, background compaction and multiple conversations remain disabled or rejected, not positively verified.

The probe still uses experiment-only SQL, a checked test-only Harness handle, host-method bypasses for defense observations and a simplistic existing result policy. Do not paste it wholesale into source. State transitions belong inside the host; tools/providers receive narrow guards. Strengthen same-ledger result receipts and persistent barriers while integrating. The refreshed 003 brief now specifies this protocol and the remaining source work. A fresh-context separate executor on `openai/gpt-6.1-sol` with Medium reasoning may implement it in the preserved worktree. No source modification by the advisor, automatic commit or branch integration is permitted. The evidence's reference to a maintainer requesting the intermediate investigation means the parent advisor's direction, not new user approval of a changed architecture.
