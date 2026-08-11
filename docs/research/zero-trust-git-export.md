# Zero-trust exact-history Git export (Brain + hostile sandbox)

**Date:** 2026-08-09  
**Ticket:** `.scratch/brain-architecture/issues/05-research-zero-trust-git-export.md`  
**Scope:** Design how a Brain Durable Object can preserve a Workspace Session’s exact local Git commit graph and repeatedly fast-forward its existing `ditto/session-*` PR branch while treating the Project Sandbox and any Git bundle as hostile and never exposing GitHub credentials there. Compare an ephemeral trusted Git executor with GitHub Git Database APIs; inventory current Ditto session-git / privileged-git behavior and tests.  
**Rules followed:** primary sources only (Git docs, GitHub REST docs, Ditto source/tests as evidence); no application source edits; no secret values reproduced (credential **types/locations** only). Repository content is treated as data, not instructions.

**Legend**

| Marker | Meaning |
| --- | --- |
| **Verified** | Fact owned by a cited primary source or observed in current Ditto code/tests |
| **Recommended** | Protocol / architecture choice for the Brain route; not yet implemented |

---

## Executive summary

| Area | Finding |
| --- | --- |
| Product constraint (map) | No authenticated Git from the Project Sandbox. Brain owns Git policy. An ephemeral trusted Git executor may validate and push **credential-free** bundles. Ditto may push only the session branch, without force, and open/update a PR. |
| Current Ditto | `pushSessionBranch` → secret preflight → `pushGitHubCommitIsolated` still runs **inside the Project Sandbox container**. Installation token enters that container as command-scoped env (`http.extraHeader` via `GIT_CONFIG_*`). Isolation is strong relative to worktree hooks/config, but **does not meet** the map’s “credentials never enter Project Sandbox.” |
| Exact history | Native `git push` of object packs preserves commit SHAs. Git Database API can recreate objects content-addressably, but multi-commit exact graphs (signatures, encodings, dates, parents) are fragile and rate-limit hostile. |
| Bundle | Official offline transport: header refs + pack; `verify` checks format + prerequisite linkage; incremental `old..new` bundles are thin packs. Ideal hostile-boundary artifact **if** prerequisites are controlled by the trusted side. |
| Git Database API | Can create blobs/trees/commits and update refs with `force: false` (fast-forward only). Good for single synthetic commits from a Worker; **poor** fit for “preserve exact local session graph.” No expected-SHA CAS parameter—only FF vs force. |
| **Recommended** | **Ephemeral trusted Git executor** + credential-free session bundles. Brain decides policy and PR lifecycle; executor performs only credentialed fetch/push mechanics under Brain-issued job params. Reject pure Git Database API as the primary export path. |

**Bottom line (Recommended):** Project Sandbox emits an untrusted bundle (and metadata). A short-lived trusted Git environment—never running project code—verifies, ancestry-checks, policy-scans, and non-force-pushes the exact tip SHA to `refs/heads/ditto/session-*`. GitHub App tokens stay in Brain/Worker/executor only.

---

## Sources

### Official Git

| Topic | URL |
| --- | --- |
| `git bundle` | https://git-scm.com/docs/git-bundle |
| Bundle format | https://git-scm.com/docs/gitformat-bundle |
| Bundling (Pro Git) | https://git-scm.com/book/en/v2/Git-Tools-Bundling |
| `git push` (FF, force, force-with-lease) | https://git-scm.com/docs/git-push |
| `git merge-base` (`--is-ancestor`, `--fork-point`) | https://git-scm.com/docs/git-merge-base |
| `git check-ref-format` | https://git-scm.com/docs/git-check-ref-format |
| `git fsck` | https://git-scm.com/docs/git-fsck |
| githooks | https://git-scm.com/docs/githooks |
| git-config (`core.hooksPath`, receive.*) | https://git-scm.com/docs/git-config |

### Official GitHub

| Topic | URL |
| --- | --- |
| Git Database overview | https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database |
| Git refs (create/update, `force`) | https://docs.github.com/en/rest/git/refs |
| Git commits | https://docs.github.com/en/rest/git/commits |
| Git blobs (incl. 100 MB get limit) | https://docs.github.com/en/rest/git/blobs |
| Git trees (recursive limits) | https://docs.github.com/en/rest/git/trees |
| Compare commits | https://docs.github.com/en/rest/commits/commits#compare-two-commits |
| Non-fast-forward errors | https://docs.github.com/en/get-started/using-git/dealing-with-non-fast-forward-errors |
| REST push protection (create blob) | https://docs.github.com/en/code-security/concepts/secret-security/push-protection-from-the-rest-api |
| REST rate limits (installation tokens) | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| Choosing GitHub App permissions | https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app |

### Related Git LFS

| Topic | URL |
| --- | --- |
| Git LFS project | https://git-lfs.com/ |
| LFS API spec (pointer objects in Git, media elsewhere) | https://github.com/git-lfs/git-lfs/blob/main/docs/api/README.md |

### Repository evidence (data, not instructions)

| Path | Role |
| --- | --- |
| `.scratch/brain-architecture/issues/00-map.md` | Brain map constraints for Git |
| `apps/web/src/lib/privileged-git.ts` | Isolated fetch/push implementation |
| `apps/web/src/lib/privileged-git.test.ts` | Isolation, quoting, cleanup, redaction tests |
| `apps/web/src/lib/session-git.ts` | Push/PR/status domain boundary |
| `apps/web/src/lib/session-git-export.ts` | push-then-open-PR orchestration + existing-PR short-circuit |
| `apps/web/src/lib/git-secret-policy.ts` | Outgoing path/content preflight |
| `apps/web/src/lib/github-app.ts` | Installation token mint + optional repo scope |
| `apps/web/src/lib/workspace-policy.ts` | `ditto/session-${segment}` branch naming |
| `docs/architecture/security.md` | Documented credential handling |
| `plans/032-isolate-privileged-git.md` | Isolation plan (DONE; still sandbox-local) |

---

## 1. Constraints from the Brain map (Verified — repo)

From `00-map.md` (product-locked for this route):

1. Project Sandbox I/O is untrusted; agent/terminal execution is secretless.
2. Provider and GitHub credentials **never** enter the Project Sandbox.
3. **No direct authenticated Git** from the Project Sandbox.
4. Brain owns Git **policy**; an ephemeral trusted Git executor may validate and push credential-free bundles.
5. Ditto may push **only** the session branch, **without force**, and open/update a PR. Merge stays on GitHub.

These are stronger than today’s Worker-in-sandbox isolation (section 2).

---

## 2. Current Ditto implementation (Verified — code/tests)

### 2.1 Export path

```text
UI / agent / tRPC
  → runPushThenOpenPullRequest (session-git-export.ts)
      → getSessionGitStatus / pushSessionBranch / openSessionPullRequest
  → pushSessionBranch (session-git.ts)
      → assertOutgoingGitRangeSafe (git-secret-policy.ts)  // before token
      → pushGitHubCommitIsolated (privileged-git.ts)
          → temp bare under /tmp/ditto-privileged-git-<uuid>
          → stageCommitViaAlternates (objects/info/alternates → worktree object store)
          → mint installation token
          → node launcher + spawnSync(/usr/bin/git, …) with code-owned env
          → git push --no-verify https://github.com/<owner>/<repo>.git <sha>:refs/heads/<branch>
          → rm -rf temp dir
```

Session branch names: `sessionBranchName` → `ditto/session-<sanitized-id-slice>` (`workspace-policy.ts`).

### 2.2 What privileged-git already gets right

| Control | Evidence |
| --- | --- |
| Public HTTPS URL only (no token in URL) | `publicGitHubRepoUrl`; tests assert no `x-access-token` in command |
| Token only after local SHA staging | `mintToken` after alternates + `update-ref` verify |
| Exact preflight SHA push | Refspec `${headRev}:refs/heads/...` — **no `+`, no `--force`** |
| HEAD must still match preflight | Rejects if `git rev-parse HEAD` ≠ `headRev` before mint |
| Staged object must be a commit | `git cat-file -t` |
| Hooks/helpers/system config neutralized in network child | `GIT_CONFIG_NOSYSTEM`, empty global, `core.hooksPath`, empty `credential.helper` / `core.askPass`, HTTPS-only `protocol.*` |
| Auth via env-backed `http.https://github.com/.extraHeader` Basic | `buildPrivilegedGitChildEnv` |
| Temp bare local config allow-list | Rejects unexpected keys (e.g. `core.sshCommand`) before mint |
| Branch shape + `git check-ref-format` | Short name only; full refs code-owned |
| Shell-quoting of refs/paths | `quoteGitHubExportShellArg` |
| Credential redaction of raw/base64/header forms | `buildCredentialRedactionSecrets` |
| Always cleanup temp dir | `withTempBareRepo` finally `rm -rf` |
| Secret egress preflight shared | `assertOutgoingGitRangeSafe` on `pushSessionBranch` |

Tests of record: `privileged-git.test.ts` (env quarantine, push order, quoting, HEAD/stage mismatch, config reject, concurrent temps, fetch SHA verify, launcher hygiene); `git-secret-policy.test.ts`; `session-git.test.ts` (permission mapping, workflow, push wiring); `session-git-export.test.ts` (existing-PR short-circuit).

### 2.3 Gaps vs zero-trust Brain target

| Gap | Why it matters |
| --- | --- |
| Credentialed Git still **executes in the Project Sandbox container** | Map forbids GitHub credentials in that boundary. Compromised agent/root in the container can observe command-scoped env during push. |
| Staging uses **object alternates** into the sandbox object store | Trusted network `git` process can read the entire common object DB (including unrelated session objects) while holding a token. |
| No `git bundle` boundary | No transferable artifact the Brain can re-validate offline outside the sandbox. |
| No explicit remote-head CAS beyond non-force push | Non-force FF is correct, but Brain does not record/compare `expectedRemoteSha` as first-class policy. |
| No bundle size / commit-count / tree-size caps at export | Secret policy covers paths + added-line secrets + binary fail-closed; not volume DoS. |
| Initial clone still tokenized URL in sandbox | Documented exception in `security.md`; out of export path but still a sandbox credential event. |
| Fetch isolation also sandbox-local | `fetchGitHubBranchIsolated` same container model. |

**Verified:** Today’s design is “privileged process inside hostile-ish workspace host,” not “credentials outside hostile host.”

---

## 3. Building blocks from primary sources (Verified)

### 3.1 `git bundle` as the hostile-boundary artifact

From `git-bundle` / `gitformat-bundle`:

- A bundle is a **show-ref-like header** (optional v3 capabilities, prerequisites, references) followed by a **pack**.
- Offline transfer of objects/refs without a live Git server; `git fetch`/`clone` can read bundles; **there is no push-into-bundle**.
- **Self-contained:** `git bundle create full.bundle <tip>` packs everything reachable from tip; unbundle/clone works even into empty repos.
- **Incremental:** `git bundle create inc.bundle <old>..<new>` excludes objects reachable from `old`; requires `old` (and its reachable set) at the recipient. Implemented as **thin packs**.
- **`git bundle verify`:** checks bundle format **and** that prerequisite commits exist and are fully linked in the **current** repository; non-zero exit if invalid; prints missing prerequisites / capabilities (e.g. `filter`).
- **`list-heads` / `unbundle`:** list advertised refs; pipe objects through `git index-pack` (fetch plumbing).
- v3 **unknown capabilities abort** (no negotiation). A `filter` capability implies promisor/partial pack semantics — **reject** for export (session export must be full objects for the claimed range).
- Bundles do **not** carry index, worktree, stash, config, or hooks — only refs + objects. Good: sandbox hooks/config cannot hide inside the pack format as Git config.

**Implication (Recommended):** Sandbox may only **create** bundles. Trusted side **verify + fetch/unbundle**. Never trust sandbox-supplied “already verified” claims.

### 3.2 Fast-forward, force, and CAS

From `git-push`:

- Default push **refuses** updates that are not ancestors of the new tip (fast-forward rule).
- `--force` / `+refspec` disables that check (history loss).
- `--force-with-lease[=ref:expect]` allows non-FF only if remote still equals expected value (lease/CAS). Map forbids force; lease is **not** a substitute for “Ditto force-pushes,” but **`expect` thinking** is useful for Brain-side remote head records.
- Non-force refspec used today: `<sha>:refs/heads/<branch>` without `+` → FF-only.

From GitHub refs API **Update a reference**:

- Body: `sha` (required), `force` (boolean, **default false**).
- Docs: leaving `force` out/false “make\[s\] sure the update is a fast-forward update” / “not overwriting work.”
- **No `expected_old_sha` field** — concurrency control is FF ancestry, not arbitrary CAS.
- Create reference requires fully qualified `refs/...` and Contents write.

From `git-merge-base`:

- `git merge-base --is-ancestor A B` → exit 0 iff A is ancestor of B (modern FF check).
- `--fork-point` uses reflogs; **unsuitable** as sole Brain policy (reflogs expire; executor is ephemeral). Prefer stored `baseCommitSha` / `lastExportedSha` / remote tip SHAs.

### 3.3 Object integrity

- Pack SHA-1/SHA-256 object IDs are content-addressed; after unbundle, `rev-parse` of advertised tip must equal claimed tip.
- `git fsck` validates object connectivity/structure in a repository (use after unbundle into a clean repo; fail closed on errors relevant to reachability of the export tip).
- `git rev-list --objects <base>..<tip>` enumerates reachable objects for policy scanning and size accounting.

### 3.4 Ref injection

From `git-check-ref-format`:

- Refs cannot contain `..`, control chars, space, `~`, `^`, `:`, `?`, `*`, `[`, `@{`, `\`, etc.
- Hierarchical names need a category (`refs/heads/...`).
- `--branch` is stricter about leading `-`.

**Verified in Ditto:** short branch names validated; full `refs/heads/...` constructed in code; option-like and `refs/`-prefixed shorts rejected.

**Recommended additional:** allow-list session branch to exact Brain-recorded `ditto/session-*` string; refuse any bundle header ref outside a single code-owned dest ref; never take destination ref names from bundle headers alone.

### 3.5 Hooks and config quarantine

From githooks / git-config:

- Hooks run from `core.hooksPath` or `$GIT_DIR/hooks` on specific events (`pre-push`, `pre-receive`, etc.).
- Disabling: point `core.hooksPath` at an empty dir; clear `credential.helper`; avoid inheriting `http.proxy`, `core.sshCommand`, `url.*.insteadOf`, etc.

**Verified in Ditto privileged child env:** hooks path, empty helpers, `GIT_CONFIG_NOSYSTEM`, empty global, protocol allow-list, no inherited env merge in launcher.

**Recommended for trusted executor:** same or stricter; **also** never set the Project Sandbox filesystem as `cwd` or alternate object store while a token is present.

### 3.6 GitHub Git Database API

From GitHub guide + endpoints:

- Reimplement Git by creating **blobs → trees → commits → refs**.
- Empty/unavailable repo → `409 Conflict`.
- **Create commit** takes `message`, `tree`, optional `parents[]`, `author`/`committer` `{name,email,date}`, optional PGP `signature`. Response SHA is the object id GitHub stored.
- **Get blob** supports up to **100 MB**; content base64 in JSON media type.
- **Get tree recursive:** tree array limit **100,000** entries / **7 MB** payload; `truncated: true` if exceeded.
- **Create blob** (and contents API) subject to **secret scanning push protection** → `409` when supported secrets detected.
- Installation token primary rate limit **≥ 5,000 req/hour** (scales with repos/users; secondary limits include concurrent and content-creation caps ≈ **80 content-generating req/min**, **500/hour**).

**Exact SHA preservation (Verified physics of Git, applied):**  
If every byte of a commit object (tree, parents, author/committer lines, message, encoding, signature header) matches, the SHA matches. The REST “create commit” path **rebuilds** commits from JSON fields; any omitted timezone/encoding/signature nuance yields a **different** SHA. Replaying an N-commit session graph requires ordered upload of all novel blobs/trees/commits — often **thousands of API calls** — and still struggles with signed commits, Git notes, and unusual headers.

**LFS (Verified):** LFS stores **pointer blobs** in Git and media on an LFS server. Bundles/packs carry pointers only unless a separate LFS transfer runs. Git Database API same. Neither path silently uploads LFS media.

### 3.7 Compare API for ancestry (Verified)

`GET /repos/{owner}/{repo}/compare/{basehead}` is documented as comparing two commits/refs (equivalent to a rev-walk style compare). Useful for Brain/executor **read-only** checks when both SHAs already exist on GitHub. For a **not-yet-pushed** local tip, compare cannot see the new SHA until objects exist on GitHub — so local `merge-base --is-ancestor` after unbundle (with remote tip fetched) is the right FF oracle for pack-based export.

---

## 4. Option A — Ephemeral trusted Git executor (Recommended primary)

### 4.1 Trust boundaries

```text
┌────────────────────────────┐     untrusted bundle +      ┌──────────────────────────┐
│ Project Sandbox            │     export manifest         │ Brain (policy owner)     │
│ - session worktree         │ ──────────────────────────► │ - allow session branch   │
│ - NO GitHub token          │                             │ - size/secret/path policy│
│ - git bundle create only   │     signed job / R2 key     │ - PR open/idempotency    │
└────────────────────────────┘ ◄────────────────────────── │ - mint token for executor│
                                                           └────────────┬─────────────┘
                                                                        │ credentialed
                                                                        ▼
                                                           ┌──────────────────────────┐
                                                           │ Ephemeral Git executor   │
                                                           │ - clean image + /usr/bin/git
                                                           │ - fresh bare repo only    │
                                                           │ - verify/unbundle/fsck    │
                                                           │ - FF push session ref    │
                                                           │ - destroy storage/token  │
                                                           └──────────────────────────┘
```

**Recommended properties of the executor**

| Property | Rule |
| --- | --- |
| Lifetime | One export job (or one push attempt); destroy filesystem after |
| Image | Ditto-controlled; fixed `git`/`node` paths; no project bind-mount |
| Inputs | Bundle bytes + Brain job spec (repo slug, dest branch, expected remote SHA, base prerequisite SHAs, policy flags) |
| Secrets | Installation token only in executor/Brain memory; never logged; never written to bundle path |
| Network | HTTPS to `github.com` only; no inbound from sandbox |
| Code | No execution of bundle contents as code; treat all object payloads as data |

Topology options (all acceptable if isolation holds): Cloudflare Container dedicated to git-export; separate Durable Object + container binding; Worker-orchestrated one-shot CI-like job. **Not** acceptable: reusing the Project Sandbox container with a token (current model).

### 4.2 Credential-free bundle generation (sandbox)

**Recommended** sandbox steps (no token):

1. Lock session workspace (existing session lock semantics).
2. Require clean worktree for export (already product rule for open-PR).
3. Resolve `headSha = git rev-parse HEAD` (full hash).
4. Resolve export basis:
   - Prefer `origin/<session-branch>` if present (last pushed tip), else
   - Brain-supplied `lastExportedSha`, else
   - session `baseCommitSha` / merge-base with primary.
5. Create **incremental** bundle when basis exists on both sides:
   ```text
   git bundle create <file> <basis>..<headSha> <dest-ref-name>
   ```
   Per `git-bundle`, revisions must be accompanied by **reference names** to be packaged; do not pass a bare SHA alone (empty-bundle refusal).
6. Or full bundle from tip only if basis missing (bootstrap).
7. Refuse v3 filter capabilities at create time (no `--filter`).
8. Emit **manifest** (JSON) beside bundle: `headSha`, `basisSha`, `branchName`, `bundleSha256`, `byteSize`, `commitCount`, tool versions. Manifest is untrusted claims for the executor to re-check.
9. Stream bundle to R2 / Brain; delete local temp bundle.

**Verified:** Bundle creation needs no credentials.  
**Recommended:** Cap `byteSize` and `commitCount` before upload (DoS). Exact caps are product knobs (start conservative; e.g. tens of MB / hundreds of commits) — not specified by Git.

### 4.3 Executor validation pipeline (Recommended protocol)

All steps fail closed. Order is intentional: cheap structural checks before token mint; ancestry before push; policy before network mutation.

| Step | Action | Pass criterion |
| --- | --- | --- |
| 0 | Create empty temp bare; quarantine config/hooks (mirror privileged-git allow-list) | No unexpected local config |
| 1 | Hash bundle; compare to manifest claim | SHA-256 match (detect transport bitrot; **not** authenticity of sandbox) |
| 2 | `git bundle list-heads` | Exactly one allowed ref **or** ignore header names and only take object ids; dest ref comes from Brain job |
| 3 | Seed prerequisites | Credentialed `git fetch` of `basisSha` / remote session branch / default branch objects into temp bare **or** clone mirror of needed tips. Prerequisites for incremental bundles must exist here (`git bundle verify` requirement) |
| 4 | `git bundle verify <file>` | Exit 0; no missing prerequisites; **reject** unknown/`filter` capabilities |
| 5 | `git fetch <bundle> <header-ref>:<temp-ref>` or `unbundle` + `update-ref` | `rev-parse temp-ref` == manifest `headSha` |
| 6 | `git cat-file -t headSha` | `commit` |
| 7 | `git fsck --connectivity-only` (or full `git fsck`) on reachable tip | No errors for export tip closure |
| 8 | Reachability | `git merge-base --is-ancestor basisSha headSha` when basis claimed; every object in `basis..head` readable via `cat-file` |
| 9 | Remote head read | Fetch `refs/heads/<session>` → `remoteSha` (or absent) |
| 10 | Ancestry / FF gate | If remote exists: `merge-base --is-ancestor remoteSha headSha`. If equal: no-op success (idempotent push). If not ancestor: **reject** (non-FF / diverged / hostile rewrite). Optional: require `remoteSha == job.expectedRemoteSha` for stricter CAS-without-force |
| 11 | Path policy | `git diff --name-status -z remoteSha..headSha` (or `basis..head` on first push); block `.env`/`.env.*` (reuse `isSecretLikeGitPath`); block symlink escapes / absolute paths if fsck warns |
| 12 | Secret policy | Reuse added-line scan + known project secrets + shape detection from `assertOutgoingGitRangeSafe` **on the executor’s copy**, not sandbox claims |
| 13 | Size policy | Object count/size from `git rev-list --objects remoteSha..headSha`; reject over cap |
| 14 | Tags / notes / extra refs | Do not push tags; ignore any extra bundle refs; no `--mirror` |
| 15 | Submodules | If mode `160000` appears in outgoing trees: **reject by default** (or require already-existing URL allow-list — product choice). Avoid nested credentialed fetches |
| 16 | LFS | If outgoing blobs match LFS pointer format and media required: **reject or separate trusted LFS upload** with same credential boundary. Do not smudge in sandbox with tokens |
| 17 | Signatures | Preserve commit objects as-is (pack push). Do not strip/re-sign. Unsigned is fine |
| 18 | Mint token | Installation token, repo-scoped, last moment |
| 19 | Push | `git push --no-verify <public-https> <headSha>:refs/heads/<sessionBranch>` **without** `+`/`--force` |
| 20 | Verify remote | `ls-remote` or API `GET git/ref/heads/...` equals `headSha` |
| 21 | Cleanup | Shred/delete bundle, bare repo, env; drop token |

**Why seed prerequisites on the trusted side (Recommended):**  
`git bundle verify` checks prerequisites against the **current repository**. If the executor only had the bundle, incremental bundles would fail verify. Seeding from GitHub with credentials keeps the sandbox from needing to embed full history every time and prevents the sandbox from defining “what basis means.”

**Alternates ban (Recommended):** Never point the credentialed repo at the Project Sandbox object store (today’s `stageCommitViaAlternates` pattern). That couples token lifetime to hostile storage.

### 4.4 Exact commit preservation (Verified + Recommended)

- Pack-based push sends the same commit objects the sandbox produced → **same SHAs** on GitHub (Git content addressing).
- Repeated export: new commits only in `lastRemote..newHead` incremental bundle; push FF’s the same branch.
- Amend/rebase after push → non-FF → rejected (matches map “no force”). User must create new commits or Brain-defined recovery (new session branch) — not silent force.

### 4.5 Existing PR idempotency (Verified current + Recommended keep)

Current `runPushThenOpenPullRequest`:

- `existingPullRequestPolicy: "shortCircuit"` returns open PR url/number without recreate.
- After push, re-status may short-circuit again.
- `openSessionPullRequest` lists open PR for `head=owner:branch` + base before create.

**Recommended:** Brain keeps this Octokit-side idempotency (no git credentials in sandbox). Executor returns `pushed: boolean` + `headSha`; Brain opens/updates PR metadata only.

### 4.6 Race and failure recovery (Recommended)

| Failure | Recovery |
| --- | --- |
| Bundle verify fail | Delete artifact; fail export; no token |
| Non-FF (remote moved) | Fail; Brain may fetch remote tip into session UX (“sync/recreate”) without force push |
| Push network fail after objects received but ref not updated | Retry push of same SHA is safe (idempotent if remote already tip; FF if still ancestor) |
| Push succeeded, PR create failed | Re-list open PR; create if missing; do not re-bundle |
| Concurrent double export | Non-force push serializes: second wins only if FF from first; else one fails |
| Executor crash mid-job | Temp disk GC; token TTL ends; sandbox bundle may be retried |
| Partial R2 upload | Manifest hash mismatch → reject |

Record in Brain SQLite/D1: `lastExportJobId`, `lastExportedSha`, `lastRemoteShaObserved`, status. Memory is not authoritative (map).

### 4.7 Cleanup (Recommended)

- Sandbox: delete bundle temp always.
- R2: expire export objects after success TTL or on consume.
- Executor: wipe workdir; never write tokens to R2/D1/logs.
- Redact executor stderr with same credential forms as `buildCredentialRedactionSecrets`.

---

## 5. Option B — GitHub Git Database APIs (not primary)

### 5.1 Sketch

Brain/Worker (trusted) would:

1. Read file contents from an untrusted snapshot (bundle extract or sandbox file API **without** GitHub token in sandbox).
2. `POST git/blobs` for each novel blob.
3. `POST git/trees` (optionally with `base_tree`).
4. `POST git/commits` with parents = previous commit.
5. `PATCH git/refs/heads/ditto/session-*` with `{ sha, force: false }`.
6. Open PR via Pulls API.

### 5.2 Comparison

| Criterion | Trusted git executor + bundle | Git Database API |
| --- | --- | --- |
| Exact multi-commit graph | **Native** pack objects | Rebuild each commit; SHA drift risk |
| Signed commits | Preserved in pack | Must supply exact `signature`; hard |
| FF / non-force | `git push` without force | `force: false` on update ref |
| Expected-SHA CAS | Optional local check + non-force; lease if ever needed | FF only; no expect field |
| Hooks/config attack surface | Contained if executor clean | No local git hooks |
| Runs without git binary | No | **Yes** (Worker-only possible) |
| Rate limits | Few git HTTPS ops | Many REST calls; secondary content caps |
| Large binaries | Pack negotiation | 100 MB blob get limit; large POST bodies |
| Secret scanning | GitHub push path + local policy | Create-blob push protection helps |
| LFS | Separate problem either way | Same |
| Matches map “bundle executor” language | **Yes** | No |
| Implementation complexity for Ditto parity | Evolve privileged-git out of sandbox | New object uploader; lose exact history easily |

### 5.3 Verdict (Recommended)

Use Git Database API only for **narrow** trusted operations if ever needed (e.g. tiny metadata ref, emergency empty-repo init via Contents API per GitHub empty-repo guidance). **Do not** use it as the session history export path.

---

## 6. Policy ownership split (Recommended)

| Concern | Brain | Trusted executor | Project Sandbox |
| --- | --- | --- | --- |
| Which branch may be pushed | Yes (only recorded session branch) | Enforce job field | May propose only |
| Force push | Never | Never | N/A |
| Secret/path/size policy | Define + pass known secret digests/values in trusted memory only | Execute scans | Optional pre-check UX only |
| Token mint | Yes (or Worker on Brain’s behalf) | Receive ephemeral token / mint via Brain RPC | Never |
| Bundle create | No | No | Yes |
| Bundle verify / push | Authorize | Yes | No |
| Open/update PR | Yes (Octokit) | No (unless Brain delegates read-only) | No |
| Merge / default branch | Never Ditto | Never | Never |

**Least privilege GitHub App (Verified need from current messages + GitHub docs):**

- **Contents: Read & write** — fetch bases, push session branch objects/refs.
- **Pull requests: Read & write** — list/create session PRs.
- **Metadata: Read** — standard.
- Avoid broader admin, workflows (unless pushing `.github/workflows` requires Workflows write — prefer **reject workflow path changes** in policy instead of widening the app).
- Installation token **repository-scoped** to the one project repo (already supported by `getInstallationAccessToken({ repositories })`).

---

## 7. Threat notes (hostile sandbox + hostile bundle)

| Threat | Mitigation |
| --- | --- |
| Bundle claims wrong tip | Executor `rev-parse` after fetch must equal independent hash of commit object; manifest is advisory |
| Bundle includes extra refs (`refs/heads/main`) | Ignore header names for destination; push only Brain dest ref; never mirror |
| Thin pack / missing bases | `bundle verify` fail closed; seed bases from GitHub only |
| Filter/promisor bundle | Reject `filter` capability |
| Secret in history | Executor content policy; GitHub push protection as backstop on API path; pack push still needs local scan |
| `.env` committed | Path policy on outgoing range |
| Hook smuggling | Bundles don’t install hooks; executor empty `hooksPath`; never checkout worktree for push |
| Config smuggling via `includeIf` | Executor empty global/system; bare temp only |
| Refname shell injection | Job-supplied allow-listed branch; `check-ref-format`; argv array not shell |
| Object alternate to sandbox | Forbidden in executor |
| Token exfiltration via tracing | `GIT_TRACE*` off; redact errors; no token in URL/argv/files |
| LFS pointer without media | Reject or dedicated LFS path with same trust split |
| Submodule gitlink to malicious URL | Reject `160000` by default |
| History rewrite after PR review | Non-force preserves review commits; amend requires new session policy |
| Executor supply chain | Pin image; trusted bin prefixes (as privileged-git does) |

---

## 8. Mapping ticket checklist → design

| Ticket topic | Treatment |
| --- | --- |
| Credential-free bundle generation | §4.2 sandbox `git bundle create` |
| `git bundle verify` / fsck | §4.3 steps 4–7 |
| Object reachability | `merge-base --is-ancestor`, `rev-list --objects`, fsck |
| Ancestry / fork-point / remote-head CAS | Prefer stored SHAs + `--is-ancestor`; avoid reflog `--fork-point` as sole gate; optional `expectedRemoteSha` |
| Signatures / tags / submodules / LFS | Preserve commits; no tag push; reject/special-case submodules & LFS |
| Path / size / secret policy | Brain-defined; executor-enforced; evolve `git-secret-policy` off sandbox |
| Ref injection | Code-owned dest ref; check-ref-format; single-branch push |
| Hooks/config quarantine | Executor env = privileged-git child env (or stricter) |
| Non-force push | No `+`/`--force`; API `force:false` if ever used |
| Exact commit preservation | Pack push of sandbox-created objects |
| Existing PR idempotency | Keep list-before-create / shortCircuit |
| GitHub App least privilege | Contents RW + PR RW + repo-scoped token; block workflow paths in policy |
| Race/failure recovery | §4.6 |
| Cleanup | §4.7 |
| Brain owns policy; executor credentialed mechanics only | §4.1, §6 |
| Compare executor vs Git Database API | §4 vs §5 — **executor wins** |

---

## 9. Migration sketch from current code (Recommended; not implemented)

1. Extract pure policy helpers from `git-secret-policy.ts` / ref validation so sandbox and executor share rules without sharing credentials.
2. Add sandbox `createSessionExportBundle` (no token).
3. Add executor service reusing launcher/env ideas from `privileged-git.ts` but **without** `stageCommitViaAlternates` to sandbox paths.
4. Point `pushSessionBranch` (Brain-era) at: bundle → executor → status; delete sandbox token mint on push/fetch.
5. Keep `openSessionPullRequest` on Brain/Worker Octokit.
6. Leave clone bootstrap as a separate credentialed **trusted** provision step (not agent sandbox), closing the tokenized `gitCheckout` exception over time.
7. Preserve test intents from `privileged-git.test.ts` (quoting, redaction, cleanup, no force, public URL) under the new host boundary.

---

## 10. Decision for wayfinder issue 09

| Question | Answer |
| --- | --- |
| Primary export transport? | **Credential-free git bundle + ephemeral trusted git executor** |
| Git Database API? | **Not** for session history; optional micro-tooling only |
| Does current privileged-git suffice? | **Security isolation patterns yes; trust boundary placement no** |
| Exact graph + repeatable FF PR branch? | **Yes**, via non-force pack push of sandbox commits after executor validation |

---

## Appendix A — Current push refspec (Verified)

From `privileged-git.ts` tests/implementation:

```text
git push --no-verify https://github.com/<owner>/<repo>.git <40-hex-sha>:refs/heads/<branch>
```

No force flag; destination branch is the session branch only.

## Appendix B — Bundle shape reminder (Verified)

Incremental (preferred after first export):

```text
# v2 git bundle
-<basis-sha> <comment>
<head-sha> refs/heads/ditto/session-<id>

<pack data>
```

Executor must already contain `<basis-sha>` before `verify`/`fetch`.

## Appendix C — What this research does not decide

- Concrete Cloudflare binding for the executor (Container class vs job queue) — depends on Brain go/no-go and Alchemy graph (issues 06, 11, 12).
- Numeric size/commit caps and whether submodules are ever allowed.
- Whether session sync/fetch of primary also moves fully out of the Project Sandbox (should, for credential purity; separate fetch protocol).
)
