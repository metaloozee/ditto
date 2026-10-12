# 008 independent local private RPC test run

Result: passed, exit 0. Two tests passed; clean isolated-runtime shutdown. No issuer or full 008 acceptance is implied.

The maintainer explicitly requested this authorized local fixture invocation in `/home/ayan/ditto-execution/plan-008-4WXvNW`:

```sh
sh .execution-008/clean-run.sh pnpm --filter @ditto/credential-tests exec vitest run --config ../../plans/evidence/artifacts/008/qualification-executor/teardown-diagnosis/rpc-v2.config.ts
```

The advisor ran the unchanged configuration. Vitest 3.2.7 collected both admitted-work tests. The exact-origin private RPC abort case and the genuinely discarded-outcome/controller-restart negative control both passed. Test time was 4.51 seconds; total runner duration was 6.15 seconds. Expected synthetic throw, request/origin mismatch and reset diagnostics appeared, but there was no isolated-storage teardown failure.

Both cases asserted zero upstream fetches, preserved original retained associations and unresolved effects, retained generation 1 with no witness, and confirmed the untouched prior-host termination guard still denied ordinary activation. The lost-observation controller did not invent a termination witness.

The command used the existing sanitized launcher and installed dependencies, with unchanged test/runtime deadlines. No deployment, external provider request or source edit was performed. Output was returned directly by the test tool, not redirected to a new log. This records an independent fixture test pass, not a production termination-authority qualification or implementation of the remaining dispatch fence.
