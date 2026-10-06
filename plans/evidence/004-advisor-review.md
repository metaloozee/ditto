# 004 advisor review

Verdict: **reject the first candidate as complete 004.** The broad gates pass, but independent real-workerd probes demonstrate three backend failures and two additional host integrity failures. 004 remains BLOCKED for correction and review. 005 and complete L2 remain blocked. No integration, commit, deployment or cleanup is authorized.

Reviewed detached `/tmp/ditto-plan-004-vO7JVp` at `46bec8519ce7e5bd2cd9dd1880f71dbc20d21d17`, with implementation uncommitted. The executor used `xai/grok-4.7` with Medium reasoning as requested. Advisor source edits were not performed. Advisor diagnostic and documentation writes are confined to `plans/`. Main-checkout application source is unchanged.

The installed improve skill's `references/closing-the-loop.md` was unavailable. Execution followed the supplied execute rules: separate isolated executor, no automatic worktree commits, independent diff review and verification, no integration into the user's branch.

## Candidate and scope

The public pinned 1.0.1 `registerStorageConformance` export exists. The candidate implements `EncryptedPiStorage`, uses the existing AES-256-GCM helpers, adds host private-field encryption and structural effect routing, and adds two encrypted safety/Pi handoff cases. The 23 shipped conformance cases run against actual DO SQLite. Those cases do not cover all required integration guarantees.

Read the entire new storage implementation, private-field helper and storage tests, every changed host/configuration/test/plan hunk, the public Storage and SQLite database contracts, the authoritative specification, and accepted predecessor evidence. Source versions remain Pi Durable/pi-ai/Chord 1.0.1, Worker pool 0.12.21 and runtime Vitest 3.2.7. Runtime tests retain the requested `2026-09-16` date with the installed `2026-03-10` fallback. Advisor probes explicitly use `2026-03-10`. No hosted-date claim is made.

## Confirmed blockers

### 1. A Pi rollback rewinds a separate safety transition

Evidence: `apps/runtime/src/pi-durable-storage.ts:313-326,394-430` opens an asynchronous DO transaction. Encryption and document processing await inside it. `apps/runtime/src/pi-durable-host.ts:644-652` independently uses `transactionSync` for safety transitions on the same DO storage.

During a suspended failing Pi commit, the advisor issued a separate synchronous safety transition advancing a synthetic epoch from 1 to 2. After the Pi callback rejected, the safety epoch was 1 again. Its completed nested transition had joined the outer Pi transaction and was rolled back with it. This is an actual SQLite observation, not an inferred atomicity guarantee. The minimal probe uses the same storage and transition mechanics as the host; it does not alone claim a complete product Stop reproduction.

The independent host reviewer then exercised public `host.stop()` during the held failing Pi commit. The advisor read and reran that probe. Stop returned success before the held transaction ended; afterward `host_runs` was `epoch=1, state=queued`, `host_controls` was empty and the host was unfenced. This strengthens the minimal transaction counterexample into an actual host Stop failure. The probe's exact expected intermediate state is not itself the contract: a corrected implementation may settle queued work directly as canceled. The required invariant is a surviving epoch advance and original applied control, not a prescribed waiter timing.

The accepted L1 design requires safety state to remain runtime-owned and non-rewindable. A Pi content failure must not erase a separate Stop, admission fence or effect fact. Transactions may intentionally combine safety and Pi facts under a proved protocol, but unrelated asynchronous work must not join accidentally. This blocks decisions 3.4, 8-10 and PD13/PD17.

### 2. Public reads expose records from a commit that rolls back

Evidence: `apps/runtime/src/pi-durable-storage.ts:394-430,791-841`. Commit writes a first entry, then awaits encryption of a second entry. Public reads use direct SQL without an operation queue.

The advisor held the second encryption in the same DO invocation and called the adapter's public `entry(firstId)`. It returned the first entry and commit sequence 2. Then the held encryption rejected, the commit rolled back, and a later read correctly found no first entry. The earlier read had already exposed nonexistent committed history.

The candidate's exclusion test at `pi-durable-storage.test.ts:88-147` dispatches another `runInDurableObject` event. The DO input gate blocks that separate event. It does not prove exclusion between asynchronous callers already executing inside one host invocation. The advisor probe exercises that missing case and fails twice.

### 3. Storage close completes with an admitted writer still live

Evidence: `apps/runtime/src/pi-durable-storage.ts:751-778`. Close marks the adapter closed and waits only for the three methods using `admitRead`. It does not join `commit`, document materialization or the other asynchronous reads.

With entry encryption held inside an admitted commit, `close()` completed immediately. Releasing encryption then allowed the commit to finish and write its entry after close had reported completion. The candidate cannot use this close result as evidence that backend activity has drained. The public conformance suite checks calls made after close, not this in-flight case.

### 4. Tampering with a plaintext digest substitutes accepted command content

Evidence: `apps/runtime/src/pi-durable-host.ts:514-566,2231-2242,2311,2504-2510`. Retained retry validation trusts the unsigned `host_seal.digest`. Reopen decrypts the inbox but never compares its plaintext with that digest. A later identical-ID accept checks the digest and overwrites the plaintext cache; scheduling submits the cache rather than the authenticated inbox plaintext.

The host reviewer accepted one synthetic command, replaced only its seal digest with the digest of different content, reopened, and retried the same ID with that different content. The advisor read and independently reran the probe. Reopen and accept succeeded. The original inbox ciphertext still decrypted to the original command, while the canonical placed Pi input entry contained the substituted command. Raw encrypted rows contained neither plaintext sentinel. Encryption of the resulting entry does not make this substitution safe.

An attacker changing queryable metadata must not be able to rewrite authenticated command meaning. Derived guard metadata must be authenticated or checked against the decrypted record before it influences acceptance or dispatch.

### 5. Encrypted selection can be downgraded to an exempt `pending` value

Evidence: `apps/runtime/src/pi-durable-host.ts:475-476,502,540-543,776-779,990-1026`. Plaintext `pending` is exempt from retained selection checks and reveal. Reopen does not check that an existing sealed-selection digest contradicts this sentinel. The binding guard treats it as an unbound selection.

The host reviewer replaced an encrypted synthetic compaction selection with `pending`. The advisor read and independently reran the probe: reopen succeeded and `mapping()` returned the sentinel, rather than detecting the changed retained record. In the isolated probe where this selection was the only host ciphertext and no Pi content had been created, even a different-owner open succeeded after the downgrade. The intact-inbox wrong-owner control correctly rejects. This proves the downgrade validation gap; it does not claim a demonstrated foreign model dispatch or existing populated Pi conversation takeover.

The structural unbound state needs an authenticated distinction from a previously bound selection. A data corruption must not silently erase the guard that freezes prepared work.

## Independent checks

Commands ran only in the disposable worktree under `env -i`, an explicit installed Node/pnpm PATH, `CI=1`, `NO_COLOR=1`, and `HOME=$PWD/node_modules/004-advisor-logs/home`. No inherited credentials or live effects were used. Logs are relative to that worktree.

| Command/check | Outcome | Evidence |
|---|---|---|
| `pnpm runtime:verify` | passed, exit 0; runtime typechecks, 6 Node checks and 150 Worker tests in 7 files | `node_modules/004-advisor-logs/runtime.log` |
| `pnpm verify` | passed, exit 0; Biome with 36 warnings and no errors, web types, 808 web tests, web build, runner types, 79 runner tests and runner build | `node_modules/004-advisor-logs/verify.log` |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/004-advisor-probes.config.ts --reporter=verbose` | failed, exit 1; all three behavioral counterexamples fail on the candidate, reproduced in two runs | `node_modules/004-advisor-logs/probes-4.log`, `probes-final.log` |
| `pnpm --filter @ditto/runtime exec vitest run --config ../../plans/evidence/004-host-review-probes.config.ts --reporter=verbose` | failed, exit 1; Stop durability and downgrade rejection fail, a positive substitution diagnostic reproduces the bug, intact-inbox wrong-owner control passes | `node_modules/004-advisor-logs/host-probes.log` |
| Final candidate source hashes | passed, all five source/test hashes match the independently gated candidate after the additional review | `node_modules/004-advisor-logs/source-reviewed.sha256` |
| Earlier advisor probe setup | failed before behavioral execution; dependency/config-resolution failures, not implementation verdicts | `probes.log`, `probes-2.log`, `probes-3.log` |
| `git diff --check` | passed | `node_modules/004-advisor-logs/diff-check.log` |
| Staging and main-source preservation | passed; no index changes, no main application-source changes | Independent Git checks |
| Brain/contracts | not run; shared inputs unchanged | No shared package, lock or contract changes |
| 004 core acceptance | failed | Counterexamples above |
| Complete L2, product enablement, hosted/live provider/Docker/browser/benchmark | not run | Outside this review's scope |

Advisor probes are retained under the execution worktree's `plans/evidence/004-advisor-probes.test.ts` and `.config.ts`. They inject a synthetic encryption delay/failure using the adapter's private encryption seam, then exercise real public Storage methods and real DO SQL. All held work is released and joined before assertions, so failures do not leave pending test resources.

## Preserved artifacts

[`artifacts/004/first-candidate.diff`](artifacts/004/first-candidate.diff) preserves the tracked executor diff. [`artifacts/004/first-candidate.tar.gz`](artifacts/004/first-candidate.tar.gz) preserves full changed/new source files, executor evidence, advisor probes and both sets of logs. CLI HOME and dependency caches are excluded. `gzip -t` passed. Archive SHA-256: `ddd00c12b771fa31579bc0307db19f73ce68bb0b8833b7b0d5a1c1f1406c80a8`. Diff SHA-256: `9b05ab61abecad2e50cfaac33affe15b0a6799b2a2261f96ebd45b7fa5b92141`. Extract separately, not over the repository. The detached worktree remains preserved.

[`artifacts/004/host-review.tar.gz`](artifacts/004/host-review.tar.gz) preserves the additional reviewer probes/logs and independent advisor rerun. CLI HOME is excluded; `gzip -t` passed. SHA-256: `a6f8cb570778b5cf7dbf3094f5d86d3c19d61053ec8fb06c10d2435ed11d521d`. The first-candidate archive remains unchanged.

The additional independent read-only host integration review completed on `xai/grok-4.7` with Medium reasoning. Its probes are `plans/evidence/004-host-review-probes.test.ts` and `.config.ts` in the execution worktree. The advisor read them, verified cited host code and independently reproduced the three observations described above. The public Stop failure strengthens blocker 1; command substitution and selection downgrade add blockers 4 and 5.

Two further reviewer concerns are retained as unverified follow-ups, not promoted to demonstrated dispatch failures: `bindTask` reads its old selection before awaiting encryption and does not recheck the current mapping in the write transition; retained retry publication queues asynchronous sealing whose crash interval and rejection-before-close-fence behavior are untested. A correction must test these paths. No interleaving or model retry crash reproduction was supplied for them.

## Coverage still required

The candidate added only two encrypted host cases. The inherited 53 host and 40 effect checks still use plaintext compositions. They do not establish encrypted Stop, deadline, compaction/retry, cancellation-wait and native-alarm guarantees. An encrypted integration must rerun the applicable L1 scenarios, not cite the plaintext totals as encrypted coverage.

There is no rollback-failure injection, and raw-row sentinel checks do not cover every inventory family and mixed write. The combined integrity test changes ciphertext and then opens with a different key; that rejection does not independently establish correct-key tamper detection. It changes the format version but not each engine/task/tool/provider/adapter field. These are gaps against 004's explicit checks, not reasons to waive them. Full exact-history/oversized-reference acceptance still belongs to 005.

## Correction boundaries

Keep the pinned supported Pi contracts, one continuation engine and the original effect IDs. Do not fix this with manual transaction SQL, a maintained fork, `blockConcurrencyWhile` around whole runs, or a second transcript.

The corrected protocol must exclude unrelated reads and writes within the same host invocation, prevent a failing Pi batch from rewinding unrelated runtime safety, and join all admitted backend work before close completion. One viable direction is to prepare private encryption outside the short synchronous commit, then recheck the mutable record/sequence/authority versions before atomically applying the prepared writes. Document bases, deltas and copy sources need the same version recheck. A different supported protocol is acceptable only with executable proof of exclusion and both safety/Pi crash orders. An adapter-only queue that leaves host SQL outside its ownership does not fix the safety rollback.

Promote the three backend counterexamples and the additional host integrity/Stop probes to permanent regression tests through the nearest appropriate seams. The actual Stop probe should assert surviving epoch/control and no later admission, without requiring one intermediate run state or forcing Stop to wait for unrelated encryption when the corrected protocol keeps them independent. Authenticate or validate seal and effect-route metadata against their decrypted records, reject selection downgrades, and recheck mutable binding guards after encryption. Preserve the failing first-candidate evidence, rerun upstream conformance and the full relevant encrypted L1 matrix, then rerun both repository gates. If the supported protocol cannot establish those guarantees, stop and report the engineering blocker instead of weakening the specification.
