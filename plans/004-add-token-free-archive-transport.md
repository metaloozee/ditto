# Add token-free archive transport

Status: TODO

Written against commit `62c99b4`. Complete plan 001 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in backup, R2, schema, and Sandbox transport code.
Stop if the archive limits or token-free R2 guarantee changed.

## Goal

Replace the stock production `createBackup()` and `restoreBackup()` path with a
deep archive module that streams between a sandbox and the Worker R2 binding.
No R2 credential, signed URL, object key, bucket mount, or bearer capability may
enter the sandbox.

## Current state

`apps/web/src/lib/sandbox-bootstrap.ts` delegates directly to the Sandbox SDK:

```ts
return await sandbox.createBackup(getSandboxBackupOptions(/* ... */));
```

The stock production implementation creates presigned R2 URLs for commands in
the sandbox. The current project row stores the SDK `DirectoryBackup` handle and
generation counters.

## Files in scope

- `apps/web/src/db/schema.ts`
- one generated migration and Drizzle metadata
- a new `apps/web/src/lib/sandbox-archive.ts` module and tests
- a small image-owned archive CLI under `packages/sandbox-runner/src` and tests
- `packages/sandbox-runner/package.json` and `Dockerfile` as required
- `apps/web/src/lib/sandbox-bootstrap.ts` and tests
- `apps/web/src/lib/sandbox-backup.ts` and tests
- `apps/web/src/lib/project-sandbox.ts` and tests
- `alchemy.run.ts`, only to remove stock presigning bindings after no caller
  needs them
- `README.md` and affected architecture docs

Do not move ownership from projects to workspace sessions yet. Do not implement
project seeds, preview deferral, or recovery fallback in this plan.

## Module interface

`sandbox-archive.ts` is the only module that knows R2 object keys. Give callers
this interface:

```ts
type SandboxArchive = {
	create(input: CreateArchiveInput): Promise<ArchiveRef>;
	restore(input: RestoreArchiveInput): Promise<RestoreResult>;
	delete(archiveId: string): Promise<void>;
};
```

`ArchiveRef` contains an opaque archive ID, format version, compatibility key,
byte count, digest, and generation. It does not contain an R2 object key. The
implementation stores the object key in D1.

Add an archive table that can later support `project_seed` and
`workspace_recovery` owners. A temporary `legacy_project` owner is acceptable
only while this plan still backs the current project workspace. Plan 012 must
remove that owner kind.

## Required implementation

1. The image-owned archive CLI creates a compressed archive at one fixed path.
   It rejects path overrides, traversal, symlinks that escape the workspace,
   sockets, device files, and archive recursion.
2. Apply the spec's compressed, extracted, and peak-disk limits before archive
   creation and extraction. Report only measured byte counts.
3. Stop or reject concurrent filesystem writers before creating an archive.
   For the legacy project path, reuse the existing project lifecycle lease and
   session workspace locks. Do not invent a second lock protocol.
4. Read the archive with RPC
   `sandbox.readFile(path, { encoding: "none" })`. Stream it directly into
   `env.BACKUP_BUCKET.put()` with a fixed length and checksum. Do not call
   `arrayBuffer()`, `text()`, or `json()` on archive data.
5. Persist the D1 archive row only after R2 accepts the stream, byte count, and
   checksum. Mark abandoned uploads for cleanup.
6. Restore by resolving the opaque archive ID in D1, reading the R2 object
   through the binding, and passing its stream to `sandbox.writeFile()` at one
   fixed temporary path.
7. Verify metadata, checksum, byte count, compatibility key, extracted size,
   Git state, and baked runner before declaring restore complete.
8. Delete the temporary archive on every path. Track failed R2 cleanup in D1
   for bounded retries. Never log keys or archive content.
9. Switch the current project backup caller to the new module. Remove calls to
   stock `createBackup()` and `restoreBackup()`.
10. After `rg` proves no stock backup path remains, remove
    `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `BACKUP_BUCKET_NAME` from
    Alchemy and environment docs. Keep the `BACKUP_BUCKET` binding.

Cloudflare requires RPC transport for binary streams larger than 32 MiB. Keep
`SANDBOX_TRANSPORT: "rpc"` in Alchemy.

## Tests

Add tests for:

- an archive larger than 32 MiB crosses the Worker as a stream
- neither command environment nor command text contains R2 configuration,
  object keys, signed URLs, or bearer values
- compressed, extracted, and peak-disk limits fail before exhaustion
- corrupt upload, corrupt restore, wrong length, and wrong digest fail closed
- stale generation completion cannot replace a newer stored archive
- a failed R2 write leaves no promoted D1 generation
- temporary files are deleted on success and failure
- cleanup retry rows are idempotent

Use bounded byte fixtures. Do not commit a large binary fixture.

## Verification

```bash
pnpm db:generate
pnpm --filter @ditto/web test -- src/lib/sandbox-archive.test.ts src/lib/project-sandbox.test.ts src/lib/sandbox-backup.test.ts
npm test --prefix packages/sandbox-runner -- src/archive.test.ts
rg -n "createBackup|restoreBackup|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|BACKUP_BUCKET_NAME" apps/web/src alchemy.run.ts README.md
pnpm typecheck
pnpm runner:verify
pnpm verify
```

Expected result: only migration history or an explicit rejection test mentions
the removed stock path and presigning configuration. All commands exit 0.

## Done criteria

- The sandbox never receives R2 authority or an object key.
- Archive bodies stay streamed through the Worker.
- Callers use opaque archive IDs through one module.
- Current project backup and restore still work locally.
- The old presigned production path is absent.

## Maintenance note

Treat archive format and compatibility-key changes as migrations. Keep restore
support for every retained current or previous generation until retention has
removed it.

## Stop conditions

- If R2 cannot validate a streaming checksum without buffering, stop and add a
  bounded streaming digest implementation. Do not trust a sandbox digest by
  itself.
- If extraction requires a privileged mount or a signed R2 URL inside the
  sandbox, stop. Use ordinary archive extraction at the fixed path.
- If a writer cannot be quiesced with an existing lease, stop and move that
  caller behind an exclusive runtime lease before backing it up.
