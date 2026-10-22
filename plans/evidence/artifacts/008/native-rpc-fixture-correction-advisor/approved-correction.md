# 008 native RPC probe harness correction

Status: advisor-reviewed harness correction within the maintainer-approved fixture-only probe. One further invocation, not a product retry or permanent implementation. Prior failed attempts remain evidence.
Execution: `/home/ayan/ditto-execution/plan-008-4WXvNW`, detached `2487d56`. Separate executor: `openai/gpt-6.1-sol`, medium reasoning, no fallback. MAIN is read-only for the executor.

## Concrete defects verified by the advisor

The original scratch invocation failed before collection due to relative main/module paths. Its one corrected rerun loaded the runtime but failed before real admission. It initialized only `CodexCredential`, whereas `CandidateFixtureProduct.commands` uses `CandidateCredential`. The existing product suite's `candidateCredential` helper separately installs that synthetic credential owner. Consequently the admitted scope was never set and the dependent isolation case could not execute.

The advisor also read `caller.ts` and pinned Chord's implementation. The scratch call uses `awaitWithContext(context, pending)`, but the supported signature is `awaitWithContext(promise, context)`. This defect was not reached because admission failed first.

Neither error is evidence about native RPC latency or the product runtime. The original two-run allowance is exhausted. This separate handoff explicitly permits one additional invocation after the reviewed corrections below. No repeated attempt without another concrete review.

## Exact allowed changes

1. Verify all 37 candidate source hashes and archive the current restored source. Preserve the entire existing `native-rpc-fixture` directory unchanged. Create a new execution evidence directory `plans/evidence/artifacts/008/native-rpc-fixture-correction/` for the corrected scratch files and logs.
2. Copy the existing scratch receiver, caller, test and corrected config into the new directory. All relative imports remain at the same directory depth. Point generated esbuild output and `modulesRoot` to a new worktree-local ignored directory beneath `.execution-008/`. Preserve the already corrected absolute main path.
3. Correct only the caller's argument order to `awaitWithContext(pending, context)`. Keep the same cancellation context, RPC construction/timestamps, sample count and iteration order.
4. In the probe test, install the synthetic `CandidateCredential` for `owner`, generation 1, using the same synthetic fixture credential content and expiry as the existing product suite. Assert its status is connected before admission. Keep the existing `CodexCredential` initialization and all real admission, shared visibility, freshness and isolation assertions. Add the honest `CandidateFixtureCredential` type import and ProvidedEnv namespace declaration if needed. Do not seed commands or memberships.
5. Temporarily reapply the same model-entry receiver re-export and existing-DO caller hook, pointing at the new scratch directory. No other application file changes, receiver logic changes, binding topology changes, new namespace or capability/gate alteration.
6. Before running, inspect the complete corrected caller, setup and config. Record the exact old-to-new scratch patch and prove receiver source and bundled helper predicates are unchanged. Type/signature checks may use existing installed tooling, never installs.
7. Run the corrected focused probe ONCE through the unchanged confined launcher at original deadlines, with an adequate outer tool budget. On any failure preserve it and stop. No second corrected rerun, full product run or aggregates.
8. Restore all 37 application/package files, verify their exact hashes, empty staging and whitespace, and preserve scratch/bundle/log artifacts. Report test and DO sample counts separately, shared-D1/freshness/next-test-isolation verdicts and limitations. No timing samples means no causal conclusion.

All original probe boundaries remain: native RPC, same receiver implementation, public pinned pool/Miniflare options, same disposable D1, no reset-policy equivalence claim, no provider move, no authority caching or shortened check chain. No deadline, dependency/manifest/lockfile, installed-package, MAIN source, production binding or deployment change. No live provider/credential, shared/retained DB, stage/commit/merge/push, external cleanup or worktree removal.
