# Plan 008: Craft PR title/body from branch commits

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Do **not** update `plans/README.md` (reviewer
> owns the index). Do **not** commit unless asked.

## Status

- **Priority**: P0 (user-reported quality bug)
- **Effort**: S–M
- **Risk**: LOW (pure helpers + tests; same Octokit create path)
- **Depends on**: existing session git export (`session-git.ts`, `github-export.ts`)
- **Category**: bugfix / quality

## Problem

When the user clicks **Open PR** in the UI (no `title`/`body` overrides), the
Worker calls `openSessionPullRequest` → `buildPullRequestTitle` /
`buildSessionPullRequestBody` with commit subjects from:

```ts
git log --format=%s -n 20 <base>..HEAD
```

GitHub `git log` is **newest-first**. The builders treat `commitSubjects[0]`
as the “primary” commit. That makes titles/bodies wrong when the latest
commit is a fixup/chore:

| Branch commits (oldest → newest) | Current title (wrong) | Expected title |
|----------------------------------|----------------------|----------------|
| `feat: add skills readme` then `chore: fix typo` | **Fix typo** | **Add skills readme** (or a short multi-commit summary) |
| only `feat: add skills readme` | Add skills readme | Add skills readme (ok) |

Body quality is also weak:

- Multi-commit lead: `"This pull request includes N commits, led by: …"` (robotic, leads with newest)
- Commit list order mirrors newest-first (harder to read)
- Single-commit body is just the humanized subject + period; multi lacks a real summary of *what the PR does*

**Goal**: Analyze commits on the branch (vs base) and craft a **human, accurate** PR title and description suitable for GitHub review.

## Non-goals

- Do **not** call an LLM for title/body (deterministic helpers only).
- Do **not** change UI components beyond what is required (UI already omits title/body).
- Do **not** change auth, push, dirty checks, or Octokit create fields other than default title/body content.
- Do **not** require full commit bodies (`%B`) unless you can do it cleanly with tests; **subjects are enough** if selection + copy quality is fixed.
- Do **not** invent AI-generated prose that invents features not present in commit subjects.

## Current call graph (do not break)

```
UI session-git-actions openPrMutation
  → trpc sessionGit.openPullRequest (no title/body)
    → openSessionPullRequest
      → collectSessionCommitSubjects(base)
      → buildPullRequestTitle({ sessionTitle, commitSubjects })
      → buildSessionPullRequestBody({ sessionId, sessionTitle, commitSubjects, changedFileCount })

Agent ditto_open_pull_request
  → same openSessionPullRequest (optional title/body overrides still win)
```

Export-run helper `buildPullRequestBody` (with `runId`) shares
`buildPullRequestSummaryParagraph` — keep it consistent or extract shared
logic carefully so both stay coherent.

## Design decisions (locked)

### 1. Chronological order for analysis and listing

Normalize commit subjects to **oldest-first** before building title/body
(reverse the array from `git log`, or collect with `--reverse`). Merge
commits stay filtered out (existing `MERGE_COMMIT_SUBJECT_RE` / parse filter).

After normalization, `subjects[0]` is the first commit on the branch;
`subjects[n-1]` is the tip.

### 2. Title selection (multi-commit)

Do **not** blindly use index 0 after reverse either if a later commit is
clearly more significant — use a **priority pick**:

1. Parse conventional type when present (`feat`, `fix`, `docs`, …).
2. Priority (high → low):  
   `feat` > `fix` > `perf` > `refactor` > `docs` > `test` > `build` > `ci` > `chore` > `revert` > non-conventional.
3. Among equal priority, prefer the **oldest** commit (original intent).
4. Humanize that subject with existing
   `humanizeCommitSubjectForPullRequestTitle` (keep “Fix …” for fixes;
   capitalize description for feat/etc.).
5. Optional polish (only if tests stay simple): if **exactly two**
   meaningful commits and both are high-value types (`feat`/`fix`), you may
   combine e.g. `"Add X and fix Y"` truncated to `PR_TITLE_MAX_LEN` — **not
   required**. Single best-subject title is enough for v1 of this fix.
6. Fallbacks unchanged: session title → `"Workspace session changes"`.

### 3. Body structure

```
<summary paragraph>

## Commits          # only if meaningful.length > 1 (or always list when ≥1 — pick one; prefer list when >1 to match existing tests spirit)
- <subject or humanized>
- ...

---
Session ID: <id>
```

**Summary paragraph rules:**

- **1 commit**: One clear sentence from the humanized subject ending with `.`
  (existing behavior is fine). Optionally mention changed file count if > 0.
- **2+ commits**: Summarize the **theme**, not “led by newest”. Examples of
  acceptable patterns:
  - Prefer: `"This pull request <verb phrase from primary humanized title>."`
    e.g. primary `Add skills readme` → `"This pull request adds skills readme."`
    (lowercase the first letter of the humanized title after a fixed lead-in
    **or** write `"Adds skills readme and related follow-up commits."`)
  - Or: `"This pull request includes N commits:"` is **too thin** alone — must
    name the primary change.
  - **Forbidden** phrasing: `"led by:"`, newest-first implication, `"Apply Ditto"`, branding `"Ditto"` in user-facing PR body.
- List commits **oldest → newest** under `Included commits:` (keep that
  section title for less test churn) using **raw** conventional subjects
  (existing tests expect `- feat: …`).
- Footer: `---` + `Session ID: …` (session body). Run body keeps `Run ID`.
- `changedFileCount > 0`: keep a short sentence about N changed files if
  already present; do not invent counts.

### 4. Scope of code changes

| File | Change |
|------|--------|
| `src/lib/github-export.ts` | Core title/body logic: chronological normalize, priority pick, better summary copy |
| `src/lib/github-export.test.ts` | Update + add cases for multi-commit newest-first input, priority pick, body order |
| `src/lib/session-git.ts` | Only if collection should use `--reverse` or export a shared normalizer; prefer pure helpers in `github-export` so callers can stay dumb |
| `src/lib/session-git.test.ts` | Adjust expectations if body/title strings change; keep coverage that `git log` is range-scoped |

Prefer implementing `selectPrimaryCommitSubject(subjects)` and
`orderCommitsOldestFirst(subjects)` as small exported or unexported helpers
in `github-export.ts` so unit tests can hit them without sandbox mocks.

### 5. Input order contract

Document in a one-line comment on `buildPullRequestTitle` /
`buildSessionPullRequestBody`:

> `commitSubjects` may be newest-first (git log default) or any order;
> builders normalize to oldest-first and select the primary subject by type priority.

Callers (`session-git`) may keep `git log --format=%s` as today **without**
`--reverse` if helpers normalize — **preferred** (one place for correctness).

## Implementation steps

### Step 1 — Reproduce with tests (TDD)

Add failing unit tests in `github-export.test.ts`:

```ts
// Newest-first input (as git log returns):
buildPullRequestTitle({
  commitSubjects: ["chore: fix typo", "feat: add skills readme"],
})
// → "Add skills readme"

buildPullRequestTitle({
  commitSubjects: ["docs: tweak readme", "fix: login redirect", "feat: add billing"],
})
// → "Add billing"  (feat wins)

// Body lists oldest first, names primary theme, no "led by"
const body = buildSessionPullRequestBody({
  sessionId: "session-1",
  commitSubjects: ["chore: fix typo", "feat: add skills readme"],
});
expect(body).toMatch(/skills readme/i);
expect(body).not.toMatch(/led by/i);
// Included commits order: feat line before chore line
```

Update existing multi-commit tests that assumed newest-first “led by” wording.

### Step 2 — Implement helpers

In `github-export.ts`:

1. `orderCommitSubjectsOldestFirst` — reverse copy (git log is newest-first;
   if you only reverse, document that assumption). Safer approach: reverse
   always is wrong if caller already oldest-first. **Simplest correct approach
   for this codebase**: treat input as newest-first from git log (current
   only producer), reverse to oldest-first. If both session-git and tests
   pass newest-first consistently, reverse once inside builders.
2. `selectPrimaryCommitSubject(orderedOldestFirst)` — priority scan.
3. Wire `buildPullRequestTitle` to use primary subject.
4. Wire `buildPullRequestSummaryParagraph` + body list to chronological
   subjects and improved copy.
5. Keep `humanizeCommitSubjectForPullRequestTitle`, truncation, merge filter.

### Step 3 — Align session-git tests

Run:

```bash
pnpm test src/lib/github-export.test.ts src/lib/session-git.test.ts
```

Update `session-git.test.ts` expectations only if default title/body strings
change for the single-commit fixture (`feat: add skills readme` → still
`"Add skills readme"`).

### Step 4 — Full verification

```bash
pnpm test
pnpm check
```

Both must exit 0.

## Acceptance criteria

- [ ] Multi-commit branch where tip is `chore:`/`docs:` and base work is `feat:`/`fix:` produces a title from the **higher-priority** commit, not the tip.
- [ ] Commit list in PR body is **oldest → newest**.
- [ ] No `"led by"` (or equivalent tip-biased) copy.
- [ ] Explicit `title` / `body` overrides on `openSessionPullRequest` still win (no regression).
- [ ] Single-commit path still humanizes conventional subjects.
- [ ] Session title fallback still works when no commit subjects.
- [ ] Merge commits excluded from title and list.
- [ ] `pnpm test` and `pnpm check` pass.
- [ ] No secrets/token changes; no UI redesign.

## STOP conditions

- If you need LLM/model APIs to generate titles — STOP; stay deterministic.
- If `buildPullRequestTitle` is used outside tests/session-git/export in a way
  that assumes newest-first `[0]` semantics beyond what tests show — grep and
  fix all call sites; if unclear, STOP and report.
- If formatting requires large unrelated refactors — do not drive-by refactor.

## Final report format

When done, reply with:

1. Summary of behavior change (before/after examples).
2. Files touched.
3. Test commands + results.
4. Any intentional deviations from this plan.
5. Residual risks.
