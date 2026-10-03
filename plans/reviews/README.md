# Planning cold reviews

Base source: `bcce03e`. Reviewed draft: plans 001–020 and index. Reviewers made no changes. All three initial reviews used `xai/grok-4.7` with `medium` reasoning, confirmed by the returned reviewer reports. These are planning reviews, not implementation acceptance or test results.

| Review | Agent | Scope | Initial result |
|---|---|---|---|
| Feasibility | `54527726-0cec-4b7` | Spec, index, 001–005 and cited source | Requested revisions |
| Product | `99f0a6c5-1502-482` | Spec, index, 006–010 and cited source | Requested revisions |
| Recovery/completion | `2cb1f4cb-e737-4d6` | Spec, index, 011–020 and cited source | Requested revisions |

The author checked the findings against the source/spec and revised the plans. Recommendations were not accepted merely because a reviewer labeled them blocking.

## Accepted corrections

- 001 now requires a finite `pnpm runtime:local:verify` command, implemented by that plan, which starts an isolated Alchemy fixture, drives real Docker execution and exits. The Workers-pool test cannot substitute for it. Candidate flag, entry, class/namespace and local branch stay separate from old topology and normal website resources. Exact package names and candidate-bundle checks are explicit.
- 002 labels product-worker restart coverage partial until L3. 003 explicitly tests exhausted-capacity Stop, separate model/tool deadlines and candidate authority without brain-container prerequisites. 004/005 require rerunning L1 safety against encrypted storage. Inline and total payload ceilings are distinguished.
- 006 specifies product-only credential-DO export, SQLite migration preservation, a product Workers test seam, supported-flow prerequisites and durable renewal/revocation generations. Live discovery cannot use guessed endpoints. 007 explicitly tests crashes between request preparation and dispatch.
- 008 fences legacy POST/cron paths from candidate-owned sessions and separates queue expiry from recovery deadline. Follow-up boundaries require supported Pi evidence. 009 preserves the actual `ls` tool name and marks disabled Git/value coverage partial.
- 010 spells out local projection intents versus later D1 application, retries incomplete acknowledgments, preserves assistant status semantics, and tests authenticated product observation handlers. Exact-value redaction cannot justify moving project secrets into the runtime.
- 011/012 consistently keep retained enablement blocked through full L4. Builder destruction failure retains capacity, with early one-container fixtures serialized. Baseline branch sync receives guarded product Git access before 014's broader UI Git work. Pair publication/current-previous movement/projection intent share one runtime SQLite transaction.
- 013 now states loss acknowledgment, durable cutoff before restore I/O, epoch advancement, late-result ownership and post-barrier rejection semantics. Owned old-key retries retain their original receipts. No new receipt is created for rejected ordinary work. Previous fallback uses matching context; neither pair usable means block.
- 014 explicitly makes cold preview unavailable without a usable pair and keeps `GIT_PUSH_ENABLED` false. 015 distinguishes queue/recovery/preview/lease clocks and the nonrefundable Git-metadata attempt from capacity slots.
- 016 identifies actual archive/deletion callers, prevents copied previous-pair authority, protects shared archive references and re-encrypts copied conversation content under destination AAD. New lineage copies no runnable tasks/alarms/inbox authority. Project deletion does not disconnect the user's shared Codex connection.
- 017 races GC with shared references and deletion. 018 routes existing Git/preview controls through typed intents. 019 requires real Worker HTTP/cookies for PD39. 020 preserves disposable-only mutation constraints before L4.

## Findings rejected or narrowed after verification

| Recommendation | Disposition and evidence |
|---|---|
| `registerStorageConformance` was invented because it is absent from current Ditto dependencies. | Rejected. The pinned upstream README's Storage section explicitly exports it from `@earendil-works/pi-durable/testing`. L0 still verifies the selected published artifact. Absence before installing the candidate is expected, not evidence the upstream API does not exist. |
| Ban `nodejs_compat` regardless of usage. | Narrowed. Decision 6/L0 prohibit hidden trusted filesystem/process execution, not every compatibility feature. Candidate bundle analysis and real no-fallback tests are mandatory. Start without the flag where supported; document any needed non-execution compatibility. |
| Delete every product fixture binding and rename the Sandbox class merely because the old Worker exports the same class name. | Rejected as architectural requirements. Worker/namespace isolation matters; duplicate class names across distinct Workers do not create shared ownership. Credential-free injected authority/private transport fixtures are permitted. New candidate identity/entry and no normal-resource fallthrough are now explicit. |
| Require an empty extension set. | Narrowed. Repository-discovered extensions must be absent; deployment-owned registered fixture/tools are necessary for the selected experiment. Decision 6 permits deployment-owned tools. |
| Internal underscore effect states violate the spec's hyphenated presentation. | Rejected. Existing `EffectV1` and journal use underscores. Preserve semantic states and version/map private wire formats explicitly; do not introduce a duplicate ledger for spelling. Two reviewers gave contradictory spelling recommendations. |
| Candidate admission should check only executor generation, epoch and uncertainty. | Rejected as incomplete. Decisions 8/12 also require ownership, retirement, lifecycle, exact operation and expiry. Removing brain-container prerequisites must preserve these checks. |
| Model configuration must not enter any idempotency payload hash. | Rejected as overbroad. A queued prompt cannot pin its future request model. A configuration intent must still detect changed payloads under the same key. |
| Terminal projections already implied an atomic D1+DO transaction. | Clarified rather than accepted as a current design. Draft steps already said local transaction and update-only D1 application. New text removes ambiguity and handles partial acknowledgment explicitly. |
| Post-barrier rejected ordinary commands need durable receipts. | Rejected. Durable receipts belong to accepted work. The chosen admission barrier rejects new ordinary commands before writes, while returning original receipts for owned duplicates and allowing priority controls. This does not silently lose accepted work. |
| Early fixtures must permit one builder plus one workspace executor concurrently. | Rejected. A stricter single-live-container cap is valid if builder and workspace provisioning are serialized. Destroy failure must block the next container rather than free capacity. |
| A PD reference in a prerequisite plan proves full coverage is claimed there. | Narrowed. Cross-plan IDs map requirements; they do not constitute evidence. Explicit partial labels were added where confusion was likely, including PD07, PD19, PD29–PD31 and PD35 prerequisites. |

## Evidence checks

The author directly re-read the relevant product Worker entry, runtime container composition, authority prerequisite stub, preview interruption/archive/deletion paths, continuation path, command admission and crypto/test seams before applying source-specific corrections. No source file changed and no implementation tests ran.

A fourth targeted check, agent `25f93f7c-f11a-4be`, used `xai/grok-4.7` with `medium` reasoning and returned `READY FOR L0`. It checked the revised finite Docker verifier requirements, product-only credential tests, retained-enablement boundary, baseline Git dependency, restore protocol, new-lineage encryption/fallback, real-cookie HTTP gate and external approval separation. It found no remaining dependency contradiction blocking plan 001. This was a targeted revision check, not a repeat full audit of every later brief.

The verdict is readiness to implement 001. `runtime:local:verify` is still a proposed command to create, not a tool executed during planning. Plans 002–020 remain blocked and require predecessor evidence plus a refreshed source/API stamp. The initial reviewers' requests and the author's disposition remain recorded above rather than being relabeled blanket approval.

Final document checks passed for relative links, numbering, required plan metadata, code fences and trailing whitespace. `git diff --check` passed and git status showed only the new `plans/` directory. No source, test, build, install, deployment, live-provider or reset operation ran.
