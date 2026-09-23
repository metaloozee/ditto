# 005: Split privileged transport and route every repository operation remotely

Status: BLOCKED on 004. Base HEAD: `c963890`, branch `brain`. Effort: L, 5-8 days. Risk: high security boundary change.

## Goal and prerequisites

Build the trusted Node HTTP bridge and executor dispatch behind the coordinator. Keep credentials in their designated Worker and preserve existing Git and project-value policies. This phase does not move live keys/classes or enable real-user trusted sessions. The target configuration is exercised locally; final ownership/binding cutover is 011.

Required 004 contract: `acceptCommand`, `readSnapshot`, `admitEffect`, `recordEffectResult`, `commitContinuation`, epoch/Stop fences, encrypted record storage, durable wakeups and projection retries. 003 supplies authenticated command+observation fixtures; 002 supplies roles `project_seed|workspace_session|trusted_brain`, ownership fence, strict versioned JSON and generation fields. `@ditto/runtime` and contracts gates exist. Sandbox stays `0.12.3`; the runner remains an independent npm package.

## Rechecked evidence and test conventions

`apps/web/src/server.ts:49-59` receives platform context. `apps/web/src/server.ts:61-64` assigns the named outbound handler after class definition:

```ts
// Class-field static outboundHandlers does not populate the SDK registry.
Sandbox.outboundHandlers = {
  dittoCatchAll,
};
```

Preserve this observed SDK registration constraint, then prove it for both target classes in the pinned runtime.

`apps/web/src/lib/sandbox-egress-broker.ts:471-480` builds Git upstream requests and mints repository-scoped tokens in the same Worker today. `handleOutbound` at 905-984 classifies privileged requests before public fallback. Move attach/fetch responsibilities by contract, not by passing the token through a service binding.

Policy-boundary reference refreshed at `a5c1185` after the accepted R5 extraction. `apps/web/src/lib/workspace-runtime-policy.ts:329-332` now invokes a supplied operation:

```ts
let projectEnv: readonly SandboxEnvVar[] | null = null;
if (input.purpose === "agent_run") {
  projectEnv = await deps.decryptProjectValues(project.envVars);
}
```

The product wrapper in `apps/web/src/lib/workspace-runtime.ts:801-802` binds the key:

```ts
decryptProjectValues: (encrypted) =>
  decryptEnvVars(encrypted, input.env.BETTER_AUTH_SECRET),
```

Preserve this accepted boundary and the product-only `prepareRuntime` adapter for provisioning/GitHub metadata. The target runtime cannot bind the auth secret. 005 still must authorize materialization for an admitted executor operation, not HTTP prompt acceptance; the existing callback alone is not that new service protocol.

Existing regression exemplar `packages/sandbox-runner/src/locked-resource-loader.test.ts:149-154` asserts empty skills/prompts/themes/context and no system override. New remote-tool tests should assert actual host-access absence, not just the loader's flags. Web tests use `describe/it/expect/vi` and DI; runner tests use Vitest and temporary workspaces.

## Files

Existing reusable policy: `apps/web/src/lib/sandbox-authority.ts`, `sandbox-egress-broker.ts`, `open-code-contract.ts`, `git-fetch-contract.ts`, `git-push-contract.ts`, `git-receive-pack.ts`, `ditto-action-contract.ts`, `agent-git-handler.ts`, `privileged-git.ts`, `session-git.ts`, `session-git-export.ts`, `session-git-metadata.ts`, `git-secret-policy.ts`, `project-env-vars.ts`, `secret-redaction.ts`. Retain focused tests and preserve any actual unrelated edits. The original dirty-egress-test note is historical; check current status rather than assuming the file is dirty.

New: `apps/runtime/src/brain-transport.ts`, `executor-dispatch.ts`, `runtime-egress.ts`; `apps/web/src/lib/runtime-product-service.ts`, `session-runtime-security.test.ts`; `packages/sandbox-runner/src/remote-tool.ts`, `remote-tool-cli.ts`, `remote-tool.test.ts`. Extend portable contracts, `apps/web/src/lib/session-command.ts`, `session-command.test.ts`, the command fixture and the existing workspace tRPC Git adapters. Modify `apps/web/src/server.ts` to export a private product-service entrypoint, not public internal routes. Add executor image files only additively while old sessions need the old CLI.

## Private service capability and operation authorization

Use named `WorkerEntrypoint` exports, with Alchemy binding the runtime entrypoint only into product and the product entrypoint only into runtime. Deployment-configured binding possession is caller authority. A different Worker with no binding cannot invoke it; granting that Worker the same binding is a privileged configuration change. Do not invent an authenticated caller-ID header, undocumented Cloudflare caller metadata, or shared bearer secret. Neither Worker's default public fetch may forward arbitrary methods/internal paths or caller-selected RPC names into these entrypoints. Product's public handlers perform their own auth/ownership policy before calling fixed service methods.

Binding capability is necessary but does not authorize an operation solely from IDs in its body. Every Git/environment/capacity/identity callback carries a server-originated durable operation or intent reference. Product resolves it freshly in D1 and checks current project/owner/version, role, allowed operation, target identity, lifecycle generation, run/epoch when applicable, incarnation when already assigned, expiry and unused/idempotent transition state. Reject fabricated, cross-session, expired, superseded or retired references without side effects. Git and execution-environment materialization require the current admitted execution/privileged-operation record; returned values never reach the brain.

Identity registration and capacity reservation precede execution windows. Authorize them from a product-persisted accepted command/startup intent, builder-start intent, or approved migration intent, not a circular requirement for an already-running window. The intent fixes target, owner version, permitted roles/pools and deadline; product assigns a new identity/incarnation under that intent, then later callbacks must match it. Rotation/retirement require the matching recovery, lifecycle, migration or deletion intent; deleting-state cleanup may retire authority but never reopen it. Observation/release also requires the matching reservation and trusted liveness evidence; only termination frees an occupied old slot. No body-supplied `requiredPools` or identity list can enlarge intent authority.

## Contract design

1. Brain calls fixed synthetic internal origin `http://ditto.internal` with versioned readiness, continuation, tool/result and control requests. Runtime outbound handler derives role/class/container identity from platform context and D1 identity mapping. Validate incarnation, lifecycle generation, owner version, run epoch, operation, method/path, content type/encoding, duplicate fields, bounds and deadline. Caller-supplied IDs are correlation only. Unknown role and executor calls to any brain endpoint fail before control or model admission.
2. Worker dispatches a complete `RemoteToolV1` operation: logical ID, trusted attempt, expected executor incarnation, epoch, finite deadline, validated name/arguments and outcome policy. All seven tools execute in `/workspace` on the executor. Transport uses stable Sandbox RPC plus an image-owned bounded CLI/job protocol, not a public unauthenticated tool server. Internal diagnostic operation IDs are not bearer capabilities. Executor-local receipts aid reconciliation but never grant authority or prove exactly-once effects.
3. The trusted brain receives only the bounded serialized tool result after the coordinator commits it. Never execute a local `read`, `edit`, `bash`, grep/find/list or `pi.exec` as fallback. Structured write dispatch includes an expected-content digest or absent-file precondition. A shell is potentially mutating and uncertain if its acknowledgment is lost. 006 integrates real Pi; fake provider tests exercise the full command boundary now.
4. Runtime OpenCode intercept validates existing complete bounded fixed-model contract and current D1 authority plus current coordinator effect admission. Construct a fresh upstream request, then attach the runtime's model key. Normal/retry/compaction/metadata attempts all require admission. Metadata atomically consumes one allowance; failed upstream does not refund it. Three denials close the operation, stop further run admission and mark review.
5. Runtime validates Git smart HTTP, reconstructs a credential-free request and service-binds it with trusted operation identity to product. Product revalidates current D1 ownership, role, generation, epoch, operation window, repository, refs and exact contract without an authority cache, then mints, attaches and fetches upstream itself. Stream only the sanitized response back. Never return installation tokens or GitHub App key to runtime.
6. Product service also exposes narrowly authorized `executionEnvironment({effectId, identityId, incarnation, ownerVersion})`. It rechecks the coordinator-admitted execution window and current project ownership, decrypts project values, and returns them only to runtime Worker dispatch code. Runtime passes them into that execution child only and discards them after use. No values in launch env, job files, preview, builder, control, Git children, backup or restore. Redaction material remains in trusted Worker processing, not persisted plaintext. Runtime never receives auth secrets. This is required because project-value ciphertext currently derives from the auth secret.
7. Add strict session-scoped UI Git command variants and their authenticated admission here, not in 003. Use owned session, idempotency key, permitted Git action/input and server-issued sequence/IDs; create no prompt message pair and require no model key for model-free Git work. Feed existing UI Git adapters into that admission path. Agent Git actions remain current-run journal effects rather than fresh browser commands. Both share branch/ownership/secret preflight under coordinator serialization. Local Git results and network effects are journaled. PR creation remains product Worker-owned and gated; no merge/close capability is added. Preserve `GIT_PUSH_ENABLED = false` until the historical crafted non-fast-forward gate passes, and do not enable it in this phase.
8. Execution public egress permits credential-free HTTP/S only, with existing private/metadata/loopback/link-local/literal and alternate numeric IP/embedded credential/ambiguous host/redirect rejection. Privileged denial is final. Brain outbound is deny-by-default, internal and approved broker contracts only. Non-HTTP stays disabled; DNS and total exfiltration prevention are not promised.

## Ordered execution and verification

1. Narrow policy dependencies to role-specific binding interfaces inferred from Alchemy. Product-only module imports GitHub minting; runtime-only module imports model attach. Add compile-time forbidden key/class assertions and binding-graph tests restricting named entrypoints to their intended counterpart. Test both default public fetch handlers with internal paths, arbitrary method/RPC names and forged caller headers: no internal service invocation. Include an unbound Worker denial in the 001/012 topology test. Do not claim a request header can distinguish two Workers deliberately granted the same capability. Do not import product auth initialization into runtime. Verify `pnpm typecheck` and `pnpm --filter @ditto/runtime typecheck`.
2. Implement identity-bound bridge and closed outbound policies. Test T27/T28: every wrong role, retired ID, wrong incarnation, stale epoch, malformed/duplicate field, unexpected auth/proxy header, redirect, oversize and bad encoding yields denial with no privileged/public fallback. Revocation racing in-flight requests blocks new work, but old admitted outcomes remain tracked. Add fresh-D1 negative tests for Git/environment/capacity/identity callbacks, including expired/fabricated startup references, mismatched incarnation/owner, repeated identity creation, unauthorized pool expansion, and deletion racing admission. A valid startup intent may reserve capacity before any model/tool window exists; a model/tool window must not be opened merely to satisfy startup authorization.
3. Implement seven remote tool handlers and narrow shell environments. Test path resolution, symlinks, image input, text/file size limits, invalid encodings, repository shadows, expected-content mismatch, partial output/stderr, deadlines and cancellation. No trusted-host filesystem/process call can result from a hostile repository or failed remote call. Tool semantics preserve edit `details.diff` and `details.patch` expected by existing UI. Do not use Pi's host file-mutation queue for remote paths; serialize in coordinator and execute conditional writes remotely.
4. Split mint-and-fetch and environment materialization. Test T30 with generated test-only sentinels: platform secrets absent in both container launches/child env and returned HTTP; project values present only in authorized shell, absent from serialized jobs and forbidden children. Inspect values only by Boolean membership assertions, never print environments.
5. Prove same-key UI Git retries return one command, conflicting keys reject, and model-free Git admission works during a model outage. Extend Git/action tests for UI and agent paths, closed Git child env, hooks/helpers disabled, fixed CA/public repo URLs, no redirects, secret preflight and disabled push. T29 tests hostile resources continue in 006. P-Bridge/P-Model/P-Git are NOT RUN until authorized paid integration; local mocks cannot prove the interception boundary.

Commands after steps 2-5:

```sh
pnpm --filter @ditto/web exec vitest run src/lib/session-command.test.ts src/lib/session-runtime-security.test.ts src/lib/sandbox-authority.test.ts src/lib/open-code-contract.test.ts src/lib/git-fetch-contract.test.ts src/lib/git-push-contract.test.ts src/lib/git-receive-pack.test.ts src/lib/privileged-git.test.ts src/lib/git-secret-policy.test.ts
npm test --prefix packages/sandbox-runner -- src/remote-tool.test.ts
npm run typecheck --prefix packages/sandbox-runner
pnpm runner:verify
pnpm --filter @ditto/runtime typecheck
pnpm typecheck
pnpm check
```

Expected exit 0, no skipped cases or new secret output. `runner:verify` builds ignored output during authorized implementation. Parent baseline did not run it. Use `exec vitest run` for narrow web selection.

## Done, handoff and stop

006 receives verified closed transport and remote tool definitions, effect/result persistence acknowledgment, project-value materialization policy, fixed provider broker and journaled Git actions. Real execution remains gated on initial paired baseline and both-pool capacity, delivered in 007/008. Before that, only isolated fixtures run.

Done criteria: T27-T30 local tests PASS, zero local fallback invocations under injected remote failure, no forbidden binding in target types/config, platform credential absence assertions pass, Git remains disabled, and named gates pass. Capture evidence for malformed protocol denial without raw bodies.

STOP if platform source identity cannot be distinguished, private service entrypoint is publicly reachable, Git token must cross to runtime, auth key is required by runtime, project values need job files/launch env, or a built-in tool bypasses remote dispatch. Changing an upstream provider or Git contract requires negative boundary tests and paid interception revalidation.
