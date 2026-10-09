# 007 integration and cleanup

The user explicitly authorized committing remaining changes, merging onto `feat/pi-durable`, removing the execution worktree and deleting its attached branch if present.

## Integrated source

The accepted source was committed in the existing detached recovery worktree and fast-forwarded onto `feat/pi-durable`:

- `5a33d81` — `feat(contracts): add model configuration schemas`
- `3bdf90a` — `feat(runtime): guard model requests and choices`

The starting branch/worktree base was `0ccc5b20c25a4e63017b3eebf6608dba62253479`. No published history was rewritten and no push occurred. Commit hooks ran normally and applied no source changes. All 34 accepted source identities matched before committing and after the fast-forward in the main checkout. The integration adds exactly the reviewed 32 changed source/spec/script files; the other two manifest members remain unchanged.

The [final independent acceptance](007-advisor-final-review.md) applies to these exact integrated bytes. Its sequential gates, fourteen probes and repeated unfiltered credential verification passed before integration. Full test gates were not rerun during this Git-only integration; byte-identity and whitespace checks passed afterward. Production configuration/discovery/transport remains unavailable, and PD38 remains not run.

## Evidence and cleanup

All missing worktree planning/evidence files were copied to main. Main's newer plan/index versions won the only two differing planning paths; neither version was discarded. A complete worktree planning archive preserves the older versions, original logs/probes, rejected timing experiments, generated caches and other evidence before removal:

- Archive: `artifacts/007/integration/worktree-plans.tar.gz`
- SHA-256: `b7214082a32463f10cc3c5439f5000a194b5eee3b61e89036a60a1406e82539d`
- Inventory: `artifacts/007/integration/preservation.json`
- Source identity checks: `artifacts/007/integration/premerge-source.log` and `postmerge-source.log`

Raw evidence logs and patch captures retain their original whitespace. A staged whitespace check across those newly tracked artifacts reports trailing whitespace and blank lines from the captured tools. They were not normalized because that would alter immutable evidence. Source and non-artifact planning checks pass.

The evidence-only commit's first hook attempt failed because Biome excludes all staged `plans/` JavaScript/TypeScript files and reports that no files were processed. No file changed. That documentation/evidence commit skips the inapplicable hook, consistent with the existing approved `plans/**` exclusion. Both source commits ran their hooks normally, and all accepted source identities were checked again afterward.

Every remaining dirty/untracked worktree path was under `plans/`, and every planning file was verified preserved before cleanup. Source commits were already reachable from `feat/pi-durable`. The user-authorized worktree removal then deleted `/home/ayan/ditto-execution/plan-007-recovery`, including its disposable installed dependencies. Git now lists only `/home/ayan/ditto` as a worktree.

The execution worktree was detached. There was no attached branch to delete. The unrelated `brain` branch and target `feat/pi-durable` branch remain untouched by cleanup. Nothing was deployed, no database was modified and no provider/account request ran.

The remaining plan/status/evidence changes are committed separately on `feat/pi-durable`. Plan 007 is DONE for the approved local fixture scope and integrated. Plan 008 has not been executed; refresh its brief against this integrated source before separately authorized execution.
