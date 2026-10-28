# 030: Seed and branch handoff for candidate sessions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. On a STOP condition, stop and report; do not improvise. Do not stage or commit. A reviewer maintains `plans/README.md`; do not edit it or this file. No deployment, no `alchemy deploy`/`alchemy dev`, no Cloudflare API call, no GitHub API call, no live provider request, no `db:migrate` and no data reset is authorized by this plan. `pnpm db:generate` is authorized exactly once, in Step 1.
>
> **Drift check (run first)**: `git diff --stat f025d17..HEAD -- apps/runtime/src apps/web/src/lib apps/web/src/db apps/web/migrations apps/credential-tests/src packages/runtime-contracts/src package.json`. If any listed file changed, compare the excerpts below against live code. A mismatch is a STOP condition.

## Status

- **Status**: TODO
- **Priority**: P1 (without it no product path reaches a baseline, so candidate tools never run and Git actions stay `unavailable`)
- **Effort**: L
- **Risk**: MEDIUM (one generated migration; the first product path that hands a seed archive to the runtime)
- **Depends on**: 025 and 029 (both DONE with limits)
- **Category**: L6 prerequisite
- **Spec**: `docs/specs/pi-durable-session-runtime.md`: "No retained mutation before a proved initial paired baseline", and the paired-checkpoint baseline (seed restore, then owned-branch sync, then the first pair)
- **Decision**: maintainer, 2026-10-28. `extractedBytes` gets a nullable `archives.extractedBytes` column through a **generated** migration. Seeds built before it have `NULL` and are denied a candidate baseline with `seed_unmeasured` until the project is re-imported.
- **Planned at**: commit `f025d17`, 2026-10-28

## Why this matters

The runtime can publish a baseline (`establishBaseline`, 012) and fetch the owned branch through the product broker (029), but nothing calls it, and the session never learns its branch:

```ts
// apps/runtime/src/pi-durable-execution-session.ts:62-65
	/** The session's owned branch; Git actions stay unavailable until a seed handoff supplies it. */
	protected sessionBranch(): string | undefined {
		return undefined;
	}
```

```ts
// apps/runtime/src/pi-durable-execution.ts:221-223
		workspace(port: WorkspaceHostPort): WorkspaceController | undefined {
			const branch = deps.branch;
			if (branch === undefined) return undefined;
```

The host keeps ordinary work closed until a baseline exists (`pi-durable-host.ts:1255-1257`, `return admission.baseline && !admission.exclusive;`). So a composed candidate session today accepts a prompt, never runs a tool, and answers every Git action `unavailable`. Today only tests call `establishBaseline`, through `pi-durable-execution.test.ts:385-393` and a test-only `seed(...)` helper.

This plan closes that gap. The product records the owned branch when it creates the session and exposes a verified seed artifact. It also gets production GitHub dependencies for the 029 broker, built from `projects.githubInstallationId`. The runtime reads the source on activation, uses its branch for `sessionBranch()` and starts the baseline once.

## Current state

### Session creation (product)

A fresh candidate session is created in the first prompt's D1 batch with no branch:

```ts
// apps/web/src/lib/session-command-candidate.ts:458-462
				q(
					`INSERT INTO workspace_sessions(id,projectId,userId,title,status,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion,runtimeProtocolVersion)
SELECT sessionId,projectId,userId,'Synthetic session','active',identityId,'pi_durable_v1',1,2 FROM candidate_workspace_claims WHERE sessionId=? AND identityId=?`,
					sessionId,
					identityId,
				),
```

`sessionId` is `crypto.randomUUID()` (`session-command-candidate.ts:254`, `:426`). A continuation's destination session already gets a branch, and fresh sessions must use the same convention:

```ts
// apps/web/src/lib/candidate-lifecycle.ts:156 and :168-169
						`ditto/${sessionId}`,
						...
						`INSERT INTO workspace_sessions(id,projectId,userId,title,status,branchName,sandboxIdentityId,runtimeOwner,runtimeOwnerVersion,runtimeProtocolVersion)
SELECT destinationSessionId,projectId,userId,?,'active',branchName,destinationIdentityId,'pi_durable_v1',1,2 FROM candidate_continuations WHERE id=?`,
```

Do **not** use the legacy `sessionBranchName()` in `workspace-policy.ts` (`ditto/session-<12 chars>`). Candidate sessions use `ditto/<sessionId>`.

### The project seed (product)

At import, `buildProjectSeed` (`apps/web/src/lib/project-seed.ts:245-490`) writes one `project_seeds` row per project (`uniqueIndex project_seeds_projectId_uidx`). It promotes the row to `buildState='ready'` with `sourceCommit` and `archiveId`, then sets `projects.status='ready'`. The archive row comes from `createArchive(..., { ownerKind: "project_seed", ownerId: projectId, generation: 0 })`. Its bytes live in the web Worker's `BACKUP_BUCKET` under `project_seed/<projectId>/0/<archiveId>.tar.gz` (`sandbox-archive.ts:135-142`).

`createArchiveBody` (`sandbox-archive.ts:646-725`) measures `cli.extractedBytes` (line ~679) and checks it against the limit, but the `ready` update stores only `byteCount` and `digest`:

```ts
// apps/web/src/lib/sandbox-archive.ts:~703-712
		const [ready] = await options.db
			.update(archives)
			.set({
				status: "ready",
				byteCount: measured.byteCount,
				digest: measured.digest,
				updatedAt: sql`(unixepoch())`,
			})
```

The `archives` table (`apps/web/src/db/schema.ts:297-330`) has `objectKey`, `formatVersion`, `compatibilityKey`, `byteCount`, `digest` and `status`, but no `extractedBytes`. `sourceCommit` lives on `project_seeds`. Note that `project_seeds.compatibilityKey` is the seed's **build** key (`seed-format=...;repo=...`). It is not the archive key, so never put it in the artifact.

### The runtime artifact and restore

```ts
// packages/runtime-contracts/src/artifacts.ts:35-45
export type ArchiveArtifactV1 = {
	version: 1;
	kind: "workspace_archive";
	formatVersion: number;
	compatibilityKey: string;
	objectKey: string;
	byteCount: number;
	extractedBytes: number;
	digest: string;
	sourceCommit: string;
};
```

`parseArchiveArtifactV1` (same file, `:47`) validates it strictly. The runtime's restore (`apps/runtime/src/pi-durable-artifacts.ts:683-771`) refuses `formatVersion`/`compatibilityKey` other than `ARCHIVE_FORMAT_VERSION`/`ARCHIVE_COMPATIBILITY_KEY`, and refuses `byteCount`/`extractedBytes` over the limits. It then reads `deps.store.get(artifact.objectKey)` from the runtime's own R2 binding (`CANDIDATE_RECOVERY`, through `r2ArtifactStore`, which uses keys unprefixed). It checks length and digest, extracts, and requires the restored HEAD to equal `sourceCommit`. The web `archives` row uses the same `ARCHIVE_FORMAT_VERSION`/`ARCHIVE_COMPATIBILITY_KEY` constants (`sandbox-archive.ts:12` imports them from `packages/runtime-contracts`).

Runtime retention never deletes an archive it did not upload itself:

```ts
// apps/runtime/src/pi-durable-retention.ts:168-169
			// The archive is this session's only when its own capture made it;
			// seeds and a continued lineage's source archive are shared.
```

So the runtime may reference the seed object in place. **Deployment constraint, recorded but not done here:** `CANDIDATE_RECOVERY` must be bound to the same R2 bucket as the web `BACKUP_BUCKET`. Tests use one bucket for both.

### Baseline publication (runtime)

```ts
// apps/runtime/src/pi-durable-checkpoints.ts:900-908
		establishBaseline(input: { seed: ArchiveArtifactV1; branch: string }) {
			return publish("baseline", async (scope) => {
				const restored = await recovery.restore(scope, input.seed);
				if (restored.status !== "verified") return restored;
				const synced = await recovery.syncBranch(scope, input.branch);
				if (synced.status !== "verified") return synced;
				return { seedDigest: input.seed.digest, branchHead: synced.head };
			});
		},
```

`publish` returns `{ status: "deferred", reason: "baseline_exists" }` once a baseline exists (`:700-701`), so repeated calls are safe. Its `finally` calls `host.resume()` once a pointer exists (`:889-890`), which releases work queued behind the baseline. `PublishResult` is at `:145-152`.

The host only knows the restorer through a narrow type and caches it:

```ts
// apps/runtime/src/pi-durable-checkpoints.ts:173-181
export type CheckpointRestorer = {
	restorePair(
		pairId: string,
		establish: (...) => Promise<number>,
	): Promise<RestorePairResult>;
};
```

```ts
// apps/runtime/src/pi-durable-host.ts:4790-4793 (acceptRestore)
		this.restorer ??= this.dependencies.checkpoints?.restorer?.(
			this.checkpointPort(),
		);
		if (!this.restorer) throw new Error("Restore requires paired checkpoints");
```

`PiDurableHost.workspaceAction` (`pi-durable-host.ts:7140-7147`) is the exemplar for a public host method with guards: `if (!workspace || this.sealed || this.storageBarrier) return { status: "denied", reason: "unavailable" }; if (this.denied) ...`.

### Session activation (runtime)

```ts
// apps/runtime/src/pi-durable-product-session.ts:248-256
	private async open(scope: CandidateRuntimeScope) {
		if (this.host && !(await this.host.awaitClosure())) return this.host;
		const keyring = await this.keyring();
		this.prepareExecution(scope, keyring);
		const product = this.env.CandidateProduct;
		// A session that can reach an executor waits for its baseline pair
		// before any ordinary work; without one, tools fail before admission.
		const executes = this.remoteExecutor() !== undefined;
		return PiDurableHost.open(this.ctx.storage, {
```

`prepareExecution` is synchronous. `PiDurableExecutionSession.prepareExecution` (`pi-durable-execution-session.ts:66-101`) composes execution only when both `CandidateSandbox` and `CANDIDATE_RECOVERY` are bound, and passes `branch: this.sessionBranch()`.

### The 029 broker's GitHub dependencies

```ts
// apps/web/src/lib/candidate-branch-fetch.ts:25-35
export type CandidateBranchFetchDeps = {
	db: D1Database;
	now: () => number;
	github: {
		branchExists(repository: string, branch: string): Promise<boolean>;
		defaultBranch(repository: string): Promise<string>;
	};
	/** The token never leaves this module except in the upstream request. */
	mintToken(repository: string): Promise<string>;
	fetch(request: Request): Promise<Response>;
};
```

Only fakes exist (`apps/credential-tests/src/model-entry.ts:722-738`). There is no production `CandidatePrivateProduct` entrypoint anywhere in `apps/web/src`. The real primitives are `getInstallationAccessToken(env, installationId, { repositories })` (`apps/web/src/lib/github-app.ts:23-40`) and `getGitHubApp(env).getInstallationOctokit(installationId)` (used in `project-seed.ts:156-182`). `repositories` takes **short names** (`app`, not `acme/app`). `projects.githubInstallationId` exists (`schema.ts:121`). The ownership check helper is `currentAuthority(db, scope)` (`candidate-branch-fetch.ts:71-83`, private).

## Design (decided; do not redesign)

1. **Migration.** Add `extractedBytes: integer("extractedBytes", { mode: "number" })` (nullable, no default) to `archives` in `schema.ts`. Generate the SQL with `pnpm db:generate` and never edit the output. `createArchiveBody` also sets `extractedBytes: cli.extractedBytes` in its `ready` update.
2. **Owned branch at creation.** The fresh-session `INSERT INTO workspace_sessions` in `session-command-candidate.ts` gains `branchName`, bound to `` `ditto/${sessionId}` ``. Nothing else in that batch changes.
3. **Baseline source (product).** New `apps/web/src/lib/candidate-baseline.ts` exports `readCandidateBaselineSource(db, scope): Promise<{ branch: string; seed: ArchiveArtifactV1 } | { denied: CandidateBaselineDenial }>`. It never throws past the port (a thrown error becomes `{ denied: "source_failed" }`). It checks in this order:
   - Ownership and current executor through `prepareCandidateRuntimeAuthority`/`validateCandidateRuntimeAuthority`, exactly as `currentAuthority` in `candidate-branch-fetch.ts` does; export that helper instead of copying it. `scope.ownerVersion !== 1` or a non-current authority returns `not_owned`.
   - The session is a continuation destination (`SELECT 1 FROM candidate_continuations WHERE destinationSessionId=?`): `continuation_unsupported`. A continuation's baseline comes from its source archive (016), not the project seed, and that path is not built.
   - `workspace_sessions.branchName` is NULL: `branch_missing`.
   - No `project_seeds` row with `buildState='ready'`, a non-null `archiveId` and a non-null `sourceCommit` for `scope.projectId`: `seed_unavailable`.
   - No `archives` row with that id, `status='ready'`, `ownerKind='project_seed'` and `ownerId=scope.projectId`: `seed_unavailable`.
   - `archives.extractedBytes IS NULL`: `seed_unmeasured`.
   - `parseArchiveArtifactV1({ version: 1, kind: "workspace_archive", formatVersion, compatibilityKey, objectKey, byteCount, extractedBytes, digest, sourceCommit })` throws, or the format/compatibility differs from `ARCHIVE_FORMAT_VERSION`/`ARCHIVE_COMPATIBILITY_KEY`: `seed_incompatible`.
   - Otherwise it returns `{ branch, seed }`. Use raw `db.prepare` SQL, as the sibling modules do.
4. **Production GitHub dependencies (product).** In `candidate-branch-fetch.ts`, export `candidateGitHubDeps(env: GitHubAppCredentials, db: D1Database, scope: CandidateFetchScope): Pick<CandidateBranchFetchDeps, "github" | "mintToken">`. Keep the existing `CandidateBranchFetchDeps` signatures unchanged. Each method resolves the installation with `SELECT githubInstallationId FROM projects WHERE id=? AND userId=? AND githubRepo=?` (scope project, scope user, the `repository` argument) and throws when it is missing or null. The open and broker paths already turn a throw into a denial.
   - `mintToken(repository)`: `getInstallationAccessToken(env, installationId, { repositories: [<repo part of owner/repo>] })`.
   - `github.defaultBranch(repository)`: `getInstallationOctokit(installationId)`, then `rest.repos.get({ owner, repo })`, and return `data.default_branch`. Throw if it is empty.
   - `github.branchExists(repository, branch)`: `rest.repos.getBranch({ owner, repo, branch })`. Return `true` on success and `false` on HTTP status 404; rethrow anything else.

   `GitHubAppCredentials` is whatever type `github-app.ts` already exports for `env`; use that name. Nothing calls this factory in production yet (no product entrypoint exists). It is unit-tested and left for the deployment plan.
5. **Port.** Add `readCandidateBaselineSource(scope: CandidateRuntimeScope): Promise<{ branch: string; seed: ArchiveArtifactV1 } | { denied: string }>` to `CandidatePrivateProduct` in `pi-durable-product-session.ts`. This is a runtime-internal TypeScript type, with no `packages/runtime-contracts` change. The runtime must run `parseArchiveArtifactV1` on `seed` and a string check on `branch` before use; a parse failure counts as a denial.
6. **Activation hook (runtime).** In `PiDurableProductSession.open`, before `this.prepareExecution(scope, keyring)`, add `await this.loadExecutionSource(scope);` with a new `protected async loadExecutionSource(_scope: CandidateRuntimeScope): Promise<void> {}` default. After `PiDurableHost.open(...)` resolves, call a new `protected startBaseline(host: PiDurableHost): void {}` default. Restructure `open` only as far as needed to hold the opened host in a local before returning it. Do not change behaviour for the base class or for `CandidateFixtureSession`.
7. **Execution session (runtime).** In `PiDurableExecutionSession`:
   - `loadExecutionSource` sets a private `source` field when `CandidateSandbox` and `CANDIDATE_RECOVERY` are both bound. It calls `this.env.CandidateProduct.readCandidateBaselineSource(scope)` and keeps `{ branch, seed }` after validation, or `undefined` for a denial or parse failure. Without both bindings it sets `undefined` and makes no call.
   - `sessionBranch()` returns `this.source?.branch`.
   - `startBaseline(host)` returns immediately when `this.execution` or `this.source` is undefined, or when a baseline attempt is already in flight (a private promise field). Otherwise it starts `host.establishCandidateBaseline(this.source)` without awaiting it, and clears the in-flight field in `finally`. Rejections are caught and dropped; the publisher already records failure health. Retrying is the next activation's job (any command, observe or alarm reopens through `activate`).
8. **Host method (runtime).** Widen `CheckpointRestorer` with `establishBaseline(input: { seed: ArchiveArtifactV1; branch: string }): Promise<PublishResult>`. `createCheckpointPublisher` already returns it, so only fixtures that build a bare `CheckpointRestorer` need the method; typecheck flags them, and they may throw "not used". Add a public `PiDurableHost.establishCandidateBaseline(input): Promise<PublishResult>`:
   - Return `{ status: "deferred", reason: "unavailable" }` when `this.sealed`, `this.storageBarrier` or `this.denied` is set, or when no restorer is composed.
   - Otherwise `this.restorer ??= this.dependencies.checkpoints?.restorer?.(this.checkpointPort())` and return `this.restorer.establishBaseline(input)`.

   It adds no new admission rule: `publish` already defers on `baseline_exists`, `restore_pending`, an unsettled writer and a non-current executor.

## Scope

**In scope:**
- `apps/web/src/db/schema.ts` (one column), the generated `apps/web/migrations/0028_*.sql` and `apps/web/migrations/meta/*` that `db:generate` writes.
- `apps/web/src/lib/sandbox-archive.ts` (`ready` update only), `sandbox-archive.test.ts` (assert the stored value).
- `apps/web/src/lib/session-command-candidate.ts` (the one INSERT).
- `apps/web/src/lib/candidate-baseline.ts` (new), and `apps/web/src/lib/candidate-baseline.test.ts` (new) only if a pure helper merits it.
- `apps/web/src/lib/candidate-branch-fetch.ts` (export `currentAuthority`, add `candidateGitHubDeps`), and `apps/web/src/lib/candidate-branch-fetch.test.ts` (new web vitest for `candidateGitHubDeps`).
- `apps/credential-tests/src/model-entry.ts`: implement `readCandidateBaselineSource` on `CandidateFixtureProduct` by delegating to the new module.
- `apps/credential-tests/src/candidate-baseline.worker.test.ts` (new), and the root `package.json` `credentials:verify` script, to add that file to its vitest list.
- `apps/credential-tests/src/product-commands.worker.test.ts`: one assertion that a fresh candidate session has `branchName = 'ditto/<sessionId>'`.
- `apps/runtime/src/pi-durable-checkpoints.ts` (type widening), `pi-durable-host.ts` (one method), `pi-durable-product-session.ts` (port method, two hooks), `pi-durable-execution-session.ts`, `pi-durable-execution.test.ts`, and any runtime fixture the typecheck flags.
- `plans/evidence/030-seed-branch-handoff.md` (new).

**Out of scope:** `alchemy.run.ts` and any production `CandidatePrivateProduct` entrypoint (deployment plan); the shared-bucket binding; `packages/runtime-contracts`; `buildProjectSeed` (other than what `createArchiveBody` stores); `sandbox-authority.ts`, `sandbox-egress-broker.ts` and `privileged-git.ts`; continuation baselines (016 follow-up); preview (024); re-measuring existing seeds; `plans/README.md` and this file.

## Steps

### 1. Migration
Read `apps/web/drizzle.config.*` and the last two migrations to confirm `db:generate` is the only path. Add the column (design point 1). Run `pnpm db:generate` once.

**STOP** if the generated SQL contains anything other than one `ALTER TABLE \`archives\` ADD \`extractedBytes\` integer;` (any table rebuild, `DROP`, or a change to another table). Do not edit, rename or trim the generated files, and do not run `db:generate` again to "fix" it.

Then set `extractedBytes` in `createArchiveBody` and add an assertion in `sandbox-archive.test.ts` that a created archive row stores the CLI's `extractedBytes`.

Verify: `pnpm db:drift` prints `no drift` and exits 0. `pnpm --filter @ditto/web exec vitest run src/lib/sandbox-archive.test.ts` passes. `pnpm typecheck` exits 0.

### 2. Owned branch at creation
Implement design point 2. In `product-commands.worker.test.ts`, extend the earliest test that creates a fresh candidate session (search for `'Synthetic session'` or the first `prompt` submission) with a read of `workspace_sessions.branchName` and expect `` `ditto/${sessionId}` ``.

Verify: `pnpm --filter @ditto/credential-tests exec vitest run src/product-commands.worker.test.ts` passes.

### 3. Baseline source and GitHub deps (product)
Implement design points 3 and 4.

`candidate-branch-fetch.test.ts` (web vitest) mocks `#/lib/github-app` the way `project-seed.test.ts:27-32` does, with a fake D1 `prepare/bind/first`. Assert:
- `mintToken("acme/app")` reads the installation for the scope's project and passes `{ repositories: ["app"] }`;
- a project with a different `githubRepo`, another user, or a null installation makes every method throw, and no mint call happens;
- `branchExists` maps a 404 to `false` and rethrows a 500;
- `defaultBranch` returns `default_branch`.

`candidate-baseline.worker.test.ts` (credential worker, in the style of `candidate-branch-fetch.worker.test.ts`, which seeds `projects`, `workspace_sessions`, `sandbox_identities` and `candidate_workspace_claims` with raw SQL) inserts a `project_seeds` row and an `archives` row. Assert:
1. An owned session with a branch, a ready seed and a measured archive returns `{ branch, seed }`. `seed` equals the archive row's `objectKey`, `byteCount`, `extractedBytes` and `digest`, plus the seed's `sourceCommit`, and its `compatibilityKey` is `ARCHIVE_COMPATIBILITY_KEY`, not the seed's build key.
2. It returns `not_owned` (another user, retired identity, ownerVersion 2), `continuation_unsupported`, `branch_missing`, `seed_unavailable` (pending seed; failed seed; archive `abandoned`; archive owned by another project), `seed_unmeasured` (NULL `extractedBytes`) and `seed_incompatible` (wrong `compatibilityKey`).
3. Nothing in the result contains the installation id or any token.

Add the new file to `credentials:verify` in the root `package.json`.

Verify: `pnpm --filter @ditto/web exec vitest run src/lib/candidate-branch-fetch.test.ts` passes. `pnpm --filter @ditto/credential-tests exec vitest run src/candidate-baseline.worker.test.ts` passes. `pnpm --filter @ditto/credential-tests typecheck` exits 0.

### 4. Port and fixture product
Implement design point 5. On `CandidateFixtureProduct`, `readCandidateBaselineSource(scope)` returns `readCandidateBaselineSource(this.env.DB, parseCandidateRuntimeScope(scope))`.

Verify: `pnpm --filter @ditto/credential-tests typecheck` and `pnpm --filter @ditto/runtime typecheck` exit 0.

### 5. Runtime host method and hooks
Implement design points 6 to 8. In `pi-durable-execution.test.ts`, add a test, with no change to the harness's existing `baseline()` helper:
- (a) `host.establishCandidateBaseline({ seed: await seed(composed.store), branch: "b" })` returns `published`, and a queued prompt then dispatches a tool, mirroring the existing test at `:409`;
- (b) a second call returns `{ status: "deferred", reason: "baseline_exists" }` and runs no further sandbox command;
- (c) after the host is sealed or yields, the method returns `deferred`/`unavailable` without calling the restorer.

Verify: `pnpm --filter @ditto/runtime exec vitest run src/pi-durable-execution.test.ts src/pi-durable-checkpoints.test.ts src/pi-durable-restore.test.ts src/pi-durable-workspace-actions.test.ts` passes. `pnpm --filter @ditto/runtime typecheck` exits 0.

**STOP** if `PiDurableHost` has no `sealed`/`storageBarrier`/`denied` fields with the meaning `workspaceAction` relies on, or if starting a non-awaited publish from `open` deadlocks an existing test, for example because `activate` awaits `opening` while the publish needs `activate`.

### 6. Full gates
Run Checks below.

## Checks

```sh
pnpm db:drift
pnpm typecheck
pnpm check
pnpm runtime:verify
pnpm credentials:verify
pnpm runner:verify
pnpm --filter @ditto/web exec vitest run src/lib/sandbox-archive.test.ts src/lib/candidate-branch-fetch.test.ts src/lib/project-seed.test.ts
pnpm --filter @ditto/credential-tests exec vitest run src/candidate-baseline.worker.test.ts src/candidate-branch-fetch.worker.test.ts src/product-commands.worker.test.ts
git diff f025d17 --stat -- alchemy.run.ts packages/runtime-contracts apps/web/src/lib/sandbox-authority.ts apps/web/src/lib/sandbox-egress-broker.ts apps/web/src/lib/privileged-git.ts   # expect empty
git diff f025d17 -- apps/web/migrations/0000_*.sql apps/web/migrations/00[01]*.sql apps/web/migrations/002[0-7]*.sql   # expect empty: no earlier migration touched
```

Known flakes: the "Isolated storage failed" error in combined `credentials:verify` on WSL. Each part must then pass alone; record it. The `runtime:verify` "streams long document tails" timeout belongs to 026; record it if it appears.

Write `plans/evidence/030-seed-branch-handoff.md` in the `plans/README.md` "Evidence format". Include the generated migration's file name and full SQL.

## Stop conditions

- `db:generate` emits more than the one `ADD` column, or `db:drift` reports drift afterwards.
- A change to `packages/runtime-contracts`, `alchemy.run.ts`, `sandbox-authority.ts`, `sandbox-egress-broker.ts` or `privileged-git.ts` seems needed.
- Any path would put the installation token or installation id into a runtime response, the sandbox, a log or an artifact.
- The seed's `archives.compatibilityKey` is not `ARCHIVE_COMPATIBILITY_KEY` for seeds built by current code. That would mean the seed format and the runtime format differ.
- A test needs a raised deadline, a skip or a retry.

## Done

- `pnpm db:drift` prints `no drift` with the new column and its generated migration.
- A fresh candidate session's `workspace_sessions.branchName` is `ditto/<sessionId>`.
- `readCandidateBaselineSource` returns a strictly parsed `ArchiveArtifactV1` for a measured ready seed and each listed denial otherwise (Step 3).
- `candidateGitHubDeps` mints tokens only for the scope's own project installation (Step 3).
- `PiDurableHost.establishCandidateBaseline` publishes once and defers afterwards (Step 5).
- `PiDurableExecutionSession` supplies `sessionBranch()` from the product record and starts the baseline on activation. Typecheck covers this; no test runs the class (see Limits).
- The files listed in Checks as unchanged are unchanged.

## Limits and follow-ups

- **No test runs `PiDurableExecutionSession` itself.** That is unchanged from 025/029: the runtime vitest has no `CandidateProduct` service binding. The hooks are covered by typecheck and by the host-method test. A runtime test entry with a fake `CandidateProduct` would close this; scope it with the deployment plan.
- **Deployment wiring** remains: a production `CandidatePrivateProduct` `WorkerEntrypoint` in the web app that calls `readCandidateBaselineSource` and `candidateGitHubDeps`, the `PiDurableExecutionSession`/`PiDurableCandidateSandbox` bindings, and `CANDIDATE_RECOVERY` bound to the same bucket as `BACKUP_BUCKET`.
- **Existing projects** have unmeasured seeds and are denied `seed_unmeasured` until re-imported. No backfill is planned.
- **Continuations** are denied `continuation_unsupported`. Their baseline from the source archive (016's limit) is still unbuilt.
- **Failed baselines** retry only on the next activation. There is no alarm-driven retry. An `unknown` recovery outcome still blocks the workspace permanently (011 limit).

## Maintenance

- The seed object is shared between the web `archives` lifecycle and runtime baselines. Any future web cleanup of `project_seed` archives must not delete an object while a candidate session's current or previous pair names it in `manifest.baseline`. Today seeds are deleted only with their project, which deletes its sessions too.
- `ditto/<sessionId>` is now set in two places (`session-command-candidate.ts` and `candidate-lifecycle.ts`). Keep them in step, or extract one helper when a third appears.
- `candidateGitHubDeps` resolves the installation per call. If the broker's request budget (`maxRequests = 16`) rises, consider caching the lookup per window.
