# Cut over and delete legacy paths

Status: TODO

Written against commit `62c99b4`. Complete plans 003 through 011 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Reconcile every completed plan and read all drift. Stop if any
prior plan is incomplete, blocked, or locally unverified.

## Goal

Leave one local application path. Delete shared project sandboxes, credential
injection, provider data, stock backups, legacy worktrees, callback JWTs, and
transition schema. Reset pre-launch project and workspace data. Update every
durable document to describe the implemented system and keep production status
deferred.

## Preconditions

Do not start until every prior plan passes its narrow tests and `pnpm verify`.
Run these searches first:

```bash
rg -n "DITTO_PI_CREDENTIAL|DITTO_GIT_CALLBACK|x-access-token|createBackup|restoreBackup|providerAuth|aiProviderCredentials|providerAuthAttempts|project sandbox|session worktree" apps/web/src packages/sandbox-runner/src alchemy.run.ts Dockerfile docs README.md CONTEXT.md
```

Classify every match. Stop if any old source path still handles a live request.

## Files in scope

- `apps/web/src/db/schema.ts`, destructive pre-launch migration, and Drizzle
  metadata
- remaining legacy project sandbox, backup, worktree, provider, JWT, and
  privileged-launcher modules and tests
- all routes, routers, components, and generated route output that retain an
  obsolete path
- `alchemy.run.ts`, `Dockerfile`, root and runner package files
- `README.md`, `PRODUCT.md`, `CONTEXT.md`
- all affected `docs/architecture/` documents
- `docs/specs/platform-credential-broker.md`
- a new ADR only if the final implementation introduced a costly, surprising
  decision not already recorded by the spec

Do not deploy, migrate a production database, delete a production R2 object, or
run production validation in this plan.

## Schema and data cutover

The application is pre-launch, so use one explicit destructive local migration:

1. Delete provider credential and provider-auth-attempt rows.
2. Delete pre-launch workspace sessions, messages, queued work, recovery rows,
   project seeds, and projects in foreign-key-safe order as required by the
   approved reset.
3. Preserve permanent sandbox identity tombstones and cleanup retry rows until
   their cleanup contracts say they may be retained independently. If the reset
   must delete them locally, record that the reset is a development-only
   exception and never use it as the production deletion path.
4. Drop `ai_provider_credentials` and `provider_auth_attempts`.
5. Remove project-owned sandbox, backup, generation, preview-lock, and deletion
   columns.
6. Remove obsolete workspace path or worktree columns. Keep branch and base
   commit fields that remain part of the workspace-session domain.
7. Remove any temporary `legacy_project` archive owner kind.

Generate the migration with `pnpm db:generate`. Read the SQL. Confirm that it
does not drop auth, GitHub installation, environment-value, final authority,
seed, runtime, recovery, or queue data definitions by mistake.

## Source deletion

- Delete `project-sandbox.ts` and old `sandbox-backup.ts` if no final behavior
  remains in them.
- Delete shared-worktree implementation and tests after all callers use
  `WorkspaceRuntime`.
- Delete provider credential, auth, catalog, protocol, client, routes, UI, and
  runner commands.
- Delete callback JWT and public agent-Git route.
- Delete token-bearing privileged Git launcher code and redaction inputs that
  existed only for its installation token.
- Delete stock backup configuration and R2 access-key bindings. Keep only the
  Worker R2 binding.
- Remove `AI_CREDENTIALS_ENCRYPTION_KEY` from Alchemy, README, local environment
  requirements, and tests.
- Keep secret redaction for project environment values and recognized
  secret-shaped output. Do not delete it merely because platform credentials
  left the sandbox.

Apply the deletion test to every remaining module. If deleting a module removes
complexity instead of moving rules into callers, delete the pass-through.

## Documentation

Update:

- `CONTEXT.md` so a workspace session owns its sandbox and recovery lineage and
  a project owns an immutable seed
- architecture docs for Worker authority, sandbox egress, agent resources, Git,
  recovery, lifecycle, capacity, preview, and deletion
- README setup variables and operator requirements
- PRODUCT only where fixed-model behavior changes visible product scope
- the spec implementation audit and status

Set the spec status to local implementation complete with production validation
deferred only after every local gate passes. Record the implementation commit
and test date. Leave future production validation unchecked.

## Final local release gate

Run all narrow integration matrices from prior plans, then:

```bash
pnpm db:generate
pnpm verify
rg -n "DITTO_PI_CREDENTIAL|DITTO_GIT_CALLBACK|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|AI_CREDENTIALS_ENCRYPTION_KEY|createBackup|restoreBackup|providerAuth|project sandbox|session worktree" apps/web/src packages/sandbox-runner/src alchemy.run.ts Dockerfile README.md CONTEXT.md docs/architecture
git diff --check
git status --short
```

Expected result:

- `pnpm verify` exits 0.
- Searches return only migration history, historical explanation that is
  explicitly labeled, or tests that prove an obsolete value is absent.
- No generated artifact outside expected migration and route output is tracked.

Perform one clean local end-to-end run:

1. Import a private test repository.
2. Confirm the builder retires after creating a seed.
3. Create two workspace sessions and prove runtime isolation.
4. Run chat with each thinking level.
5. Commit and, if plan 009's feasibility gate passed, push and open a pull
   request.
6. Start preview, mutate during preview, force a checkpoint, and cold restore.
7. Archive one session and continue it as a new session.
8. Delete the project and confirm authority revocation precedes cleanup.
9. Inspect command environments and D1 records for forbidden platform
   credentials or sandbox capabilities.

## Done criteria

- The shipped local code has one runtime, credential, Git, and recovery path.
- Every required guarantee in the spec has a passing local test.
- Provider data and deployment secrets are absent.
- Project rows own seeds, not sandboxes or mutable backups.
- Workspace sessions own isolated runtimes and recovery lineages.
- The spec remains explicit that production validation has not run.

## Maintenance note

Use the final architecture docs as the review map for future runtime changes.
Keep the production-validation section open until the paid-plan tests run and
their results are recorded.

## Stop conditions

- If an old Worker version could run against the destructive schema in a real
  deployment, stop. Separate code removal and schema removal into ordered
  deployments before any future production cutover.
- If any local guarantee lacks an automated or repeatable integration test, do
  not mark local implementation complete.
- If a failed production assumption is discovered later, fix forward. Do not
  restore credential injection, signed R2 URLs, shared project sandboxes, or a
  public agent callback token.
