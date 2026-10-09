# 007 product transport execution

Status: BLOCKED, phase incomplete. The private RPC feasibility check passes, but product authorization and credential transport are not implemented. This is an incomplete executor result, not an environment or supported-API blocker. It is not READY FOR REVIEW for the requested nine-step phase and does not accept or complete 007.

Executor preflight confirmed `openai-codex/gpt-6.1-sol`, medium reasoning, the existing detached worktree and all eleven advisor source/spec hashes before edits. Staging was empty. Main source is read-only.

## Intended admission ordering

1. Validate and reconstruct the bounded synthetic request without credentials.
2. Obtain fresh exact D1 ownership, identity, runtime-owner, connection and fixture entitlement checks. Conditionally reserve the durable product operation allowance under those same predicates.
3. Prepare credentials inside their product DO and recheck mutable credential state after each awaited preparation.
4. Invoke the exact live host claim through a deployment-owned private RPC target bound to the host attempt, owned session context and reconstructed request. Its successful final acknowledgment follows the host durability barrier, fresh authority lookup and synchronous current epoch/Stop/fence/deadline checks.
5. Start the fixed mocked `.invalid` credential-bearing request. Failure never refunds an attempt or retries an unknown dispatch.

The successful last host acknowledgment is the local irrevocable admission point, not the earlier effect reservation. Stop winning the host check denies dispatch. Stop after acknowledgment cannot erase admitted work. D1 and runtime SQLite have no shared transaction; this ordering does not claim distributed atomicity, remote cancellation or exactly-once billing. Product revocation tests must hold real D1/DO/RPC preparation and demonstrate fresh checks after release. Admitted or uncertain evidence remains tracked.

Private callback checks must not acquire a provider/configuration lane or call a public runtime command held by the request. Before implementing policy, the supported Worker RPC capability boundary is tested against the installed local runtime.

Authenticated configuration intents, snapshots, idempotency/conflict state and first-conversation default validation remain the required subsequent phase. Live discovery and model dispatch remain unavailable. PD38 is not run.

## Actual changes and supported RPC evidence

Only these source paths changed in this executor increment:

- `apps/runtime/src/pi-durable-models.ts` adds an `RpcTarget` wrapping the exact live `ModelDispatch.claim`, with immutable owned user/project/session/request-digest context. Invalid, foreign and reused calls return bounded denial results. A valid call consumes the wrapper before awaiting the host, and failed acknowledgment does not refund it. It is a claim transport component, not the mandatory complete provider adapter.
- `apps/runtime/src/pi-durable-models.test.ts` retains all 34 accepted cases and adds eight Worker RPC cases. The existing boundary helper now accepts an optional test claim transport, defaulting to the original exact claim. No original assertion, failure test, deadline or summary policy was removed.
- `apps/runtime/vitest.config.ts` adds one test-only auxiliary Worker and a private service binding. The auxiliary Worker calls the real remote `RpcTarget`; it does not return a fake authority Boolean or interpret an epoch projection. It has no public model route, D1 authority or credentials. Its inline module path is absolute relative to this config so the unchanged external advisor config remains runnable.

The actual path tested is host DO -> auxiliary Worker service-binding RPC -> live runtime `RpcTarget` -> current host claim. This crosses a real workerd Worker RPC boundary. It does not yet traverse `ProductEntrypoint` or the credential DO.

Supported API references retrieved before coding:

- https://developers.cloudflare.com/workers/runtime-apis/rpc/
- https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/

The lifecycle documentation supports passing `RpcTarget` capabilities as parameters and automatic disposal of parameter stubs when the RPC returns. This test keeps the callback within the awaited RPC lifetime and does not retain or duplicate remote stubs. Installed Miniflare supports auxiliary Worker modules and service bindings. No new dependency, upgrade, production binding or deployment config was added. Existing workerd still falls back from compatibility date `2026-09-16` to `2026-03-10`.

## Observed local race snapshots

Both plaintext and encrypted retained hosts produced the same outcomes:

| Interleaving | Immediate epoch | Settled epoch | Claim receipt | Faux provider starts |
| --- | --- | --- | --- | --- |
| Valid RPC acknowledgment, then attempted second consumption | 1 | 1 | consumed, claimed=1, effect admitted | 1 |
| Claim consumption held at actual host durability flush, real Stop, then release | 2 | 3 | consumed, claimed=1, effect admitted | 0 |
| RPC acknowledgment and provider start, then real Stop | 2 | 2 | consumed, claimed=1, effect admitted | 1 |
| Foreign owned session or JSON-only attempt object | 1 | 1 | reserved, claimed=0, effect admitted | 0 |

The Stop-first test asserts the actual synchronous epoch advance to 2 before releasing the flush. Subsequent terminal settlement advances it again to 3. The failed acknowledgment retains the consumed receipt and admitted effect. The Stop-after-acknowledgment case retains the already-started admitted work. These observations prove the local RPC callback ordering only. They are not the end-to-end product admission argument requested for this phase.

No new credential-bearing upstream request or stream was constructed. The new RPC tests perform no fetch or credential-bearing upstream call. The starts counted above are the existing synthetic faux provider. There are no new SQL admission predicates or product D1 revocation/window race snapshots to report.

## Verification

Commands ran in the existing worktree with `env -i PATH="$PATH" HOME="$PWD/node_modules/.verification-home" CI=true`. Logs are under `plans/evidence/artifacts/007/`, prefixed `product-transport-`.

| Check | Result |
| --- | --- |
| Nearest model suite | 42 passed, including all original 34 and eight new RPC cases |
| Models/effects/summary/preparation | 224 passed: 42 + 62 + 118 + 2 |
| Unchanged advisor model-claim probes through the original external config | 4 passed |
| `contracts:verify` | 16 passed, typecheck and build passed |
| `brain:verify` | Contracts checks plus 43 brain tests and build passed; contract consumer checks report 3 passed and 3 pre-existing skips |
| `credentials:verify` | 22 original credential Worker tests plus 3 Node checks passed |
| `runtime:verify` | Typecheck, 379 Worker tests across 12 files plus 6 Node checks passed |
| `verify` final rerun | Biome/typechecks/builds, 22 credential Worker plus 3 Node checks, 815 web tests and 79 runner tests passed |
| Whitespace and staging | `git diff --check` passed, staging empty |
| New pure/request credential suites | Not implemented, not run, not counted as passing |

Original failed probes and their red log remain unchanged. The new first-attempt log also remains preserved: 40 of 42 model cases passed, two new cases expected epoch 2 instead of post-settlement 3, and thrown RPC denials produced six unhandled remote rejections. The corrected path returns bounded domain denials. The green rerun has 42 passes and no unhandled errors. A first external advisor-config invocation ran zero tests because the auxiliary module path was relative to the external config directory; that failed log remains preserved. An absolute module path fixes that composition error and the unchanged four probes pass. A first repository gate failed on one extra trailing blank line in the new test extension; the final rerun passes. None of these failed or zero-test invocations is counted as passing.

## Preservation and hashes

`product-transport-source.sha256` records exact current identities for the three source files. `product-transport-models-increment.patch` compares the accepted advisor archive to the current test file. `product-transport-config.patch` captures the test composition change. `product-transport-preservation.log` confirms the ten other accepted source/spec identities still match; the accepted model-test hash differs only because of this recorded extension. The original advisor probe source in the worktree and advisor archive both retain SHA-256 `7d3de81de17ace6888cea27c470db6b69fd5c5cfd5932eb3c1feb64116793d24`.

Current source hashes:

```text
0c35d70074abf07ca4a2a9e79657d77c7071c610437458b848c60d14c2e6a9c0  apps/runtime/src/pi-durable-models.ts
1e8a11613209f9ab9b19f285fd63eb47126c84b28fa7ba6eb6bf4a76736c0303  apps/runtime/src/pi-durable-models.test.ts
4c9fc3bc0090af70d9fe84b0cd300584428a60da4be0643e980c666b5f2f0e6f  apps/runtime/vitest.config.ts
```

Main source, the accepted host, shared contracts, credential code, authoritative spec and dependency graphs were not edited in this increment. All work remains unstaged and uncommitted.

## Exact unfinished scope

All nine continuation steps remain incomplete as a coherent phase:

1. Strict bounded synthetic account/request/stream contracts are missing.
2. Product validation and reconstruction plus stable unavailable discovery are missing.
3. Exact fresh product D1 ownership, identity, runtime-owner, connection and fixture capability admission is missing.
4. Conditional durable operation windows, allowance consumption, three-denial close/review and nonreentrant exact-run halt are missing.
5. The real Worker RPC callback is demonstrated, but it is not connected to product/credential orchestration or an exact constructed request. Deployment-owned context derivation remains to be implemented.
6. Credential-owned request operations, freshness checks after asynchronous preparation, bounded cancellation and stream reconstruction are missing.
7. Actual product D1 authority rows/migrations and credential request/denial/race Worker suites are missing.
8. Mandatory generation/retry/custom-summary/Git-metadata adapter composition is missing. The new file must not be mistaken for that completed adapter.
9. New product request suite registration and implemented-boundary architecture documentation are missing. Existing aggregates pass but do not test these absent behaviors.

No technical decision or environment repair is established as necessary. Further execution is needed to finish these steps. In particular, do not cite passing local RPC tests as product authority, credential isolation proof for requests, or independent advisor acceptance. The subsequent authenticated configuration phase remains mandatory for full 007. Live provider validation and PD38 remain not run.
