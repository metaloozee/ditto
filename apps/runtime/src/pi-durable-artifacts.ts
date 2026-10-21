import {
	ARCHIVE_COMPATIBILITY_KEY,
	ARCHIVE_FORMAT_VERSION,
	type ArchiveArtifactV1,
	type ArchiveLimits,
	type ArtifactFailureReason,
	DEFAULT_ARCHIVE_LIMITS,
	isGitObjectId,
	isSha256Hex,
} from "../../../packages/runtime-contracts/src/artifacts.js";

/**
 * Workspace recovery: capture and restore preparation under a runtime-granted
 * exclusive mutation scope. Every suboperation is admitted, rechecked and
 * settled in the recovery ledger. Recovery calls execution; execution never
 * calls recovery. Results are evidence only: publication and conversation
 * activation stay with the runtime.
 */

/** Effect class decides how a lost response is classified. */
export const RECOVERY_STEPS = {
	inspect: "observation",
	pack: "artifact",
	upload: "observation",
	discard: "artifact",
	download: "artifact",
	extract: "mutation",
	fetch: "mutation",
	// Workspace actions share the ledger, so they serialize with recovery.
	present: "observation",
	git_status: "observation",
	git_commit: "mutation",
	preview_start: "mutation",
	preview_stop: "mutation",
} as const;
export type RecoveryStep = keyof typeof RECOVERY_STEPS;

const STEP_DEADLINE_MS: Record<RecoveryStep, number> = {
	inspect: 30_000,
	pack: 10 * 60_000,
	upload: 10 * 60_000,
	discard: 30_000,
	download: 10 * 60_000,
	extract: 10 * 60_000,
	fetch: 5 * 60_000,
	present: 30_000,
	git_status: 60_000,
	git_commit: 2 * 60_000,
	preview_start: 2 * 60_000,
	preview_stop: 60_000,
};

export type RecoveryAuthority = {
	epoch: number;
	generation: number;
	/** No run, effect or other writer is active. */
	quiescent: boolean;
	blocked: boolean;
};
export type MutationScope = {
	id: string;
	purpose: "capture" | "restore" | "sync" | "workspace";
	epoch: number;
	generation: number;
};
export type ArtifactPermit = {
	operation: string;
	scope: string;
	step: RecoveryStep;
	epoch: number;
	generation: number;
	deadlineAt: number;
};

export class RecoveryDenied extends Error {
	constructor(
		readonly reason: "scope_denied" | "authority_revoked" | "outcome_unknown",
		message: string,
	) {
		super(message);
		this.name = "RecoveryDenied";
	}
}

/**
 * A known failure: the step did not run, or ran and reported a defined error.
 * `untouched` means the workspace was verifiably not changed.
 */
export class ArtifactStepRejected extends Error {
	constructor(
		readonly reason: ArtifactFailureReason,
		message: string,
		readonly untouched = false,
	) {
		super(message);
		this.name = "ArtifactStepRejected";
	}
}

type SqlCursor<T> = { toArray(): T[] };
export type RecoveryStorage = {
	sql: {
		exec<T extends Record<string, SqlStorageValue>>(
			query: string,
			...bindings: unknown[]
		): SqlCursor<T>;
	};
	transactionSync<T>(closure: () => T): T;
};

type OperationRow = {
	id: string;
	scope: string;
	step: string;
	epoch: number;
	generation: number;
	deadline: number;
	state: string;
	object_key: string | null;
};

export type RecoveryLedger = ReturnType<typeof createRecoveryLedger>;

/** Runtime-owned admission for recovery suboperations, in DO SQLite. */
export function createRecoveryLedger(
	storage: RecoveryStorage,
	deps: {
		authority(): RecoveryAuthority;
		now(): number;
		id(): string;
	},
) {
	const sql = storage.sql;
	sql.exec(
		"CREATE TABLE IF NOT EXISTS recovery_scopes (id TEXT PRIMARY KEY, purpose TEXT NOT NULL, epoch INTEGER NOT NULL, generation INTEGER NOT NULL, held INTEGER UNIQUE CHECK (held IS NULL OR held = 1))",
	);
	sql.exec(
		"CREATE TABLE IF NOT EXISTS recovery_operations (id TEXT PRIMARY KEY, scope TEXT NOT NULL REFERENCES recovery_scopes(id), step TEXT NOT NULL, epoch INTEGER NOT NULL, generation INTEGER NOT NULL, deadline INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('admitted','completed','failed','unknown')), object_key TEXT, cleaned INTEGER NOT NULL DEFAULT 0 CHECK (cleaned IN (0,1)))",
	);

	const held = (scope: string) =>
		sql
			.exec<{ id: string; epoch: number; generation: number }>(
				"SELECT id, epoch, generation FROM recovery_scopes WHERE id = ? AND held = 1",
				scope,
			)
			.toArray()[0];
	const count = (query: string, ...bindings: unknown[]) =>
		sql.exec<{ n: number }>(query, ...bindings).toArray()[0]?.n ?? 0;
	const assertCurrent = (scope: { epoch: number; generation: number }) => {
		const authority = deps.authority();
		if (
			authority.blocked ||
			!authority.quiescent ||
			authority.epoch !== scope.epoch ||
			authority.generation !== scope.generation
		)
			throw new RecoveryDenied(
				"authority_revoked",
				"Recovery scope authority is no longer current",
			);
		if (
			count(
				"SELECT count(*) AS n FROM recovery_operations WHERE state = 'unknown'",
			)
		)
			throw new RecoveryDenied(
				"outcome_unknown",
				"An unknown recovery outcome blocks admission",
			);
	};

	return {
		/** Exclusive mutation ownership; one held scope at a time. */
		acquire(purpose: MutationScope["purpose"]): MutationScope {
			return storage.transactionSync(() => {
				const authority = deps.authority();
				if (!authority.quiescent || authority.blocked)
					throw new RecoveryDenied(
						"scope_denied",
						"Workspace is not quiescent",
					);
				if (
					count("SELECT count(*) AS n FROM recovery_scopes WHERE held = 1") ||
					count(
						"SELECT count(*) AS n FROM recovery_operations WHERE state IN ('admitted','unknown')",
					)
				)
					throw new RecoveryDenied(
						"scope_denied",
						"Another mutation scope is held or unresolved",
					);
				const scope: MutationScope = {
					id: deps.id(),
					purpose,
					epoch: authority.epoch,
					generation: authority.generation,
				};
				sql.exec(
					"INSERT INTO recovery_scopes (id, purpose, epoch, generation, held) VALUES (?, ?, ?, ?, 1)",
					scope.id,
					scope.purpose,
					scope.epoch,
					scope.generation,
				);
				return scope;
			});
		},
		admit(
			scope: MutationScope,
			step: RecoveryStep,
			objectKey: string | null = null,
		): ArtifactPermit {
			return storage.transactionSync(() => {
				const row = held(scope.id);
				if (!row)
					throw new RecoveryDenied("scope_denied", "Recovery scope not held");
				assertCurrent(row);
				if (
					count(
						"SELECT count(*) AS n FROM recovery_operations WHERE scope = ? AND state = 'admitted'",
						scope.id,
					)
				)
					throw new RecoveryDenied(
						"scope_denied",
						"Recovery steps run one at a time",
					);
				const permit: ArtifactPermit = {
					operation: deps.id(),
					scope: scope.id,
					step,
					epoch: row.epoch,
					generation: row.generation,
					deadlineAt: deps.now() + STEP_DEADLINE_MS[step],
				};
				sql.exec(
					"INSERT INTO recovery_operations (id, scope, step, epoch, generation, deadline, state, object_key) VALUES (?, ?, ?, ?, ?, ?, 'admitted', ?)",
					permit.operation,
					scope.id,
					step,
					permit.epoch,
					permit.generation,
					permit.deadlineAt,
					objectKey,
				);
				return permit;
			});
		},
		/** Recheck after asynchronous preparation, before dispatch. */
		check(permit: ArtifactPermit) {
			const row = sql
				.exec<OperationRow>(
					"SELECT * FROM recovery_operations WHERE id = ?",
					permit.operation,
				)
				.toArray()[0];
			if (!row || row.state !== "admitted" || !held(permit.scope))
				throw new RecoveryDenied("scope_denied", "Recovery step not admitted");
			assertCurrent(row);
			if (deps.now() >= row.deadline)
				throw new RecoveryDenied(
					"authority_revoked",
					"Recovery step deadline passed",
				);
		},
		settle(permit: ArtifactPermit, state: "completed" | "failed" | "unknown") {
			sql.exec(
				"UPDATE recovery_operations SET state = ? WHERE id = ? AND state = 'admitted'",
				state,
				permit.operation,
			);
		},
		/** An unknown outcome keeps the scope held, which blocks later scopes. */
		release(scope: MutationScope): "released" | "blocked" {
			return storage.transactionSync(() => {
				if (
					count(
						"SELECT count(*) AS n FROM recovery_operations WHERE scope = ? AND state IN ('admitted','unknown')",
						scope.id,
					)
				)
					return "blocked";
				sql.exec(
					"UPDATE recovery_scopes SET held = NULL WHERE id = ?",
					scope.id,
				);
				return "released";
			});
		},
		/**
		 * After a restart, an operation still marked admitted has no live caller.
		 * A lost mutation becomes unknown; anything else failed.
		 */
		recover() {
			storage.transactionSync(() => {
				for (const row of sql
					.exec<OperationRow>(
						"SELECT * FROM recovery_operations WHERE state = 'admitted'",
					)
					.toArray())
					sql.exec(
						"UPDATE recovery_operations SET state = ? WHERE id = ?",
						RECOVERY_STEPS[row.step as RecoveryStep] === "mutation"
							? "unknown"
							: "failed",
						row.id,
					);
				sql.exec(
					"UPDATE recovery_scopes SET held = NULL WHERE held = 1 AND id NOT IN (SELECT scope FROM recovery_operations WHERE state = 'unknown')",
				);
			});
		},
		/** True once a workspace mutation was admitted in the scope. */
		mutated(scope: string): boolean {
			return (
				count(
					"SELECT count(*) AS n FROM recovery_operations WHERE scope = ? AND step IN ('extract','fetch')",
					scope,
				) > 0
			);
		},
		/** Rechecks a held scope without admitting a step. */
		confirm(scope: MutationScope) {
			const row = held(scope.id);
			if (!row)
				throw new RecoveryDenied("scope_denied", "Recovery scope not held");
			assertCurrent(row);
		},
		/** Marks a completed upload unreferenced so cleanup deletes it. */
		orphan(objectKey: string) {
			sql.exec(
				"UPDATE recovery_operations SET state = 'failed' WHERE object_key = ? AND step = 'upload'",
				objectKey,
			);
		},
		/** Object keys of uploads that never produced verified evidence. */
		orphans(): string[] {
			return sql
				.exec<{ object_key: string }>(
					"SELECT object_key FROM recovery_operations WHERE step = 'upload' AND state = 'failed' AND cleaned = 0 AND object_key IS NOT NULL",
				)
				.toArray()
				.map((row) => row.object_key);
		},
		cleaned(objectKey: string) {
			sql.exec(
				"UPDATE recovery_operations SET cleaned = 1 WHERE object_key = ? AND state = 'failed'",
				objectKey,
			);
		},
	};
}

export type ArchiveMeasurement = {
	compressedBytes: number;
	extractedBytes: number;
	digest: string;
};

/**
 * Narrow typed execution operations on fixed sandbox paths. Each receives only
 * its permit and bounded values: no object key, URL, bucket or credential.
 */
export interface ArtifactExecution {
	inspect(permit: ArtifactPermit): Promise<{ head: string }>;
	pack(
		permit: ArtifactPermit,
		limits: ArchiveLimits,
	): Promise<ArchiveMeasurement>;
	readArchive(permit: ArtifactPermit): Promise<ReadableStream<Uint8Array>>;
	discardArchive(permit: ArtifactPermit): Promise<void>;
	writeArchive(
		permit: ArtifactPermit,
		body: ReadableStream<Uint8Array>,
	): Promise<void>;
	/** Extracts only when the temp file still has the expected digest. */
	extract(
		permit: ArtifactPermit,
		limits: ArchiveLimits,
		expectedDigest: string,
	): Promise<ArchiveMeasurement>;
	fetchBranch(
		permit: ArtifactPermit,
		request: { window: string; ref: string },
	): Promise<{ head: string }>;
}

/** The runtime Worker's R2 binding, narrowed to fixed-length streams. */
export interface ArtifactStore {
	put(
		key: string,
		body: ReadableStream<Uint8Array>,
		length: number,
	): Promise<void>;
	get(
		key: string,
	): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
	delete(key: string): Promise<void>;
}

/** Product-side fresh authority for the owned workspace branch. */
export interface BranchSyncAuthority {
	open(request: {
		operation: string;
		branch: string;
	}): Promise<{ window: string; ref: string } | { denied: string }>;
	close(window: string): Promise<void>;
}

type WorkspaceEffect = "unchanged" | "unusable" | "unknown";
export type RecoveryFailure = {
	status: "failed";
	reason: ArtifactFailureReason;
	step: RecoveryStep | null;
	workspace: WorkspaceEffect;
};
export type CaptureResult =
	| { status: "verified"; artifact: ArchiveArtifactV1 }
	| RecoveryFailure;
export type RestoreResult =
	| { status: "verified"; artifact: ArchiveArtifactV1; head: string }
	| RecoveryFailure;
export type SyncResult = { status: "verified"; head: string } | RecoveryFailure;

class StepFailure extends Error {
	constructor(readonly failure: RecoveryFailure) {
		super(failure.reason);
	}
}

function measureStream(
	source: ReadableStream<Uint8Array>,
	maxBytes: number,
): {
	readable: ReadableStream<Uint8Array>;
	result(): Promise<{ byteCount: number; digest: string }>;
} {
	// Workers expose DigestStream on crypto; the WebWorker lib types omit it.
	const hash = new (
		crypto as unknown as { DigestStream: typeof DigestStream }
	).DigestStream("SHA-256");
	const writer = hash.getWriter();
	let byteCount = 0;
	const readable = source.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			async transform(chunk, controller) {
				byteCount += chunk.byteLength;
				if (byteCount > maxBytes)
					throw new ArtifactStepRejected(
						"integrity_failed",
						"Archive stream exceeds its declared length",
					);
				await writer.write(chunk);
				controller.enqueue(chunk);
			},
			async flush() {
				await writer.close();
			},
		}),
	);
	return {
		readable,
		async result() {
			const bytes = new Uint8Array(await hash.digest);
			return {
				byteCount,
				digest: [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""),
			};
		},
	};
}

function validMeasurement(
	value: ArchiveMeasurement,
	limits: ArchiveLimits,
): boolean {
	return (
		Number.isSafeInteger(value.compressedBytes) &&
		Number.isSafeInteger(value.extractedBytes) &&
		value.compressedBytes >= 0 &&
		value.extractedBytes >= 0 &&
		value.compressedBytes <= limits.maxCompressedBytes &&
		value.extractedBytes <= limits.maxExtractedBytes &&
		isSha256Hex(value.digest)
	);
}

export function createWorkspaceRecovery(deps: {
	ledger: RecoveryLedger;
	execution: ArtifactExecution;
	store: ArtifactStore;
	branch?: BranchSyncAuthority;
	workspaceSessionId: string;
	limits?: ArchiveLimits;
}) {
	const limits = deps.limits ?? DEFAULT_ARCHIVE_LIMITS;
	const fail = (
		reason: ArtifactFailureReason,
		step: RecoveryStep | null,
		workspace: WorkspaceEffect = "unchanged",
	): RecoveryFailure => ({ status: "failed", reason, step, workspace });

	/**
	 * Admit, run and settle one suboperation. Once any workspace mutation was
	 * admitted in the scope, every later failure leaves the workspace unusable.
	 */
	async function step<T>(
		scope: MutationScope,
		name: RecoveryStep,
		run: (permit: ArtifactPermit) => Promise<T>,
		options: { objectKey?: string } = {},
	): Promise<T> {
		const untouched: WorkspaceEffect = deps.ledger.mutated(scope.id)
			? "unusable"
			: "unchanged";
		let permit: ArtifactPermit;
		try {
			permit = deps.ledger.admit(scope, name, options.objectKey ?? null);
		} catch (error) {
			if (error instanceof RecoveryDenied)
				throw new StepFailure(fail(error.reason, name, untouched));
			throw error;
		}
		try {
			const value = await run(permit);
			deps.ledger.settle(permit, "completed");
			return value;
		} catch (error) {
			if (error instanceof StepFailure) {
				deps.ledger.settle(permit, "failed");
				throw error;
			}
			// A failed recheck happens before dispatch.
			if (error instanceof RecoveryDenied) {
				deps.ledger.settle(permit, "failed");
				throw new StepFailure(fail(error.reason, name, untouched));
			}
			if (error instanceof ArtifactStepRejected) {
				deps.ledger.settle(permit, "failed");
				throw new StepFailure(
					fail(
						error.reason,
						name,
						!error.untouched && RECOVERY_STEPS[name] === "mutation"
							? "unusable"
							: untouched,
					),
				);
			}
			if (RECOVERY_STEPS[name] === "mutation") {
				deps.ledger.settle(permit, "unknown");
				throw new StepFailure(fail("outcome_unknown", name, "unknown"));
			}
			deps.ledger.settle(permit, "failed");
			throw new StepFailure(fail("execution_failed", name, untouched));
		}
	}
	function current(
		scope: MutationScope,
		step: RecoveryStep | null,
	): RecoveryFailure | undefined {
		try {
			deps.ledger.confirm(scope);
		} catch (error) {
			if (!(error instanceof RecoveryDenied)) throw error;
			return fail(
				error.reason,
				step,
				deps.ledger.mutated(scope.id) ? "unusable" : "unchanged",
			);
		}
	}
	async function settled<T extends { status: string }>(
		work: () => Promise<T>,
	): Promise<T | RecoveryFailure> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof StepFailure) return error.failure;
			throw error;
		}
	}

	return {
		/** Inspect, pack and upload; verified only when the stored bytes match the packed archive. */
		capture(scope: MutationScope): Promise<CaptureResult> {
			return settled(async () => {
				const { head } = await step(scope, "inspect", async (permit) => {
					const result = await deps.execution.inspect(permit);
					if (!isGitObjectId(result.head))
						throw new ArtifactStepRejected(
							"verification_failed",
							"Workspace HEAD is invalid",
						);
					return result;
				});
				const packed = await step(scope, "pack", async (permit) => {
					const result = await deps.execution.pack(permit, limits);
					if (!validMeasurement(result, limits))
						throw new ArtifactStepRejected(
							"limit_exceeded",
							"Packed archive is outside its limits",
						);
					return result;
				});
				const objectKey = `workspace/${deps.workspaceSessionId}/${scope.id}/${crypto.randomUUID()}.tar.gz`;
				await step(
					scope,
					"upload",
					async (permit) => {
						const source = await deps.execution.readArchive(permit);
						try {
							deps.ledger.check(permit);
						} catch (error) {
							await source.cancel().catch(() => undefined);
							throw error;
						}
						const measured = measureStream(source, packed.compressedBytes);
						try {
							await deps.store.put(
								objectKey,
								measured.readable,
								packed.compressedBytes,
							);
						} catch (error) {
							if (error instanceof ArtifactStepRejected) throw error;
							throw new ArtifactStepRejected(
								"store_failed",
								"Archive upload failed",
							);
						}
						const stored = await measured.result();
						if (
							stored.byteCount !== packed.compressedBytes ||
							stored.digest !== packed.digest
						)
							throw new ArtifactStepRejected(
								"integrity_failed",
								"Uploaded archive does not match the packed archive",
							);
					},
					{ objectKey },
				);
				// The temp file holds no authority; a failed discard does not void the artifact.
				await settled(async () => {
					await step(scope, "discard", (permit) =>
						deps.execution.discardArchive(permit),
					);
					return { status: "discarded" };
				});
				// Evidence carries no epoch, so stale authority must not return it.
				const stale = current(scope, null);
				if (stale) {
					deps.ledger.orphan(objectKey);
					return stale;
				}
				return {
					status: "verified" as const,
					artifact: {
						version: 1 as const,
						kind: "workspace_archive" as const,
						formatVersion: ARCHIVE_FORMAT_VERSION,
						compatibilityKey: ARCHIVE_COMPATIBILITY_KEY,
						objectKey,
						byteCount: packed.compressedBytes,
						extractedBytes: packed.extractedBytes,
						digest: packed.digest,
						sourceCommit: head,
					},
				};
			});
		},

		/** Download, extract and verify. Any failure after extraction leaves the workspace unusable. */
		restore(
			scope: MutationScope,
			artifact: ArchiveArtifactV1,
		): Promise<RestoreResult> {
			return settled(async () => {
				if (
					artifact.formatVersion !== ARCHIVE_FORMAT_VERSION ||
					artifact.compatibilityKey !== ARCHIVE_COMPATIBILITY_KEY
				)
					return fail("incompatible", null);
				if (
					artifact.byteCount > limits.maxCompressedBytes ||
					artifact.extractedBytes > limits.maxExtractedBytes
				)
					return fail("limit_exceeded", null);
				await step(scope, "download", async (permit) => {
					let object: Awaited<ReturnType<ArtifactStore["get"]>>;
					try {
						object = await deps.store.get(artifact.objectKey);
					} catch {
						throw new ArtifactStepRejected(
							"store_failed",
							"Archive download failed",
						);
					}
					if (!object)
						throw new ArtifactStepRejected(
							"artifact_missing",
							"Archive object is missing",
						);
					if (object.size !== artifact.byteCount) {
						await object.body.cancel().catch(() => undefined);
						throw new ArtifactStepRejected(
							"integrity_failed",
							"Archive object length does not match",
						);
					}
					try {
						deps.ledger.check(permit);
					} catch (error) {
						await object.body.cancel().catch(() => undefined);
						throw error;
					}
					const measured = measureStream(object.body, artifact.byteCount);
					await deps.execution.writeArchive(permit, measured.readable);
					const written = await measured.result();
					if (
						written.byteCount !== artifact.byteCount ||
						written.digest !== artifact.digest
					)
						throw new ArtifactStepRejected(
							"integrity_failed",
							"Downloaded archive does not match its evidence",
						);
				});
				await step(scope, "extract", async (permit) => {
					const result = await deps.execution.extract(
						permit,
						limits,
						artifact.digest,
					);
					if (
						!validMeasurement(result, limits) ||
						result.compressedBytes !== artifact.byteCount ||
						result.digest !== artifact.digest
					)
						throw new ArtifactStepRejected(
							"verification_failed",
							"Extracted archive does not match its evidence",
						);
				});
				const { head } = await step(scope, "inspect", async (permit) => {
					const result = await deps.execution.inspect(permit);
					if (result.head !== artifact.sourceCommit)
						throw new ArtifactStepRejected(
							"verification_failed",
							"Restored HEAD does not match the artifact",
						);
					return result;
				});
				return (
					current(scope, null) ?? {
						status: "verified" as const,
						artifact,
						head,
					}
				);
			});
		},

		/**
		 * Baseline branch synchronization after a seed restore. Runtime admission
		 * comes first, then product authority, then a recheck before any fetch.
		 */
		syncBranch(scope: MutationScope, branch: string): Promise<SyncResult> {
			return settled(async () => {
				const authority = deps.branch;
				if (!authority) return fail("authority_denied", "fetch");
				let window: string | undefined;
				try {
					const synced = await step(scope, "fetch", async (permit) => {
						let grant: Awaited<ReturnType<BranchSyncAuthority["open"]>>;
						try {
							grant = await authority.open({
								operation: permit.operation,
								branch,
							});
						} catch {
							throw new ArtifactStepRejected(
								"authority_denied",
								"Branch authority unavailable",
								true,
							);
						}
						if ("denied" in grant)
							throw new ArtifactStepRejected(
								"authority_denied",
								"Branch authority denied",
								true,
							);
						window = grant.window;
						deps.ledger.check(permit);
						const result = await deps.execution.fetchBranch(permit, {
							window: grant.window,
							ref: grant.ref,
						});
						if (!isGitObjectId(result.head))
							throw new Error("Fetched HEAD is malformed");
						return { status: "verified" as const, head: result.head };
					});
					return current(scope, null) ?? synced;
				} finally {
					if (window !== undefined)
						await authority.close(window).catch(() => undefined);
				}
			});
		},

		/** Delete uploads that never became verified evidence. */
		async cleanup(): Promise<{ cleaned: number }> {
			let cleaned = 0;
			for (const key of deps.ledger.orphans()) {
				try {
					await deps.store.delete(key);
					deps.ledger.cleaned(key);
					cleaned += 1;
				} catch {
					// Retried on the next cleanup.
				}
			}
			return { cleaned };
		},
	};
}

/** Image-owned archive command at a fixed path; only numeric limits cross. */
export const ARCHIVE_CLI_PATH = "/opt/ditto-runner/dist/archive-cli.js";
export const ARCHIVE_TEMP_PATH = "/tmp/ditto-workspace-archive.tar.gz";
const WORKSPACE_PATH = "/workspace";
/** Read-only Git with no repository hooks, config includes or helpers. */
const CLOSED_GIT = `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/nonexistent GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 git -c core.hooksPath=/dev/null -c core.fsmonitor=false -C ${WORKSPACE_PATH}`;

export type ArtifactSandbox = {
	exec(
		command: string,
		options: { timeout: number },
	): Promise<{ exitCode: number; stdout: string }>;
	readStream(path: string): Promise<ReadableStream<Uint8Array>>;
	writeStream(path: string, body: ReadableStream<Uint8Array>): Promise<void>;
};

function parseArchiveCli(
	stdout: string,
	action: "create" | "restore",
): ArchiveMeasurement {
	const line = stdout.trim().split("\n").at(-1);
	let value: unknown;
	try {
		value = JSON.parse(line ?? "");
	} catch {
		throw new Error("Archive command returned no result");
	}
	if (!value || typeof value !== "object")
		throw new Error("Archive command returned no result");
	const record = value as Record<string, unknown>;
	if (record.ok === false) {
		const code = typeof record.error === "string" ? record.error : "failed";
		if (code === "precheck_digest_mismatch")
			throw new ArtifactStepRejected(
				"integrity_failed",
				"Archive temp file changed before extraction",
				true,
			);
		if (code === "digest_mismatch")
			throw new ArtifactStepRejected(
				"integrity_failed",
				"Archive temp file changed after the workspace was cleared",
			);
		throw new ArtifactStepRejected(
			code.startsWith("limit_") ? "limit_exceeded" : "execution_failed",
			`Archive command failed (${code})`,
		);
	}
	if (
		record.ok !== true ||
		record.action !== action ||
		typeof record.compressedBytes !== "number" ||
		typeof record.extractedBytes !== "number" ||
		typeof record.digest !== "string"
	)
		throw new Error("Archive command returned an invalid result");
	return {
		compressedBytes: record.compressedBytes,
		extractedBytes: record.extractedBytes,
		digest: record.digest,
	};
}

/** Execution adapter for the Sandbox; branch fetch stays unavailable until brokered Git is composed. */
export function sandboxArtifactExecution(
	sandbox: ArtifactSandbox,
	now: () => number,
): ArtifactExecution {
	const timeout = (permit: ArtifactPermit) =>
		Math.max(1, permit.deadlineAt - now());
	const limitArgs = (limits: ArchiveLimits) =>
		[
			"--max-compressed-bytes",
			String(limits.maxCompressedBytes),
			"--max-extracted-bytes",
			String(limits.maxExtractedBytes),
			"--max-disk-percent",
			String(limits.maxDiskPercent),
		].join(" ");
	return {
		async inspect(permit) {
			const result = await sandbox.exec(
				`${CLOSED_GIT} rev-parse --verify 'HEAD^{commit}'`,
				{ timeout: timeout(permit) },
			);
			if (result.exitCode !== 0)
				throw new ArtifactStepRejected(
					"verification_failed",
					"Workspace has no valid HEAD",
				);
			return { head: result.stdout.trim() };
		},
		async pack(permit, limits) {
			const result = await sandbox.exec(
				`node ${ARCHIVE_CLI_PATH} create ${limitArgs(limits)}`,
				{ timeout: timeout(permit) },
			);
			return parseArchiveCli(result.stdout, "create");
		},
		readArchive: () => sandbox.readStream(ARCHIVE_TEMP_PATH),
		async discardArchive(permit) {
			const result = await sandbox.exec(`rm -f -- ${ARCHIVE_TEMP_PATH}`, {
				timeout: timeout(permit),
			});
			if (result.exitCode !== 0)
				throw new ArtifactStepRejected(
					"execution_failed",
					"Archive temp file was not removed",
				);
		},
		writeArchive: (_permit, body) =>
			sandbox.writeStream(ARCHIVE_TEMP_PATH, body),
		async extract(permit, limits, expectedDigest) {
			if (!isSha256Hex(expectedDigest))
				throw new ArtifactStepRejected("integrity_failed", "Invalid digest");
			// The workspace is cleared only after the temp file still matches.
			const result = await sandbox.exec(
				`if echo '${expectedDigest}  ${ARCHIVE_TEMP_PATH}' | sha256sum -c --status; then find ${WORKSPACE_PATH} -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && node ${ARCHIVE_CLI_PATH} restore ${limitArgs(limits)} --expected-sha256 ${expectedDigest}; else echo '{"ok":false,"error":"precheck_digest_mismatch"}'; fi`,
				{ timeout: timeout(permit) },
			);
			return parseArchiveCli(result.stdout, "restore");
		},
		async fetchBranch() {
			throw new ArtifactStepRejected(
				"authority_denied",
				"Brokered branch fetch is not composed in the runtime",
				true,
			);
		},
	};
}

/** R2 binding adapter. Fixed-length bodies stream without buffering. */
export function r2ArtifactStore(bucket: R2Bucket): ArtifactStore {
	return {
		async put(key, body, length) {
			const fixed = new FixedLengthStream(length);
			const [piped, stored] = await Promise.allSettled([
				body.pipeTo(fixed.writable),
				bucket.put(key, fixed.readable),
			]);
			if (piped.status === "rejected") throw piped.reason;
			if (stored.status === "rejected") throw stored.reason;
		},
		async get(key) {
			const object = await bucket.get(key);
			return object ? { body: object.body, size: object.size } : null;
		},
		async delete(key) {
			await bucket.delete(key);
		},
	};
}
