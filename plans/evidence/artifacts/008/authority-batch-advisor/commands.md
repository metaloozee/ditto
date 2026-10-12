# Commands in execution order

Working directory for every command after environment selection was `/home/ayan/ditto-execution/plan-008-4WXvNW`. Redirections below are relative to `plans/evidence/artifacts/008/authority-batch-substage/`. No install command was used.

Initial environment selection printed only PI_PROVIDER, PI_MODEL and PI_REASONING_LEVEL. The exact values are recorded in report.md. The pre-edit Python archive/hash operation asserted equality for all 37 saved finalwait hashes, archived those exact files and selected finalwait evidence, and saved git status and diff. It exited 0 before edits.

1. Exit 2, credential-typecheck.log.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests typecheck
```

2. Exit 1, affected-sequence-1.log.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate'
```

3. Exit 0, format.log.

```sh
sh .execution-008/clean-run.sh pnpm exec biome format --write apps/web/src/lib/session-command-candidate.ts apps/credential-tests/src/model-entry.ts apps/credential-tests/src/product-commands.worker.test.ts
```

4. Exit 1, affected-sequence-2.log. Repeated the seven-case filter only after the recorded test-harness corrections.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate'
```

5. Exit 1, affected-sequence-final.log. Final permanent source bytes. The filter preserves file order, selects 15 cases and excludes the other 42. Isolation failure prevented the last two selected cases from running.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'owned authority|settles final-hold|credential-local .*barrier|private fixture reset preserves|private fixture recovery activates|generation-2 admission|credential-local final gate|priority Stop through transport beats held default|queued configuration|real D1 lost started|real admitted Stop repairs candidate-control-intent'
```

6. Exit 0, credential-typecheck-final.log.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests typecheck
```

7. Exit 0, runtime-typecheck.log.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/runtime typecheck
```

8. Exit 0, web-typecheck.log.

```sh
sh .execution-008/clean-run.sh pnpm typecheck
```

9. Exit 0, queued-resource-stage.log. One causal diagnostic with temporary synchronous stage/elapsed probes only. No timeout changes, extra SQL or awaited probe work. Not a final acceptance gate. The probes were removed and that entire test block independently matched entry bytes afterward.

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts -t 'queued configuration uses the next selection'
```

10. Exit 0, diff-check.log.

```sh
sh .execution-008/clean-run.sh git diff --check
```

Final Python evidence operations exited 0. They recomputed all 37 hashes, asserted exactly the three allowed source files changed, asserted the 34 others were unchanged, asserted no stage tag remained, compared the queued case byte-for-byte with entry, and generated the complete incremental diff from entry archive bytes. A separate comparison asserted unchanged owned SQL literal, authority projection and normalized row/expected-tuple validator. Source/entry archives were explicitly enumerated and never traversed dependency/cache/build or environment trees.

Full suite, contracts:verify, brain:verify, credentials:verify, runtime:verify and verify were not run. No toolchain command bypassed clean-run.sh.
