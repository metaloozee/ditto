# Sole test command

Working directory: `/home/ayan/ditto-execution/plan-008-4WXvNW`.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

Full stdout/stderr preserved in `original-order-sequence.log`. Outer command budget 180 seconds; unchanged test timeout 5000ms. Exit 1. Twelve passed, one queued-configuration timeout, one isolation error, 42 filtered, two selected later cases unreached: lost-started acknowledgment and Stop control-intent.

No second test command, full suite, aggregate or typecheck ran. All fixture/runtime source remained untouched. Exact temporary test-body delta is `diagnostic-only.patch`; restoration replacements are `inverse-edits.json`. Pre-edit archive/hash, temporary-scope/parity and final-restoration Python checks each exited 0. They used explicitly enumerated candidate files and evidence only, excluding dependency/cache/build/environment trees.
