# 007 custom-summary executor interruption

Status: interrupted by the requested model's subscription-sharing usage limit, not an engineering-gate verdict. The maintainer subsequently requested Continue, authorizing a retry on the same `openai/gpt-6.1-sol` model with medium reasoning. No model change or API-billing fallback is authorized.

The interrupted executor `4f198a46-0cdb-473` left partial work in detached `/tmp/ditto-plan-007-3oi7vl`, base `0ccc5b20c25a4e63017b3eebf6608dba62253479`. Its handle is no longer available for a context-preserving resume. A fresh executor must inspect the actual partial files rather than treat them as accepted implementation.

## Observed partial state

The advisor inspected worktree status and available logs after interruption. Changes include the host/custom-summary hook composition, strengthened preparation probe, new summary policy module/test, inherited effects changes and the approved spec amendment. The spec diff is present but still needs exact approved-edit verification. No final custom-summary evidence file was written.

Available logs under `node_modules/007-custom-summary-logs/`:

- `01-typecheck.log`: an earlier runtime typecheck completed, before subsequent source edits. This is not a typecheck of the final interrupted state.
- `02-preparation-before-test-update.log`: preserved intermediate preparation experiment.
- `03-preparation.log`: 2 passing preparation tests. The custom summary stays in Pi selection, recovers its retained `faux-1/low` request and the later generation uses `faux-2/high`. This is narrow executor evidence, not independent acceptance or the complete custom-summary gate.

After that preparation run, the executor made additional host result-validation/authority checks and created `pi-durable-summary.test.ts`. Those latest edits/tests were not verified before the usage-limit error. Full effects/summary/host/storage/history suites, aggregate runtime and repository gates, result-reuse/fault accounting coverage and independent review remain outstanding. 007 is not DONE, and dependent adapters remain blocked.

## Preservation

[Interrupted candidate archive](artifacts/007/custom-summary-interrupted-candidate.tar.gz) contains the exact partial source/test/spec files, accepted decision and available custom-summary logs. [Source patch and hashes](artifacts/007/custom-summary-interrupted/) record the state before retry. The archive excludes installed dependencies, CLI HOME and environment/credential files. The live worktree is preserved and uncommitted.

Archive SHA-256:

```text
63c20ec1285f96e5a82bc99ee1d1b552e65a9853bda79d00c41448079b8d24d1
```

Historical stock-summary failure evidence and the accepted narrower preparation correction remain unchanged. Only `plans/` preservation/status evidence was written in the main checkout. No source integration, staging, commit, deployment, live-provider operation or worktree deletion occurred.

The retry must continue only the approved custom-summary prerequisite, preserve partial failures and rerun final-state checks. If the requested model remains rate-limited, report that limit without silently switching models, enabling API-key billing or claiming implementation acceptance.
