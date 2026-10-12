# Command chronology

All commands ran from `/home/ayan/ditto-execution/plan-008-4WXvNW`. Full stdout/stderr was redirected to the named log under `plans/evidence/artifacts/008/command-read-batch/`. No command installed dependencies.

1. Exit 0, format.log.

```sh
sh .execution-008/clean-run.sh pnpm exec biome format --write apps/web/src/lib/session-command-candidate.ts apps/credential-tests/src/product-commands.worker.test.ts
```

2. Exit 1, reconstruction-freshness.log. Five passed, one FK harness failure, 56 filtered. Preserved before the concrete fixture correction.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'fails trusted reconstruction|batched reconstruction|batched command subject'
```

3. Exit 0, reconstruction-freshness-corrected.log. The sole allowed harness-corrected rerun. Six passed, 56 filtered, clean teardown.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'fails trusted reconstruction|batched reconstruction|batched command subject'
```

4. Exit 0, credential-typecheck.log.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests typecheck
```

5. Exit 0, runtime-typecheck.log.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime typecheck
```

6. Exit 0, web-typecheck.log.

```sh
sh .execution-008/clean-run.sh pnpm typecheck
```

7. Exit 1, affected-sequence.log. Ran once at existing configuration. Twelve passed, one queued-configuration timeout at 5000ms, one isolation error, 47 filtered, two selected later cases unreached. Stopped verification here; no later test/aggregate command.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

8. Exit 0, diff-check.log. Evidence-only source whitespace check, not another suite run.

```sh
sh .execution-008/clean-run.sh git diff --check
```

Pre-edit Python verification/archive exited 0. Final hash/inventory/diff verification exited 0. SQL/bind multiset, parser/tail and initial query-boundary parity assertions exited 0. Per-statement SQL/bind association extraction first raised AssertionError because the evidence regex did not allow a trailing comma in prepare; corrected regex passed. That correction changed no source and reran no test gate.

Complete unfiltered product suite and all five original aggregates are not run because the relevant sequence is red. No deadlines or poll/test windows were increased. Outer budgets were 120 seconds for narrow tests, 180 for the affected sequence and typecheck command group, 60 for formatting and 30 for evidence/diff check.
