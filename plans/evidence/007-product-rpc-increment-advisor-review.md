# 007 private RPC increment review

Disposition: local RPC transport increment reviewed; product transport phase remains INCOMPLETE. No environment or supported-API blocker was established by the executor. This is not end-to-end admission acceptance or full 007 completion.

The advisor read the complete new `apps/runtime/src/pi-durable-models.ts`, incremental test patch and full auxiliary Worker config patch. `ExactModelClaim` wraps the live host claim in a real `RpcTarget`, checks exact supplied attempt and owned context, consumes its wrapper once and returns bounded admitted/denied results. The auxiliary test service binding carries the capability across a real Worker RPC boundary; it is not production product composition.

The eight added Worker cases cover valid transport, Stop before/after acknowledgment, foreign owned context and a JSON-only non-capability. Existing 34 host-claim cases and other ten accepted source/spec hashes remain unchanged. The owned request digest is synthetic in these tests, not an actual product-reconstructed body association. Deployment-owned context derivation and complete request binding still need implementation.

Independent verification under sanitized environment in the same `/home/ayan/ditto-execution/plan-007-recovery` passes **224 nearest tests**: models 42, effects 62, summary 118 and preparation 2. The original advisor probes pass **4/4**. Source/graph hashes, whitespace and empty staging match. Executor-reported aggregate passes were not independently repeated for this increment and are not substituted for missing product suites.

Independent logs, source hashes, patches and explicit three-file archive are preserved in `plans/evidence/artifacts/007/product-rpc-advisor/`. Archive SHA-256:

```text
fc9bdfc6278ca34e91ff30147c3f7441911659000d4ab9980cc2d988dd6ba4c0
```

The executor report lives in the worktree at `plans/evidence/007-product-transport-execution.md` and states that all nine phase steps remain incomplete as a coherent phase. Fresh D1 policy/windows, credential-owned reconstruction/streaming, denial halt and mandatory provider composition remain missing. Authenticated configuration is still the subsequent required phase. Live behavior remains unavailable; PD38 is not run.

Continue the same executor with the outstanding concrete product/credential work. There is no need to ask the maintainer to reauthorize this existing fixture-only scope or another environment change. No stage, commit, integration or deployment is authorized.
