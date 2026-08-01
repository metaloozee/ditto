# Plan 038: Make project env set/delete concurrent-safe with ciphertext CAS

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git rev-parse --short HEAD
> git status --short
> git diff --stat 2c37ee1..HEAD -- \
>   apps/web/src/integrations/trpc/routers/projects.ts \
>   apps/web/src/integrations/trpc/routers/projects.test.ts \
>   apps/web/src/lib/project-env-vars.ts \
>   apps/web/src/lib/project-env-vars.test.ts \
>   apps/web/src/db/schema.ts \
>   apps/web/src/lib/crypto.ts \
>   apps/web/src/lib/project-sandbox.ts \
>   plans/README.md
> ```
>
> Then re-read live `setEnvVar` / `deleteEnvVar` if those files differ from the
> "Current state" excerpts below. On behavioral mismatch (CAS already present,
> provision already removed, schema gained an env version column, encrypt became
> deterministic, or values are trimmed again), STOP and report — do not invent
> a second concurrency scheme.
>
> Work on branch `advisor/038-project-env-mutation-cas` through all steps.
> Do not push or open a PR unless the operator instructs it.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED — correctness-critical RMW fence, but no schema migration
  and a small surface (`setEnvVar` / `deleteEnvVar` + helper + tests)
- **Depends on**: none (ENV-2 / Finding 4 value non-trim already on master at
  `2c37ee1`; independent of Plan 037)
- **Category**: bug / correctness
- **Planned at**: commit `2c37ee1`, 2026-08-01
- **Branch**: `advisor/038-project-env-mutation-cas`
- **Status**: DONE (worktree `.worktrees/advisor-038-project-env-mutation-cas` @ `20e8d64`; reviewer APPROVE)

## Why this matters

Project environment variables are stored as one encrypted JSON blob on
`projects.envVars`. `setEnvVar` and `deleteEnvVar` do unfenced
read → decrypt → mutate → (optional long `provisionProjectSandbox`) →
encrypt → `UPDATE` by `id`+`userId` only. Concurrent mutations therefore
lose sibling keys, resurrect deleted keys, or drop deletes: last writer
overwrites the whole blob from a stale read.

`updatedAt` is not a CAS token (1-second resolution and shared with rename,
preview lease, backup, provision). AES-GCM encryption is non-deterministic
(random salt+IV), so the CAS predicate must compare the **prior ciphertext
blob from the read**, not a re-encrypted form of the same plaintext.

Sandbox provision mid-RMW does **not** inject env into the container; D1 is
the source of truth and agent-run decrypts later. Provision only widens the
race window. This plan fences the blob write and removes that dead provision
from the env mutation path.

Design source (data only): Workstream 6 **ENV-3** in
`docs/superpowers/specs/2026-07-26-platform-hardening-design.md`.

## Locked design decisions

Do not invent another scheme.

1. **No schema migration.** No `envVarsVersion` column. Prefer ciphertext CAS
   on the existing `projects.envVars` text column.
2. **CAS helper** performs one conditional update:
   - `WHERE id = ? AND userId = ? AND`
   - if `expectedCiphertext === null`: `envVars IS NULL`
   - else: `envVars = expectedCiphertext`
   - `SET envVars = nextCiphertext, updatedAt = unixepoch()`
   - success = `.returning({ id })` yields a row (same success signal as
     provision fence / backup generation in `project-sandbox.ts`).
3. **Bounded retry**: total **5** attempts per mutation. Each attempt:
   fresh `SELECT` of `envVars` (and ownership) → decrypt → apply the **same
   logical op** → encrypt → CAS. Do not reuse a stale decrypted array across
   attempts.
4. **Exhaustion** → `TRPCError({ code: "CONFLICT", message: "..." })`. Never
   silent last-writer. Message must be stable and client-safe (no ciphertext,
   no key values). Suggested:
   `"Environment variables were updated concurrently. Please retry."`
5. **Remove `provisionProjectSandbox` from `setEnvVar` and `deleteEnvVar`
   entirely** (not “move after CAS”, not “gate before RMW”). Justification:
   - D1 `projects.envVars` is source of truth.
   - Agent-run decrypts via `decryptEnvVars` at run start
     (`agent-run-service.ts`); process injection does not depend on this
     provision call.
   - Provision does not write env into the sandbox filesystem.
   - Keeping provision anywhere on this path either re-widens the race or
     couples unrelated readiness failures to credential edits.
   - After removal, drop the unused `provisionProjectSandbox` import from
     `projects.ts` if nothing else in that file calls it (at plan time only
     set/delete call it).
6. **Do not change value trimming.** Finding 4 / ENV-2 already landed:
   `sanitizeEnvVars` keeps values byte-for-byte (`project-env-vars.test.ts`).
   Keys still trim + `normalizeEnvVarKey`. Do not re-open trim.
7. **Out of this plan**: ENV-4 bounds, crypto key separation, UI retry UX,
   `create` initial-env path, `listEnvVars`, architecture doc rewrites.
8. **Tests first (characterization), then fix.** New concurrent tests must
   fail (or be clearly impossible to pass) against the old unfenced update;
   after the fix they pass.

## Current state

Excerpts verified against planned-at `2c37ee1`.

### Schema — single blob, no version

```ts
// apps/web/src/db/schema.ts (projects table)
envVars: text("envVars"),
// ...
updatedAt: integer("updated_at", { mode: "timestamp" }).default(
  sql`(unixepoch())`,
),
```

No env-specific version/generation column. `updatedAt` is shared.

### Encrypt is non-deterministic

```ts
// apps/web/src/lib/crypto.ts — encryptText
const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
// payload = v1.salt.iv.ciphertext  (new salt+iv every call)
```

Therefore CAS **must** use the ciphertext string returned from the read, not
`encrypt(decrypt(row))` equality.

### Helpers (keep behavior; F4 already fixed)

```ts
// apps/web/src/lib/project-env-vars.ts
export function sanitizeEnvVars(...): SandboxEnvVar[] {
  // keys: trim + normalizeEnvVarKey; values: NOT trimmed
  envVarsByKey.set(key, envVar.value);
}
export async function encryptEnvVars(...): Promise<string | null> {
  if (envVars.length === 0) return null;
  return await encryptText(JSON.stringify(envVars), secret);
}
export async function decryptEnvVars(
  encryptedEnvVars: string | null,
  secret: string,
): Promise<SandboxEnvVar[]> { /* null → []; bad payload → 500 TRPCError */ }
```

### Unfenced RMW today

```ts
// apps/web/src/integrations/trpc/routers/projects.ts — setEnvVar (~221–309)
const [project] = await db.select()... // full row
const envVars = await decryptEnvVars(project.envVars, ctx.env.BETTER_AUTH_SECRET);
const nextEnvVars = sanitizeEnvVars([...envVars, nextEnvVar]);
const encryptedEnvVars = await encryptEnvVars(nextEnvVars, ctx.env.BETTER_AUTH_SECRET);

if (project.sandboxId) {
  const ensured = await provisionProjectSandbox({ db, env: ctx.env, project });
  // PRECONDITION_FAILED if not success — widens window, does not inject env
}

await db.update(projects).set({
  envVars: encryptedEnvVars,
  updatedAt: sql`(unixepoch())`,
}).where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)));
// ↑ no envVars predicate

return toEnvVarKeys(nextEnvVars);
```

`deleteEnvVar` (~301–381) is the same shape: read → filter key → optional
provision → unfenced update. Early return when key absent (no write) is fine
and should remain, but a concurrent set of another key must not be lost when
a delete **does** write.

### CAS exemplars in this repo (match style, not copy version columns)

- **Status fence**: `provisionProjectSandbox` updates only when
  `status = "ready"`, success via `.returning()`  
  (`apps/web/src/lib/project-sandbox.ts` ~402–416).
- **Generation fence**: backup store conditions on
  `sandboxBackupStoredGeneration < candidate`  
  (`project-sandbox.ts` ~109–125).
- **Preview lock**: `acquireProjectPreviewLease` conditions on null/expired
  lock token (`session-preview.ts` ~184–215).
- **Version CAS**: `account-provider-credentials.ts` version+lease predicates
  and shared `credentialRowMatches` for tests (~987+).

Env CAS is closest to the status fence: one column equality/IS NULL check +
`returning` to detect win/loss — **without** adding a version column.

### Tests today

- `apps/web/src/integrations/trpc/routers/projects.test.ts` — only
  `deleteProject` fence mapping (~122 lines). **No** `setEnvVar` /
  `deleteEnvVar` coverage. Mocks `provisionProjectSandbox`. Passes through
  real `project-env-vars`.
- `apps/web/src/lib/project-env-vars.test.ts` — single F4 whitespace test.
  Keep it; do not weaken.

### Consumers (do not break)

- UI: `apps/web/src/components/project-settings-dialog.tsx` calls
  `setEnvVar` / `deleteEnvVar` / `listEnvVars` and already renders
  `mutation.error.message`. CONFLICT will surface without UI changes.
- Agent run: `decryptEnvVars(project.envVars, …)` in
  `agent-run-service.ts` — read path only; no change.

### Conventions to match

- tRPC errors: `TRPCError` with `NOT_FOUND` / `BAD_REQUEST` /
  `PRECONDITION_FAILED` already used in this router; add `CONFLICT` for CAS
  exhaustion only.
- Drizzle: `and`, `eq`, `sql` already imported in `projects.ts`; add `isNull`
  (and only what the helper needs). Prefer `isNull(projects.envVars)` over
  `eq(..., null)` — SQL NULL equality is wrong.
- Secrets in tests: use a fixed non-production string like
  `"test-better-auth-secret-min-length"` (see `agent-run-service.test.ts`).
  Never log or assert full ciphertext contents beyond inequality / round-trip
  key sets.
- Commit style observed on master: `fix(web): …`, `fix(git): …`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Drift | see Executor instructions | interpret vs excerpts |
| Focused tests | `pnpm --filter @ditto/web test -- src/integrations/trpc/routers/projects.test.ts src/lib/project-env-vars.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint/format | `pnpm check` | exit 0 (warnings pre-existing OK if no new errors in touched files) |
| Install (only if needed) | `pnpm install` | exit 0 |

Root scripts (`package.json`): `test` → web vitest; `typecheck` → web tsc;
`check` → biome check.

## Scope

**In scope** (only these may be modified):

- `apps/web/src/lib/project-env-vars.ts` — add CAS write helper (+ optional
  exported max-attempts constant)
- `apps/web/src/lib/project-env-vars.test.ts` — unit tests for CAS helper
  success/failure (null and non-null expected) **without** changing the F4
  whitespace test
- `apps/web/src/integrations/trpc/routers/projects.ts` — rewrite `setEnvVar`
  / `deleteEnvVar` to retry+CAS; remove provision from those paths; drop
  unused import
- `apps/web/src/integrations/trpc/routers/projects.test.ts` — characterization
  + concurrent / CONFLICT coverage
- `plans/README.md` — status row only when done (and only if you maintain the
  index)

**Out of scope** (do NOT touch):

- `apps/web/src/db/schema.ts` — no migration / no version column
- `apps/web/src/lib/crypto.ts` — no encrypt API changes
- Value trimming / `sanitizeEnvVars` value path (F4)
- ENV-4 bounds, key separation, BETTER_AUTH_SECRET rotation
- `create` / rename / deleteProject / listEnvVars behavior beyond what set/delete need
- `project-settings-dialog.tsx` UI (error display already works)
- `provisionProjectSandbox` implementation itself
- Architecture/spec docs (optional one-line follow-up only if operator asks)
- Plan 037 files or any other plan’s source work

## Git workflow

- Branch: `advisor/038-project-env-mutation-cas`
- Commits (suggested):
  1. `test(web): characterize project env mutation races` (failing / red tests)
  2. `fix(web): CAS project env set/delete on ciphertext` (green)
- Or one commit if the harness cannot be merged red; then ensure the commit
  message still names the race fix. Prefer two commits when CI allows red
  intermediate locally.
- Do **not** push or open a PR unless instructed.
- Do **not** revert unrelated dirty files.

## Steps

### Step 0: Drift check + branch

Run the drift commands in the executor instructions. Create/switch to
`advisor/038-project-env-mutation-cas` from up-to-date master unless the
operator gave another base.

**Verify**: in-scope excerpts still match "Current state"; branch name correct.

### Step 1: Add ciphertext CAS helper (+ unit tests)

In `apps/web/src/lib/project-env-vars.ts`:

1. Import drizzle pieces and schema as needed (`and`, `eq`, `isNull`, `sql`,
   `projects`, `createDb` type). Keep the file focused — helper only, no
   tRPC.
2. Export:

```ts
export const PROJECT_ENV_CAS_MAX_ATTEMPTS = 5;

export async function compareAndSetProjectEnvVars(options: {
  db: ReturnType<typeof createDb>;
  projectId: string;
  userId: string;
  expectedCiphertext: string | null;
  nextCiphertext: string | null;
}): Promise<boolean> {
  const matchesExpected =
    options.expectedCiphertext === null
      ? isNull(projects.envVars)
      : eq(projects.envVars, options.expectedCiphertext);

  const [updated] = await options.db
    .update(projects)
    .set({
      envVars: options.nextCiphertext,
      updatedAt: sql`(unixepoch())`,
    })
    .where(
      and(
        eq(projects.id, options.projectId),
        eq(projects.userId, options.userId),
        matchesExpected,
      ),
    )
    .returning({ id: projects.id });

  return updated != null;
}
```

Exact formatting should match repo biome/style; semantics must match.

3. Unit-test with a **tiny fake db** (no real D1) in
   `project-env-vars.test.ts`:
   - Record the `where` predicate inputs the helper would pass, **or**
     implement an in-memory `update().set().where().returning()` that
     applies CAS on a `{ id, userId, envVars }` row.
   - Cases:
     - expected `null`, row `envVars null` → write succeeds, returns `true`
     - expected `"cipher-a"`, row `"cipher-a"` → succeeds
     - expected `"cipher-a"`, row `"cipher-b"` → no write, `false`
     - expected `null`, row non-null → `false`
     - wrong `userId` / `id` → `false`
   - Keep existing F4 test unchanged.

**Verify**:
`pnpm --filter @ditto/web test -- src/lib/project-env-vars.test.ts` → pass.

### Step 2: Characterization tests for router races (expect red before Step 3)

Extend `apps/web/src/integrations/trpc/routers/projects.test.ts`.

**Harness requirements** (implement the smallest mock that supports them):

- `createDbMock` returns a db whose `select/update` operate on one in-memory
  project row owned by `user-1` with mutable `envVars: string | null`.
- CAS semantics on update: only write `envVars` when the row’s current
  ciphertext equals the expected predicate the production helper uses.
  Prefer calling the **real** `compareAndSetProjectEnvVars` through the
  router (integration style) so the mock implements drizzle chain shapes
  the helper/router actually invoke.
- `ctx.env` must include `BETTER_AUTH_SECRET: "test-better-auth-secret-min-length"`
  (update `createCaller` accordingly). Do not print secret values in
  assertions beyond the constant name.
- Do **not** need a real sandbox. After Step 3, `provisionProjectSandbox`
  must not be required for success; before Step 3, tests that only exercise
  the race may still mock it.

**Required cases** (names can vary; behavior cannot):

1. **Lost sibling keys (set ∥ set)**  
   Seed encrypted `{ A: "1" }`. Interleave:
   - mutation 1 reads, paused before write, intends set `B=2`
   - mutation 2 runs set `C=3` to completion
   - mutation 1 resumes write  
   **Old code**: final keys miss `C` or `B`.  
   **New code**: final key set is `{A,B,C}` (order irrelevant).

2. **Resurrected delete (delete ∥ set other key)**  
   Seed `{ A: "1", B: "2" }`. Interleave delete `A` with set/update `B=3`.  
   **Final**: `A` absent, `B` present with value that reflects a serial order
   (either pre-delete `2` superseded by `3`, or `3`). Never `{A,B}` with `A`
   resurrected after a successful delete completion.

3. **Lost delete (set other ∥ delete)**  
   Symmetric to (2): completed delete of `A` must remain deleted after a
   concurrent set of `C`.

4. **Same-key serializability**  
   Concurrent `set A=1` and `set A=2` finish without throwing when CAS
   retries succeed; final value is either `"1"` or `"2"`, never a merge
   artifact, and no extra keys lost from seed.

5. **CAS exhaustion → CONFLICT**  
   Force the in-memory row’s ciphertext to change on every CAS attempt
   (or make `compareAndSet` always return false / always mismatch) for >5
   attempts. Expect `TRPCError` with `code: "CONFLICT"`.  
   (This case may only go green after Step 3 once CONFLICT exists.)

6. **No provision on env path** (green only after Step 3)  
   With `sandboxId` set on the row, `setEnvVar` / `deleteEnvVar` succeed
   **without** calling `provisionProjectSandbox`. Assert
   `provisionProjectSandbox` mock `not.toHaveBeenCalled()`.

**Interleaving technique (pick one, keep it simple):**

- Expose a test-only latch by injecting a custom db where the first
  `select` of mutation 1 resolves, then awaits a Promise you control, while
  mutation 2 runs fully; then release mutation 1’s write; **or**
- Unit-test the retry loop by exporting a small internal
  `applySetEnvVarOp`/`runEnvMutation` if the router gets too hard to
  interleave — but prefer router-level tests via `projectsRouter.createCaller`.

If full async interleaving is too brittle in one PR, minimum bar that still
catches the bug:

- Implement the in-memory CAS store.
- Run two sequential “stale write” simulations: manually feed the **old**
  unfenced logic (or call router once you can stub select to return stale
  ciphertext while store advanced) and show lost keys; then after fix,
  stale write returns CONFLICT or retries to merge.

Document in the test file which simulation is used so reviewers see it would
fail on unfenced UPDATE.

**Verify (before Step 3)**: at least tests (1)–(3) **fail** (or the stale-write
simulation asserts the bug). Do not “fix” tests to pass on old code.

**Verify (command)**:
`pnpm --filter @ditto/web test -- src/integrations/trpc/routers/projects.test.ts`
→ red on race cases.

### Step 3: Implement retry + CAS in `setEnvVar` / `deleteEnvVar`

Rewrite both mutations in `projects.ts`:

**Shared shape** (pseudocode — match local style):

```ts
const secret = ctx.env.BETTER_AUTH_SECRET;
// validate input once (sanitize key / delete trim) before the loop

for (let attempt = 0; attempt < PROJECT_ENV_CAS_MAX_ATTEMPTS; attempt++) {
  const [project] = await db
    .select({ envVars: projects.envVars /* + fields you still need */ })
    .from(projects)
    .where(and(eq(projects.id, input.id), eq(projects.userId, ctx.user.id)))
    .limit(1);

  if (!project) throw new TRPCError({ code: "NOT_FOUND", ... });

  const expectedCiphertext = project.envVars; // string | null — CAS token
  const current = await decryptEnvVars(expectedCiphertext, secret);

  // set: next = sanitizeEnvVars([...current, nextEnvVar])
  // delete: next = current.filter(k !== key); if same length → return keys (no write)

  const nextCiphertext = await encryptEnvVars(next, secret);

  // Optional micro-opt: if nextCiphertext logic yields no semantic change for
  // set of identical key/value, still OK to write or early-return; do not
  // add complex equality unless cheap (order-sensitive JSON). Prefer always
  // CAS-write for set.

  const wrote = await compareAndSetProjectEnvVars({
    db,
    projectId: input.id,
    userId: ctx.user.id,
    expectedCiphertext,
    nextCiphertext,
  });

  if (wrote) return toEnvVarKeys(next);
  // else retry with fresh read
}

throw new TRPCError({
  code: "CONFLICT",
  message: "Environment variables were updated concurrently. Please retry.",
});
```

Hard requirements:

- **Delete** still early-returns without write when key absent **on that
  attempt’s fresh read**. If a concurrent set added the key, a later
  attempt may delete it — that is correct serializability.
- **Remove** the entire `if (project.sandboxId) { provisionProjectSandbox… }`
  blocks from both mutations.
- Remove unused `provisionProjectSandbox` import if unused.
- Prefer selecting only needed columns (`envVars`) once you no longer need
  the full row for provision; full-row select is acceptable if simpler.
- Do **not** CAS on `updatedAt`.
- Do **not** re-encrypt to compute expected ciphertext.

**Verify**:
`pnpm --filter @ditto/web test -- src/integrations/trpc/routers/projects.test.ts src/lib/project-env-vars.test.ts`
→ all green, including races + CONFLICT + provision-not-called + F4.

### Step 4: Full gates

```bash
pnpm typecheck
pnpm check
pnpm --filter @ditto/web test -- src/integrations/trpc/routers/projects.test.ts src/lib/project-env-vars.test.ts
```

**Verify**: typecheck exit 0; check exit 0 (or only pre-existing warnings
unrelated to your files); focused tests pass.

Optional sanity (not required if slow): `pnpm --filter @ditto/web test` and
confirm no new failures beyond any already-known pre-existing ones. Do not
“fix” unrelated failures.

### Step 5: Status + commit

- Update `plans/README.md` Plan 038 status to DONE (or leave to reviewer if
  instructed).
- Commit on the advisor branch with a message like  
  `fix(web): CAS project env set/delete on ciphertext`.

**Verify**: `git status` / `git diff --stat` shows **only** in-scope files
(+ plan index). No schema, no crypto, no UI drive-bys.

## Test plan

| # | File | Case |
|---|------|------|
| T1 | `project-env-vars.test.ts` | F4 whitespace preserved (existing) |
| T2 | `project-env-vars.test.ts` | CAS helper true on matching null/non-null expected |
| T3 | `project-env-vars.test.ts` | CAS helper false on mismatch / wrong owner |
| T4 | `projects.test.ts` | set∥set keeps sibling keys |
| T5 | `projects.test.ts` | delete∥set does not resurrect deleted key |
| T6 | `projects.test.ts` | set∥delete does not drop unrelated new key |
| T7 | `projects.test.ts` | same-key concurrent sets → one serial value |
| T8 | `projects.test.ts` | >5 forced CAS losses → CONFLICT |
| T9 | `projects.test.ts` | provision **not** called when sandboxId set |
| T10 | `projects.test.ts` | NOT_FOUND / BAD_REQUEST paths still work (smoke) |

Pattern exemplars: in-memory CAS store like
`account-provider-credentials.test.ts` (`credentialRowMatches`); router
caller setup already in `projects.test.ts`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `compareAndSetProjectEnvVars` exists and predicates on
      `id` + `userId` + (`envVars IS NULL` \| `envVars = expectedCiphertext`)
- [ ] `setEnvVar` / `deleteEnvVar` retry ≤ `PROJECT_ENV_CAS_MAX_ATTEMPTS` (5)
      on fresh reads; exhaustion → `CONFLICT`
- [ ] Neither mutation calls `provisionProjectSandbox`
- [ ] `grep -n provisionProjectSandbox apps/web/src/integrations/trpc/routers/projects.ts`
      → no matches (import gone)
- [ ] No schema change: `git diff 2c37ee1 -- apps/web/src/db/schema.ts` empty
      (or unrelated — must not add env version)
- [ ] F4 test still passes; values not trimmed
- [ ] Focused tests above pass; includes T4–T9
- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm check` exit 0 (no new errors in touched files)
- [ ] `git diff --name-only` only in-scope paths (+ plans index)
- [ ] `plans/README.md` status for 038 updated if executor owns the index

## STOP conditions

Stop and report (do not improvise) if:

- Live `setEnvVar` / `deleteEnvVar` already use a different concurrency
  mechanism (version column, transaction, Durable Object) — reconcile rather
  than double-fence.
- Someone added `envVarsVersion` (or similar) migration overlapping this plan.
- `encryptText` became deterministic or payload format changed so ciphertext
  equality semantics break — re-read `crypto.ts` and report.
- D1/drizzle rejects `isNull(projects.envVars)` or `eq` on text ciphertext in
  this environment after two fix attempts — report the error; do not switch to
  `updatedAt` CAS.
- Making characterization tests work appears to require rewriting the entire
  projects router test stack or standing up real D1 — stop and ask for a
  thinner harness rather than expanding scope into infrastructure.
- Fix appears to need UI, agent-run, or provision implementation changes
  beyond removing the call sites.
- Value trim has regressed or a review comment pressures re-trimming values —
  refuse; point at F4 / ENV-2.
- Any step’s verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Reviewer focus**: (1) CAS predicate uses **read** ciphertext, including
  null; (2) retry re-reads every attempt; (3) provision fully gone from env
  path; (4) CONFLICT not PRECONDITION_FAILED; (5) tests would fail on
  unfenced UPDATE.
- Future ENV-4 bounds should reject oversized input **before** encrypt/CAS
  and must not weaken the CAS loop.
- If env mutations ever must wake a sandbox for a real reason, run provision
  **after** successful CAS (or on a separate explicit API) — never between
  read and CAS write.
- If contention becomes common in UI, add client retry on CONFLICT; server
  contract stays explicit conflict after bounded retries.
- Crypto key separation (Workstream 4) will change `secret` input only;
  CAS blob equality remains valid.
- `create` with initial `envVars` is a single insert today; if it becomes
  read-modify-write later, reuse `compareAndSetProjectEnvVars`.
