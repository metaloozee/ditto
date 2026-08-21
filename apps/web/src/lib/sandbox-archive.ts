import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { createDb } from "#/db";
import {
	type ARCHIVE_OWNER_KINDS,
	archives,
	workspaceSessions,
} from "#/db/schema";
import type { SessionPreviewDeps } from "#/lib/session-preview";
import { withSessionWorkspaceLock } from "#/lib/session-workspace-lock";
import { WORKSPACE_PATH } from "#/lib/workspace-policy";

export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_COMPATIBILITY_KEY = "ditto-workspace-archive-v1";
export const ARCHIVE_MAX_COMPRESSED_BYTES = 1024 * 1024 * 1024;
export const ARCHIVE_MAX_EXTRACTED_BYTES = 3 * 1024 * 1024 * 1024;
export const ARCHIVE_MAX_DISK_PERCENT = 70;
export const ARCHIVE_TEMP_PATH = "/tmp/ditto-workspace-archive.tar.gz";
export const ARCHIVE_CLI_PATH = "/opt/ditto-runner/dist/archive-cli.js";
export const ARCHIVE_CLEANUP_MAX_ATTEMPTS = 8;
export const ARCHIVE_RPC_STREAM_THRESHOLD_BYTES = 32 * 1024 * 1024;

const ARCHIVE_CLI_TIMEOUT_MS = 10 * 60 * 1000;
const TEMP_DELETE_TIMEOUT_MS = 30_000;
const WORKSPACE_CLEAR_TIMEOUT_MS = 120_000;
const RUNNER_HEALTH_TIMEOUT_MS = 10_000;
const RUNNER_CLI_PATH = "/opt/ditto-runner/dist/cli.js";
const RUNNER_PACKAGE_PATH = "/opt/ditto-runner/package.json";

type Db = ReturnType<typeof createDb>;
type ArchiveOwnerKind = (typeof ARCHIVE_OWNER_KINDS)[number];

export type ArchiveRef = {
	id: string;
	formatVersion: number;
	compatibilityKey: string;
	byteCount: number;
	digest: string;
	generation: number;
};

export type RestoreResult = {
	archive: ArchiveRef;
	extractedBytes: number;
};

export type ArchiveSandbox = {
	exec: (
		command: string,
		options?: {
			cwd?: string;
			timeout?: number;
			env?: Record<string, string>;
		},
	) => Promise<{
		success: boolean;
		stdout: string;
		stderr: string;
		exitCode: number;
	}>;
	readFile: (path: string, options?: { encoding?: string }) => Promise<unknown>;
	writeFile: (
		path: string,
		content: ReadableStream<Uint8Array> | string,
		options?: { encoding?: string },
	) => Promise<unknown>;
	exists: (path: string) => Promise<{ exists: boolean }>;
};

export type CreateArchiveInput = {
	sandbox: ArchiveSandbox;
	sandboxId: string;
	ownerKind: ArchiveOwnerKind;
	ownerId: string;
	userId: string;
	generation: number;
	quiesce?: boolean;
	limits?: ArchiveLimits;
};

export type RestoreArchiveInput = {
	sandbox: ArchiveSandbox;
	sandboxId: string;
	archiveId: string;
	limits?: ArchiveLimits;
};

export type ArchiveLimits = {
	maxCompressedBytes: number;
	maxExtractedBytes: number;
	maxDiskPercent: number;
};

export type SandboxArchive = {
	create(input: CreateArchiveInput): Promise<ArchiveRef>;
	restore(input: RestoreArchiveInput): Promise<RestoreResult>;
	delete(archiveId: string): Promise<void>;
};

type ArchiveRow = typeof archives.$inferSelect;

type CliSuccess = {
	ok: true;
	action: "create" | "restore";
	compressedBytes: number;
	extractedBytes: number;
	digest: string;
};

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function defaultLimits(limits?: ArchiveLimits): ArchiveLimits {
	return {
		maxCompressedBytes:
			limits?.maxCompressedBytes ?? ARCHIVE_MAX_COMPRESSED_BYTES,
		maxExtractedBytes: limits?.maxExtractedBytes ?? ARCHIVE_MAX_EXTRACTED_BYTES,
		maxDiskPercent: limits?.maxDiskPercent ?? ARCHIVE_MAX_DISK_PERCENT,
	};
}

function archiveObjectKey(
	ownerKind: ArchiveOwnerKind,
	ownerId: string,
	generation: number,
	archiveId: string,
): string {
	return `${ownerKind}/${ownerId}/${generation}/${archiveId}.tar.gz`;
}

function toArchiveRef(
	row: Pick<
		ArchiveRow,
		| "id"
		| "formatVersion"
		| "compatibilityKey"
		| "byteCount"
		| "digest"
		| "generation"
	>,
): ArchiveRef {
	return {
		id: row.id,
		formatVersion: row.formatVersion,
		compatibilityKey: row.compatibilityKey,
		byteCount: row.byteCount,
		digest: row.digest,
		generation: row.generation,
	};
}

function asUint8Array(chunk: unknown): Uint8Array {
	if (chunk instanceof Uint8Array) {
		return chunk;
	}
	if (chunk instanceof ArrayBuffer) {
		return new Uint8Array(chunk);
	}
	if (ArrayBuffer.isView(chunk)) {
		return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
	throw new Error("Archive stream chunk is not binary.");
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

/** Incremental SHA-256 so archive bodies are never buffered for hashing. */
class Sha256 {
	private readonly state = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
		0x1f83d9ab, 0x5be0cd19,
	]);
	private readonly buffer = new Uint8Array(64);
	private bufferLength = 0;
	private bytesHashed = 0;

	update(chunk: Uint8Array): void {
		this.bytesHashed += chunk.byteLength;
		let offset = 0;
		if (this.bufferLength > 0) {
			const take = Math.min(64 - this.bufferLength, chunk.byteLength);
			this.buffer.set(chunk.subarray(0, take), this.bufferLength);
			this.bufferLength += take;
			offset = take;
			if (this.bufferLength === 64) {
				this.compress(this.buffer);
				this.bufferLength = 0;
			}
		}
		while (offset + 64 <= chunk.byteLength) {
			this.compress(chunk.subarray(offset, offset + 64));
			offset += 64;
		}
		if (offset < chunk.byteLength) {
			this.buffer.set(chunk.subarray(offset));
			this.bufferLength = chunk.byteLength - offset;
		}
	}

	digest(): Uint8Array {
		const bitLength = this.bytesHashed * 8;
		this.buffer[this.bufferLength] = 0x80;
		this.bufferLength += 1;
		if (this.bufferLength > 56) {
			this.buffer.fill(0, this.bufferLength);
			this.compress(this.buffer);
			this.buffer.fill(0);
			this.bufferLength = 0;
		} else {
			this.buffer.fill(0, this.bufferLength, 56);
		}
		const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 64);
		view.setUint32(56, Math.floor(bitLength / 0x100000000), false);
		view.setUint32(60, bitLength >>> 0, false);
		this.compress(this.buffer);

		const out = new Uint8Array(32);
		const outView = new DataView(out.buffer);
		for (let index = 0; index < 8; index += 1) {
			outView.setUint32(index * 4, this.state[index] ?? 0, false);
		}
		return out;
	}

	private compress(block: Uint8Array): void {
		const k = SHA256_K;
		const w = new Uint32Array(64);
		for (let index = 0; index < 16; index += 1) {
			w[index] =
				((block[index * 4] ?? 0) << 24) |
				((block[index * 4 + 1] ?? 0) << 16) |
				((block[index * 4 + 2] ?? 0) << 8) |
				(block[index * 4 + 3] ?? 0);
		}
		for (let index = 16; index < 64; index += 1) {
			const s0 =
				rightRotate(w[index - 15] ?? 0, 7) ^
				rightRotate(w[index - 15] ?? 0, 18) ^
				((w[index - 15] ?? 0) >>> 3);
			const s1 =
				rightRotate(w[index - 2] ?? 0, 17) ^
				rightRotate(w[index - 2] ?? 0, 19) ^
				((w[index - 2] ?? 0) >>> 10);
			w[index] = ((w[index - 16] ?? 0) + s0 + (w[index - 7] ?? 0) + s1) >>> 0;
		}

		let a = this.state[0] ?? 0;
		let b = this.state[1] ?? 0;
		let c = this.state[2] ?? 0;
		let d = this.state[3] ?? 0;
		let e = this.state[4] ?? 0;
		let f = this.state[5] ?? 0;
		let g = this.state[6] ?? 0;
		let h = this.state[7] ?? 0;
		for (let index = 0; index < 64; index += 1) {
			const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
			const ch = (e & f) ^ (~e & g);
			const temp1 = (h + s1 + ch + (k[index] ?? 0) + (w[index] ?? 0)) >>> 0;
			const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (s0 + maj) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + temp1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) >>> 0;
		}
		this.state[0] = ((this.state[0] ?? 0) + a) >>> 0;
		this.state[1] = ((this.state[1] ?? 0) + b) >>> 0;
		this.state[2] = ((this.state[2] ?? 0) + c) >>> 0;
		this.state[3] = ((this.state[3] ?? 0) + d) >>> 0;
		this.state[4] = ((this.state[4] ?? 0) + e) >>> 0;
		this.state[5] = ((this.state[5] ?? 0) + f) >>> 0;
		this.state[6] = ((this.state[6] ?? 0) + g) >>> 0;
		this.state[7] = ((this.state[7] ?? 0) + h) >>> 0;
	}
}

const SHA256_K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rightRotate(value: number, amount: number): number {
	return ((value >>> amount) | (value << (32 - amount))) >>> 0;
}

function attachStreamingDigest(source: ReadableStream<Uint8Array>): {
	readable: ReadableStream<Uint8Array>;
	result: Promise<{ byteCount: number; digest: string }>;
} {
	const hasher = new Sha256();
	let byteCount = 0;
	let settle: (value: { byteCount: number; digest: string }) => void;
	let reject: (error: unknown) => void;
	const result = new Promise<{ byteCount: number; digest: string }>(
		(resolve, fail) => {
			settle = resolve;
			reject = fail;
		},
	);
	const transform = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			const bytes = asUint8Array(chunk);
			byteCount += bytes.byteLength;
			hasher.update(bytes);
			controller.enqueue(bytes);
		},
		flush() {
			settle({ byteCount, digest: bytesToHex(hasher.digest()) });
		},
		cancel(reason) {
			reject(reason);
		},
	});
	return { readable: source.pipeThrough(transform), result };
}

function createFixedLengthBody(size: number): {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
} {
	const ctor = (
		globalThis as {
			FixedLengthStream?: new (
				length: number,
			) => {
				readable: ReadableStream<Uint8Array>;
				writable: WritableStream<Uint8Array>;
			};
		}
	).FixedLengthStream;
	if (typeof ctor === "function") {
		return new ctor(size);
	}

	let seen = 0;
	return new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			const bytes = asUint8Array(chunk);
			seen += bytes.byteLength;
			if (seen > size) {
				controller.error(new Error("Archive stream exceeded declared length."));
				return;
			}
			controller.enqueue(bytes);
		},
		flush(controller) {
			if (seen !== size) {
				controller.error(new Error("Archive stream length mismatch."));
			}
		},
	});
}

function asReadableStream(value: unknown): ReadableStream<Uint8Array> {
	if (value instanceof ReadableStream) {
		return rejectMaterializers(value);
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (record.stream instanceof ReadableStream) {
			return rejectMaterializers(record.stream);
		}
		if (record.content instanceof ReadableStream) {
			return rejectMaterializers(record.content);
		}
		if (record.body instanceof ReadableStream) {
			return rejectMaterializers(record.body);
		}
	}
	throw new Error("Sandbox readFile did not return a binary stream.");
}

function rejectMaterializers(
	stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	const blocked = stream as ReadableStream<Uint8Array> & {
		arrayBuffer?: unknown;
		text?: unknown;
		json?: unknown;
	};
	if (typeof blocked.arrayBuffer === "function") {
		blocked.arrayBuffer = () => {
			throw new Error("Archive bodies must be streamed.");
		};
	}
	if (typeof blocked.text === "function") {
		blocked.text = () => {
			throw new Error("Archive bodies must be streamed.");
		};
	}
	if (typeof blocked.json === "function") {
		blocked.json = () => {
			throw new Error("Archive bodies must be streamed.");
		};
	}
	return stream;
}

function parseCliResult(stdout: string): CliSuccess {
	const lines = stdout
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const last = lines.at(-1);
	if (!last) {
		throw new Error("Archive command returned no result.");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(last);
	} catch {
		throw new Error("Archive command returned invalid JSON.");
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error("Archive command returned invalid JSON.");
	}
	const record = parsed as Record<string, unknown>;
	if (record.ok !== true) {
		const error = typeof record.error === "string" ? record.error : "failed";
		throw new Error(`Archive command failed (${error}).`);
	}
	if (
		(record.action !== "create" && record.action !== "restore") ||
		typeof record.compressedBytes !== "number" ||
		typeof record.extractedBytes !== "number" ||
		!Number.isFinite(record.compressedBytes) ||
		!Number.isFinite(record.extractedBytes) ||
		record.compressedBytes < 0 ||
		record.extractedBytes < 0 ||
		typeof record.digest !== "string"
	) {
		throw new Error("Archive command returned invalid measurements.");
	}
	return {
		ok: true,
		action: record.action,
		compressedBytes: record.compressedBytes,
		extractedBytes: record.extractedBytes,
		digest: record.digest,
	};
}

function assertNoSecretMaterial(
	command: string,
	env?: Record<string, string>,
): void {
	const haystacks = [
		command,
		...Object.keys(env ?? {}),
		...Object.values(env ?? {}),
	];
	for (const value of haystacks) {
		if (
			/R2_|BACKUP_BUCKET|X-Amz-|pre-?sign|objectKey|object_key|AKIA[0-9A-Z]{16}/i.test(
				value,
			)
		) {
			throw new Error("Archive command must not receive R2 configuration.");
		}
	}
}

function archiveCliCommand(
	action: "create" | "restore",
	limits: ArchiveLimits,
): string {
	return [
		"node",
		quoteShellArg(ARCHIVE_CLI_PATH),
		action,
		"--max-compressed-bytes",
		String(limits.maxCompressedBytes),
		"--max-extracted-bytes",
		String(limits.maxExtractedBytes),
		"--max-disk-percent",
		String(limits.maxDiskPercent),
	].join(" ");
}

async function execArchiveCli(
	sandbox: ArchiveSandbox,
	action: "create" | "restore",
	limits: ArchiveLimits,
): Promise<CliSuccess> {
	const command = archiveCliCommand(action, limits);
	assertNoSecretMaterial(command);
	const result = await sandbox.exec(command, {
		cwd: "/",
		timeout: ARCHIVE_CLI_TIMEOUT_MS,
	});
	if (!result.success) {
		try {
			parseCliResult(result.stdout);
		} catch (error) {
			throw error instanceof Error
				? error
				: new Error("Archive command failed.");
		}
		throw new Error("Archive command failed.");
	}
	return parseCliResult(result.stdout);
}

async function deleteTempArchive(sandbox: ArchiveSandbox): Promise<void> {
	await sandbox.exec(`rm -f -- ${quoteShellArg(ARCHIVE_TEMP_PATH)}`, {
		cwd: "/",
		timeout: TEMP_DELETE_TIMEOUT_MS,
	});
}

async function clearWorkspace(sandbox: ArchiveSandbox): Promise<void> {
	if (WORKSPACE_PATH !== "/workspace") {
		throw new Error("Refusing to clear unexpected workspace path.");
	}
	const result = await sandbox.exec(
		"find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +",
		{ cwd: "/", timeout: WORKSPACE_CLEAR_TIMEOUT_MS },
	);
	if (!result.success) {
		throw new Error("Failed to clear sandbox workspace before restore.");
	}
}

async function assertRestoredWorkspace(sandbox: ArchiveSandbox): Promise<void> {
	const gitDir = await sandbox.exists(`${WORKSPACE_PATH}/.git`);
	if (!gitDir.exists) {
		throw new Error("Restored archive is missing Git state.");
	}
	const runner = await sandbox.exec(
		`test -f ${quoteShellArg(RUNNER_CLI_PATH)} && node -e ${quoteShellArg(
			`JSON.parse(require("node:fs").readFileSync(${JSON.stringify(RUNNER_PACKAGE_PATH)}, "utf8"))`,
		)}`,
		{ cwd: "/", timeout: RUNNER_HEALTH_TIMEOUT_MS },
	);
	if (!runner.success) {
		throw new Error("Restored sandbox is missing the baked runner.");
	}
}

async function loadArchiveRow(
	db: Db,
	archiveId: string,
): Promise<ArchiveRow | null> {
	const [row] = await db
		.select()
		.from(archives)
		.where(eq(archives.id, archiveId))
		.limit(1);
	return row ?? null;
}

function cleanupRetryAt(nowSeconds: number, attempts: number): number {
	const delay = Math.min(60 * 60, 15 * 2 ** Math.min(attempts, 8));
	return nowSeconds + delay;
}

async function markAbandoned(
	db: Db,
	archiveId: string,
	nowSeconds: number,
): Promise<void> {
	await db
		.update(archives)
		.set({
			status: "abandoned",
			cleanupRetryAt: cleanupRetryAt(nowSeconds, 0),
			updatedAt: sql`(unixepoch())`,
		})
		.where(and(eq(archives.id, archiveId), eq(archives.status, "uploading")));
}

async function withLegacyProjectQuiesce<T>(options: {
	db: Db;
	env: Env;
	projectId: string;
	userId: string;
	sandboxId: string;
	run: () => Promise<T>;
}): Promise<T> {
	const { acquireProjectPreviewLease, releaseProjectPreviewLease } =
		await import("#/lib/session-preview");
	const deps = {
		db: options.db,
		env: options.env,
		nowSeconds: () => Math.floor(Date.now() / 1000),
		randomToken: () => crypto.randomUUID(),
		sleep: (ms: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, ms)),
		getSandbox: () => {
			throw new Error("Archive quiesce does not start a sandbox.");
		},
		withWorkspaceRuntimeLease: async () => {
			throw new Error("Archive quiesce does not open a workspace runtime.");
		},
	} satisfies SessionPreviewDeps;
	const { token } = await acquireProjectPreviewLease(deps, {
		projectId: options.projectId,
		userId: options.userId,
	});
	try {
		const sessions = await options.db
			.select({ id: workspaceSessions.id })
			.from(workspaceSessions)
			.where(
				and(
					eq(workspaceSessions.projectId, options.projectId),
					eq(workspaceSessions.status, "active"),
				),
			);
		const acquire = async (index: number): Promise<T> => {
			const session = sessions[index];
			if (!session) {
				return await options.run();
			}
			return await withSessionWorkspaceLock({
				env: options.env,
				sandboxId: options.sandboxId,
				sessionId: session.id,
				run: () => acquire(index + 1),
			});
		};
		return await acquire(0);
	} finally {
		await releaseProjectPreviewLease(deps, {
			projectId: options.projectId,
			userId: options.userId,
			token,
		});
	}
}

async function createArchiveBody(options: {
	env: Env;
	db: Db;
	sandbox: ArchiveSandbox;
	input: CreateArchiveInput;
}): Promise<ArchiveRef> {
	if (!options.env.BACKUP_BUCKET) {
		throw new Error("Workspace archives require the BACKUP_BUCKET binding.");
	}
	const limits = defaultLimits(options.input.limits);
	const archiveId = crypto.randomUUID();
	const objectKey = archiveObjectKey(
		options.input.ownerKind,
		options.input.ownerId,
		options.input.generation,
		archiveId,
	);
	const nowSeconds = Math.floor(Date.now() / 1000);

	await options.db.insert(archives).values({
		id: archiveId,
		ownerKind: options.input.ownerKind,
		ownerId: options.input.ownerId,
		objectKey,
		formatVersion: ARCHIVE_FORMAT_VERSION,
		compatibilityKey: ARCHIVE_COMPATIBILITY_KEY,
		byteCount: 0,
		digest: "",
		generation: options.input.generation,
		status: "uploading",
	});

	try {
		const cli = await execArchiveCli(options.sandbox, "create", limits);
		if (cli.compressedBytes > limits.maxCompressedBytes) {
			throw new Error("Compressed archive exceeds the size limit.");
		}
		if (cli.extractedBytes > limits.maxExtractedBytes) {
			throw new Error("Workspace exceeds the extracted size limit.");
		}

		const file = await options.sandbox.readFile(ARCHIVE_TEMP_PATH, {
			encoding: "none",
		});
		const source = asReadableStream(file);
		const hashed = attachStreamingDigest(source);
		const body = createFixedLengthBody(cli.compressedBytes);
		await Promise.all([
			hashed.readable.pipeTo(body.writable),
			options.env.BACKUP_BUCKET.put(objectKey, body.readable),
		]);
		const measured = await hashed.result;
		if (measured.byteCount !== cli.compressedBytes) {
			throw new Error("Archive byte count did not match the declared length.");
		}
		if (measured.byteCount > limits.maxCompressedBytes) {
			throw new Error("Compressed archive exceeds the size limit.");
		}

		const [ready] = await options.db
			.update(archives)
			.set({
				status: "ready",
				byteCount: measured.byteCount,
				digest: measured.digest,
				updatedAt: sql`(unixepoch())`,
			})
			.where(and(eq(archives.id, archiveId), eq(archives.status, "uploading")))
			.returning();
		if (!ready) {
			throw new Error("Failed to persist archive metadata.");
		}
		return toArchiveRef(ready);
	} catch (error) {
		await markAbandoned(options.db, archiveId, nowSeconds);
		throw error;
	} finally {
		await deleteTempArchive(options.sandbox);
	}
}

export async function createArchive(
	env: Env,
	db: Db,
	input: CreateArchiveInput,
): Promise<ArchiveRef> {
	const run = () =>
		createArchiveBody({
			env,
			db,
			sandbox: input.sandbox,
			input,
		});
	if (input.quiesce === false || input.ownerKind !== "legacy_project") {
		return await run();
	}
	return await withLegacyProjectQuiesce({
		db,
		env,
		projectId: input.ownerId,
		userId: input.userId,
		sandboxId: input.sandboxId,
		run,
	});
}

export async function restoreArchive(
	env: Env,
	db: Db,
	input: RestoreArchiveInput,
): Promise<RestoreResult> {
	if (!env.BACKUP_BUCKET) {
		throw new Error("Workspace archives require the BACKUP_BUCKET binding.");
	}
	const limits = defaultLimits(input.limits);
	const row = await loadArchiveRow(db, input.archiveId);
	if (!row || row.status !== "ready") {
		throw new Error("Archive is not available.");
	}
	if (
		row.formatVersion !== ARCHIVE_FORMAT_VERSION ||
		row.compatibilityKey !== ARCHIVE_COMPATIBILITY_KEY
	) {
		throw new Error("Archive is not compatible with this runtime.");
	}
	if (row.byteCount > limits.maxCompressedBytes) {
		throw new Error("Compressed archive exceeds the size limit.");
	}

	const object = await env.BACKUP_BUCKET.get(row.objectKey);
	if (!object || !object.body) {
		throw new Error("Archive object is missing.");
	}

	try {
		const hashed = attachStreamingDigest(object.body);
		await input.sandbox.writeFile(ARCHIVE_TEMP_PATH, hashed.readable);
		const measured = await hashed.result;
		if (
			measured.byteCount !== row.byteCount ||
			measured.digest !== row.digest
		) {
			throw new Error("Archive checksum or length did not match.");
		}

		await clearWorkspace(input.sandbox);
		const cli = await execArchiveCli(input.sandbox, "restore", limits);
		if (cli.extractedBytes > limits.maxExtractedBytes) {
			throw new Error("Archive exceeds the extracted size limit.");
		}
		await assertRestoredWorkspace(input.sandbox);
		return {
			archive: toArchiveRef(row),
			extractedBytes: cli.extractedBytes,
		};
	} finally {
		await deleteTempArchive(input.sandbox);
	}
}

export async function deleteArchive(
	env: Env,
	db: Db,
	archiveId: string,
): Promise<void> {
	const row = await loadArchiveRow(db, archiveId);
	if (!row) {
		return;
	}
	const nowSeconds = Math.floor(Date.now() / 1000);
	await db
		.update(archives)
		.set({
			status: "deleting",
			updatedAt: sql`(unixepoch())`,
		})
		.where(eq(archives.id, archiveId));

	try {
		await env.BACKUP_BUCKET.delete(row.objectKey);
		await db.delete(archives).where(eq(archives.id, archiveId));
	} catch {
		await db
			.update(archives)
			.set({
				status: "deleting",
				cleanupRetryAt: cleanupRetryAt(nowSeconds, row.cleanupAttempts + 1),
				cleanupAttempts: row.cleanupAttempts + 1,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(archives.id, archiveId));
	}
}

export async function retryArchiveCleanup(options: {
	env: Env;
	db: Db;
	nowSeconds?: number;
	limit?: number;
}): Promise<{ cleaned: number }> {
	const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
	const rows = await options.db
		.select()
		.from(archives)
		.where(
			and(
				inArray(archives.status, ["abandoned", "deleting"]),
				or(
					isNull(archives.cleanupRetryAt),
					lte(archives.cleanupRetryAt, nowSeconds),
				),
				sql`${archives.cleanupAttempts} < ${ARCHIVE_CLEANUP_MAX_ATTEMPTS}`,
			),
		)
		.limit(options.limit ?? 20);

	let cleaned = 0;
	for (const row of rows) {
		try {
			await options.env.BACKUP_BUCKET.delete(row.objectKey);
			await options.db.delete(archives).where(eq(archives.id, row.id));
			cleaned += 1;
		} catch {
			await options.db
				.update(archives)
				.set({
					cleanupRetryAt: cleanupRetryAt(nowSeconds, row.cleanupAttempts + 1),
					cleanupAttempts: row.cleanupAttempts + 1,
					updatedAt: sql`(unixepoch())`,
				})
				.where(eq(archives.id, row.id));
		}
	}
	return { cleaned };
}

export function createSandboxArchive(env: Env, db: Db): SandboxArchive {
	return {
		create: (input) => createArchive(env, db, input),
		restore: (input) => restoreArchive(env, db, input),
		delete: (archiveId) => deleteArchive(env, db, archiveId),
	};
}
